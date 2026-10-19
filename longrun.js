// The long-run figures from a company's own filings -- the arithmetic and
// nothing else. No network, no database: the margins.js shape. server.js reads
// the filings and hands them over.
//
// (2026-10-19, the owner, after looking at Macrotrends' screener: growth over
// several years, valuation against the stock's own past, the dividend record
// and financial health.) This file starts with the first of those.
//
//   growth()   revenue and net income, compound yearly growth over three and
//              five years, for the screener's Long run group.
//
// DISPLAY ONLY. Nothing here is read by the Signal rules.
'use strict';

const EarnGrowth = require('./earngrowth.js');

const DAY = 86400000;
// A quarterly figure past these is not a company's (margins.js, earngrowth.js).
const REV_MAX = 5e11;
const NI_MAX = EarnGrowth.NI_MAX;
// The newest period must be this recent, or the company has stopped filing and
// its "growth now" is growth then. A quarter is reported within about 45 days
// of its end; a year can take 120 more for a foreign filer.
const Q_STALE_DAYS = 230;
const FY_STALE_DAYS = 460;
// A yearly rate past this is a base too small to measure from, not growth.
const GROWTH_MAX = 1000;
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));   // a null is not a zero
const qIndex = (q) => Number(q.slice(0, 4)) * 4 + Number(q.slice(5)) - 1;
const daysBetween = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY;

// One field's quarters by calendar-quarter index (earngrowth.js's rule: a
// fiscal quarter belongs where its middle falls). Where two periods land in one
// calendar quarter (a changed year end) the later one wins.
function quarters(rows, field, max) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || r.periodType !== 'Q') continue;
    const v = num(r[field]);
    if (v == null || Math.abs(v) > max) continue;
    const q = EarnGrowth.quarterOf(r.periodEnd);
    if (!q) continue;
    const i = qIndex(q);
    const had = out.get(i);
    if (had && had.end >= String(r.periodEnd)) continue;
    out.set(i, { end: String(r.periodEnd), v });
  }
  return out;
}

// The four quarters ending at index i, summed; null unless all four are there.
function ttmAt(q, i) {
  let t = 0;
  for (let k = i - 3; k <= i; k++) {
    const x = q.get(k);
    if (!x) return null;
    t += x.v;
  }
  return t;
}

// Compound yearly growth from `then` to `now` over `years`, in percent. BOTH
// ENDS MUST BE POSITIVE: from a loss there is no rate (the sign inverts, and
// "from -1 to +5" is not +600% a year in any useful sense), and from nothing
// there is no base.
function cagr(now, then, years) {
  if (now == null || then == null || !(now > 0) || !(then > 0)) return null;
  const g = (Math.pow(now / then, 1 / years) - 1) * 100;
  if (!isFinite(g) || Math.abs(g) > GROWTH_MAX) return null;
  return Math.round(g * 100) / 100;
}

// A row's figure in the company's OWN currency. A foreign filer's rows are
// converted to dollars when read (secfacts.js toDollars), each period at its
// own average rate, so a growth rate between two of them would carry the
// currency's move as well as the company's. Dividing the rate back out undoes
// that; a row without its rate is no use for growth.
function own(r, field) {
  const v = num(r[field]);
  if (v == null) return null;
  if (!r.currency) return v;
  const fx = num(r.fxAvg);
  return fx && fx > 0 ? v / fx : null;
}

// ---- growth over three and five years ---------------------------------------
//
// TRAILING FOUR QUARTERS NOW AGAINST THE SAME FOUR QUARTERS THREE AND FIVE
// YEARS EARLIER, where the company files quarters in dollars. A year of four
// quarters ending at each end, so a seasonal business compares like with like
// and nothing waits a year for the next annual report.
//
// THE ANNUAL REPORTS INSTEAD, in the company's own currency, where it files in
// another currency (a 20-F is annual only, and a derived quarter carries no
// rate to divide out) or has no quarterly trailing year at all. The newest
// fiscal year against the one ending three or five years before it, matched
// on the date within six weeks.
//
// Revenue and net income are separate: a bank files no revenue line and still
// has a net income, and a company with a loss at either end has a revenue rate
// and no net income one. Each figure is null on its own; nothing is ever a 0.
//
// rows: latestFilled rows for one company. today: 'YYYY-MM-DD'.
// Returns { rev3, rev5, ni3, ni5, end, basis } or null when there is nothing.
function growth(rows, today) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const t = today || new Date().toISOString().slice(0, 10);
  const foreign = list.some((r) => r && r.currency);
  if (!foreign) {
    const rev = quarters(list, 'revenue', REV_MAX), ni = quarters(list, 'netIncome', NI_MAX);
    const all = [...rev.keys(), ...ni.keys()];
    if (all.length) {
      const last = Math.max(...all);
      const end = (rev.get(last) || ni.get(last)).end;
      const fresh = daysBetween(end, t) <= Q_STALE_DAYS;
      const revNow = fresh ? ttmAt(rev, last) : null, niNow = fresh ? ttmAt(ni, last) : null;
      if (revNow != null || niNow != null) {
        // A revenue quarter must itself be positive: a negative "revenue" is
        // a reversal filed under the tag, and summing it hides the fault.
        const posRev = (i) => { for (let k = i - 3; k <= i; k++) { const x = rev.get(k); if (!x || !(x.v > 0)) return false; } return true; };
        const at = (q, n) => ttmAt(q, last - 4 * n);
        const out = {
          rev3: posRev(last) && posRev(last - 12) ? cagr(revNow, at(rev, 3), 3) : null,
          rev5: posRev(last) && posRev(last - 20) ? cagr(revNow, at(rev, 5), 5) : null,
          ni3: cagr(niNow, at(ni, 3), 3),
          ni5: cagr(niNow, at(ni, 5), 5),
          end, basis: 'q',
        };
        return out.rev3 == null && out.rev5 == null && out.ni3 == null && out.ni5 == null ? null : out;
      }
    }
  }
  // The annual path.
  const fy = list.filter((r) => r && r.periodType === 'FY' && r.periodEnd)
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
  if (!fy.length) return null;
  const top = fy[0];
  if (!(daysBetween(top.periodEnd, t) <= FY_STALE_DAYS)) return null;
  const back = (n) => {
    const want = new Date(top.periodEnd + 'T00:00:00Z');
    want.setUTCFullYear(want.getUTCFullYear() - n);
    const w = want.toISOString().slice(0, 10);
    let best = null, gap = Infinity;
    for (const r of fy) { const g = Math.abs(daysBetween(r.periodEnd, w)); if (g < gap) { gap = g; best = r; } }
    return gap <= 45 ? best : null;
  };
  const val = (r, f) => {
    if (!r) return null;
    const v = own(r, f);
    return v == null || Math.abs(v) > (f === 'revenue' ? REV_MAX : NI_MAX) * 4 ? null : v;
  };
  const b3 = back(3), b5 = back(5);
  const out = {
    rev3: cagr(val(top, 'revenue'), val(b3, 'revenue'), 3),
    rev5: cagr(val(top, 'revenue'), val(b5, 'revenue'), 5),
    ni3: cagr(val(top, 'netIncome'), val(b3, 'netIncome'), 3),
    ni5: cagr(val(top, 'netIncome'), val(b5, 'netIncome'), 5),
    end: top.periodEnd, basis: 'fy',
  };
  return out.rev3 == null && out.rev5 == null && out.ni3 == null && out.ni5 == null ? null : out;
}

// How far back the filings must reach for growth(): five years before a
// trailing year that began nearly a year before a quarter up to 230 days old,
// or five years before an annual report up to 460 days old, with room.
const GROWTH_YEARS = 6.8;

// ---- the parts built on the full filings (phase 2) --------------------------
//
// These four need a company's whole filing history and its split history, so
// server.js builds them a slice of companies a night (longRunSlice) from the
// rows trendSeries already reads, and stores them.

// A company's annual reports, newest first, one a fiscal year.
function annuals(filled) {
  return (filled || []).filter((r) => r && r.periodType === 'FY' && r.periodEnd)
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
}
// The filing a row's figure came from. latestFilled fills a blank from an
// earlier filing of the same period and records which (filledFrom); that
// filing's own date is what decides whether it had seen a split.
function sourceFiled(r, field) {
  const accn = r.filledFrom && r.filledFrom[field];
  if (!accn) return r.filed || null;
  const o = (r.__trail || []).find((x) => x.accn === accn);
  return (o && o.filed) || r.filed || null;
}
// A SPLIT, NOT A SPIN-OFF. The provider's split list carries price factors for
// spin-offs too (1.05 and the like), which change no share count; splitadj.js
// met the same thing. Only a factor that moves the count by half again or more
// is treated as a split here.
const realSplits = (splits) => (splits || []).filter((x) => x && x.d && Number(x.f) > 0
  && (Number(x.f) >= 1.5 || Number(x.f) <= 1 / 1.5)).map((x) => ({ d: String(x.d), f: Number(x.f) }));
// The product of the splits a filing made on `filed` had not yet seen: every
// split dated after it. A per-share figure divides by it and a share count
// multiplies by it, to put every year in today's shares.
function splitsSince(filed, splits) {
  if (!filed) return 1;
  let f = 1;
  for (const s of splits) if (s.d > String(filed)) f *= s.f;
  return f;
}
// A balance-sheet position in the company's own currency (the rate at the
// period end, where a flow uses the average over the period).
function ownI(r, field) {
  const v = num(r[field]);
  if (v == null) return null;
  if (!r.currency) return v;
  const fx = num(r.fxEnd);
  return fx && fx > 0 ? v / fx : null;
}
const median = (list) => {
  const v = list.slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// ---- P/E against its own ten-year median -------------------------------------
//
// THE SAME ARITHMETIC AS THE LINES CARD'S P/E: market value at each quarter
// end over the trailing year's net income from the filings (trendSeries, which
// handles the share-count rules). NOW is today's market value over the newest
// trailing year, the same formulation struck today rather than at a quarter
// end. Both are filings-based on purpose: the screener's Trail P/E is the
// price provider's, and setting a provider's figure against a median built
// from filings would compare two sources, not two times.
//
// peSeries: the quarter-end P/Es, oldest first, null where earnings were a
// loss (trendSeries already withholds those). capNow: today's market value.
// ttmNow: { netIncome, d } the newest trailing year. Returns
// { now, med, n, vsMed } or null. A loss now has no P/E and so no reading; a
// median needs MIN_PE_POINTS quarters with a multiple, since a median of four
// profitable quarters in ten years describes the exceptions.
const MIN_PE_POINTS = 20;
const PE_MAX = 1000;         // past this a multiple is a rounding of near-zero earnings
function peVsHistory(peSeries, capNow, ttmNow, today) {
  const pts = (peSeries || []).map(num).filter((v) => v != null && v > 0 && v <= PE_MAX);
  if (pts.length < MIN_PE_POINTS) return null;
  const cap = num(capNow), ni = ttmNow ? num(ttmNow.netIncome) : null;
  if (!(cap > 0) || !(ni > 0) || !ttmNow.d) return null;
  if (!(daysBetween(ttmNow.d, today || new Date().toISOString().slice(0, 10)) <= Q_STALE_DAYS)) return null;
  const now = cap / ni;
  if (!(now <= PE_MAX)) return null;
  const med = median(pts);
  const r2 = (v) => Math.round(v * 100) / 100;
  return { now: r2(now), med: r2(med), n: pts.length, vsMed: r2((now / med - 1) * 100) };
}

// ---- the dividend record -----------------------------------------------------
//
// Dividends DECLARED PER SHARE in each annual report, in today's shares (a
// figure from a report filed before a split is divided by it) and in the
// company's own currency. Two readings:
//   streak  consecutive fiscal years, ending with the newest, in which the
//           dividend per share was higher than the year before. 0 is a real
//           reading: it paid, and did not raise it last year.
//   g5      the dividend per share's growth a year over five years.
// A company with no dividend tag on its newest report has no record here,
// which is not the same as a record of zero, and is blank. THE STREAK IS
// CAPPED BY THE FILINGS: structured reports start about 2009, so a streak
// reads "years on file", never "since forever". `since` says where it starts.
// Without the split history the dividend figures cannot be put on one footing
// (Apple's 2017 report is pre-split), so nothing is read.
function dividends(filled, splitList, today) {
  if (!Array.isArray(splitList)) return null;
  const sp = realSplits(splitList);
  const fy = annuals(filled);
  if (!fy.length) return null;
  const t = today || new Date().toISOString().slice(0, 10);
  if (!(daysBetween(fy[0].periodEnd, t) <= FY_STALE_DAYS)) return null;
  const dps = (r) => {
    const v = own(r, 'dividendsPerShare');
    if (v == null || v < 0) return null;
    return v / splitsSince(sourceFiled(r, 'dividendsPerShare'), sp);
  };
  const top = dps(fy[0]);
  if (top == null || !(top > 0)) return null;
  // Walk back while each year is one fiscal year before the last.
  let streak = 0, since = fy[0].periodEnd.slice(0, 4), broke = false;
  const series = [{ d: fy[0].periodEnd, v: top }];
  for (let i = 1; i < fy.length; i++) {
    const gap = daysBetween(fy[i].periodEnd, fy[i - 1].periodEnd);
    if (gap < 330 || gap > 400) break;            // a hole in the reports ends the record
    const v = dps(fy[i]);
    // A year with no dividend ends the record: going from nothing to a
    // dividend is starting one, not raising it (Apple's 2011 read as a raise).
    if (v == null || !(v > 0)) break;
    series.push({ d: fy[i].periodEnd, v });
    // Higher by more than rounding: a dividend held flat is not a raise.
    if (!broke && series[i - 1].v > v * 1.001) { streak++; since = fy[i].periodEnd.slice(0, 4); }
    else broke = true;
  }
  const five = series.find((x) => Math.abs(daysBetween(x.d, fy[0].periodEnd) - 5 * 365.25) <= 45);
  return { streak, since, years: series.length, g5: five ? cagr(top, five.v, 5) : null, dps: Math.round(top * 10000) / 10000, end: fy[0].periodEnd };
}

// ---- interest coverage -------------------------------------------------------
//
// Operating income over interest expense, the trailing four quarters where
// they are filed in dollars, else the newest annual report in the company's
// own currency. How many times over the year's operating profit would pay the
// year's interest. NOT FOR A LENDER: a bank's interest expense is the interest
// it pays depositors, the cost of its product, and JPMorgan's runs to tens of
// billions. No interest expense filed is blank, not "infinitely covered", and a
// coverage off an operating loss is negative and is shown as it is.
const COVER_MAX = 999;
function coverage(filled, today, isLender) {
  if (isLender) return null;
  const list = filled || [];
  const t = today || new Date().toISOString().slice(0, 10);
  const r1 = (v) => Math.round(v * 10) / 10;
  const foreign = list.some((r) => r && r.currency);
  if (!foreign) {
    const oi = quarters(list, 'operatingIncome', NI_MAX), ie = quarters(list, 'interestExpense', NI_MAX);
    const all = [...oi.keys()].filter((i) => ie.has(i));
    if (all.length) {
      const last = Math.max(...all);
      const a = ttmAt(oi, last), b = ttmAt(ie, last), end = oi.get(last).end;
      if (a != null && b != null && b > 0 && daysBetween(end, t) <= Q_STALE_DAYS) {
        const c = a / b;
        return Math.abs(c) > COVER_MAX ? null : { cover: r1(c), end, basis: 'q' };
      }
    }
  }
  const fy = annuals(list);
  if (!fy.length || !(daysBetween(fy[0].periodEnd, t) <= FY_STALE_DAYS)) return null;
  const a = own(fy[0], 'operatingIncome'), b = own(fy[0], 'interestExpense');
  if (a == null || b == null || !(b > 0)) return null;
  const c = a / b;
  return Math.abs(c) > COVER_MAX ? null : { cover: r1(c), end: fy[0].periodEnd, basis: 'fy' };
}

// ---- the Piotroski F-score ---------------------------------------------------
//
// Nine yes-or-no tests on the newest annual report against the one before
// (Piotroski, 2000), one point each. A COUNT OF TESTS PASSED, not a rating:
// the card and the column say which tests, and none of it feeds the Signal.
//   profitability  1 net income > 0        2 operating cash flow > 0
//                  3 return on assets up   4 cash flow above net income
//   balance sheet  5 long-term debt to assets down (or no debt either year)
//                  6 current ratio up      7 no more shares than a year before
//   efficiency     8 gross margin up       9 asset turnover up
// Return on assets and asset turnover are over the assets at the START of the
// year (the year before's closing balance), so three annual reports are
// needed. EVERY TEST MUST BE SCORABLE, or there is no score: a missing current
// ratio scored as a fail would make the count a measure of what was tagged.
// Not for a lender (no gross margin, no current ratio, and debt is its stock
// in trade). Shares are put in today's units through the split history (a
// split is not dilution); without that history there is no score.
function piotroski(filled, splitList, today, isLender) {
  if (isLender || !Array.isArray(splitList)) return null;
  const sp = realSplits(splitList);
  const fy = annuals(filled);
  if (fy.length < 3) return null;
  const t = today || new Date().toISOString().slice(0, 10);
  if (!(daysBetween(fy[0].periodEnd, t) <= FY_STALE_DAYS)) return null;
  const [a, b, c] = fy;                                   // this year, last year, the year before
  const yr = (x, y) => { const g = daysBetween(y.periodEnd, x.periodEnd); return g >= 330 && g <= 400; };
  if (!yr(a, b) || !yr(b, c)) return null;
  const f = (r, k) => own(r, k), p = (r, k) => ownI(r, k);
  const ni0 = f(a, 'netIncome'), ni1 = f(b, 'netIncome');
  const cfo0 = f(a, 'operatingCashFlow');
  const as0 = p(a, 'assets'), as1 = p(b, 'assets'), as2 = p(c, 'assets');
  const rev0 = f(a, 'revenue'), rev1 = f(b, 'revenue');
  const gp0 = f(a, 'grossProfit'), gp1 = f(b, 'grossProfit');
  const ca0 = p(a, 'currentAssets'), cl0 = p(a, 'currentLiabilities'), ca1 = p(b, 'currentAssets'), cl1 = p(b, 'currentLiabilities');
  const sh = (r) => { const s = num(r.sharesDiluted); return s != null && s > 0 ? s * splitsSince(sourceFiled(r, 'sharesDiluted'), sp) : null; };
  const sh0 = sh(a), sh1 = sh(b);
  const need = [ni0, ni1, cfo0, as0, as1, as2, rev0, rev1, gp0, gp1, ca0, cl0, ca1, cl1, sh0, sh1];
  if (need.some((v) => v == null) || !(as1 > 0) || !(as2 > 0) || !(as0 > 0) || !(rev0 > 0) || !(rev1 > 0) || !(cl0 > 0) || !(cl1 > 0)) return null;
  // Long-term debt: a company that tags none in either year has none to have
  // grown; one that tags it in one year only cannot be compared.
  const d0 = p(a, 'debt'), d1 = p(b, 'debt');
  let lev;
  if (d0 == null && d1 == null) lev = true;
  else if (d0 == null || d1 == null) return null;
  else lev = d0 / as0 <= d1 / as1;
  const tests = [
    ni0 > 0,
    cfo0 > 0,
    ni0 / as1 > ni1 / as2,
    cfo0 > ni0,
    lev,
    ca0 / cl0 > ca1 / cl1,
    sh0 <= sh1 * 1.001,                                  // rounding is not an issue of shares
    gp0 / rev0 > gp1 / rev1,
    rev0 / as1 > rev1 / as2,
  ];
  return { score: tests.filter(Boolean).length, bits: tests.map((x) => (x ? 1 : 0)).join(''), end: a.periodEnd };
}
const PIOTROSKI_TESTS = ['Net income above zero', 'Operating cash flow above zero', 'Return on assets up',
  'Cash flow above net income', 'Long-term debt to assets down', 'Current ratio up', 'No new shares',
  'Gross margin up', 'Asset turnover up'];

module.exports = { growth, cagr, quarters, ttmAt, own, ownI, GROWTH_YEARS, GROWTH_MAX, Q_STALE_DAYS, FY_STALE_DAYS,
  peVsHistory, dividends, coverage, piotroski, realSplits, splitsSince, sourceFiled, median,
  MIN_PE_POINTS, PE_MAX, COVER_MAX, PIOTROSKI_TESTS };
