// Run with: node tests/engine.test.mjs
// Checks that the engine finds every mistake planted in the sample story,
// and a few things it must not flag.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;
globalThis.self = globalThis;
require(root + 'vendor/nspell.js');
const A = require(root + 'engine/analyzer.js');
const speller = (d) => self.nspell(readFileSync(root + `dict/${d}.aff`, 'utf8'), readFileSync(root + `dict/${d}.dic`, 'utf8'));
const spell = speller('en-US');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
const run = (text, opts = {}) => A.analyze(A.textToParagraphs(text), spell, opts);
const has = (r, kind, re) => r.issues.some((i) => i.kind === kind && re.test(i.msg));

const sample = readFileSync(root + 'samples/salt-and-lantern.txt', 'utf8');
const r = run(sample.slice(sample.indexOf('Chapter 1')));

test('splits the sample into six chapters', () => {
  assert.equal(r.chapters.length, 6);
  assert.equal(r.chapters[2].title, 'Chapter 3: Brennan');
});
test('eye colour clash', () => assert.ok(has(r, 'Eye colour', /Mara's eyes.*gray.*blue/)));
test('age going backwards', () => assert.ok(has(r, 'Age', /Elias is 42.*39/)));
test('wrong weekday for a date', () => assert.ok(has(r, 'Timeline', /March 14, 1997 was a Friday/)));
test('impossible date', () => assert.ok(has(r, 'Timeline', /February only has 29 days/)));
test('days of the week that don\'t add up', () => assert.ok(has(r, 'Timeline', /Monday.*should be Tuesday.*Wednesday/)));
test('misspelled name', () => assert.ok(has(r, 'Name spelling', /"Catherine".*"Katherine"/)));
test('character back from the dead', () => assert.ok(has(r, 'Back from the dead', /Brennan/)));
test('spelling mistakes with suggestions', () => {
  for (const [w, s] of [['recieve', 'receive'], ['teh', 'the'], ['definately', 'definitely']]) {
    const it = r.issues.find((i) => i.kind === 'Spelling' && i.word === w);
    assert.ok(it, w + ' not flagged');
    assert.equal(it.sugg[0], s);
  }
});
test('invented surnames are not spelling mistakes', () => {
  assert.ok(!r.issues.some((i) => i.kind === 'Spelling' && i.word === 'Dunmore'));
  assert.ok(r.issues.some((i) => i.kind === 'Unknown name' && i.word === 'Dunmore'));
});
test('grammar slips', () => {
  assert.ok(has(r, 'Wrong word', /"could of" should be "could have"/));
  assert.ok(has(r, 'Wrong word', /rather.*than/));
  assert.ok(has(r, 'Wrong word', /Use "an" before "apple"/));
  assert.ok(has(r, 'Repeated word', /"the" appears twice/));
  assert.ok(has(r, 'Wrong word', /"its not"/i));
});
test('mixed grey/gray', () => assert.ok(has(r, 'Mixed spelling', /grey.*gray/)));
test('repeated phrase', () => assert.ok(has(r, 'Repeated phrase', /"took a deep breath" appears 4 times/)));
test('characters and genders', () => {
  const by = Object.fromEntries(r.characters.map((c) => [c.name, c]));
  assert.equal(by.Mara.gender, 'she');
  assert.equal(by.Tom.gender, 'he');
  assert.equal(by.Tom.full, 'Tom Harker');
  assert.ok(!by["I'm"], '"I\'m" is not a character');
});
test('no false alarms on clean text', () => {
  const clean = run(`Chapter 1\n\nAnna had green eyes and a quiet voice. She took its time, the old clock, and Anna waited.\n\n` +
    `"Ah! how lovely," Anna said. The uninterrupted view went on for miles. It was an honest mistake.\n\nChapter 2\n\n` +
    `Anna's green eyes narrowed. On Monday she left. The next day, Tuesday, she came back. Anna was twelve years old.`);
  const bad = clean.issues.filter((i) => i.cat !== 'style');
  assert.deepEqual(bad.map((i) => i.msg), []);
});
test('heading styles: "CHAPTER 1. Loomings." and Prologue', () => {
  const t = A.splitChapters(A.textToParagraphs('Prologue\n\nIt began.\n\nCHAPTER 1. The Start.\n\nOne two three.\n\nCHAPTER 2. The End.\n\nFour five.'));
  assert.deepEqual(t.map((c) => c.title), ['Prologue', 'CHAPTER 1. The Start.', 'CHAPTER 2. The End.']);
});
test('UK dictionary accepts UK spelling', () => {
  const uk = A.analyze(A.textToParagraphs('Chapter 1\n\nThe colour of the grey harbour was her favourite thing to realise.'), speller('en-GB'), {});
  assert.ok(!uk.issues.some((i) => i.kind === 'Spelling'));
});
test('number parsing', () => {
  assert.equal(A.parseNum('forty-two'), 42);
  assert.equal(A.parseOrd('twenty-first'), 21);
});

console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
