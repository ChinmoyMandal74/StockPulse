// research.js on fixtures, then the real docs/research.md. No server, no network.
//   node research-test.js
const fs = require('fs');
const R = require('./research.js');
let ran = 0, failed = 0;
const check = (name, ok, extra) => { ran++; if (!ok) { failed++; console.log('FAIL', name, extra || ''); } };

const fx = [
  '# Research', '', 'The method.', '',
  '<!-- ## 99. A commented-out example — 2026-01-01 -->', '',
  '## 2. Second idea — 2026-10-15', '',
  '*Family: Mean reversion · Verdict: one period only · Horizon: 1 month · Data: Daily prices · Sample: 658 events*', '',
  '### The idea', 'Bounce near the 200-day.', '', 'More detail.', '',
  '### What was done', '- Events counted once', '',
  '### Outcome', 'Average **+4.8%**.', '',
  '### What follows', 'Not used.', '',
  '### Numbers', '| a | b |', '|---|---|', '| 1 | 2 |', '',
  '## 3. No filing line', '', '### The idea', 'Only an idea.', '',
  '## 4. Unknown verdict — 2026-10-16', '', '*Family: X · Verdict: Maybe*', '', '### Outcome', 'Text.',
].join('\n');
const p = R.parse(fx);
check('three entries, the commented example ignored', p.entries.length === 3, p.entries.map((e) => e.n).join(','));
const e2 = p.entries[0];
check('number, title and date from the heading', e2.n === 2 && e2.title === 'Second idea' && e2.date === '2026-10-15', JSON.stringify([e2.title, e2.date]));
check('verdict matched case-insensitively to the canonical word', e2.verdict === 'One period only', e2.verdict);
check('filing keys carried', e2.family === 'Mean reversion' && e2.horizon === '1 month' && e2.data === 'Daily prices' && e2.sample === '658 events');
check('section summaries are the first paragraph', e2.idea === 'Bounce near the 200-day.', e2.idea);
check('a section opening on a list summarises its first item', e2.done === 'Events counted once', e2.done);
check('markdown marks stripped from the summary', e2.outcome === 'Average +4.8%.', e2.outcome);
check('numbers table drawn', /<table>/.test(e2.html) && e2.hasNumbers);
check('complete entry has nothing missing', e2.filed && e2.missing.length === 0, e2.missing.join(','));
const e3 = p.entries[1];
check('no filing line: shown as Unfiled', !e3.filed && e3.verdict === 'Unfiled' && e3.family === 'Unfiled');
check('missing sections are listed', e3.missing.join(',') === 'done,outcome,follows', e3.missing.join(','));
check('an unknown verdict is kept as written', p.entries[2].verdict === 'Maybe', p.entries[2].verdict);
check('the preamble becomes the method, without the title', /The method/.test(p.introHtml) && !/# Research/.test(p.introHtml));
check('nothing in, nothing out', R.parse('').entries.length === 0 && R.parse(null).entries.length === 0);
check('filing ignores an italic sentence with no key', R.filing('*just emphasis*') === null);

// ---- the real file
const real = R.parse(fs.readFileSync(__dirname + '/docs/research.md', 'utf8'));
check('the real file has entries', real.entries.length >= 12, real.entries.length);
const nums = real.entries.map((e) => e.n);
check('entry numbers are unique', new Set(nums).size === nums.length);
// Front-end backtests are not on the page (owner, 2026-10-15); their numbers stay gaps.
check('removed front-end entries stay out', ![5, 6, 9].some((n) => nums.includes(n)), nums.join(','));
for (const e of real.entries) {
  check('entry ' + e.n + ' is filed', e.filed);
  check('entry ' + e.n + ' has a known verdict', R.VERDICTS.includes(e.verdict), e.verdict);
  check('entry ' + e.n + ' has all four sections', e.missing.length === 0, e.missing.join(','));
  // The site never tells anyone to trade, and the Signal's retired words
  // never come back.
  const words = e.html.replace(/<[^>]+>/g, ' ');
  check('entry ' + e.n + ' carries no trading instruction or retired Signal word',
    !/\b(buy|sell|hold|strong buy|sell immediately|avoid|buy with risk)\b/i.test(words), (words.match(/\b(buy|sell|hold|avoid)\w*/gi) || []).join(','));
}
check('the method carries no trading word', !/\b(buy|buys|sell|hold)\b/i.test(real.introHtml.replace(/<[^>]+>/g, ' ')));
console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
