// IndexedDB storage. Everything lives on the device, so the library works offline.
//   folders  { id, name, parentId }            parentId null = top level
//   books    { id, folderId, title, author, authorSort, format, fileName, size, fileModified, added }
//   files    bookId -> Blob (the book file itself)
//   covers   bookId -> Blob (JPEG thumbnail)
//   progress { bookId, chapter, offset, page, fraction, last }

const DB_NAME = 'booknest';
const VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('folders', { keyPath: 'id' });
        d.createObjectStore('books', { keyPath: 'id' });
        d.createObjectStore('files');
        d.createObjectStore('covers');
        d.createObjectStore('progress', { keyPath: 'bookId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(stores, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    const req = fn(t);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  }));
}

export const db = {
  all: store => run(store, 'readonly', t => t.objectStore(store).getAll()),
  get: (store, key) => run(store, 'readonly', t => t.objectStore(store).get(key)),
  put: (store, value, key) => run(store, 'readwrite', t =>
    key === undefined ? t.objectStore(store).put(value) : t.objectStore(store).put(value, key)),
  keys: store => run(store, 'readonly', t => t.objectStore(store).getAllKeys()),
  del: (store, key) => run(store, 'readwrite', t => t.objectStore(store).delete(key)),

  /** Saves a newly imported book, its file and cover in one transaction. */
  addBook: (book, file, cover) => run(['books', 'files', 'covers'], 'readwrite', t => {
    t.objectStore('books').put(book);
    t.objectStore('files').put(file, book.id);
    if (cover) t.objectStore('covers').put(cover, book.id);
  }),

  deleteBook: id => run(['books', 'files', 'covers', 'progress'], 'readwrite', t => {
    for (const s of ['books', 'files', 'covers', 'progress']) t.objectStore(s).delete(id);
  }),
};

/** Ask the browser not to evict the library when storage runs low. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch (e) { /* not supported */ }
}
