// In-page reader engine, injected into each chapter's iframe.
// Paged mode lays the chapter out in CSS columns (one per page, two side by side when the
// screen is wide, e.g. an unfolded iPhone Duo) and moves between pages with a transform.
// The position is a character offset of the first visible character, which doesn't depend
// on layout, so changing fonts or folding/unfolding keeps the same passage on screen.
import { bookFlip } from './flip.js';

function engine(flip) {
  if (window.BookNest) return;
  var S = {}; window.BookNest = S;
  var cfg = null, page = 0, pageCount = 1, offset = 0, styleEl = null, bound = false, scrollTimer = null, flipping = null;

  function post(m) { try { window.parent.__booknest(m); } catch (e) {} }
  function paged() { return cfg.mode !== 'scroll'; }

  function metrics() {
    var vw = window.innerWidth, vh = window.innerHeight, m = cfg.margin, cols = 1;
    if (paged() && cfg.spread) { cols = 2; m = Math.max(m, cfg.gutter / 2); }
    var colW = cols === 2 ? vw / 2 - 2 * m : vw - 2 * m;
    return { vw: vw, vh: vh, m: m, cols: cols, colW: colW, gap: 2 * m, mv: cfg.marginV };
  }

  function buildCSS() {
    var k = metrics(), c = [], imp = '!important', hy = cfg.hyphenate ? 'auto' : 'manual';
    c.push('html{-webkit-text-size-adjust:100%' + imp + ';background:' + cfg.bg + imp + ';}');
    c.push('html,body{margin:0' + imp + ';}');
    c.push('body{background:' + cfg.bg + imp + ';color:' + cfg.fg + imp + ';font-size:' + cfg.fontSize + 'px' + imp +
           ';overflow-wrap:break-word;-webkit-touch-callout:none;}');
    if (cfg.font) c.push('body,body *:not(pre):not(code):not(kbd):not(samp){font-family:' + cfg.font + imp + ';}');
    c.push('body *{color:inherit' + imp + ';background-color:transparent' + imp + ';}');
    c.push('a,a *{color:' + cfg.link + imp + ';}');
    c.push('p,li,blockquote,dd,dt,div{line-height:' + cfg.lineHeight + imp + ';}');
    c.push('p{text-align:' + (cfg.justify ? 'justify' : 'start') + imp + ';-webkit-hyphens:' + hy + imp + ';hyphens:' + hy + imp + ';}');
    c.push('img,svg,video{max-width:100%' + imp + ';height:auto;}');
    c.push('img,figure,table,pre{-webkit-column-break-inside:avoid;break-inside:avoid;}');
    c.push('pre{white-space:pre-wrap' + imp + ';}');
    c.push('::selection{background:' + cfg.link + '55;}');
    if (paged()) {
      c.push('img,svg,video{max-height:' + Math.max(50, k.vh - 2 * k.mv - 8) + 'px' + imp + ';object-fit:contain;}');
      c.push('html{height:100%' + imp + ';overflow:hidden' + imp + ';touch-action:none;}');
      c.push('body{box-sizing:border-box' + imp + ';width:' + k.vw + 'px' + imp + ';height:' + k.vh + 'px' + imp +
             ';max-width:none' + imp + ';padding:' + k.mv + 'px ' + k.m + 'px' + imp +
             ';-webkit-column-width:' + (k.colW - 1) + 'px' + imp + ';column-width:' + (k.colW - 1) + 'px' + imp +
             ';-webkit-column-count:' + k.cols + imp + ';column-count:' + k.cols + imp +
             ';-webkit-column-gap:' + k.gap + 'px' + imp + ';column-gap:' + k.gap + 'px' + imp +
             ';column-fill:auto' + imp + ';}');
    } else {
      c.push('html{overflow-y:auto' + imp + ';}');
      c.push('body{box-sizing:border-box' + imp + ';max-width:none' + imp + ';padding:' + (k.mv + 24) + 'px ' + k.m + 'px ' + (k.mv + 80) + 'px' + imp + ';}');
    }
    return c.join('\n');
  }

  function computePages() {
    if (!paged()) { pageCount = 1; return; }
    var k = metrics(), r = document.createRange(), maxRight = 0;
    r.selectNodeContents(document.body);
    var rects = r.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      if (rects[i].width > 0 || rects[i].height > 0) maxRight = Math.max(maxRight, rects[i].right + page * k.vw);
    }
    pageCount = Math.max(1, Math.floor((maxRight - 1) / k.vw) + 1);
  }

  function setPage(p) {
    var k = metrics();
    page = Math.max(0, Math.min(p, pageCount - 1));
    document.body.style.transform = 'translateX(' + (-page * k.vw) + 'px)';
  }

  function layout() {
    if (!styleEl) { styleEl = document.createElement('style'); (document.head || document.documentElement).appendChild(styleEl); }
    styleEl.textContent = buildCSS();
    page = 0;
    document.body.style.transform = paged() ? 'translateX(0px)' : 'none';
    void document.body.offsetHeight;
    computePages();
  }

  function textWalker() { return document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null); }
  function offsetOfNode(node, off) {
    var w = textWalker(), n, total = 0;
    while ((n = w.nextNode())) { if (n === node) return total + off; total += n.nodeValue.length; }
    return total;
  }
  function rangeAtOffset(target) {
    var w = textWalker(), n, total = 0;
    while ((n = w.nextNode())) {
      var len = n.nodeValue.length;
      if (len > 0 && total + len > target) {
        var r = document.createRange(), o = Math.max(0, target - total);
        r.setStart(n, o); r.setEnd(n, Math.min(len, o + 1));
        return r;
      }
      total += len;
    }
    return null;
  }
  function rectOf(r) {
    var rects = r.getClientRects();
    for (var i = 0; i < rects.length; i++) if (rects[i].width || rects[i].height) return rects[i];
    var p = r.startContainer.parentElement;
    return p ? p.getBoundingClientRect() : null;
  }
  function caretAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      var r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r;
    }
    return null;
  }
  function visibleNow(rect, k) {
    if (!rect) return false;
    return paged() ? (rect.right > 0 && rect.left < k.vw) : (rect.bottom > 0 && rect.top < k.vh);
  }
  function firstVisibleOffset() {
    var k = metrics();
    var xs = paged() ? [k.m + 2, k.m + k.colW / 3] : [k.m + 2, k.vw / 3];
    var y0 = paged() ? k.mv + 2 : 4, y1 = paged() ? k.vh - k.mv : k.vh;
    for (var y = y0; y < y1; y += 8) {
      for (var i = 0; i < xs.length; i++) {
        var r = caretAt(xs[i], y);
        if (r && r.startContainer && r.startContainer.nodeType === 3 && r.startContainer.nodeValue.trim().length) {
          var cand = offsetOfNode(r.startContainer, r.startOffset);
          var check = rangeAtOffset(cand);
          if (check && visibleNow(rectOf(check), k)) return cand;
        }
      }
    }
    var w = textWalker(), n, total = 0;
    while ((n = w.nextNode())) {
      if (n.nodeValue.trim().length) {
        var rr = document.createRange(); rr.selectNodeContents(n);
        var rects = rr.getClientRects();
        for (var j = 0; j < rects.length; j++) if (visibleNow(rects[j], k) && rects[j].width > 0) return total;
      }
      total += n.nodeValue.length;
    }
    return offset;
  }

  function pageForRect(rect) { var k = metrics(); return Math.floor((rect.left + page * k.vw + 1) / k.vw); }
  function scrollMax() { return Math.max(0, document.documentElement.scrollHeight - window.innerHeight); }

  function report(recompute) {
    if (recompute) offset = firstVisibleOffset();
    var frac;
    if (paged()) frac = pageCount > 1 ? page / (pageCount - 1) : 0;
    else { var mx = scrollMax(); frac = mx > 0 ? Math.min(1, document.documentElement.scrollTop / mx) : 0; }
    post({ type: 'position', offset: offset, page: page, pageCount: pageCount, fraction: frac });
  }

  function goToOffset(o) {
    var r = rangeAtOffset(o), rect = r ? rectOf(r) : null;
    if (!rect) { if (paged()) setPage(o > 0 ? pageCount - 1 : 0); else document.documentElement.scrollTop = 0; report(true); return; }
    if (paged()) setPage(pageForRect(rect));
    else document.documentElement.scrollTop = Math.max(0, rect.top + document.documentElement.scrollTop - metrics().mv - 24);
    offset = o;
    report(false);
  }

  function go(t) {
    t = t || { kind: 'start' };
    var de = document.documentElement;
    if (t.kind === 'offset') { goToOffset(t.value); return; }
    if (t.kind === 'end') {
      if (paged()) setPage(pageCount - 1); else de.scrollTop = scrollMax();
    } else if (t.kind === 'fraction') {
      if (paged()) setPage(Math.round(t.value * (pageCount - 1))); else de.scrollTop = t.value * scrollMax();
    } else if (t.kind === 'anchor') {
      var e = document.getElementById(t.value) || document.getElementsByName(t.value)[0];
      if (e) {
        var rect = e.getBoundingClientRect();
        if (paged()) setPage(pageForRect(rect)); else de.scrollTop = rect.top + de.scrollTop - 24;
      }
    } else {
      if (paged()) setPage(0); else de.scrollTop = 0;
    }
    report(true);
  }

  function relayout() { var keep = offset; layout(); goToOffset(keep); }

  function bind() {
    if (bound) return; bound = true;
    var sx = 0, sy = 0, st = 0, noDrag = false;
    document.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary) return;
      sx = e.clientX; sy = e.clientY; st = Date.now(); noDrag = false;
    }, { passive: true });
    document.addEventListener('pointermove', function (e) {
      if (!st || !e.isPrimary || !cfg || !paged()) return;
      if (drag) { dragMove(e.clientX, e.clientY); return; }
      if (noDrag) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      var sel = window.getSelection();
      var dir = dx < 0 ? 1 : -1;
      // No page to drag to within this chapter (or animation off): let the swipe handle it on release.
      if ((sel && sel.toString().length) || !canAnimate() || (dir > 0 ? page >= pageCount - 1 : page <= 0)) { noDrag = true; return; }
      dragStart(dir, sx, sy);
      dragMove(e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener('pointercancel', function () { if (drag) dragEnd(true); st = 0; });
    document.addEventListener('pointerup', function (e) {
      if (drag && e.isPrimary) { dragEnd(false); st = 0; return; }
      if (!st || !e.isPrimary) return;
      var dx = e.clientX - sx, dy = e.clientY - sy, dt = Date.now() - st; st = 0;
      var sel = window.getSelection();
      if (sel && sel.toString().length) return;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) {
        post({ type: 'swipe', dir: dx < 0 ? 'left' : 'right' });
        return;
      }
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || dt > 450) return;
      var target = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
      if (target && target.closest && target.closest('a[href]')) return;
      post({ type: 'tap', x: e.clientX / window.innerWidth });
    }, { passive: true });
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      e.preventDefault();
      post({ type: 'link', href: a.getAttribute('href') });
    }, true);
    document.addEventListener('keydown', function (e) { post({ type: 'key', key: e.key }); });
    window.addEventListener('scroll', function () {
      if (!cfg || paged()) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () { report(true); }, 150);
    }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (cfg) relayout(); });
  }

  // ---- page curl ----
  function reduceMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function canAnimate() { return cfg.animate && !reduceMotion() && !!flip; }
  function view(p, k) {
    return function () {
      var b = document.body.cloneNode(true);   // a <body> copy, so the book's own body styles still apply
      b.removeAttribute('id');
      b.style.transform = 'translateX(' + (-p * k.vw) + 'px)';
      return b;
    };
  }
  function curlOptions(from, to, dir, k) {
    return { host: document.documentElement, position: 'fixed', W: k.vw, H: k.vh, spread: k.cols === 2,
             dir: dir, from: view(from, k), to: view(to, k), bg: cfg.bg, dark: !!cfg.dark };
  }

  // Moves to another page, curling it over when animation is switched on.
  function turn(to, dir) {
    if (flipping) { flipping.finish(); flipping = null; }
    var from = page;
    setPage(to);
    if (page === from || !canAnimate()) { report(true); return; }
    var opts = curlOptions(from, page, dir, metrics());
    opts.duration = opts.spread ? 620 : 540;
    var f = flip(opts);
    flipping = f;
    f.done.then(function () { if (flipping === f) flipping = null; report(true); });
  }

  // Dragging a page: the corner follows the finger; letting go finishes or cancels the turn.
  var drag = null;
  function dragStart(dir, x, y) {
    if (flipping) { flipping.finish(); flipping = null; }
    var k = metrics(), from = page;
    setPage(page + dir);
    var opts = curlOptions(from, page, dir, k);
    opts.manual = true;
    opts.top = y < k.vh * 0.4;
    var ctrl = flip(opts);
    drag = { ctrl: ctrl, from: from, dir: dir, x0: x, y0: y, p0: ctrl.startPoint(), lastX: x, lastT: Date.now(), vx: 0 };
  }
  function dragMove(x, y) {
    var g = drag;
    g.ctrl.setPoint(g.p0[0] + (x - g.x0) * 1.35, g.p0[1] + (y - g.y0) * 0.7);
    var now = Date.now(), dt = Math.max(1, now - g.lastT);
    g.vx = 0.6 * g.vx + 0.4 * ((x - g.lastX) / dt);
    g.lastX = x; g.lastT = now;
  }
  function dragEnd(cancelled) {
    var g = drag; drag = null;
    var t = g.ctrl.progress(), commit;
    if (cancelled) commit = false;
    else if (g.dir > 0) commit = g.vx < -0.3 || (t > 0.22 && g.vx < 0.3);
    else commit = g.vx > 0.3 || (t < 0.78 && g.vx > -0.3);
    var target = (g.dir > 0) === commit ? 1 : 0;
    var settle = function () { g.ctrl.destroy(); if (!commit) setPage(g.from); };
    var f = { finish: settle };
    flipping = f;
    g.ctrl.play(target, 160 + 300 * Math.abs(target - t), false).then(function () {
      settle();
      if (flipping === f) flipping = null;
      report(true);
    });
  }

  S.setup = function (config, target) { cfg = config; layout(); bind(); go(target); return true; };
  S.apply = function (config) { if (flipping) { flipping.finish(); flipping = null; } cfg = config; relayout(); return true; };
  S.go = function (t) { go(t); return true; };
  S.next = function () {
    if (paged()) { if (page >= pageCount - 1) return false; turn(page + 1, 1); return true; }
    var de = document.documentElement;
    if (de.scrollTop >= scrollMax() - 2) return false;
    de.scrollTop += window.innerHeight - 60; return true;
  };
  S.prev = function () {
    if (paged()) { if (page <= 0) return false; turn(page - 1, -1); return true; }
    var de = document.documentElement;
    if (de.scrollTop <= 2) return false;
    de.scrollTop -= window.innerHeight - 60; return true;
  };
}

export const ENGINE_SOURCE = '(' + engine.toString() + ')(' + bookFlip.toString() + ');';
