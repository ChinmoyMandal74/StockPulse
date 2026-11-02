// The local earnings release text archive (releasearchive.js), against a
// throwaway file. No network, no Turso.
//
//   node releasearchive-test.js
const fs = require('fs'), os = require('os'), path = require('path');
const RA = require('./releasearchive.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasearchive-'));
const file = path.join(dir, 'r.db');
const A = RA.open(file);
const text = 'Revenue | 57,006 | 35,082\nData center revenue rose 66% — “record”, café. '.repeat(300);
const base = { accn: '0001045810-26-000101', symbol: 'nvda', filed: '2026-08-27', url: 'https://www.sec.gov/x/ex99.htm', exhibit: 'EX-99.1', period_end: '2026-07-26', period_label: 'Second Quarter Fiscal 2027', is_results: true };
check('put: a new release is added', A.put(Object.assign({ text }, base)).added, true);
const g = A.get(base.accn);
check('get: the text comes back exactly', g.text === text, true);
check('get: the details, symbol upper-cased', [g.symbol, g.filed, g.period_end, g.period_label, g.is_results, g.exhibit, g.chars], ['NVDA', '2026-08-27', '2026-07-26', 'Second Quarter Fiscal 2027', true, 'EX-99.1', text.length]);
check('stored compressed', A.db.prepare('select length(body) n from releases').get().n < text.length / 3, true);
check('put again: never replaced', [A.put(Object.assign({}, base, { text: 'other' })).added, A.get(base.accn).text === text], [false, true]);
check('put: refuses a release without text or filing details', [() => A.put(Object.assign({}, base, { text: '' })), () => A.put({ text, symbol: 'X', filed: '2026-01-01' })].map((f) => { try { f(); return 'kept'; } catch { return 'refused'; } }), ['refused', 'refused']);
A.put({ accn: 'a-2', symbol: 'NVDA', filed: '2025-08-27', text: 'older', is_results: false });
A.put({ accn: 'a-3', symbol: 'AMD', filed: '2026-08-05', text: 'amd text', is_results: null });
check('forSymbol: by company and window, oldest first', A.forSymbol('nvda', '2025-01-01', '2026-12-31').map((r) => r.accn), ['a-2', base.accn]);
check('forSymbol: the window bounds', A.forSymbol('NVDA', '2026-01-01', '2026-12-31').length, 1);
check('is_results three-state', [A.get('a-2').is_results, A.get('a-3').is_results], [false, null]);
check('each: every release, oldest first, with text', [...A.each()].map((r) => [r.accn, r.text.length > 0]), [['a-2', true], ['a-3', true], [base.accn, true]]);
check('each: a window, one company, results only', [[...A.each({ from: '2026-01-01' })].length, [...A.each({ symbol: 'amd' })].length, [...A.each({ resultsOnly: true })].map((r) => r.accn)], [2, 1, [base.accn]]);
check('has / accns / count', [A.has(base.accn), A.has('nope'), A.accns().size, A.count()], [true, false, 3, 3]);
A.miss('m-1', 404);
check('misses: noted and listed', [...A.missed()], ['m-1']);
A.close();
const B = RA.open(file);
check('reopened: everything still there', [B.count(), B.missed().size, B.get(base.accn).text === text], [3, 1, true]);
B.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
