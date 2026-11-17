// Adding books: detect the format, read title/author, make a cover thumbnail, store it all.
import { db, requestPersistence } from './db.js';
import { openEpub } from './epub.js';
import { decodeText, markdownTitle } from './textbook.js';
import { fingerprint } from './backup.js';

let pdfjsPromise;
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export function formatOf(name) {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (e === 'epub') return 'epub';
  if (e === 'pdf') return 'pdf';
  if (e === 'txt' || e === 'text') return 'txt';
  if (e === 'md' || e === 'markdown') return 'md';
  return null;
}

/** "Ursula K. Le Guin" -> "Le Guin, Ursula K." when the book has no sort name of its own. */
export function guessSortKey(author) {
  if (!author) return null;
  if (author.includes(',')) return author;
  const parts = author.split(/\s+/);
  if (parts.length < 2) return author;
  const particles = new Set(['le', 'de', 'van', 'von', 'da', 'di', 'du', 'la', 'del', 'der']);
  let start = parts.length - 1;
  while (start > 1 && particles.has(parts[start - 1].toLowerCase())) start--;
  return parts.slice(start).join(' ') + ', ' + parts.slice(0, start).join(' ');
}

async function thumbnail(source, maxW = 360) {
  let bmp;
  try {
    bmp = source instanceof Blob ? await createImageBitmap(source) : source;
  } catch (e) {
    // Some Safari versions can't decode SVG via createImageBitmap; fall back to <img>.
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = rej;
      img.src = URL.createObjectURL(source);
    });
  }
  const w = bmp.width, h = bmp.height;
  if (!w || !h) return null;
  const s = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}

async function describe(file, format) {
  const base = file.name.replace(/\.[^.]+$/, '');
  const info = { title: base, author: null, authorSort: null, cover: null };
  if (format === 'epub') {
    const book = await openEpub(file);
    info.title = book.title || base;
    info.author = book.author;
    info.authorSort = book.authorSort || guessSortKey(book.author);
    try { const c = await book.coverBlob(); if (c) info.cover = await thumbnail(c); } catch (e) { /* no cover */ }
    book.close();
  } else if (format === 'pdf') {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const meta = await doc.getMetadata();
      const t = meta?.info?.Title?.trim(), a = meta?.info?.Author?.trim();
      if (t) info.title = t;
      if (a) { info.author = a; info.authorSort = guessSortKey(a); }
    } catch (e) { /* no metadata */ }
    try {
      const page = await doc.getPage(1);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 360 / vp0.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      info.cover = await thumbnail(c);
    } catch (e) { /* no cover */ }
    doc.destroy();
  } else if (format === 'md') {
    info.title = markdownTitle(await decodeText(file)) || base;
  }
  return info;
}

const JUNK = /(^|\/)(__MACOSX|\.)/;   // macOS metadata and hidden files inside zips/folders

/**
 * Turns a chosen folder (or a .zip of one) into a list of { file, dirs } where `dirs` is the
 * folder path inside it, e.g. ['Fiction', 'Sci-Fi']. Files that aren't books are counted in
 * `skipped`. Accepts File objects from a folder picker (webkitRelativePath) and .zip files.
 */
export async function expandSources(files) {
  const items = [], skipped = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await window.JSZip.loadAsync(f);
      const base = f.name.replace(/\.zip$/i, '');
      const entries = Object.values(zip.files).filter(e => !e.dir && !JUNK.test(e.name));
      // Files' "Compress" puts everything inside one top-level folder; otherwise use the zip's name.
      const tops = new Set(entries.map(e => e.name.split('/')[0]));
      const wrapped = entries.length && entries.every(e => e.name.includes('/')) && tops.size === 1;
      for (const e of entries) {
        const parts = e.name.split('/').filter(Boolean);
        const name = parts.pop();
        if (!formatOf(name)) { skipped.push(name); continue; }
        const blob = await e.async('blob');
        items.push({ file: new File([blob], name, { lastModified: e.date ? e.date.getTime() : Date.now() }),
                     dirs: wrapped ? parts : [base, ...parts] });
      }
    } else {
      const rel = f.webkitRelativePath || '';
      if (JUNK.test(rel)) continue;
      if (!formatOf(f.name)) { skipped.push(f.name); continue; }
      items.push({ file: f, dirs: rel ? rel.split('/').slice(0, -1) : [] });
    }
  }
  return { items, skipped };
}

/**
 * Imports files into a folder. `files` may hold File objects or { file, folderId } items
 * (folder imports put each book in its own subfolder).
 * A file that belongs to a book already in the library but missing its file (e.g. after
 * restoring a backup) is reattached to that book, keeping its folder and reading progress.
 * relinkId: attach the (single) file to this book, whatever it is.
 * Returns { added, relinked, already, skipped, failed }.
 * onProgress(done, total) is called as each file finishes.
 */
export async function importFiles(files, folderId, onProgress, relinkId = null) {
  requestPersistence();
  const added = [], relinked = [], already = [], skipped = [], failed = [];
  const books = await db.all('books');
  const haveFile = new Set(await db.keys('files'));
  let done = 0;
  for (const item of files) {
    const file = item instanceof Blob ? item : item.file;
    const targetFolder = item instanceof Blob ? folderId : item.folderId;
    const format = formatOf(file.name);
    if (!format) { skipped.push(file.name); onProgress?.(++done, files.length); continue; }
    try {
      const fp = await fingerprint(file);
      const match = relinkId ? books.find(b => b.id === relinkId)
        : books.find(b => b.fp === fp) || books.find(b => !b.fp && !haveFile.has(b.id) && b.fileName === file.name && b.size === file.size);
      if (match && haveFile.has(match.id) && !relinkId) { already.push(match); onProgress?.(++done, files.length); continue; }
      if (match) {
        const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' });
        let cover = await db.get('covers', match.id);
        if (!cover) { try { cover = (await describe(file, format)).cover; } catch (e) { cover = null; } }
        Object.assign(match, { fp, size: file.size, fileModified: file.lastModified || match.fileModified, format, fileName: file.name });
        await db.addBook(match, blob, cover);
        haveFile.add(match.id);
        relinked.push(match);
        onProgress?.(++done, files.length);
        continue;
      }
      const info = await describe(file, format);
      const book = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        folderId: targetFolder ?? null,
        title: info.title, author: info.author, authorSort: info.authorSort,
        format, fileName: file.name, size: file.size,
        fileModified: file.lastModified || Date.now(), added: Date.now(), fp,
      };
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' });
      await db.addBook(book, blob, info.cover);
      books.push(book); haveFile.add(book.id);
      added.push(book);
    } catch (e) {
      failed.push({ name: file.name, error: e.message || String(e) });
    }
    onProgress?.(++done, files.length);
  }
  return { added, relinked, already, skipped, failed };
}
