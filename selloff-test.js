// selloff.js: the release test, the reaction day, the two screens and the
// watchlist. Pure; no server.   node selloff-test.js
'use strict';
const S = require('./selloff.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (a, b) => a != null && Math.abs(a - b) < 1e-9;

// ---- The release test.
const rel = (o) => Object.assign({ isResults: 1, filed: '2026-10-28', revenue: 120, revenuePrior: 100, netIncome: 5, guideKind: 'revenue_range', guideChange: null }, o);
ok(S.passesRelease(rel()), 'revenue +20%, a profit and guidance pass');
ok(S.passesRelease(rel({ revenue: 110 })), 'exactly +10% passes');
ok(!S.passesRelease(rel({ revenue: 109.9 })), 'just under +10% does not');
ok(!S.passesRelease(rel({ netIncome: 0 })), 'a zero profit does not');
ok(!S.passesRelease(rel({ netIncome: null })), 'no net income is not a profit');
ok(!S.passesRelease(rel({ revenuePrior: null })), 'no prior revenue is no growth');
ok(!S.passesRelease(rel({ guideKind: null })), 'no guidance does not');
ok(S.passesRelease(rel({ guideKind: null, guideChange: 'raised' })), 'a change word is guidance');
ok(!S.passesRelease(rel({ guideChange: 'withdrawn' })), 'withdrawn guidance is no guidance');
ok(!S.passesRelease(rel({ isResults: 0 })), 'not a results release');
ok(S.guidanceOf(rel({ guideChange: 'Raised' })) === 'raised' && S.guidanceOf(rel()) === 'given' && S.guidanceOf(rel({ guideKind: null })) === null, 'guidance keys');

// ---- The reaction day.
const bars = (pairs) => pairs.map(([d, close]) => ({ datetime: d, close }));
// Pre-market report: the filing day carries the fall.
let rx = S.reaction(bars([['2026-10-27', 100], ['2026-10-28', 88], ['2026-10-29', 90]]), '2026-10-28');
ok(near(rx.fday, -12) && near(rx.worst, -12) && rx.base === 88 && rx.on === '2026-10-28', 'filing-day fall is the reaction', rx);
// After-hours report: the day after carries it.
rx = S.reaction(bars([['2026-10-29', 90], ['2026-10-28', 100], ['2026-10-27', 99]]), '2026-10-28');
ok(near(rx.day, -10) && near(rx.worst, -10) && rx.base === 90 && rx.on === '2026-10-29', 'day-after fall is the reaction, bars in any order', rx);
// Filed on a Saturday: last close before to first close after.
rx = S.reaction(bars([['2026-10-30', 100], ['2026-11-02', 93]]), '2026-10-31');
ok(rx.fday === null && near(rx.worst, -7) && rx.on === '2026-11-02', 'a non-trading filing day', rx);
// Filed today, no next close yet: the filing day alone.
rx = S.reaction(bars([['2026-11-02', 100], ['2026-11-03', 92]]), '2026-11-03');
ok(near(rx.worst, -8) && rx.day === null, 'no next close yet', rx);
ok(S.reaction(bars([['2026-11-03', 92]]), '2026-11-03') === null, 'one bar alone is no move');
ok(S.reaction([], '2026-11-03') === null && S.reaction(null, '2026-11-03') === null, 'no bars');

// ---- The screens.
const row = (sym, o) => Object.assign({ symbol: sym, shortName: sym + ' Inc', sector: 'Technology', price: 85, pctFromHigh: -30, rsi: 31, trailingPe: 20, forwardPe: 15,
  valueVsIndustry: 'In line', revenueGrowthYoY: 22, profitMargin: 12, growthProfile: 'Growing, profitable' }, o);
const rows = [
  row('TFALL'),                                                   // tech, fell 12% on the filing day
  row('TSOFT'),                                                   // tech, fell 4%: not enough
  row('NFALL', { sector: 'Industrials' }),                        // non-tech, fell 6%
  row('NDEAR', { sector: 'Industrials', valueVsIndustry: 'Above industry' }), // fell, but above industry
  row('NTHIN', { sector: 'Industrials', growthProfile: 'Growing, thin margin' }), // fell, wrong words
  row('TOLD'),                                                    // tech, fell, but filed outside the window
  row('TETF', { instrumentType: 'ETF' }),
  row('TLOSS', { trailingPe: -5, forwardPe: null, pctFromHigh: null }),
];
const rels = {
  TFALL: rel(), TSOFT: rel(), NFALL: rel(), NDEAR: rel(), NTHIN: rel(), TOLD: rel({ filed: '2026-08-01' }), TETF: rel(), TLOSS: rel(),
};
const fall = (pct) => bars([['2026-10-27', 100], ['2026-10-28', 100 + pct], ['2026-10-29', 100 + pct]]);
const barsBy = { TFALL: fall(-12), TSOFT: fall(-4), NFALL: fall(-6), NDEAR: fall(-9), NTHIN: fall(-9), TOLD: fall(-20), TETF: fall(-20), TLOSS: fall(-8) };
const today = '2026-11-03';
const cand = S.candidates('tech', rows, rels, 45, today);
ok(JSON.stringify(cand) === JSON.stringify(['TFALL', 'TSOFT', 'TLOSS']), 'tech candidates: in window, no ETF', cand);
ok(JSON.stringify(S.candidates('nontech', rows, rels, 45, today)) === JSON.stringify(['NFALL']), 'non-tech candidates need both words');
ok(S.candidates('tech', rows, rels, 100, today).includes('TOLD'), 'a wider window takes the older release');
const tech = S.screen('tech', rows, rels, barsBy, 45, today);
ok(tech.map((r) => r.symbol).join() === 'TFALL,TLOSS', 'tech screen: -7% or worse, worst first', tech.map((r) => r.symbol));
const t0 = tech[0];
ok(near(t0.reaction, -12) && near(t0.since, (85 / 88 - 1) * 100) && t0.filed === '2026-10-28' && t0.guidance === 'given', 'the row carries the reaction, since and release', t0);
ok(t0.fromHigh === -30 && t0.rsi === 31 && t0.pe === 20 && t0.fpe === 15 && t0.valueVsIndustry === 'In line' && t0.revGrowth === 22 && t0.profitMargin === 12 && t0.growthProfile === 'Growing, profitable', 'the ten readings come off the served row');
const tl = tech[1];
ok(tl.pe === null && tl.fpe === null && tl.fromHigh === null, 'a negative multiple and a blank stay blank, never 0', tl);
const nt = S.screen('nontech', rows, rels, barsBy, 45, today);
ok(nt.map((r) => r.symbol).join() === 'NFALL', 'non-tech screen: -5% or worse with the words', nt.map((r) => r.symbol));
ok(S.screen('tech', rows, rels, {}, 45, today).length === 0, 'no bars, no row');

// ---- The watchlist.
const w = S.watch([row('MU', { lastEarningsDate: '2026-09-23' }), row('ASML', { lastEarningsDate: '2026-10-15T00:00:00' })], { MU: rel({ filed: '2026-09-24' }) });
ok(w.length === 25 && w[0].symbol === 'MU' && w[0].group === 'Memory' && w[24].symbol === 'MRVL' && w[24].group === 'Compute', '25 names in their groups and order');
ok(w[0].filed === '2026-09-24', 'the release date when there is one');
const asml = w.find((r) => r.symbol === 'ASML');
ok(asml.filed === '2026-10-15' && asml.guidance === null, 'no release: the provider report date, no guidance', asml);
ok(w.find((r) => r.symbol === 'NVDA').missing === true, 'a name not on the screener is listed as missing');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
