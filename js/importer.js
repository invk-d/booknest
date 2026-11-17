// Adding books: detect the format, read title/author, make a cover thumbnail, store it all.
import { db, requestPersistence } from './db.js';
import { openEpub } from './epub.js';
import { decodeText, markdownTitle } from './textbook.js';

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

/**
 * Imports files into a folder. Returns { added: [book], skipped: [name], failed: [{name, error}] }.
 * onProgress(done, total) is called as each file finishes.
 */
export async function importFiles(files, folderId, onProgress) {
  requestPersistence();
  const added = [], skipped = [], failed = [];
  let done = 0;
  for (const file of files) {
    const format = formatOf(file.name);
    if (!format) { skipped.push(file.name); onProgress?.(++done, files.length); continue; }
    try {
      const info = await describe(file, format);
      const book = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        folderId: folderId ?? null,
        title: info.title, author: info.author, authorSort: info.authorSort,
        format, fileName: file.name, size: file.size,
        fileModified: file.lastModified || Date.now(), added: Date.now(),
      };
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' });
      await db.addBook(book, blob, info.cover);
      added.push(book);
    } catch (e) {
      failed.push({ name: file.name, error: e.message || String(e) });
    }
    onProgress?.(++done, files.length);
  }
  return { added, skipped, failed };
}
