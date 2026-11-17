// Plain text and Markdown books, split into chapters so they read like EPUBs.

const CHUNK = 30000;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = s => s
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/g, '$1<em>$2</em>')
  .replace(/`(.+?)`/g, '<code>$1</code>');

export async function decodeText(blob) {
  const buf = await blob.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}

/** First Markdown heading, used as the title of a .md file. */
export function markdownTitle(text) {
  const m = text.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

export function openText(text, markdown) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blank = lines.filter(l => !l.trim()).length;
  const linePerParagraph = blank < Math.max(3, lines.length / 20);

  const blocks = [];
  let cur = [];
  const flush = () => { if (cur.length) { blocks.push(cur.join(' ')); cur = []; } };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (linePerParagraph || (markdown && t.startsWith('#'))) { flush(); blocks.push(t); continue; }
    cur.push(t);
  }
  flush();

  const chapters = [], toc = [];
  let body = '', headingNo = 0;
  const close = () => { if (body) { chapters.push(body); body = ''; } };
  for (const block of blocks) {
    const h = markdown && block.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (level <= 2 && body.length > 2000) close();
      const id = 'h' + (++headingNo);
      body += `<h${level} id="${id}">${inline(esc(h[2]))}</h${level}>`;
      toc.push({ title: h[2], level: 0, index: chapters.length, fragment: id });
    } else {
      body += `<p>${markdown ? inline(esc(block)) : esc(block)}</p>\n`;
    }
    if (body.length > CHUNK) close();
  }
  close();
  if (!chapters.length) chapters.push('<p></p>');
  if (!toc.length && chapters.length > 1) chapters.forEach((_, i) => toc.push({ title: `Part ${i + 1}`, level: 0, index: i, fragment: null }));

  return {
    chapterCount: chapters.length,
    spine: chapters.map(c => ({ size: c.length })),
    toc,
    async chapterDocument(i) {
      return new DOMParser().parseFromString(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${chapters[i]}</body></html>`, 'text/html');
    },
    resolveLink(from, href) {
      if (/^(https?:|mailto:)/i.test(href)) return { external: href };
      if (href.startsWith('#')) return { index: from, fragment: href.slice(1) };
      return null;
    },
    close() {},
  };
}
