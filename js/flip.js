// Page-curl animation, shared by the text reader (inside the chapter iframe) and the PDF reader.
//
// The turning page peels from its outer corner along a straight fold line. The part past the
// fold is reflected over the page, showing the back of the sheet, and shading on both sides
// of the fold makes the bend look curved.
//
// Two-page spread: the page hinges on the middle line between the two pages, like a printed
// book. Going forward, the right page curls over to the left, and its back is the next
// spread's left page. Single page: the page hinges on its left edge and curls away.
//
// Options:
//   host      element the overlay is added to
//   position  'fixed' (iframe) or 'absolute' (inside a positioned host)
//   W, H      size of the visible area in px
//   spread    true for two pages side by side
//   dir       1 = forward, -1 = back
//   from, to  functions returning a fresh full-size W×H view of the old / new page(s)
//   bg        page background color;  dark: true for dark themes (softer highlights)
//   top       curl from the top corner instead of the bottom one
//   manual    true: return a controller to drive by finger instead of playing automatically
//
// Automatic (default): returns { done: Promise, finish() }.
// Manual: returns { setPoint(x, y), play(toT, ms) -> Promise, progress(), destroy(),
//                   startPoint(), cornerY, R, w, spine }.
function bookFlip(o) {
  var d = o.host.ownerDocument, W = o.W, H = o.H, spread = !!o.spread, fwd = o.dir > 0;
  // Geometry is always worked out as a forward turn of the earlier page(s) A onto the later B;
  // turning back just runs it in reverse.
  var A = fwd ? o.from : o.to, B = fwd ? o.to : o.from;
  var spine = spread ? W / 2 : 0, w = spread ? W / 2 : W, R = spine + w;
  var cornerTop = !!o.top, cy = cornerTop ? 0 : H;
  var hi = o.dark ? 0.07 : 0.3;   // strength of the highlight on the curl

  function el(css) { var e = d.createElement('div'); e.style.cssText = css; return e; }
  function layer() { return el('position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;'); }
  function full(node) {
    node.style.position = 'absolute'; node.style.left = '0px'; node.style.top = '0px';
    node.style.width = W + 'px'; node.style.height = H + 'px'; node.style.margin = '0';
    return node;
  }
  function clipTo(e, pts) {
    var v = pts.length ? 'polygon(' + pts.map(function (p) { return p[0].toFixed(1) + 'px ' + p[1].toFixed(1) + 'px'; }).join(',') + ')' : 'inset(100%)';
    e.style.clipPath = v; e.style.webkitClipPath = v;
  }

  var root = el('position:' + o.position + ';left:0;top:0;width:' + W + 'px;height:' + H + 'px;pointer-events:none;z-index:2147483646;overflow:hidden;');
  root.setAttribute('aria-hidden', 'true');

  // 1. what's underneath the turning page
  var under = layer(); under.style.background = o.bg; under.appendChild(full(B())); root.appendChild(under);
  // 2. shadow the curl casts on the page underneath
  var castWrap = layer(), cast = el('position:absolute;left:0;top:0;transform-origin:0 0;');
  castWrap.appendChild(cast); root.appendChild(castWrap);
  // 3. the other page of the spread, which stays put
  if (spread) {
    var still = layer(); still.style.background = o.bg; still.appendChild(full(A()));
    clipTo(still, [[0, 0], [spine, 0], [spine, H], [0, H]]);
    root.appendChild(still);
  }
  // 4. the part of the turning page that hasn't lifted yet
  var front = layer(); front.style.background = o.bg; front.appendChild(full(A())); root.appendChild(front);
  // 5. the back of the turning page, folded over
  var flapWrap = layer(), flap = layer();
  flap.style.transformOrigin = '0 0'; flap.style.webkitTransformOrigin = '0 0';
  flap.style.background = o.bg;
  if (spread) flap.appendChild(full(B()));      // its back is the next spread's left page
  else {                                          // single page: the back of the sheet, with the
    flap.style.left = (-W) + 'px';                // front's text faintly showing through (mirrored)
    // Seen from behind, each spot on the sheet shows its own front, mirrored.
    var ghost = layer();
    ghost.style.left = W + 'px';
    ghost.style.transformOrigin = '0 0'; ghost.style.webkitTransformOrigin = '0 0';
    ghost.style.transform = 'scaleX(-1)';
    ghost.style.opacity = o.dark ? '0.06' : '0.08';
    ghost.appendChild(full(A()));
    flap.appendChild(ghost);
  }
  var flapShade = el('position:absolute;left:0;top:0;transform-origin:0 0;');
  var edgeShade = el('position:absolute;left:0;top:0;transform-origin:0 0;');
  flapWrap.appendChild(flap); flapWrap.appendChild(flapShade);
  root.appendChild(flapWrap);
  // 6. soft shadow of the folded flap on the page beneath it
  var dropWrap = layer(); dropWrap.appendChild(edgeShade); root.insertBefore(dropWrap, flapWrap);

  o.host.appendChild(root);

  // Keep the half-plane (s·((p−m)·n) ≥ 0) of a polygon.
  function cut(poly, mx, my, nx, ny, s) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var da = s * ((a[0] - mx) * nx + (a[1] - my) * ny), db = s * ((b[0] - mx) * nx + (b[1] - my) * ny);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { var t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  // A strip lying along the fold, `thick` px deep on side s (+1 = toward the corner), gradient running outward.
  function strip(e, mx, my, fx, fy, nx, ny, s, thick, gradient) {
    var len = 2 * Math.hypot(W, H);
    e.style.width = len + 'px'; e.style.height = Math.max(1, thick) + 'px';
    e.style.background = gradient;
    e.style.transform = 'matrix(' + fx + ',' + fy + ',' + (s * nx) + ',' + (s * ny) + ',' + (mx - fx * len / 2) + ',' + (my - fy * len / 2) + ')';
  }

  var P = [R, cy];
  function render(px, py) {
    // The sheet can't tear away from the spine: keep the corner within reach of both spine ends.
    var sbx = spine, sby = cy, dx = px - sbx, dy = py - sby, dist = Math.hypot(dx, dy);
    if (dist > w) { px = sbx + dx * w / dist; py = sby + dy * w / dist; }
    var diag = Math.hypot(w, H), stx = spine, sty = H - cy;
    dx = px - stx; dy = py - sty; dist = Math.hypot(dx, dy);
    if (dist > diag) { px = stx + dx * diag / dist; py = sty + dy * diag / dist; }
    P = [px, py];

    var nx = R - px, ny = cy - py, len = Math.hypot(nx, ny);
    var leaf = [[spine, 0], [R, 0], [R, H], [spine, H]];
    if (len < 0.5) {
      clipTo(front, leaf); clipTo(flapWrap, []); clipTo(castWrap, []); clipTo(dropWrap, []);
      return;
    }
    nx /= len; ny /= len;
    var mx = (R + px) / 2, my = (cy + py) / 2;        // the fold goes through here
    var fx = -ny, fy = nx;                              // direction along the fold
    var keep = cut(leaf, mx, my, nx, ny, -1), lifted = cut(leaf, mx, my, nx, ny, 1);

    // Reflection across the fold: r = [[2fx²−1, 2fxfy],[2fxfy, 2fy²−1]]
    var r11 = 2 * fx * fx - 1, r12 = 2 * fx * fy, r22 = 2 * fy * fy - 1;
    function reflect(p) { var x = p[0] - mx, y = p[1] - my; return [mx + r11 * x + r12 * y, my + r12 * x + r22 * y]; }
    var flapPoly = lifted.map(reflect);

    clipTo(front, keep);
    clipTo(castWrap, lifted);
    clipTo(flapWrap, flapPoly);
    clipTo(dropWrap, keep);

    // The back of the sheet: mirror about the spine, then reflect across the fold.
    var a11 = -r11, a12 = r12, a21 = -r12, a22 = r22;
    var tx = r11 * 2 * spine + mx - (r11 * mx + r12 * my), ty = r12 * 2 * spine + my - (r12 * mx + r22 * my);
    var left = spread ? 0 : -W;
    var e = a11 * left + tx - left, f = a21 * left + ty;
    flap.style.transform = 'matrix(' + a11 + ',' + a21 + ',' + a12 + ',' + a22 + ',' + e + ',' + f + ')';

    var curl = Math.min(len * 0.45, w * 0.42) + 6;
    strip(flapShade, mx, my, fx, fy, nx, ny, -1, curl,
      'linear-gradient(to bottom,rgba(0,0,0,.22) 0%,rgba(255,255,255,' + hi + ') 16%,rgba(255,255,255,0) 42%,rgba(0,0,0,.05) 78%,rgba(0,0,0,.14) 100%)');
    strip(cast, mx, my, fx, fy, nx, ny, 1, Math.min(len * 0.35, 70) + 4,
      'linear-gradient(to bottom,rgba(0,0,0,.38),rgba(0,0,0,.12) 35%,rgba(0,0,0,0))');
    // shadow just beyond the flap's outer edge, on the page it lies over
    var reach = 0; for (var i = 0; i < flapPoly.length; i++) reach = Math.max(reach, -((flapPoly[i][0] - mx) * nx + (flapPoly[i][1] - my) * ny));
    strip(edgeShade, mx - nx * reach, my - ny * reach, fx, fy, nx, ny, -1, 22,
      'linear-gradient(to bottom,rgba(0,0,0,.16),rgba(0,0,0,0))');
  }

  function pathPoint(t) {   // automatic turns: the corner sweeps across with a slight lift
    var lift = H * 0.12 * Math.sin(Math.PI * t);
    return [R - t * 2 * w, cornerTop ? lift : H - lift];
  }
  var tNow = fwd ? 0 : 1;
  var p0 = pathPoint(tNow); render(p0[0], p0[1]);

  var raf = null, destroyed = false;
  function destroy() {
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    if (root.parentNode) root.parentNode.removeChild(root);
  }
  function progress() { return Math.min(1, Math.max(0, (R - P[0]) / (2 * w))); }
  function play(toT, ms, followPath) {
    return new Promise(function (resolve) {
      var fromT = followPath ? tNow : progress(), start = null, sp = P.slice(), ep = pathPoint(toT);
      function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
      function frame(ts) {
        if (destroyed) { resolve(); return; }
        if (start === null) start = ts;
        var k = Math.min(1, (ts - start) / ms), e = ease(k);
        if (followPath) { tNow = fromT + (toT - fromT) * e; var p = pathPoint(tNow); render(p[0], p[1]); }
        else render(sp[0] + (ep[0] - sp[0]) * e, sp[1] + (ep[1] - sp[1]) * e);
        if (k < 1) raf = requestAnimationFrame(frame); else { raf = null; resolve(); }
      }
      raf = requestAnimationFrame(frame);
    });
  }

  if (o.manual) {
    return {
      setPoint: function (x, y) { if (!destroyed) render(x, y); },
      play: play, progress: progress, destroy: destroy,
      startPoint: function () { return pathPoint(fwd ? 0 : 1); },
      cornerY: cy, R: R, w: w, spine: spine,
    };
  }

  var resolveDone, done = new Promise(function (r) { resolveDone = r; });
  function finish() { destroy(); resolveDone(); }
  play(fwd ? 1 : 0, o.duration || 520, true).then(finish);
  return { done: done, finish: finish };
}

export { bookFlip };
