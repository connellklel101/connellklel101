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
        if (!st) { st = { name: key, mid: 0, start: 0, bang: 0, chapters: new Set(), first: S }; stats.set(key, st); }
        if (t.start) st.start++; else st.mid++;
        if (/^[!?]/.test(S.text.slice(t.e))) st.bang++;
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
      // "Tish!", "Ahoy!": exclamations, not names.
      if (st.bang >= total * 0.5) continue;
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
    gender.tally = tally;
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

  // ------------------------------------------------------------------ name types (person / place / other)

  const TITLE_RE = /^(?:mr|mrs|ms|mx|miss|dr|doctor|sir|lady|lord|captain|capt|aunt|auntie|uncle|grandma|grandpa|granny|professor|prof|king|queen|prince|princess|detective|inspector|sergeant|sgt|officer|nurse|madam|master|mistress|saint)$/i;
  const PLACE_PREP = new Set(['in', 'into', 'across', 'through', 'outside', 'inside', 'reached', 'visited', 'beyond', 'via', 'onto', 'leaving', 'entered', 'throughout', 'within']);
  const PLACE_NOUN = new Set(('street road lane avenue square park river lake sea ocean bay island isle islands mountain mountains mount hill ' +
    'hills valley forest wood woods city town village county castle palace hall house manor abbey church cathedral bridge station ' +
    'harbor harbour point head cove beach coast falls inn tavern hotel school college university academy hospital airport port ' +
    'tower gate market desert plains kingdom empire province district cross court gardens heath moor fields marsh creek canyon ' +
    'ridge peak cape sound strait gulf channel quay pier wharf row place terrace crescent close drive way').split(' '));
  const SPEECH_RE = new RegExp('^(?:' + TAG_VERBS + '|' + ACTION_VERBS + ')$');
  const TAG_ONLY_RE = /^(?:said|asked|replied|answered|whispered|shouted|muttered|murmured|called|cried|snapped|yelled|hissed)$/;

  function classifyNames(model, stats, gender) {
    const score = new Map();
    const get = (n) => { let s = score.get(n); if (!s) { s = { person: 0, place: 0 }; score.set(n, s); } return s; };
    const sp = (a, b, S) => /^\s+$/.test(S.text.slice(a.e, b.s));
    for (const S of model.sentences) {
      const T = S.tokens;
      for (let i = 0; i < T.length; i++) {
        const t = T[i];
        if (!t.cap || !stats.has(t.base)) continue;
        const s = get(t.base);
        const prev = T[i - 1], next = T[i + 1];
        if (next && !t.poss && sp(t, next, S) && SPEECH_RE.test(next.lw)) s.person += 2;
        if (prev && TAG_ONLY_RE.test(prev.lw) && sp(prev, t, S)) s.person += 2;
        if (prev && prev.cap && TITLE_RE.test(prev.w)) s.person += 2;
        if (t.poss && next && /^(eyes|hair|face|voice|hand|hands|mother|father|sister|brother|wife|husband|son|daughter|friend|smile|lips|mouth|shoulder|shoulders|arm|arms|head)$/.test(next.lw)) s.person += 1;
        if (prev && !prev.cap && !t.poss && PLACE_PREP.has(prev.lw) && sp(prev, t, S)) s.place += 1.5;
        if (next && next.cap && PLACE_NOUN.has(next.lw) && sp(t, next, S)) s.place += 3;
      }
    }
    for (const n of gender.keys()) get(n).person += 3;
    const type = new Map();
    for (const [n, s] of score) {
      if (s.person >= 2 && s.person >= s.place) type.set(n, 'person');
      else if (s.place >= 2 && s.place > s.person) type.set(n, 'place');
      else type.set(n, 'other');
    }
    return type;
  }

  // How sure we are of someone's pronouns: only "strong" genders are used to flag slips.
  function strongGender(gender, n) {
    const g = gender.get(n);
    const t = gender.tally && gender.tally.get(n);
    if (!g || !t) return null;
    const w = t[g], l = t[g === 'he' ? 'she' : 'he'];
    return w >= 4 && w >= l * 4 ? g : null;
  }

  // ------------------------------------------------------------------ pronoun slips

  const SELF_VERBS = 'shook|nodded|tilted|bowed|lowered|cocked|clenched|unclenched|bit|chewed|licked|cleared|narrowed|rolled|' +
    'squared|hunched|shrugged|pursed|furrowed|knitted|knit|gritted|craned|scratched|folded|crossed|uncrossed|puffed|wrinkled|' +
    'arched|hung|scrunched|steepled|flexed|cracked|bobbed|ducked';
  const BODY_PARTS = 'head|hair|eyes|eye|shoulders|shoulder|lip|lips|hands|hand|face|arms|arm|fists|fist|teeth|throat|chin|nose|' +
    'brows|brow|eyebrows|eyebrow|forehead|neck|knuckles|fingers|jaw|cheeks|cheek|mouth|chest|legs|leg|ears|ear';

  function pronounSlips(model, names, gender) {
    const out = [];
    const re1 = new RegExp('\\b([A-Z][A-Za-z\'’-]+)\\s+(?:[a-z]+ly\\s+)?(?:' + SELF_VERBS + ')\\s+(his|her)\\s+(?:[a-z]+\\s+)?(?:' + BODY_PARTS + ')\\b', 'g');
    const re2 = /\b([A-Z][A-Za-z'’-]+)\s+((?:[a-z'’]+\s+){1,4}?)(himself|herself)\b/g;
    for (const S of model.sentences) {
      for (const re of [re1, re2]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(S.text))) {
          if (/['’]s$/.test(m[1]) || inDialogue(S, m.index)) continue;
          const n = m[1];
          if (!names.has(n)) continue;
          if (re === re2 && /\b(her|him|them|me|us|you|it|to)\b/.test(m[2])) continue;
          const g = strongGender(gender, n);
          if (!g) continue;
          const pron = (re === re1 ? m[2] : m[3]).toLowerCase();
          const pg = /^(his|himself)$/.test(pron) ? 'he' : 'she';
          if (pg === g) continue;
          const pos = m.index + m[0].toLowerCase().lastIndexOf(pron);
          out.push({ kind: 'Pronoun', sev: 'high', key: 'pron:' + n + ':' + S.ch + ':' + hash(S.text),
            msg: `${n} is "${g}" everywhere else, but here it says "${pron}".`,
            quotes: [makeQuote(S, pos, pos + pron.length)], owner: n });
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ point of view and tense

  const VERB_BASES = ('say walk look turn run take smile nod open close stand sit go come see hear feel grab pull push step reach ' +
    'glance stare shrug sigh laugh grin frown whisper shout call ask answer reply tell move lean pick put drop hold throw catch ' +
    'start stop wait watch kiss hug climb fall jump drive pause return leave enter follow lift raise shake wipe rub touch slam ' +
    'knock cross wave point slip notice wonder decide try begin keep give get make find hurry rush race wander head stumble ' +
    'glare snap mutter murmur yell scream cry sob breathe swallow blink wince shiver tremble rise sink spin twist bend kneel ' +
    'crouch sleep wake eat drink pour carry bring send write sing hide search grip squeeze shove toss stride storm march sprint ' +
    'dash creep sneak tiptoe gasp groan whimper chuckle giggle smirk scowl beam peer gaze sniff blush flinch hesitate nudge ' +
    'tap stroke kick punch slap hit clutch wrap fold settle shift roll lower lift wade swim crawl fling hurl hand guide lead').split(' ');
  const VERB_SET = new Set(VERB_BASES);
  const PRESENT3 = new Map();
  for (const b of VERB_BASES) {
    let f;
    if (b === 'go') f = 'goes';
    else if (/(s|sh|ch|x|z)$/.test(b)) f = b + 'es';
    else if (/[^aeiou]y$/.test(b)) f = b.slice(0, -1) + 'ies';
    else f = b + 's';
    PRESENT3.set(f, b);
  }
  const IRREG_PAST = new Set(('said ran took stood sat went came saw heard felt held threw caught began kept gave got made found ' +
    'rose sank spun bent knelt slept woke ate drank brought sent wrote sang hid fell drove left told shook struck swung wore tore ' +
    'broke chose spoke stole froze led fed met paid sold bought taught fought sought won lost grew drew flew blew dug stuck swept ' +
    'wept crept leapt strode understood forgot forgave slid strode lit sprang stank swam bit').split(' '));
  const PAST_AUX = new Set(['was', 'were', 'had', 'did']);
  const PRES_AUX3 = new Set(['is', 'has', 'does']);
  const PRES_AUX = new Set(['am', 'are', 'have', 'do']);
  const ADVS = new Set(('just still now then also always never often suddenly slowly quickly finally only already even simply ' +
    'quietly softly gently carefully nearly almost barely immediately instantly abruptly').split(' '));
  const HABIT = /\b(always|usually|every|often|never|sometimes|whenever|each (?:time|morning|night|day)|generally|tends? to|nowadays|these days|still)\b/i;
  const SUBJ = new Set(['he', 'she', 'i', 'we', 'they', 'it']);
  const SAME_PAST = new Set(['put', 'hit', 'set', 'cut', 'let', 'read', 'shut', 'quit', 'cast', 'spread', 'hurt', 'burst', 'cost', 'bet', 'thrust']);
  const ASIDE = new Set(['say', 'suppose', 'think', 'know', 'believe', 'wonder', 'guess', 'mean', 'see', 'hope', 'fear', 'trust', 'tell', 'confess', 'admit', 'remember', 'find', 'feel', 'take', 'ask', 'call']);
  const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself']);

  function isPastAction(w) {
    if (IRREG_PAST.has(w)) return true;
    if (!/ed$/.test(w) || w.length < 4) return false;
    const stems = [w.slice(0, -2), w.slice(0, -1), w.slice(0, -3), w.replace(/ied$/, 'y')];
    return stems.some((s) => VERB_SET.has(s));
  }

  function povTense(model, chapters, names) {
    const ch = chapters.map(() => ({ fp: 0, words: 0, past: 0, pres: 0, fpSent: [], presSent: [], pastSent: [] }));
    for (const S of model.sentences) {
      const C = ch[S.ch];
      const T = S.tokens.filter((t) => !inDialogue(S, t.s));
      if (!T.length) continue;
      C.words += T.length;
      const fpTok = T.find((t) => FIRST_PERSON.has(t.lw) && (t.lw !== 'i' || t.w === 'I'));
      C.fp += T.filter((t) => FIRST_PERSON.has(t.lw) && (t.lw !== 'i' || t.w === 'I')).length;
      if (fpTok) C.fpSent.push({ S, t: fpTok });
      let past = 0, pres = 0, presTok = null, pastTok = null;
      for (let i = 0; i < T.length - 1; i++) {
        const t = T[i];
        const isName = t.cap && names.has(t.base) && !t.poss;
        if (!SUBJ.has(t.lw) && !isName) continue;
        if (t.lw === 'i' && t.w !== 'I') continue;
        let j = i + 1;
        if (T[j] && (ADVS.has(T[j].lw) || (/ly$/.test(T[j].lw) && T[j].lw.length > 4))) j++;
        const v = T[j];
        if (!v || /[.,;:!?"“”—()]/.test(S.text.slice(t.e, v.s))) continue;
        const w = v.lw;
        const third = t.lw === 'he' || t.lw === 'she' || t.lw === 'it' || isName;
        if (PAST_AUX.has(w) || isPastAction(w)) {
          past++;
          if (!PAST_AUX.has(w) && t.lw !== 'it' && !pastTok) pastTok = v;
        } else if (third && PRESENT3.has(w)) {
          pres++;
          if (t.lw !== 'it' && !presTok) presTok = v;
        } else if (third && PRES_AUX3.has(w)) pres++;
        else if (!third && (PRES_AUX.has(w) || VERB_SET.has(w)) && !SAME_PAST.has(w)) {
          pres++;
          // "I say", "I suppose": a narrator's aside, not a slip.
          if (VERB_SET.has(w) && !presTok && !(/^(i|we|they|you)$/.test(t.lw) && ASIDE.has(w))) presTok = v;
        }
      }
      C.past += past;
      C.pres += pres;
      if (presTok && !HABIT.test(S.text)) C.presSent.push({ S, tok: presTok, mixed: past > 0 });
      if (pastTok && pres > 0) C.pastSent.push({ S, tok: pastTok, mixed: true });
    }
    const issues = [];
    const info = ch.map((C) => {
      let pov = null, tense = null;
      if (C.words >= 120) {
        const r = C.fp / C.words;
        pov = r > 0.02 ? 'first' : r < 0.01 ? 'third' : 'mixed';
      }
      if (C.past + C.pres >= 8) tense = C.past >= C.pres * 5 ? 'past' : C.pres >= C.past * 5 ? 'present' : 'mixed';
      return { pov, tense };
    });
    // Only flag a stray "I" when the whole book is told in the third person.
    const bookFp = ch.reduce((n, C) => n + C.fp, 0) / Math.max(1, ch.reduce((n, C) => n + C.words, 0));
    // Short or unclear chapters take the tense of the book as a whole.
    const bookPast = ch.reduce((n, C) => n + C.past, 0), bookPres = ch.reduce((n, C) => n + C.pres, 0);
    const bookTense = bookPast >= bookPres * 5 ? 'past' : bookPres >= bookPast * 5 ? 'present' : null;
    ch.forEach((C, i) => {
      const { pov } = info[i];
      const tense = info[i].tense && info[i].tense !== 'mixed' ? info[i].tense : (C.past + C.pres < 30 ? bookTense : null);
      if (pov === 'third' && bookFp < 0.003) {
        for (const { S, t } of C.fpSent.slice(0, 2)) {
          const thought = /\b(thought|wondered|told (?:him|her)self|said to (?:him|her)self)\b/i.test(S.text) || /^\s*(Dear|PS|P\.S\.)\b/.test(S.text);
          issues.push({ kind: 'Point of view', sev: thought ? 'low' : 'medium', key: 'pov:' + i + ':' + hash(S.text),
            msg: `"${t.w}" appears outside dialogue in a chapter told in the third person.`,
            note: 'If this is a character\'s thought, a letter or a quotation, you can ignore it.',
            quotes: [makeQuote(S, t.s, t.e)] });
        }
      }
      if (tense === 'past') {
        for (const { S, tok, mixed } of C.presSent.slice(0, 3)) {
          issues.push({ kind: 'Tense', sev: 'medium', key: 'tense:' + i + ':' + hash(S.text),
            msg: mixed ? `This sentence switches from the past tense to the present ("${tok.w}") halfway through.`
              : `This sentence is in the present tense ("${tok.w}") but the chapter is told in the past tense.`,
            quotes: [makeQuote(S, tok.s, tok.e)] });
        }
      } else if (tense === 'present') {
        for (const { S, tok } of C.pastSent.slice(0, 3)) {
          issues.push({ kind: 'Tense', sev: 'medium', key: 'tense:' + i + ':' + hash(S.text),
            msg: `This sentence switches from the present tense to the past ("${tok.w}") in a chapter told in the present tense.`,
            quotes: [makeQuote(S, tok.s, tok.e)] });
        }
      }
    });
    // A chapter whose point of view or tense differs from nearly all the others.
    for (const field of ['pov', 'tense']) {
      if (field === 'pov' && bookFp >= 0.003 && bookFp <= 0.02) continue; // a narrator who drifts in and out
      const vals = info.map((x) => x[field]).filter((v) => v && v !== 'mixed');
      if (vals.length < 4) continue;
      const counts = {};
      vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const [main, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (n < vals.length * 0.75) continue;
      info.forEach((x, i) => {
        const v = x[field];
        if (!v || v === 'mixed' || v === main) return;
        const label = field === 'pov' ? { first: 'the first person ("I")', third: 'the third person' } : { past: 'the past tense', present: 'the present tense' };
        const S = model.sentences.find((s) => s.ch === i);
        issues.push({ kind: field === 'pov' ? 'Point of view' : 'Tense', sev: 'low', key: field + '-ch:' + i + ':' + v,
          msg: `${chapters[i].title} is told in ${label[v]}, but most chapters use ${label[main]}.`,
          note: 'Fine if you switch on purpose, for example between narrators.', quotes: S ? [makeQuote(S, 0, 0)] : [] });
      });
    }
    return { issues, info };
  }

  // ------------------------------------------------------------------ more character details

  const SIDE_PARTS = 'cheek|eyebrow|brow|forehead|chin|jaw|jawline|neck|hand|wrist|arm|forearm|shoulder|chest|back|lip|temple|ear|knuckles|palm|thigh|leg|knee|ankle|face|throat|eye|calf|hip|side|collarbone|shin|foot';
  const MARK_RE = new RegExp('\\b(scar|scars|tattoo|tattoos|birthmark|mole)\\b[^.;!?"“”]{0,40}?\\b(?:on|across|along|over|down|under|above|at|from|beneath|below)\\s+(his|her|my|the)\\s+(?:(left|right)\\s+)?(' + SIDE_PARTS + ')\\b', 'gi');
  const ACCENT_RE = /\b([A-Z][a-z]+(?:[- ][A-Z][a-z]+)?)\s+accent\b/g;
  const ACCENT_NOT = new Set(['thick', 'heavy', 'soft', 'broad', 'strong', 'faint', 'slight', 'lilting', 'clipped', 'posh', 'harsh', 'funny', 'odd', 'strange', 'his', 'her', 'the', 'an', 'a']);
  const BUILD_WORDS = { tall: ['tall', 'towering', 'lanky'], short: ['short', 'petite', 'tiny', 'diminutive'],
    slim: ['thin', 'slim', 'skinny', 'slender', 'slight', 'wiry', 'lanky', 'scrawny', 'gaunt'],
    heavy: ['plump', 'stout', 'fat', 'heavyset', 'burly', 'stocky', 'portly', 'chubby', 'overweight', 'rotund'] };
  const BUILD_RE = new RegExp('\\b(he|she|I|[A-Z][a-z\'’]+)\\s+(?:was|is|stood|looked|seemed|had always been|had grown|grew)\\s+' +
    '(?:(?:very|quite|rather|so|too|unusually|remarkably|fairly|surprisingly|incredibly|extremely)\\s+)?(?:(?:tall|short|thin|slim)\\s+and\\s+)?(' +
    [...new Set(Object.values(BUILD_WORDS).flat())].join('|') + ')\\b(?![-\\w])(?!\\s+(?:of|with|on|for|to)\\b)', 'g');
  const THING_COLOURS = { red: ['red', 'scarlet', 'crimson', 'maroon', 'burgundy', 'cherry'], blue: ['blue', 'navy', 'azure', 'cobalt'],
    green: ['green', 'olive', 'emerald'], yellow: ['yellow', 'mustard'], orange: ['orange'], black: ['black', 'jet', 'ebony'],
    white: ['white', 'cream', 'ivory'], grey: ['grey', 'gray', 'silver', 'silvery', 'gunmetal'], brown: ['brown', 'tan', 'beige', 'chestnut', 'bay', 'chocolate'],
    gold: ['gold', 'golden'], purple: ['purple', 'violet'], pink: ['pink'] };
  const THING_IDX = colourIndex(THING_COLOURS);
  const BRANDS = 'Ford|Volvo|Toyota|Mini|Jaguar|Mercedes|BMW|Fiat|Volkswagen|Beetle|Cadillac|Porsche|Honda|Chevy|Chevrolet|Buick|Subaru|Nissan|Audi|Vauxhall|Peugeot|Renault|Citroen|Skoda|Hyundai|Kia|Tesla|Mustang|Corvette';
  const THING_NOUNS = 'car|truck|van|pickup|jeep|motorbike|motorcycle|bike|bicycle|scooter|boat|horse|mare|stallion|pony|dog|cat|sword|ring|necklace|pendant|locket|bracelet|umbrella';
  const THING_RE = new RegExp('\\b(his|her|my|[A-Z][a-z]+[\'’]s)\\s+(?:(?:old|new|battered|beat-up|shiny|little|big|trusty|beloved|vintage|rusty|rusted|ancient|ugly|beautiful|tiny|huge|faithful|dented|sleek|precious|favourite|favorite)\\s+)?(' +
    [...THING_IDX.keys()].join('|') + ')\\s+(?:(?:old|new|vintage|sports|family|estate|police|rusty|little)\\s+)?(' + THING_NOUNS + '|' + BRANDS + ')\\b', 'g');
  const BRAND_RE = new RegExp('^(?:' + BRANDS + ')$');
  const GLASSES_RE = /\b(his|her|my|[A-Z][a-z]+['’]s)\s+(?:(?:reading|thick|wire-rimmed|horn-rimmed|round|dark|half-moon|new|old|gold-rimmed|steel-rimmed)\s+)?(glasses|spectacles|specs)\b(?!\s+of)/g;
  const NO_GLASSES_RE = /\b(?:never|didn['’]t|did not|doesn['’]t|does not|don['’]t|no longer|hadn['’]t ever)\s+(?:wore|wear|worn|need|needed)\s+(?:glasses|spectacles)\b|\b(?:perfect|twenty-twenty|20\/20) (?:eyesight|vision)\b/gi;

  function tokenAt(S, pos) {
    let k = S.tokens.findIndex((t) => t.s >= pos);
    return k < 0 ? S.tokens.length - 1 : k;
  }

  function extractFeatures(model, names, gender) {
    const out = [];
    const add = (r) => { if (r.owner) out.push(r); };
    for (const S of model.sentences) {
      let m;
      // Scars, tattoos, birthmarks
      MARK_RE.lastIndex = 0;
      while ((m = MARK_RE.exec(S.text))) {
        if (inDialogue(S, m.index)) continue;
        const kind = m[1].toLowerCase().replace(/s$/, '');
        const partPos = m.index + m[0].length - m[4].length;
        let own = null;
        if (m[2].toLowerCase() === 'the') own = subjectOwner(model, S, tokenAt(S, m.index), names, gender);
        else own = resolveOwner(model, S, tokenAt(S, partPos), names, gender);
        if (!own) continue;
        const side = m[3] ? m[3].toLowerCase() : null, part = m[4].toLowerCase();
        add({ owner: own.owner, field: 'marks', kind, part, side,
          value: kind + ': ' + (side ? side + ' ' : '') + part, conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
      // Accents
      ACCENT_RE.lastIndex = 0;
      while ((m = ACCENT_RE.exec(S.text))) {
        const v = m[1];
        if (ACCENT_NOT.has(v.toLowerCase()) || inDialogue(S, m.index)) continue;
        const idx = tokenAt(S, m.index);
        let own = resolveOwner(model, S, idx, names, gender);
        if (!own && /\b(?:a|an)\s+(?:\w+\s+)?$/i.test(S.text.slice(0, m.index))) own = subjectOwner(model, S, idx, names, gender);
        if (!own) continue;
        add({ owner: own.owner, field: 'accent', value: v, conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
      // Height and build
      BUILD_RE.lastIndex = 0;
      while ((m = BUILD_RE.exec(S.text))) {
        if (inDialogue(S, m.index)) continue;
        const subj = m[1];
        let own = null;
        if (/^(he|she|I)$/.test(subj)) own = subjectOwner(model, S, tokenAt(S, m.index + m[0].length - m[2].length), names, gender);
        else if (names.has(subj)) own = { owner: subj, conf: 'high' };
        if (!own) continue;
        const word = m[2].toLowerCase();
        for (const [dim, fams] of [['height', ['tall', 'short']], ['build', ['slim', 'heavy']]]) {
          const fam = fams.find((f) => BUILD_WORDS[f].includes(word));
          if (fam) add({ owner: own.owner, field: dim === 'height' ? 'stature' : 'build', fam, value: word, conf: own.conf, S, s: m.index, e: m.index + m[0].length });
        }
      }
      // Things people own: "Dr Ashby's green car"
      THING_RE.lastIndex = 0;
      while ((m = THING_RE.exec(S.text))) {
        const who = m[1];
        let own = null;
        const colourPos = m.index + m[0].indexOf(m[2], who.length);
        if (/['’]s$/.test(who)) { const n = who.replace(/['’]s$/, ''); if (names.has(n)) own = { owner: n, conf: 'high' }; }
        else if (!inDialogue(S, m.index)) own = resolveOwner(model, S, tokenAt(S, colourPos), names, gender);
        if (!own) continue;
        const noun = BRAND_RE.test(m[3]) ? 'car' : m[3].toLowerCase();
        add({ owner: own.owner, field: 'things', noun, colour: m[2].toLowerCase(), fams: [...THING_IDX.get(m[2].toLowerCase())], value: m[2].toLowerCase() + ' ' + (BRAND_RE.test(m[3]) ? m[3] : noun),
          conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
      // Glasses
      GLASSES_RE.lastIndex = 0;
      while ((m = GLASSES_RE.exec(S.text))) {
        if (/\b(?:wine|beer|champagne|drinking|empty|full|shot|their|two)\s+$/i.test(S.text.slice(0, m.index + m[1].length + 1))) continue;
        let own = null;
        if (/['’]s$/.test(m[1])) { const n = m[1].replace(/['’]s$/, ''); if (names.has(n)) own = { owner: n, conf: 'high' }; }
        else if (!inDialogue(S, m.index)) own = resolveOwner(model, S, tokenAt(S, m.index + m[0].length - m[2].length), names, gender);
        if (!own) continue;
        add({ owner: own.owner, field: 'glasses', value: 'wears glasses', wears: true, conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
      NO_GLASSES_RE.lastIndex = 0;
      while ((m = NO_GLASSES_RE.exec(S.text))) {
        if (inDialogue(S, m.index)) continue;
        const own = subjectOwner(model, S, tokenAt(S, m.index), names, gender);
        if (!own) continue;
        add({ owner: own.owner, field: 'glasses', value: 'no glasses', wears: false, conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ family and relationships

  const REL_WORDS = 'mother|father|mum|mom|dad|sister|brother|son|daughter|wife|husband|aunt|uncle|cousin|grandmother|grandfather|grandma|grandpa|granny|niece|nephew|fiancée|fiancé|fiancee|fiance|boyfriend|girlfriend|stepmother|stepfather|stepsister|stepbrother|stepson|stepdaughter';
  const REL_ADJ = '(?:(?:older|younger|little|big|elder|baby|late|dear|twin|beloved|only|eldest|youngest|new)\\s+)?';
  const NM = "([A-Z][a-z]+(?:-[A-Z][a-z]+)?)";
  const REL_NORM = { mum: 'mother', mom: 'mother', dad: 'father', grandma: 'grandmother', granny: 'grandmother', grandpa: 'grandfather', fiancee: 'fiancée', fiance: 'fiancé' };
  const PARTNER = new Set(['wife', 'husband', 'fiancé', 'fiancée', 'boyfriend', 'girlfriend']);
  const UNIQUE_REL = new Set(['mother', 'father', 'wife', 'husband', 'stepmother', 'stepfather']);
  const FEMALE_REL = new Set(['mother', 'sister', 'daughter', 'wife', 'aunt', 'grandmother', 'niece', 'girlfriend', 'fiancée', 'stepmother', 'stepsister', 'stepdaughter']);
  const MALE_REL = new Set(['father', 'brother', 'son', 'husband', 'uncle', 'grandfather', 'nephew', 'boyfriend', 'fiancé', 'stepfather', 'stepbrother', 'stepson']);

  function extractRelations(model, names, gender) {
    const out = [];
    const ok = (n) => n && !CAP_STOP.has(n) && !WEEKDAYS.includes(n.toLowerCase()) && !MONTHS.includes(n.toLowerCase());
    const res = [
      { re: new RegExp('\\b' + NM + "['’]s\\s+" + REL_ADJ + '(' + REL_WORDS + '),?\\s+' + NM + "\\b(?!['’])", 'g'), o: 1, r: 2, b: 3 },
      { re: new RegExp('\\b' + NM + ',\\s+' + NM + "['’]s\\s+" + REL_ADJ + '(' + REL_WORDS + ')\\b', 'g'), b: 1, o: 2, r: 3 },
      { re: new RegExp('\\b' + NM + '\\s+(?:was|is)\\s+' + NM + "['’]s\\s+" + REL_ADJ + '(' + REL_WORDS + ')\\b', 'g'), b: 1, o: 2, r: 3 },
      { re: new RegExp('\\b(his|her|my)\\s+' + REL_ADJ + '(' + REL_WORDS + '),?\\s+' + NM + "\\b(?!['’])", 'g'), p: 1, r: 2, b: 3 },
      { re: new RegExp('\\b' + NM + ',\\s+(his|her|my)\\s+' + REL_ADJ + '(' + REL_WORDS + ')\\b', 'g'), b: 1, p: 2, r: 3 }
    ];
    for (const S of model.sentences) {
      for (const R of res) {
        R.re.lastIndex = 0;
        let m;
        while ((m = R.re.exec(S.text))) {
          const b = m[R.b];
          if (!ok(b) || inDialogue(S, m.index)) continue;
          let owner = null, conf = 'high';
          if (R.o) { owner = m[R.o]; if (!names.has(owner)) continue; }
          else {
            const p = m[R.p].toLowerCase();
            if (p === 'my') owner = 'Narrator';
            else {
              // The person "his/her" refers to: a name earlier in the sentence (not the one being described), or just before.
              const g = p === 'his' ? 'he' : 'she';
              const pPos = m.index + m[0].indexOf(m[R.p], R.p > R.b ? m[R.b].length : 0);
              const cands = nameTokens(S, names).filter((i) => S.tokens[i].s < pPos && S.tokens[i].base !== b).map((i) => S.tokens[i].base).reverse();
              for (let k = S.idx - 1; k >= 0 && k >= S.idx - 3 && model.sentences[k].ch === S.ch; k--) {
                const P = model.sentences[k];
                cands.push(...nameTokens(P, names).map((i) => P.tokens[i].base).filter((n) => n !== b).reverse());
              }
              owner = cands.find((n) => gender.get(n) === g) || (new Set(cands).size === 1 && !gender.has(cands[0]) ? cands[0] : null);
              conf = 'medium';
            }
            if (!owner || inDialogue(S, m.index)) continue;
          }
          if (owner === b) continue;
          let rel = m[R.r].toLowerCase();
          rel = REL_NORM[rel] || rel;
          out.push({ owner, rel, b, conf, S, s: m.index, e: m.index + m[0].length });
        }
      }
    }
    return out;
  }

  function relationIssues(rels, gender, chapters) {
    const issues = [];
    const t = (x) => chapters[x.S.ch].title;
    const who = (o) => (o === 'Narrator' ? 'the narrator' : o);
    // Same relation, different person: "Katherine's husband, Walter" then "Katherine's husband, Albert".
    const byRel = new Map();
    const byPair = new Map();
    for (const r of rels) {
      if (UNIQUE_REL.has(r.rel)) { const k = r.owner + '|' + r.rel; if (!byRel.has(k)) byRel.set(k, []); byRel.get(k).push(r); }
      const k2 = r.owner + '|' + r.b;
      if (!byPair.has(k2)) byPair.set(k2, []);
      byPair.get(k2).push(r);
    }
    for (const [k, list] of byRel) {
      const people = [...new Set(list.map((r) => r.b))];
      if (people.length < 2) continue;
      const firsts = people.map((p) => list.find((r) => r.b === p));
      issues.push({ kind: 'Family', sev: 'high', key: 'rel1:' + k + ':' + people.sort().join(','),
        msg: `${cap(who(firsts[0].owner))}'s ${firsts[0].rel} is called ` + firsts.map((r) => `${r.b} (${t(r)})`).join(' and ') + '.',
        note: 'Fine if they remarried or there are two of them.', quotes: firsts.slice(0, 3).map((r) => makeQuote(r.S, r.s, r.e)), owner: firsts[0].owner });
    }
    // Same two people, different relation: "Elias, Mara's father" then "Mara's uncle Elias".
    for (const [k, list] of byPair) {
      const relsHere = [...new Set(list.map((r) => (PARTNER.has(r.rel) ? 'partner' : r.rel.replace(/^step/, ''))))];
      if (relsHere.length < 2) continue;
      const firsts = [...new Set(list.map((r) => r.rel))].map((rel) => list.find((r) => r.rel === rel));
      issues.push({ kind: 'Family', sev: 'high', key: 'rel2:' + k + ':' + relsHere.sort().join(','),
        msg: `${firsts[0].b} is called ${who(firsts[0].owner)}'s ` + firsts.map((r) => `${r.rel} (${t(r)})`).join(' and ') + '.',
        quotes: firsts.slice(0, 3).map((r) => makeQuote(r.S, r.s, r.e)), owner: firsts[0].b });
    }
    // A relation that doesn't fit the person's pronouns: "Tom" called someone's sister.
    const seen = new Set();
    for (const r of rels) {
      const g = strongGender(gender, r.b);
      if (!g || seen.has(r.b + r.rel)) continue;
      if ((g === 'he' && FEMALE_REL.has(r.rel)) || (g === 'she' && MALE_REL.has(r.rel))) {
        seen.add(r.b + r.rel);
        issues.push({ kind: 'Family', sev: 'medium', key: 'rel3:' + r.b + ':' + r.rel,
          msg: `${r.b} is called ${who(r.owner)}'s ${r.rel}, but is "${g}" everywhere else.`, quotes: [makeQuote(r.S, r.s, r.e)], owner: r.b });
      }
    }
    return issues;
  }

  // ------------------------------------------------------------------ story calendar

  // Northern-hemisphere seasons each month can belong to.
  const MONTH_SEASONS = [['winter'], ['winter'], ['winter', 'spring'], ['spring'], ['spring'], ['spring', 'summer'], ['summer'],
    ['summer'], ['summer', 'autumn'], ['autumn'], ['autumn', 'winter'], ['winter', 'autumn']];
  const HOLIDAYS = [
    { re: /christmas eve/i, name: 'Christmas Eve', month: 11, day: 24 },
    { re: /christmas(?: day| morning)?/i, name: 'Christmas', month: 11, day: 25 },
    { re: /new year['’]s eve/i, name: "New Year's Eve", month: 11, day: 31 },
    { re: /new year['’]s day/i, name: "New Year's Day", month: 0, day: 1 },
    { re: /halloween/i, name: 'Halloween', month: 9, day: 31 },
    { re: /valentine['’]s day/i, name: "Valentine's Day", month: 1, day: 14 },
    { re: /bonfire night|guy fawkes night/i, name: 'Bonfire Night', month: 10, day: 5 },
    { re: /easter(?: sunday| morning| day)?/i, name: 'Easter', months: [2, 3] },
    { re: /thanksgiving/i, name: 'Thanksgiving', months: [9, 10] },
    { re: /midsummer(?:['’]s)?(?: eve| day)?/i, name: 'Midsummer', months: [5] }
  ];
  const DAY = 86400000;
  const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m, d) / DAY);
  const fromDay = (n) => { const d = new Date(n * DAY); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; };
  const fmtDay = (n) => { const x = fromDay(n); return `${cap(WEEKDAYS[x.wd]).slice(0, 3)} ${x.d} ${cap(MONTHS[x.m]).slice(0, 3)} ${x.y}`; };
  const FLASHBACK = /\b(remembered|recalled|years (?:ago|before|earlier)|as a (?:child|boy|girl|teenager)|back then|in those days|used to|long ago|once upon|when (?:he|she|I|they) (?:was|were) (?:young|little|a child|a boy|a girl|small))\b/i;

  function storyCalendar(model, chapters) {
    const WD = WEEKDAYS.join('|'), MO = MONTHS.join('|');
    const fullDate = new RegExp('\\b(?:(' + WD + '),?\\s+)?(?:(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + MO + ')|(' + MO + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:,?\\s+(\\d{4}))?\\b', 'gi');
    const yearOnly = /\b(?:in|the (?:spring|summer|autumn|fall|winter) of|it was|that was)\s+(1[5-9]\d\d|20\d\d|21\d\d)\b/gi;
    const jumpRe = new RegExp('\\b(?:the\\s+)?(?:next|following)\\s+(day|morning|afternoon|evening|night|week|month|year)\\b|\\bthe day after\\b|\\b(' + NUM_WORD + '|a|one|a few|several)\\s+(days?|weeks?|months?|years?)\\s+later\\b', 'gi');
    const seasonRe = /\b(?:that|this|the|in|early|late|mid|midst of|middle of|height of|depths of|dead of)\s+(spring|summer|autumn|winter)\b(?!\s+(?:coat|clothes|sun|sky|light|air|storm|storms|months|term|holidays?|wind|winds|jacket|dress|boots|uniform|evening|evenings|morning|mornings|day|days|night|nights|of\s+(?:\d{4}|life|his|her|my|their)))/gi;
    const holidayRe = /\b(?:it was|on|that|this)\s+(christmas eve|christmas(?: day| morning)?|new year['’]s (?:eve|day)|halloween|valentine['’]s day|bonfire night|guy fawkes night|easter(?: sunday| morning| day)?|thanksgiving|midsummer(?:['’]s)?(?: eve| day)?)\b/gi;
    const issues = [];
    const st = { date: null, exact: false, approx: false, year: null, anchorCh: -1, monthHint: null };
    const yearAt = new Array(model.sentences.length).fill(null);
    const cal = chapters.map(() => ({ first: null, last: null, exactFirst: false, year: null }));
    let lastCh = -1;
    const setDate = (S, n, why) => {
      if (st.date != null && n < st.date - 1 && !FLASHBACK.test(S.text)) {
        issues.push({ kind: 'Time goes backwards', sev: 'medium', key: 'back:' + S.ch + ':' + hash(S.text),
          msg: `The story has already reached ${fmtDay(st.date)} (${chapters[st.dateCh].title}), but here it is ${fmtDay(n)}, which is earlier.`,
          note: 'If this is a flashback, you can ignore it.', quotes: [why] });
      }
      st.date = n; st.exact = true; st.approx = false; st.year = fromDay(n).y; st.anchorCh = S.ch; st.dateCh = S.ch; st.dateIdx = S.idx;
    };
    for (const S of model.sentences) {
      if (S.ch !== lastCh) { st.exact = false; st.monthHint = null; lastCh = S.ch; }
      const flash = FLASHBACK.test(S.text);
      const events = [];
      let m;
      if (!flash) {
        fullDate.lastIndex = 0;
        while ((m = fullDate.exec(S.text))) {
          if (inDialogue(S, m.index)) continue;
          const monName = m[3] || m[4];
          if (!/^[A-Z]/.test(monName)) continue;
          events.push({ pos: m.index, type: 'date', m });
        }
        yearOnly.lastIndex = 0;
        // A year sets the story's "now" unless it's about something else: a birth, a death, a building...
        const otherYear = /\b(born|died|married|since|until|before|after|founded|built|opened|closed|in the year|graduated|moved)\b/i.test(S.text);
        while ((m = yearOnly.exec(S.text))) if (!otherYear && !inDialogue(S, m.index)) events.push({ pos: m.index, type: 'year', y: +m[1] });
        jumpRe.lastIndex = 0;
        while ((m = jumpRe.exec(S.text))) if (!inDialogue(S, m.index)) events.push({ pos: m.index, type: 'jump', m });
        holidayRe.lastIndex = 0;
        while ((m = holidayRe.exec(S.text))) if (!inDialogue(S, m.index)) events.push({ pos: m.index, type: 'holiday', m });
        const wdRe = new RegExp('\\b(' + WD + ')\\b', 'gi');
        while ((m = wdRe.exec(S.text))) if (/^[A-Z]/.test(m[1]) && !inDialogue(S, m.index)) events.push({ pos: m.index, type: 'weekday', d: WEEKDAYS.indexOf(m[1].toLowerCase()) });
        seasonRe.lastIndex = 0;
        while ((m = seasonRe.exec(S.text))) if (!inDialogue(S, m.index)) events.push({ pos: m.index, type: 'season', m });
      }
      events.sort((a, b) => a.pos - b.pos);
      let datedHere = false;
      for (const ev of events) {
        const q = () => makeQuote(S, ev.pos, ev.pos + (ev.m ? ev.m[0].length : 4));
        if (ev.type === 'date') {
          const mm = ev.m;
          const mon = MONTHS.indexOf((mm[3] || mm[4]).toLowerCase());
          const day = +(mm[2] || mm[5]);
          st.monthHint = { m: mon, idx: S.idx };
          if (day < 1 || day > (mon === 1 ? 29 : MONTH_DAYS[mon])) continue; // impossible dates are reported elsewhere
          let y = mm[6] ? +mm[6] : null;
          if (y == null) {
            if (st.year == null) continue;
            y = st.year;
            if (st.date != null && dayNum(y, mon, day) < st.date - 1) y++; // "the following March"
          }
          const n = dayNum(y, mon, day);
          if (fromDay(n).m !== mon) continue;
          setDate(S, n, q());
          datedHere = true;
          if (mm[1]) { /* weekday given with the date: checked by the timeline check */ }
        } else if (ev.type === 'year') {
          if (st.date == null || fromDay(st.date).y !== ev.y) { st.year = ev.y; st.anchorCh = S.ch; if (st.date != null) { st.date = dayNum(ev.y, 0, 1); st.exact = false; st.approx = true; st.dateCh = S.ch; } }
        } else if (ev.type === 'holiday') {
          const h = HOLIDAYS.find((x) => x.re.test(ev.m[1]));
          if (!h) continue;
          const known = st.date != null && (st.exact || datedHere) && S.idx - (st.dateIdx || 0) <= 40 ? fromDay(st.date).m
            : st.monthHint && S.idx - st.monthHint.idx <= 30 ? st.monthHint.m : null;
          const okMonths = h.months || [h.month];
          if (known != null && !okMonths.includes(known)) {
            issues.push({ kind: 'Season', sev: 'medium', key: 'hol:' + S.ch + ':' + hash(S.text),
              msg: `It's ${h.name} here, but the story is in ${cap(MONTHS[known])}.`, quotes: [q()] });
          }
          if (h.day && st.year != null) setDate(S, dayNum(st.date != null && fromDay(st.date).m > h.month ? st.year + 1 : st.year, h.month, h.day), q());
        } else if (ev.type === 'jump' && st.date != null) {
          const mm = ev.m;
          let days = 1, approx = false;
          if (mm[1]) { const u = mm[1].toLowerCase(); days = u === 'week' ? 7 : u === 'month' ? 30 : u === 'year' ? 365 : 1; approx = u === 'month' || u === 'year'; }
          else if (mm[3]) {
            const nRaw = mm[2].toLowerCase();
            const n = /^(a|one)$/.test(nRaw) ? 1 : /few|several/.test(nRaw) ? 3 : parseNum(nRaw) || 1;
            const u = mm[3].toLowerCase().replace(/s$/, '');
            days = n * (u === 'week' ? 7 : u === 'month' ? 30 : u === 'year' ? 365 : 1);
            approx = u === 'month' || u === 'year' || /few|several/.test(nRaw);
          }
          st.date += days;
          st.dateCh = S.ch;
          if (approx) { st.approx = true; st.exact = false; }
          if (days >= 60) st.anchorCh = -99; // a long jump: earlier years are no longer reliable for ages
          st.year = fromDay(st.date).y;
        } else if (ev.type === 'weekday' && st.date != null) {
          const cur = fromDay(st.date).wd;
          if (!st.exact || !datedHere) { st.date += (ev.d - cur + 7) % 7; st.dateCh = S.ch; }
        } else if (ev.type === 'season') {
          const season = ev.m[1].toLowerCase();
          const known = st.date != null && st.exact && S.idx - (st.dateIdx || 0) <= 40 && st.dateCh === S.ch ? fromDay(st.date).m
            : st.monthHint && S.idx - st.monthHint.idx <= 30 ? st.monthHint.m : null;
          if (known != null && !MONTH_SEASONS[known].includes(season)) {
            issues.push({ kind: 'Season', sev: 'medium', key: 'season:' + S.ch + ':' + hash(S.text),
              msg: `The text says it's ${season}, but the story is in ${cap(MONTHS[known])} here.`,
              note: 'This assumes the northern hemisphere. If your story is set in the south, ignore it.', quotes: [q()] });
          }
        }
      }
      // Months named on their own ("by April the ice had gone") help the season check.
      const monRe = new RegExp('\\b(' + MO + ')\\b', 'gi');
      while ((m = monRe.exec(S.text))) if (/^[A-Z]/.test(m[1]) && m[1] !== 'May' && !inDialogue(S, m.index)) st.monthHint = { m: MONTHS.indexOf(m[1].toLowerCase()), idx: S.idx };
      // The story year here, if we can trust it: set in this chapter or the two before, with no long jump since.
      if (!flash && st.year != null && st.anchorCh >= 0 && S.ch - st.anchorCh <= 2 && !st.approx) yearAt[S.idx] = st.year;
      if (st.date != null) {
        const c = cal[S.ch];
        if (c.first == null) { c.first = st.date; c.exactFirst = st.exact; }
        c.last = st.date;
        c.year = fromDay(st.date).y;
      } else if (st.year != null) cal[S.ch].year = st.year;
    }
    const chapterDates = cal.map((c) => ({
      from: c.first != null ? fmtDay(c.first) : null, to: c.last != null && c.last !== c.first ? fmtDay(c.last) : null,
      exact: c.exactFirst, year: c.year
    }));
    return { issues, yearAt, chapterDates };
  }

  function extractBirths(model, names, gender) {
    const MO = MONTHS.join('|');
    const re = new RegExp('\\bborn\\s+(?:in\\s+|on\\s+)?(?:the\\s+)?(?:(?:spring|summer|autumn|fall|winter)\\s+of\\s+)?(?:(?:\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:' + MO + ')\\s+|(?:' + MO + ')\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?)?(1[5-9]\\d\\d|20\\d\\d)\\b', 'gi');
    const out = [];
    for (const S of model.sentences) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(S.text))) {
        if (inDialogue(S, m.index)) continue;
        const own = subjectOwner(model, S, tokenAt(S, m.index), names, gender);
        if (!own) continue;
        out.push({ owner: own.owner, year: +m[1], conf: own.conf, S, s: m.index, e: m.index + m[0].length });
      }
    }
    return out;
  }

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
    const nameType = classifyNames(model, stats, gender);
    const typeOf = (x) => nameType.get(x) || 'other';
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
        // A person and a place with similar names are not a misspelling of each other.
        const ta = typeOf(c.name), tb = typeOf(n);
        if (ta !== 'other' && tb !== 'other' && ta !== tb) continue;
        if (ta === 'place' && tb === 'place' && !(c.mid + c.start <= 2 && soundKey(a) === soundKey(b))) continue;
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
    const prof = (n) => {
      if (!profile.has(n)) profile.set(n, { eyes: [], hair: [], age: [], born: [], height: [], stature: [], build: [], hand: [], marks: [], glasses: [], accent: [], family: [], things: [] });
      return profile.get(n);
    };
    const possPron = (o) => (o === 'Narrator' ? 'my' : gender.get(o) === 'he' ? 'his' : gender.get(o) === 'she' ? 'her' : 'their');
    const whoName = (o) => (o === 'Narrator' ? 'The narrator' : o);
    const calendar = storyCalendar(model, chapters);
    const births = extractBirths(model, names, gender);
    const birthBy = new Map();
    for (const b of births) {
      if (!birthBy.has(b.owner)) birthBy.set(b.owner, b);
      prof(b.owner).born.push({ value: String(b.year), ch: b.S.ch, conf: b.conf, quote: makeQuote(b.S, b.s, b.e) });
    }

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
      const who = whoName(owner);
      // Against a stated birth year.
      const born = birthBy.get(owner);
      if (born) {
        for (const a of list) {
          const y = calendar.yearAt[a.S.idx];
          if (y == null) continue;
          const lo = y - born.year - 1, hi = y - born.year;
          if (a.value < lo || a.value > hi) {
            push('continuity', { kind: 'Age and year', sev: 'high', key: 'ageyr:' + owner + ':' + born.year + ':' + a.value + ':' + y,
              msg: `${who} was born in ${born.year}, so in ${y} ${possPron(owner) === 'their' ? 'they' : possPron(owner) === 'his' ? 'he' : possPron(owner) === 'her' ? 'she' : 'I'} would be ${lo} or ${hi}, not ${a.value}.`,
              note: 'The year comes from the most recent date in the story. If time has passed that the text doesn\'t mention, ignore this.',
              quotes: [makeQuote(born.S, born.s, born.e), makeQuote(a.S, a.s, a.e)], owner });
            break;
          }
        }
      }
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1], c = list[i];
        const yp = calendar.yearAt[p.S.idx], yc = calendar.yearAt[c.S.idx];
        if (yp != null && yc != null) {
          // Both ages have a known story year: the gap in age should match the gap in years.
          if (Math.abs((c.value - p.value) - (yc - yp)) > 1) {
            push('continuity', { kind: 'Age and year', sev: 'high', key: 'age2:' + owner + ':' + p.value + ':' + c.value,
              msg: `${who} is ${p.value} in ${yp} (${chapters[p.S.ch].title}) but ${c.value} in ${yc} (${chapters[c.S.ch].title}).`,
              quotes: [makeQuote(p.S, p.s, p.e), makeQuote(c.S, c.s, c.e)], owner });
          }
          continue;
        }
        const sameCh = p.S.ch === c.S.ch;
        const birthdayStep = c.kind === 'birthday' || p.kind === 'birthday';
        if ((sameCh && c.value !== p.value && !(birthdayStep && Math.abs(c.value - p.value) === 1)) || c.value < p.value) {
          push('continuity', { kind: 'Age', sev: c.value < p.value ? 'high' : 'medium', key: 'age:' + owner + ':' + p.value + ':' + c.value,
            msg: c.value < p.value
              ? `${who} is ${p.value} in ${chapters[p.S.ch].title} but ${c.value} later, in ${chapters[c.S.ch].title}.`
              : `${who}'s age is given as both ${p.value} and ${c.value} in ${chapters[c.S.ch].title}.`,
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

    // --- scars, accents, build, belongings, glasses
    const feats = extractFeatures(model, names, gender);
    const groups = new Map();
    for (const f of feats) {
      prof(f.owner)[f.field].push({ value: f.value, ch: f.S.ch, conf: f.conf, quote: makeQuote(f.S, f.s, f.e) });
      const k = f.owner + '|' + f.field + '|' + (f.field === 'marks' ? f.kind + '|' + f.part : f.field === 'things' ? f.noun : '');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    const ref = (f) => chapters[f.S.ch].title;
    for (const [k, list] of groups) {
      const o = list[0].owner, who = whoName(o), field = list[0].field;
      const sev = (xs) => (xs.some((x) => x.conf === 'low') ? 'medium' : 'high');
      let clash = null;
      if (field === 'marks') {
        const sides = [...new Set(list.filter((x) => x.side).map((x) => x.side))];
        if (sides.length > 1) {
          const xs = sides.map((sd) => list.find((x) => x.side === sd));
          clash = { kind: cap(list[0].kind), sev: sev(xs), xs,
            msg: `${who}'s ${list[0].kind} is on ${possPron(o)} ` + xs.map((x) => `${x.side} ${x.part} (${ref(x)})`).join(' and on the ') + '.' };
        }
      } else if (field === 'accent') {
        const vals = [...new Set(list.map((x) => x.value.toLowerCase()))];
        if (vals.length > 1) {
          const xs = vals.map((v) => list.find((x) => x.value.toLowerCase() === v));
          clash = { kind: 'Accent', sev: 'medium', xs, msg: `${who}'s accent is described as ` + xs.map((x) => `${x.value} (${ref(x)})`).join(' and ') + '.' };
        }
      } else if (field === 'stature' || field === 'build') {
        const fams = [...new Set(list.map((x) => x.fam))];
        if (fams.length > 1) {
          const xs = fams.map((fm) => list.find((x) => x.fam === fm));
          clash = { kind: field === 'stature' ? 'Height' : 'Build', sev: field === 'stature' ? sev(xs) : 'medium', xs,
            msg: `${who} is described as ` + xs.map((x) => `${x.value} (${ref(x)})`).join(' and ') + '.' };
        }
      } else if (field === 'things') {
        const xs = [];
        for (const x of list) if (!xs.some((y) => compatible(y.fams, x.fams, []))) xs.push(x);
        if (xs.length > 1) clash = { kind: 'Belongings', sev: 'medium', xs,
          msg: `${who}'s ${list[0].noun} is ` + xs.map((x) => `${x.colour} (${ref(x)})`).join(' and ') + '.',
          note: 'Fine if they have more than one.' };
      } else if (field === 'glasses') {
        const yes = list.find((x) => x.wears), no = list.find((x) => !x.wears);
        if (yes && no) clash = { kind: 'Glasses', sev: 'medium', xs: [yes, no], msg: `${who} wears glasses in ${ref(yes)}, but ${ref(no)} says otherwise.` };
      }
      if (clash) {
        push('continuity', { kind: clash.kind, sev: clash.sev, key: 'feat:' + k + ':' + clash.xs.map((x) => x.value).sort().join(','),
          msg: clash.msg, note: clash.note || null, quotes: clash.xs.slice(0, 3).map((x) => makeQuote(x.S, x.s, x.e)), owner: o });
      }
    }

    // --- family
    const rels = extractRelations(model, names, gender);
    for (const r of rels) {
      prof(r.b).family.push({ value: `${r.owner === 'Narrator' ? 'the narrator' : r.owner}'s ${r.rel}`, ch: r.S.ch, conf: r.conf, quote: makeQuote(r.S, r.s, r.e) });
    }
    relationIssues(rels, gender, chapters).forEach((it) => push('continuity', it));

    // --- pronouns, point of view, tense
    progress('Checking pronouns, point of view and tense', 0.42);
    pronounSlips(model, names, gender).forEach((it) => push('continuity', it));
    const pt = povTense(model, chapters, names);
    pt.issues.forEach((it) => push('continuity', it));
    calendar.issues.forEach((it) => push('continuity', it));

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
      return { name: n, mentions: st.mid + st.start, chapters: chs, counts, gap, gender: gender.get(n) || null, type: typeOf(n), profile: profile.get(n) || null };
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
        if (PLACE_NOUN.has(b.toLowerCase())) A.type = 'place';
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
      version: 2,
      createdAt: new Date().toISOString(),
      dict: opts.dict || 'en-US',
      ms: Date.now() - t0,
      stats: { words: totalWords, chapters: chapters.length, sentences: model.sentences.length, paragraphs: model.paragraphs.length, quoteMode: model.quoteMode },
      chapters: chapters.map((c, i) => ({ title: c.title, words: style.stats.chapterWords[i], source: [c.source[0], c.source[c.source.length - 1]],
        pov: pt.info[i].pov, tense: pt.info[i].tense, dates: calendar.chapterDates[i] })),
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
