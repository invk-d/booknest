// EPUB reading: package metadata, spine, table of contents, cover, and chapter documents
// with their images, stylesheets and fonts rewritten to blob: URLs.

const MIME = {
  xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html', css: 'text/css',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp3: 'audio/mpeg', mp4: 'video/mp4',
};
const ext = p => (p.split('.').pop() || '').toLowerCase();

const BLOCKS = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'tr', 'td', 'th',
                'dd', 'dt', 'figcaption', 'section', 'article', 'header', 'footer', 'br', 'hr'];
/** Text of a document body for searching: no scripts/styles, and a line break after each block. */
export function readableText(body) {
  for (const tag of ['script', 'style']) for (const el of Array.from(body.getElementsByTagNameNS('*', tag))) el.remove();
  for (const tag of BLOCKS) for (const el of Array.from(body.getElementsByTagNameNS('*', tag))) el.after('\n');
  return body.textContent || '';
}

export function normalize(path) {
  const out = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';

export function resolveHref(href, baseDir) {
  let h = href, fragment = null;
  const hash = h.indexOf('#');
  if (hash >= 0) { fragment = h.slice(hash + 1) || null; h = h.slice(0, hash); }
  try { h = decodeURIComponent(h); } catch (e) { /* keep as is */ }
  return { path: normalize(baseDir ? (h ? baseDir + '/' + h : baseDir) : h), fragment };
}

function parseXML(text) {
  let doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    doc = new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
}
const byTag = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
const first = (node, name) => node.getElementsByTagNameNS('*', name)[0] || null;
const attr = (el, name) => {
  if (!el) return null;
  if (el.hasAttribute(name)) return el.getAttribute(name);
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
};
const clean = s => (s || '').replace(/\s+/g, ' ').trim() || null;

export async function openEpub(blob) {
  const zip = await window.JSZip.loadAsync(blob);
  const fileAt = p => zip.file(p) || zip.file(decodeURI(p)) || null;
  const text = async p => { const f = fileAt(p); return f ? f.async('string') : null; };

  const container = await text('META-INF/container.xml');
  if (!container) throw new Error('This EPUB is missing META-INF/container.xml.');
  const opfPath = attr(first(parseXML(container), 'rootfile'), 'full-path');
  const opfText = opfPath && await text(opfPath);
  if (!opfText) throw new Error("This EPUB's package file couldn't be read.");
  const opf = parseXML(opfText);
  const opfDir = dirOf(opfPath);

  // Metadata
  const metadata = first(opf, 'metadata') || opf;
  const title = clean(first(metadata, 'title')?.textContent);
  const creators = byTag(metadata, 'creator');
  const creator = creators.find(c => { const r = attr(c, 'role'); return !r || r === 'aut'; }) || creators[0];
  const author = clean(creator?.textContent);
  let authorSort = clean(attr(creator, 'file-as'));
  if (!authorSort && creator?.id) {
    const refine = byTag(metadata, 'meta').find(m => attr(m, 'refines') === '#' + creator.id && attr(m, 'property') === 'file-as');
    authorSort = clean(refine?.textContent);
  }

  // Manifest
  const manifest = new Map();
  for (const item of byTag(first(opf, 'manifest') || opf, 'item')) {
    const id = attr(item, 'id'), href = attr(item, 'href');
    if (id && href) manifest.set(id, {
      path: resolveHref(href, opfDir).path,
      type: attr(item, 'media-type') || '',
      props: (attr(item, 'properties') || '').split(/\s+/),
    });
  }

  // Cover
  let coverPath = null;
  for (const it of manifest.values()) if (it.props.includes('cover-image')) coverPath = it.path;
  if (!coverPath) {
    const id = attr(byTag(metadata, 'meta').find(m => attr(m, 'name') === 'cover'), 'content');
    if (id && manifest.get(id)) coverPath = manifest.get(id).path;
  }
  if (!coverPath) {
    for (const [id, it] of manifest) if (id.toLowerCase().includes('cover') && it.type.startsWith('image/')) { coverPath = it.path; break; }
  }

  // Spine
  const spineEl = first(opf, 'spine');
  const spine = [];
  for (const ref of spineEl ? byTag(spineEl, 'itemref') : []) {
    const it = manifest.get(attr(ref, 'idref'));
    if (!it) continue;
    const f = fileAt(it.path);
    spine.push({ path: it.path, size: Math.max(1, f?._data?.uncompressedSize || 1) });
  }
  if (!spine.length) throw new Error('This EPUB has no readable chapters.');

  // Table of contents (EPUB 3 nav, else EPUB 2 NCX)
  let toc = [];
  const navItem = [...manifest.values()].find(it => it.props.includes('nav'));
  if (navItem) {
    const navText = await text(navItem.path);
    if (navText) {
      const doc = parseXML(navText);
      const navs = byTag(doc, 'nav');
      const nav = navs.find(n => (attr(n, 'type') || '').includes('toc')) || navs[0];
      const ol = nav && first(nav, 'ol');
      if (ol) toc = walkNav(ol, dirOf(navItem.path), 0);
    }
  }
  if (!toc.length) {
    const ncxItem = manifest.get(attr(spineEl, 'toc')) || [...manifest.values()].find(it => it.type === 'application/x-dtbncx+xml');
    const ncxText = ncxItem && await text(ncxItem.path);
    if (ncxText) {
      const navMap = first(parseXML(ncxText), 'navMap');
      if (navMap) toc = walkNcx(navMap, dirOf(ncxItem.path), 0);
    }
  }
  const tocEntries = toc.map(t => ({ ...t, index: spine.findIndex(s => s.path === t.path) })).filter(t => t.index >= 0);

  return new EpubBook(zip, { title, author, authorSort, spine, toc: tocEntries, coverPath });
}

function walkNav(ol, dir, level) {
  const out = [];
  for (const li of Array.from(ol.children).filter(c => c.localName === 'li')) {
    const a = Array.from(li.children).find(c => c.localName === 'a') || first(li, 'a');
    if (a && attr(a, 'href')) {
      const r = resolveHref(attr(a, 'href'), dir);
      out.push({ title: clean(a.textContent) || 'Untitled', level, path: r.path, fragment: r.fragment });
    }
    const sub = Array.from(li.children).find(c => c.localName === 'ol');
    if (sub) out.push(...walkNav(sub, dir, level + 1));
  }
  return out;
}

function walkNcx(node, dir, level) {
  const out = [];
  for (const p of Array.from(node.children).filter(c => c.localName === 'navPoint')) {
    const label = first(p, 'navLabel');
    const src = attr(Array.from(p.children).find(c => c.localName === 'content'), 'src');
    if (src) {
      const r = resolveHref(src, dir);
      out.push({ title: clean(label?.textContent) || 'Untitled', level, path: r.path, fragment: r.fragment });
    }
    out.push(...walkNcx(p, dir, level + 1));
  }
  return out;
}

class EpubBook {
  constructor(zip, info) {
    Object.assign(this, info);
    this.zip = zip;
    this.urls = new Map();   // zip path -> blob URL
  }

  get chapterCount() { return this.spine.length; }

  async coverBlob() {
    if (!this.coverPath) return null;
    const f = this.zip.file(this.coverPath);
    if (!f) return null;
    return new Blob([await f.async('uint8array')], { type: MIME[ext(this.coverPath)] || 'image/jpeg' });
  }

  async urlFor(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const f = this.zip.file(path);
    if (!f) return null;
    let blob;
    if (ext(path) === 'css') {
      blob = new Blob([await this.rewriteCSS(await f.async('string'), dirOf(path))], { type: 'text/css' });
    } else {
      blob = new Blob([await f.async('uint8array')], { type: MIME[ext(path)] || 'application/octet-stream' });
    }
    const url = URL.createObjectURL(blob);
    this.urls.set(path, url);
    return url;
  }

  async rewriteCSS(css, dir) {
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const jobs = [];
    css.replace(re, (m, q, href) => { jobs.push(href); return m; });
    const map = new Map();
    for (const href of jobs) {
      if (/^(data:|https?:|blob:|#)/i.test(href) || map.has(href)) continue;
      map.set(href, await this.urlFor(resolveHref(href, dir).path));
    }
    return css.replace(re, (m, q, href) => map.get(href) ? `url("${map.get(href)}")` : m);
  }

  /** Returns the chapter as an HTML Document with all resources pointing at blob URLs. */
  async chapterDocument(index) {
    const path = this.spine[index].path;
    const raw = await this.zip.file(path)?.async('string');
    if (raw == null) throw new Error('Missing chapter: ' + path);
    const src = parseXML(raw);
    const dir = dirOf(path);
    const out = document.implementation.createHTMLDocument('');

    const srcHead = first(src, 'head'), srcBody = first(src, 'body') || src.documentElement;
    if (srcHead) for (const n of Array.from(srcHead.childNodes)) out.head.appendChild(out.importNode(n, true));
    const body = out.importNode(srcBody, true);
    out.documentElement.replaceChild(body, out.body);
    // keep the chapter's own body class / id for its stylesheet
    for (const a of Array.from(srcBody.attributes || [])) if (a.name === 'class' || a.name === 'id') body.setAttribute(a.name, a.value);

    out.querySelectorAll('script').forEach(s => s.remove());
    const local = href => href && !/^(data:|https?:|blob:|mailto:|#)/i.test(href);

    for (const link of out.querySelectorAll('link[href]')) {
      const href = link.getAttribute('href');
      if ((link.getAttribute('rel') || '').includes('stylesheet') && local(href)) {
        const url = await this.urlFor(resolveHref(href, dir).path);
        if (url) link.setAttribute('href', url); else link.remove();
      }
    }
    for (const st of out.querySelectorAll('style')) st.textContent = await this.rewriteCSS(st.textContent, dir);
    for (const el of out.querySelectorAll('img[src], video[src], audio[src], source[src]')) {
      const href = el.getAttribute('src');
      if (local(href)) { const url = await this.urlFor(resolveHref(href, dir).path); if (url) el.setAttribute('src', url); }
    }
    for (const el of out.querySelectorAll('image')) {   // SVG <image xlink:href="…">
      const href = el.getAttribute('href') || el.getAttribute('xlink:href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (local(href)) {
        const url = await this.urlFor(resolveHref(href, dir).path);
        if (url) { el.setAttribute('href', url); el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url); }
      }
    }
    return out;
  }

  /** The chapter's readable text (no scripts or styles), for searching. */
  async chapterText(index) {
    const raw = await this.zip.file(this.spine[index].path)?.async('string');
    if (raw == null) return '';
    const doc = parseXML(raw);
    return readableText(first(doc, 'body') || doc.documentElement);
  }

  /** Where an in-book link points: another chapter (+ anchor) or an external URL. */
  resolveLink(fromIndex, href) {
    if (/^(https?:|mailto:)/i.test(href)) return { external: href };
    if (href.startsWith('#')) return { index: fromIndex, fragment: href.slice(1) };
    const r = resolveHref(href, dirOf(this.spine[fromIndex].path));
    const index = this.spine.findIndex(s => s.path === r.path);
    return index >= 0 ? { index, fragment: r.fragment } : null;
  }

  close() { for (const u of this.urls.values()) URL.revokeObjectURL(u); this.urls.clear(); }
}
