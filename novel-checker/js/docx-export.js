// Builds a Word document with every note attached as a comment in the margin.
// If the book was uploaded as .docx, the comments are added to that original file,
// so its fonts, italics and layout stay exactly as they were.

import { loadScript } from './importers.js';
import { normText } from './annotate.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const COMMENTS_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const NOFOLDERS = { createFolders: false };
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // Characters XML 1.0 doesn't allow.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const serialize = (doc) => {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith('<?xml') ? s : XML_DECL + s;
};

// ---------------------------------------------------------------- a fresh document

function freshPackage(zip, title, chapters) {
  // chapters: [{ title, paragraphs: [text] }]
  const body = [];
  body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(title)}</w:t></w:r></w:p>`);
  chapters.forEach((c) => {
    body.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(c.title)}</w:t></w:r></w:p>`);
    for (const t of c.paragraphs) body.push(`<w:p data-nc="1"><w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`);
  });
  zip.file('[Content_Types].xml', XML_DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>', NOFOLDERS);
  zip.file('_rels/.rels', XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', NOFOLDERS);
  zip.file('word/_rels/document.xml.rels', XML_DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>', NOFOLDERS);
  zip.file('word/styles.xml', XML_DECL + `<w:styles xmlns:w="${W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="420"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:after="480"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:ind w:firstLine="0"/><w:spacing w:after="360"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>' +
    '</w:styles>', NOFOLDERS);
  zip.file('word/document.xml', XML_DECL + `<w:document xmlns:w="${W}"><w:body>${body.join('')}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>', NOFOLDERS);
}

// ---------------------------------------------------------------- text positions inside a <w:p>

// Text pieces of a paragraph in reading order, as Word stores them across runs.
function pieces(p) {
  const out = [];
  let pos = 0;
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI !== W) { walk(c); continue; }
      const n = c.localName;
      if (n === 't') { const t = c.textContent; out.push({ node: c, start: pos, len: t.length }); pos += t.length; }
      else if (n === 'tab') { out.push({ node: c, start: pos, len: 1, tab: true }); pos += 1; }
      else if (n === 'delText' || n === 'pPr' || n === 'rPr' || n === 'instrText') continue;
      else walk(c);
    }
  };
  walk(p);
  return out;
}

function rawText(ps) {
  return ps.map((x) => (x.tab ? '\t' : x.node.textContent)).join('');
}

// Map positions in the tidied text (single spaces, trimmed) back to positions in Word's own text.
function normToRaw(raw) {
  const map = [];
  let started = false, inWs = false;
  for (let i = 0; i < raw.length; i++) {
    const ws = /\s/.test(raw[i]);
    if (!started && ws) continue;
    started = true;
    if (ws) { if (!inWs) map.push(i); inWs = true; }
    else { map.push(i); inWs = false; }
  }
  // Drop a trailing space, as trim() would.
  if (map.length && /\s/.test(raw[map[map.length - 1]])) map.pop();
  map.push(map.length ? map[map.length - 1] + 1 : 0);
  return map;
}

const wEl = (doc, name, attrs = {}) => {
  const el = doc.createElementNS(W, 'w:' + name);
  for (const [k, v] of Object.entries(attrs)) el.setAttributeNS(W, 'w:' + k, String(v));
  return el;
};

// Put a marker element at raw text position `pos` inside paragraph `p`, splitting a run if needed.
function insertAt(doc, p, pos, el) {
  const ps = pieces(p);
  const total = ps.length ? ps[ps.length - 1].start + ps[ps.length - 1].len : 0;
  if (!ps.length || pos >= total) {
    // At the very end: after the last run.
    const last = ps.length ? ps[ps.length - 1].node.parentNode : null;
    if (last && last.parentNode) last.parentNode.insertBefore(el, last.nextSibling);
    else p.appendChild(el);
    return;
  }
  const piece = ps.find((x) => pos >= x.start && pos < x.start + x.len);
  const run = piece.node.parentNode;
  const local = pos - piece.start;
  if (local > 0 && !piece.tab) {
    // Split this run in two at the right character, copying its formatting.
    const text = piece.node.textContent;
    const head = run.cloneNode(false);
    const rPr = Array.from(run.childNodes).find((c) => c.localName === 'rPr');
    if (rPr) head.appendChild(rPr.cloneNode(true));
    for (let c = run.firstChild; c && c !== piece.node;) {
      const next = c.nextSibling;
      if (c !== rPr) head.appendChild(c);
      c = next;
    }
    const t1 = wEl(doc, 't');
    t1.setAttribute('xml:space', 'preserve');
    t1.textContent = text.slice(0, local);
    head.appendChild(t1);
    piece.node.textContent = text.slice(local);
    piece.node.setAttribute('xml:space', 'preserve');
    run.parentNode.insertBefore(head, run);
  } else if (local === 0) {
    // The piece starts this run only if nothing textual comes before it in the run.
    const before = Array.from(run.childNodes).slice(0, Array.from(run.childNodes).indexOf(piece.node))
      .some((c) => c.localName === 't' || c.localName === 'tab');
    if (before) {
      const head = run.cloneNode(false);
      const rPr = Array.from(run.childNodes).find((c) => c.localName === 'rPr');
      if (rPr) head.appendChild(rPr.cloneNode(true));
      for (let c = run.firstChild; c && c !== piece.node;) {
        const next = c.nextSibling;
        if (c !== rPr) head.appendChild(c);
        c = next;
      }
      run.parentNode.insertBefore(head, run);
    }
  }
  run.parentNode.insertBefore(el, run);
}

function addComments(doc, p, notes, nextId) {
  // notes: [{ start, end, id }] in tidied-text positions.
  const raw = rawText(pieces(p));
  const map = normToRaw(raw);
  const toRaw = (i) => map[Math.min(Math.max(i, 0), map.length - 1)];
  // Ends first, from the back, so earlier positions stay valid.
  const markers = [];
  for (const n of notes) {
    markers.push({ pos: toRaw(n.end), kind: 'end', id: n.id });
    markers.push({ pos: toRaw(n.start), kind: 'start', id: n.id });
  }
  markers.sort((a, b) => b.pos - a.pos || (a.kind === 'end' ? -1 : 1));
  for (const m of markers) {
    if (m.kind === 'end') {
      // Insert the reference run first, then the range end before it.
      const ref = wEl(doc, 'r');
      const rPr = wEl(doc, 'rPr');
      rPr.appendChild(wEl(doc, 'rStyle', { val: 'CommentReference' }));
      ref.appendChild(rPr);
      ref.appendChild(wEl(doc, 'commentReference', { id: m.id }));
      insertAt(doc, p, m.pos, ref);
      ref.parentNode.insertBefore(wEl(doc, 'commentRangeEnd', { id: m.id }), ref);
    } else {
      insertAt(doc, p, m.pos, wEl(doc, 'commentRangeStart', { id: m.id }));
    }
  }
  return nextId;
}

// ---------------------------------------------------------------- main

/**
 * title: book title
 * chapters: [{ title, paragraphs: [{ index, text }] }]  (index = position in the uploaded paragraphs)
 * notes: [{ ch, p, start, end, text }]  (p = paragraph position within the chapter)
 * source: the original .docx as an ArrayBuffer, or null
 * Returns { blob, placed, missed }.
 */
export async function buildDocx({ title, chapters, notes, source, allParagraphs }) {
  await loadScript('vendor/jszip.min.js');
  const JSZip = self.JSZip;
  let zip;
  let paraEls; // uploaded paragraph index -> <w:p>
  let doc;
  if (source) {
    zip = await JSZip.loadAsync(source.slice(0));
    doc = parse(await zip.file('word/document.xml').async('string'));
    // Match the paragraphs the checker read to Word's paragraphs, in order.
    const all = Array.from(doc.getElementsByTagNameNS(W, 'p')).filter((p) => !p.parentNode || p.parentNode.localName !== 'txbxContent');
    const texts = all.map((p) => normText(rawText(pieces(p))));
    const squash = (s) => s.replace(/\s+/g, '');
    paraEls = new Map();
    let j = 0;
    (allParagraphs || []).forEach((para, k) => {
      const want = normText(para.t);
      if (!want) return;
      for (let look = j; look < Math.min(all.length, j + 60); look++) {
        if (texts[look] === want || squash(texts[look]) === squash(want)) { paraEls.set(k, all[look]); j = look + 1; return; }
      }
    });
  } else {
    zip = new JSZip();
    freshPackage(zip, title, chapters.map((c) => ({ title: c.title, paragraphs: c.paragraphs.map((x) => x.text) })));
    doc = parse(await zip.file('word/document.xml').async('string'));
    const ours = Array.from(doc.getElementsByTagNameNS(W, 'p')).filter((p) => p.getAttribute('data-nc'));
    ours.forEach((p) => p.removeAttribute('data-nc'));
    paraEls = new Map();
    let k = 0;
    chapters.forEach((c) => c.paragraphs.forEach((x) => { paraEls.set(x.index, ours[k++]); }));
  }

  // Existing comments, if any: keep them and number ours after them.
  let commentsDoc = null;
  const cFile = zip.file('word/comments.xml');
  if (cFile) commentsDoc = parse(await cFile.async('string'));
  else commentsDoc = parse(XML_DECL + `<w:comments xmlns:w="${W}"></w:comments>`);
  let nextId = 0;
  for (const c of Array.from(commentsDoc.getElementsByTagNameNS(W, 'comment'))) nextId = Math.max(nextId, (+c.getAttributeNS(W, 'id') || +c.getAttribute('w:id') || 0) + 1);
  for (const r of Array.from(doc.getElementsByTagNameNS(W, 'commentRangeStart'))) nextId = Math.max(nextId, (+r.getAttribute('w:id') || 0) + 1);

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const byPara = new Map();
  let placed = 0, missed = 0;
  for (const n of notes) {
    const para = chapters[n.ch] && chapters[n.ch].paragraphs[n.p];
    const el = para && paraEls.get(para.index);
    if (!el) { missed++; continue; }
    const id = nextId++;
    const c = wEl(commentsDoc, 'comment', { id, author: 'Novel Checker', date: now, initials: 'NC' });
    n.text.split('\n').forEach((line) => {
      const p = wEl(commentsDoc, 'p');
      const r = wEl(commentsDoc, 'r');
      const t = wEl(commentsDoc, 't');
      t.setAttribute('xml:space', 'preserve');
      t.textContent = line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
      r.appendChild(t);
      p.appendChild(r);
      c.appendChild(p);
    });
    commentsDoc.documentElement.appendChild(c);
    if (!byPara.has(el)) byPara.set(el, []);
    byPara.get(el).push({ start: n.start, end: n.end, id });
    placed++;
  }
  for (const [el, list] of byPara) addComments(doc, el, list, nextId);

  zip.file('word/document.xml', serialize(doc), NOFOLDERS);
  zip.file('word/comments.xml', serialize(commentsDoc), NOFOLDERS);

  // Register the comments part if the document didn't have one.
  const ct = parse(await zip.file('[Content_Types].xml').async('string'));
  const hasCt = Array.from(ct.documentElement.childNodes).some((n) => n.nodeType === 1 && n.getAttribute('PartName') === '/word/comments.xml');
  if (!hasCt) {
    const o = ct.createElementNS(ct.documentElement.namespaceURI, 'Override');
    o.setAttribute('PartName', '/word/comments.xml');
    o.setAttribute('ContentType', COMMENTS_CT);
    ct.documentElement.appendChild(o);
    zip.file('[Content_Types].xml', serialize(ct), NOFOLDERS);
  }
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = parse(await zip.file(relsPath).async('string'));
  const relEls = Array.from(rels.documentElement.childNodes).filter((n) => n.nodeType === 1);
  if (!relEls.some((r) => r.getAttribute('Type') === COMMENTS_TYPE)) {
    const ids = new Set(relEls.map((r) => r.getAttribute('Id')));
    let rid = 'rIdNC1';
    for (let i = 2; ids.has(rid); i++) rid = 'rIdNC' + i;
    const r = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
    r.setAttribute('Id', rid);
    r.setAttribute('Type', COMMENTS_TYPE);
    r.setAttribute('Target', 'comments.xml');
    rels.documentElement.appendChild(r);
    zip.file(relsPath, serialize(rels), NOFOLDERS);
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  return { blob, placed, missed };
}
