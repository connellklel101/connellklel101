import { importFile } from './importers.js';
import { prefs, history } from './storage.js';
import { runLanguageTool } from './languagetool.js';
import { chapterParagraphs, noteLocations } from './annotate.js';
import { buildDocx } from './docx-export.js';

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
  text: null,
  reader: null,
  readerCache: null,
  bibleOpen: null,
  compareAll: false,
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

async function runCheck({ title, paragraphs, sample = false, source = null, sourceName = null }) {
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
    hiddenNames: state.hidden,
    bible: getBible(title),
    strictDialogue: !!prefs.get('strictDialogue', false),
    southern: !!prefs.get('southern', false)
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
      const gone = prev.issues.filter((i) => !curIds.has(i.id) && !state.ignored.has(i.id));
      report.issues.forEach((i) => { if (!prevIds.has(i.id)) i.isNew = true; });
      report.compare = {
        date: prev.createdAt,
        prevId: prev.id,
        prevTotal: prev.issues.filter((i) => !state.ignored.has(i.id)).length,
        fixed: gone.length,
        added: [...curIds].filter((id) => !prevIds.has(id)).length,
        fixedList: gone.slice(0, 400).map((i) => ({ id: i.id, cat: i.cat, kind: i.kind, sev: i.sev, msg: i.msg }))
      };
    }
    await history.save(report);
    await history.saveText({ id: report.id, paragraphs, source: source || null, sourceName: sourceName || null });
    prefs.set('last', report.id);
  }
  state.text = { id: report.id, paragraphs, source: source || null, sourceName: sourceName || null };
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
    const { title, paragraphs, source, sourceName } = await importFile(file, (label) => setProgress(label, 0.02));
    await runCheck({ title, paragraphs, source, sourceName });
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
  state.compareAll = false;
  state.bibleOpen = null;
  renderReport();
  // Reports opened from history: fetch the saved text so re-checking, reading and Word export work.
  if (!textReady()) ensureText().then((t) => { if (t && state.report === report) renderHeadActions(); });
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
      <div class="chips head-actions" id="head-actions"></div>
    </div>
    <div id="lt-status" hidden></div>
    <div class="tabs-scroll"><div class="tabs" role="tablist" id="tabs"></div></div>
    <div id="panel" role="tabpanel"></div>`;
  renderHeadActions();
  renderTabs();
  renderLtStatus();
  renderPanel();
}

function renderHeadActions() {
  const el = $('#head-actions');
  if (!el) return;
  const ready = textReady();
  const off = ready ? '' : 'disabled title="Upload the book again to use this"';
  el.innerHTML = `
    <button class="btn small primary" type="button" data-action="read" ${off}>Read with notes</button>
    <button class="btn small" type="button" data-action="export" ${off}>Download for Word</button>
    <button class="btn small" type="button" data-action="recheck" ${state.text && state.text.id === state.report.id ? '' : 'disabled title="Upload the book again to use this"'}>Check again</button>
    <button class="btn small" type="button" data-action="copy">Copy as text</button>
    <button class="btn small ghost" type="button" data-action="new">Check another file</button>`;
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
      ${compareHtml()}
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
    if (f.newOnly && !it.isNew) return false;
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
        ${state.report.compare ? `<button class="chip" type="button" data-action="new-only" aria-pressed="${!!f.newOnly}">New since last check <span>${fmt(all.filter((i) => i.isNew).length)}</span></button>` : ''}
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

function issueCard(it, { compact = false } = {}) {
  const catLabel = CATS.find((c) => c.id === it.cat)?.label || '';
  const chs = issueChapters(it);
  let where = '';
  if (it.count > 1) where = `${it.count}× in ${chs.slice(0, 6).map(chShort).join(', ')}${chs.length > 6 ? ` and ${chs.length - 6} more` : ''}`;
  const sugg = (it.sugg && it.sugg.length) ? it.sugg : (it.fix ? [it.fix] : []);
  const actions = [];
  if (it.word && (it.kind === 'Spelling' || it.kind === 'Unknown name')) actions.push(`<button class="btn small" type="button" data-action="addword" data-word="${esc(it.word)}">Add “${esc(it.word)}” to my words</button>`);
  if (!compact && textReady() && it.quotes && it.quotes.length) actions.unshift(`<button class="btn small" type="button" data-action="show-in-book" data-id="${esc(it.id)}">Show in the book</button>`);
  actions.push(`<button class="btn small ghost" type="button" data-action="ignore" data-id="${esc(it.id)}">Ignore</button>`);
  return `
    <article class="issue sev-${it.sev}">
      <div class="issue-top">
        <span class="sev ${it.sev}">${SEV_LABEL[it.sev]}</span>
        ${it.isNew && state.report && state.report.compare ? '<span class="new-chip">New</span>' : ''}
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

  const bible = getBible(r.title);
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
        ${bible[c.name] && bibleSummary(bible[c.name]) ? `<p class="bible-sum"><b>Story bible:</b> ${esc(bibleSummary(bible[c.name]))}</p>` : ''}
        ${state.bibleOpen === c.name ? bibleForm(c, bible[c.name]) : ''}
        ${c.narrator || typeOf(c) !== 'person' ? '' : `<div class="chips">${state.bibleOpen === c.name ? '' : `<button class="btn small" type="button" data-action="bible-open" data-name="${esc(c.name)}">${bible[c.name] ? 'Edit story bible' : 'Add to story bible'}</button>`}<button class="btn small ghost" type="button" data-action="hide-name" data-name="${esc(c.name)}">Not a character</button></div>`}
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

// ------------------------------------------------------------------ book text, story bible, saving files

const titleKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function getBible(title) { return prefs.get('bible:' + titleKey(title), {}) || {}; }
function setBible(title, b) { prefs.set('bible:' + titleKey(title), b); }

function textReady() {
  return !!(state.text && state.report && state.text.id === state.report.id && state.report.chapters.every((c) => Array.isArray(c.paras)));
}

async function ensureText() {
  const r = state.report;
  if (!r) return null;
  if (state.text && state.text.id === r.id) return state.text;
  if (!r.sample) {
    const t = await history.getText(r.id);
    if (t && state.report === r) { state.text = t; return t; }
  }
  return null;
}

async function recheck() {
  const r = state.report;
  const t = await ensureText();
  if (!t) { toast('This report’s text wasn’t saved. Upload the file again to re-check it.'); return; }
  await runCheck({ title: r.title, paragraphs: t.paragraphs, sample: r.sample, source: t.source || null, sourceName: t.sourceName });
}

// Offer a file to save: through claude.ai's download prompt when the page is viewed there, else a normal download.
async function saveFile(filename, blob) {
  let dl = null;
  try { dl = self.claude && typeof self.claude.use === 'function' ? await self.claude.use('downloads') : null; } catch { dl = null; }
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      toast('Your file is ready.');
      return true;
    } catch (e) {
      if (e && e.code === 'declined') return false;
      if (e && e.code === 'rate_limited') { toast('A save is already waiting for you to confirm.'); return false; }
      if (e && !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) {
        toast('The file couldn’t be saved here.');
        return false;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

const safeName = (s) => String(s || 'Manuscript').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Manuscript';

function noteText(it) {
  const cat = CATS.find((c) => c.id === it.cat)?.label || '';
  const lines = [`${cat} · ${SEV_LABEL[it.sev]} · ${it.kind}`, it.msg];
  if (it.note) lines.push(it.note);
  const sugg = (it.sugg && it.sugg.length) ? it.sugg : (it.fix ? [it.fix] : []);
  if (sugg.length) lines.push('Try: ' + sugg.join(', '));
  return lines.join('\n');
}

async function exportDocx(cats) {
  const r = state.report;
  const t = await ensureText();
  if (!t || !textReady()) { toast('Check the book again first, so its text is available.'); return; }
  const btn = $('#btn-export-go');
  btn.disabled = true;
  btn.textContent = 'Making your Word file…';
  try {
    const chParas = chapterParagraphs(r, t.paragraphs);
    const issues = visibleIssues().filter((i) => cats.has(i.cat));
    const locs = noteLocations(issues, r, chParas);
    const notes = locs.map((l) => ({ ch: l.ch, p: l.p, start: l.start, end: l.end, text: noteText(l.issue) }));
    const chapters = r.chapters.map((c, i) => ({ title: c.title, paragraphs: chParas[i] }));
    const { blob, placed } = await buildDocx({ title: r.title, chapters, notes, source: t.source || null, allParagraphs: t.paragraphs });
    closeDialog($('#dlg-export'));
    const ok = await saveFile(safeName(r.title) + ' - with notes.docx', blob);
    if (ok) toast(`Word file made with ${plural(placed, 'comment')}.`);
  } catch (e) {
    toast('The Word file couldn’t be made: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Make the Word file';
  }
}

async function exportReportText() {
  const r = state.report;
  await saveFile(safeName(r.title) + ' - report.txt', new Blob([reportAsText()], { type: 'text/plain' }));
}

// ------------------------------------------------------------------ reading view

function readerIssues() {
  const cats = state.reader.cats;
  return visibleIssues().filter((i) => cats.has(i.cat));
}

function openReader(ch, focusIssueId) {
  if (!textReady()) { toast('Check the book again to open the reading view.'); return; }
  state.reader = Object.assign(state.reader || { cats: new Set(CATS.map((c) => c.id)) }, { ch, focus: focusIssueId || null, openP: null });
  renderReader();
  openDialog($('#dlg-reader'));
}

function paraHtml(text, ranges) {
  const cuts = new Set([0, text.length]);
  for (const r of ranges) { cuts.add(Math.max(0, Math.min(text.length, r.start))); cuts.add(Math.max(0, Math.min(text.length, r.end))); }
  const pts = [...cuts].sort((a, b) => a - b);
  const rank = { high: 0, medium: 1, low: 2 };
  let html = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = text.slice(a, b);
    const active = ranges.filter((r) => r.start < b && r.end > a);
    if (!active.length) { html += esc(seg); continue; }
    active.sort((x, y) => rank[x.issue.sev] - rank[y.issue.sev]);
    const top = active[0].issue;
    html += `<mark class="hl ${top.cat} sev-${top.sev}" tabindex="0" role="button" data-ids="${esc([...new Set(active.map((r) => r.issue.id))].join(' '))}" title="${esc(active.map((r) => r.issue.msg).join('\n'))}">${esc(seg)}</mark>`;
  }
  return html;
}

function renderReader() {
  const r = state.report;
  const R = state.reader;
  if (!state.readerCache || state.readerCache.id !== r.id) state.readerCache = { id: r.id, paras: chapterParagraphs(r, state.text.paragraphs) };
  const chParas = state.readerCache.paras;
  const paras = chParas[R.ch] || [];
  const issues = readerIssues().filter((i) => issueChapters(i).includes(R.ch) || (i.quotes || []).some((q) => q.ch === R.ch));
  const locs = noteLocations(issues, r, chParas).filter((l) => l.ch === R.ch);
  const byP = new Map();
  for (const l of locs) { if (!byP.has(l.p)) byP.set(l.p, []); byP.get(l.p).push(l); }
  $('#reader-ch').innerHTML = r.chapters.map((c, i) => `<option value="${i}" ${i === R.ch ? 'selected' : ''}>${esc(c.title)}</option>`).join('');
  $('#reader-prev').disabled = R.ch <= 0;
  $('#reader-next').disabled = R.ch >= r.chapters.length - 1;
  $('#reader-cats').innerHTML = CATS.map((c) => `<button class="chip" type="button" data-rcat="${c.id}" aria-pressed="${R.cats.has(c.id)}"><span class="dot ${c.id}"></span>${c.label}</button>`).join('');
  const count = new Set(locs.map((l) => l.issue.id)).size;
  $('#reader-body').innerHTML = `
    <h2 class="reader-title">${esc(r.chapters[R.ch].title)}</h2>
    <p class="hint" style="text-align:center;margin:0 0 24px">${count ? `${plural(count, 'note')} in this chapter. Tap underlined text to read a note.` : 'No notes in this chapter.'}</p>
    ${paras.map((pp, i) => `<p class="r-para" data-p="${i}" id="rp-${i}">${paraHtml(pp.text, byP.get(i) || [])}</p><div class="r-notes" id="rn-${i}" hidden></div>`).join('')}`;
  if (R.focus) {
    const l = locs.find((x) => x.issue.id === R.focus);
    R.focus = null;
    if (l) setTimeout(() => { showReaderNotes(l.p, [l.issue.id]); $('#rp-' + l.p).scrollIntoView({ block: 'center' }); }, 30);
  } else {
    $('#reader-body').scrollTop = 0;
  }
}

function showReaderNotes(p, ids) {
  document.querySelectorAll('#reader-body .r-notes').forEach((n) => { n.hidden = true; n.innerHTML = ''; });
  const box = $('#rn-' + p);
  if (!box) return;
  const list = state.report.issues.filter((i) => ids.includes(i.id));
  box.innerHTML = list.map((it) => issueCard(it, { compact: true })).join('');
  box.hidden = false;
}

// ------------------------------------------------------------------ since the last check

function compareHtml() {
  const c = state.report.compare;
  if (!c) return '';
  const d = new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fixed = (c.fixedList || []).filter((i) => !state.ignored.has(i.id));
  const added = visibleIssues().filter((i) => i.isNew);
  const showAll = state.compareAll;
  const li = (i) => `<li><span class="dot ${i.cat}"></span><span><b>${esc(i.kind)}:</b> ${esc(i.msg)}</span></li>`;
  return `
    <section class="compare-box">
      <div class="compare-head">
        <h3 class="section-title">Since your check on ${esc(d)}</h3>
        <p class="section-lead"><b class="good">${plural(c.fixed, 'note')} gone</b> and <b class="${added.length ? 'bad' : 'good'}">${plural(added.length, 'new note')}</b>.</p>
      </div>
      <div class="two-col">
        <div class="stack"><h4 class="mini-title">Gone</h4>${fixed.length ? `<ul class="clist">${fixed.slice(0, showAll ? 400 : 6).map(li).join('')}</ul>` : '<p class="hint">Nothing has gone since last time.</p>'}</div>
        <div class="stack"><h4 class="mini-title">New</h4>${added.length ? `<ul class="clist">${added.slice(0, showAll ? 400 : 6).map(li).join('')}</ul>` : '<p class="hint">Nothing new. Well done.</p>'}</div>
      </div>
      ${(fixed.length > 6 || added.length > 6) && !showAll ? '<div><button class="btn small" type="button" data-action="compare-all">Show every change</button></div>' : ''}
    </section>`;
}

// ------------------------------------------------------------------ story bible editor

const BIBLE_FIELDS = [
  ['pronouns', 'Pronouns', 'select', ['', 'he', 'she', 'they']],
  ['eyes', 'Eye colour', 'text'], ['hair', 'Hair colour', 'text'],
  ['born', 'Year born', 'text'],
  ['height', 'Height', 'select', ['', 'tall', 'short']], ['build', 'Build', 'select', ['', 'slim', 'heavy']],
  ['hand', 'Writes with', 'select', ['', 'left', 'right']], ['glasses', 'Glasses', 'select', ['', 'yes', 'no']],
  ['accent', 'Accent', 'text'], ['marks', 'Scars, tattoos', 'text'], ['notes', 'Other notes', 'textarea']
];

function bibleSummary(b) {
  const parts = [];
  for (const [k, label] of BIBLE_FIELDS) if (b && b[k] && k !== 'notes') parts.push(`${label.toLowerCase()}: ${b[k]}`);
  return parts.join(' · ');
}

function bibleForm(c, b) {
  const id = (k) => `bb-${titleKey(c.name).replace(/ /g, '-')}-${k}`;
  const p = c.profile || {};
  const guess = (arr) => (arr && arr[0] ? arr[0].value : '');
  const hints = { eyes: guess(p.eyes), hair: guess(p.hair), born: guess(p.born), accent: guess(p.accent), marks: guess(p.marks) };
  return `<form class="bible-form" data-name="${esc(c.name)}">
    <p class="hint">Write down the facts you’ve decided. Next time you check the book, anything that disagrees is flagged under Continuity as “Story bible”.</p>
    <div class="bible-grid">
    ${BIBLE_FIELDS.map(([k, label, type, opts]) => {
      const v = (b && b[k]) || '';
      let input;
      if (type === 'select') input = `<select id="${id(k)}" name="${k}">${opts.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${o ? o : (k === 'pronouns' ? 'Work it out' : 'Not set')}</option>`).join('')}</select>`;
      else if (type === 'textarea') input = `<textarea id="${id(k)}" name="${k}" rows="2">${esc(v)}</textarea>`;
      else input = `<input type="text" id="${id(k)}" name="${k}" value="${esc(v)}" placeholder="${esc(hints[k] ? 'Book says: ' + hints[k] : '')}">`;
      return `<label class="bible-field ${type === 'textarea' ? 'wide' : ''}" for="${id(k)}"><span>${label}</span>${input}</label>`;
    }).join('')}
    </div>
    <div class="chips"><button class="btn small primary" type="submit">Save</button><button class="btn small ghost" type="button" data-action="bible-close">Cancel</button></div>
  </form>`;
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
    if (t.closest('#dlg-reader')) { renderReader(); renderTabs(); renderPanel(); return; }
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
  } else if (a === 'read') {
    const first = state.report.chapters.findIndex((c, i) => visibleIssues().some((it) => issueChapters(it).includes(i)));
    openReader(Math.max(0, first));
  } else if (a === 'show-in-book') {
    const it = state.report.issues.find((i) => i.id === t.dataset.id);
    if (it) openReader(it.quotes[0].ch, it.id);
  } else if (a === 'export') {
    openDialog($('#dlg-export'));
  } else if (a === 'recheck') {
    recheck();
  } else if (a === 'compare-all') {
    state.compareAll = true;
    renderPanel();
  } else if (a === 'new-only') {
    const cat = t.closest('[data-cat]').dataset.cat;
    filterState(cat).newOnly = !filterState(cat).newOnly;
    t.setAttribute('aria-pressed', String(filterState(cat).newOnly));
    state.shown[cat] = PAGE;
    $('#list-' + cat).innerHTML = issueListHtml(cat);
  } else if (a === 'bible-open') {
    state.bibleOpen = t.dataset.name;
    renderPanel();
    const f = document.querySelector('.bible-form');
    if (f) { f.scrollIntoView({ block: 'nearest' }); const first = f.querySelector('select,input'); if (first) first.focus(); }
  } else if (a === 'bible-close') {
    state.bibleOpen = null;
    renderPanel();
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

  // Reading view
  const dR = $('#dlg-reader');
  const go = (ch) => { state.reader.ch = ch; state.reader.focus = null; renderReader(); };
  $('#reader-prev').addEventListener('click', () => go(state.reader.ch - 1));
  $('#reader-next').addEventListener('click', () => go(state.reader.ch + 1));
  $('#reader-ch').addEventListener('change', (e) => go(+e.target.value));
  dR.addEventListener('click', (e) => {
    const mark = e.target.closest('mark.hl');
    if (mark) { showReaderNotes(+mark.closest('.r-para').dataset.p, mark.dataset.ids.split(' ')); return; }
    const chip = e.target.closest('[data-rcat]');
    if (chip) {
      const c = chip.dataset.rcat;
      if (state.reader.cats.has(c)) state.reader.cats.delete(c); else state.reader.cats.add(c);
      renderReader();
      return;
    }
    const act = e.target.closest('[data-action]');
    if (act) {
      onReportClick(e);
      if (act.dataset.action === 'addword') renderReader();
    }
  });
  dR.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('mark.hl')) { e.preventDefault(); e.target.click(); }
  });

  // Word download
  $('#btn-export-go').addEventListener('click', () => {
    const cats = new Set([...document.querySelectorAll('#export-cats input:checked')].map((x) => x.value));
    if (!cats.size) { toast('Choose at least one kind of note.'); return; }
    exportDocx(cats);
  });

  // Story bible
  report.addEventListener('submit', (e) => {
    const form = e.target.closest('.bible-form');
    if (!form) return;
    e.preventDefault();
    const b = getBible(state.report.title);
    const entry = {};
    for (const el of form.querySelectorAll('[name]')) if (el.value.trim()) entry[el.name] = el.value.trim();
    if (Object.keys(entry).length) b[form.dataset.name] = entry; else delete b[form.dataset.name];
    setBible(state.report.title, b);
    state.bibleOpen = null;
    renderPanel();
    toast(textReady() || (state.text && state.text.id === state.report.id) ? 'Saved. Tap “Check again” to compare the book with your story bible.' : 'Saved. It will be used the next time you check this book.');
  });

  // Settings
  const dS = $('#dlg-settings');
  $('#set-strict-dialogue').checked = !!prefs.get('strictDialogue', false);
  $('#set-southern').checked = !!prefs.get('southern', false);
  $('#set-strict-dialogue').addEventListener('change', (e) => prefs.set('strictDialogue', e.target.checked));
  $('#set-southern').addEventListener('change', (e) => prefs.set('southern', e.target.checked));
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
      if (r) { stopLanguageTool(); state.chapterTexts = null; state.text = null; showReport(r); prefs.set('last', r.id); closeDialog(dH); $('#report').scrollIntoView({ behavior: 'smooth' }); }
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
