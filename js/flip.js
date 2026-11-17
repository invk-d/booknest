// Page-turn animation, shared by the text reader (inside the chapter iframe) and the PDF reader.
//
// Two-page spread: the turning page hinges on the middle line between the two pages, like
// a printed book. Going forward, the right-hand page lifts and swings over to the left,
// showing the next spread's left page on its back. Going back is the mirror image.
// Single page: the page hinges on its left edge and swings away (or swings back in).
//
// Options:
//   host      element the overlay is added to
//   position  'fixed' (iframe) or 'absolute' (inside a positioned host)
//   W, H      size of the visible area in px
//   spread    true for two pages side by side
//   dir       1 = forward, -1 = back
//   from, to  functions returning a fresh full-size W×H view of the old / new page(s)
//   bg        page background color
// Returns { done: Promise, finish() }. finish() jumps to the end (e.g. on a quick second tap).
function bookFlip(o) {
  var d = o.host.ownerDocument, W = o.W, H = o.H, half = o.spread ? W / 2 : W, fwd = o.dir > 0;
  var dur = o.duration || 520;

  var root = d.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:' + o.position + ';left:0;top:0;width:' + W + 'px;height:' + H + 'px;' +
    'pointer-events:none;z-index:2147483646;overflow:hidden;perspective:' + Math.round(W * 2.4) + 'px;';

  function box(x, w) {
    var b = d.createElement('div');
    b.style.cssText = 'position:absolute;top:0;left:' + x + 'px;width:' + w + 'px;height:' + H + 'px;overflow:hidden;';
    return b;
  }
  // A window onto [x, x+w) of a full-size view.
  function windowOf(node, x, w, at) {
    var b = box(at || 0, w);
    b.style.background = o.bg;   // pages must be opaque, or the page underneath shows through
    node.style.position = 'absolute';
    node.style.top = '0px';
    node.style.left = (-x) + 'px';
    node.style.width = W + 'px';
    node.style.height = H + 'px';
    node.style.margin = '0';
    b.appendChild(node);
    return b;
  }
  function blank() { var b = box(0, half); b.style.background = o.bg; return b; }

  var staticPart = null, front, back, leafX, origin, fromDeg, toDeg, hingeOnLeft;
  if (o.spread) {
    if (fwd) {          // right page turns over to the left
      staticPart = windowOf(o.from(), 0, half, 0);
      front = windowOf(o.from(), half, half);
      back = windowOf(o.to(), 0, half);
      leafX = half; origin = 'left center'; fromDeg = 0; toDeg = -180; hingeOnLeft = true;
    } else {            // left page turns back over to the right
      staticPart = windowOf(o.from(), half, half, half);
      front = windowOf(o.from(), 0, half);
      back = windowOf(o.to(), half, half);
      leafX = 0; origin = 'right center'; fromDeg = 0; toDeg = 180; hingeOnLeft = false;
    }
  } else {
    leafX = 0; origin = 'left center'; hingeOnLeft = true;
    if (fwd) {          // current page swings away to the left, revealing the next one
      front = windowOf(o.from(), 0, W);
      back = blank();
      fromDeg = 0; toDeg = -180;
    } else {            // previous page swings back in over the current one
      staticPart = windowOf(o.from(), 0, W, 0);
      front = windowOf(o.to(), 0, W);
      back = blank();
      fromDeg = -180; toDeg = 0;
    }
  }

  var leaf = box(leafX, half);
  leaf.style.overflow = 'visible';
  leaf.style.transformOrigin = origin;
  leaf.style.webkitTransformOrigin = origin;
  leaf.style.transformStyle = 'preserve-3d';
  leaf.style.webkitTransformStyle = 'preserve-3d';
  leaf.style.transform = 'rotateY(' + fromDeg + 'deg)';

  // Darkening that makes the lifted page look curved and lit from the front.
  var towardHinge = hingeOnLeft ? 'left' : 'right';
  function face(el, isBack) {
    el.style.backfaceVisibility = 'hidden';
    el.style.webkitBackfaceVisibility = 'hidden';
    el.style.boxShadow = '0 0 24px rgba(0,0,0,.22)';
    if (isBack) el.style.transform = 'rotateY(180deg)';
    var s = d.createElement('div');
    s.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;background:linear-gradient(to ' +
      (isBack ? (hingeOnLeft ? 'right' : 'left') : towardHinge) + ',rgba(0,0,0,.28),rgba(0,0,0,.04) 70%,rgba(0,0,0,0));';
    el.appendChild(s);
    return s;
  }
  var frontShade = face(front, false), backShade = face(back, true);
  leaf.appendChild(front);
  leaf.appendChild(back);

  // Shadow cast on the page underneath, strongest next to the hinge.
  var cast = box(o.spread ? (fwd ? half : 0) : 0, half);
  cast.style.background = 'linear-gradient(to ' + (o.spread ? (fwd ? 'right' : 'left') : 'right') + ',rgba(0,0,0,.18),rgba(0,0,0,0) 45%)';
  cast.style.opacity = '0';

  if (staticPart) root.appendChild(staticPart);
  root.appendChild(cast);
  root.appendChild(leaf);
  o.host.appendChild(root);

  var finished = false, resolveDone;
  var done = new Promise(function (r) { resolveDone = r; });
  function finish() {
    if (finished) return;
    finished = true;
    if (root.parentNode) root.parentNode.removeChild(root);
    resolveDone();
  }

  if (!leaf.animate) { finish(); return { done: done, finish: finish }; }
  var ease = 'cubic-bezier(.33,.08,.24,1)';
  var anim = leaf.animate([{ transform: 'rotateY(' + fromDeg + 'deg)' }, { transform: 'rotateY(' + toDeg + 'deg)' }],
                          { duration: dur, easing: ease, fill: 'forwards' });
  var lifting = fromDeg === 0;   // false when the page is swinging back in
  frontShade.animate([{ opacity: lifting ? 0 : 1 }, { opacity: lifting ? 1 : 0 }],
                     { duration: dur / 2, delay: lifting ? 0 : dur / 2, easing: 'ease-in-out', fill: 'both' });
  backShade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur / 2, delay: dur / 2, easing: 'ease-out', fill: 'both' });
  cast.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: dur, easing: 'ease-in-out', fill: 'both' });
  anim.onfinish = finish;
  anim.oncancel = finish;
  return { done: done, finish: finish };
}

export { bookFlip };
