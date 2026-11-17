// Library backups: folders, book entries, reading progress and settings in one small JSON file.
// Book files are not included. They stay in the Files app and are matched back up by content
// fingerprint when they're added again after a restore.
import { db } from './db.js';

const KIND = 'booknest-library-backup';

/** Identifies a book by its content: SHA-256 of the first 64 KB plus the file size. */
export async function fingerprint(blob) {
  const head = await blob.slice(0, 65536).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', head);
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${hex}-${blob.size}`;
}

function settingsSnapshot() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('booknest.')) out[k] = localStorage.getItem(k);
    }
  } catch (e) { /* storage unavailable */ }
  return out;
}

/** Builds the backup. Also records fingerprints for older books that don't have one yet. */
export async function makeBackup() {
  const [folders, books, progress] = await Promise.all([db.all('folders'), db.all('books'), db.all('progress')]);
  for (const b of books) {
    if (b.fp) continue;
    const file = await db.get('files', b.id);
    if (file) { b.fp = await fingerprint(file); await db.put('books', b); }
  }
  const created = new Date();
  const data = { kind: KIND, version: 1, app: 'BookNest', created: created.toISOString(),
                 folders, books, progress, settings: settingsSnapshot() };
  const day = created.toISOString().slice(0, 10);
  const file = new File([JSON.stringify(data, null, 1)], `BookNest Backup ${day}.json`, { type: 'application/json' });
  return { file, books: books.length, folders: folders.length, withProgress: progress.length };
}

/**
 * Hands the backup to the Share sheet (iPhone: "Save to Files"), or downloads it on a computer.
 * Must be called straight from a tap, so iOS allows the Share sheet. Returns true if saved/shared.
 */
export async function saveBackup(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      throw e;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

/** Reads and checks a backup file. Throws a readable error if it isn't one. */
export async function readBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch (e) { throw new Error('That file isn’t a BookNest backup.'); }
  if (!data || data.kind !== KIND || !Array.isArray(data.books) || !Array.isArray(data.folders)) {
    throw new Error('That file isn’t a BookNest backup.');
  }
  if (data.version > 1) throw new Error('This backup was made by a newer version of BookNest. Update the app and try again.');
  return data;
}

/**
 * Merges a backup into the library. Nothing is deleted: folders and books are added or updated,
 * and for reading progress the most recently read position wins. Settings are restored.
 */
export async function restoreBackup(data) {
  const [folders, books, progress] = await Promise.all([db.all('folders'), db.all('books'), db.all('progress')]);
  const haveFolder = new Set(folders.map(f => f.id));
  const bookById = new Map(books.map(b => [b.id, b]));
  const bookByFp = new Map(books.filter(b => b.fp).map(b => [b.fp, b]));
  const progressById = new Map(progress.map(p => [p.bookId, p]));
  let foldersAdded = 0, booksAdded = 0, progressRestored = 0;

  for (const f of data.folders) {
    if (!f || !f.id || !f.name) continue;
    if (!haveFolder.has(f.id)) foldersAdded++;
    await db.put('folders', { id: f.id, name: String(f.name), parentId: f.parentId ?? null });
  }

  // The same book may already be here under another id (e.g. re-added before restoring).
  const idMap = new Map();
  for (const b of data.books) {
    if (!b || !b.id) continue;
    const existing = bookById.get(b.id) || (b.fp && bookByFp.get(b.fp));
    if (existing) {
      idMap.set(b.id, existing.id);
      await db.put('books', { ...existing, title: b.title || existing.title, author: b.author ?? existing.author,
                              authorSort: b.authorSort ?? existing.authorSort, folderId: b.folderId ?? null,
                              fp: existing.fp || b.fp });
    } else {
      idMap.set(b.id, b.id);
      booksAdded++;
      await db.put('books', {
        id: b.id, folderId: b.folderId ?? null, title: String(b.title || b.fileName || 'Untitled'),
        author: b.author ?? null, authorSort: b.authorSort ?? null, format: b.format, fileName: b.fileName,
        size: b.size, fileModified: b.fileModified, added: b.added || Date.now(), fp: b.fp || null,
      });
    }
  }

  for (const p of data.progress || []) {
    if (!p || !p.bookId || !idMap.has(p.bookId)) continue;
    const id = idMap.get(p.bookId);
    const mine = progressById.get(id);
    if (!mine || (p.last || 0) > (mine.last || 0)) {
      await db.put('progress', { ...p, bookId: id });
      progressRestored++;
    }
  }

  try {
    for (const [k, v] of Object.entries(data.settings || {})) {
      if (k.startsWith('booknest.') && typeof v === 'string') localStorage.setItem(k, v);
    }
  } catch (e) { /* storage unavailable */ }

  const files = new Set(await db.keys('files'));
  const missing = (await db.all('books')).filter(b => !files.has(b.id)).length;
  return { foldersAdded, booksAdded, progressRestored, missing };
}
