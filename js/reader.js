// The reading screen: EPUB/TXT/MD through the iframe engine, PDF through pdf.js.
import { db } from './db.js';
import { openEpub } from './epub.js';
import { openText, decodeText } from './textbook.js';
import { loadPdfJs } from './importer.js';
import { ENGINE_SOURCE } from './engine.js';
import { bookFlip } from './flip.js';
import { esc, ICON, setThemeColor, toast } from './ui.js';

export const THEMES = {
  light: { bg: '#ffffff', fg: '#1c1c1e', link: '#3a3a3c', textLink: '#0a60d0', label: 'Light' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636', link: '#45403a', textLink: '#8a5a2b', label: 'Sepia' },
  gray:  { bg: '#4a4a4e', fg: '#ededf0', link: '#d1d1d6', textLink: '#6cb4ff', label: 'Gray' },
  dark:  { bg: '#1c1c1e', fg: '#e3e3e6', link: '#c7c7cc', textLink: '#6cb4ff', label: 'Dark' },
  black: { bg: '#000000', fg: '#c9c9cc', link: '#aeaeb2', textLink: '#6cb4ff', label: 'Black' },
};
export const FONTS = [
  ['original', 'Original', null],
  ['newYork', 'New York', 'ui-serif, "New York", Georgia, serif'],
  ['system', 'San Francisco', '-apple-system, system-ui, sans-serif'],
  ['georgia', 'Georgia', 'Georgia, serif'],
  ['palatino', 'Palatino', 'Palatino, "Palatino Linotype", "Book Antiqua", serif'],
  ['charter', 'Charter', 'Charter, "Bitstream Charter", Cambria, serif'],
  ['iowan', 'Iowan', '"Iowan Old Style", "Palatino", serif'],
  ['avenir', 'Avenir Next', '"Avenir Next", Avenir, "Segoe UI", sans-serif'],
  ['menlo', 'Menlo', 'ui-monospace, Menlo, Consolas, monospace'],
];
// Space between paragraphs, in ems. 'orig' keeps the book's own spacing.
const PARA = [['orig', 'Original'], [0, 'None'], [0.5, 'Small'], [1, 'Medium'], [1.6, 'Large']];
const DEFAULTS = { theme: 'system', font: 'newYork', size: 19, line: 1.5, margin: 24, justify: true, hyphenate: true, mode: 'paged', spread: true, gutter: 64, animate: true, paraSpacing: null };

function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('booknest.settings') || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveSettings(s) { try { localStorage.setItem('booknest.settings', JSON.stringify(s)); } catch (e) { /* ignore */ } }

// "Auto" follows the library's appearance (Light/Dark), or the phone when that's Automatic.
const prefersDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
function theme(s) { return s.theme === 'system' ? (prefersDark() ? THEMES.dark : THEMES.light) : THEMES[s.theme]; }

/** Two pages side by side when the screen is wide, e.g. an unfolded iPhone Duo or landscape. */
export function spreadFits(w, h) { return w >= 600 && h > 0 && w / h >= 0.8; }

export async function openReader(record, { onClose, onProgress }) {
  const root = document.getElementById('reader');
  const settings = loadSettings();
  const saved = (await db.get('progress', record.id)) || { bookId: record.id, chapter: 0, offset: 0, page: 0, fraction: 0 };
  const R = {
    book: null, pdf: null, chapter: saved.chapter || 0, page: 0, pageCount: 1, chapterFrac: 0,
    overall: saved.fraction || 0, offset: saved.offset || 0, pdfPage: saved.page || 0,
    chrome: true, sheet: null, frame: null, ready: false, hideTimer: null, saveTimer: null, closed: false,
    bookmarks: [],            // [{ id, chapter, offset, page, fraction, label, created }]
    search: { q: '', results: [], done: true, token: 0 }, texts: new Map(),
    find: null,               // { q, index } while stepping through search matches
  };

  root.hidden = false;
  document.body.classList.add('reading');
  root.innerHTML = `
    <div class="r-stage" id="rStage"><div class="r-loading">Opening “${esc(record.title)}”…</div></div>
    <div class="r-gutter" id="rGutter" hidden></div>
    <div class="r-ribbon" id="rRibbon" hidden aria-hidden="true"></div>
    <div class="findbar" id="rFindBar" hidden>
      <button class="cbtn" id="fPrev" aria-label="Previous match">${ICON.chevL}</button>
      <span id="fInfo" aria-live="polite"></span>
      <button class="cbtn" id="fNext" aria-label="Next match">${ICON.chevR}</button>
      <button class="fdone" id="fDone">Done</button>
    </div>
    <div class="chrome top" id="cTop">
      <button class="cbtn" id="rClose" aria-label="Close book">${ICON.close}</button>
      <div class="ttl"><b>${esc(record.title)}</b>${record.author ? `<span>${esc(record.author)}</span>` : ''}</div>
      <button class="cbtn" id="rFind" aria-label="Find in book">${ICON.find}</button>
      <button class="cbtn" id="rMark" aria-label="Bookmark this page" aria-pressed="false">${ICON.mark}</button>
      <button class="cbtn" id="rToc" aria-label="Contents and bookmarks">${ICON.list}</button>
      <button class="cbtn" id="rAa" aria-label="Appearance">${ICON.aa}</button>
    </div>
    <div class="chrome bottom" id="cBot">
      <input type="range" id="rSlider" min="0" max="1000" value="0" aria-label="Position in book">
      <div class="loc"><span id="rChap"></span><span id="rLoc"></span></div>
    </div>
    <div class="sheet-backdrop" id="rBackdrop" hidden></div>
    <div class="sheet" id="rSheet" hidden></div>`;
  const $ = id => document.getElementById(id);
  const stage = $('rStage');

  applyChromeTheme();

  // ---------- shared ----------
  function applyChromeTheme() {
    const t = theme(settings);
    root.style.setProperty('--rbg', t.bg);
    root.style.setProperty('--rfg', t.fg);
    root.style.setProperty('--rlink', t.link);
    setThemeColor(t.bg);
  }
  const isPDF = record.format === 'pdf';
  const spreadNow = () => settings.spread && settings.mode === 'paged' && spreadFits(stage.clientWidth, stage.clientHeight);

  function showChrome(v) {
    R.chrome = v;
    $('cTop').classList.toggle('hide', !v);
    $('cBot').classList.toggle('hide', !v);
  }
  function hideChrome() { clearTimeout(R.hideTimer); if (R.chrome && !R.sheet) showChrome(false); }
  function scheduleHide() { clearTimeout(R.hideTimer); R.hideTimer = setTimeout(() => { if (!R.sheet) showChrome(false); }, 2500); }

  function persist(now) {
    clearTimeout(R.saveTimer);
    const write = () => {
      const pos = { bookId: record.id, chapter: R.chapter, offset: R.offset, page: R.pdfPage, fraction: R.overall, last: Date.now() };
      db.put('progress', pos).catch(() => {});
      onProgress?.(pos);
    };
    if (now) write(); else R.saveTimer = setTimeout(write, 400);
  }

  function updateLocation() {
    const pct = Math.round(R.overall * 100);
    $('rSlider').value = Math.round(R.overall * 1000);
    if (isPDF) {
      $('rLoc').textContent = `Page ${R.pdfPage + 1} of ${R.pdf?.numPages || 1}`;
    } else {
      $('rLoc').textContent = settings.mode === 'paged' && R.pageCount > 1 ? `${R.page + 1} of ${R.pageCount} · ${pct}%` : `${pct}%`;
    }
    const cur = currentTocEntry();
    $('rChap').textContent = cur ? cur.title : '';
  }

  function currentTocEntry() {
    const toc = R.book?.toc || [];
    const at = isPDF ? R.pdfPage : R.chapter;
    let found = null;
    for (const t of toc) if (t.index <= at) found = t;
    return found;
  }

  function handleTap(x) {
    if (R.sheet) { closeSheet(); return; }
    if (x < 0.28) prev(); else if (x > 0.72) next(); else { clearTimeout(R.hideTimer); showChrome(!R.chrome); }
  }

  // ---------- web (EPUB / TXT / MD) ----------
  let cumulative = [], total = 1;
  function overallFor(chapter, frac) {
    const size = R.book.spine[chapter]?.size || 1;
    return Math.min(1, Math.max(0, (cumulative[chapter] + size * frac) / total));
  }
  function locate(f) {
    const target = f * total;
    for (let i = 0; i < R.book.spine.length; i++) {
      const end = cumulative[i] + R.book.spine[i].size;
      if (target < end || i === R.book.spine.length - 1) return { chapter: i, frac: Math.min(1, Math.max(0, (target - cumulative[i]) / R.book.spine[i].size)) };
    }
    return { chapter: 0, frac: 0 };
  }

  function engineConfig() {
    const t = theme(settings);
    const font = FONTS.find(f => f[0] === settings.font) || FONTS[1];
    return { bg: t.bg, fg: t.fg, link: t.textLink, font: font[2], fontSize: settings.size, lineHeight: settings.line,
             margin: settings.margin, marginV: 28, justify: settings.justify, hyphenate: settings.hyphenate,
             mode: settings.mode, spread: spreadNow(), gutter: settings.gutter, animate: settings.animate !== false, paraSpacing: settings.paraSpacing,
             dark: [THEMES.gray, THEMES.dark, THEMES.black].includes(t) };
  }

  window.__booknest = msg => {
    if (R.closed) return;
    if (msg.type === 'position') {
      R.offset = msg.offset; R.page = msg.page; R.pageCount = msg.pageCount; R.chapterFrac = msg.fraction;
      R.overall = overallFor(R.chapter, msg.fraction);
      updateLocation();
      updateMarkState();
      persist();
    } else if (msg.type === 'tap') handleTap(msg.x);
    else if (msg.type === 'swipe') { msg.dir === 'left' ? next() : prev(); }
    else if (msg.type === 'key') onKey({ key: msg.key, preventDefault() {} });
    else if (msg.type === 'link') {
      const dest = R.book.resolveLink(R.chapter, msg.href);
      if (!dest) return;
      if (dest.external) window.open(dest.external, '_blank', 'noopener');
      else loadChapter(dest.index, dest.fragment ? { kind: 'anchor', value: dest.fragment } : { kind: 'start' });
    }
  };

  async function loadChapter(index, target) {
    if (index < 0 || index >= R.book.spine.length) return;
    if (index === R.chapter && R.ready && R.frame?.contentWindow?.BookNest) {
      R.frame.contentWindow.BookNest.go(target);
      return;
    }
    R.chapter = index;
    R.ready = false;
    const doc = await R.book.chapterDocument(index);
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    doc.head.prepend(meta);
    const script = doc.createElement('script');
    script.textContent = ENGINE_SOURCE;
    doc.body.appendChild(script);
    const html = '<!DOCTYPE html>' + doc.documentElement.outerHTML;

    const frame = document.createElement('iframe');
    frame.className = 'r-frame';
    frame.title = record.title;
    frame.style.opacity = '0';
    frame.addEventListener('load', () => {
      if (R.closed || frame !== R.frame) return;
      try {
        frame.contentWindow.BookNest.setup(engineConfig(), target);
        R.ready = true;
        frame.style.opacity = '1';
      } catch (e) { console.error(e); }
    });
    frame.srcdoc = html;
    if (R.frame) R.frame.remove();
    R.frame = frame;
    stage.innerHTML = '';
    stage.appendChild(frame);
  }

  function applyEngine() {
    $('rGutter').hidden = !(spreadNow() && !isPDF);
    if (R.ready && R.frame?.contentWindow?.BookNest) R.frame.contentWindow.BookNest.apply(engineConfig());
  }

  // ---------- PDF ----------
  function pdfGroup(p) {
    if (!spreadNow()) return [p];
    if (p === 0) return [0];
    const start = p % 2 === 1 ? p : p - 1;
    return [start, start + 1].filter(i => i < R.pdf.numPages);
  }
  let renderToken = 0, pdfFlip = null;
  function copyBox(el) {
    const c = el.cloneNode(true);
    const src = el.querySelectorAll('canvas'), dst = c.querySelectorAll('canvas');
    src.forEach((cv, i) => dst[i].getContext('2d').drawImage(cv, 0, 0));
    return c;
  }
  async function renderPDF(dir) {
    const token = ++renderToken;
    const pages = pdfGroup(R.pdfPage);
    const W = stage.clientWidth, H = stage.clientHeight, pad = 12;
    const box = document.createElement('div');
    box.className = 'pdf-spread';
    const t = settings.theme === 'system' ? (prefersDark() ? 'dark' : 'light') : settings.theme;
    box.dataset.tint = t;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const i of pages) {
      const page = await R.pdf.getPage(i + 1);
      if (token !== renderToken) return;
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min((W - pad * (pages.length + 1)) / pages.length / vp0.width, (H - pad * 2) / vp0.height);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(vp.width / dpr) + 'px';
      c.style.height = Math.floor(vp.height / dpr) + 'px';
      box.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      if (token !== renderToken) return;
    }
    if (pdfFlip) { pdfFlip.finish(); pdfFlip = null; }
    const old = stage.querySelector('.pdf-spread');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fromCopy = dir && old && settings.animate !== false && !reduce ? copyBox(old) : null;
    stage.innerHTML = '';
    stage.appendChild(box);
    if (fromCopy) {
      const f = bookFlip({ host: stage, position: 'absolute', W: stage.clientWidth, H: stage.clientHeight,
                           spread: spreadNow(), dir, from: () => copyBox(fromCopy), to: () => copyBox(box),
                           bg: theme(settings).bg, dark: [THEMES.gray, THEMES.dark, THEMES.black].includes(theme(settings)),
                           duration: spreadNow() ? 620 : 540 });
      pdfFlip = f;
      f.done.then(() => { if (pdfFlip === f) pdfFlip = null; });
    }
  }
  function pdfGo(p, dir) {
    R.pdfPage = Math.max(0, Math.min(p, R.pdf.numPages - 1));
    queueMicrotask(updateMarkState);
    R.overall = R.pdf.numPages > 1 ? R.pdfPage / (R.pdf.numPages - 1) : 1;
    updateLocation();
    persist();
    renderPDF(dir);
  }

  // ---------- navigation ----------
  function next() {
    hideChrome();
    if (isPDF) { const g = pdfGroup(R.pdfPage); if (g[g.length - 1] < R.pdf.numPages - 1) pdfGo(g[g.length - 1] + 1, 1); return; }
    if (!R.ready) return;
    if (!R.frame.contentWindow.BookNest.next() && R.chapter < R.book.spine.length - 1) loadChapter(R.chapter + 1, { kind: 'start' });
  }
  function prev() {
    hideChrome();
    if (isPDF) { const g = pdfGroup(R.pdfPage); if (g[0] > 0) pdfGo(pdfGroup(g[0] - 1)[0], -1); return; }
    if (!R.ready) return;
    if (!R.frame.contentWindow.BookNest.prev() && R.chapter > 0) loadChapter(R.chapter - 1, { kind: 'end' });
  }
  function seek(f) {
    if (isPDF) { pdfGo(Math.round(f * (R.pdf.numPages - 1))); return; }
    const loc = locate(f);
    loadChapter(loc.chapter, { kind: 'fraction', value: loc.frac });
  }
  function goToc(entry) {
    closeSheet();
    hideChrome();
    if (isPDF) pdfGo(entry.index);
    else loadChapter(entry.index, entry.fragment ? { kind: 'anchor', value: entry.fragment } : { kind: 'start' });
  }

  function onKey(e) {
    if (R.sheet) { if (e.key === 'Escape') closeSheet(); return; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Escape') close();
  }

  // ---------- sheets ----------
  function openSheet(kind) {
    R.sheet = kind;
    clearTimeout(R.hideTimer);
    const sh = $('rSheet');
    $('rBackdrop').hidden = false;
    sh.hidden = false;
    if (kind === 'toc') renderToc(sh, 'contents');
    else if (kind === 'bookmarks') renderToc(sh, 'bookmarks');
    else if (kind === 'search') renderSearch(sh);
    else renderSettings(sh);
  }
  function closeSheet() { R.sheet = null; $('rSheet').hidden = true; $('rBackdrop').hidden = true; }

  function renderToc(sh, tab) {
    const toc = R.book?.toc || [];
    const cur = currentTocEntry();
    const tabs = `<div class="segm sheet-tabs" role="tablist">
      <button role="tab" data-tab="contents" aria-pressed="${tab === 'contents'}">Contents</button>
      <button role="tab" data-tab="bookmarks" aria-pressed="${tab === 'bookmarks'}">Bookmarks${R.bookmarks.length ? ` (${R.bookmarks.length})` : ''}</button></div>`;
    let body;
    if (tab === 'contents') {
      body = toc.length ? `<div class="toc">${toc.map((t, i) => `<button class="toc-row${t === cur ? ' cur' : ''}" data-i="${i}" style="padding-left:${12 + t.level * 16}px">${esc(t.title)}</button>`).join('')}</div>`
                        : '<p class="hint">This book has no table of contents.</p>';
    } else {
      const list = sortedBookmarks();
      body = list.length ? `<div class="bm-list">${list.map(b => `<div class="bm-row">
          <button class="bm-go" data-bm="${b.id}"><span class="bm-where">${esc(whereLabel(b))}</span>
            ${b.label ? `<span class="bm-text">${esc(b.label)}</span>` : ''}
            <span class="bm-when">${new Date(b.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></button>
          <button class="bm-del" data-del="${b.id}" aria-label="Delete bookmark">${ICON.close}</button></div>`).join('')}</div>`
        : `<p class="hint">No bookmarks yet. Tap the bookmark button at the top of a page to add one.</p>`;
    }
    sh.innerHTML = `<div class="grab"></div><div class="sh"><b>${tab === 'contents' ? 'Contents' : 'Bookmarks'}</b><button id="shDone">Done</button></div>${tabs}${body}`;
    $('shDone').onclick = closeSheet;
    sh.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { R.sheet = b.dataset.tab === 'contents' ? 'toc' : 'bookmarks'; renderToc(sh, b.dataset.tab); });
    sh.querySelectorAll('[data-i]').forEach(b => b.onclick = () => goToc(toc[+b.dataset.i]));
    sh.querySelectorAll('[data-bm]').forEach(b => b.onclick = () => goBookmark(R.bookmarks.find(x => x.id === b.dataset.bm)));
    sh.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { removeBookmarks([b.dataset.del]); renderToc(sh, 'bookmarks'); });
    if (tab === 'contents') sh.querySelector('.toc-row.cur')?.scrollIntoView({ block: 'center' });
  }

  // ---------- bookmarks ----------
  const engineApi = () => (R.ready && R.frame?.contentWindow?.BookNest) || null;
  function chapterTitle(i) {
    let t = null;
    for (const e of R.book?.toc || []) if (e.index <= i) t = e.title;
    return t || (R.book?.spine?.length > 1 ? `Section ${i + 1}` : record.title);
  }
  function whereLabel(b) {
    if (isPDF) return `Page ${b.page + 1}`;
    return `${chapterTitle(b.chapter)} · ${Math.round((b.fraction || 0) * 100)}%`;
  }
  function sortedBookmarks() {
    return R.bookmarks.slice().sort((a, b) => isPDF ? a.page - b.page : (a.chapter - b.chapter) || (a.offset - b.offset));
  }
  function bookmarksOnScreen() {
    if (isPDF) { const shown = R.pdf ? pdfGroup(R.pdfPage) : []; return R.bookmarks.filter(b => shown.includes(b.page)); }
    const api = engineApi();
    if (!api) return [];
    return R.bookmarks.filter(b => b.chapter === R.chapter && api.isVisible(b.offset));
  }
  function updateMarkState() {
    if (R.closed) return;
    const on = bookmarksOnScreen().length > 0;
    const btn = $('rMark');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Remove bookmark from this page' : 'Bookmark this page');
    btn.innerHTML = on ? ICON.markOn : ICON.mark;
    $('rRibbon').hidden = !on;
  }
  async function saveBookmarks() {
    await db.put('bookmarks', { bookId: record.id, items: R.bookmarks }).catch(() => {});
  }
  function removeBookmarks(ids) {
    R.bookmarks = R.bookmarks.filter(b => !ids.includes(b.id));
    saveBookmarks();
    updateMarkState();
  }
  function toggleBookmark() {
    const here = bookmarksOnScreen();
    if (here.length) { removeBookmarks(here.map(b => b.id)); toast('Bookmark removed', 1600); return; }
    const api = engineApi();
    const offset = isPDF ? 0 : (api ? api.offset() : R.offset);
    R.bookmarks.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
      chapter: isPDF ? 0 : R.chapter, offset, page: isPDF ? R.pdfPage : 0, fraction: R.overall,
      label: isPDF ? '' : (api ? api.snippet(offset, 90) : ''), created: Date.now(),
    });
    saveBookmarks();
    updateMarkState();
    toast('Page bookmarked', 1600);
  }
  function goBookmark(b) {
    if (!b) return;
    closeSheet(); hideChrome();
    if (isPDF) pdfGo(b.page);
    else loadChapter(b.chapter, { kind: 'offset', value: b.offset });
  }

  // ---------- find ----------
  async function sectionText(i) {
    if (R.texts.has(i)) return R.texts.get(i);
    let t = '';
    if (isPDF) {
      const page = await R.pdf.getPage(i + 1);
      t = (await page.getTextContent()).items.map(x => x.str).join(' ');
    } else {
      t = await R.book.chapterText(i);
    }
    R.texts.set(i, t);
    return t;
  }
  async function runSearch(q) {
    const token = ++R.search.token;
    R.search = { q, results: [], done: false, token };
    renderResults();
    if (q.length < 2) { R.search.done = true; renderResults(); return; }
    const needle = q.toLowerCase(), count = isPDF ? R.pdf.numPages : R.book.spine.length;
    for (let i = 0; i < count; i++) {
      const text = await sectionText(i);
      if (token !== R.search.token) return;   // a newer search started
      const lower = text.toLowerCase();
      let at = -1, nth = 0;
      while ((at = lower.indexOf(needle, at + 1)) >= 0 && R.search.results.length < 500) {
        const from = Math.max(0, at - 40), to = Math.min(text.length, at + needle.length + 70);
        R.search.results.push({ section: i, nth: nth++,
          before: (from > 0 ? '…' : '') + text.slice(from, at).replace(/\s+/g, ' ').trimStart(),
          match: text.slice(at, at + needle.length),
          after: text.slice(at + needle.length, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '') });
      }
      if (i % 5 === 4) renderResults();
    }
    R.search.done = true;
    renderResults();
  }
  function renderSearch(sh) {
    sh.innerHTML = `<div class="grab"></div><div class="sh"><b>Find in Book</b><button id="shDone">Done</button></div>
      <label class="search findfield">${ICON.search}<input id="findInput" type="search" placeholder="Search this book" value="${esc(R.search.q)}" aria-label="Search this book" autocomplete="off"></label>
      <div id="findResults"></div>`;
    $('shDone').onclick = closeSheet;
    const input = $('findInput');
    let t;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => runSearch(input.value.trim()), 280); };
    input.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(t); input.blur(); runSearch(input.value.trim()); } };
    renderResults();
    setTimeout(() => input.focus(), 50);
  }
  function renderResults() {
    const box = $('findResults');
    if (!box) return;
    const { q, results, done } = R.search;
    if (!q || q.length < 2) { box.innerHTML = '<p class="hint">Type at least two letters.</p>'; return; }
    const head = done ? (results.length ? `${results.length}${results.length >= 500 ? '+' : ''} ${results.length === 1 ? 'match' : 'matches'}` : `No matches for “${esc(q)}”.`) : `Searching… ${results.length} so far`;
    let last = -1;
    box.innerHTML = `<p class="hint find-count">${head}</p><div class="find-list">` + results.map((r, i) => {
      const heading = r.section !== last ? `<div class="find-sec">${esc(isPDF ? `Page ${r.section + 1}` : chapterTitle(r.section))}</div>` : '';
      last = r.section;
      return heading + `<button class="find-row" data-r="${i}">${esc(r.before)}<mark>${esc(r.match)}</mark>${esc(r.after)}</button>`;
    }).join('') + '</div>';
    box.querySelectorAll('[data-r]').forEach(b => b.onclick = () => goResult(+b.dataset.r));
  }
  function goResult(i) {
    const r = R.search.results[i];
    if (!r) return;
    R.find = { q: R.search.q, index: i };
    closeSheet(); hideChrome();
    if (isPDF) pdfGo(r.section);
    else loadChapter(r.section, { kind: 'find', value: R.find.q, nth: r.nth });
    showFindBar();
  }
  function showFindBar() {
    const n = R.search.results.length;
    $('rFindBar').hidden = !R.find;
    if (!R.find) return;
    $('fInfo').textContent = `${R.find.index + 1} of ${n}${n >= 500 ? '+' : ''} · “${R.find.q}”`;
    $('fPrev').disabled = R.find.index <= 0;
    $('fNext').disabled = R.find.index >= n - 1;
  }
  function closeFind() {
    R.find = null;
    $('rFindBar').hidden = true;
    engineApi()?.clearFind();
  }

  function renderSettings(sh) {
    const st = settings;
    const sw = (key, t) => `<button class="sw" data-theme-k="${key}" aria-pressed="${st.theme === key}"><span class="dot" style="${key === 'system' ? 'background:linear-gradient(135deg,#fff 50%,#1c1c1e 50%);color:#888' : `background:${t.bg};color:${t.fg}`}">Aa</span>${key === 'system' ? 'Auto' : t.label}</button>`;
    const text = isPDF ? '' : `
      <div class="lbl">Font</div>
      <div class="fonts">${FONTS.map(f => `<button class="chip" data-font="${f[0]}" aria-pressed="${st.font === f[0]}"${f[2] ? ` style="font-family:${f[2].replace(/"/g, '&quot;')}"` : ''}>${f[1]}</button>`).join('')}</div>
      <div class="lbl">Text</div>
      <div class="ctl"><span class="grow">Size</span><span class="v">${st.size} pt</span><span class="stepper"><button id="szDown" aria-label="Smaller text">A−</button><button id="szUp" aria-label="Larger text">A+</button></span></div>
      <div class="ctl"><label for="lnR">Spacing</label><input type="range" id="lnR" min="1.1" max="2.2" step="0.05" value="${st.line}"><span class="v">${st.line.toFixed(2)}</span></div>
      <div class="ctl"><label for="mgR">Margins</label><input type="range" id="mgR" min="8" max="64" step="2" value="${st.margin}"><span class="v">${st.margin} pt</span></div>
      <div class="ctl"><span class="grow">Paragraph spacing</span></div>
      <div class="segm" role="group" aria-label="Paragraph spacing">${PARA.map(([v, l]) => `<button data-para="${v}" aria-pressed="${String(st.paraSpacing ?? 'orig') === String(v)}">${l}</button>`).join('')}</div>
      <div class="ctl"><span class="grow">Justify text</span><button class="toggle" role="switch" id="jsT" aria-checked="${st.justify}" aria-label="Justify text"></button></div>
      <div class="ctl"><span class="grow">Hyphenation</span><button class="toggle" role="switch" id="hyT" aria-checked="${st.hyphenate}" aria-label="Hyphenation"></button></div>
      <div class="lbl">Layout</div>
      <div class="segm"><button data-mode="paged" aria-pressed="${st.mode === 'paged'}">Pages</button><button data-mode="scroll" aria-pressed="${st.mode === 'scroll'}">Scroll</button></div>`;
    sh.innerHTML = `<div class="grab"></div><div class="sh"><b>Appearance</b><button id="shDone">Done</button></div>
      <div class="lbl">Theme</div><div class="swatches">${sw('system')}${Object.entries(THEMES).map(([k, t]) => sw(k, t)).join('')}</div>
      ${text}
      <div class="lbl">Page Turn</div>
      <div class="ctl"><span class="grow">Page curl animation</span><button class="toggle" role="switch" id="anT" aria-checked="${st.animate !== false}" aria-label="Page curl animation"></button></div>
      <div class="lbl">iPhone Duo</div>
      <div class="ctl"><span class="grow">Two-page spread when unfolded</span><button class="toggle" role="switch" id="spT" aria-checked="${st.spread}" aria-label="Two-page spread when unfolded"></button></div>
      ${st.spread && !isPDF ? `<div class="ctl"><label for="guR">Center gutter</label><input type="range" id="guR" min="24" max="140" step="4" value="${st.gutter}"><span class="v">${st.gutter} pt</span></div>` : ''}
      <p class="hint">When the phone is unfolded (or turned sideways), pages show side by side like a printed book. The gutter keeps text away from the fold.</p>`;
    const set = (k, v, rerender) => {
      st[k] = v; saveSettings(st); applyChromeTheme();
      if (isPDF) renderPDF(); else applyEngine();
      updateLocation();
      if (rerender) renderSettings(sh);
    };
    $('shDone').onclick = closeSheet;
    sh.querySelectorAll('[data-theme-k]').forEach(b => b.onclick = () => set('theme', b.dataset.themeK, true));
    sh.querySelectorAll('[data-font]').forEach(b => b.onclick = () => set('font', b.dataset.font, true));
    sh.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => set('mode', b.dataset.mode, true));
    sh.querySelectorAll('[data-para]').forEach(b => b.onclick = () => set('paraSpacing', b.dataset.para === 'orig' ? null : +b.dataset.para, true));
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('szDown', () => set('size', Math.max(12, st.size - 1), true));
    on('szUp', () => set('size', Math.min(40, st.size + 1), true));
    on('jsT', () => set('justify', !st.justify, true));
    on('hyT', () => set('hyphenate', !st.hyphenate, true));
    on('spT', () => set('spread', !st.spread, true));
    on('anT', () => set('animate', st.animate === false, true));
    const live = (id, k, fmt) => {
      const r = $(id); if (!r) return;
      let t;
      r.oninput = () => { r.nextElementSibling.textContent = fmt(+r.value); st[k] = +r.value; clearTimeout(t); t = setTimeout(() => set(k, +r.value, false), 80); };
    };
    live('lnR', 'line', v => v.toFixed(2));
    live('mgR', 'margin', v => v + ' pt');
    live('guR', 'gutter', v => v + ' pt');
  }

  // ---------- wiring ----------
  function close() {
    if (R.closed) return;
    persist(true);
    R.closed = true;
    clearTimeout(R.hideTimer);
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
    window.__booknest = null;
    R.book?.close?.();
    R.pdf?.destroy?.();
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('reading');

    onClose?.();
  }
  const onVis = () => { if (document.visibilityState === 'hidden') persist(true); };

  $('rClose').onclick = close;
  $('rToc').onclick = () => openSheet('toc');
  $('rMark').onclick = toggleBookmark;
  $('rFind').onclick = () => openSheet('search');
  $('fPrev').onclick = () => R.find && goResult(R.find.index - 1);
  $('fNext').onclick = () => R.find && goResult(R.find.index + 1);
  $('fDone').onclick = closeFind;
  $('rAa').onclick = () => openSheet('settings');
  $('rBackdrop').onclick = closeSheet;
  const slider = $('rSlider');
  slider.oninput = () => { $('rLoc').textContent = Math.round(slider.value / 10) + '%'; };
  slider.onchange = () => seek(slider.value / 1000);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVis);

  // PDF taps/swipes (the iframe engine reports its own)
  let px = null, py = null, pt = 0;
  stage.addEventListener('pointerdown', e => { if (isPDF) { px = e.clientX; py = e.clientY; pt = Date.now(); } });
  stage.addEventListener('pointerup', e => {
    if (!isPDF || px == null) return;
    const dx = e.clientX - px, dy = e.clientY - py;
    px = null;
    const r = stage.getBoundingClientRect();
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? next() : prev(); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - pt < 450) handleTap((e.clientX - r.left) / r.width);
  });

  // Folding/unfolding (or rotating) resizes the stage: re-layout and keep the same spot.
  let lastSpread = null, roTimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(roTimer);
    roTimer = setTimeout(() => {
      if (R.closed) return;
      if (isPDF) { if (R.pdf) renderPDF(); }
      else applyEngine();
      lastSpread = spreadNow();
    }, 120);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (R.closed || settings.theme !== 'system') return;
    applyChromeTheme(); isPDF ? renderPDF() : applyEngine();
  });

  // ---------- open ----------
  try {
    const blob = await db.get('files', record.id);
    if (!blob) throw new Error('The file for this book is missing. Try adding it again.');
    if (isPDF) {
      const pdfjs = await loadPdfJs();
      R.pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      R.book = { toc: [] };
      try {
        const outline = await R.pdf.getOutline();
        const walk = async (items, level) => {
          for (const it of items || []) {
            try {
              const dest = typeof it.dest === 'string' ? await R.pdf.getDestination(it.dest) : it.dest;
              if (dest && dest[0]) R.book.toc.push({ title: it.title, level, index: await R.pdf.getPageIndex(dest[0]) });
            } catch (e) { /* skip broken entry */ }
            await walk(it.items, level + 1);
          }
        };
        await walk(outline, 0);
      } catch (e) { /* no outline */ }
      pdfGo(Math.min(R.pdfPage, R.pdf.numPages - 1));
    } else {
      R.book = record.format === 'epub' ? await openEpub(blob) : openText(await decodeText(blob), record.format === 'md');
      cumulative = []; total = 0;
      for (const s of R.book.spine) { cumulative.push(total); total += s.size; }
      total = Math.max(1, total);
      R.chapter = Math.min(R.chapter, R.book.spine.length - 1);
      $('rGutter').hidden = !spreadNow();
      await loadChapter(R.chapter, { kind: 'offset', value: R.offset });
    }
    R.bookmarks = ((await db.get('bookmarks', record.id)) || {}).items || [];
    updateMarkState();
    ro.observe(stage);
    updateLocation();
    scheduleHide();
  } catch (e) {
    stage.innerHTML = `<div class="r-error"><b>Couldn't open this book</b><p>${esc(e.message || String(e))}</p><button class="btn" id="rErrClose">Close</button></div>`;
    $('rErrClose').onclick = close;
  }

  return { close };
}
