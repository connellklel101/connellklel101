// Optional deeper grammar check using LanguageTool's free public service.
// Free limits: 20 KB per request, about 20 requests and 75 KB per minute,
// so the book is sent a piece at a time and the check slows itself down.

const ENDPOINT = 'https://api.languagetool.org/v2/check';
const CHUNK = 15000;
const PER_MINUTE_BYTES = 65000;
const PER_MINUTE_REQUESTS = 15;

function chunksFor(chapters) {
  const chunks = [];
  chapters.forEach((ch, ci) => {
    let buf = [];
    let len = 0;
    for (const p of ch.paragraphs) {
      if (len + p.length > CHUNK && buf.length) { chunks.push({ ch: ci, text: buf.join('\n\n') }); buf = []; len = 0; }
      if (p.length > CHUNK) {
        // An enormous paragraph: cut it at sentence ends.
        for (let i = 0; i < p.length; i += CHUNK) chunks.push({ ch: ci, text: p.slice(i, i + CHUNK) });
        continue;
      }
      buf.push(p);
      len += p.length + 2;
    }
    if (buf.length) chunks.push({ ch: ci, text: buf.join('\n\n') });
  });
  return chunks;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

export async function runLanguageTool(chapters, language, { onIssues, onProgress, signal }) {
  const chunks = chunksFor(chapters);
  const sent = [];
  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Stay inside the free limits.
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0].t > 60000) sent.shift();
      const bytes = sent.reduce((n, x) => n + x.bytes, 0);
      if (sent.length < PER_MINUTE_REQUESTS && bytes + c.text.length < PER_MINUTE_BYTES) break;
      onProgress({ done: i, total: chunks.length, waiting: true });
      await sleep(Math.max(1000, 60000 - (now - sent[0].t) + 250), signal);
    }
    onProgress({ done: i, total: chunks.length, waiting: false });
    sent.push({ t: Date.now(), bytes: c.text.length });
    const body = new URLSearchParams({
      text: c.text,
      language,
      disabledCategories: 'TYPOS,TYPOGRAPHY,STYLE,CASING,REDUNDANCY,PLAIN_ENGLISH',
      level: 'default'
    });
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(ENDPOINT, { method: 'POST', body, signal });
      if (res.status !== 429) break;
      onProgress({ done: i, total: chunks.length, waiting: true });
      await sleep(65000, signal);
    }
    if (!res.ok) throw new Error('LanguageTool replied with an error (' + res.status + '). Try again later.');
    const data = await res.json();
    const issues = [];
    for (const m of data.matches || []) {
      if (/MORFOLOGIK|HUNSPELL|SPELL/i.test(m.rule?.id || '')) continue;
      const ctx = m.context || { text: c.text.slice(Math.max(0, m.offset - 60), m.offset + m.length + 60), offset: Math.min(60, m.offset), length: m.length };
      const sev = /GRAMMAR|CONFUSED/.test(m.rule?.category?.id || '') ? 'medium' : 'low';
      issues.push({
        id: 'lt:' + hashStr(m.rule?.id + '|' + ctx.text + '|' + c.ch),
        cat: 'grammar',
        kind: 'LanguageTool: ' + (m.rule?.category?.name || 'Grammar'),
        sev,
        msg: m.message,
        fix: m.replacements && m.replacements[0] ? m.replacements[0].value : null,
        sugg: (m.replacements || []).slice(0, 4).map((r) => r.value),
        quotes: [{ ch: c.ch, pc: null, text: ctx.text, mark: [ctx.offset, ctx.offset + ctx.length] }],
        source: 'languagetool'
      });
    }
    total += issues.length;
    if (issues.length) onIssues(issues);
  }
  onProgress({ done: chunks.length, total: chunks.length, waiting: false });
  return total;
}
