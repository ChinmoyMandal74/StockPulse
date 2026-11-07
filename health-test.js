// Health (health.js), held to the owner's brief of 2026-11-07.
//
//   node --no-warnings health-test.js
//
// A row that reads well everywhere scores 100; both sides of every check's
// thresholds; the blanks (null is not zero) and the rescaling around them;
// the weight floor; the three caps; funds; the pillar weights; and the
// boundary with the Signal: the same rows score identically with Health
// absent, present and lying.

const H = require('./health.js');
const A = require('./private/action.js');
const F = require('./private/filters.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}

// Reads well on all thirteen checks.
const BEST = {
  symbol: 'TEST', sector: 'Technology', currency: 'USD', instrumentType: 'Common Stock',
  revenueTtm: 5e9, revenueGrowthYoY: 20, profitMargin: 25, fcfMargin: 20,
  netCash: 2e9, intCover: null, sharesChg: -1,
  erVsEstWord: 'Above', erVsEst: 0.12, erGuideChange: 'Raised',
  peVsMed: -10, peerPe: 0.9,
  oneMonthPct: 2, threeYearPct: 60, vs200ma: 8, maBullish: true,
  shortPctFloat: 2, toneAvg: 0.4, toneN: 12, action: 'Strong',
};
const row = (over) => Object.assign({}, BEST, over);
const sc = (over) => H.score(row(over));
const chk = (over, id) => {
  const e = H.explain(row(over));
  for (const p of e.pillars) for (const c of p.checks) if (c.id === id) return c.v;
  return 'missing';
};

console.log('THE SHAPE');
check('five pillars', H.PILLARS.map((p) => p.id), ['business', 'results', 'value', 'price', 'sentiment']);
check('weights as agreed: 30 25 20 15 10', H.PILLARS.map((p) => p.weight), [30, 25, 20, 15, 10]);
check('weights sum to 100', H.PILLARS.reduce((a, p) => a + p.weight, 0), 100);
check('thirteen checks, each defined once', H.PILLARS.flatMap((p) => p.checks).length, Object.keys(H.CHECKS).length);
check('every check has a rule in words', Object.values(H.CHECKS).every((c) => typeof c.rule === 'string' && c.rule.length > 20), true);

console.log('THE TOP AND THE BOTTOM');
check('reads well everywhere: 100', sc({}), 100);
check('reads badly everywhere: 0', sc({ revenueGrowthYoY: -20, profitMargin: -30, fcfMargin: -20, netCash: -1e9, intCover: 0.5, sharesChg: 5,
  erVsEstWord: 'Below', erGuideChange: 'Lowered', peVsMed: 80, peerPe: 2, oneMonthPct: -20, threeYearPct: -50, vs200ma: -20,
  maBullish: false, shortPctFloat: 25, toneAvg: -0.6, action: 'Weak' }), 0);
check('a whole number', Number.isInteger(sc({ oneMonthPct: -7 })), true);

console.log('EACH CHECK, BOTH SIDES');
check('growth +10: 1', chk({ revenueGrowthYoY: 10 }, 'growth'), 1);
check('growth +9.9: half', chk({ revenueGrowthYoY: 9.9 }, 'growth'), 0.5);
check('growth -5: 0', chk({ revenueGrowthYoY: -5 }, 'growth'), 0);
check('growth -4.9: half', chk({ revenueGrowthYoY: -4.9 }, 'growth'), 0.5);
check('growth reads the filings sum where there is one', chk({ revenueGrowthYoY: 30, crNowRevG: 2 }, 'growth'), 0.5);
check('pre-revenue: no growth reading', chk({ revenueTtm: 20e6 }, 'growth'), null);
check('pre-revenue: no profit reading', chk({ revenueTtm: 20e6 }, 'profit'), null);
check('profitable: 1', chk({ profitMargin: 10 }, 'profit'), 1);
check('thin margin: half', chk({ profitMargin: 9.9 }, 'profit'), 0.5);
check('profitable on paper, burning cash: half', chk({ profitMargin: 15, fcfMargin: -2 }, 'profit'), 0.5);
check('loss-making: 0', chk({ profitMargin: -0.1 }, 'profit'), 0);
check('net cash: 1', chk({ netCash: 1 }, 'balance'), 1);
check('net debt, covered 5x: 1', chk({ netCash: -1e9, intCover: 5 }, 'balance'), 1);
check('net debt, covered 4.9x: half', chk({ netCash: -1e9, intCover: 4.9 }, 'balance'), 0.5);
check('net debt, covered 2x: half', chk({ netCash: -1e9, intCover: 2 }, 'balance'), 0.5);
check('net debt, covered 1.9x: 0', chk({ netCash: -1e9, intCover: 1.9 }, 'balance'), 0);
check('net debt, no cover figure: no reading', chk({ netCash: -1e9, intCover: null }, 'balance'), null);
check('a bank: no balance sheet reading', chk({ sector: 'Financial Services' }, 'balance'), null);
check('shares +1%: 1', chk({ sharesChg: 1 }, 'dilution'), 1);
check('shares +1.1%: half', chk({ sharesChg: 1.1 }, 'dilution'), 0.5);
check('shares +3%: half', chk({ sharesChg: 3 }, 'dilution'), 0.5);
check('shares +3.1%: 0', chk({ sharesChg: 3.1 }, 'dilution'), 0);
check('above the estimate: 1', chk({}, 'earnings'), 1);
check('in line: half', chk({ erVsEstWord: 'In line' }, 'earnings'), 0.5);
check('below: 0', chk({ erVsEstWord: 'Below' }, 'earnings'), 0);
check('guidance Raised: 1', chk({}, 'guidance'), 1);
check('guidance Reaffirmed: half', chk({ erGuideChange: 'Reaffirmed' }, 'guidance'), 0.5);
check('guidance Initiated: half', chk({ erGuideChange: 'Initiated' }, 'guidance'), 0.5);
check('guidance Mixed: half', chk({ erGuideChange: 'Mixed' }, 'guidance'), 0.5);
check('guidance Lowered: 0', chk({ erGuideChange: 'Lowered' }, 'guidance'), 0);
check('guidance Withdrawn: 0', chk({ erGuideChange: 'Withdrawn' }, 'guidance'), 0);
check('P/E at its median: 1', chk({ peVsMed: 0 }, 'history'), 1);
check('P/E 0.1% above: half', chk({ peVsMed: 0.1 }, 'history'), 0.5);
check('P/E 25% above: half', chk({ peVsMed: 25 }, 'history'), 0.5);
check('P/E 25.1% above: 0', chk({ peVsMed: 25.1 }, 'history'), 0);
check('In line with the industry: 1', chk({ peerPe: 1.25 }, 'peers'), 1);
check('Above industry: 0', chk({ peerPe: 1.26 }, 'peers'), 0);
check('Below industry: 1', chk({ peerPe: 0.5 }, 'peers'), 1);
check('no P/E: price to sales stands in', chk({ peerPe: null, peerPs: 2 }, 'peers'), 0);
check('one month -5%: 1', chk({ oneMonthPct: -5 }, 'short'), 1);
check('one month -5.1%: half', chk({ oneMonthPct: -5.1 }, 'short'), 0.5);
check('one month -10%: half', chk({ oneMonthPct: -10 }, 'short'), 0.5);
check('one month -10.1%: 0', chk({ oneMonthPct: -10.1 }, 'short'), 0);
check('3Y +33.1% is 10% a year: 1', chk({ threeYearPct: 33.1 }, 'long'), 1);
check('3Y +33% is under 10% a year: half', chk({ threeYearPct: 33 }, 'long'), 0.5);
check('3Y flat: half', chk({ threeYearPct: 0 }, 'long'), 0.5);
check('3Y -0.1%: 0', chk({ threeYearPct: -0.1 }, 'long'), 0);
check('above the 200-day, 50 over 200: 1', chk({}, 'trend'), 1);
check('above the 200-day only: half', chk({ maBullish: false }, 'trend'), 0.5);
check('50 over 200 only: half', chk({ vs200ma: -1 }, 'trend'), 0.5);
check('neither: 0', chk({ vs200ma: -1, maBullish: false }, 'trend'), 0);
check('exactly on the 200-day is not above it', chk({ vs200ma: 0, maBullish: false }, 'trend'), 0);
check('short 4.9%: 1', chk({ shortPctFloat: 4.9 }, 'shortint'), 1);
check('short 5%: half', chk({ shortPctFloat: 5 }, 'shortint'), 0.5);
check('short 9.9%: half', chk({ shortPctFloat: 9.9 }, 'shortint'), 0.5);
check('short 10%: 0', chk({ shortPctFloat: 10 }, 'shortint'), 0);
check('tone +0.25: 1', chk({ toneAvg: 0.25 }, 'tone'), 1);
check('tone +0.24: half', chk({ toneAvg: 0.24 }, 'tone'), 0.5);
check('tone -0.24: half', chk({ toneAvg: -0.24 }, 'tone'), 0.5);
check('tone -0.25: 0', chk({ toneAvg: -0.25 }, 'tone'), 0);
check('tone with no article counted: no reading', chk({ toneN: 0 }, 'tone'), null);

console.log('NULL IS NOT ZERO');
check('share change null: no reading', chk({ sharesChg: null }, 'dilution'), null);
check('share change empty string: no reading', chk({ sharesChg: '' }, 'dilution'), null);
check('share change 0: a reading, and a pass', chk({ sharesChg: 0 }, 'dilution'), 1);
check('one month null: no reading (Number(null) would be a pass)', chk({ oneMonthPct: null }, 'short'), null);
check('short interest null: no reading', chk({ shortPctFloat: null }, 'shortint'), null);
check('P/E vs median null: no reading', chk({ peVsMed: null }, 'history'), null);
check('3Y null: no reading', chk({ threeYearPct: null }, 'long'), null);
check('200-day null: no reading', chk({ vs200ma: null }, 'trend'), null);

console.log('RESCALING');
check('no release at all: the results pillar is left out, the rest still 100', sc({ erVsEstWord: null, erGuideChange: null }), 100);
check('a missing check shares its pillar, not the whole', sc({ sharesChg: null, profitMargin: 5 }), Math.round((30 * (1 + 0.5 + 1) / 3 + 70) * 100 / 100));
check('no release: the weight scored is 75', H.explain(row({ erVsEstWord: null, erGuideChange: null })).weighed, 75);
const thin = row({ revenueGrowthYoY: null, crNowRevG: null, profitMargin: null, netCash: null, sharesChg: null, erVsEstWord: null, erGuideChange: null, peVsMed: null, peerPe: null });
check('price and sentiment alone (25%): no number', H.score(thin), null);
check('...but the workings still say why', H.explain(thin).weighed, 25);
check('exactly the floor (60%: business, valuation, sentiment) is enough', H.score(row({ erVsEstWord: null, erGuideChange: null, oneMonthPct: null, threeYearPct: null, vs200ma: null })), 100);
check('under it (50%: business and valuation) is not', H.score(row({ erVsEstWord: null, erGuideChange: null, oneMonthPct: null, threeYearPct: null, vs200ma: null, toneAvg: null, shortPctFloat: null })), null);

console.log('THE CAPS');
check('guidance lowered caps at 60', sc({ erGuideChange: 'Lowered' }), 60);
check('guidance withdrawn caps at 60', sc({ erGuideChange: 'Withdrawn' }), 60);
check('Very Weak caps at 50', sc({ action: 'Very Weak' }), 50);
check('the old word for it does too', sc({ action: 'Sell Immediately' }), 50);
check('Weak does not cap', sc({ action: 'Weak' }), 100);
check('shares up 10.1% caps at 70', sc({ sharesChg: 10.1 }), Math.min(70, Math.round(30 * 0.75 + 70)));
check('shares up 10% does not cap', H.explain(row({ sharesChg: 10 })).caps.length, 0);
check('two caps: the lower holds', sc({ action: 'Very Weak', erGuideChange: 'Lowered' }), 50);
check('a cap never raises a low score', sc({ action: 'Very Weak', revenueGrowthYoY: -20, profitMargin: -30, fcfMargin: -20, oneMonthPct: -20, threeYearPct: -50, vs200ma: -20, maBullish: false, peVsMed: 80, peerPe: 2 }) <= 50, true);
check('the workings show raw and capped', (() => { const e = H.explain(row({ action: 'Very Weak' })); return [e.raw, e.score, e.capped, e.caps.map((c) => c.id)]; })(), [100, 50, true, ['signal']]);
check('no cap on a dash', H.score(Object.assign({}, thin, { action: 'Very Weak' })), null);

console.log('FUNDS AND ERRORS');
check('a fund: no Health', H.explain(row({ instrumentType: 'ETF' })), null);
check('typed a fund by the engine: none either', H.score(row({ companyType: 'ETF' })), null);
check('an error row: none', H.score({ symbol: 'X', error: 'no data' }), null);
check('nothing at all: none', H.score(null), null);

console.log('FILTERS');
check('a number column for the filter row', F.filterKind('healthScore'), 'num');
check('">=70" keeps 70 and drops 69', [70, 69, null].map((v) => F.compileFilter('healthScore', '>=70')(v)), [true, false, false]);

console.log('THE SIGNAL DOES NOT READ HEALTH');
const cfg = A.resolve(undefined, 'Balanced').cfg;
const EST = { symbol: 'TEST', portfolios: ['Watchlist'], marketCap: 150e9, netIncomeTtm: 5e9, profitMargin: 20, fcfTtm: 4e9, fcfMargin: 12,
  forwardPe: 25, roe: 18, qualityRating: 9, earningsGrowthYoY: 20, revenueGrowthYoY: 15, grossMargin: 55, shortPctFloat: 2,
  vs200ma: 6, vs50ma: 4, rsi: 55, oneMonthPct: 3, threeMonthPct: 8, pctFromHigh: -8, volTrend: 2, historyDays: 400,
  nextEarningsDate: '2026-12-20', latestDate: '2026-11-07' };
const EARLY = Object.assign({}, EST, { symbol: 'GROW', marketCap: 4e9, netIncomeTtm: -200e6, profitMargin: -8, fcfTtm: -50e6, fcfMargin: -5,
  forwardPe: null, roe: -10, qualityRating: 4, earningsGrowthYoY: null, revenueGrowthYoY: 35, vs200ma: 12, pctFromHigh: -12 });
const WEAK = Object.assign({}, EST, { symbol: 'WEAK', vs200ma: -15, vs50ma: -8, oneMonthPct: -12, threeMonthPct: -25, pctFromHigh: -35, rsi: 30 });
const verdict = (r) => { const x = A.evaluate(r, cfg); return [x.type, x.action, x.flag]; };
for (const base of [EST, EARLY, WEAK]) {
  const absent = verdict(base);
  check(base.symbol + ': same verdict with Health present', verdict(Object.assign({}, base, { healthScore: H.score(base) })), absent);
  check(base.symbol + ': same verdict with Health lying high', verdict(Object.assign({}, base, { healthScore: 100 })), absent);
  check(base.symbol + ': same verdict with Health lying low', verdict(Object.assign({}, base, { healthScore: 0 })), absent);
  check(base.symbol + ': same verdict over a list', A.apply([Object.assign({}, base, { healthScore: 0 })], cfg).map((x) => x.action), [absent[1]]);
}
check('the three rows are not all the same verdict (the check can tell)', new Set([EST, EARLY, WEAK].map((r) => JSON.stringify(verdict(r)))).size > 1, true);

console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed || n < 100 ? 1 : 0);
