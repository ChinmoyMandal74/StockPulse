// The rules engine, held to its brief.
//
//   node --no-warnings action-test.js
//
// Every case is a hand-built row with the expected Type / Action / Flag beside
// it, covering each rule in each of the three lists, the blank-handling
// discipline, both hole-fixes (on and off), the presets, the validator's
// rejections and the config plumbing. Run it after touching any rule.
//
// There is no workbook fixture this time on purpose: the model is first-match
// rules, so the honest test is one row per rule with its reason, not 2,500
// cells of a spreadsheet built for a different model.

const A = require('./private/action.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

const cfg = (diff, preset) => A.resolve(diff, preset).cfg;
const run = (row, diff, preset) => {
  const r = A.evaluate(row, cfg(diff, preset));
  return [r.type, r.action, r.flag];
};

// A well-behaved Established base: big, profitable, growing, mid-uptrend,
// clean entry, no earnings for a month, plenty of history.
const EST = {
  symbol: 'TEST', portfolios: ['Watchlist'],
  marketCap: 150e9, netIncomeTtm: 5e9, profitMargin: 20, fcfTtm: 4e9, fcfMargin: 12,
  forwardPe: 25, roe: 18, qualityRating: 9,
  earningsGrowthYoY: 20, revenueGrowthYoY: 15, grossMargin: 55, shortPctFloat: 2,
  vs200ma: 6, vs50ma: 4, rsi: 55, oneMonthPct: 3, threeMonthPct: 8,
  pctFromHigh: -8, volTrend: 2, historyDays: 400,
  nextEarningsDate: '2026-10-20', latestDate: '2026-09-11', momentumRating: 8,
};
// A well-behaved Early base: small, unprofitable, fast-growing.
const EARLY = {
  symbol: 'GROW', portfolios: ['Watchlist'],
  marketCap: 4e9, netIncomeTtm: -200e6, profitMargin: -8, fcfTtm: -50e6, fcfMargin: -5,
  forwardPe: null, roe: -10, qualityRating: 4,
  earningsGrowthYoY: null, revenueGrowthYoY: 35, grossMargin: 55, shortPctFloat: 5,
  vs200ma: 12, vs50ma: 4, rsi: 55, oneMonthPct: 4, threeMonthPct: 10,
  pctFromHigh: -12, volTrend: 2, historyDays: 400,
  nextEarningsDate: '2026-10-20', latestDate: '2026-09-11', momentumRating: 8,
};
const row = (base, over) => Object.assign({}, base, over);

console.log('STEP 1 — company type');
check('ETF by portfolio tag', run(row(EST, { portfolios: ['ETFs'] }))[0], 'ETF');
check('ETF by data shape (no Quality, no P/E)',
  run(row(EST, { qualityRating: null, forwardPe: null }))[0], 'ETF');
check('Established by size override alone',
  run(row(EARLY, { marketCap: 250e9, forwardPe: 200 }))[0], 'Established');
check('Established by score, Quality OFF (ROE carries the point)', run(EST)[0], 'Established');
check('Early: small and unprofitable', run(row(EARLY, { vs200ma: 12 }))[0], 'Early');
check('manual pin overrides everything',
  run(row(EST, {}), { company_type: { manual_overrides: { TEST: 'Early' } } })[0], 'Early');
check('Quality ON: the 7th point comes from Quality, not ROE',
  A.classify(row(EST, { roe: 2 }), cfg({ use_quality: true })).estScore,
  A.classify(row(EST, { roe: 2 }), cfg()).estScore + 1);

console.log('\nESTABLISHED rules, top to bottom');
check('Breakdown → Sell (1M confirm)',
  run(row(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -9 })),
  ['Established', 'Sell Immediately', 'Breakdown']);
check('Breakdown → Sell (3M confirm)',
  run(row(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -2, threeMonthPct: -20 })),
  ['Established', 'Sell Immediately', 'Breakdown']);
check('Downtrend → Avoid',
  run(row(EST, { vs200ma: -4, vs50ma: -2, oneMonthPct: -2 })),
  ['Established', 'Avoid', 'Downtrend']);
check('Weak below 200D → Avoid',
  run(row(EST, { vs200ma: -4, vs50ma: 1, earningsGrowthYoY: -10, revenueGrowthYoY: -5 })),
  ['Established', 'Avoid', 'Weak fundamentals below 200D']);
check('Distribution deep in a hole → Avoid',
  run(row(EST, { vs200ma: 1, vs50ma: 1, pctFromHigh: -35, volTrend: 15, oneMonthPct: -2 })),
  ['Established', 'Avoid', 'Distribution deep in drawdown']);
check('Below 200D → Hold',
  run(row(EST, { vs200ma: -3, vs50ma: 1 })), ['Established', 'Hold', 'Below 200D']);
check('HOLE FIX 1: blank 200D → Hold, never a blind Buy with Risk',
  run(row(EST, { vs200ma: null })), ['Established', 'Hold', 'No trend data']);
check('  …fix 1 off reproduces the brief (falls through to Buy)',
  run(row(EST, { vs200ma: null }), { fixes: { blank_trend_holds: false } })[1], 'Buy');
check('Thin history → Hold',
  run(row(EST, { historyDays: 120 })), ['Established', 'Hold', 'Thin history']);
check('Earnings soon → Hold',
  run(row(EST, { nextEarningsDate: '2026-09-14' })), ['Established', 'Hold', 'Earnings soon']);
check('Stale (past) earnings date is ignored',
  run(row(EST, { nextEarningsDate: '2026-09-01' }))[1], 'Buy');
check('Extended → Hold (1M too hot)',
  run(row(EST, { oneMonthPct: 30 })), ['Established', 'Hold', 'Extended — wait for a pullback']);
check('Strong Buy: everything aligned',
  run(row(EST, { vs200ma: 15, pctFromHigh: -5 })),
  ['Established', 'Strong Buy', 'Strong Buy: uptrend, clean entry, near high, strong fundamentals']);
check('Buy: clean entry, OK fundamentals, modest trend',
  run(row(EST, { earningsGrowthYoY: 5, revenueGrowthYoY: 5 })),
  ['Established', 'Buy', 'Buy: clean entry, fundamentals OK']);
check('Buy refused deeper than max drawdown → Buy with Risk, flag names the drawdown',
  run(row(EST, { earningsGrowthYoY: 5, revenueGrowthYoY: 5, pctFromHigh: -25 })),
  ['Established', 'Buy with Risk', 'Buy with Risk: deep below the high']);
check('Buy with Risk: fundamentals made no case',
  run(row(EST, { earningsGrowthYoY: 5, revenueGrowthYoY: -1 })),
  ['Established', 'Buy with Risk', 'Buy with Risk: fundamentals not OK']);
check('HOLE FIX 2: Weak + clean entry → Hold, not Buy with Risk',
  run(row(EST, { earningsGrowthYoY: -10, revenueGrowthYoY: -5, vs200ma: 5 })),
  ['Established', 'Hold', 'Weak fundamentals']);
check('  …fix 2 off reproduces the brief',
  run(row(EST, { earningsGrowthYoY: -10, revenueGrowthYoY: -5, vs200ma: 5 }),
    { fixes: { weak_blocks_buy_with_risk: false } })[1], 'Buy with Risk');
check('No clean entry → Hold',
  run(row(EST, { rsi: 70 })), ['Established', 'Hold', 'No clean entry']);
check('Mean-reversion mode: below 200D + OK fundamentals → Buy with Risk, no higher',
  run(row(EST, { vs200ma: -4, vs50ma: 1 }), { trend_gate: { never_buy_below_200d: false } }),
  ['Established', 'Buy with Risk', 'Buy with Risk: below 200D, mean-reversion mode']);
check('Mean-reversion mode without fundamentals → Hold',
  run(row(EST, { vs200ma: -4, vs50ma: 1, earningsGrowthYoY: 5, revenueGrowthYoY: -1 }),
    { trend_gate: { never_buy_below_200d: false } })[1], 'Hold');

console.log('\nEARLY rules, top to bottom');
check('Early breakdown → Sell (shorter leash)',
  run(row(EARLY, { vs200ma: -6, vs50ma: -4, oneMonthPct: -6 })),
  ['Early', 'Sell Immediately', 'Breakdown (early)']);
check('Weak below 200D → Sell, not Avoid',
  run(row(EARLY, { vs200ma: -2, vs50ma: 1, revenueGrowthYoY: 3 })),
  ['Early', 'Sell Immediately', 'Weak fundamentals below 200D']);
check('Below 200D → Avoid (harder than Established)',
  run(row(EARLY, { vs200ma: -2, vs50ma: 1, revenueGrowthYoY: 20, grossMargin: 30, fcfMargin: -10 })),
  ['Early', 'Avoid', 'Below 200D']);
check('Heavy short interest → Avoid even in an uptrend',
  run(row(EARLY, { shortPctFloat: 30 })), ['Early', 'Avoid', 'Heavy short interest']);
check('Weak growth → Hold above the 200D',
  run(row(EARLY, { revenueGrowthYoY: 3 })), ['Early', 'Hold', 'Weak fundamentals']);
check('Early Buy: strong growth in a real uptrend',
  run(row(EARLY, { fcfTtm: 50e6 })),
  ['Early', 'Buy', 'Buy (early): strong growth in an uptrend']);
check('Early is never Strong Buy by default',
  run(row(EARLY, { fcfTtm: 50e6, pctFromHigh: -5 }))[1], 'Buy');
check('  …unless the profile enables it',
  run(row(EARLY, { fcfTtm: 50e6, pctFromHigh: -5 }), { early: { allow_strong_buy: true } })[1],
  'Strong Buy');
check('Buy with Risk (early): OK but not strong',
  run(row(EARLY, { revenueGrowthYoY: 20, grossMargin: 30, fcfMargin: -10 })),
  ['Early', 'Buy with Risk', 'Buy with Risk (early)']);

console.log('\nETF rules');
const ETF = row(EST, { portfolios: ['ETFs'], qualityRating: null, forwardPe: null });
check('ETF Buy on a clean entry', run(ETF), ['ETF', 'Buy', 'Buy: clean entry']);
check('ETF Strong Buy', run(row(ETF, { vs200ma: 15, pctFromHigh: -5 }))[1], 'Strong Buy');
check('ETF below 200D → Hold', run(row(ETF, { vs200ma: -3, vs50ma: 1 }))[1], 'Hold');
check('ETF breakdown → Sell', run(row(ETF, { vs200ma: -12, vs50ma: -9, oneMonthPct: -9 }))[1],
  'Sell Immediately');

console.log('\nPRESETS');
check('Conservative: tighter stop fires where Balanced held',
  run(row(EST, { vs200ma: -7, vs50ma: -2, oneMonthPct: -9 }), null, 'Conservative')[1],
  'Sell Immediately');
check('  …same row under Balanced is only Avoid',
  run(row(EST, { vs200ma: -7, vs50ma: -2, oneMonthPct: -9 }))[1], 'Avoid');
check('Conservative: Early caps at Buy with Risk',
  run(row(EARLY, { fcfTtm: 50e6 }), null, 'Conservative')[1], 'Buy with Risk');
check('Conservative: 10-day earnings blackout',
  run(row(EST, { nextEarningsDate: '2026-09-20' }), null, 'Conservative')[1], 'Hold');
check('Aggressive: Early Buy on merely OK fundamentals',
  run(row(EARLY, { revenueGrowthYoY: 20, grossMargin: 30, fcfMargin: -10 }), null, 'Aggressive')[1],
  'Buy');
check('Aggressive: 30% month is not yet "extended"',
  run(row(EST, { oneMonthPct: 30 }), null, 'Aggressive')[1], 'Buy');

console.log('\nCOMPOSITES OFF BY DEFAULT, ON BY CONFIG');
check('Momentum ignored by default (rating 2 still Strong Buy)',
  run(row(EST, { vs200ma: 15, pctFromHigh: -5, momentumRating: 2 }))[1], 'Strong Buy');
check('use_momentum on: the same row is gated down',
  run(row(EST, { vs200ma: 15, pctFromHigh: -5, momentumRating: 2 }), { use_momentum: true })[1],
  'Buy');
check('use_quality on: Quality 3 makes an otherwise-strong row Weak → Hold',
  run(row(EST, { qualityRating: 3 }), { use_quality: true })[1], 'Hold');

console.log('\nBLANK DISCIPLINE');
check('a nearly-empty row Holds, with the reason',
  run({ symbol: 'BLANK', portfolios: [], forwardPe: 20, qualityRating: 5 }),
  ['Early', 'Hold', 'No trend data']);
check('blank 1M cannot confirm a breakdown',
  run(row(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: null, threeMonthPct: null }))[1], 'Avoid');
check('blank short float is not "heavy short interest"',
  run(row(EARLY, { shortPctFloat: null, fcfTtm: 50e6 }))[1], 'Buy');

console.log('\nWHIPSAW BAND');
check('inside a 2% band, -1.5% vs 200D is neither above nor below → falls to entry rules',
  run(row(EST, { vs200ma: -1.5, vs50ma: 1, earningsGrowthYoY: 5, revenueGrowthYoY: 5 }),
    { whipsaw: { neutral_band_pct: 2 } })[1], 'Buy'),
check('  …the same row with no band is Below 200D → Hold',
  run(row(EST, { vs200ma: -1.5, vs50ma: 1 }))[1], 'Hold');

console.log('\nCONFIG PLUMBING');
const v1 = A.validate(cfg({ entry: { rsi_low: 70, rsi_high: 65 } }));
check('inverted RSI band is rejected, not repaired', v1.ok, false);
check('  …with a message naming the field', /rsi_low/.test(v1.errors.join(' ')), true);
check('Early stop looser than Established is rejected',
  A.validate(cfg({ stop_loss: { early_vs200: -20 } })).ok, false);
check('a bad manual-override type is rejected',
  A.validate(cfg({ company_type: { manual_overrides: { X: 'Banana' } } })).ok, false);
check('unknown keys are reported by name',
  A.resolve({ entry: { rsi_lo: 45 }, banana: 1 }).unknown, ['entry.rsi_lo', 'banana']);
check('the defaults themselves validate', A.validate(cfg()).ok, true);
check('every preset validates', Object.keys(A.PRESETS)
  .map((p) => A.validate(cfg(null, p)).ok), Object.keys(A.PRESETS).map(() => true));
check('diff() stores only what changed (profile at its default is itself omitted)',
  A.diff(cfg({ chase: { max_1m: 30 } })), { chase: { max_1m: 30 } });
const before = JSON.stringify(A.DEFAULTS);
A.resolve({ chase: { max_1m: 99 } });
check('resolve() never mutates the defaults', JSON.stringify(A.DEFAULTS) === before, true);


console.log('\nINTERMEDIATE STATES (the Action Model columns)');
{
  const st = (r, d, p) => A.evaluate(row(r, d || {}), cfg(p)).states;
  check('healthy base row reads Above 200D / Clean near high / Strong / no guards',
    st(EST), { trend: 'Above 200D', entry: 'Clean, near high', fund: 'Strong', guards: '' });
  check('further from the high the entry drops the qualifier',
    st(EST, { pctFromHigh: -15 }).entry, 'Clean');
  check('breakdown row reads Breakdown even though below-200D is also true',
    st(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -9 }).trend, 'Breakdown');
  check('strong uptrend + near high reads as the setup it is',
    st(EST, { vs200ma: 15, pctFromHigh: -5 }),
    { trend: 'Strong uptrend', entry: 'Clean, near high', fund: 'Strong', guards: '' });
  check('guards line up and join', st(EST, { historyDays: 120, nextEarningsDate: '2026-09-14' }).guards,
    'Thin history · Earnings 3d');
  check('blank trend reads No data', st(EST, { vs200ma: null }).trend, 'No data');
  check('ETF fundamentals read as a dash, not Weak',
    st(row(EST, { portfolios: ['ETFs'], qualityRating: null, forwardPe: null })).fund, '—');
  check('severity ladders cover every state the engine emits',
    [A.TREND_ORDER.includes('Breakdown'), A.ENTRY_ORDER.includes('Clean, near high'),
      A.FUND_ORDER.includes('—')], [true, true, true]);
}


console.log('\nTHE LADDER (explain / ladder)');
{
  // The panel's rungs must fire exactly where the engine fires. Targeted rows
  // first — one per interesting rule — then a random sweep across every field
  // and several profiles, where any divergence sets `mismatch`.
  const ex = (r, d, p) => A.explain(row(r, d || {}), cfg(p));
  const fired = (e) => { const g = e.rungs[e.firedIndex]; return [e.mismatch, g.section, g.action, g.flag]; };

  check('healthy Established base fires the Buy rung (vs200 +6 is under the Strong Buy bar)',
    fired(ex(EST)), [false, 'setup', 'Buy', 'Buy: clean entry, fundamentals OK']);
  check('strong uptrend near the high fires the Strong Buy rung',
    fired(ex(EST, { vs200ma: 15, pctFromHigh: -5 })),
    [false, 'setup', 'Strong Buy', 'Strong Buy: uptrend, clean entry, near high, strong fundamentals']);
  check('breakdown row fires the top veto rung',
    fired(ex(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -9 })), [false, 'veto', 'Sell Immediately', 'Breakdown']);
  check('rungs below the fired one are marked unchecked',
    ex(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -9 }).rungs.slice(1).every((g) => !g.checked), true);
  check('deep-below-the-high BwR rung carries the failed drawdown as a met condition',
    (() => { const e = ex(EST, { vs200ma: 6, pctFromHigh: -25, earningsGrowthYoY: 5, revenueGrowthYoY: 5, profitMargin: 3 });
      const g = e.rungs[e.firedIndex];
      return [e.mismatch, g.flag, g.conds[g.conds.length - 1].met]; })(),
    [false, 'Buy with Risk: deep below the high', true]);
  check('every condition on the fired rung is met (first-match honesty)',
    (() => { const e = ex(EST); return e.rungs[e.firedIndex].conds.every((c) => c.met); })(), true);
  check('ETF row walks the ETF ladder',
    fired(ex(row(EST, { portfolios: ['ETFs'], qualityRating: null, forwardPe: null }), { pctFromHigh: -5, vs200ma: 15 })),
    [false, 'setup', 'Strong Buy', 'Strong Buy: uptrend, clean entry, near high']);
  check('typeParts sum to the establishment score',
    (() => { const e = ex(EST); return e.typeParts.reduce((t, x) => t + x.earned, 0) === e.estScore; })(), true);
  check('typeParts max out at 7', ex(EST).typeParts.reduce((t, x) => t + x.max, 0), 7);
  check('gauges carry value, domain and passing band',
    (() => { const e = ex(EST); const g = e.rungs[e.firedIndex].conds[0].gauge;
      return [typeof g.value, g.domain.length, g.band.length]; })(), ['number', 2, 2]);
  check('the model-level ladder has rungs for all three types',
    ['Established', 'Early', 'ETF'].map((t) => A.ladder(t, cfg()).length > 0), [true, true, true]);
  check('the abstract ladder never claims a condition is met',
    A.ladder('Established', cfg()).every((g) => g.conds.every((c) => !c.met)), true);
  check('gate off adds the mean-reversion rung, gate on omits it',
    [A.ladder('Established', cfg({ trend_gate: { never_buy_below_200d: false } }))
        .some((g) => g.flag === 'Buy with Risk: below 200D, mean-reversion mode'),
      A.ladder('Established', cfg()).some((g) => g.flag === 'Buy with Risk: below 200D, mean-reversion mode')],
    [true, false]);

  // The sweep. A small LCG so the run is deterministic; each field is drawn
  // from a range wide enough to hit every rule, with a blank chance so the
  // null discipline is walked too.
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (lo, hi, blank) => (rnd() < (blank == null ? 0.15 : blank) ? null : lo + rnd() * (hi - lo));
  const randRow = () => ({
    symbol: 'R', portfolios: rnd() < 0.1 ? ['ETFs'] : ['Watchlist'],
    marketCap: pick(1e9, 400e9), netIncomeTtm: pick(-5e9, 20e9), profitMargin: pick(-30, 35),
    fcfTtm: pick(-2e9, 10e9), fcfMargin: pick(-30, 30), forwardPe: pick(5, 80, 0.3),
    roe: pick(-20, 40), qualityRating: pick(1, 10, 0.3),
    earningsGrowthYoY: pick(-40, 60), revenueGrowthYoY: pick(-30, 60),
    grossMargin: pick(10, 80), shortPctFloat: pick(0, 35),
    vs200ma: pick(-35, 35), vs50ma: pick(-25, 25), rsi: pick(15, 90),
    oneMonthPct: pick(-30, 35), threeMonthPct: pick(-45, 50), pctFromHigh: pick(-55, 0),
    volTrend: pick(-25, 25), historyDays: pick(50, 600),
    nextEarningsDate: rnd() < 0.5 ? '2026-09-' + (12 + Math.floor(rnd() * 18)) : '2026-10-20',
    latestDate: '2026-09-11', momentumRating: pick(1, 10),
  });
  const profiles = [cfg(), cfg(null, 'Conservative'), cfg(null, 'Aggressive'),
    cfg(null, 'Trend Rider'), cfg(null, 'Max Risk'), cfg(null, 'Dip Buyer'),
    cfg({ trend_gate: { never_buy_below_200d: false } }),
    cfg({ fixes: { blank_trend_holds: false, weak_blocks_buy_with_risk: false } }),
    cfg({ use_quality: true, use_momentum: true }),
    cfg({ early: { allow_strong_buy: true, buy_requires: 'ok' } }),
    cfg({ earnings: { enabled: false }, use_vol_trend: false }),
    cfg({ whipsaw: { neutral_band_pct: 3 } })];
  let bad = 0, first = null;
  for (let i = 0; i < 2000; i++) {
    const rr = randRow();
    for (const c of profiles) {
      const e = A.explain(rr, c);
      if (e.mismatch || e.familyMismatch) {
        bad++;
        if (!first) first = { row: rr, profile: c.profile, got: [e.action, e.flag], firedIndex: e.firedIndex };
      }
    }
  }
  if (first) console.log('  first mismatch:', JSON.stringify(first));
  check('24,000 random row-x-profile evaluations: ladders, state families and engine never disagree', bad, 0);
}


console.log('\nTHE STATE LADDERS (per-column families)');
{
  const ex = (r, d, p) => A.explain(row(r, d || {}), cfg(p));
  const lit = (rs) => { const g = rs.find((x) => x.fired); return g ? g.label : null; };
  check('trend family lights the word the column shows',
    lit(ex(EST, { vs200ma: 15 }).families.trend), 'Strong uptrend');
  check('trend family dims the rungs below the lit one',
    ex(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -9 }).families.trend
      .some((g) => !g.checked), true);
  check('entry family reads Clean, near high on the base row',
    lit(ex(EST).families.entry), 'Clean, near high');
  check('fund family reads Strong with every condition met',
    (() => { const f = ex(EST).families.fund; const g = f.find((x) => x.fired);
      return [g.label, g.conds.every((c) => c.met)]; })(), ['Strong', true]);
  check('fund family swaps to the Quality gates when the composite is on',
    (() => { const f = ex(EST, {}, { use_quality: true }).families.fund;
      return f.find((x) => x.label === 'Strong').conds[0].label.indexOf('Quality') === 0; })(), true);
  check('guards are independent, not first-match',
    (() => { const g = ex(EST, { historyDays: 120, nextEarningsDate: '2026-09-14' }).families.guards;
      return [g.length, g.every((x) => x.checked), g.filter((x) => x.fired).length]; })(),
    [2, true, 2]);
  check('ETF rows carry no fundamentals ladder',
    ex(row(EST, { portfolios: ['ETFs'], qualityRating: null, forwardPe: null })).families.fund.length, 0);
  check('no familyMismatch on the base rows',
    [ex(EST).familyMismatch, ex(EARLY).familyMismatch], [false, false]);
}


console.log('\nTREND REPLAY (trendAt)');
{
  const c = cfg();
  check('trendAt matches the evaluated column on the base row',
    A.trendAt({ v200: 6, v50: 4, m1: 3, m3: 8 }, 'Established', c),
    A.evaluate(EST, c).states.trend);
  check('trendAt reads Breakdown with the Established confirms',
    A.trendAt({ v200: -12, v50: -10, m1: -9, m3: 5 }, 'Established', c), 'Breakdown');
  check('the Early leash is shorter — same readings, different word',
    [A.trendAt({ v200: -7, v50: -1, m1: -6, m3: 0 }, 'Early', c),
      A.trendAt({ v200: -7, v50: -1, m1: -6, m3: 0 }, 'Established', c)],
    ['Breakdown', 'Downtrend']);
  check('a blank 200D reads No data', A.trendAt({ v200: null, v50: 2, m1: 1, m3: 2 }, 'Established', c), 'No data');
  check('a strong uptrend reads as one', A.trendAt({ v200: 14, v50: 3, m1: 2, m3: 9 }, 'Established', c), 'Strong uptrend');

  // Property: for random readings, trendAt says exactly what the column says.
  let seed2 = 7, bad2 = 0;
  const rnd2 = () => (seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pk = (lo, hi) => (rnd2() < 0.12 ? null : lo + rnd2() * (hi - lo));
  for (let i = 0; i < 400; i++) {
    const rr = row(rnd2() < 0.5 ? EST : EARLY, {
      vs200ma: pk(-35, 35), vs50ma: pk(-25, 25),
      oneMonthPct: pk(-30, 35), threeMonthPct: pk(-45, 50) });
    const e = A.evaluate(rr, c);
    const w = A.trendAt({ v200: rr.vs200ma, v50: rr.vs50ma, m1: rr.oneMonthPct, m3: rr.threeMonthPct }, e.type, c);
    if (w !== e.states.trend) bad2++;
  }
  check('400 random readings: trendAt equals the column word', bad2, 0);
}


console.log('\nTHE FIVE PROFILES (picker presets)');
{
  // Trend Rider: chases further, exits unchanged.
  check('Trend Rider buys what Balanced calls Extended',
    [run(row(EST, { oneMonthPct: 28 }))[1], run(row(EST, { oneMonthPct: 28 }), null, 'Trend Rider')[1]],
    ['Hold', 'Buy']);
  check('Trend Rider keeps the Balanced stop — breakdown still sells',
    run(row(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -9 }), null, 'Trend Rider'),
    ['Established', 'Sell Immediately', 'Breakdown']);
  check('Trend Rider lets Early reach Strong Buy on strong fundamentals',
    run(row(EARLY, { revenueGrowthYoY: 40, grossMargin: 60, fcfTtm: 100e6, pctFromHigh: -5 }),
      null, 'Trend Rider')[1], 'Strong Buy');

  // Max Risk: the widest everything, still above the 200D only.
  check('Max Risk softens the Balanced breakdown to a downtrend Avoid (the veto below it)',
    [run(row(EST, { vs200ma: -17, vs50ma: -2, oneMonthPct: -10 }))[1],
      run(row(EST, { vs200ma: -17, vs50ma: -2, oneMonthPct: -10 }), null, 'Max Risk')[1]],
    ['Sell Immediately', 'Avoid']);
  check('Max Risk buys deep in a drawdown where Balanced caps at Buy with Risk',
    [run(row(EST, { pctFromHigh: -25 }))[1], run(row(EST, { pctFromHigh: -25 }), null, 'Max Risk')[1]],
    ['Buy with Risk', 'Buy']);
  check('Max Risk still never buys below the 200D',
    run(row(EST, { vs200ma: -3, vs50ma: 1 }), null, 'Max Risk')[1], 'Hold');

  // Dip Buyer: the gate flips, the stops do not.
  check('Dip Buyer turns a below-200D clean entry into Buy with Risk',
    [run(row(EST, { vs200ma: -4, vs50ma: 1 }))[1], run(row(EST, { vs200ma: -4, vs50ma: 1 }), null, 'Dip Buyer')],
    ['Hold', ['Established', 'Buy with Risk', 'Buy with Risk: below 200D, mean-reversion mode']]);
  check('Dip Buyer keeps the Balanced stop — a real breakdown still sells',
    run(row(EST, { vs200ma: -12, vs50ma: -10, oneMonthPct: -9 }), null, 'Dip Buyer')[1], 'Sell Immediately');
}


console.log('\nTREND TIMELINE (trendTimeline)');
{
  const c = cfg();
  // Oldest-first synthetic: flat, rise, crash — then flipped to newest-first,
  // the shape the archive reader hands the server.
  const of = [];
  let px = 100;
  for (let i = 0; i < 250; i++) of.push(px);
  for (let i = 0; i < 150; i++) { px *= 1.004; of.push(px); }
  for (let i = 0; i < 80; i++) { px *= 0.985; of.push(px); }
  const closes = of.slice().reverse();
  const dates = closes.map((_, j) => 'D' + String(closes.length - j).padStart(4, '0'));
  const tl = A.trendTimeline(closes, dates, 'Established', c, 252);
  check('a timeline comes back as dated runs', typeof tl === 'string' && tl.includes(' → '), true);
  const runs = tl.split(' → ');
  check('runs are compressed — a year of days becomes a handful of states', runs.length <= 10, true);
  check('the walk passes through the ladder in order',
    ['Strong uptrend', 'Breakdown'].every((w) => tl.includes(w)), true);
  check('the last run is the current state (matches trendAt at the newest bar)',
    runs[runs.length - 1].endsWith((() => {
      const pct = (b) => (b > 0 ? (closes[0] / b - 1) * 100 : null);
      const sma = (len) => closes.slice(0, len).reduce((x, y) => x + y, 0) / len;
      return A.trendAt({ v200: pct(sma(200)), v50: pct(sma(50)),
        m1: pct(closes[21]), m3: pct(closes[63]) }, 'Established', c);
    })()), true);
  check('dates come out oldest first', runs[0].slice(0, 5) <= runs[runs.length - 1].slice(0, 5), true);
  check('a series too short for a 200D returns null',
    A.trendTimeline(closes.slice(0, 150), dates.slice(0, 150), 'Established', c, 252), null);
}

console.log(`\n${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
