// Renders every $…$ / $$…$$ span in the question bank, the mocks, the True/False decks and the Sense Check
// scenarios with KaTeX and reports the ones that fail.
//   NODE_PATH=<dir with katex> node tools/content/katex_bank.mjs [ID-prefix…]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const katex = require('katex');
const only = process.argv.slice(2);
const failures = [];
let spans = 0;

const texts = (q) => [
  ['question', q.question],
  ['solution', q.solution],
  ...q.options.map((o) => [`option ${o.key}`, o.text]),
  ...Object.entries(q.optionAnalysis ?? {}).map(([k, v]) => [`analysis ${k}`, v?.reason]),
  ['trap', q.trap?.explanation],
];

const mocksDir = new URL('../../content/mocks/', import.meta.url);
const files = [
  ...['IR', 'MR', 'CR', 'LR', 'OR', 'CI'].map((s) => `${s}.json`),
  ...(existsSync(mocksDir) ? readdirSync(mocksDir).filter((f) => f.endsWith('.json')).map((f) => `mocks/${f}`) : []),
];
function render(id, where, text) {
  if (typeof text !== 'string') return;
  // Drop escaped dollars and code spans, then pull display and inline math.
  const clean = text.replace(/\\\$/g, '').replace(/`[^`]*`/g, '');
  for (const m of clean.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g)) {
    spans++;
    try {
      katex.renderToString(m[1] ?? m[2], { displayMode: !!m[1], throwOnError: true });
    } catch (e) {
      failures.push(`${id} ${where}: ${String(e.message).slice(0, 120)}`);
    }
  }
}

for (const file of files) {
  for (const q of JSON.parse(readFileSync(new URL(`../../content/${file}`, import.meta.url))).questions) {
    if (only.length && !only.some((p) => q.id.startsWith(p))) continue;
    for (const [where, text] of texts(q)) render(q.id, where, text);
  }
}

// The drills made from the bank: True/False cards and Sense Check scenarios.
const wanted = (id) => !only.length || only.some((p) => id.startsWith(p));
for (const s of ['IR', 'MR', 'CR', 'LR', 'OR', 'CI']) {
  const deck = new URL(`../../content/flashcards/${s}.json`, import.meta.url);
  if (!existsSync(deck)) continue;
  for (const c of JSON.parse(readFileSync(deck)).cards) {
    if (!wanted(c.id)) continue;
    for (const k of ['statement', 'explanation', 'correction']) render(c.id, k, c[k]);
  }
}
const sense = new URL('../../content/games/sensecheck.json', import.meta.url);
if (existsSync(sense)) {
  for (const sc of JSON.parse(readFileSync(sense)).scenarios) {
    if (!wanted(sc.id)) continue;
    for (const k of ['setup', 'ask', 'takeaway']) render(sc.id, k, sc[k]);
    for (const o of sc.options ?? []) for (const k of ['label', 'why']) render(sc.id, `option ${k}`, o[k]);
    for (const w of sc.working ?? []) for (const k of ['label', 'display']) render(sc.id, `working ${k}`, w[k]);
  }
}

console.log(`${spans} math spans, ${failures.length} failed`);
for (const f of failures) console.log('KATEX', f);
process.exit(failures.length ? 1 : 0);
