// Small UI helpers shared by the library and the reader.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICON = {
  folder: '<svg class="folder-ic" width="22" height="18" viewBox="0 0 22 18" aria-hidden="true"><path d="M1 3.2C1 2 2 1 3.2 1h4.6c.6 0 1.1.2 1.5.6L10.9 3h7.9C20 3 21 4 21 5.2v9.6c0 1.2-1 2.2-2.2 2.2H3.2C2 17 1 16 1 14.8z" fill="currentColor"/></svg>',
  chev: '<svg class="chev" width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg width="11" height="18" viewBox="0 0 11 18" aria-hidden="true"><path d="M9 1.5L2 9l7 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sort: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="10"/><path d="M8 6.5v9M5.5 9 8 6.5 10.5 9M14 15.5v-9M11.5 13l2.5 2.5 2.5-2.5"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M11 3v16M3 11h16"/></svg>',
  search: '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="6.3" cy="6.3" r="5"/><path d="M10 10l3.8 3.8"/></svg>',
  disc: '<svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true"><path d="M1.5 1.5 6 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M2 2l12 12M14 2 2 14"/></svg>',
  list: '<svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 2h13M6 8h13M6 14h13"/><circle cx="1.6" cy="2" r=".6" fill="currentColor"/><circle cx="1.6" cy="8" r=".6" fill="currentColor"/><circle cx="1.6" cy="14" r=".6" fill="currentColor"/></svg>',
  aa: '<svg width="24" height="18" viewBox="0 0 24 18" fill="currentColor" aria-hidden="true"><text x="0" y="15" font-size="16" font-family="-apple-system,system-ui,sans-serif" font-weight="600">A</text><text x="12" y="15" font-size="11" font-family="-apple-system,system-ui,sans-serif" font-weight="600">A</text></svg>',
  bookmark: '<svg class="folder-ic" width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M6.2 2.2h9.6c.6 0 1 .4 1 1v14.4L11 13.8l-5.8 3.8V3.2c0-.6.4-1 1-1z"/></svg>',
  sun: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="4.2"/><path d="M11 1.8v2.4M11 17.8v2.4M1.8 11h2.4M17.8 11h2.4M4.5 4.5l1.7 1.7M15.8 15.8l1.7 1.7M4.5 17.5l1.7-1.7M15.8 6.2l1.7-1.7"/></svg>',
  moon: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M18.5 13.6A8 8 0 0 1 8.4 3.5a8 8 0 1 0 10.1 10.1z"/></svg>',
  autoTheme: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="8.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 2.4a8.6 8.6 0 0 1 0 17.2z" fill="currentColor"/></svg>',
  find: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6.2"/><path d="M13.2 13.2l5 5"/></svg>',
  mark: '<svg width="18" height="22" viewBox="0 0 18 22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h12v18l-6-4.4L3 20z"/></svg>',
  markOn: '<svg width="18" height="22" viewBox="0 0 18 22" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M3 2h12v18l-6-4.4L3 20z"/></svg>',
  chevL: '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M8 1.5 2 8l6 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevR: '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 1.5 8 8l-6 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  allBooks: '<svg class="folder-ic" width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="2.4" y="2.4" width="4.4" height="15.2" rx="1"/><rect x="8.6" y="2.4" width="4.4" height="15.2" rx="1"/><rect x="14.6" y="3.4" width="4.4" height="14.6" rx="1" transform="rotate(-12 16.8 10.7)"/></svg>',
  reading: '<svg class="folder-ic" width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.5C9 3 6 2.6 2 3v12.6c4-.4 7 0 9 1.6 2-1.6 5-2 9-1.6V3c-4-.4-7 0-9 1.5z"/><path d="M11 4.5v12.7"/></svg>',
  added: '<svg class="folder-ic" width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="10" r="8"/><path d="M11 5.6V10l3 2"/></svg>',
  unread: '<svg class="folder-ic" width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="11" cy="10" r="7.6"/></svg>',
  finished: '<svg class="folder-ic" width="22" height="20" viewBox="0 0 22 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="10" r="8"/><path d="M7.2 10.2l2.6 2.6 5-5.4"/></svg>',
  more: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.8"/><circle cx="10" cy="10" r="1.8"/><circle cx="16" cy="10" r="1.8"/></svg>',
  book: '<svg width="64" height="64" viewBox="0 0 1024 1024" aria-hidden="true"><path d="M150 330 L150 750 C290 716 420 724 512 792 C604 724 734 716 874 750 L874 330" fill="none" stroke="currentColor" stroke-width="40" stroke-linejoin="round" stroke-linecap="round"/><path d="M500 312 C420 262 300 252 196 282 L196 712 C300 684 420 692 500 746 Z M524 312 C604 262 724 252 828 282 L828 712 C724 684 604 692 524 746 Z" fill="currentColor"/></svg>',
};

/**
 * Sets the colour iOS uses for the status bar area. The tag is replaced rather than edited,
 * because some iOS versions only notice a new theme-color tag, not a changed value.
 */
export function setThemeColor(color) {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (rgb) color = '#' + rgb.slice(1, 4).map(n => (+n).toString(16).padStart(2, '0')).join('');
  const old = document.querySelectorAll('meta[name="theme-color"]');
  if (old.length === 1 && old[0].getAttribute('content') === color) return;
  old.forEach(m => m.remove());
  const m = document.createElement('meta');
  m.name = 'theme-color';
  m.content = color;
  document.head.appendChild(m);
}

export function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach(old => old.remove());   // one message at a time
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 300);
  return t;
}

/** iOS-style action sheet. items: [{ label, destructive?, action }] */
export function actionSheet(title, items) {
  const wrap = document.createElement('div');
  wrap.className = 'as-wrap';
  wrap.innerHTML = `<div class="as" tabindex="-1" role="menu">
      <div class="as-group">${title ? `<div class="as-title">${esc(title)}</div>` : ''}
      ${items.map((it, i) => `<button class="as-btn${it.destructive ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}</div>
      <div class="as-group"><button class="as-btn cancel">Cancel</button></div></div>`;
  document.querySelectorAll('.as-wrap').forEach(w => w.remove());
  const close = () => { wrap.classList.add('out'); wrap.style.pointerEvents = 'none'; setTimeout(() => wrap.remove(), 200); };
  wrap.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) { if (e.target === wrap) close(); return; }
    close();
    if (b.dataset.i != null) items[+b.dataset.i].action();
  });
  document.body.appendChild(wrap);
  // Focus the menu itself (for keyboard and screen readers) rather than its first option,
  // which made iOS draw a focus ring around that option.
  wrap.querySelector('.as').focus({ preventScroll: true });
}

/** Simple text-entry dialog. Resolves to the entered text, or null if cancelled. */
export function askText(title, initial = '', okLabel = 'Save') {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML = `<form class="dlg"><b>${esc(title)}</b>
      <input id="dlgInput" type="text" value="${esc(initial)}" autocomplete="off" aria-label="${esc(title)}">
      <div class="dlg-btns"><button type="button" class="dlg-cancel">Cancel</button><button type="submit" class="dlg-ok">${esc(okLabel)}</button></div></form>`;
    const input = wrap.querySelector('input');
    const done = v => { wrap.remove(); resolve(v); };
    wrap.querySelector('form').onsubmit = e => { e.preventDefault(); const v = input.value.trim(); done(v || null); };
    wrap.querySelector('.dlg-cancel').onclick = () => done(null);
    document.body.appendChild(wrap);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/** Confirmation dialog. Resolves true/false. */
/** onOk (optional) runs inside the tap on the OK button — needed for things like the Share sheet. */
export function confirmDialog(title, message, okLabel = 'Delete', danger = true, onOk = null) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg-wrap';
    wrap.innerHTML = `<div class="dlg" role="alertdialog" aria-label="${esc(title)}"><b>${esc(title)}</b><p>${esc(message)}</p>
      <div class="dlg-btns"><button class="dlg-cancel">Cancel</button><button class="dlg-ok${danger ? ' danger' : ''}">${esc(okLabel)}</button></div></div>`;
    const done = v => { wrap.remove(); resolve(v); };
    wrap.querySelector('.dlg-cancel').onclick = () => done(false);
    wrap.querySelector('.dlg-ok').onclick = () => {
      if (!onOk) { done(true); return; }
      const r = onOk();
      wrap.remove();
      Promise.resolve(r).then(v => resolve(v !== false), () => resolve(false));
    };
    document.body.appendChild(wrap);
    wrap.querySelector('.dlg-ok').focus();
  });
}

/** Calls onLong(e) after a press-and-hold (iOS has no right-click), or on right-click with a mouse. */
export function onLongPress(container, selector, onLong) {
  let timer = null, sx = 0, sy = 0, fired = false;
  container.addEventListener('pointerdown', e => {
    const el = e.target.closest(selector);
    if (!el || e.button !== 0) return;
    fired = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { fired = true; navigator.vibrate?.(10); onLong(el); }, 500);
  });
  const cancel = e => { if (timer && (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - sx, e.clientY - sy) > 8)) { clearTimeout(timer); timer = null; } };
  container.addEventListener('pointermove', cancel);
  container.addEventListener('pointerup', () => cancel());
  container.addEventListener('pointercancel', () => cancel());
  container.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  container.addEventListener('contextmenu', e => {
    const el = e.target.closest(selector);
    if (!el) return;
    e.preventDefault();
    if (!fired) onLong(el);
  });
}
