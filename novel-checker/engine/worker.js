/* Runs the analysis off the main thread so the page stays responsive on a phone. */
/* global importScripts, NovelAnalyzer, nspell */
importScripts('../vendor/nspell.js', 'analyzer.js');

const spellers = {};

async function getSpeller(dict) {
  if (spellers[dict]) return spellers[dict];
  const [aff, dic] = await Promise.all([
    fetch('../dict/' + dict + '.aff').then((r) => { if (!r.ok) throw new Error('aff ' + r.status); return r.text(); }),
    fetch('../dict/' + dict + '.dic').then((r) => { if (!r.ok) throw new Error('dic ' + r.status); return r.text(); })
  ]);
  spellers[dict] = self.nspell(aff, dic);
  return spellers[dict];
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== 'analyze') return;
  try {
    self.postMessage({ type: 'progress', label: 'Loading the dictionary', value: 0.02 });
    let spell = null;
    try { spell = await getSpeller(msg.options.dict || 'en-US'); }
    catch (err) { self.postMessage({ type: 'warning', message: 'The dictionary could not be loaded, so spelling was skipped.' }); }
    const report = NovelAnalyzer.analyze(msg.paragraphs, spell, msg.options, (label, value) => {
      self.postMessage({ type: 'progress', label, value });
    });
    self.postMessage({ type: 'result', report });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
