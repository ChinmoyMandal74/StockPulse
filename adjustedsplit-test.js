// The filed share count on the prices' split basis (Adjusted.sharesOnBarBasis, backlog 58).
//
//   node adjustedsplit-test.js
//
// Pure checks, then real filings from the local research copy (analysis.db, skipped
// when it is absent): Apple on 2018-07-02 must come out near its real ~$945B, not the
// $236B the split-adjusted close times the as-filed count gave before 2026-11-07.
const Adjusted = require('./adjusted.js');
const SecFacts = require('./secfacts.js');
let checks = 0, failed = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failed++; console.log('FAIL ' + msg); } };
const near = (a, b, tol) => a != null && b != null && Math.abs(a / b - 1) <= tol;

// ---- pure ----
const sec = { sharesDiluted: 1000, sharesFrom: '2018-06-30', sharesFiled: '2018-08-01' };
const splits = [{ d: '2014-06-09', f: 7 }, { d: '2020-08-31', f: 4 }];
ok(Adjusted.sharesOnBarBasis(sec, splits) === 4000, 'only splits after the filing count (7:1 in 2014 already in it, 4:1 in 2020 not)');
ok(Adjusted.sharesOnBarBasis(sec, []) === 1000, 'no splits leaves the count');
ok(Adjusted.sharesOnBarBasis(sec, null) === 1000, 'unknown splits leave the count');
ok(Adjusted.sharesOnBarBasis({ sharesDiluted: 1000, sharesFrom: '2020-06-27', sharesFiled: '2020-09-02' }, splits) === 1000,
  'a split between the period end and the filing is already restated into the filing');
ok(Adjusted.sharesOnBarBasis({ sharesDiluted: 1000, sharesFrom: '2020-06-27' }, splits) === 4000, 'no filing date: the period end stands in');
ok(Adjusted.sharesOnBarBasis({ sharesDiluted: null, sharesFiled: '2018-08-01' }, splits) === null, 'no count stays null, not zero');
ok(Adjusted.sharesOnBarBasis(sec, [{ d: '2021-01-01', f: null }, { d: '2021-01-02', f: 0 }]) === 1000, 'a blank or zero factor is ignored');
const ov = Adjusted.overlayFrom(sec, null, null, 10, splits);
ok(ov.marketCap === 40000, 'overlayFrom with splits: price x shares on the same basis');
ok(Adjusted.overlayFrom(sec, null, null, 10).marketCap === 10000, 'overlayFrom without splits is unchanged (callers opt in)');
ok(Adjusted.engineRow({ symbol: 'X', price: 10 }, sec, null, splits).marketCap === 40000, 'engineRow passes the splits through');

// ---- real filings ----
let db = null;
try { const { DatabaseSync } = require('node:sqlite'); db = new DatabaseSync(require('path').join(__dirname, 'analysis.db'), { readOnly: true }); }
catch { console.log('analysis.db not available: real-filings checks skipped'); }
if (db) {
  const camel = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) r[k.replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase())] = v; return r; };
  const capAt = (sym, d) => {
    const facts = db.prepare('select * from sec_facts where symbol = ?').all(sym).map(camel);
    const sp = db.prepare('select d, f from splits where symbol = ? order by d').all(sym).map((x) => ({ d: x.d, f: Number(x.f) }));
    const px = db.prepare('select close from bars where symbol = ? and d <= ? order by d desc limit 1').get(sym, d);
    const s = Adjusted.fundamentalsAsOf(SecFacts, facts, d);
    if (!s || !px) return null;
    return { fixed: Adjusted.overlayFrom(s, null, null, Number(px.close), sp).marketCap, old: Adjusted.overlayFrom(s, null, null, Number(px.close)).marketCap };
  };
  // Market values as reported at the time: Apple ~$940-950B (Jul 2018), Nvidia ~$360B (Jan 2023, before its 2024 10:1),
  // Microsoft ~$1.5T (Jan 2020, no split since).
  const a = capAt('AAPL', '2018-07-02');
  if (a) { ok(near(a.fixed, 945e9, 0.06), 'Apple 2018-07-02 near $945B: ' + (a.fixed / 1e9).toFixed(0) + 'B'); ok(near(a.old, a.fixed / 4, 0.02), 'before the fix it read a quarter of that'); }
  const n = capAt('NVDA', '2023-01-03');
  if (n) ok(near(n.fixed, 360e9, 0.08), 'Nvidia 2023-01-03 near $360B: ' + (n.fixed / 1e9).toFixed(0) + 'B');
  const m = capAt('MSFT', '2020-01-02');
  if (m) ok(near(m.fixed, 1.22e12, 0.10) && m.fixed === m.old, 'Microsoft 2020-01-02 (no split since) unchanged: ' + (m.fixed / 1e9).toFixed(0) + 'B');
}
console.log(checks + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
