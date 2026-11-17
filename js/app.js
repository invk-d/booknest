// BookNest library: folders, books, sorting, and opening the reader.
import { db } from './db.js';
import { importFiles, expandSources } from './importer.js';
import { makeBackup, saveBackup, readBackup, restoreBackup } from './backup.js';
import { openReader } from './reader.js';
import { esc, ICON, toast, actionSheet, askText, confirmDialog, onLongPress, setThemeColor } from './ui.js';

const pref = (k, d) => { try { const v = localStorage.getItem('booknest.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('booknest.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

const S = {
  folders: [], books: [], progress: {},
  folderId: null,                 // null = top level ("Library")
  sort: pref('sort', 'title'), asc: pref('asc', true), grid: pref('grid', true),
  search: '', sortOpen: false, wide: false,
  expanded: new Set(pref('expanded', [])),
  appearance: pref('appearance', 'system'),   // library theme: 'system' | 'light' | 'dark'
};

function applyAppearance() {
  const root = document.documentElement;
  if (S.appearance === 'system') delete root.dataset.theme; else root.dataset.theme = S.appearance;
  if (!document.body.classList.contains('reading')) {
    setThemeColor(getComputedStyle(document.body).backgroundColor);
  }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyAppearance);
const app = document.getElementById('app');
const fileInput = document.getElementById('fileInput');
const restoreInput = document.getElementById('restoreInput');
const folderInput = document.getElementById('folderInput');
const zipInput = document.getElementById('zipInput');
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let relinkId = null;              // set while picking the file for one particular book
const coverURLs = new Map();      // bookId -> object URL | null

// ---------- data ----------
async function loadAll() {
  const [folders, books, progress, fileIds] = await Promise.all([db.all('folders'), db.all('books'), db.all('progress'), db.keys('files')]);
  S.folders = folders; S.books = books;
  S.fileIds = new Set(fileIds);
  S.progress = Object.fromEntries(progress.map(p => [p.bookId, p]));
  if (S.folderId && !folderById(S.folderId)) S.folderId = null;
}
const folderById = id => S.folders.find(f => f.id === id) || null;
const childFolders = id => S.folders.filter(f => (f.parentId ?? null) === id).sort((a, b) => coll.compare(a.name, b.name));
const childBooks = id => S.books.filter(b => (b.folderId ?? null) === id);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
function chain(id) { const c = []; for (let f = folderById(id); f; f = folderById(f.parentId)) c.unshift(f); return c; }
function descendants(id) { const out = [id]; for (const f of childFolders(id)) out.push(...descendants(f.id)); return out; }

// ---------- sorting ----------
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const stripArticle = t => (t || '').replace(/^(the|a|an)\s+/i, '');
const SORTS = [['title', 'Title'], ['author', 'Author'], ['file', 'File Name'], ['added', 'Date Added'], ['recent', 'Recently Read']];
const textSort = s => ['title', 'author', 'file'].includes(s);

function sortBooks(list) {
  const dir = S.asc ? 1 : -1;
  const text = (ka, kb, ta, tb) => {
    if (ka == null && kb == null) return coll.compare(ta, tb);
    if (ka == null) return 1;            // books without the value always go last
    if (kb == null) return -1;
    return coll.compare(ka, kb) * dir || coll.compare(ta, tb);
  };
  const num = (x, y, ta, tb) => {
    if (x == null && y == null) return coll.compare(ta, tb);
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir || coll.compare(ta, tb);
  };
  return list.slice().sort((a, b) => {
    const ta = stripArticle(a.title), tb = stripArticle(b.title);
    switch (S.sort) {
      case 'author': return text(a.authorSort || a.author, b.authorSort || b.author, ta, tb);
      case 'file': return text(a.fileName, b.fileName, a.fileName, b.fileName);
      case 'added': return num(a.added, b.added, ta, tb);
      case 'recent': return num(S.progress[a.id]?.last ?? null, S.progress[b.id]?.last ?? null, ta, tb);
      default: return text(ta, tb, a.fileName, b.fileName);
    }
  });
}

// ---------- rendering ----------
const hueOf = s => { let h = 0; for (const ch of s || '') h = (h * 31 + ch.codePointAt(0)) & 0xffff; return h % 360; };
const FORMAT_LABEL = { epub: 'EPUB', pdf: 'PDF', txt: 'TXT', md: 'MD' };

function coverHTML(b) {
  const h = hueOf(b.title);
  const missing = S.fileIds && !S.fileIds.has(b.id);
  return `<div class="cover${missing ? ' missing' : ''}" data-cover="${b.id}" style="background:linear-gradient(150deg,hsl(${h} 38% 46%),hsl(${h} 46% 30%))">
    <div class="ct">${esc(b.title)}</div>${b.author ? `<div class="ca">${esc(b.author)}</div>` : ''}
    <div class="cf">${FORMAT_LABEL[b.format] || ''}</div>${missing ? '<span class="need">File needed</span>' : ''}</div>`;
}
function progressHTML(b) {
  const p = S.progress[b.id];
  if (!p || !(p.fraction > 0)) return '';
  const pct = Math.round(p.fraction * 100);
  return `<div class="prog"><span class="bar"><i style="width:${pct}%"></i></span>${pct}%</div>`;
}
function relTime(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.round(d / 60) + ' min ago';
  if (d < 86400) return Math.round(d / 3600) + ' hr ago';
  return Math.round(d / 86400) + (Math.round(d / 86400) === 1 ? ' day ago' : ' days ago');
}
const bookCard = b => `<button class="book" data-book="${b.id}">${coverHTML(b)}<span class="bt">${esc(b.title)}</span>${b.author ? `<span class="ba">${esc(b.author)}</span>` : ''}${progressHTML(b)}</button>`;
function bookRow(b) {
  const p = S.progress[b.id];
  return `<button class="listrow" data-book="${b.id}">${coverHTML(b)}<span class="meta"><span class="bt">${esc(b.title)}</span>
    ${b.author ? `<span class="ba">${esc(b.author)}</span>` : ''}
    <span class="sub">${FORMAT_LABEL[b.format]}${p ? ` · ${Math.round(p.fraction * 100)}% · ${relTime(p.last)}` : ''}</span>
    ${p && p.fraction > 0 ? `<span class="bar" style="max-width:150px"><i style="width:${Math.round(p.fraction * 100)}%"></i></span>` : ''}</span></button>`;
}
const recentBooks = () => S.books.filter(b => S.progress[b.id]?.last).sort((a, b) => S.progress[b.id].last - S.progress[a.id].last);

function contentsHTML() {
  const q = S.search.trim().toLowerCase();
  const hit = s => (s || '').toLowerCase().includes(q);
  const folders = childFolders(S.folderId).filter(f => !q || hit(f.name));
  const books = sortBooks(childBooks(S.folderId).filter(b => !q || hit(b.title) || hit(b.author) || hit(b.fileName)));
  let h = '';
  if (!S.wide && S.folderId === null && !q) {
    const recent = recentBooks();
    if (recent.length) h += `<div class="sec-h">Continue Reading</div><div class="recent">${recent.slice(0, 12).map(bookCard).join('')}</div>`;
  }
  const missingCount = S.books.filter(b => !S.fileIds.has(b.id)).length;
  if (S.folderId === null && missingCount && !q) {
    h += `<div class="notice"><b>${missingCount} ${missingCount === 1 ? 'book needs its file' : 'books need their files'}</b>
      <span>Add them again from the Files app (you can select them all at once). BookNest puts each one back in its folder with your place kept.</span>
      <button class="btn" data-act="add">Add Book Files</button></div>`;
  }
  if (folders.length) {
    h += `<div class="sec-h">Folders</div><div class="group">` + folders.map(f => {
      const n = childFolders(f.id).length + childBooks(f.id).length;
      return `<button class="row" data-folder="${f.id}">${ICON.folder}<span class="label">${esc(f.name)}</span><span class="count">${n}</span>${ICON.chev}</button>`;
    }).join('') + `</div>`;
  }
  if (books.length) {
    const label = SORTS.find(s => s[0] === S.sort)[1];
    h += `<div class="sec-h">${books.length} ${books.length === 1 ? 'Book' : 'Books'} · by ${label}</div>`;
    h += S.grid ? `<div class="grid">${books.map(bookCard).join('')}</div>` : `<div class="group">${books.map(bookRow).join('')}</div>`;
  }
  if (!folders.length && !books.length) {
    if (q) h = `<div class="empty">No results for “${esc(S.search)}”.</div>`;
    else if (S.folderId === null) h = welcomeHTML();
    else h = `<div class="empty">This folder is empty.<div class="empty-btns"><button class="btn" data-act="add">Add Books</button><button class="btn ghost" data-act="newfolder">New Folder</button></div></div>`;
  }
  if (S.folderId === null && S.books.length) {
    h += `<p class="foot">Press and hold a book or folder to move, rename or delete it. Books are stored on this device and work offline.</p>`;
  }
  return h;
}

function welcomeHTML() {
  const ios = isIOS();
  const installed = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return `<div class="welcome">
    <div class="logo">${ICON.book}</div>
    <h2>Welcome to BookNest</h2>
    <p>Add EPUB, PDF or text files from the Files app, then organise them into folders.</p>
    <div class="empty-btns"><button class="btn" data-act="add">Add Books</button><button class="btn ghost" data-act="importfolder">Import Folder</button><button class="btn ghost" data-act="newfolder">New Folder</button></div>
    <button class="linkbtn" data-act="restore">Restore from a backup</button>
    ${ios && !installed ? `<div class="install"><b>Put BookNest on your Home Screen</b><span>In Safari, tap the Share button <svg width="14" height="17" viewBox="0 0 14 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M7 11V1.5M3.5 5 7 1.5 10.5 5"/><path d="M4.5 7.5H2.5v8h9v-8h-2"/></svg>, then <b>Add to Home Screen</b>.</span></div>` : ''}
  </div>`;
}

function navTools() {
  return `<div class="tools">
    <button class="icon-btn" id="addBtn" aria-label="Add books or folder">${ICON.plus}</button>
    <button class="icon-btn" id="sortBtn" aria-label="Sort, view and appearance" aria-expanded="${S.sortOpen}">${ICON.sort}</button>
    <button class="icon-btn" id="moreBtn" aria-label="Back up or restore library">${ICON.more}</button></div>`;
}

function headerHTML() {
  const cur = folderById(S.folderId);
  const parent = cur ? folderById(cur.parentId) : null;
  const back = cur ? `<button class="back" id="backBtn">${ICON.back}<span>${esc(parent ? parent.name : 'Library')}</span></button>` : '<span></span>';
  return `<div class="navbar"><div class="navrow">${back}${navTools()}</div>
    <h1 class="bigtitle">${esc(cur ? cur.name : 'Library')}</h1>
    ${S.books.length || S.folders.length ? `<label class="search">${ICON.search}<input id="search" type="search" placeholder="Title, author or file name" value="${esc(S.search)}" aria-label="Search this folder"></label>` : ''}
  </div>`;
}

function treeHTML(parentId, depth) {
  return childFolders(parentId).map(f => {
    const subs = childFolders(f.id);
    const open = S.expanded.has(f.id);
    return `<button class="tnode${S.folderId === f.id ? ' sel' : ''}" data-tree="${f.id}" style="padding-left:${8 + depth * 16}px">
      <span class="disc${open ? ' open' : ''}" data-toggle="${f.id}" style="${subs.length ? '' : 'visibility:hidden'}">${ICON.disc}</span>${ICON.folder}<span class="lbl">${esc(f.name)}</span></button>`
      + (open ? treeHTML(f.id, depth + 1) : '');
  }).join('');
}

function render() {
  S.wide = window.innerWidth >= 600;
  const main = `<main class="detail">${headerHTML()}<div class="scroll" id="scroll">${contentsHTML()}</div></main>`;
  if (S.wide) {
    const recent = recentBooks().slice(0, 4);
    app.innerHTML = `<nav class="sidebar" aria-label="Folders"><div class="navbar"><div class="navrow"><span></span></div><div class="bigtitle">BookNest</div></div>
      <div class="scroll">
        ${recent.length ? `<div class="sec-h">Continue Reading</div>${recent.map(b => `<button class="side-recent" data-book="${b.id}">${coverHTML(b)}<span class="meta"><span>${esc(b.title)}</span><span class="bar"><i style="width:${Math.round((S.progress[b.id].fraction || 0) * 100)}%"></i></span></span></button>`).join('')}` : ''}
        <div class="sec-h">Folders</div>
        <div class="tree"><button class="tnode${S.folderId === null ? ' sel' : ''}" data-tree="">
          <span class="disc" style="visibility:hidden"></span>${ICON.folder}<span class="lbl">Library</span></button>${treeHTML(null, 1)}</div>
      </div></nav>${main}`;
  } else {
    app.innerHTML = main;
  }
  bind();
  hydrateCovers();
}

async function hydrateCovers() {
  for (const el of app.querySelectorAll('[data-cover]')) {
    const id = el.dataset.cover;
    if (!coverURLs.has(id)) {
      const blob = await db.get('covers', id).catch(() => null);
      coverURLs.set(id, blob ? URL.createObjectURL(blob) : null);
    }
    const url = coverURLs.get(id);
    if (url && !el.querySelector('img')) {
      const img = new Image();
      img.alt = '';
      img.src = url;
      img.onload = () => el.classList.add('has-img');
      el.prepend(img);
    }
  }
}

// ---------- interaction ----------
function go(folderId) {
  S.folderId = folderId;
  S.search = '';
  S.sortOpen = false;
  for (const f of chain(folderId)) S.expanded.add(f.id);
  setPref('expanded', [...S.expanded]);
  render();
  document.getElementById('scroll')?.scrollTo(0, 0);
}

function bind() {
  app.querySelectorAll('[data-folder]').forEach(el => el.onclick = () => go(el.dataset.folder));
  app.querySelectorAll('[data-book]').forEach(el => el.onclick = () => openBook(el.dataset.book));
  app.querySelectorAll('[data-tree]').forEach(el => el.onclick = e => {
    const id = el.dataset.tree || null;
    if (id && e.target.closest('[data-toggle]')) {
      S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id);
      setPref('expanded', [...S.expanded]);
      render();
      return;
    }
    go(id);
  });
  app.querySelectorAll('[data-act="add"]').forEach(b => b.onclick = () => fileInput.click());
  app.querySelectorAll('[data-act="newfolder"]').forEach(b => b.onclick = newFolder);
  const back = document.getElementById('backBtn');
  if (back) back.onclick = () => go(folderById(S.folderId)?.parentId ?? null);
  const search = document.getElementById('search');
  if (search) search.oninput = () => {
    S.search = search.value;
    const pos = search.selectionStart;
    document.getElementById('scroll').innerHTML = contentsHTML();
    bindContent();
    hydrateCovers();
    search.setSelectionRange(pos, pos);
  };
  const add = document.getElementById('addBtn');
  if (add) add.onclick = () => actionSheet(null, [
    { label: 'Add Books…', action: () => fileInput.click() },
    { label: 'Import Folder…', action: importFolder },
    { label: 'New Folder…', action: newFolder },
  ]);
  const more = document.getElementById('moreBtn');
  if (more) more.onclick = backupMenu;
  app.querySelectorAll('[data-act="restore"]').forEach(b => b.onclick = () => restoreInput.click());
  app.querySelectorAll('[data-act="importfolder"]').forEach(b => b.onclick = importFolder);
  const sb = document.getElementById('sortBtn');
  if (sb) sb.onclick = e => { e.stopPropagation(); S.sortOpen = !S.sortOpen; render(); };
  if (S.sortOpen) showSortMenu();
}
function bindContent() {
  const sc = document.getElementById('scroll');
  sc.querySelectorAll('[data-folder]').forEach(el => el.onclick = () => go(el.dataset.folder));
  sc.querySelectorAll('[data-book]').forEach(el => el.onclick = () => openBook(el.dataset.book));
  sc.querySelectorAll('[data-act="add"]').forEach(b => b.onclick = () => fileInput.click());
  sc.querySelectorAll('[data-act="newfolder"]').forEach(b => b.onclick = newFolder);
  sc.querySelectorAll('[data-act="restore"]').forEach(b => b.onclick = () => restoreInput.click());
}

function showSortMenu() {
  const btn = document.getElementById('sortBtn');
  const r = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'sortpop';
  pop.setAttribute('role', 'menu');
  const t = textSort(S.sort);
  const item = (attr, on, label) => `<button role="menuitemradio" aria-checked="${on}" ${attr}><span class="ck">${on ? '✓' : ''}</span>${label}</button>`;
  pop.innerHTML = `<div class="ph">Sort By</div>${SORTS.map(([k, l]) => item(`data-sort="${k}"`, S.sort === k, l)).join('')}
    <hr>${item('data-asc="1"', S.asc, t ? 'A to Z' : 'Oldest First')}${item('data-asc="0"', !S.asc, t ? 'Z to A' : 'Newest First')}
    <hr>${item('data-grid="1"', S.grid, 'Grid')}${item('data-grid="0"', !S.grid, 'List')}
    <hr><div class="ph">Appearance</div>${item('data-look="system"', S.appearance === 'system', 'Automatic')}${item('data-look="light"', S.appearance === 'light', 'Light')}${item('data-look="dark"', S.appearance === 'dark', 'Dark')}`;
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  document.body.appendChild(pop);
  pop.onclick = e => e.stopPropagation();
  const done = () => { S.sortOpen = false; pop.remove(); render(); };
  pop.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {
    if (S.sort !== b.dataset.sort) S.asc = textSort(b.dataset.sort);
    S.sort = b.dataset.sort; setPref('sort', S.sort); setPref('asc', S.asc); done();
  });
  pop.querySelectorAll('[data-asc]').forEach(b => b.onclick = () => { S.asc = b.dataset.asc === '1'; setPref('asc', S.asc); done(); });
  pop.querySelectorAll('[data-grid]').forEach(b => b.onclick = () => { S.grid = b.dataset.grid === '1'; setPref('grid', S.grid); done(); });
  pop.querySelectorAll('[data-look]').forEach(b => b.onclick = () => { S.appearance = b.dataset.look; setPref('appearance', S.appearance); applyAppearance(); done(); });
}
document.addEventListener('click', () => {
  if (S.sortOpen) { S.sortOpen = false; document.querySelector('.sortpop')?.remove(); render(); }
});
const _render = render;

// ---------- folders & books ----------
async function newFolder() {
  const name = await askText('New Folder', '', 'Create');
  if (!name) return;
  const f = { id: newId(), name, parentId: S.folderId };
  await db.put('folders', f);
  S.folders.push(f);
  render();
}

async function renameFolder(f) {
  const name = await askText('Rename Folder', f.name);
  if (!name || name === f.name) return;
  f.name = name;
  await db.put('folders', f);
  render();
}

async function deleteFolder(f) {
  const ids = new Set(descendants(f.id));
  const books = S.books.filter(b => ids.has(b.folderId));
  const msg = books.length ? `This also deletes ${books.length} ${books.length === 1 ? 'book' : 'books'} inside it from BookNest.` : 'The folder is empty.';
  if (!(await confirmDialog(`Delete “${f.name}”?`, msg))) return;
  for (const b of books) await db.deleteBook(b.id);
  for (const id of ids) await db.del('folders', id);
  S.books = S.books.filter(b => !ids.has(b.folderId));
  S.folders = S.folders.filter(x => !ids.has(x.id));
  if (ids.has(S.folderId)) S.folderId = f.parentId ?? null;
  render();
}

async function renameBook(b) {
  const title = await askText('Rename Book', b.title);
  if (!title || title === b.title) return;
  b.title = title;
  await db.put('books', b);
  render();
}

async function deleteBook(b) {
  if (!(await confirmDialog(`Delete “${b.title}”?`, 'It will be removed from BookNest. The original in Files is not affected.'))) return;
  await db.deleteBook(b.id);
  S.books = S.books.filter(x => x.id !== b.id);
  delete S.progress[b.id];
  render();
}

async function resetProgress(b) {
  await db.del('progress', b.id);
  delete S.progress[b.id];
  render();
}

/** Lets the user pick a destination folder. `exclude` = folder ids that can't be chosen. */
function pickFolder(title, exclude = new Set()) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'as-wrap';
    const rows = [];
    const walk = (pid, depth) => childFolders(pid).forEach(f => {
      if (exclude.has(f.id)) return;
      rows.push(`<button class="pick-row" data-id="${f.id}" style="padding-left:${16 + depth * 18}px">${ICON.folder}<span>${esc(f.name)}</span></button>`);
      walk(f.id, depth + 1);
    });
    walk(null, 1);
    wrap.innerHTML = `<div class="as picker"><div class="as-group">
      <div class="as-title">${esc(title)}</div>
      <div class="pick-list"><button class="pick-row" data-id=""><span class="pick-root">${ICON.folder}</span><span>Library (top level)</span></button>${rows.join('')}</div></div>
      <div class="as-group"><button class="as-btn cancel">Cancel</button></div></div>`;
    const close = v => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) { if (e.target === wrap) close(undefined); return; }
      if (b.classList.contains('cancel')) close(undefined);
      else close(b.dataset.id || null);
    });
    document.body.appendChild(wrap);
  });
}

async function moveBook(b) {
  const dest = await pickFolder(`Move “${b.title}” to…`);
  if (dest === undefined || dest === (b.folderId ?? null)) return;
  b.folderId = dest;
  await db.put('books', b);
  toast(`Moved to ${dest ? folderById(dest).name : 'Library'}`);
  render();
}

async function moveFolder(f) {
  const dest = await pickFolder(`Move “${f.name}” to…`, new Set(descendants(f.id)));
  if (dest === undefined || dest === (f.parentId ?? null)) return;
  f.parentId = dest;
  await db.put('folders', f);
  toast(`Moved to ${dest ? folderById(dest).name : 'Library'}`);
  render();
}

onLongPress(app, '[data-book], [data-folder], [data-tree]', el => {
  if (el.dataset.book) {
    const b = S.books.find(x => x.id === el.dataset.book);
    if (!b) return;
    const items = [
      { label: 'Move to…', action: () => moveBook(b) },
      { label: 'Rename…', action: () => renameBook(b) },
    ];
    if (S.progress[b.id]) items.push({ label: 'Reset Reading Progress', action: () => resetProgress(b) });
    items.push({ label: 'Delete Book', destructive: true, action: () => deleteBook(b) });
    actionSheet(b.title, items);
  } else {
    const f = folderById(el.dataset.folder || el.dataset.tree);
    if (!f) return;
    actionSheet(f.name, [
      { label: 'Rename…', action: () => renameFolder(f) },
      { label: 'Move to…', action: () => moveFolder(f) },
      { label: 'Delete Folder', destructive: true, action: () => deleteFolder(f) },
    ]);
  }
});

// ---------- adding books ----------
async function addFiles(files) {
  files = Array.from(files || []);
  if (!files.length) return;
  const t = toast(`Adding ${files.length} ${files.length === 1 ? 'book' : 'books'}…`, 600000);
  const forBook = relinkId; relinkId = null;
  if (forBook) files = files.slice(0, 1);
  let imported = null, ignored = [];
  if (!forBook && files.some(f => /\.zip$/i.test(f.name) || f.webkitRelativePath)) {
    t.textContent = 'Reading folder…';
    try {
      const { items, skipped } = await expandSources(files);
      ignored = skipped;
      const made = new Set(), tops = new Set();
      files = [];
      for (const it of items) {
        let parent = S.folderId;
        for (const name of it.dirs) parent = await ensureFolder(parent, name, made);
        if (it.dirs.length) tops.add(it.dirs[0]);
        files.push({ file: it.file, folderId: parent });
      }
      imported = { made: made.size, tops: [...tops] };
      t.textContent = `Adding ${files.length} ${files.length === 1 ? 'book' : 'books'}…`;
    } catch (e) {
      t.remove();
      toast('Couldn’t read that folder: ' + (e.message || e), 5000);
      return;
    }
  }
  const res = await importFiles(files, S.folderId, (done, total) => { t.textContent = `Adding books… ${done} of ${total}`; }, forBook);
  t.remove();
  for (const b of res.relinked) { const u = coverURLs.get(b.id); if (u) URL.revokeObjectURL(u); coverURLs.delete(b.id); }
  await loadAll();
  render();
  const parts = [];
  if (res.added.length) parts.push(`Added ${res.added.length} ${res.added.length === 1 ? 'book' : 'books'}`);
  if (res.relinked.length) parts.push(`${res.relinked.length} ${res.relinked.length === 1 ? 'book is' : 'books are'} back in place`);
  if (res.already.length) parts.push(`${res.already.length} already in your library`);
  if (imported) {
    const name = imported.tops.length === 1 ? `“${imported.tops[0]}”` : 'the folder';
    parts.unshift(`Imported ${name}${imported.made ? ` with ${imported.made} ${imported.made === 1 ? 'folder' : 'folders'}` : ''}`);
  }
  if (res.skipped.length) parts.push(`skipped ${res.skipped.length} unsupported (EPUB, PDF, TXT and MD only)`);
  if (ignored.length) parts.push(`ignored ${ignored.length} other ${ignored.length === 1 ? 'file' : 'files'}`);
  if (res.failed.length) parts.push(`couldn't read ${res.failed.map(f => f.name).join(', ')}`);
  toast(parts.map((x, i) => i ? x[0].toLowerCase() + x.slice(1) : x).join('; ') || 'Nothing added', 4500);
}
fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
folderInput.onchange = () => { addFiles(folderInput.files); folderInput.value = ''; };
zipInput.onchange = () => {
  const f = zipInput.files?.[0];
  zipInput.value = '';
  if (!f) return;
  if (!/\.zip$/i.test(f.name)) { toast('Choose the .zip file made by Compress in the Files app.', 4500); return; }
  addFiles([f]);
};

/** Finds a subfolder by name (so importing the same folder again merges into it), or creates it. */
async function ensureFolder(parentId, name, made) {
  const existing = S.folders.find(f => (f.parentId ?? null) === parentId && f.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const f = { id: newId(), name, parentId };
  await db.put('folders', f);
  S.folders.push(f);
  made.add(f.id);
  return f.id;
}

function importFolder() {
  // Computers can pick a folder directly. iPhone's picker can't, but Files can zip a folder.
  if (!isIOS() && 'webkitdirectory' in folderInput) { folderInput.click(); return; }
  confirmDialog('Import a folder',
    'In the Files app, press and hold the folder and tap Compress. Then choose the .zip file it makes. BookNest rebuilds the folder with all its subfolders and books.',
    'Choose .zip…', false, () => { zipInput.click(); return true; });
}
// iOS gives no event when the picker is cancelled; forget a pending relink once focus returns.
window.addEventListener('focus', () => setTimeout(() => { if (!fileInput.files?.length) relinkId = null; }, 1000));

// ---------- backup & restore ----------
function backupMenu() {
  const last = pref('lastBackup', null);
  const when = last ? `Last backed up ${new Date(last).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.` : 'Not backed up yet.';
  actionSheet(`${when} A backup holds your folders, reading progress and settings. Book files stay in the Files app.`, [
    { label: 'Back Up Library…', action: backUp },
    { label: 'Restore from Backup…', action: () => restoreInput.click() },
  ]);
}

async function backUp() {
  let backup;
  const t = toast('Preparing backup…', 60000);
  try { backup = await makeBackup(); }
  catch (e) { t.remove(); toast('Couldn’t make the backup: ' + (e.message || e), 5000); return; }
  t.remove();
  // iOS only opens the Share sheet straight from a tap, so ask for one more tap once it's ready.
  const ok = await confirmDialog('Backup ready',
    `${backup.books} ${backup.books === 1 ? 'book' : 'books'}, ${backup.folders} ${backup.folders === 1 ? 'folder' : 'folders'} and your reading progress. Choose “Save to Files” on the next screen.`,
    'Save…', false, () => saveBackup(backup.file));
  if (ok) {
    setPref('lastBackup', Date.now());
    toast('Library backed up');
  }
}

restoreInput.onchange = async () => {
  const file = restoreInput.files?.[0];
  restoreInput.value = '';
  if (!file) return;
  let data;
  try { data = await readBackup(file); }
  catch (e) { toast(e.message, 4500); return; }
  const date = new Date(data.created).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const go = await confirmDialog(`Restore backup from ${date}?`,
    `Brings back ${data.books.length} ${data.books.length === 1 ? 'book' : 'books'}, ${data.folders.length} ${data.folders.length === 1 ? 'folder' : 'folders'}, reading progress and settings. Nothing in BookNest is deleted, and your files in Files aren’t touched.`,
    'Restore', false);
  if (!go) return;
  try {
    const r = await restoreBackup(data);
    S.appearance = pref('appearance', 'system'); S.sort = pref('sort', 'title'); S.asc = pref('asc', true); S.grid = pref('grid', true);
    S.expanded = new Set(pref('expanded', []));
    await loadAll();
    applyAppearance();
    S.folderId = null;
    render();
    toast(r.missing ? `Restored. ${r.missing} ${r.missing === 1 ? 'book needs its file' : 'books need their files'}: add them from the Files app and they’ll go back in place.` : 'Library restored', 6000);
  } catch (e) {
    toast('Couldn’t restore: ' + (e.message || e), 5000);
  }
};
document.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  document.body.classList.remove('dropping');
  addFiles(e.dataTransfer.files);
});

// ---------- reader ----------
let reading = false, updateWaiting = false;
async function openBook(id) {
  const b = S.books.find(x => x.id === id);
  if (!b || reading) return;
  if (!S.fileIds.has(b.id)) {
    actionSheet(`“${b.title}” needs its file. Choose ${b.fileName} in the Files app to read it here.`, [
      { label: 'Choose File…', action: () => { relinkId = b.id; fileInput.click(); } },
    ]);
    return;
  }
  reading = true;
  await openReader(b, {
    onProgress: pos => { S.progress[pos.bookId] = pos; },
    onClose: () => { reading = false; if (updateWaiting) location.reload(); else { applyAppearance(); render(); } },
  });
}

// ---------- start ----------
let lastWide = null;
addEventListener('resize', () => {
  const wide = window.innerWidth >= 600;
  if (wide !== lastWide && !reading) { lastWide = wide; render(); }
});

(async function start() {
  try {
    await loadAll();
  } catch (e) {
    app.innerHTML = `<div class="empty">BookNest couldn't open its storage on this device.<br><small>${esc(e.message || String(e))}</small></div>`;
    return;
  }
  lastWide = window.innerWidth >= 600;
  applyAppearance();
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // A new version was installed: reload to use it, but never in the middle of reading.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (reading) updateWaiting = true; else location.reload();
    });
  }
})();

export { _render as render };
