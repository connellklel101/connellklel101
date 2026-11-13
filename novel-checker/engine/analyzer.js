/*
 * Novel Checker analysis engine.
 * Plain rules and word lists only: no AI, no network. Runs inside a Web Worker
 * in the browser, and in Node for the tests (see tests/run.mjs).
 *
 * Input:  paragraphs [{t: text, h: headingLevel (0 = body), b: true at a new file in an EPUB}]
 * Output: a report object (see analyze()).
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ word lists

  const STOP = new Set((
    'a about above after again against all am an and any are as at be because been before being below between both but by ' +
    'can could did do does doing down during each few for from further had has have having he her here hers herself him ' +
    'himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other ' +
    'our ours ourselves out over own same she should so some such than that the their theirs them themselves then there ' +
    'these they this those through to too under until up very was we were what when where which while who whom why will ' +
    'with would you your yours yourself yourselves said say says like back get got go went might must shall upon also onto ' +
    'even still yet ever never always one two away around again something nothing anything thing things way time made make ' +
    'know knew see saw come came look looked going little much many well right left last first next ' +
    "i'm i'd i'll i've don't didn't can't couldn't wasn't isn't won't wouldn't it's that's there's he's she's you're they're we're"
  ).split(/\s+/));

  const CAP_STOP = new Set((
    'I Mr Mrs Ms Mx Dr Miss Sir Madam Lord Lady Saint St Prof Sr Jr Capt Lt Col Gen Sgt Rev ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August ' +
    'September October November December Christmas Easter Halloween Thanksgiving God Chapter Part Prologue Epilogue ' +
    'OK Okay Oh Ah Hey Hi Hello Yes No Yeah Nope Please Thanks English French German Spanish Italian American British ' +
    'Irish Scottish Welsh Chinese Japanese Russian European African Asian TV The A An And But Then When What Why How ' +
    'Where Who Which If So It He She They We You His Her Their Our My Its This That These Those There Here'
  ).split(/\s+/));

  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Colour words map to one or more colour "families". Two descriptions clash
  // when they share no family and no compatible pair.
  const EYE_COLOURS = {
    blue: ['blue', 'cornflower', 'sapphire', 'azure', 'cerulean', 'cobalt', 'aquamarine', 'turquoise'],
    green: ['green', 'emerald', 'jade', 'turquoise', 'aquamarine'],
    grey: ['grey', 'gray', 'silver', 'silvery', 'steel', 'steely', 'slate', 'pewter'],
    brown: ['brown', 'chocolate', 'chestnut', 'coffee', 'umber', 'mahogany', 'walnut', 'toffee'],
    hazel: ['hazel'],
    amber: ['amber', 'golden', 'gold', 'honey', 'topaz', 'whisky', 'whiskey'],
    black: ['black', 'onyx', 'obsidian', 'inky', 'jet'],
    violet: ['violet', 'purple', 'lavender', 'lilac'],
    dark: ['dark']
  };
  const EYE_COMPAT = [['hazel', 'brown'], ['hazel', 'green'], ['hazel', 'amber'], ['amber', 'brown'], ['black', 'brown'],
    ['dark', 'brown'], ['dark', 'black'], ['dark', 'hazel']];

  const HAIR_COLOURS = {
    blond: ['blond', 'blonde', 'golden', 'gold', 'flaxen', 'fair', 'platinum', 'honey', 'sandy', 'straw', 'wheat', 'strawberry', 'butter'],
    brown: ['brown', 'brunette', 'chestnut', 'mousy', 'mousey', 'coffee', 'chocolate', 'caramel', 'toffee', 'auburn', 'sandy'],
    black: ['black', 'raven', 'jet', 'ebony', 'inky', 'coal'],
    red: ['red', 'ginger', 'auburn', 'copper', 'coppery', 'russet', 'strawberry', 'titian', 'carrot', 'flame', 'crimson', 'scarlet'],
    grey: ['grey', 'gray', 'silver', 'silvery', 'white', 'grizzled', 'iron'],
    dark: ['dark']
  };
  const HAIR_COMPAT = [['dark', 'brown'], ['dark', 'black']];

  const LINKING = new Set(['was', 'were', 'is', 'are', 'looked', 'seemed', 'gleamed', 'shone', 'glinted', 'flashed', 'glittered',
    'burned', 'burnt', 'sparkled', 'turned', 'went', 'had', 'been', 'became', 'appeared', 'remained', 'stayed', 'glowed']);
  const SCAN_STOP = new Set(['and', 'but', 'as', 'like', 'than', 'with', 'while', 'when', 'because', 'though', 'although', 'yet']);
  const DETERMINERS = new Set(['the', 'a', 'an', 'those', 'these', 'its', 'whose', 'two', 'pair', 'of']);

  const ADVERB_NOT = new Set(('only family early reply supply apply fly holy ugly belly lily rely ally bully jelly silly lonely ' +
    'friendly lovely likely daily weekly monthly yearly costly deadly elderly lively orderly smelly sly july italy emily ' +
    'molly sally billy holly polly kelly hilly curly chilly jolly wobbly woolly burly surly gully rally tally folly ' +
    'assembly anomaly monopoly melancholy butterfly dragonfly firefly bodily manly womanly cowardly kindly ghostly ' +
    'ugly unlikely unruly comely homely cuddly prickly bubbly crinkly wrinkly sickly stately timely untimely ' +
    'scholarly brotherly sisterly motherly fatherly worldly heavenly wily oily doily lowly holy hourly').split(' '));

  const FILTER_WORDS = ['saw', 'heard', 'felt', 'noticed', 'realized', 'realised', 'wondered', 'watched', 'seemed', 'decided',
    'knew', 'thought', 'could see', 'could hear', 'could feel'];
  const CRUTCH_WORDS = ['just', 'really', 'very', 'suddenly', 'actually', 'basically', 'quite', 'rather', 'somehow', 'simply',
    'literally', 'totally', 'almost', 'slightly', 'began to', 'started to', 'that'];
  const GESTURES = ['nodded', 'shrugged', 'sighed', 'smiled', 'grinned', 'glanced', 'frowned', 'gazed', 'stared', 'blinked',
    'swallowed', 'winced', 'smirked', 'chuckled', 'laughed', 'turned', 'looked', 'breathed', 'gasped', 'paused'];
  const TAG_VERBS = 'said|asked|replied|answered|whispered|shouted|muttered|murmured|called|cried|snapped|added|continued|explained|yelled|hissed|growled|told';
  const ACTION_VERBS = 'said|says|asked|replied|answered|shouted|whispered|laughed|smiled|nodded|walked|ran|grinned|turned|' +
    'looked|called|stood|sat|frowned|shrugged|sighed|spoke|waved|entered|arrived|appeared|winked|muttered|stepped|reached|' +
    'took|handed|grabbed|opened|closed|watched|leaned|knocked|came|went';

  const ADJ_ED = new Set(('tired scared worried excited interested bored married surprised pleased annoyed frightened terrified ' +
    'exhausted confused embarrassed amazed ashamed relieved disappointed determined convinced supposed used alarmed startled ' +
    'stunned shocked satisfied delighted horrified puzzled concerned involved prepared finished naked wicked sacred rugged ' +
    'crooked ragged beloved hundred red bed shed need speed seed bleed feed weed greed indeed tied dead gone closed locked ' +
    'cracked crowded dressed drunk engaged exposed fixed hooked insulated isolated mixed qualified related reserved retired ' +
    'scattered settled skilled spoiled stuffed talented trapped twisted unarmed unexpected unmarried unnamed unwanted ' +
    'armed blessed cursed doomed ruined soaked stained stoned wrecked lined curved shaped sized aged unaware awed bored ' +
    'unafraid afraid upset gifted hurried tangled flushed').split(' '));
  const IRREG_PART = new Set(('written taken given seen done made known shown thrown broken chosen driven eaten forgotten ' +
    'frozen hidden spoken stolen sworn torn worn woken beaten bitten held kept left lost built caught taught brought bought ' +
    'found heard told sold sent spent paid hit hurt shut struck hung led fed met bound shot grown drawn sewn sown slain ' +
    'forbidden forgiven overtaken shaken mistaken undertaken withdrawn').split(' '));

  const ABBR = new Set(['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'St', 'Prof', 'Sr', 'Jr', 'Capt', 'Lt', 'Col', 'Gen', 'Sgt', 'Rev', 'Mt',
    'vs', 'etc', 'e.g', 'i.e', 'a.m', 'p.m', 'No', 'Fig', 'approx', 'Ave', 'Rd']);

  const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const ORD_ONES = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
    eighteenth: 18, nineteenth: 19 };
  const ORD_TENS = { twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90 };
  const NUM_WORD = '(?:\\d{1,3}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)';
  const ORD_WORD = '(?:\\d{1,3}(?:st|nd|rd|th)|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth)';

  function parseNum(s) {
    s = s.toLowerCase().trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s in ONES) return ONES[s];
    const m = s.match(/^([a-z]+)(?:[- ]([a-z]+))?$/);
    if (m && m[1] in TENS) return TENS[m[1]] + (m[2] ? (ONES[m[2]] || 0) : 0);
    return null;
  }
  function parseOrd(s) {
    s = s.toLowerCase().trim();
    let m = s.match(/^(\d+)(st|nd|rd|th)$/);
    if (m) return parseInt(m[1], 10);
    if (s in ORD_ONES) return ORD_ONES[s];
    if (s in ORD_TENS) return ORD_TENS[s];
    m = s.match(/^([a-z]+)[- ]([a-z]+)$/);
    if (m && m[1] in TENS && m[2] in ORD_ONES) return TENS[m[1]] + ORD_ONES[m[2]];
    return null;
  }

  // ------------------------------------------------------------------ helpers

  const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;
  const isUpper = (c) => c !== c.toLowerCase() && c === c.toUpperCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function dl(a, b) { // Damerau-Levenshtein (optimal string alignment)
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 3;
    const d = [];
    for (let i = 0; i <= m; i++) { d[i] = [i]; }
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[m][n];
  }

  // Rough "sounds the same" key: Katherine and Catherine both become "katerin".
  function soundKey(w) {
    return w.toLowerCase().replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'kw').replace(/c(?=[aouhlrkt]|$)/g, 'k')
      .replace(/c(?=[eiy])/g, 's').replace(/x/g, 'ks').replace(/z/g, 's').replace(/y/g, 'i').replace(/(?!^)h/g, '')
      .replace(/(.)\1+/g, '$1').replace(/e$/, '');
  }

  function syllables(w) {
    w = w.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const m = w.match(/[aeiouy]{1,2}/g);
    return m ? m.length : 1;
  }

  function wordCount(text) { const m = text.match(WORD_RE); return m ? m.length : 0; }

  // Cut a sentence down to a readable quote around [s, e).
  function makeQuote(S, s, e) {
    const text = S.text;
    const MAX = 240;
    if (s == null) { s = 0; e = 0; }
    if (text.length <= MAX) return { ch: S.ch, pc: S.pc, text, mark: e > s ? [s, e] : null };
    let a = Math.max(0, s - 100), b = Math.min(text.length, Math.max(e, s) + 120);
    if (a > 0) { const sp = text.indexOf(' ', a); if (sp > -1 && sp < s) a = sp + 1; }
    if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > e) b = sp; }
    const prefix = a > 0 ? '…' : '';
    const suffix = b < text.length ? '…' : '';
    const out = prefix + text.slice(a, b) + suffix;
    return { ch: S.ch, pc: S.pc, text: out, mark: e > s ? [s - a + prefix.length, e - a + prefix.length] : null };
  }

  // ------------------------------------------------------------------ chapters

  const CH_RE = /^(?:chapter|ch\.)\s+(?:\d+|[ivxlcdm]+|[a-z]+(?:[- ][a-z]+)?)\b/i;
  const SPECIAL_RE = /^(?:prologue|epilogue|interlude|preface|foreword|afterword|introduction)\b/i;
  const PART_RE = /^part\s+(?:\d+|[ivxlcdm]+|[a-z]+)\b/i;
  const BARE_NUM_RE = /^(?:\d{1,3}|[IVXLC]{1,7})\.?$/;
  const SCENE_BREAK_RE = /^[\s*#~•·◆◇—–-]{1,20}$/;

  function isChapterHeading(t) {
    t = t.trim();
    if (t.length > 80 || !t) return false;
    return CH_RE.test(t) || SPECIAL_RE.test(t) || BARE_NUM_RE.test(t);
  }

  function splitChapters(paragraphs) {
    const paras = paragraphs.map((p, i) => ({ t: (p.t || '').replace(/\s+/g, ' ').trim(), h: p.h || 0, b: !!p.b, i }))
      .filter((p) => p.t && !SCENE_BREAK_RE.test(p.t));
    let starts = [];
    const regexHits = paras.filter((p) => isChapterHeading(p.t) && (wordCount(p.t) <= 14) &&
      (CH_RE.test(p.t) || SPECIAL_RE.test(p.t) ? !/[,;]$/.test(p.t) : true));
    // A bare number counts only when there are several and real chapter words are missing.
    const strong = regexHits.filter((p) => !BARE_NUM_RE.test(p.t));
    if (strong.length >= 2) starts = strong;
    else if (regexHits.length >= 3) starts = regexHits;
    else {
      const headed = paras.filter((p) => p.h > 0 && p.h <= 2 && p.t.length <= 100);
      if (headed.length >= 2) starts = headed;
      else {
        const files = paras.filter((p) => p.b);
        if (files.length >= 2) starts = files;
      }
    }

    const chapters = [];
    const startSet = new Set(starts.map((p) => p.i));
    const byStart = starts.length > 0;
    let current = null;
    let pendingPart = '';
    const front = { title: 'Opening pages', paras: [], headingParas: [] };

    for (let k = 0; k < paras.length; k++) {
      const p = paras[k];
      if (byStart && startSet.has(p.i)) {
        const isFileBoundary = !isChapterHeading(p.t) && !(p.h > 0);
        let title = isFileBoundary ? '' : p.t;
        current = { title, paras: [] };
        if (isFileBoundary) { current.paras.push(p); current.title = p.t.length < 70 ? p.t : ''; }
        // "Chapter 3" followed by a short subtitle line such as "The Storm".
        const next = paras[k + 1];
        if (!isFileBoundary && next && !startSet.has(next.i) && next.t.length < 60 && !/[.!?,;:]["”’]?$/.test(next.t) &&
          /^(?:chapter|ch\.)\s+\S+$|^\d+\.?$|^[IVXLC]+\.?$/i.test(p.t.trim())) {
          current.title = p.t + ': ' + next.t;
          k++;
        }
        if (pendingPart) { current.title = pendingPart + ' · ' + current.title; pendingPart = ''; }
        chapters.push(current);
        continue;
      }
      if (PART_RE.test(p.t) && p.t.length < 60 && byStart) {
        const nxt = paras[k + 1];
        if (nxt && startSet.has(nxt.i)) { pendingPart = p.t; continue; }
      }
      if (current) current.paras.push(p); else front.paras.push(p);
    }

    let out = chapters;
    const frontWords = front.paras.reduce((n, p) => n + wordCount(p.t), 0);
    if (!byStart) {
      // No chapter headings: split long texts into sections so references stay useful.
      const total = frontWords;
      if (total > 8000) {
        out = [];
        let sec = null, words = 0;
        for (const p of front.paras) {
          if (!sec || words >= 5000) { sec = { title: 'Section ' + (out.length + 1), paras: [] }; out.push(sec); words = 0; }
          sec.paras.push(p); words += wordCount(p.t);
        }
      } else {
        out = [{ title: 'Whole text', paras: front.paras }];
      }
    } else if (frontWords >= 50) {
      out = [front].concat(chapters);
    }
    out = out.filter((c) => c.paras.length > 0);
    out.forEach((c, n) => { if (!c.title) c.title = 'Chapter ' + (n + 1); c.title = c.title.slice(0, 90); });
    return out.map((c) => ({ title: c.title, paragraphs: c.paras.map((p) => p.t), source: c.paras.map((p) => p.i) }));
  }

  // Plain text or Markdown -> paragraphs.
  function textToParagraphs(text) {
    text = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    const hasBlank = /\n[ \t]*\n/.test(text);
    const out = [];
    const pushLine = (line) => {
      let t = line.trim();
      if (!t) return;
      let h = 0;
      const md = t.match(/^(#{1,6})\s+(.*)$/);
      if (md) { h = md[1].length; t = md[2].trim(); }
      out.push({ t, h });
    };
    if (!hasBlank) { text.split('\n').forEach(pushLine); return out; }
    for (const block of text.split(/\n[ \t]*\n/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      // A heading line directly followed by text without a blank line.
      if (lines.length > 1 && (isChapterHeading(lines[0]) || /^#{1,6}\s/.test(lines[0].trim()))) { pushLine(lines.shift()); }
      // Poetry, letters or one-line-per-paragraph text: keep short indented lines apart.
      if (lines.length > 1 && lines.every((l) => /^\s{2,}|^\t/.test(l))) { lines.forEach(pushLine); continue; }
      pushLine(lines.join(' ').replace(/(\w)-\s+(\w)/g, (m, a, b) => (/[a-z]/.test(a) && /[a-z]/.test(b) ? a + b : m)));
    }
    return out;
  }

  // ------------------------------------------------------------------ sentence model

  function splitSentences(p) {
    const out = [];
    const re = /[.!?…]+["'”’)\]]*\s+(?=["'“‘(\[—–-]?\s?[A-Z0-9À-Ö])/g;
    let last = 0, m;
    while ((m = re.exec(p))) {
      const end = m.index + m[0].length;
      if (p[m.index] === '.' && p[m.index + 1] !== '.') {
        const w = p.slice(Math.max(0, m.index - 8), m.index).match(/([A-Za-z.]+)$/);
        if (w && (ABBR.has(w[1]) || /^[A-Z]$/.test(w[1]))) continue;
      }
      const t = p.slice(last, end);
      if (t.trim()) out.push({ text: t.trimEnd(), start: last });
      last = end;
    }
    if (last < p.length && p.slice(last).trim()) out.push({ text: p.slice(last).trimEnd(), start: last });
    return out;
  }

  function dialogueSpans(p, mode) {
    const spans = [];
    let open = -1;
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (mode === 'double') {
        if (c === '“') { if (open < 0) open = i; }
        else if (c === '”') { if (open >= 0) { spans.push([open, i + 1]); open = -1; } else if (!spans.length) spans.push([0, i + 1]); }
        else if (c === '"') { if (open < 0) open = i; else { spans.push([open, i + 1]); open = -1; } }
      } else {
        const prev = p[i - 1] || ' ';
        const next = p[i + 1] || ' ';
        if (c === '‘' && /[\s—–(-]/.test(prev)) { if (open < 0) open = i; }
        else if ((c === '’' || c === "'") && open >= 0 && /[\s.,!?;:—–)-]/.test(next) && !/[a-z]s$/i.test(p.slice(i - 2, i))) {
          spans.push([open, i + 1]); open = -1;
        } else if (c === "'" && open < 0 && /[\s—–(-]/.test(prev) && /[A-Za-z]/.test(next)) open = i;
      }
    }
    if (open >= 0) spans.push([open, p.length]);
    return spans;
  }

  function buildModel(chapters) {
    const allText = chapters.map((c) => c.paragraphs.join('\n')).join('\n');
    const dq = (allText.match(/[“"]/g) || []).length;
    const sq = (allText.match(/(^|[\s—–(])‘/gm) || []).length;
    const quoteMode = dq >= sq ? 'double' : 'single';
    const sentences = [];
    const paragraphs = [];
    chapters.forEach((c, ch) => {
      c.paragraphs.forEach((pt, pc) => {
        const spans = dialogueSpans(pt, quoteMode);
        const P = { text: pt, ch, pc: pc + 1, spans, sIdx: [] };
        const pIndex = paragraphs.length;
        paragraphs.push(P);
        for (const s of splitSentences(pt)) {
          const S = { text: s.text, ch, pc: pc + 1, p: pIndex, idx: sentences.length, tokens: [], dlg: [] };
          for (const [a, b] of spans) {
            const x = Math.max(a, s.start) - s.start, y = Math.min(b, s.start + s.text.length) - s.start;
            if (y > x) S.dlg.push([x, y]);
          }
          let m;
          WORD_RE.lastIndex = 0;
          while ((m = WORD_RE.exec(s.text))) {
            const w = m[0].replace(/’/g, "'");
            const before = s.text.slice(0, m.index).replace(/\s+$/, '');
            const prevChar = before.slice(-1);
            const start = S.tokens.length === 0 || /["“‘'(\[:—–]/.test(prevChar);
            const base = w.replace(/'s$/i, '').replace(/s'$/, 's');
            S.tokens.push({ w, lw: w.toLowerCase(), base, s: m.index, e: m.index + m[0].length, cap: isUpper(w[0]), start,
              poss: /'s$/i.test(w) });
          }
          P.sIdx.push(S.idx);
          sentences.push(S);
        }
      });
    });
    return { sentences, paragraphs, quoteMode };
  }

  const inDialogue = (S, pos) => S.dlg.some(([a, b]) => pos >= a && pos < b);

  // ------------------------------------------------------------------ names

  function findNames(model, spell, opts) {
    const stats = new Map();
    const lowerCount = new Map();
    for (const S of model.sentences) {
      for (const t of S.tokens) {
        if (!t.cap) { lowerCount.set(t.lw, (lowerCount.get(t.lw) || 0) + 1); continue; }
        if (t.w.length > 1 && t.w === t.w.toUpperCase()) continue; // SHOUTING
        const key = t.base;
        let st = stats.get(key);
        if (!st) { st = { name: key, mid: 0, start: 0, chapters: new Set(), first: S }; stats.set(key, st); }
        if (t.start) st.start++; else st.mid++;
        st.chapters.add(S.ch);
      }
    }
    const hidden = new Set((opts.hiddenNames || []).map((s) => s.toLowerCase()));
    const names = new Set();
    const candidates = []; // capitalised, uncommon words: used for name-variant checks
    for (const st of stats.values()) {
      const n = st.name;
      if (CAP_STOP.has(n) || n.length < 2 || hidden.has(n.toLowerCase()) || /^I'/.test(n) || CAP_STOP.has(n.split("'")[0])) continue;
      const lower = (lowerCount.get(n.toLowerCase()) || 0);
      const commonWord = spell ? spell.correct(n.toLowerCase()) : lower > 0;
      const total = st.mid + st.start;
      let isName = false;
      if (commonWord) isName = st.mid >= 3 && lower <= st.mid * 0.5;
      else isName = (st.mid >= 1 && total >= 2 && lower <= total * 0.2) || (st.start >= 3 && lower === 0);
      if (isName) names.add(n);
      if (!commonWord && lower <= total * 0.2) candidates.push(st);
    }
    return { names, stats, candidates };
  }

  function nameTokens(S, names) {
    const out = [];
    S.tokens.forEach((t, i) => { if (t.cap && names.has(t.base)) out.push(i); });
    return out;
  }

  function inferGender(model, names) {
    // "her" is left out on purpose: it is as often an object ("he saw her") as a possessive.
    const tally = new Map();
    const HE = /\b(he|him|his|himself)\b/gi, SHE = /\b(she|hers|herself)\b/gi;
    const narration = (S) => S.text.replace(/“[^”]*(”|$)|"[^"]*("|$)/g, ' ');
    model.sentences.forEach((S, k) => {
      const idx = nameTokens(S, names);
      const present = new Set(idx.map((i) => S.tokens[i].base));
      if (present.size !== 1) return;
      const n = [...present][0];
      let t = tally.get(n); if (!t) { t = { he: 0, she: 0 }; tally.set(n, t); }
      const narr = narration(S);
      // Only pronouns after the name, so "She watched Tom" doesn't count for Tom.
      const firstName = S.tokens[idx[0]];
      const after = idx.length && !inDialogue(S, firstName.s) ? narr.slice(firstName.e) : '';
      t.he += (after.match(HE) || []).length;
      t.she += (after.match(SHE) || []).length;
      // "Tom grinned. He ..." - the next sentence opens with a pronoun and names nobody.
      const N = model.sentences[k + 1];
      const firstNarr = S.tokens.findIndex((t) => !inDialogue(S, t.s));
      if (N && N.ch === S.ch && (idx[0] <= 1 || idx[0] === firstNarr) && !nameTokens(N, names).length) {
        const first = N.tokens[0] && N.tokens[0].lw;
        if (first === 'he') t.he += 2;
        if (first === 'she') t.she += 2;
      }
    });
    const gender = new Map();
    for (const [n, t] of tally) {
      if (t.he >= 2 && t.he > t.she * 2) gender.set(n, 'he');
      else if (t.she >= 2 && t.she > t.he * 2) gender.set(n, 'she');
    }
    return gender;
  }

  // Work out who "his/her/my" or a nearby name refers to.
  function resolveOwner(model, S, tokenIdx, names, gender) {
    // 1. A possessive name just before: "Mara's grey eyes".
    for (let i = tokenIdx - 1; i >= Math.max(0, tokenIdx - 4); i--) {
      const t = S.tokens[i];
      if (t.poss) { if (names.has(t.base)) return { owner: t.base, conf: 'high' }; return null; }
      if (/^(his|her|their|my|its|your|our)$/.test(t.lw)) break;
    }
    const pos = S.tokens[tokenIdx].s;
    const dialogue = inDialogue(S, pos);
    if (dialogue) return null;
    // 2. A possessive pronoun before.
    let pron = null;
    for (let i = tokenIdx - 1; i >= Math.max(0, tokenIdx - 4); i--) {
      const lw = S.tokens[i].lw;
      if (/^(his|her|my|their|its|your|our)$/.test(lw)) { pron = { lw, i }; break; }
      if (DETERMINERS.has(lw)) return null;
    }
    const nameIdx = nameTokens(S, names);
    if (pron) {
      if (pron.lw === 'my') return { owner: 'Narrator', conf: 'medium' };
      if (pron.lw !== 'his' && pron.lw !== 'her') return null;
      const g = pron.lw === 'his' ? 'he' : 'she';
      const before = nameIdx.filter((i) => i < pron.i).reverse();
      const match = before.find((i) => gender.get(S.tokens[i].base) === g);
      if (match != null) return { owner: S.tokens[match].base, conf: 'medium' };
      const distinct = new Set(before.map((i) => S.tokens[i].base));
      if (distinct.size === 1) {
        const n = [...distinct][0];
        if (!gender.has(n)) return { owner: n, conf: 'low' };
        return null; // known gender does not match: someone else
      }
      if (before.length) return null;
      // Look back up to three sentences in the same chapter.
      const recent = [];
      for (let k = S.idx - 1; k >= 0 && k >= S.idx - 3; k--) {
        const P = model.sentences[k];
        if (P.ch !== S.ch) break;
        for (const i of nameTokens(P, names).reverse()) recent.push(P.tokens[i].base);
      }
      const g1 = recent.find((n) => gender.get(n) === g);
      if (g1) return { owner: g1, conf: 'low' };
      const d = new Set(recent);
      if (d.size === 1 && !gender.has([...d][0])) return { owner: [...d][0], conf: 'low' };
      return null;
    }
    // 3. No pronoun: the nearest name in the sentence ("Green-eyed Mara smiled").
    if (nameIdx.length) {
      const prev = nameIdx.filter((i) => i < tokenIdx);
      const next = nameIdx.filter((i) => i > tokenIdx);
      const pick = prev.length ? prev[prev.length - 1] : next[0];
      return { owner: S.tokens[pick].base, conf: 'medium' };
    }
    return null;
  }

  function subjectOwner(model, S, tokenIdx, names, gender) {
    // For "He was forty-two years old" style: subject pronoun or a name in the sentence.
    const pos = S.tokens[tokenIdx].s;
    if (inDialogue(S, pos)) return null;
    const nameIdx = nameTokens(S, names);
    const prevNames = nameIdx.filter((i) => i < tokenIdx);
    let pron = null;
    for (let i = tokenIdx - 1; i >= 0; i--) {
      const lw = S.tokens[i].lw;
      if (/^(he|she|i)$/.test(lw)) { pron = { lw, i }; break; }
    }
    if (prevNames.length && (!pron || prevNames[prevNames.length - 1] > pron.i)) {
      return { owner: S.tokens[prevNames[prevNames.length - 1]].base, conf: 'medium' };
    }
    if (pron) {
      if (pron.lw === 'i') return { owner: 'Narrator', conf: 'medium' };
      const fake = Object.assign({}, S.tokens[pron.i], { lw: pron.lw === 'he' ? 'his' : 'her' });
      const tokens = S.tokens.slice(); tokens.splice(pron.i, 1, fake);
      return resolveOwner(model, Object.assign({}, S, { tokens }), pron.i + 1 < tokens.length ? pron.i + 1 : pron.i, names, gender);
    }
    if (nameIdx.length) return { owner: S.tokens[nameIdx[0]].base, conf: 'medium' };
    return null;
  }

  // ------------------------------------------------------------------ continuity

  function colourIndex(map) {
    const idx = new Map();
    for (const [fam, words] of Object.entries(map)) for (const w of words) {
      if (!idx.has(w)) idx.set(w, new Set());
      idx.get(w).add(fam);
    }
    return idx;
  }
  const EYE_IDX = colourIndex(EYE_COLOURS);
  const HAIR_IDX = colourIndex(HAIR_COLOURS);

  function compatible(a, b, compat) {
    for (const x of a) for (const y of b) {
      if (x === y) return true;
      if (compat.some(([p, q]) => (p === x && q === y) || (p === y && q === x))) return true;
    }
    return false;
  }

  function extractAttributes(model, names, gender) {
    const records = [];
    for (const S of model.sentences) {
      const T = S.tokens;
      for (let i = 0; i < T.length; i++) {
        const lw = T[i].lw;
        let attr = null;
        if (lw === 'eyes' || lw === 'eyed') attr = 'eyes';
        else if (lw === 'hair' || lw === 'haired') attr = 'hair';
        if (!attr) continue;
        const idx = attr === 'eyes' ? EYE_IDX : HAIR_IDX;
        const fams = new Set();
        const words = [];
        let from = T[i].s, to = T[i].e;
        // Look back up to three words, stopping at punctuation.
        for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
          const gap = S.text.slice(T[j].e, T[j + 1].s);
          if (/[.;:!?"“”]/.test(gap)) break;
          if (idx.has(T[j].lw)) { idx.get(T[j].lw).forEach((f) => fams.add(f)); words.unshift(T[j].lw); from = T[j].s; }
        }
        // Or forwards after a linking verb: "her eyes were a pale grey".
        if (!fams.size && attr && T[i + 1] && LINKING.has(T[i + 1].lw) && !/[.;:!?,]/.test(S.text.slice(T[i].e, T[i + 1].s))) {
          for (let j = i + 2; j < Math.min(T.length, i + 7); j++) {
            const gap = S.text.slice(T[j - 1].e, T[j].s);
            if (/[.;!?]/.test(gap) || SCAN_STOP.has(T[j].lw)) break;
            if (idx.has(T[j].lw)) { idx.get(T[j].lw).forEach((f) => fams.add(f)); words.push(T[j].lw); to = T[j].e; }
          }
        }
        if (!fams.size) continue;
        const firstTok = T.findIndex((t) => t.s === from);
        const own = resolveOwner(model, S, Math.min(firstTok < 0 ? i : firstTok, i), names, gender);
        if (!own) continue;
        records.push({ owner: own.owner, attr, fams: [...fams], words, conf: own.conf, S, s: Math.min(from, T[i].s), e: Math.max(to, T[i].e) });
      }
    }
    return records;
  }

  function extractAges(model, names, gender) {
    const out = [];
    const res = [
      { re: new RegExp('\\b(' + NUM_WORD + ')[- ]years?[- ]old\\b', 'gi'), kind: 'age' },
      { re: new RegExp('\\baged (' + NUM_WORD + ')\\b', 'gi'), kind: 'age' },
      { re: new RegExp('\\bturned (' + NUM_WORD + ')(?=[\\s,.;!?]|$)(?! (?:minutes|hours|seconds|degrees|pages|times|feet|metres|meters|miles|yards|steps|percent))', 'gi'), kind: 'age' },
      { re: new RegExp('\\b(' + ORD_WORD + ') birthday\\b', 'gi'), kind: 'birthday' }
    ];
    for (const S of model.sentences) {
      for (const { re, kind } of res) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(S.text))) {
          const val = kind === 'birthday' ? parseOrd(m[1]) : parseNum(m[1]);
          if (val == null || val < 1 || val > 120) continue;
          if (/years? old/i.test(m[0]) && /\b(?:a|the|this|that)\s*$/i.test(S.text.slice(0, m.index)) && !/-year-old/i.test(m[0])) {
            // "a ten years old house" style is rare; "the forty-two-year-old Elias" is fine.
          }
          let tokIdx = S.tokens.findIndex((t) => t.s >= m.index);
          if (tokIdx < 0) tokIdx = S.tokens.length - 1;
          let own = null;
          // "-year-old Elias" / "the forty-year-old woman": owner follows.
          const after = S.text.slice(m.index + m[0].length);
          const follow = after.match(/^\s+([A-Z][A-Za-z'’]+)/);
          if (/-year-old$/i.test(m[0]) && follow) {
            if (names.has(follow[1].replace(/['’]s$/, ''))) own = { owner: follow[1].replace(/['’]s$/, ''), conf: 'high' };
            else continue;
          } else if (/-year-old$/i.test(m[0])) continue; // "a ten-year-old boy" describes someone unnamed
          if (!own) own = subjectOwner(model, S, tokIdx, names, gender);
          if (!own) continue;
          out.push({ owner: own.owner, value: val, conf: own.conf, S, s: m.index, e: m.index + m[0].length, kind });
        }
      }
    }
    return out;
  }

  function extractHeights(model, names, gender) {
    const out = [];
    const re = new RegExp('\\b(' + NUM_WORD + ')\\s*(?:feet|foot|ft)(?:[ ,]+(?:and\\s+)?(' + NUM_WORD + ')(?:\\s*inch(?:es)?)?)?\\s+tall\\b|\\b([4-7])\\s*[\'’′]\\s*(\\d{1,2})\\s*(?:"|”|″|\'\')?(?=[\\s,.;])', 'gi');
    for (const S of model.sentences) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(S.text))) {
        let ft, inch;
        if (m[1]) { ft = parseNum(m[1]); inch = m[2] ? parseNum(m[2]) : 0; }
        else { ft = parseInt(m[3], 10); inch = parseInt(m[4], 10); }
        if (ft == null || ft < 3 || ft > 8 || inch == null || inch > 11) continue;
        let tokIdx = S.tokens.findIndex((t) => t.s >= m.index);
        if (tokIdx < 0) tokIdx = S.tokens.length - 1;
        const own = subjectOwner(model, S, tokIdx, names, gender);
        if (!own) continue;
        out.push({ owner: own.owner, value: ft * 12 + inch, label: ft + '′' + inch + '″', conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
    }
    return out;
  }

  function extractHandedness(model, names, gender) {
    const out = [];
    const re = /\b(left|right)[- ]handed\b/gi;
    for (const S of model.sentences) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(S.text))) {
        let tokIdx = S.tokens.findIndex((t) => t.s >= m.index);
        const own = subjectOwner(model, S, tokIdx, names, gender);
        if (!own) continue;
        out.push({ owner: own.owner, value: m[1].toLowerCase(), conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
    }
    return out;
  }

  function findDeaths(model, names) {
    const deaths = new Map();
    for (const S of model.sentences) {
      for (const n of new Set(nameTokens(S, names).map((i) => S.tokens[i].base))) {
        const N = esc(n);
        const re = new RegExp('\\b' + N + '\\s+(?:had\\s+|has\\s+)?(?:died|was\\s+killed|was\\s+murdered|was\\s+dead|lay\\s+dead|passed\\s+away|is\\s+dead|had\\s+been\\s+killed|drowned)\\b' +
          '|\\b(?:killed|murdered|buried|executed)\\s+' + N + '\\b(?=\\s*[.,;!?]|\\s+(?:with|in|on|at|and|before|after|that)\\b)' +
          '|\\b' + N + '[\'’]s\\s+(?:death|funeral|grave|corpse|coffin|ashes|dead\\s+body|lifeless\\s+body)\\b', 'i');
        const m = S.text.match(re);
        if (m && !inDialogue(S, m.index) && !/\b(?:nearly|almost|if|would|could|might|should|never|not)\s+(?:have\s+)?$/i.test(S.text.slice(0, m.index))) {
          if (!deaths.has(n)) deaths.set(n, { S, s: m.index, e: m.index + m[0].length });
        }
      }
    }
    const issues = [];
    for (const [n, d] of deaths) {
      const N = esc(n);
      const act = new RegExp('\\b' + N + '\\s+(?:' + ACTION_VERBS + ')\\b|\\b(?:' + TAG_VERBS + ')\\s+' + N + '\\b', '');
      const seen = new Set();
      const hits = [];
      for (const S of model.sentences) {
        if (S.ch <= d.S.ch || seen.has(S.ch)) continue;
        const m = S.text.match(act);
        if (!m) continue;
        if (/\b(?:had|remembered|recalled|used to|would|once)\b/i.test(S.text)) continue;
        seen.add(S.ch);
        hits.push({ S, s: m.index, e: m.index + m[0].length });
      }
      if (hits.length) issues.push({ name: n, death: d, hits });
    }
    return issues;
  }

  // ------------------------------------------------------------------ timeline

  function timelineAnalysis(model, chapters) {
    const issues = [];
    const markers = chapters.map(() => []);
    const WD = WEEKDAYS.join('|'), MO = MONTHS.join('|');
    const dateA = new RegExp('\\b(' + WD + '),?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MO + '),?\\s+(\\d{4})\\b', 'gi');
    const dateB = new RegExp('\\b(' + WD + '),?\\s+(' + MO + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b', 'gi');
    const dayMonth = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MO + ')(?:,?\\s+(\\d{4}))?\\b|\\b(' + MO + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'gi');
    const weekdayRe = new RegExp('\\b(' + WD + ')\\b', 'gi');
    const jumpRe = new RegExp('\\b(?:the\\s+)?(?:next|following)\\s+(day|morning|afternoon|evening|night)\\b|\\b(' + NUM_WORD + '|a|one)\\s+(days?|weeks?)\\s+later\\b', 'i');
    const markerRe = new RegExp(
      '\\b(?:' + NUM_WORD + '|a|one|several|a few|many)\\s+(?:days?|weeks?|months?|years?|hours?)\\s+(?:later|ago|earlier|passed|went by)\\b' +
      '|\\b(?:the\\s+)?(?:next|following)\\s+(?:day|morning|afternoon|evening|night|week|month|year|spring|summer|autumn|winter)\\b' +
      '|\\b(?:that|last|next|this|the)\\s+(?:spring|summer|autumn|fall|winter)\\b|\\bin\\s+(?:spring|summer|autumn|winter)\\b' +
      '|\\b(?:christmas|easter|halloween|thanksgiving|new year[\'’]s (?:eve|day)|midsummer|bonfire night)\\b' +
      '|\\b(?:in|of|since|until|by|during|summer|winter|spring|autumn)\\s+(1[5-9]\\d\\d|20\\d\\d|21\\d\\d)\\b', 'gi');

    function addMarker(S, kind, label, s, e) {
      const list = markers[S.ch];
      if (list.length >= 40) return;
      if (list.some((x) => x.label.toLowerCase() === label.toLowerCase() && x.kind === kind)) return;
      list.push({ kind, label, quote: makeQuote(S, s, e) });
    }

    for (const S of model.sentences) {
      for (const re of [dateA, dateB]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(S.text))) {
          const wd = m[1].toLowerCase();
          const day = re === dateA ? +m[2] : +m[3];
          const mon = MONTHS.indexOf((re === dateA ? m[3] : m[2]).toLowerCase());
          const yr = +m[4];
          const dt = new Date(Date.UTC(yr, mon, day));
          if (dt.getUTCMonth() !== mon) continue; // impossible date: reported below
          const actual = WEEKDAYS[dt.getUTCDay()];
          addMarker(S, 'date', m[0], m.index, m.index + m[0].length);
          if (actual !== wd) {
            issues.push({ kind: 'Timeline', sev: 'high', key: 'wd:' + m[0].toLowerCase(),
              msg: `${cap(MONTHS[mon])} ${day}, ${yr} was a ${cap(actual)}, but the text says ${cap(wd)}.`,
              quotes: [makeQuote(S, m.index, m.index + m[0].length)] });
          }
        }
      }
      dayMonth.lastIndex = 0;
      let m;
      while ((m = dayMonth.exec(S.text))) {
        const day = +(m[1] || m[5]);
        const monName = (m[2] || m[4]);
        // "May 3" is ambiguous with the verb "may"; only trust it capitalised.
        if (!/^[A-Z]/.test(monName)) continue;
        const mon = MONTHS.indexOf(monName.toLowerCase());
        const yr = m[3] || m[6] ? +(m[3] || m[6]) : null;
        if (day < 1) continue;
        addMarker(S, 'date', m[0], m.index, m.index + m[0].length);
        const leap = yr == null || (yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0));
        const max = mon === 1 ? (leap ? 29 : 28) : MONTH_DAYS[mon];
        if (day > max && day <= 40) {
          issues.push({ kind: 'Timeline', sev: 'high', key: 'bad-date:' + m[0].toLowerCase(),
            msg: `${cap(MONTHS[mon])} only has ${max} days${mon === 1 && yr ? ' in ' + yr : ''}, so "${m[0]}" can't happen.`,
            quotes: [makeQuote(S, m.index, m.index + m[0].length)] });
        }
      }
      markerRe.lastIndex = 0;
      while ((m = markerRe.exec(S.text))) {
        if (inDialogue(S, m.index)) continue;
        addMarker(S, 'time', m[0], m.index, m.index + m[0].length);
      }
    }

    // Weekday arithmetic: "On Monday ... The next day, Wednesday ..."
    let last = null;
    for (const S of model.sentences) {
      if (last && last.S.ch !== S.ch) last = null;
      const jump = S.text.match(jumpRe);
      let offset = null;
      if (jump && !inDialogue(S, jump.index)) {
        if (jump[1]) offset = 1;
        else {
          const n = /^(a|one)$/i.test(jump[2]) ? 1 : parseNum(jump[2]);
          offset = n == null ? null : (/week/i.test(jump[3]) ? n * 7 : n);
        }
      }
      weekdayRe.lastIndex = 0;
      const days = [];
      let w;
      while ((w = weekdayRe.exec(S.text))) {
        if (inDialogue(S, w.index) || !/^[A-Z]/.test(w[1])) continue;
        days.push({ d: WEEKDAYS.indexOf(w[1].toLowerCase()), s: w.index, e: w.index + w[0].length, word: w[1] });
      }
      for (const d of days) addMarker(S, 'day', d.word, d.s, d.e);
      if (offset != null && last && S.idx - last.S.idx <= 60) {
        // The day named in this sentence (after the jump) or the next sentence.
        let target = days.find((d) => d.s > jump.index);
        let TS = S;
        if (!target) {
          const N = model.sentences[S.idx + 1];
          if (N && N.ch === S.ch) {
            weekdayRe.lastIndex = 0;
            const w2 = weekdayRe.exec(N.text);
            if (w2 && !inDialogue(N, w2.index) && /^[A-Z]/.test(w2[1])) { target = { d: WEEKDAYS.indexOf(w2[1].toLowerCase()), s: w2.index, e: w2.index + w2[0].length, word: w2[1] }; TS = N; }
          }
        }
        if (target) {
          const expect = (last.d + offset) % 7;
          if (expect !== target.d) {
            issues.push({ kind: 'Timeline', sev: 'medium', key: 'wd-seq:' + S.ch + ':' + hash(S.text),
              msg: `The days don't add up: ${cap(WEEKDAYS[last.d])}, then "${jump[0].trim()}", should be ${cap(WEEKDAYS[expect])}, but the text says ${target.word}.`,
              quotes: [makeQuote(last.S, last.s, last.e), makeQuote(TS, target.s, target.e)] });
          }
          last = { d: target.d, S: TS, s: target.s, e: target.e };
          continue;
        }
      }
      if (days.length) { const d = days[days.length - 1]; last = { d: d.d, S, s: d.s, e: d.e }; }
    }
    return { issues, markers };
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ------------------------------------------------------------------ spelling

  function spellingAnalysis(model, spell, names, opts) {
    const custom = new Set((opts.customWords || []).map((w) => w.toLowerCase()));
    const cache = new Map();
    const groups = new Map();
    const ok = (w) => {
      if (cache.has(w)) return cache.get(w);
      let r = spell.correct(w);
      if (!r && w.includes("'")) r = spell.correct(w.replace(/'/g, '’')) || spell.correct(w.replace(/'s$/i, ''));
      if (!r && /^[A-Z]/.test(w)) r = spell.correct(w.toLowerCase());
      if (!r && w === w.toUpperCase()) r = spell.correct(w.toLowerCase()) || spell.correct(cap(w.toLowerCase()));
      cache.set(w, r);
      return r;
    };
    for (const S of model.sentences) {
      for (const t of S.tokens) {
        const w = t.w;
        if (w.length < 2 && !/^[b-hj-z]$/i.test(w)) continue;
        if (names.has(t.base) || custom.has(t.lw) || custom.has(t.base.toLowerCase())) continue;
        if (w.length === 1) continue;
        if (/^(?:[A-Z]{2,5}s?)$/.test(w)) continue; // acronyms
        if (ok(w)) continue;
        const key = t.lw.replace(/'s$/, '');
        if (custom.has(key)) continue;
        let g = groups.get(key);
        if (!g) { g = { word: w.replace(/'s$/i, ''), count: 0, chapters: new Set(), quotes: [], allCap: true, mid: false }; groups.set(key, g); }
        g.count++;
        if (!t.cap) g.allCap = false;
        if (!t.start) g.mid = true;
        g.chapters.add(S.ch);
        if (g.quotes.length < 3 && !g.quotes.some((q) => q.ch === S.ch && q.pc === S.pc)) g.quotes.push(makeQuote(S, t.s, t.e));
      }
    }
    // Suggestions, most frequent first, within a time budget.
    const list = [...groups.values()].sort((a, b) => b.count - a.count);
    const t0 = Date.now();
    const sorted = (w) => w.toLowerCase().split('').sort().join('');
    for (const g of list) {
      g.isName = g.allCap && g.mid;
      if (g.isName) { g.sugg = []; continue; }
      if (Date.now() - t0 > 4000) break;
      const lw = g.word.toLowerCase();
      const ana = sorted(lw);
      g.sugg = spell.suggest(g.word)
        .map((s, i) => ({ s, i, d: dl(lw, s.toLowerCase()) - (sorted(s) === ana ? 0.5 : 0) }))
        .sort((a, b) => a.d - b.d || (a.s === a.s.toLowerCase() ? 0 : 1) - (b.s === b.s.toLowerCase() ? 0 : 1) || a.i - b.i)
        .slice(0, 4).map((x) => x.s);
    }
    return list;
  }

  function mixedSpelling(model) {
    const vocab = new Map();
    for (const S of model.sentences) for (const t of S.tokens) {
      const v = vocab.get(t.lw);
      if (v) { v.n++; } else vocab.set(t.lw, { n: 1, S, s: t.s, e: t.e });
    }
    const pairs = [['grey', 'gray'], ['greys', 'grays'], ['greyish', 'grayish'], ['towards', 'toward'], ['mum', 'mom'],
      ['pyjamas', 'pajamas'], ['jewellery', 'jewelry'], ['aluminium', 'aluminum'], ['defence', 'defense'], ['offence', 'offense'],
      ['plough', 'plow'], ['sceptical', 'skeptical'], ['manoeuvre', 'maneuver'], ['moustache', 'mustache'], ['cosy', 'cozy'],
      ['afterwards', 'afterward'], ['amongst', 'among'], ['whilst', 'while'], ['okay', 'ok'], ['ageing', 'aging']];
    const seen = new Set();
    const L = ['travel', 'cancel', 'model', 'label', 'level', 'signal', 'fuel', 'total', 'marvel', 'quarrel', 'jewel', 'tunnel',
      'channel', 'counsel', 'dial', 'duel', 'funnel', 'shovel', 'snorkel', 'swivel', 'grovel', 'yodel', 'rival', 'panel', 'pencil'];
    for (const w of vocab.keys()) {
      let alt = null;
      let m;
      if ((m = w.match(/^(.+[^aeiou])our(s|ed|ing|ful|ite|ites|able|less)?$/)) && !/^(?:f|y|h|p|t|s|fl|d|det|dev|cont|ar|sc|parl|tr)$/.test(m[1])) alt = m[1] + 'or' + (m[2] || '');
      else if ((m = w.match(/^(.{3,})is(e|es|ed|ing|ation|ations|er|ers)$/))) alt = m[1] + 'iz' + m[2];
      else if ((m = w.match(/^(.{2,})ys(e|es|ed|ing)$/))) alt = m[1] + 'yz' + m[2];
      if (!alt && (m = w.match(/^(.+?)l(led|ling|ler|lers)$/)) && L.includes(m[1] + 'l')) alt = m[1] + 'l' + m[2].slice(1);
      if (!alt && (m = w.match(/^(cent|theat|fib|lit|somb|spect|lust|calib|meag)re(s|d)?$/))) alt = m[1] + 'er' + (m[2] || '');
      if (alt && vocab.has(alt)) pairs.push([w, alt]);
    }
    const issues = [];
    for (const [a, b] of pairs) {
      const k = [a, b].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      const A = vocab.get(a), B = vocab.get(b);
      if (!A || !B) continue;
      const minor = A.n < B.n ? [a, A] : [b, B];
      issues.push({ kind: 'Mixed spelling', sev: 'low', key: 'mix:' + k,
        msg: `You use both "${a}" (${A.n}×) and "${b}" (${B.n}×). Pick one and use it throughout.`,
        quotes: [makeQuote(minor[1].S, minor[1].s, minor[1].e)] });
    }
    return issues;
  }

  function hyphenation(model) {
    const hy = new Map(), open = new Map(), closed = new Map();
    const HY_RE = /\b([A-Za-z]+)-([A-Za-z]+)\b/g;
    for (const S of model.sentences) {
      let m;
      HY_RE.lastIndex = 0;
      while ((m = HY_RE.exec(S.text))) {
        const k = (m[1] + '-' + m[2]).toLowerCase();
        const v = hy.get(k); if (v) v.n++; else hy.set(k, { n: 1, S, s: m.index, e: m.index + m[0].length });
      }
      const T = S.tokens;
      for (let i = 0; i < T.length; i++) {
        const c = closed.get(T[i].lw); if (c) c.n++; else closed.set(T[i].lw, { n: 1, S, s: T[i].s, e: T[i].e });
        if (i + 1 < T.length && S.text.slice(T[i].e, T[i + 1].s) === ' ') {
          const k = T[i].lw + ' ' + T[i + 1].lw;
          const o = open.get(k); if (o) o.n++; else open.set(k, { n: 1, S, s: T[i].s, e: T[i + 1].e });
        }
      }
    }
    const issues = [];
    for (const [k, H] of hy) {
      const [a, b] = k.split('-');
      if (['re', 'co', 'pre', 'non', 'un', 'ex', 'well', 'so', 'self', 'half'].includes(a)) continue;
      if (STOP.has(a) && STOP.has(b)) continue;
      const O = open.get(a + ' ' + b), C = closed.get(a + b);
      const forms = [[k, H]];
      if (O) forms.push([a + ' ' + b, O]);
      if (C) forms.push([a + b, C]);
      if (forms.length < 2) continue;
      forms.sort((x, y) => y[1].n - x[1].n);
      const minor = forms[forms.length - 1][1];
      issues.push({ kind: 'Hyphenation', sev: 'low', key: 'hy:' + k,
        msg: 'Written more than one way: ' + forms.map(([f, v]) => `"${f}" (${v.n}×)`).join(', ') + '.',
        quotes: [makeQuote(minor.S, minor.s, minor.e)] });
    }
    return issues;
  }

  // ------------------------------------------------------------------ grammar (built-in rules)

  const GRAMMAR_RULES = [
    { re: /\b(could|should|would|must|might)\s+of\b/gi, msg: (m) => `"${m[0]}" should be "${m[1]} have".`, fix: (m) => m[1] + ' have', sev: 'high', kind: 'Wrong word' },
    { re: /\balot\b/gi, msg: () => '"alot" should be two words: "a lot".', fix: () => 'a lot', sev: 'high', kind: 'Wrong word' },
    { re: /\bit['’]s\s+(own|self)\b/gi, msg: (m) => `"it's ${m[1]}" should be "its ${m[1]}".`, fix: (m) => 'its ' + m[1], sev: 'high', kind: 'Wrong word' },
    { re: /\bits\s+(been|got|gotten|going|not|a|an|the|okay|ok|gonna|alright|over|raining|snowing)\b(?!-)/gi,
      msg: (m) => `"its ${m[1]}" probably needs "it's" (it is / it has).`, fix: (m) => "it's " + m[1], sev: 'medium', kind: 'Wrong word' },
    { re: /\btheir\s+(is|are|was|were|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\b/gi, msg: (m) => `"${m[0]}" should probably be "there ${m[1]}".`, fix: (m) => 'there ' + m[1], sev: 'high', kind: 'Wrong word' },
    { re: /\bthere\s+(own|selves)\b/gi, msg: (m) => `"${m[0]}" should be "their ${m[1]}".`, fix: (m) => 'their ' + m[1], sev: 'high', kind: 'Wrong word' },
    { re: /\byour\s+(welcome|going|not|right|wrong|kidding|joking|lying|crazy|mad|late|being)\b/gi, msg: (m) => `"${m[0]}" should probably be "you're ${m[1]}".`, fix: (m) => "you're " + m[1], sev: 'high', kind: 'Wrong word' },
    { re: /\b(more|less|better|worse|rather|other|bigger|smaller|faster|slower|older|younger|taller|shorter|greater|fewer|larger|higher|lower|further|farther|stronger|weaker|easier|harder|happier|longer|darker|brighter|louder|quieter|closer)\s+then\b/gi,
      msg: (m) => `"${m[0]}" should be "${m[1]} than".`, fix: (m) => m[1] + ' than', sev: 'high', kind: 'Wrong word' },
    { re: /\brather\s+(?:[a-z'’]+\s+){1,8}?then\s+(?=[a-z])/gi, msg: () => '"rather … then" should probably be "rather … than".', fix: () => 'than', sev: 'medium', kind: 'Wrong word' },
    { re: /\b(should|could|would|must|might)\s+have\s+(went|came|ran|ate|wrote|took|gave|saw|did|began|drank|swam|rode|spoke|broke|chose|drove|froze|stole|threw|knew|grew|flew)\b/gi,
      msg: (m) => `"${m[0]}" needs the past participle (e.g. "have gone", "have seen").`, sev: 'high', kind: 'Verb form' },
    { re: /\b(was|were|is|are|am|be|I|we|they|you)\s+(suppose)\s+to\b|\b(was|were)\s+(use)\s+to\b/gi, msg: (m) => `"${m[2] || m[4]} to" should be "${m[2] || m[4]}d to".`, fix: (m) => (m[1] || m[3]) + ' ' + (m[2] || m[4]) + 'd to', sev: 'high', kind: 'Wrong word' },
    { re: /\bloose\s+(the|my|his|her|their|our|your|it|them|him|me|track|control|sight|weight|hope|touch|count|interest|consciousness)\b/gi,
      msg: (m) => `Did you mean "lose ${m[1]}"? "Loose" means not tight.`, fix: (m) => 'lose ' + m[1], sev: 'medium', kind: 'Wrong word' },
    { re: /\bwho['’]s\s+(car|house|book|idea|turn|fault|side|job|room|phone|bag|hand|name|voice|face|door|money|life)\b/gi,
      msg: (m) => `"${m[0]}" should probably be "whose ${m[1]}".`, fix: (m) => 'whose ' + m[1], sev: 'medium', kind: 'Wrong word' },
    { re: /\b(?:to)\s+(late|early|soon)\s*[.,!?]/gi, msg: (m) => `"to ${m[1]}" should probably be "too ${m[1]}".`, fix: (m) => 'too ' + m[1], sev: 'medium', kind: 'Wrong word' },
    { re: /\b(?:a\s+)?(?:affect)\s+(?:on)\b/gi, msg: () => '"affect on" should probably be "effect on".', fix: () => 'effect on', sev: 'medium', kind: 'Wrong word' },
    { re: /\bcould care less\b/gi, msg: () => 'The usual phrase is "couldn\'t care less".', sev: 'low', kind: 'Wrong word' },
    { re: /\b(?:try|tried)\s+and\s+(?=\w)/gi, msg: () => 'Formal writing usually prefers "try to" over "try and".', sev: 'low', kind: 'Usage' },
    { re: /\bi\b(?!\.e\.)(?![.'’]?[a-z])/g, msg: () => 'The word "I" should always be a capital letter.', fix: () => 'I', sev: 'high', kind: 'Capital letters' },
    { re: /[a-z][,;:](?=[A-Za-z])/g, msg: () => 'Missing space after punctuation.', sev: 'medium', kind: 'Punctuation', skipUrl: true },
    { re: /[a-z]{2}[.!?](?=[A-Z][a-z])/g, msg: () => 'Missing space after the end of a sentence.', sev: 'medium', kind: 'Punctuation', skipUrl: true },
    { re: /\w\s+([,;:!?]|\.(?!\.))(?=\s|$)/g, msg: () => 'There is a space before the punctuation mark.', sev: 'low', kind: 'Punctuation' },
    { re: /(?<![.…])\.\s+[a-z]/g, msg: () => 'A new sentence should start with a capital letter.', sev: 'medium', kind: 'Capital letters', abbrevCheck: true },
    { re: /([!?,;:])\1+|(?<!\.)\.\.(?!\.)/g, msg: () => 'Doubled punctuation mark.', sev: 'low', kind: 'Punctuation' }
  ];
  const DOUBLE_OK = new Set(['had', 'that', 'is', 'bye', 'so', 'very', 'no', 'yes', 'ha', 'oh', 'knock', 'come', 'go', 'run', 'now', 'please', 'never', 'tut', 'there', 'well', 'hush', 'yeah', 'out', 'faster', 'more', 'blah', 'hey', 'help']);
  const A_EXC = /^(uni(?![nm])|use|usu|uti|ure|uri|ura|euro|eu|ewe|one\b|once|uk\b|u\.)/i;
  const AN_EXC = /^(hour|honest|honou?r|heir|herb)/i;

  function grammarAnalysis(model) {
    const issues = [];
    const counts = {};
    const add = (kind, sev, S, s, e, msg, fix, rule) => {
      counts[rule] = (counts[rule] || 0) + 1;
      if (counts[rule] > 250) return;
      issues.push({ kind, sev, key: 'gr:' + rule + ':' + S.ch + ':' + hash(S.text + s), msg, fix, quotes: [makeQuote(S, s, e)] });
    };
    for (const S of model.sentences) {
      const text = S.text;
      GRAMMAR_RULES.forEach((r, ri) => {
        r.re.lastIndex = 0;
        let m;
        while ((m = r.re.exec(text))) {
          if (r.skipUrl && /\S*(https?:|www\.|\.com|@)\S*$/.test(text.slice(0, m.index + 3))) continue;
          if (r.abbrevCheck) {
            const w = text.slice(0, m.index + 1).match(/([A-Za-z.]+)\.$/);
            if (w && (ABBR.has(w[1]) || /\.[a-z]$|^[a-z]\.?$/.test(w[1]))) continue;
          }
          if (r.kind === 'Capital letters' && /^i\b/.test(m[0]) && inDialogue(S, m.index) === false && /[a-z]['’]$/.test(text.slice(0, m.index))) continue;
          add(r.kind, r.sev, S, m.index, m.index + m[0].length, r.msg(m), r.fix ? r.fix(m) : null, 'r' + ri);
        }
      });
      // Repeated words: "the the"
      const T = S.tokens;
      for (let i = 1; i < T.length; i++) {
        if (T[i].lw === T[i - 1].lw && !DOUBLE_OK.has(T[i].lw) && /^\s+$/.test(text.slice(T[i - 1].e, T[i].s)) && !/^\d/.test(T[i].lw)) {
          add('Repeated word', 'high', S, T[i - 1].s, T[i].e, `"${T[i].w}" appears twice in a row.`, T[i].w, 'dup');
        }
        // a / an
        const prev = T[i - 1];
        if ((prev.lw === 'a' || prev.lw === 'an') && /^\s+$/.test(text.slice(prev.e, T[i].s))) {
          const w = T[i].w;
          if (w.length < 2 || /^[A-Z]{2,}/.test(w)) continue;
          const vowel = /^[aeiou]/i.test(w);
          if (prev.lw === 'a' && vowel && !A_EXC.test(w)) add('Wrong word', 'high', S, prev.s, T[i].e, `Use "an" before "${w}".`, (prev.w === 'A' ? 'An ' : 'an ') + w, 'a-an');
          if (prev.lw === 'an' && ((!vowel && !AN_EXC.test(w)) || (vowel && A_EXC.test(w)))) add('Wrong word', 'high', S, prev.s, T[i].e, `Use "a" before "${w}".`, (prev.w === 'An' ? 'A ' : 'a ') + w, 'a-an');
        }
      }
    }
    // Quotation marks and brackets per paragraph.
    model.paragraphs.forEach((P, pi) => {
      const S = model.sentences[P.sIdx[0]];
      if (!S) return;
      const nextP = model.paragraphs[pi + 1];
      const t = P.text;
      const openD = (t.match(/“/g) || []).length, closeD = (t.match(/”/g) || []).length;
      const straight = (t.match(/"/g) || []).length;
      const nextStartsQuote = nextP && nextP.ch === P.ch && /^\s*[“"]/.test(nextP.text);
      if (model.quoteMode === 'double') {
        if (closeD > openD && !(openD === 0 && pi > 0 && model.paragraphs[pi - 1].ch === P.ch && /[“"][^”"]*$/.test(model.paragraphs[pi - 1].text))) {
          add('Quotation marks', 'medium', S, 0, 0, 'This paragraph closes a quotation that was never opened.', null, 'q-close');
        } else if ((openD > closeD || straight % 2 === 1) && !nextStartsQuote) {
          const pos = t.lastIndexOf(openD > closeD ? '“' : '"');
          const SS = P.sIdx.map((i) => model.sentences[i]).find((x) => model.sentences[x.idx] && t.indexOf(x.text) <= pos && t.indexOf(x.text) + x.text.length > pos) || S;
          add('Quotation marks', 'medium', SS, 0, 0, 'A quotation mark is opened but never closed in this paragraph.', null, 'q-open');
        }
      }
      const op = (t.match(/\(/g) || []).length, cp = (t.match(/\)/g) || []).length;
      if (op !== cp) add('Brackets', 'low', S, 0, 0, 'Brackets don\'t match up in this paragraph.', null, 'paren');
    });
    return issues;
  }

  // ------------------------------------------------------------------ style

  function styleAnalysis(model, names, chapters) {
    const issues = [];
    const words = [];
    let sentenceWords = [];
    let syl = 0, dialogueChars = 0, totalChars = 0;
    const freq = new Map();
    const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
    const adverbs = new Map(), gestures = new Map(), crutch = new Map(), filters = new Map(), tags = new Map();
    let passive = 0;
    const passiveEx = [];
    const longSentences = [];
    const GEST = new Set(GESTURES);

    for (const S of model.sentences) {
      const T = S.tokens;
      sentenceWords.push(T.length);
      for (const [a, b] of S.dlg) dialogueChars += b - a;
      totalChars += S.text.length;
      for (const t of T) {
        words.push(t.lw);
        syl += syllables(t.lw);
        if (!STOP.has(t.lw) && !names.has(t.base) && t.lw.length > 2) bump(freq, t.lw);
        if (/ly$/.test(t.lw) && t.lw.length > 4 && !ADVERB_NOT.has(t.lw) && !names.has(t.base)) bump(adverbs, t.lw);
        if (GEST.has(t.lw)) bump(gestures, t.lw);
      }
      const lower = S.text.toLowerCase();
      for (const c of CRUTCH_WORDS) {
        const n = (lower.match(new RegExp('\\b' + c + '\\b', 'g')) || []).length;
        if (n) bump(crutch, c, n);
      }
      for (const f of FILTER_WORDS) {
        const n = (lower.match(new RegExp('\\b' + f + '\\b', 'g')) || []).length;
        if (n) bump(filters, f, n);
      }
      let m;
      const tagRe = new RegExp('\\b(' + TAG_VERBS + '|exclaimed|retorted|barked|snarled|spat|bellowed|declared|announced|demanded|insisted|stammered|sneered|chuckled|laughed|sighed|smirked|breathed|gasped|groaned)\\b(?=[^.!?]*$)', 'gi');
      if (S.dlg.length) { while ((m = tagRe.exec(lower))) bump(tags, m[1]); }
      const pr = /\b(am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+ed|\w+en|held|kept|left|lost|built|caught|taught|brought|bought|found|heard|told|sold|sent|spent|paid|hit|hurt|shut|struck|hung|led|fed|met|bound|shot|slain)\b/gi;
      while ((m = pr.exec(S.text))) {
        const p = m[2].toLowerCase();
        if (ADJ_ED.has(p)) continue;
        if (/en$/.test(p) && !IRREG_PART.has(p)) continue;
        passive++;
        if (passiveEx.length < 60) passiveEx.push(makeQuote(S, m.index, m.index + m[0].length));
      }
      if (T.length > 55) longSentences.push(S);
      // "said softly"
      const sa = /\b(said|asked|replied|whispered|shouted|muttered|murmured|called|cried)\s+([a-z]+ly)\b/gi;
      while ((m = sa.exec(S.text))) {
        if (ADVERB_NOT.has(m[2].toLowerCase())) continue;
        issues.push({ kind: 'Adverb on a speech tag', sev: 'low', key: 'st:said-ly:' + S.ch + ':' + hash(S.text + m.index),
          msg: `"${m[0]}": consider showing the tone through the words or actions instead.`, quotes: [makeQuote(S, m.index, m.index + m[0].length)] });
      }
    }

    for (const S of longSentences.slice(0, 80)) {
      issues.push({ kind: 'Long sentence', sev: 'low', key: 'st:long:' + S.ch + ':' + hash(S.text),
        msg: `This sentence is ${S.tokens.length} words long. Consider splitting it.`, quotes: [makeQuote(S, 0, 0)] });
    }

    // Repeated sentence openings: three or more in a row.
    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        const w = run[0].tokens[0].w;
        issues.push({ kind: 'Repeated openings', sev: 'low', key: 'st:open:' + run[0].ch + ':' + hash(run[0].text),
          msg: `${run.length} sentences in a row start with "${w}".`, quotes: run.slice(0, 3).map((S) => makeQuote(S, 0, S.tokens[0].e)) });
      }
    };
    let prevS = null;
    for (const S of model.sentences) {
      const startsDialogue = /^\s*[“"‘']/.test(S.text);
      if (!S.tokens.length || startsDialogue || (prevS && prevS.ch !== S.ch)) { flush(); run = []; prevS = S; if (startsDialogue || !S.tokens.length) continue; }
      if (run.length && run[0].tokens[0].lw === S.tokens[0].lw) run.push(S); else { flush(); run = [S]; }
      prevS = S;
    }
    flush();

    // Echoes: the same distinctive word twice within ~30 words in a paragraph.
    let echoCount = 0;
    const COMMONISH = new Set(['looked', 'turned', 'could', 'would', 'should', 'there', 'their', 'about', 'again', 'still', 'thought', 'other', 'another', 'before', 'after', 'something', 'nothing', 'everything', 'anything', 'because', 'where', 'which', 'while', 'through', 'though', 'enough', 'didn\'t', 'couldn\'t', 'wasn\'t']);
    for (const P of model.paragraphs) {
      const toks = [];
      for (const i of P.sIdx) for (const t of model.sentences[i].tokens) toks.push({ t, S: model.sentences[i] });
      const lastSeen = new Map();
      const reported = new Set();
      toks.forEach(({ t, S }, k) => {
        if (t.lw.length < 5 || STOP.has(t.lw) || COMMONISH.has(t.lw) || names.has(t.base)) return;
        const prev = lastSeen.get(t.lw);
        if (prev != null && k - prev <= 30 && !reported.has(t.lw) && echoCount < 200) {
          reported.add(t.lw);
          echoCount++;
          const a = toks[prev];
          const quotes = a.S === S ? [makeQuote(S, a.t.s, t.e)] : [makeQuote(a.S, a.t.s, a.t.e), makeQuote(S, t.s, t.e)];
          issues.push({ kind: 'Echo', sev: 'low', key: 'st:echo:' + t.lw + ':' + S.ch + ':' + hash(S.text),
            msg: `"${t.w}" is used twice close together.`, quotes });
        }
        lastSeen.set(t.lw, k);
      });
    }

    // Repeated phrases across the book.
    const total = words.length;
    const minRepeat = Math.max(3, Math.round(total / 30000));
    const grams = new Map();
    for (const S of model.sentences) {
      const T = S.tokens;
      for (const n of [3, 4, 5]) {
        for (let i = 0; i + n <= T.length; i++) {
          const ws = T.slice(i, i + n).map((t) => t.lw);
          const content = ws.filter((w) => !STOP.has(w)).length;
          if (content < 2) continue;
          if (ws.some((w, j) => names.has(T[i + j].base))) continue;
          const k = ws.join(' ');
          let g = grams.get(k);
          if (!g) { g = { n: 0, quotes: [] }; grams.set(k, g); }
          g.n++;
          if (g.quotes.length < 3) g.quotes.push(makeQuote(S, T[i].s, T[i + n - 1].e));
        }
      }
    }
    let phrases = [...grams.entries()].filter(([, g]) => g.n >= minRepeat).sort((a, b) => b[1].n * b[0].length - a[1].n * a[0].length);
    // Drop phrases contained in a longer phrase with the same count.
    phrases = phrases.filter(([k, g]) => !phrases.some(([k2, g2]) => k2 !== k && k2.includes(k) && g2.n >= g.n));
    phrases = phrases.slice(0, 40);
    for (const [k, g] of phrases) {
      issues.push({ kind: 'Repeated phrase', sev: g.n >= minRepeat * 2 ? 'medium' : 'low', key: 'st:phrase:' + k,
        msg: `"${k}" appears ${g.n} times.`, quotes: g.quotes });
    }

    // Very long paragraphs.
    for (const P of model.paragraphs) {
      const n = wordCount(P.text);
      if (n > 300) {
        const S = model.sentences[P.sIdx[0]];
        issues.push({ kind: 'Long paragraph', sev: 'low', key: 'st:para:' + P.ch + ':' + hash(P.text.slice(0, 80)),
          msg: `This paragraph is ${n} words long. Readers may find it heavy going.`, quotes: [makeQuote(S, 0, 0)] });
      }
    }

    const sentences = sentenceWords.length || 1;
    const avgSentence = total / sentences;
    const flesch = 206.835 - 1.015 * avgSentence - 84.6 * (syl / Math.max(1, total));
    const grade = 0.39 * avgSentence + 11.8 * (syl / Math.max(1, total)) - 15.59;
    const per1000 = (n) => Math.round((n / Math.max(1, total)) * 10000) / 10;
    const top = (m, k = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
    const chapterWords = chapters.map((c) => c.paragraphs.reduce((n, p) => n + wordCount(p), 0));

    return {
      issues,
      stats: {
        avgSentence: Math.round(avgSentence * 10) / 10,
        flesch: Math.round(flesch),
        grade: Math.round(grade * 10) / 10,
        dialoguePct: Math.round((dialogueChars / Math.max(1, totalChars)) * 100),
        longSentences: longSentences.length,
        adverbs: { total: [...adverbs.values()].reduce((a, b) => a + b, 0), per1000: per1000([...adverbs.values()].reduce((a, b) => a + b, 0)), top: top(adverbs) },
        filters: { total: [...filters.values()].reduce((a, b) => a + b, 0), per1000: per1000([...filters.values()].reduce((a, b) => a + b, 0)), top: top(filters) },
        crutch: { top: top(crutch, 17).map(([w, n]) => [w, n, per1000(n)]) },
        gestures: { top: top(gestures, 20).map(([w, n]) => [w, n, per1000(n)]) },
        tags: { top: top(tags, 15) },
        passive: { total: passive, per1000: per1000(passive), examples: passiveEx.slice(0, 12) },
        topWords: top(freq, 25),
        phrases: phrases.map(([k, g]) => [k, g.n]),
        chapterWords
      }
    };
  }

  // ------------------------------------------------------------------ main

  function analyze(paragraphs, spell, opts, progress) {
    opts = opts || {};
    progress = progress || (() => {});
    const t0 = Date.now();
    const chapters = splitChapters(paragraphs);
    progress('Reading chapters', 0.05);
    const model = buildModel(chapters);
    progress('Finding characters', 0.15);
    const { names, stats, candidates } = findNames(model, spell, opts);
    const gender = inferGender(model, names);
    const issues = [];
    const push = (cat, it) => {
      const id = cat.slice(0, 2) + ':' + hash(it.key || (it.kind + it.msg));
      issues.push(Object.assign({ id, cat }, it, { key: undefined }));
    };

    // --- name variants
    progress('Checking names', 0.25);
    const established = [...names].filter((n) => (stats.get(n).mid + stats.get(n).start) >= 3);
    const seenPairs = new Set();
    for (const c of candidates) {
      for (const n of established) {
        if (c.name === n || n.length < 3 || c.name.length < 3) continue;
        const a = c.name.toLowerCase(), b = n.toLowerCase();
        if (a === b + 's' || b === a + 's' || a === b + 'es' || b === a + 'es') continue;
        const d = dl(a, b);
        const maxd = Math.min(a.length, b.length) >= 7 ? 2 : 1;
        if (d === 0 || d > maxd) continue;
        if (Math.min(a.length, b.length) <= 4 && a[0] !== b[0]) continue;
        // Derived forms: Quaker / Quakerish, Java / Javan.
        const [sh, lo] = a.length <= b.length ? [a, b] : [b, a];
        const suffix = /^(?:s|es|n|an|ans|ian|ians|ish|ism|ist|ists|ite|ites|ese|er|ers|ic|ly)$/;
        const stem = sh.replace(/s$/, '');
        if ((lo.startsWith(sh) && suffix.test(lo.slice(sh.length))) || (lo.startsWith(stem) && suffix.test(lo.slice(stem.length)))) continue;
        if (a.replace(/men$/, 'man') === b.replace(/men$/, 'man')) continue;
        // A common word in disguise: "Inlanders" is just "inlanders".
        if (spell && (spell.correct(a) || spell.correct(a.replace(/e?s$/, '')))) continue;
        // Two names that are both in the dictionary (Joe / Jove, Sam / Sag) are probably both real.
        // Only flag them when they are the same length, as in Katherine / Catherine.
        const known = (x) => spell && spell.correct(x) && !spell.correct(x.toLowerCase());
        // Two real names from the dictionary: only a typo if they sound the same (Katherine / Catherine).
        if (spell && known(c.name) && !(known(n) && soundKey(a) === soundKey(b))) continue;
        // A real name next to a capitalised ordinary word (Sam / Sag Harbor) is not a typo.
        if (spell && known(c.name) && spell.correct(n.toLowerCase())) continue;
        const k = [a, b].sort().join('|');
        if (seenPairs.has(k)) continue;
        seenPairs.add(k);
        const cn = c.mid + c.start, nn = stats.get(n).mid + stats.get(n).start;
        const [minor, major, mn, mj] = cn <= nn ? [c.name, n, cn, nn] : [n, c.name, nn, cn];
        const minorSt = stats.get(minor);
        const quoteFor = (name) => {
          const st = stats.get(name);
          const S = st.first;
          const t = S.tokens.find((x) => x.base === name);
          return makeQuote(S, t ? t.s : 0, t ? t.e : 0);
        };
        if (mn * 3 <= mj) {
          push('continuity', { kind: 'Name spelling', sev: mn <= 2 ? 'high' : 'medium', key: 'name:' + k,
            msg: `"${minor}" appears ${mn}× but "${major}" appears ${mj}×. Is "${minor}" a misspelling?`,
            fix: major, word: minor, quotes: [quoteFor(minor), quoteFor(major)],
            chapters: [...minorSt.chapters] });
        } else if (d === 1) {
          push('continuity', { kind: 'Similar names', sev: 'low', key: 'sim:' + k,
            msg: `"${minor}" (${mn}×) and "${major}" (${mj}×) are very similar. Make sure they are meant to be different.`,
            quotes: [quoteFor(minor), quoteFor(major)] });
        }
      }
    }

    // --- physical details
    progress('Checking character details', 0.35);
    const attrs = extractAttributes(model, names, gender);
    const ages = extractAges(model, names, gender);
    const heights = extractHeights(model, names, gender);
    const hands = extractHandedness(model, names, gender);
    const profile = new Map();
    const prof = (n) => { if (!profile.has(n)) profile.set(n, { eyes: [], hair: [], age: [], height: [], hand: [] }); return profile.get(n); };

    for (const attr of ['eyes', 'hair']) {
      const compat = attr === 'eyes' ? EYE_COMPAT : HAIR_COMPAT;
      const byOwner = new Map();
      for (const r of attrs.filter((x) => x.attr === attr)) {
        if (!byOwner.has(r.owner)) byOwner.set(r.owner, []);
        byOwner.get(r.owner).push(r);
        prof(r.owner)[attr].push({ value: r.words.join('-'), ch: r.S.ch, conf: r.conf, quote: makeQuote(r.S, r.s, r.e) });
      }
      for (const [owner, recs] of byOwner) {
        const clash = [];
        for (let i = 0; i < recs.length; i++) for (let j = i + 1; j < recs.length; j++) {
          if (!compatible(recs[i].fams, recs[j].fams, compat)) clash.push([recs[i], recs[j]]);
        }
        if (!clash.length) continue;
        // One example of each distinct description.
        const shown = [];
        const ids = new Set();
        for (const [a, b] of clash) for (const r of [a, b]) {
          const k = r.words.join('-');
          if (!ids.has(k)) { ids.add(k); shown.push(r); }
        }
        const anyLow = clash.every(([a, b]) => a.conf === 'low' || b.conf === 'low');
        const label = attr === 'eyes' ? 'Eye colour' : 'Hair colour';
        const who = owner === 'Narrator' ? 'The narrator\'s' : owner + '\'s';
        push('continuity', { kind: label, sev: anyLow ? 'medium' : 'high', key: attr + ':' + owner + ':' + [...ids].sort().join(','),
          msg: `${who} ${attr} are described differently: ` + shown.map((r) => `${r.words.join('-')} (${chapters[r.S.ch].title})`).join(', then ') + '.',
          note: anyLow ? 'Some of these were matched through "his" or "her", so check they really refer to the same person.' : null,
          quotes: shown.slice(0, 4).map((r) => makeQuote(r.S, r.s, r.e)), owner });
      }
    }

    const ageBy = new Map();
    for (const a of ages) {
      if (!ageBy.has(a.owner)) ageBy.set(a.owner, []);
      ageBy.get(a.owner).push(a);
      prof(a.owner).age.push({ value: String(a.value), ch: a.S.ch, conf: a.conf, quote: makeQuote(a.S, a.s, a.e) });
    }
    for (const [owner, list] of ageBy) {
      list.sort((x, y) => x.S.idx - y.S.idx);
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1], c = list[i];
        const sameCh = p.S.ch === c.S.ch;
        const birthdayStep = c.kind === 'birthday' || p.kind === 'birthday';
        if ((sameCh && c.value !== p.value && !(birthdayStep && Math.abs(c.value - p.value) === 1)) || c.value < p.value) {
          push('continuity', { kind: 'Age', sev: c.value < p.value ? 'high' : 'medium', key: 'age:' + owner + ':' + p.value + ':' + c.value,
            msg: c.value < p.value
              ? `${owner === 'Narrator' ? 'The narrator' : owner} is ${p.value} in ${chapters[p.S.ch].title} but ${c.value} later, in ${chapters[c.S.ch].title}.`
              : `${owner === 'Narrator' ? 'The narrator' : owner}'s age is given as both ${p.value} and ${c.value} in ${chapters[c.S.ch].title}.`,
            note: 'If this is a flashback or a time jump, you can ignore it.',
            quotes: [makeQuote(p.S, p.s, p.e), makeQuote(c.S, c.s, c.e)], owner });
        }
      }
    }

    for (const [list, kind, field] of [[heights, 'Height', 'height'], [hands, 'Left or right-handed', 'hand']]) {
      const by = new Map();
      for (const h of list) {
        if (!by.has(h.owner)) by.set(h.owner, []);
        by.get(h.owner).push(h);
        prof(h.owner)[field].push({ value: h.label || h.value, ch: h.S.ch, conf: h.conf, quote: makeQuote(h.S, h.s, h.e) });
      }
      for (const [owner, l] of by) {
        const vals = [...new Set(l.map((x) => x.label || x.value))];
        if (vals.length < 2) continue;
        if (field === 'height' && Math.max(...l.map((x) => x.value)) - Math.min(...l.map((x) => x.value)) <= 1) continue;
        const firsts = vals.map((v) => l.find((x) => (x.label || x.value) === v));
        push('continuity', { kind, sev: firsts.some((x) => x.conf === 'low') ? 'medium' : 'high', key: field + ':' + owner + ':' + vals.sort().join(','),
          msg: `${owner === 'Narrator' ? 'The narrator' : owner} is described as ` + firsts.map((x) => `${x.label || x.value} (${chapters[x.S.ch].title})`).join(' and ') + '.',
          quotes: firsts.slice(0, 3).map((x) => makeQuote(x.S, x.s, x.e)), owner });
      }
    }

    // --- dead characters who come back
    progress('Checking who is still alive', 0.45);
    for (const d of findDeaths(model, names)) {
      push('continuity', { kind: 'Back from the dead', sev: 'medium', key: 'dead:' + d.name + ':' + d.hits.map((h) => h.S.ch).join(','),
        msg: `${d.name} seems to die in ${chapters[d.death.S.ch].title}, but speaks or acts later in ` + d.hits.map((h) => chapters[h.S.ch].title).join(', ') + '.',
        note: 'If this is a flashback, a memory or a ghost, you can ignore it.',
        quotes: [makeQuote(d.death.S, d.death.s, d.death.e)].concat(d.hits.slice(0, 2).map((h) => makeQuote(h.S, h.s, h.e))), owner: d.name });
    }

    // --- timeline
    progress('Checking the timeline', 0.5);
    const tl = timelineAnalysis(model, chapters);
    tl.issues.forEach((it) => push('continuity', it));

    // --- spelling
    let spellingGroups = [];
    if (spell) {
      progress('Checking spelling', 0.6);
      spellingGroups = spellingAnalysis(model, spell, names, opts);
      for (const g of spellingGroups) {
        if (g.isName) {
          push('spelling', { kind: 'Unknown name', sev: 'low', key: 'sp:' + g.word.toLowerCase(),
            msg: `"${g.word}" isn't in the dictionary. If it's a name or place, add it to your words.`,
            word: g.word, count: g.count, sugg: [], chapters: [...g.chapters].sort((a, b) => a - b), quotes: g.quotes });
          continue;
        }
        push('spelling', { kind: 'Spelling', sev: g.count >= 3 ? 'medium' : 'high', key: 'sp:' + g.word.toLowerCase(),
          msg: g.sugg && g.sugg.length ? `"${g.word}" isn't in the dictionary. Did you mean "${g.sugg[0]}"?` : `"${g.word}" isn't in the dictionary.`,
          word: g.word, count: g.count, sugg: g.sugg || [], chapters: [...g.chapters].sort((a, b) => a - b), quotes: g.quotes });
      }
    }
    mixedSpelling(model).forEach((it) => push('spelling', it));
    hyphenation(model).forEach((it) => push('spelling', it));

    // --- grammar
    progress('Checking grammar', 0.75);
    grammarAnalysis(model).forEach((it) => push('grammar', it));

    // --- style
    progress('Writing the style report', 0.85);
    const style = styleAnalysis(model, names, chapters);
    style.issues.forEach((it) => push('style', it));

    // --- characters
    const characters = [...names].map((n) => {
      const st = stats.get(n);
      const chs = [...st.chapters].sort((a, b) => a - b);
      let gap = null;
      for (let i = 1; i < chs.length; i++) {
        const g = chs[i] - chs[i - 1] - 1;
        if (g > 0 && (!gap || g > gap.len)) gap = { from: chs[i - 1], to: chs[i], len: g };
      }
      const counts = new Array(chapters.length).fill(0);
      return { name: n, mentions: st.mid + st.start, chapters: chs, counts, gap, gender: gender.get(n) || null, profile: profile.get(n) || null };
    });
    const charIdx = new Map(characters.map((c) => [c.name, c]));
    for (const S of model.sentences) for (const t of S.tokens) { const c = t.cap && charIdx.get(t.base); if (c) c.counts[S.ch]++; }
    // "Tom Harker", "Gull Point": fold a second word into the first when it nearly always follows it.
    const pairs = new Map();
    for (const S of model.sentences) {
      const T = S.tokens;
      for (let i = 1; i < T.length; i++) {
        if (T[i].cap && T[i - 1].cap && charIdx.has(T[i].base) && charIdx.has(T[i - 1].w) && S.text.slice(T[i - 1].e, T[i].s) === ' ') {
          const k = T[i - 1].w + ' ' + T[i].base;
          pairs.set(k, (pairs.get(k) || 0) + 1);
        }
      }
    }
    const folded = new Set();
    for (const [k, n] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) {
      const [a, b] = k.split(' ');
      const A = charIdx.get(a), B = charIdx.get(b);
      if (!A || !B || folded.has(a) || folded.has(b) || A.full) continue;
      if (n >= B.mentions * 0.8) {
        A.full = k;
        folded.add(b);
        if (B.profile && !A.profile) A.profile = B.profile;
      }
    }
    for (let i = characters.length - 1; i >= 0; i--) if (folded.has(characters[i].name)) characters.splice(i, 1);
    characters.sort((a, b) => b.mentions - a.mentions);
    if (profile.has('Narrator')) characters.push({ name: 'Narrator', mentions: 0, chapters: [], counts: [], gap: null, gender: null, profile: profile.get('Narrator'), narrator: true });

    // Order: by chapter, then severity.
    const sevRank = { high: 0, medium: 1, low: 2 };
    const chOf = (it) => (it.quotes && it.quotes[0] ? it.quotes[0].ch : 0);
    issues.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || chOf(a) - chOf(b));

    progress('Done', 1);
    const totalWords = model.sentences.reduce((n, S) => n + S.tokens.length, 0);
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      dict: opts.dict || 'en-US',
      ms: Date.now() - t0,
      stats: { words: totalWords, chapters: chapters.length, sentences: model.sentences.length, paragraphs: model.paragraphs.length, quoteMode: model.quoteMode },
      chapters: chapters.map((c, i) => ({ title: c.title, words: style.stats.chapterWords[i], source: [c.source[0], c.source[c.source.length - 1]] })),
      issues,
      characters,
      timeline: tl.markers,
      style: style.stats
    };
  }

  const api = { analyze, splitChapters, splitSentences, textToParagraphs, parseNum, parseOrd, dl, _buildModel: buildModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NovelAnalyzer = api;
})(typeof self !== 'undefined' ? self : globalThis);
