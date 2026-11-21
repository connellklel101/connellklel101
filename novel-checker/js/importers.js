// Turns an uploaded file into paragraphs: [{t: text, h: headingLevel, b: startOfNewFile}]
// Everything happens in the browser. Nothing is uploaded.

const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,div,pre,td';

function blocksFromDocument(doc) {
  const out = [];
  const body = doc.body || doc.documentElement;
  if (!body) return out;
  for (const el of body.querySelectorAll(BLOCKS)) {
    if (el.querySelector(BLOCKS)) continue; // only the innermost blocks
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const m = el.tagName.match(/^H([1-6])$/i);
    out.push({ t, h: m ? +m[1] : 0 });
  }
  return out;
}

export async function importFile(file, onStatus = () => {}) {
  const name = file.name || 'Untitled';
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  const title = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';

  if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'text' || (!ext && file.type.startsWith('text/'))) {
    onStatus('Reading the text file');
    const text = await file.text();
    return { title, paragraphs: self.NovelAnalyzer.textToParagraphs(text) };
  }
  if (ext === 'docx') {
    onStatus('Opening the Word document');
    await loadScript('vendor/mammoth.browser.min.js');
    const buf = await file.arrayBuffer();
    const res = await self.mammoth.convertToHtml({ arrayBuffer: buf.slice(0) });
    const doc = new DOMParser().parseFromString(res.value, 'text/html');
    // Keep the original file so notes can be added to it as Word comments, formatting intact.
    return { title, paragraphs: blocksFromDocument(doc), source: buf, sourceName: name };
  }
  if (ext === 'epub') {
    onStatus('Opening the EPUB');
    await loadScript('vendor/jszip.min.js');
    return importEpub(await file.arrayBuffer(), title);
  }
  if (ext === 'pdf') {
    onStatus('Opening the PDF');
    return importPdf(await file.arrayBuffer(), title, onStatus);
  }
  if (ext === 'doc') throw new Error('Old Word files (.doc) can\'t be read. In Word, use File → Save As and choose .docx, then try again.');
  if (ext === 'pages') throw new Error('Pages files can\'t be read. In Pages, use File → Export To → Word, then upload the .docx.');
  if (ext === 'odt' || ext === 'rtf') throw new Error('This file type can\'t be read yet. Save it as .docx or .txt and try again.');
  throw new Error('This file type isn\'t supported. Use .docx, .pdf, .epub or .txt.');
}

async function importEpub(buf, fallbackTitle) {
  const zip = await self.JSZip.loadAsync(buf);
  const read = async (path) => { const f = zip.file(path); return f ? f.async('string') : null; };
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const container = await read('META-INF/container.xml');
  if (!container) throw new Error('This EPUB looks damaged: it has no table of contents file.');
  const opfPath = xml(container).querySelector('rootfile')?.getAttribute('full-path');
  const opfText = opfPath && await read(opfPath);
  if (!opfText) throw new Error('This EPUB looks damaged: its contents file is missing.');
  const opf = xml(opfText);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const items = {};
  for (const it of opf.querySelectorAll('manifest > item')) items[it.getAttribute('id')] = { href: it.getAttribute('href'), props: it.getAttribute('properties') || '' };
  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || fallbackTitle;
  const paragraphs = [];
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const item = items[ref.getAttribute('idref')];
    if (!item || /nav/.test(item.props) || /(^|\/)(toc|nav|cover|copyright|titlepage)[^/]*$/i.test(item.href)) continue;
    const path = decodeURIComponent(new URL(item.href, 'http://x/' + base).pathname.slice(1));
    const html = await read(path);
    if (!html) continue;
    let doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks = blocksFromDocument(doc);
    if (blocks.length) blocks[0].b = true;
    paragraphs.push(...blocks);
  }
  return { title, paragraphs };
}

async function importPdf(buf, title, onStatus) {
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (n % 10 === 1) onStatus(`Reading page ${n} of ${pdf.numPages}`);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      let line = lines.find((l) => Math.abs(l.y - y) < h * 0.4);
      if (!line) { line = { y, items: [], h }; lines.push(line); }
      line.items.push({ x, w: it.width || 0, s: it.str });
      line.h = Math.max(line.h, h);
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      let text = '', end = null;
      for (const it of l.items) {
        if (end != null && it.x - end > l.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
        text += it.s;
        end = it.x + it.w;
      }
      l.text = text.replace(/\s+/g, ' ').trim();
      l.x = l.items[0].x;
      l.end = end;
    }
    pages.push(lines.filter((l) => l.text));
  }

  // Remove running headers, footers and page numbers.
  const norm = (t) => t.replace(/\d+/g, '#').toLowerCase();
  const edgeCounts = new Map();
  for (const lines of pages) {
    for (const l of [lines[0], lines[lines.length - 1]]) if (l) edgeCounts.set(norm(l.text), (edgeCounts.get(norm(l.text)) || 0) + 1);
  }
  const repeated = (t) => pages.length >= 4 && (edgeCounts.get(norm(t)) || 0) >= pages.length * 0.3;
  const heights = [];
  pages.forEach((lines) => lines.forEach((l) => heights.push(l.h)));
  heights.sort((a, b) => a - b);
  const bodyH = heights[Math.floor(heights.length / 2)] || 10;

  const paragraphs = [];
  let cur = null;
  for (const lines of pages) {
    const body = lines.filter((l, i) => !(/^[-–—\s]*(\d+|[ivxlc]+)[-–—\s]*$/i.test(l.text)) && !((i === 0 || i === lines.length - 1) && repeated(l.text)));
    if (!body.length) continue;
    const minX = Math.min(...body.map((l) => l.x));
    const maxEnd = Math.max(...body.map((l) => l.end));
    const gaps = [];
    for (let i = 1; i < body.length; i++) gaps.push(body[i - 1].y - body[i].y);
    const sortedGaps = gaps.slice().sort((a, b) => a - b);
    const lineGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || bodyH * 1.2;
    body.forEach((l, i) => {
      const heading = l.h > bodyH * 1.25 && l.text.length < 90;
      const prev = body[i - 1];
      const gap = prev ? prev.y - l.y : Infinity;
      const indented = l.x > minX + bodyH * 0.8;
      const prevShort = prev && prev.end < maxEnd - bodyH * 3 && /[.!?:"”’)]$/.test(prev.text);
      const newPara = !cur || heading || cur.h || gap > lineGap * 1.45 || indented || prevShort || i === 0 && /[.!?"”’]$/.test(cur.t);
      if (newPara) {
        cur = { t: l.text, h: heading ? 1 : 0 };
        paragraphs.push(cur);
      } else if (/[a-z]-$/.test(cur.t) && /^[a-z]/.test(l.text)) {
        cur.t = cur.t.slice(0, -1) + l.text;
      } else {
        cur.t += ' ' + l.text;
      }
    });
  }
  if (!paragraphs.length) throw new Error('No text was found in this PDF. If it is a scan of printed pages, it has no text to read.');
  return { title, paragraphs };
}
