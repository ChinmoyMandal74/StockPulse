// Growth & profit and Value vs industry (filters.js), held to their brief.
//
//   node --no-warnings growthprofile-test.js
//
// Every cell of the three-by-three grid, Pre-revenue, both sides of every
// threshold, the blanks (null is not zero), the sector rules, the growth
// basis, the industry comparison and its price-to-sales stand-in, and the
// boundary with the Signal: the same rows score identically with the two
// words absent, present and lying.

const F = require('./private/filters.js');
const A = require('./private/action.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}

const BASE = { symbol: 'TEST', sector: 'Technology', currency: 'USD', revenueTtm: 2e9, revenueGrowthYoY: 12, profitMargin: 20, fcfMargin: 15 };
const gp = (over) => F.growthProfileOf(Object.assign({}, BASE, over));

console.log('THE GRID');
check('Growing, profitable', gp({}), 'Growing, profitable');
check('Growing, thin margin', gp({ profitMargin: 3 }), 'Growing, thin margin');
check('Growing, loss-making', gp({ profitMargin: -12, fcfMargin: -20 }), 'Growing, loss-making');
check('Flat, profitable', gp({ revenueGrowthYoY: 1 }), 'Flat, profitable');
check('Flat, thin margin', gp({ revenueGrowthYoY: 1, profitMargin: 2 }), 'Flat, thin margin');
check('Flat, loss-making', gp({ revenueGrowthYoY: 1, profitMargin: -2 }), 'Flat, loss-making');
check('Shrinking, profitable', gp({ revenueGrowthYoY: -9 }), 'Shrinking, profitable');
check('Shrinking, thin margin', gp({ revenueGrowthYoY: -9, profitMargin: 1 }), 'Shrinking, thin margin');
check('Shrinking, loss-making', gp({ revenueGrowthYoY: -9, profitMargin: -30 }), 'Shrinking, loss-making');
check('every word the classifier can give is on the ladder, once', F.GP_ORDER.length === new Set(F.GP_ORDER).size && F.GP_ORDER.length === 10, true);

console.log('THRESHOLDS, BOTH SIDES');
check('growth +5.0 is Growing', gp({ revenueGrowthYoY: 5 }).split(',')[0], 'Growing');
check('growth +4.99 is Flat', gp({ revenueGrowthYoY: 4.99 }).split(',')[0], 'Flat');
check('growth -5.0 is Shrinking', gp({ revenueGrowthYoY: -5 }).split(',')[0], 'Shrinking');
check('growth -4.99 is Flat', gp({ revenueGrowthYoY: -4.99 }).split(',')[0], 'Flat');
check('net margin 5.0 is profitable', gp({ profitMargin: 5 }), 'Growing, profitable');
check('net margin 4.99 is thin', gp({ profitMargin: 4.99 }), 'Growing, thin margin');
check('net margin 0 is thin, not a loss', gp({ profitMargin: 0 }), 'Growing, thin margin');
check('net margin -0.01 is a loss', gp({ profitMargin: -0.01 }), 'Growing, loss-making');
check('free cash flow 0 keeps profitable', gp({ fcfMargin: 0 }), 'Growing, profitable');
check('free cash flow -0.1 makes a paper profit thin', gp({ fcfMargin: -0.1 }), 'Growing, thin margin');
check('no free cash flow figure: the net margin alone', gp({ fcfMargin: null }), 'Growing, profitable');

console.log('BLANKS: NULL IS NOT ZERO');
check('no growth figure is blank, not Flat', gp({ revenueGrowthYoY: null }), null);
check('an empty-string growth is blank, not Flat', gp({ revenueGrowthYoY: '' }), null);
check('no net margin is blank, not thin', gp({ profitMargin: null }), null);
check('an empty-string margin is blank', gp({ profitMargin: '' }), null);
check('a row in error is blank', gp({ error: 'no data' }), null);
check('nothing at all is blank', F.growthProfileOf(null), null);
check('a fund (no margins) is blank', F.growthProfileOf({ symbol: 'SPY', instrumentType: 'ETF', revenueGrowthYoY: null, profitMargin: null }), null);
check('a fund whose profile says revenue 0 is blank, not Pre-revenue', F.growthProfileOf({ symbol: 'SMH', instrumentType: 'ETF', revenueTtm: 0 }), null);
check('so is one marked only by company type', F.growthProfileOf({ symbol: 'QQQ', companyType: 'ETF', revenueTtm: 0 }), null);
check('a company with revenue 0 is Pre-revenue', gp({ revenueTtm: 0, revenueGrowthYoY: null, profitMargin: null }), 'Pre-revenue');

console.log('PRE-REVENUE');
check('under $50M of revenue', gp({ revenueTtm: 49e6, revenueGrowthYoY: 400, profitMargin: -900 }), 'Pre-revenue');
check('at $50M it is read', gp({ revenueTtm: 50e6 }), 'Growing, profitable');
check('no revenue figure is not Pre-revenue', gp({ revenueTtm: null }), 'Growing, profitable');
check('a yen reporter under 50M is not Pre-revenue (another currency)', gp({ currency: 'JPY', revenueTtm: 4e7 }), 'Growing, profitable');

console.log('SECTORS AND THE GROWTH BASIS');
check('a bank: free cash flow is not read', gp({ sector: 'Financial Services', fcfMargin: -40 }), 'Growing, profitable');
check('a bank still reads a loss', gp({ sector: 'Financial Services', profitMargin: -1, fcfMargin: 30 }), 'Growing, loss-making');
check('a REIT: free cash flow margin, not net', gp({ sector: 'Real Estate', profitMargin: -3, fcfMargin: 25 }), 'Growing, profitable');
check('a REIT with no cash figure falls back to net', gp({ sector: 'Real Estate', profitMargin: -3, fcfMargin: null }), 'Growing, loss-making');
check('the filings sum is preferred to the one quarter', gp({ crNowRevG: -8, revenueGrowthYoY: 30 }), 'Shrinking, profitable');
check('and its basis is said', F.growthProfileRead(Object.assign({}, BASE, { crNowRevG: -8 })).gBasis, 'filings');
check('without it, the quarter', F.growthProfileRead(BASE).gBasis, 'quarter');

console.log('VALUE VS INDUSTRY');
const pv = (over) => F.valueVsIndustryOf(Object.assign({ symbol: 'TEST' }, over));
check('P/E 0.79x is Below industry', pv({ peerPe: 0.79 }), 'Below industry');
check('P/E 0.80x is In line', pv({ peerPe: 0.8 }), 'In line');
check('P/E 1.25x is In line', pv({ peerPe: 1.25 }), 'In line');
check('P/E 1.26x is Above industry', pv({ peerPe: 1.26 }), 'Above industry');
check('P/E wins over P/S', pv({ peerPe: 1.5, peerPs: 0.2 }), 'Above industry');
check('no P/E: P/S stands in', pv({ peerPe: null, peerPs: 0.5 }), 'Below industry');
check('and says so', F.valueVsIndustryRead({ peerPe: null, peerPs: 0.5 }).basis, 'P/S');
check('neither: blank, never In line', pv({ peerPe: null, peerPs: null }), null);
check('an empty string is not 0x', pv({ peerPe: '', peerPs: '' }), null);

console.log('THE SIGNAL DOES NOT READ EITHER');
const cfg = A.resolve(undefined, 'Balanced').cfg;
const EST = { symbol: 'TEST', portfolios: ['Watchlist'], marketCap: 150e9, netIncomeTtm: 5e9, profitMargin: 20, fcfTtm: 4e9, fcfMargin: 12,
  forwardPe: 25, roe: 18, qualityRating: 9, earningsGrowthYoY: 20, revenueGrowthYoY: 15, grossMargin: 55, shortPctFloat: 2,
  vs200ma: 6, vs50ma: 4, rsi: 55, oneMonthPct: 3, threeMonthPct: 8, pctFromHigh: -8, volTrend: 2, historyDays: 400,
  nextEarningsDate: '2026-12-20', latestDate: '2026-11-02' };
const EARLY = Object.assign({}, EST, { symbol: 'GROW', marketCap: 4e9, netIncomeTtm: -200e6, profitMargin: -8, fcfTtm: -50e6, fcfMargin: -5,
  forwardPe: null, roe: -10, qualityRating: 4, earningsGrowthYoY: null, revenueGrowthYoY: 35, vs200ma: 12, pctFromHigh: -12 });
const WEAK = Object.assign({}, EST, { symbol: 'WEAK', vs200ma: -15, vs50ma: -8, oneMonthPct: -12, threeMonthPct: -25, pctFromHigh: -35, rsi: 30 });
const verdict = (row) => { const r = A.evaluate(row, cfg); return [r.type, r.action, r.flag, r.rule || r.reason || null]; };
for (const base of [EST, EARLY, WEAK]) {
  const absent = verdict(base);
  const present = verdict(Object.assign({}, base, { growthProfile: F.growthProfileOf(base), valueVsIndustry: 'In line', peerPs: 1 }));
  const lying = verdict(Object.assign({}, base, { growthProfile: 'Shrinking, loss-making', valueVsIndustry: 'Above industry', peerPs: 99, peerPsMedian: 0.01 }));
  const lying2 = verdict(Object.assign({}, base, { growthProfile: 'Growing, profitable', valueVsIndustry: 'Below industry', peerPs: 0.01 }));
  check(base.symbol + ': same verdict with the words present', present, absent);
  check(base.symbol + ': same verdict with the words lying one way', lying, absent);
  check(base.symbol + ': same verdict with the words lying the other way', lying2, absent);
}
check('the three rows are not all the same verdict (the check can tell)', new Set([EST, EARLY, WEAK].map((r) => JSON.stringify(verdict(r)))).size > 1, true);

console.log('FILTERS');
check('both are dropdown columns', [F.filterKind('growthProfile'), F.filterKind('valueVsIndustry')], ['cat', 'cat']);
const rows = [Object.assign({}, BASE, { symbol: 'A', growthProfile: 'Growing, profitable', valueVsIndustry: 'Below industry' }),
  Object.assign({}, BASE, { symbol: 'B', growthProfile: 'Growing, thin margin', valueVsIndustry: 'Below industry' }),
  Object.assign({}, BASE, { symbol: 'C', growthProfile: 'Growing, profitable', valueVsIndustry: 'Above industry' }),
  Object.assign({}, BASE, { symbol: 'D', growthProfile: null, valueVsIndustry: null })];
const pick = (flt) => rows.filter((r) => Object.entries(flt).every(([k, v]) => F.compileFilter(k, v)(r[k]))).map((r) => r.symbol);
check('a comma inside the word is one value, not a list', pick({ growthProfile: 'Growing, profitable' }), ['A', 'C']);
check('the two together', pick({ growthProfile: 'Growing, profitable', valueVsIndustry: 'Below industry' }), ['A']);
check('a blank row matches neither', pick({ valueVsIndustry: 'Below industry|In line|Above industry' }), ['A', 'B', 'C']);

console.log(`\n${n - failed} passed, ${failed} failed`);
process.exit(failed || n < 60 ? 1 : 0);
