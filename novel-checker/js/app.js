import { importFile } from './importers.js';
import { prefs, history } from './storage.js';
import { runLanguageTool } from './languagetool.js';

// ------------------------------------------------------------------ state

const CATS = [
  { id: 'continuity', label: 'Continuity', blurb: 'Contradictions between chapters: names, looks, ages, family, belongings, dates and seasons, plus pronoun, point-of-view and tense slips.' },
  { id: 'spelling', label: 'Spelling', blurb: 'Words that aren’t in the dictionary, words spelled two ways, and inconsistent hyphens.' },
  { id: 'grammar', label: 'Grammar', blurb: 'Wrong words, repeated words, a/an, capitals and punctuation.' },
  { id: 'style', label: 'Style', blurb: 'Habits worth a second look: repeated phrases, echoes, long sentences and more.' }
];
const TABS = [{ id: 'overview', label: 'Overview' }, ...CATS, { id: 'characters', label: 'Characters' }, { id: 'timeline', label: 'Timeline' }];
const SEV_LABEL = { high: 'Likely error', medium: 'Check this', low: 'Suggestion' };
const PAGE = 40;

const state = {
  report: null,
  isSample: false,
  chapterTexts: null,
  tab: 'overview',
  filters: {},
  shown: {},
  ignored: new Set(prefs.get('ignored', [])),
  words: prefs.get('words', []),
  hidden: prefs.get('hidden', []),
  lt: null,
  worker: null,
  openQuote: null,
  charSort: 'mentions',
  charType: 'person'
};
let wordSet = new Set(state.words.map((w) => w.toLowerCase()));

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('en');
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + 's')}`;

// ------------------------------------------------------------------ helpers

function chShort(i) {
  const c = state.report?.chapters?.[i];
  if (!c) return '';
  const m = c.title.match(/^(?:chapter|ch\.)\s+([^\s:.]+)/i);
  if (m) return 'Ch ' + m[1];
  if (/^section\s+\d+/i.test(c.title)) return c.title.replace(/^section/i, 'Sec');
  return c.title.length > 14 ? c.title.slice(0, 13) + '…' : c.title;
}

function quoteHtml(q) {
  const ref = esc(chShort(q.ch)) + (q.pc ? `<span class="sep"> · </span><br>¶${q.pc}` : '');
  let text;
  if (q.mark && q.mark[1] > q.mark[0]) {
    const [a, b] = q.mark;
    text = esc(q.text.slice(0, a)) + '<mark>' + esc(q.text.slice(a, b)) + '</mark>' + esc(q.text.slice(b));
  } else text = esc(q.text);
  return `<figure class="q"><figcaption class="q-ref">${ref}</figcaption><blockquote class="q-text" style="margin:0">${text}</blockquote></figure>`;
}

function issueChapters(it) {
  if (it.chapters && it.chapters.length) return it.chapters;
  return [...new Set((it.quotes || []).map((q) => q.ch))];
}

function visibleIssues(cat) {
  if (!state.report) return [];
  return state.report.issues.filter((it) => (!cat || it.cat === cat) && !state.ignored.has(it.id) &&
    !(it.word && wordSet.has(it.word.toLowerCase()) && (it.kind === 'Spelling' || it.kind === 'Unknown name')));
}

function countsByCat(report, ignored = state.ignored) {
  const out = {};
  for (const c of CATS) out[c.id] = { all: 0, high: 0 };
  for (const it of report.issues) {
    if (ignored.has(it.id) || !out[it.cat]) continue;
    out[it.cat].all++;
    if (it.sev === 'high') out[it.cat].high++;
  }
  return out;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function message(kind, html) {
  $('#message-area').innerHTML = html ? `<div class="notice ${kind}" style="margin-top:12px">${html}</div>` : '';
}

// ------------------------------------------------------------------ running a check

function setProgress(label, value) {
  $('#progress-label').textContent = label;
  $('#progress-bar').style.width = Math.round(value * 100) + '%';
  $('#progress .bar').setAttribute('aria-valuenow', String(Math.round(value * 100)));
}

function analyzeInWorker(paragraphs, options) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker('engine/worker.js'); }
    catch (e) { reject(e); return; }
    state.worker = worker;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') setProgress(m.label, m.value);
      else if (m.type === 'warning') message('warn', esc(m.message));
      else if (m.type === 'result') { worker.terminate(); state.worker = null; resolve(m.report); }
      else if (m.type === 'error') { worker.terminate(); state.worker = null; reject(new Error(m.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); state.worker = null; reject(new Error(e.message || 'The checker stopped unexpectedly.')); };
    worker.postMessage({ type: 'analyze', paragraphs, options });
  });
}

async function runCheck({ title, paragraphs, sample = false }) {
  stopLanguageTool();
  message('', '');
  const words = paragraphs.reduce((n, p) => n + (p.t.match(/\S+/g) || []).length, 0);
  if (words < 20) {
    message('error', '<strong>There isn’t enough text to check.</strong> The file seems to be empty, or its text couldn’t be read.');
    return;
  }
  $('#progress').hidden = false;
  $('#progress-title').textContent = title;
  $('#report').hidden = true;
  setProgress('Starting', 0.01);
  const options = {
    dict: $('#opt-dict').value,
    customWords: state.words,
    hiddenNames: state.hidden
  };
  let report;
  try {
    try {
      report = await analyzeInWorker(paragraphs, options);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      // Workers can be unavailable (for example when opened straight from a file). Check without spelling instead.
      if (!self.NovelAnalyzer) throw err;
      message('warn', '<strong>Spelling was skipped.</strong> The background checker couldn’t start in this browser, so the rest of the report was made without it.');
      report = self.NovelAnalyzer.analyze(paragraphs, null, options, setProgress);
    }
  } catch (err) {
    $('#progress').hidden = true;
    $('#report').hidden = !state.report;
    if (err && err.name === 'AbortError') return;
    message('error', `<strong>The check didn’t finish.</strong> ${esc(err.message || err)}`);
    return;
  }
  report.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  report.title = title;
  report.sample = sample;
  // Keep the chapter text in memory (not in saved reports) for the optional online grammar check.
  state.chapterTexts = report.chapters.map((c) => ({ paragraphs: paragraphs.slice(c.source[0], c.source[1] + 1).map((p) => p.t).filter((t) => t && t.trim()) }));

  if (!sample) {
    const all = await history.list();
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const prev = all.find((r) => norm(r.title) === norm(title));
    if (prev) {
      const prevIds = new Set(prev.issues.map((i) => i.id));
      const curIds = new Set(report.issues.map((i) => i.id));
      report.compare = {
        date: prev.createdAt,
        prevTotal: prev.issues.filter((i) => !state.ignored.has(i.id)).length,
        fixed: [...prevIds].filter((id) => !curIds.has(id) && !state.ignored.has(id)).length,
        added: [...curIds].filter((id) => !prevIds.has(id)).length
      };
    }
    await history.save(report);
    prefs.set('last', report.id);
  }
  $('#progress').hidden = true;
  showReport(report, { sample });
  if (!sample && $('#opt-lt').checked) startLanguageTool();
  if (!sample) $('#report').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleFile(file) {
  if (!file) return;
  message('', '');
  $('#progress').hidden = false;
  $('#progress-title').textContent = file.name;
  $('#report').hidden = true;
  setProgress('Opening the file', 0.01);
  try {
    const { title, paragraphs } = await importFile(file, (label) => setProgress(label, 0.02));
    await runCheck({ title, paragraphs });
  } catch (err) {
    $('#progress').hidden = true;
    $('#report').hidden = !state.report;
    message('error', `<strong>That file couldn’t be opened.</strong> ${esc(err.message || err)}`);
  } finally {
    $('#file').value = '';
  }
}

// ------------------------------------------------------------------ LanguageTool

function stopLanguageTool() {
  if (state.lt && state.lt.controller) state.lt.controller.abort();
  state.lt = null;
  renderLtStatus();
}

async function startLanguageTool() {
  if (!state.chapterTexts || !state.report) return;
  const report = state.report;
  const controller = new AbortController();
  state.lt = { controller, done: 0, total: 0, waiting: false, error: null, finished: false };
  renderLtStatus();
  try {
    await runLanguageTool(state.chapterTexts, report.dict === 'en-GB' ? 'en-GB' : 'en-US', {
      signal: controller.signal,
      onProgress: (p) => { if (state.lt) { Object.assign(state.lt, p); renderLtStatus(); } },
      onIssues: (issues) => {
        const have = new Set(report.issues.map((i) => i.id));
        for (const it of issues) if (!have.has(it.id)) report.issues.push(it);
        if (state.report === report) refreshAfterChange(true);
      }
    });
    if (state.lt) { state.lt.finished = true; renderLtStatus(); }
    report.ltDone = true;
    if (!report.sample) history.save(report);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (state.lt) {
      state.lt.error = /Failed to fetch|NetworkError|Load failed/i.test(err.message)
        ? 'LanguageTool couldn’t be reached. Check your internet connection, or this page may not be allowed to contact other websites.'
        : err.message;
      renderLtStatus();
    }
    if (!report.sample) history.save(report);
  }
}

function renderLtStatus() {
  const el = $('#lt-status');
  if (!el) return;
  const lt = state.lt;
  if (!lt) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  if (lt.error) { el.className = 'notice error'; el.innerHTML = `<span><strong>Online grammar check stopped.</strong> ${esc(lt.error)}</span>`; return; }
  if (lt.finished) { el.className = 'notice'; el.innerHTML = '<span><strong>Online grammar check finished.</strong> Its notes are in the Grammar tab, marked “LanguageTool”.</span>'; return; }
  el.className = 'notice';
  const pct = lt.total ? Math.round((lt.done / lt.total) * 100) : 0;
  el.innerHTML = `<span style="flex:1"><strong>Online grammar check: ${pct}%</strong> (${lt.done} of ${lt.total || '…'} parts${lt.waiting ? ', pausing to stay within the free limit' : ''})</span>
    <button class="btn small" type="button" data-action="lt-stop">Stop</button>`;
}

// ------------------------------------------------------------------ report rendering

function showReport(report, { sample = false } = {}) {
  state.report = report;
  state.isSample = sample;
  state.filters = {};
  state.shown = {};
  state.openQuote = null;
  if (!TABS.some((t) => t.id === state.tab)) state.tab = 'overview';
  if (sample) state.tab = 'overview';
  renderReport();
}

function refreshAfterChange(keepPanel) {
  renderTabs();
  if (!keepPanel || ['overview', 'grammar'].includes(state.tab)) renderPanel();
}

function renderReport() {
  const r = state.report;
  const el = $('#report');
  el.hidden = false;
  const date = new Date(r.createdAt);
  const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let compare = '';
  if (r.compare) {
    const d = new Date(r.compare.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    compare = `<p class="compare">Compared with your check on ${esc(d)}: <b>${plural(r.compare.fixed, 'note')} gone</b>, <span class="${r.compare.added ? 'worse' : ''}">${plural(r.compare.added, 'new note')}</span>.</p>`;
  }
  el.innerHTML = `
    ${r.sample ? `<div class="notice"><span><strong>This is an example.</strong> It’s the report for “Salt and Lantern”, a short sample story with mistakes planted in it. Choose your own manuscript above to check it.</span></div>` : ''}
    <div class="report-head">
      <div style="min-width:0">
        <p class="eyebrow">${r.sample ? 'Example report' : 'Report'} · ${esc(dateStr)}</p>
        <h2>${esc(r.title)}</h2>
        <p class="meta">${fmt(r.stats.words)} words · ${plural(r.stats.chapters, 'chapter')} · ${r.dict === 'en-GB' ? 'UK' : 'US'} English</p>
        ${compare}
      </div>
      <div class="chips">
        <button class="btn small" type="button" data-action="copy">Copy as text</button>
        <button class="btn small" type="button" data-action="new">Check another file</button>
      </div>
    </div>
    <div id="lt-status" hidden></div>
    <div class="tabs-scroll"><div class="tabs" role="tablist" id="tabs"></div></div>
    <div id="panel" role="tabpanel"></div>`;
  renderTabs();
  renderLtStatus();
  renderPanel();
}

function renderTabs() {
  const counts = countsByCat(state.report);
  // Spelling words the writer has added are not counted.
  counts.spelling.all = visibleIssues('spelling').length;
  counts.spelling.high = visibleIssues('spelling').filter((i) => i.sev === 'high').length;
  const html = TABS.map((t) => {
    let n = '';
    if (counts[t.id]) n = `<span class="count">${fmt(counts[t.id].all)}</span>`;
    if (t.id === 'characters') n = `<span class="count">${fmt(state.report.characters.filter((c) => !c.narrator && c.type !== 'place' && c.type !== 'other' && !state.hidden.includes(c.name)).length)}</span>`;
    return `<button class="tab" role="tab" type="button" id="tab-${t.id}" aria-selected="${state.tab === t.id}" data-tab="${t.id}">${esc(t.label)}${n}</button>`;
  }).join('');
  $('#tabs').innerHTML = html;
}

function renderPanel() {
  const p = $('#panel');
  p.setAttribute('aria-labelledby', 'tab-' + state.tab);
  if (state.tab === 'overview') p.innerHTML = overviewHtml();
  else if (state.tab === 'characters') p.innerHTML = charactersHtml();
  else if (state.tab === 'timeline') p.innerHTML = timelineHtml();
  else if (state.tab === 'style') p.innerHTML = styleHtml();
  else p.innerHTML = issueTabHtml(state.tab);
}

// --- overview

function overviewHtml() {
  const r = state.report;
  const counts = countsByCat(r);
  counts.spelling.all = visibleIssues('spelling').length;
  counts.spelling.high = visibleIssues('spelling').filter((i) => i.sev === 'high').length;
  const tiles = CATS.map((c) => `
    <button class="tile" type="button" data-tab="${c.id}">
      <span class="tile-label"><span class="dot ${c.id}"></span>${c.label}</span>
      <span class="tile-num">${fmt(counts[c.id].all)}</span>
      <span class="tile-sub">${counts[c.id].high ? `<span class="hi">${fmt(counts[c.id].high)} likely ${counts[c.id].high === 1 ? 'error' : 'errors'}</span>` : 'No likely errors'}</span>
    </button>`).join('');

  const rank = { high: 0, medium: 1, low: 2 };
  const catRank = { continuity: 0, grammar: 1, spelling: 2, style: 3 };
  const top = visibleIssues().filter((i) => i.sev !== 'low' && i.cat !== 'style')
    .sort((a, b) => rank[a.sev] - rank[b.sev] || catRank[a.cat] - catRank[b.cat] || (issueChapters(a)[0] ?? 0) - (issueChapters(b)[0] ?? 0))
    .slice(0, 6);

  // Notes per chapter, by category.
  const per = r.chapters.map(() => ({ continuity: 0, spelling: 0, grammar: 0, style: 0, total: 0 }));
  for (const it of visibleIssues()) {
    for (const ch of issueChapters(it).slice(0, 1)) { if (per[ch]) { per[ch][it.cat]++; per[ch].total++; } }
  }
  const max = Math.max(1, ...per.map((p) => p.total));
  const rows = r.chapters.map((c, i) => `
    <div class="chbar" title="${esc(c.title)}">
      <span class="chbar-name">${esc(c.title)}</span>
      <span class="chbar-track">${CATS.map((k) => per[i][k.id] ? `<span class="${k.id}" style="width:${(per[i][k.id] / max) * 100}%"></span>` : '').join('')}</span>
      <span class="chbar-val">${per[i].total}</span>
    </div>`).join('');

  return `
    <div class="stack" style="gap:20px;padding-top:16px">
      <div class="tiles">${tiles}</div>
      <div class="two-col">
        <div class="stack">
          <div>
            <h3 class="section-title">Start here</h3>
            <p class="section-lead">The notes most likely to be real mistakes.</p>
          </div>
          <div class="issues">${top.length ? top.map(issueCard).join('') : '<div class="empty">Nothing urgent found. Look through the tabs for smaller suggestions.</div>'}</div>
        </div>
        <div class="stack">
          <div>
            <h3 class="section-title">Notes by chapter</h3>
            <p class="section-lead">Where the notes fall in the book.</p>
          </div>
          <div class="chbars">
            ${rows}
            <div class="legend">${CATS.map((c) => `<span><span class="dot ${c.id}"></span>${c.label}</span>`).join('')}</div>
          </div>
        </div>
      </div>
    </div>`;
}

// --- issue lists

function filterState(cat) {
  if (!state.filters[cat]) state.filters[cat] = { ch: 'all', sev: 'all', kind: 'all', q: '' };
  return state.filters[cat];
}

function filteredIssues(cat) {
  const f = filterState(cat);
  const q = f.q.trim().toLowerCase();
  return visibleIssues(cat).filter((it) => {
    if (f.sev !== 'all' && it.sev !== f.sev) return false;
    if (f.kind !== 'all' && it.kind !== f.kind) return false;
    if (f.ch !== 'all' && !issueChapters(it).includes(+f.ch)) return false;
    if (q && !(it.msg.toLowerCase().includes(q) || (it.quotes || []).some((x) => x.text.toLowerCase().includes(q)))) return false;
    return true;
  });
}

function issueTabHtml(cat, { lead = true } = {}) {
  const c = CATS.find((x) => x.id === cat);
  const all = visibleIssues(cat);
  const f = filterState(cat);
  const kinds = [...new Set(all.map((i) => i.kind))].sort();
  const sevCount = (s) => all.filter((i) => i.sev === s).length;
  const chOpts = state.report.chapters.map((ch, i) => `<option value="${i}" ${String(f.ch) === String(i) ? 'selected' : ''}>${esc(ch.title)}</option>`).join('');
  return `
    <div class="stack" style="padding-top:16px">
      ${lead ? `<p class="section-lead">${esc(c.blurb)}</p>` : ''}
      <div class="filters" data-cat="${cat}">
        <label class="visually-hidden" for="f-ch-${cat}">Chapter</label>
        <select id="f-ch-${cat}" data-filter="ch"><option value="all">All chapters</option>${chOpts}</select>
        ${kinds.length > 1 ? `<label class="visually-hidden" for="f-kind-${cat}">Type</label>
        <select id="f-kind-${cat}" data-filter="kind"><option value="all">All types</option>${kinds.map((k) => `<option ${f.kind === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>` : ''}
        <label class="visually-hidden" for="f-q-${cat}">Search notes</label>
        <input type="search" id="f-q-${cat}" data-filter="q" placeholder="Search" value="${esc(f.q)}">
      </div>
      <div class="chips" data-cat="${cat}">
        ${[['all', 'All', all.length], ['high', 'Likely errors', sevCount('high')], ['medium', 'Check this', sevCount('medium')], ['low', 'Suggestions', sevCount('low')]]
          .map(([v, l, n]) => `<button class="chip" type="button" data-sev="${v}" aria-pressed="${f.sev === v}">${l} <span>${fmt(n)}</span></button>`).join('')}
      </div>
      <div id="list-${cat}">${issueListHtml(cat)}</div>
    </div>`;
}

function issueListHtml(cat) {
  const list = filteredIssues(cat);
  const shown = state.shown[cat] || PAGE;
  if (!visibleIssues(cat).length) {
    const msgs = { continuity: 'No contradictions found.', spelling: 'No spelling problems found.', grammar: 'No grammar problems found.', style: 'No style notes.' };
    return `<div class="empty">${msgs[cat]}</div>`;
  }
  if (!list.length) return '<div class="empty">No notes match these filters.</div>';
  return `<p class="result-count">Showing ${fmt(Math.min(shown, list.length))} of ${fmt(list.length)}</p>
    <div class="issues" style="margin-top:8px">${list.slice(0, shown).map(issueCard).join('')}</div>
    ${list.length > shown ? `<div class="more-row"><button class="btn" type="button" data-action="more" data-cat="${cat}">Show ${fmt(Math.min(PAGE, list.length - shown))} more</button></div>` : ''}`;
}

function issueCard(it) {
  const catLabel = CATS.find((c) => c.id === it.cat)?.label || '';
  const chs = issueChapters(it);
  let where = '';
  if (it.count > 1) where = `${it.count}× in ${chs.slice(0, 6).map(chShort).join(', ')}${chs.length > 6 ? ` and ${chs.length - 6} more` : ''}`;
  const sugg = (it.sugg && it.sugg.length) ? it.sugg : (it.fix ? [it.fix] : []);
  const actions = [];
  if (it.word && (it.kind === 'Spelling' || it.kind === 'Unknown name')) actions.push(`<button class="btn small" type="button" data-action="addword" data-word="${esc(it.word)}">Add “${esc(it.word)}” to my words</button>`);
  actions.push(`<button class="btn small ghost" type="button" data-action="ignore" data-id="${esc(it.id)}">Ignore</button>`);
  return `
    <article class="issue sev-${it.sev}">
      <div class="issue-top">
        <span class="sev ${it.sev}">${SEV_LABEL[it.sev]}</span>
        <span class="kind"><span class="dot ${it.cat}" title="${esc(catLabel)}"></span>${esc(it.kind)}</span>
        ${where ? `<span class="kind">${esc(where)}</span>` : ''}
      </div>
      <p class="issue-msg">${esc(it.msg)}</p>
      ${it.note ? `<p class="issue-note">${esc(it.note)}</p>` : ''}
      ${it.quotes && it.quotes.length ? `<div class="quotes">${it.quotes.map(quoteHtml).join('')}</div>` : ''}
      ${sugg.length ? `<div class="sugg"><span class="sugg-label">${it.cat === 'spelling' ? 'Suggestions' : 'Try'}</span>${sugg.map((s) => `<span class="sugg-word">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="issue-actions">${actions.join('')}</div>
    </article>`;
}

// --- characters

function charactersHtml() {
  const r = state.report;
  const n = r.chapters.length;
  const visible = r.characters.filter((c) => !state.hidden.includes(c.name));
  // Older saved reports have no person/place types: treat everyone as a person.
  const typeOf = (c) => (c.narrator ? 'person' : c.type === 'place' || c.type === 'other' ? 'place' : 'person');
  const nPeople = visible.filter((c) => typeOf(c) === 'person').length;
  const nPlaces = visible.length - nPeople;
  let list = visible.filter((c) => typeOf(c) === state.charType);
  const sorters = {
    mentions: (a, b) => b.mentions - a.mentions,
    first: (a, b) => (a.chapters[0] ?? 1e9) - (b.chapters[0] ?? 1e9) || b.mentions - a.mentions,
    name: (a, b) => a.name.localeCompare(b.name)
  };
  list = list.slice().sort((a, b) => (a.narrator ? -1 : b.narrator ? 1 : 0) || sorters[state.charSort](a, b));
  const shown = state.shown.characters || 30;
  const clashOwners = new Set(visibleIssues('continuity').map((i) => i.owner).filter(Boolean));

  const card = (c) => {
    const p = c.profile || {};
    const facts = [];
    const fact = (label, arr) => {
      if (!arr || !arr.length) return;
      const vals = [];
      for (const v of arr) if (!vals.some((x) => x.value === v.value)) vals.push(v);
      const clash = vals.length > 1 && clashOwners.has(c.name);
      facts.push(`<dt>${label}</dt><dd class="${clash ? 'clash' : ''}">${vals.map((v) => `${esc(v.value)} <span style="color:var(--ink-3);font-weight:400">(${esc(chShort(v.ch))})</span>`).join(', ')}</dd>`);
    };
    fact('Eyes', p.eyes); fact('Hair', p.hair); fact('Age', p.age); fact('Born', p.born);
    fact('Height', [...(p.height || []), ...(p.stature || [])]); fact('Build', p.build); fact('Hand', p.hand);
    fact('Marks', p.marks); fact('Glasses', p.glasses); fact('Accent', p.accent); fact('Family', p.family); fact('Owns', p.things);
    const max = Math.max(1, ...(c.counts || [0]));
    const strip = c.narrator ? '' : `
      <div class="strip-scroll"><div class="strip" style="min-width:${Math.min(n * 8, 2000)}px">${(c.counts || []).map((v, i) => `<span data-level="${v === 0 ? 0 : v / max > 0.66 ? 3 : v / max > 0.33 ? 2 : 1}" title="${esc(r.chapters[i].title)}: ${v}"></span>`).join('')}</div></div>
      <div class="strip-axis"><span>${esc(chShort(0))}</span><span>${esc(chShort(n - 1))}</span></div>`;
    const gap = c.gap && c.gap.len >= Math.max(3, Math.round(n * 0.2))
      ? `<p class="gap-note">Missing for ${c.gap.len} chapters, between ${esc(r.chapters[c.gap.from].title)} and ${esc(r.chapters[c.gap.to].title)}.</p>` : '';
    const g = c.gender === 'he' ? 'he/him' : c.gender === 'she' ? 'she/her' : '';
    return `
      <article class="person">
        <div class="person-top">
          <h3 class="person-name">${esc(c.full || c.name)}</h3>
          <span class="person-meta">${c.narrator ? 'First-person narrator (“I”)' : `${plural(c.mentions, 'mention')} · ${plural(c.chapters.length, 'chapter')}${g ? ' · ' + g : ''}${c.type === 'other' ? ' · person or place?' : ''}`}</span>
        </div>
        ${strip}
        ${gap}
        ${facts.length ? `<dl class="facts">${facts.join('')}</dl>` : ''}
        ${c.narrator || typeOf(c) !== 'person' ? '' : `<div><button class="btn small ghost" type="button" data-action="hide-name" data-name="${esc(c.name)}">Not a character</button></div>`}
      </article>`;
  };

  return `
    <div class="stack" style="padding-top:16px">
      <p class="section-lead">Names are sorted into people and places by how the book uses them (“Tom said”, “in Halden”). Tap “Not a character” to hide anything in the wrong list. The strip shows how often each one appears in each chapter.</p>
      <div class="chips" role="group" aria-label="Show">
        <button class="chip" type="button" data-action="char-type" data-type="person" aria-pressed="${state.charType === 'person'}">People <span>${fmt(nPeople)}</span></button>
        <button class="chip" type="button" data-action="char-type" data-type="place" aria-pressed="${state.charType === 'place'}">Places and other names <span>${fmt(nPlaces)}</span></button>
      </div>
      <div class="filters">
        <label for="char-sort" class="hint">Sort by</label>
        <select id="char-sort" data-action="char-sort">
          <option value="mentions" ${state.charSort === 'mentions' ? 'selected' : ''}>Most mentioned</option>
          <option value="first" ${state.charSort === 'first' ? 'selected' : ''}>First appearance</option>
          <option value="name" ${state.charSort === 'name' ? 'selected' : ''}>Name</option>
        </select>
      </div>
      ${list.length ? `<div class="people">${list.slice(0, shown).map(card).join('')}</div>` : `<div class="empty">${state.charType === 'person' ? 'No characters were found.' : 'No places or other names were found.'}</div>`}
      ${list.length > shown ? `<div class="more-row"><button class="btn" type="button" data-action="more-chars">Show more</button></div>` : ''}
    </div>`;
}

// --- timeline

function calendarLine(c) {
  const d = c.dates;
  if (!d || (!d.from && !d.year)) return '';
  let text;
  if (!d.from) text = String(d.year);
  else text = (d.exact ? '' : 'On or after ') + d.from + (d.to ? ' to ' + d.to : '');
  return `<span class="tl-date">${esc(text)}</span>`;
}

function timelineHtml() {
  const r = state.report;
  const tlIssues = visibleIssues('continuity').filter((i) => ['Timeline', 'Season', 'Time goes backwards', 'Age and year'].includes(i.kind));
  const rows = r.chapters.map((c, i) => {
    const items = (r.timeline[i] || []);
    const open = state.openQuote && state.openQuote[0] === i ? items[state.openQuote[1]] : null;
    return `
      <div class="tl-row">
        <div class="tl-ch">${esc(c.title)}${calendarLine(c)}</div>
        <div class="tl-items">${items.length ? items.map((m, k) => `<button class="tl-item ${m.kind}" type="button" data-action="tl" data-ch="${i}" data-k="${k}" aria-expanded="${!!(open && open === m)}">${esc(m.label)}</button>`).join('') : '<span class="tl-none">No dates or time jumps found</span>'}</div>
        ${open ? `<div class="tl-quote">${quoteHtml(open.quote)}</div>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="stack" style="padding-top:16px">
      <p class="section-lead">Every date, day of the week, season and time jump in each chapter. Under each chapter is the story’s date, worked out from the dates and time jumps so far. “On or after” means time may have passed that the text doesn’t mention. Tap a marker to see the sentence.</p>
      ${tlIssues.length ? `<div class="issues">${tlIssues.map(issueCard).join('')}</div>` : ''}
      <div class="tl">${rows}</div>
    </div>`;
}

// --- style

function povPanel() {
  const chs = state.report.chapters;
  if (!chs.some((c) => c.pov || c.tense)) return '';
  const POV = { first: 'First person', third: 'Third person', mixed: 'Mixed' };
  const TENSE = { past: 'past tense', present: 'present tense', mixed: 'mixed tense' };
  const rows = chs.map((c) => [c.title, [POV[c.pov], TENSE[c.tense]].filter(Boolean).join(', ') || 'Too short to tell']);
  return `<section class="panel">
    <h3>Point of view and tense</h3>
    <table class="wordlist"><tbody>${rows.map(([t, v]) => `<tr><td style="font-family:var(--f-body)">${esc(t)}</td><td class="n" style="width:auto;white-space:nowrap">${esc(v)}</td></tr>`).join('')}</tbody></table>
    <p>How each chapter is told. Sentences that slip out of it are listed under Continuity.</p>
  </section>`;
}

function styleHtml() {
  const s = state.report.style;
  const r = state.report;
  const read = s.flesch >= 80 ? 'Very easy to read' : s.flesch >= 70 ? 'Easy to read' : s.flesch >= 60 ? 'Plain English' : s.flesch >= 50 ? 'Fairly difficult' : 'Difficult';
  const words = r.stats.words || 1;
  const sorted = s.chapterWords.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const maxW = Math.max(1, ...s.chapterWords);
  const lens = r.chapters.map((c, i) => {
    const w = s.chapterWords[i];
    const out = r.chapters.length > 3 && (w > median * 2 || w < median * 0.4);
    return `<div class="lenbar" title="${esc(c.title)}"><span class="lenbar-name">${esc(c.title)}</span><span class="lenbar-track"><span class="${out ? 'out' : ''}" style="width:${(w / maxW) * 100}%"></span></span><span class="lenbar-val">${fmt(w)}</span></div>`;
  }).join('');
  const table = (rows, per = true) => rows.length
    ? `<table class="wordlist"><tbody>${rows.map((row) => `<tr><td>${esc(row[0])}</td><td class="n">${fmt(row[1])}${per && row[2] != null ? ` · ${row[2]}` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p>None found.</p>';
  const per1000 = (n) => Math.round((n / words) * 10000) / 10;

  return `
    <div class="stack" style="padding-top:16px;gap:16px">
      <p class="section-lead">How the book reads overall, followed by line-by-line suggestions. None of these are mistakes; they are habits worth checking.</p>
      <div class="panels">
        <section class="panel">
          <h3>Readability</h3>
          <div class="big">${s.flesch}<small>${read}</small></div>
          <div class="meter" aria-hidden="true"><i style="left:${Math.max(0, Math.min(100, s.flesch))}%"></i></div>
          <div class="stats">
            <div class="stat"><b>${s.avgSentence}</b><span>words per sentence</span></div>
            <div class="stat"><b>${s.dialoguePct}%</b><span>of the text is dialogue</span></div>
            <div class="stat"><b>${Math.max(1, Math.round(s.grade))}</b><span>US school grade level</span></div>
            <div class="stat"><b>${fmt(s.longSentences)}</b><span>sentences over 55 words</span></div>
          </div>
          <p>Flesch reading ease, from 0 (very hard) to 100 (very easy). Most popular fiction scores 70 to 90.</p>
        </section>
        ${povPanel()}
        <section class="panel">
          <h3>Chapter lengths</h3>
          <div class="lenbars">${lens}</div>
          <p>Median chapter: ${fmt(median)} words. Chapters far shorter or longer than the rest are marked.</p>
        </section>
        <section class="panel">
          <h3>Repeated phrases</h3>
          ${table(s.phrases)}
          <p>Phrases of three to five words that come back again and again.</p>
        </section>
        <section class="panel">
          <h3>Character gestures</h3>
          ${table(s.gestures.top.slice(0, 10))}
          <p>Count · uses per 1,000 words. Nodding, shrugging and sighing are easy to overuse.</p>
        </section>
        <section class="panel">
          <h3>Crutch words</h3>
          ${table(s.crutch.top.slice(0, 10))}
          <p>Count · uses per 1,000 words. Words like “just”, “really” and “suddenly” often can go.</p>
        </section>
        <section class="panel">
          <h3>Filter words</h3>
          <div class="big">${s.filters.per1000}<small>per 1,000 words</small></div>
          ${table(s.filters.top.slice(0, 8).map(([w, n]) => [w, n, per1000(n)]))}
          <p>“She saw the door open” puts distance between the reader and the scene. “The door opened” is often stronger.</p>
        </section>
        <section class="panel">
          <h3>Adverbs ending in -ly</h3>
          <div class="big">${s.adverbs.per1000}<small>per 1,000 words</small></div>
          ${table(s.adverbs.top.slice(0, 8).map(([w, n]) => [w, n, per1000(n)]))}
        </section>
        <section class="panel">
          <h3>Passive voice</h3>
          <div class="big">${fmt(s.passive.total)}<small>${s.passive.per1000} per 1,000 words</small></div>
          ${s.passive.examples.slice(0, 3).map(quoteHtml).join('')}
          <p>“The door was opened” hides who did it. Fine sometimes, but often weaker than “Mara opened the door”.</p>
        </section>
        ${s.tags.top.length ? `<section class="panel"><h3>Speech tags</h3>${table(s.tags.top.slice(0, 10), false)}<p>“Said” is nearly invisible to readers. Fancier tags draw attention to themselves.</p></section>` : ''}
        <section class="panel">
          <h3>Most used words</h3>
          ${table(s.topWords.slice(0, 12), false)}
          <p>Leaving out common words and names.</p>
        </section>
      </div>
      <h3 class="section-title">Line by line</h3>
      ${issueTabHtml('style', { lead: false })}
    </div>`;
}

// ------------------------------------------------------------------ copy as text

function reportAsText() {
  const r = state.report;
  const lines = [`${r.title}: Novel Checker report`, `${fmt(r.stats.words)} words, ${r.stats.chapters} chapters`, ''];
  for (const c of CATS) {
    const list = visibleIssues(c.id);
    if (!list.length) continue;
    lines.push(`== ${c.label.toUpperCase()} (${list.length}) ==`);
    for (const it of list) {
      const q = it.quotes && it.quotes[0];
      lines.push(`- [${SEV_LABEL[it.sev]}] ${it.msg}${q ? ` (${r.chapters[q.ch]?.title || ''}${q.pc ? ', paragraph ' + q.pc : ''})` : ''}`);
      if (q) lines.push(`    “${q.text}”`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ events

function setTab(id) {
  state.tab = id;
  renderTabs();
  renderPanel();
  const tab = $('#tab-' + id);
  const bar = $('.tabs-scroll');
  if (tab && bar) {
    // Scroll the tab strip sideways only, never the page.
    const l = tab.offsetLeft, r = l + tab.offsetWidth;
    if (l < bar.scrollLeft) bar.scrollLeft = l - 8;
    else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 8;
  }
  // If the tab bar is pinned, bring the top of the new tab's content into view.
  const panel = $('#panel');
  if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
}

function persistIgnored() { prefs.set('ignored', [...state.ignored]); }

function onReportClick(e) {
  const t = e.target.closest('[data-tab],[data-action],[data-sev]');
  if (!t) return;
  if (t.dataset.tab) { setTab(t.dataset.tab); return; }
  if (t.dataset.sev) {
    const cat = t.closest('[data-cat]').dataset.cat;
    filterState(cat).sev = t.dataset.sev;
    state.shown[cat] = PAGE;
    t.parentElement.querySelectorAll('[data-sev]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    $('#list-' + cat).innerHTML = issueListHtml(cat);
    return;
  }
  const a = t.dataset.action;
  if (a === 'ignore') {
    state.ignored.add(t.dataset.id);
    persistIgnored();
    const card = t.closest('.issue');
    card.remove();
    renderTabs();
    toast('Ignored. You can bring ignored notes back in Settings.');
    if (state.tab === 'overview') renderPanel();
  } else if (a === 'addword') {
    const w = t.dataset.word;
    if (!wordSet.has(w.toLowerCase())) { state.words.push(w); wordSet.add(w.toLowerCase()); prefs.set('words', state.words); }
    renderTabs();
    renderPanel();
    toast(`Added “${w}” to your words.`);
  } else if (a === 'hide-name') {
    state.hidden.push(t.dataset.name);
    prefs.set('hidden', state.hidden);
    renderTabs();
    renderPanel();
    toast(`“${t.dataset.name}” is hidden. It won’t be treated as a name next time either.`);
  } else if (a === 'more') {
    const cat = t.dataset.cat;
    state.shown[cat] = (state.shown[cat] || PAGE) + PAGE;
    $('#list-' + cat).innerHTML = issueListHtml(cat);
  } else if (a === 'char-type') {
    state.charType = t.dataset.type;
    state.shown.characters = 30;
    renderPanel();
  } else if (a === 'more-chars') {
    state.shown.characters = (state.shown.characters || 30) + 30;
    renderPanel();
  } else if (a === 'tl') {
    const key = [+t.dataset.ch, +t.dataset.k];
    state.openQuote = state.openQuote && state.openQuote[0] === key[0] && state.openQuote[1] === key[1] ? null : key;
    renderPanel();
  } else if (a === 'new') {
    $('#intake').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => $('#file-label').focus(), 400);
  } else if (a === 'copy') {
    const text = reportAsText();
    navigator.clipboard.writeText(text).then(() => toast('Report copied. Paste it into your notes or an email.'), () => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Report copied.'); } catch { toast('Copying isn’t allowed here.'); }
      ta.remove();
    });
  } else if (a === 'lt-stop') {
    stopLanguageTool();
    toast('Online grammar check stopped.');
  }
}

function onReportInput(e) {
  const t = e.target;
  if (t.dataset.action === 'char-sort') { state.charSort = t.value; renderPanel(); return; }
  const f = t.dataset.filter;
  if (!f) return;
  const cat = t.closest('[data-cat]').dataset.cat;
  filterState(cat)[f] = t.value;
  state.shown[cat] = PAGE;
  $('#list-' + cat).innerHTML = issueListHtml(cat);
}

// ------------------------------------------------------------------ dialogs

function openDialog(d) {
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}
function closeDialog(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }

function renderSettings() {
  $('#set-words').value = state.words.join('\n');
  $('#set-hidden').innerHTML = state.hidden.length
    ? state.hidden.map((n) => `<span class="tag">${esc(n)}<button type="button" data-unhide="${esc(n)}" aria-label="Show ${esc(n)} again">✕</button></span>`).join('')
    : '<span class="hint">Nothing hidden.</span>';
  $('#set-ignored-count').textContent = state.ignored.size ? `You have ignored ${plural(state.ignored.size, 'note')}.` : 'You haven’t ignored any notes.';
  $('#btn-restore-ignored').disabled = !state.ignored.size;
  $('#clear-confirm').hidden = true;
}

async function renderHistory() {
  const list = await history.list();
  $('#hist-list').innerHTML = list.length ? list.map((r) => {
    const c = countsByCat(r);
    const total = Object.values(c).reduce((n, x) => n + x.all, 0);
    const d = new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div class="hist-item">
      <span class="hist-title">${esc(r.title)}</span>
      <span class="hist-meta">${esc(d)} · ${fmt(r.stats.words)} words · ${plural(total, 'note')}</span>
      <span class="hist-actions"><button class="btn small" type="button" data-open="${esc(r.id)}">Open</button><button class="btn small ghost" type="button" data-del="${esc(r.id)}" aria-label="Delete ${esc(r.title)}">Delete</button></span>
    </div>`;
  }).join('') : '<div class="empty">No saved reports yet. Every manuscript you check is saved here, in this browser only.</div>';
}

// ------------------------------------------------------------------ start up

async function loadSample() {
  try {
    const res = await fetch('samples/salt-and-lantern.txt');
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    const body = text.replace(/^[\s\S]*?(?=Chapter 1)/, '');
    await runCheck({ title: 'Salt and Lantern', paragraphs: self.NovelAnalyzer.textToParagraphs(body), sample: true });
  } catch {
    $('#progress').hidden = true;
  }
}

function measureMasthead() {
  const h = $('.masthead')?.offsetHeight;
  if (h) document.documentElement.style.setProperty('--mast-h', h + 'px');
}

function init() {
  measureMasthead();
  window.addEventListener('resize', measureMasthead);
  $('#opt-dict').value = prefs.get('dict', 'en-US');
  $('#opt-lt').checked = !!prefs.get('lt', false);
  const updatePrivacy = () => {
    $('#privacy-text').textContent = $('#opt-lt').checked
      ? 'Your book is checked here in your browser. With the online grammar check on, its text is also sent to LanguageTool.'
      : 'Your book never leaves this device. Everything is checked here in your browser, with no AI and nothing to pay.';
  };
  updatePrivacy();
  $('#opt-dict').addEventListener('change', (e) => prefs.set('dict', e.target.value));
  $('#opt-lt').addEventListener('change', (e) => { prefs.set('lt', e.target.checked); updatePrivacy(); });

  $('#file').addEventListener('change', (e) => handleFile(e.target.files[0]));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

  $('#btn-paste').addEventListener('click', () => {
    const box = $('#paste-box');
    box.hidden = !box.hidden;
    $('#btn-paste').setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) $('#paste-text').focus();
  });
  $('#btn-cancel-paste').addEventListener('click', () => { $('#paste-box').hidden = true; $('#btn-paste').setAttribute('aria-expanded', 'false'); });
  $('#btn-check-paste').addEventListener('click', () => {
    const text = $('#paste-text').value;
    const first = text.trim().split('\n')[0].trim();
    const title = first && first.length < 60 && !/[.!?]$/.test(first) && !/^chapter\b/i.test(first) ? first : 'Pasted text';
    runCheck({ title, paragraphs: self.NovelAnalyzer.textToParagraphs(text) });
  });
  $('#btn-cancel').addEventListener('click', () => {
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    $('#progress').hidden = true;
    $('#report').hidden = !state.report;
    message('', '');
  });

  const report = $('#report');
  report.addEventListener('click', onReportClick);
  report.addEventListener('input', onReportInput);
  report.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') onReportInput(e); });
  report.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('tab')) return;
    const idx = TABS.findIndex((t) => t.id === state.tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = TABS[(idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
      setTab(next);
      $('#tab-' + next).focus();
    }
  });

  $('#brand').addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // Settings
  const dS = $('#dlg-settings');
  $('#btn-settings').addEventListener('click', () => { renderSettings(); openDialog(dS); });
  $('#btn-save-words').addEventListener('click', () => {
    state.words = [...new Set($('#set-words').value.split('\n').map((w) => w.trim()).filter(Boolean))];
    wordSet = new Set(state.words.map((w) => w.toLowerCase()));
    prefs.set('words', state.words);
    if (state.report) { renderTabs(); renderPanel(); }
    toast('Your words are saved.');
  });
  $('#set-hidden').addEventListener('click', (e) => {
    const n = e.target.closest('[data-unhide]')?.dataset.unhide;
    if (!n) return;
    state.hidden = state.hidden.filter((x) => x !== n);
    prefs.set('hidden', state.hidden);
    renderSettings();
    if (state.report) { renderTabs(); renderPanel(); }
  });
  $('#btn-restore-ignored').addEventListener('click', () => {
    state.ignored.clear(); persistIgnored(); renderSettings();
    if (state.report) { renderTabs(); renderPanel(); }
    toast('Ignored notes are back.');
  });
  $('#btn-clear-history').addEventListener('click', () => { $('#clear-confirm').hidden = false; });
  $('#btn-clear-yes').addEventListener('click', async () => {
    await history.clear(); prefs.set('last', null); $('#clear-confirm').hidden = true; toast('Saved reports deleted.');
  });

  // History
  const dH = $('#dlg-history');
  $('#btn-history').addEventListener('click', async () => { await renderHistory(); openDialog(dH); });
  $('#hist-list').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]')?.dataset.open;
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (open) {
      const r = await history.get(open);
      if (r) { stopLanguageTool(); state.chapterTexts = null; showReport(r); prefs.set('last', r.id); closeDialog(dH); $('#report').scrollIntoView({ behavior: 'smooth' }); }
    } else if (del) {
      await history.remove(del);
      if (state.report && state.report.id === del) prefs.set('last', null);
      renderHistory();
    }
  });
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => closeDialog(b.closest('dialog'))));
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) closeDialog(d); }));

  // Open the last report, or the example.
  (async () => {
    const last = prefs.get('last', null);
    const r = last ? await history.get(last) : null;
    if (r) showReport(r);
    else loadSample();
  })();

  if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
