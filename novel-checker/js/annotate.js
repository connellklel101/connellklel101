// Where each note sits in the book's text, for the reading view and the Word download.

export const normText = (t) => String(t || '').replace(/\s+/g, ' ').trim();

// The paragraphs of each chapter, exactly as the checker saw them.
export function chapterParagraphs(report, paragraphs) {
  return report.chapters.map((c) => (c.paras || []).map((i) => ({ index: i, text: normText(paragraphs[i] && paragraphs[i].t) })));
}

// Find a quote inside a chapter: returns { p: position in chapter, start, end } or null.
export function locateQuote(q, paras) {
  if (!q || !paras) return null;
  let core = q.text || '';
  let pre = 0;
  if (core.startsWith('…')) { core = core.slice(1); pre = 1; }
  if (core.endsWith('…')) core = core.slice(0, -1);
  const marked = q.mark && q.mark[1] > q.mark[0] ? q.text.slice(q.mark[0], q.mark[1]) : null;
  const tryPara = (pi) => {
    const t = paras[pi] && paras[pi].text;
    if (!t) return null;
    const at = core ? t.indexOf(core) : -1;
    if (at >= 0) {
      if (marked) return { p: pi, start: at + q.mark[0] - pre, end: at + q.mark[1] - pre };
      return { p: pi, start: at, end: at + core.length };
    }
    if (marked) {
      const m = t.indexOf(marked);
      if (m >= 0) return { p: pi, start: m, end: m + marked.length };
    }
    return null;
  };
  if (q.pc) {
    const hit = tryPara(q.pc - 1);
    if (hit) return hit;
  }
  for (let i = 0; i < paras.length; i++) {
    const hit = tryPara(i);
    if (hit) return hit;
  }
  return null;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every place a note points to: [{ issue, ch, p, start, end }]. Spelling notes cover every use of the word.
export function noteLocations(issues, report, chParas, { maxPerWord = 30 } = {}) {
  const out = [];
  for (const it of issues) {
    const seen = new Set();
    const addLoc = (ch, l) => {
      const k = ch + ':' + l.p + ':' + l.start;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ issue: it, ch, p: l.p, start: l.start, end: Math.max(l.end, l.start + 1) });
    };
    if (it.word && /Spelling|Unknown name/.test(it.kind)) {
      const re = new RegExp('(^|[^A-Za-zÀ-ÖØ-öø-ÿ’\'])(' + esc(it.word) + ')(?![A-Za-zÀ-ÖØ-öø-ÿ])', 'gi');
      let n = 0;
      for (const ch of it.chapters || []) {
        const paras = chParas[ch] || [];
        paras.forEach((pp, pi) => {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(pp.text)) && n < maxPerWord) {
            const start = m.index + m[1].length;
            addLoc(ch, { p: pi, start, end: start + m[2].length });
            n++;
          }
        });
      }
      if (n) continue;
    }
    for (const q of it.quotes || []) {
      const l = locateQuote(q, chParas[q.ch]);
      if (l) addLoc(q.ch, l);
    }
  }
  return out;
}
