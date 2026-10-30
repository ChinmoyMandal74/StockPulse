// THE OWNER'S SOURCE RULE, BUILT (2026-10-29, docs/context/data-sources.md).
//
//   "lets take the data from Earning release if that is available as it comes
//    first However SEC data is more accurate when it comes to restatements if
//    SEC data exists we should take the data from SEC, if for some reason SEC
//    data is not dependable we should get it from Twelve data."
//
// For each company and each figure below: the results release while it is the
// newest, the SEC data once it has the quarter and is dependable (it carries
// restatements: the latest filing for each period), and Twelve Data where
// neither gives a dependable figure. Twelve months are put together A QUARTER
// AT A TIME: each of the four quarters takes its SEC figure where dependable,
// else its release figure (an older quarter's release figure restated by a
// later release's year-ago column takes the restated one).
//
// THE SIGNAL READS IT TOO (the owner, 2026-10-29: "just rebuild signal"). Net
// income, free cash flow and its margin, gross and profit margin, ROE, and
// revenue and earnings growth come through this rule, and Quality is scored
// again from them (applyScores) before the verdict. Market value, forward P/E
// and short % of float stay Twelve Data's: no filing has them. The stored
// snapshot keeps Twelve Data's own figures (fundamentals_history, /recon and
// /sources read them as Twelve Data's); the rule is laid over them wherever
// the Signal is scored (scoreActionInto) and on the way out.
//
// FREE CASH FLOW is operating cash flow less capex, the owner's definition;
// Twelve Data's is levered, so it is no fallback: a company with no cash flow
// lines in either source (banks and insurers, mostly) has none, and the
// Signal's free cash flow rules do not fire for it.
//
// DEPENDABLE is mechanical, as data-sources.md states it:
//   - the SEC value is missing, or the SEC data is not yet on the newest
//     quarter: the release is used for that quarter;
//   - a quarter's SEC value more than a tenth off the release's for the same
//     quarter (or of the other sign): the release is used. Measured, the
//     10-Q agrees with the release 90-99% of the time, and the misses traced
//     are mostly our choice of tag (Martin Marietta's Q1 2026 EPS $25.06
//     against the release's $1.31; Charter's and MetLife's revenue);
//   - two out of three: where the four releases summed and Twelve Data agree
//     (2%) and the quarter-by-quarter figure agrees with neither, the release
//     figure is used (Charter's and MetLife's revenue tags);
//   - UNCONFIRMED: where no quarter has the SEC data and the release agreeing
//     (2%), a figure more than half again or under two thirds of Twelve Data's is not
//     used (CNA's revenue tag: $1.5B a year against $15.2B; there is no
//     release revenue to check it by). Either may be the wrong one -- Twelve
//     Data's Corteva revenue is a quarter's -- but unconfirmed, nothing
//     changes from what the page showed before.
// And the whole company keeps Twelve Data when our newest quarter is older
// than Twelve Data's own (its profile has caught a quarter we have not).
//
// Twelve Data on ANOTHER DEFINITION is no fallback (the owner, 2026-10-29):
// total debt counts leases there, borrowings only here, so the debt family
// shows a dash where neither the release nor the SEC data gives the lines;
// free cash flow is levered there, operating cash flow less capex here.
//
// Built whole on the daily filings pass (marginChangeBuild, which already
// holds every company's filings), and for the companies that just reported by
// release-load.js after each run. Stored as the figure `sourced`; stamped on
// the way out (stampSources in server.js), on copies of the rows the stored
// snapshot is never written from.
const SecFacts = require('./secfacts.js');

const V = 2;
const DAY = 86400000;
const t = (d) => Date.parse(String(d).slice(0, 10) + 'T12:00:00Z');
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const off20 = (a, b) => a != null && b != null && a !== 0 && b !== 0 && (Math.abs(a / b) > 20 || Math.abs(a / b) < 1 / 20);
const close = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * 0.02 + 1e-9;
// Two figures for one quarter that differ by more than a tenth, or in sign.
const disputed = (a, b) => a != null && b != null && (Math.sign(a) !== Math.sign(b) || Math.abs(a - b) > Math.max(Math.abs(a), Math.abs(b)) * 0.10);
// Nothing confirms it and it is more than half again, or under two thirds of, Twelve Data's
// (or of the other sign): not dependable, Twelve Data's is kept.
const farFromTd = (v, td) => td != null && td !== 0 && (v / td > 1.5 || v / td < 1 / 1.5);
// One quarter apart: 75 to 120 days (a 52/53-week calendar's sixteen-week
// quarter runs about 112: Costco, PepsiCo, Kroger, AutoZone).
const gapOk = (a, b) => { const g = (t(b) - t(a)) / DAY; return g >= 75 && g <= 120; };
const STALE_DAYS = 200;      // a newest quarter older than this is not current
const SEC_SINCE_DAYS = 800;  // two years of quarters, and the year before for a restated year-ago
const REL_SINCE_DAYS = 480;  // five releases: four quarters and one before for a year-to-date cash flow

// The fields written, by kind. TTM: four quarters summed; QE: at the newest
// quarter's end; the rest are worked out from those and today's market value.
// EBITDA is not on the list: ours (operating income plus depreciation) agreed
// with Twelve Data's for 20% of companies on the same quarter, which leaves
// impairments out (EchoStar -$15.6B against $2.2B). Another definition.
const TTM_FIELDS = ['revenueTtm', 'grossProfitTtm', 'operatingCashFlowTtm', 'dilutedEpsTtm', 'netIncomeTtm', 'fcfTtm'];
// The newest quarter against the same quarter a year earlier, in percent.
const GROWTH_FIELDS = ['revenueGrowthYoY', 'earningsGrowthYoY'];
const QE_FIELDS = ['totalCash', 'totalDebt', 'netCash', 'debtToEquity', 'currentRatio', 'bookValuePerShare', 'sharesOutstanding'];
const DERIVED = ['operatingMargin', 'grossMargin', 'profitMargin', 'fcfMargin', 'roe', 'fcfYield', 'priceToSales', 'priceToBook', 'enterpriseValue', 'evToEbitda', 'netCashPct'];
const FIELDS = [...TTM_FIELDS, ...GROWTH_FIELDS, ...QE_FIELDS, ...DERIVED];
// Twelve Data's figure is on another definition: no fallback.
const NO_TD = new Set(['totalDebt', 'netCash', 'debtToEquity', 'enterpriseValue', 'evToEbitda', 'netCashPct', 'fcfTtm', 'fcfMargin', 'fcfYield']);
// The Signal's inputs this rule sets (the rest, market value, forward P/E,
// short % of float, stay Twelve Data's); Quality is scored again from them.
const SIGNAL_SET = ['netIncomeTtm', 'profitMargin', 'fcfTtm', 'fcfMargin', 'roe', 'revenueGrowthYoY', 'earningsGrowthYoY', 'grossMargin'];
const SIGNAL_KEPT = ['marketCap', 'forwardPe', 'shortPctFloat'];

const isFin = (row) => /^financial/i.test(String((row && row.sector) || ''));

// Each source's quarter figure for one line.
const LINES = {
  revenue: {
    field: (q, fin) => (fin && q.netRevenue != null ? 'netRevenue' : 'revenue'),
    sec: (q, fin) => num(fin && q.netRevenue != null ? q.netRevenue : q.revenue),
    rel: (r) => num(r.revenue), prior: (r) => num(r.revenuePrior) },
  grossProfit: {
    field: () => 'grossProfit',
    sec: (q) => (q.grossProfit != null ? num(q.grossProfit) : q.costOfRevenue != null && q.revenue != null ? num(q.revenue) - Math.abs(num(q.costOfRevenue)) : null),
    rel: (r) => (r.grossProfit != null ? num(r.grossProfit) : r.costRev != null && r.revenue != null ? num(r.revenue) - Math.abs(num(r.costRev)) : null),
    prior: (r) => (r.grossProfitPrior != null ? num(r.grossProfitPrior) : r.costRevPrior != null && r.revenuePrior != null ? num(r.revenuePrior) - Math.abs(num(r.costRevPrior)) : null) },
  opIncome: { field: () => 'operatingIncome', sec: (q) => num(q.operatingIncome), rel: (r) => num(r.opIncome), prior: (r) => num(r.opIncomePrior) },
  ocf: { field: () => 'operatingCashFlow', sec: (q) => num(q.operatingCashFlow), rel: null, prior: null },   // the release's quarter is worked out below
  eps: { field: () => 'epsDiluted', sec: (q) => num(q.epsDiluted), rel: (r) => num(r.epsGaap), prior: (r) => num(r.epsGaapPrior) },
  // Net income attributable to the company, as both sources state it.
  netIncome: { field: () => 'netIncome', sec: (q) => num(q.netIncome), rel: (r) => num(r.netIncome), prior: (r) => num(r.netIncomePrior) },
  // Operating cash flow less capex, both from the same statement.
  fcf: { field: () => 'operatingCashFlow', sec: (q) => (q.operatingCashFlow == null || q.capex == null ? null : num(q.operatingCashFlow) - Math.abs(num(q.capex))), rel: null, prior: null },
};

// One company's quarters, the SEC data's and the releases' on one timeline
// (period ends within a week are one quarter).
function timeline(secQ, rels) {
  const pts = [];
  for (const q of secQ) pts.push({ end: q.periodEnd, sec: q });
  for (const r of rels) pts.push({ end: r.periodEnd, rel: r });
  pts.sort((a, b) => t(a.end) - t(b.end));
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(t(p.end) - t(last.end)) <= 7 * DAY) {
      if (p.sec) last.sec = p.sec;
      if (p.rel) last.rel = p.rel;
      if (t(p.end) > t(last.end)) last.end = p.end;
    } else out.push({ end: p.end, sec: p.sec || null, rel: p.rel || null });
  }
  return out;
}

// The release's quarter of a cash flow line: a three-month statement, or a
// year to date less the release before (three months shorter, a quarter back).
function relCf(tl, i, key) {
  const x = tl[i] && tl[i].rel;
  if (!x || x[key] == null || !x.cfMonths) return null;
  if (Number(x.cfMonths) === 3) return num(x[key]);
  const p = tl[i - 1] && tl[i - 1].rel;
  return p && p[key] != null && Number(p.cfMonths) === Number(x.cfMonths) - 3 && gapOk(tl[i - 1].end, tl[i].end) ? num(x[key]) - num(p[key]) : null;
}
const relOcf = (tl, i) => relCf(tl, i, 'ocf');
// Free cash flow from the release: its quarter of operating cash flow less its
// quarter of capex (stored as a positive amount).
function relFcf(tl, i) {
  const o = relCf(tl, i, 'ocf'), c = relCf(tl, i, 'capex');
  return o == null || c == null ? null : o - Math.abs(c);
}

// The release figure for quarter i: restated by a later release's year-ago
// column where one exists (that release is on today's basis), else as read.
function relValue(tl, i, line) {
  const L = LINES[line];
  if (line === 'ocf') return relOcf(tl, i);
  if (line === 'fcf') return relFcf(tl, i);
  if (!L.rel) return null;
  // A release that printed only the year (CleanSpark's and Versant's fourth
  // quarter) gives no quarter, and its year-ago column is a year too.
  const later = tl.find((p) => p.rel && !p.rel.yearOnly && Math.abs((t(p.end) - t(tl[i].end)) / DAY - 364) <= 14);
  const restated = later ? L.prior(later.rel) : null;
  if (restated != null) return restated;
  return tl[i].rel && !tl[i].rel.yearOnly ? L.rel(tl[i].rel) : null;
}

// Four quarters of one line, a quarter at a time. Returns the sum, where each
// quarter came from, and the release-only sum for the two-out-of-three test.
// Lines that never swing through zero, so a quarter far from the company's
// other quarters is a wrong tag, not a bad quarter.
const STEADY = new Set(['revenue', 'grossProfit']);
function ttm(tl, four, line, fin, td) {
  const L = LINES[line];
  let sum = 0, relSum = 0, relOk = true, confirmed = false, alt = 0, disputes = 0;
  const from = [];
  // The company's other quarters on this line, either source, for the jump test.
  const seen = [];
  if (STEADY.has(line)) {
    for (let k = Math.max(0, four[0] - 4); k < tl.length; k++) {
      const v = tl[k].sec ? L.sec(tl[k].sec, fin) : null;
      const w = tl[k].rel && !tl[k].rel.yearOnly && L.rel ? L.rel(tl[k].rel) : null;
      seen.push([k, v, w]);
    }
  }
  const medianBut = (i) => {
    const xs = [];
    for (const [k, v, w] of seen) if (k !== i) { if (v != null && v > 0) xs.push(v); if (w != null && w > 0) xs.push(w); }
    xs.sort((a, b) => a - b);
    return xs.length >= 3 ? xs[xs.length >> 1] : null;
  };
  for (const i of four) {
    let s = tl[i].sec ? L.sec(tl[i].sec, fin) : null;
    let r = relValue(tl, i, line);
    // A JUMP: a quarter under a quarter of, or over four times, the company's
    // other quarters, and no release figure agreeing with it, is a wrong tag
    // (Omega Healthcare's Q1 2026 revenue $0.007B against about $0.3B, with
    // no release figure read to set beside it).
    if (STEADY.has(line)) {
      const m = medianBut(i);
      const jump = (v) => v != null && m != null && (v <= 0 || v / m < 0.25 || v / m > 4);
      if (jump(s) && !(r != null && close(s, r))) s = null;
      if (jump(r) && !(s != null && close(s, r))) r = null;
    }
    if (r == null) relOk = false; else relSum += r;
    // Confirmed: the release and the SEC data agree on one of the two newest
    // quarters, where a wrong tag would show.
    if (s != null && r != null && close(s, r) && i >= four[2]) confirmed = true;
    // A RESTATEMENT: the SEC figure comes from a filing made well after the
    // quarter's release (a later 10-Q or the 10-K recasting it: DuPont after
    // the Qnity spin-off, Becton Dickinson after Waters), not filled in from
    // an older one. It is the latest word on that quarter, and wins.
    const q = tl[i].sec, rr = tl[i].rel;
    const restated = s != null && q && rr && q.filed && rr.filed && t(q.filed) - t(rr.filed) > 45 * DAY && !(q.filledFrom && q.filledFrom[L.field(q, fin)]);
    if (restated && i >= four[2]) confirmed = true;
    // A DISPUTED quarter (the two a tenth apart, or of opposite sign) is
    // carried both ways, and Twelve Data settles it below: the release where
    // our SEC tag is wrong (Martin Marietta), the SEC data where the reader
    // dropped a minus sign (Varonis's Q3 2025 EPS read 0.26 for -0.26).
    if (s != null && (r == null || restated || !disputed(s, r))) { sum += s; alt += s; from.push('s'); }
    else if (r != null) { sum += r; from.push('r'); if (s != null) { alt += s; disputes++; } else alt += r; }
    else return { v: null, rel: relOk ? relSum : null };
  }
  if (disputes && td != null && Math.abs(alt - td) < Math.abs(sum - td)) {
    for (let k = 0; k < four.length; k++) if (from[k] === 'r' && tl[four[k]].sec && L.sec(tl[four[k]].sec, fin) != null) from[k] = 's';
    sum = alt;
  }
  return { v: sum, from, rel: relOk ? relSum : null, confirmed };
}

// The source code stored for a figure: 's' the SEC data throughout, 'r' the
// release for the newest quarter (the 10-Q not filed yet), 'm' a mix with an
// older quarter from a release, 'o' the release because the SEC figure was
// outvoted (the releases and Twelve Data agree, the SEC data with neither).
const codeOf = (from) => (from.every((x) => x === 's') ? 's' : from[from.length - 1] === 'r' ? 'r' : 'm');

// ONE COMPANY. `row` is its snapshot row as stored (Twelve Data's figures);
// `secRows` its SEC facts as db.js reads them (any order, any period types);
// `rels` its results releases (db.js erOut shape). Returns null when there is
// nothing to say, else { q: newest quarter end, f: { field: [value, code] } }.
function forCompany(row, secRows, rels, today) {
  if (!row || !row.symbol) return null;
  const now = today ? t(today) : Date.now();
  const fin = isFin(row);
  const filled = SecFacts.latestFilled(secRows || []);
  const secQ = filled.filter((r) => r.periodType === 'Q').sort((a, b) => t(a.periodEnd) - t(b.periodEnd));
  // One release a quarter, the latest filed.
  const byEnd = new Map();
  for (const r of (rels || []).filter((x) => x && x.isResults !== false && x.periodEnd).sort((a, b) => (a.filed < b.filed ? -1 : 1))) {
    const yearOnly = /year|twelve|annual/i.test(String(r.periodLabel || '')) && !/quarter|three months|q[1-4]/i.test(String(r.periodLabel || ''));
    byEnd.set(r.periodEnd, yearOnly ? Object.assign({}, r, { yearOnly: true }) : r);
  }
  const tl = timeline(secQ, [...byEnd.values()]);
  if (!tl.length) return null;
  const n = tl.length - 1, newest = tl[n];
  if ((now - t(newest.end)) / DAY > STALE_DAYS) return null;
  // Twelve Data has a newer quarter than either of ours: keep Twelve Data.
  if (row.mostRecentQuarter && t(row.mostRecentQuarter) - t(newest.end) > 7 * DAY) return null;
  const f = {};
  // TWELVE MONTHS, where the newest four quarters run in a row.
  const four = n >= 3 && gapOk(tl[n - 3].end, tl[n - 2].end) && gapOk(tl[n - 2].end, tl[n - 1].end) && gapOk(tl[n - 1].end, tl[n].end) ? [n - 3, n - 2, n - 1, n] : null;
  // THE CASH FLOW LINES' FALLBACK WINDOW (2026-10-29): a release that prints
  // no cash flow statement (Intel's for September) leaves the newest quarter
  // without one; operating and free cash flow then take the four quarters to
  // the quarter before, all filed, and say so (their own period end), rather
  // than going blank. Revenue and net income keep the newest four.
  const fourPrev = n >= 4 && gapOk(tl[n - 4].end, tl[n - 3].end) && gapOk(tl[n - 3].end, tl[n - 2].end) && gapOk(tl[n - 2].end, tl[n - 1].end) ? [n - 4, n - 3, n - 2, n - 1] : null;
  const CF_FALLBACK = new Set(['operatingCashFlowTtm', 'fcfTtm']);
  const T = {};
  if (four) {
    // A split inside the window leaves the quarters' EPS on two share counts.
    const split = row.lastSplitDate && t(row.lastSplitDate) > t(tl[n - 3].end) - 92 * DAY;
    const want = { revenueTtm: 'revenue', grossProfitTtm: 'grossProfit', operatingCashFlowTtm: 'ocf', dilutedEpsTtm: 'eps', netIncomeTtm: 'netIncome', fcfTtm: 'fcf', _op: 'opIncome' };
    for (const [field, line] of Object.entries(want)) {
      if (field === 'dilutedEpsTtm' && split) continue;
      // Operating income has no Twelve Data figure; its margin (mostly one
      // quarter's) over our revenue is near enough to settle a sign.
      // Free cash flow has none on our definition (Twelve Data's is levered):
      // its disputes take the release, and no unconfirmed test applies.
      const td = field === '_op' ? (num(row.operatingMargin) != null && T.revenueTtm ? num(row.operatingMargin) / 100 * T.revenueTtm[0] : null)
        : field === 'fcfTtm' ? null : num(row[field]);
      let x = ttm(tl, four, line, fin, td), win = null;
      if (x.v == null && CF_FALLBACK.has(field) && fourPrev) { x = ttm(tl, fourPrev, line, fin, td); win = tl[n - 1].end; }
      if (x.v == null) continue;
      // Twenty times off Twelve Data is a unit, not a company, whatever
      // agrees with it (Berkshire's EPS is per A share in its filings and
      // release alike; the B shares trade at a fifteen-hundredth of it).
      if (field !== '_op' && off20(x.v, td)) continue;
      let v = x.v, code = codeOf(x.from);
      if (x.rel != null && td != null && close(x.rel, td) && !close(v, x.rel) && !close(v, td)) { v = x.rel; code = 'o'; }
      else if (!x.confirmed && farFromTd(v, td)) continue;
      T[field] = win ? [v, code, win] : [v, code];
    }
  }
  for (const k of TTM_FIELDS) if (T[k]) f[k] = [k === 'dilutedEpsTtm' ? Math.round(T[k][0] * 100) / 100 : Math.round(T[k][0]), T[k][1]].concat(T[k][2] ? [T[k][2]] : []);
  // GROWTH: the newest quarter against the same quarter a year earlier. The
  // release's own two columns first (printed on one basis, a restatement
  // already in its year-ago figure), unless the SEC data has that quarter and
  // disputes the release's figure; then the SEC data's two quarters. A change
  // off a loss or a zero is no percentage: blank, as everywhere on the site.
  const yearAgoOf = (i) => tl.findIndex((p) => Math.abs((t(tl[i].end) - t(p.end)) / DAY - 364) <= 14);
  const growth = (line) => {
    const L = LINES[line];
    const nr = newest.rel && !newest.rel.yearOnly ? newest.rel : null;
    const ns = newest.sec ? L.sec(newest.sec, fin) : null;
    const a = nr ? L.rel(nr) : null, b = nr ? L.prior(nr) : null;
    if (a != null && b != null && !(ns != null && disputed(ns, a))) return b > 0 ? [Math.round((a / b - 1) * 10000) / 100, 'r'] : [null, 'r'];
    const y = yearAgoOf(n);
    const ys = y >= 0 && tl[y].sec ? L.sec(tl[y].sec, fin) : null;
    if (ns != null && ys != null) return ys > 0 ? [Math.round((ns / ys - 1) * 10000) / 100, 's'] : [null, 's'];
    return null;
  };
  // The release's own columns stand on their own; the SEC data's two quarters
  // only where that line's twelve months passed the checks above (a wrong tag
  // there is a wrong tag here).
  const rg = growth('revenue');
  // Beyond five hundred percent either way is a base too small to mean
  // anything (Americold's net income: a loss against a year-ago $0.1M read
  // -22,375%): not dependable, Twelve Data's is kept.
  const sane = (g) => g && (g[0] == null || Math.abs(g[0]) <= 500);
  if (sane(rg) && (rg[1] === 'r' || T.revenueTtm)) f.revenueGrowthYoY = rg;
  const eg = growth('netIncome');
  if (sane(eg) && (eg[1] === 'r' || T.netIncomeTtm)) f.earningsGrowthYoY = eg;
  // AT THE NEWEST QUARTER'S END: the SEC data's balance sheet when it is on
  // that quarter, else the release's; a line disputed by the release (a tenth
  // off) takes the release's, and an unconfirmed one far from Twelve Data's
  // own is not used.
  const s = newest.sec, r = newest.rel;
  const secB = s ? {
    cash: s.cash == null && s.shortTermInvestments == null ? null : (num(s.cash) || 0) + (num(s.shortTermInvestments) || 0),
    debt: SecFacts.totalDebt(s), equity: num(s.equity), curA: num(s.currentAssets), curL: num(s.currentLiabilities) } : null;
  const relB = r ? {
    cash: r.bsCash == null && r.bsSti == null ? null : (num(r.bsCash) || 0) + (num(r.bsSti) || 0),
    debt: r.bsDebtCur == null && r.bsDebtLt == null ? null : (num(r.bsDebtCur) || 0) + (num(r.bsDebtLt) || 0),
    equity: num(r.bsEquity), curA: num(r.bsCurAssets), curL: num(r.bsCurLiab) } : null;
  const B = {};
  // Twelve Data's own line where it has one on the same definition (cash with
  // short-term investments), for the unconfirmed test.
  const tdLine = { cash: num(row.totalCash) };
  for (const k of ['cash', 'debt', 'equity', 'curA', 'curL']) {
    const a = secB ? secB[k] : null, b = relB ? relB[k] : null;
    const ok = a != null && b != null && close(a, b);
    let pick = null;
    if (a != null && (b == null || !disputed(a, b))) pick = [a, 's', ok];
    else if (b != null) pick = [b, 'r', ok];
    if (pick && !ok && tdLine[k] != null && farFromTd(pick[0], tdLine[k])) pick = null;
    if (pick) B[k] = pick;
  }
  // Shares outstanding from the newest filing's cover page. A count more than
  // twice or under half Twelve Data's is a class filed apart (Alphabet), not
  // the company: Twelve Data's is kept.
  const cover = filled.filter((x) => x.sharesOutstanding != null && num(x.sharesOutstanding) > 0).sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : t(b.periodEnd) - t(a.periodEnd)))[0];
  const tdSh = num(row.sharesOutstanding);
  const sh = cover && (now - t(cover.periodEnd)) / DAY <= STALE_DAYS && (tdSh == null || (num(cover.sharesOutstanding) / tdSh <= 2 && num(cover.sharesOutstanding) / tdSh >= 0.5)) ? num(cover.sharesOutstanding) : null;
  const code2 = (...xs) => (xs.some((x) => x && x[1] === 'r') ? 'r' : 's');
  if (B.cash) f.totalCash = [Math.round(B.cash[0]), B.cash[1]];
  if (B.debt) f.totalDebt = [Math.round(B.debt[0]), B.debt[1]];
  if (B.cash && B.debt) f.netCash = [Math.round(B.cash[0] - B.debt[0]), code2(B.cash, B.debt)];
  if (B.debt && B.equity && B.equity[0] > 0) f.debtToEquity = [Math.round(B.debt[0] / B.equity[0] * 10000) / 100, code2(B.debt, B.equity)];   // percent, as Twelve Data gives it
  if (B.curA && B.curL && B.curL[0] > 0) f.currentRatio = [Math.round(B.curA[0] / B.curL[0] * 100) / 100, code2(B.curA, B.curL)];
  if (sh != null) f.sharesOutstanding = [Math.round(sh), 's'];
  const usd = !row.currency || row.currency === 'USD';
  // Per share and against the market value: dollar reporters only (the rule
  // for every cross-currency figure on the site; a depositary receipt's share
  // count is in another unit).
  if (usd && B.equity && sh != null) {
    const bv = B.equity[0] / sh;
    if (B.equity[2] || !farFromTd(bv, num(row.bookValuePerShare))) f.bookValuePerShare = [Math.round(bv * 100) / 100, code2(B.equity)];
  }
  // WORKED OUT. Operating margin over twelve months (Twelve Data's is mostly
  // one quarter's), in percent.
  if (T._op && T.revenueTtm && T.revenueTtm[0] > 0) f.operatingMargin = [Math.round(T._op[0] / T.revenueTtm[0] * 10000) / 100, code2(T._op, T.revenueTtm)];
  // The Signal's margins, over twelve months, each line over OUR revenue: a
  // margin is only worked out where both of its lines came through the rule
  // (free cash flow over Twelve Data's revenue where ours is not set, since
  // it has no fallback of its own).
  const rev = T.revenueTtm && T.revenueTtm[0] > 0 ? T.revenueTtm : null;
  const pctOf = (x) => Math.round(x * 10000) / 100;
  // A margin or ROE more than 25 points from Twelve Data's is a definition
  // or a tag, not a quarter's change (CVS's gross margin: 44% from a cost
  // line that is not a health insurer's cost of revenue, against 14%): not
  // dependable, Twelve Data's is kept.
  const nearTd = (k, v) => { const td = num(row[k]); return td == null || Math.abs(v - td) <= 25; };
  const setPct = (k, v, code) => { if (nearTd(k, v)) f[k] = [v, code]; };
  if (T.grossProfitTtm && rev) setPct('grossMargin', pctOf(T.grossProfitTtm[0] / rev[0]), code2(T.grossProfitTtm, rev));
  if (T.netIncomeTtm && rev) setPct('profitMargin', pctOf(T.netIncomeTtm[0] / rev[0]), code2(T.netIncomeTtm, rev));
  if (T.fcfTtm) {
    // Over revenue for the same four quarters: the fallback window's own.
    const r0 = T.fcfTtm[2] && fourPrev ? ttm(tl, fourPrev, 'revenue', fin, null).v : rev ? rev[0] : num(row.revenueTtm);
    if (r0 != null && r0 > 0) f.fcfMargin = [pctOf(T.fcfTtm[0] / r0), code2(T.fcfTtm, rev)].concat(T.fcfTtm[2] ? [T.fcfTtm[2]] : []);
  }
  // ROE: net income over twelve months against the average of equity now and
  // a year earlier (the newest equity alone where the year-ago one is not
  // filed). Negative equity gives no ROE.
  if (T.netIncomeTtm && B.equity && B.equity[0] > 0) {
    const y = yearAgoOf(n);
    const ye = y >= 0 ? (tl[y].sec && num(tl[y].sec.equity) != null ? num(tl[y].sec.equity) : tl[y].rel ? num(tl[y].rel.bsEquity) : null) : null;
    const avg = ye != null && ye > 0 ? (B.equity[0] + ye) / 2 : B.equity[0];
    setPct('roe', pctOf(T.netIncomeTtm[0] / avg), code2(T.netIncomeTtm, B.equity));
  }
  const cap = num(row.marketCap);
  if (usd && cap > 0 && T.fcfTtm) f.fcfYield = [pctOf(T.fcfTtm[0] / cap), T.fcfTtm[1]].concat(T.fcfTtm[2] ? [T.fcfTtm[2]] : []);
  if (usd && cap > 0) {
    if (T.revenueTtm && T.revenueTtm[0] > 0) f.priceToSales = [Math.round(cap / T.revenueTtm[0] * 100) / 100, T.revenueTtm[1]];
    if (B.equity && B.equity[0] > 0) f.priceToBook = [Math.round(cap / B.equity[0] * 100) / 100, B.equity[1]];
    if (B.cash && B.debt) {
      const ev = cap + B.debt[0] - B.cash[0];
      f.enterpriseValue = [Math.round(ev), code2(B.cash, B.debt)];
      // Over Twelve Data's EBITDA (see TTM_FIELDS).
      const eb = num(row.ebitda);
      if (ev > 0 && eb != null && eb > 0) f.evToEbitda = [Math.round(ev / eb * 100) / 100, code2(B.cash, B.debt)];
      f.netCashPct = [Math.round((B.cash[0] - B.debt[0]) / cap * 10000) / 100, code2(B.cash, B.debt)];
    }
  }
  return Object.keys(f).length ? { q: newest.end, f } : null;
}

// THE WHOLE UNIVERSE (or `symbols` only, merged into what is stored). `facts`
// may be handed in by a caller that already holds them (marginChangeBuild).
async function build(store, opts = {}) {
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const snap = opts.snap || await store.readSnapshot();
  const rowsBy = {};
  for (const r of ((snap && snap.stocks) || [])) if (r && r.symbol && !r.error && r.instrumentType !== 'ETF') rowsBy[String(r.symbol).toUpperCase()] = r;
  const want = (opts.symbols ? opts.symbols.map((s) => String(s).toUpperCase()) : Object.keys(rowsBy)).filter((s) => rowsBy[s]);
  const secSince = new Date(Date.now() - SEC_SINCE_DAYS * DAY).toISOString().slice(0, 10);
  const facts = opts.facts || await store.readSecFactsSince(want, secSince);
  const relSince = new Date(Date.now() - REL_SINCE_DAYS * DAY).toISOString().slice(0, 10);
  const rels = await store.readReleaseFiguresSince(relSince);
  const relBy = new Map();
  for (const r of rels) { const k = String(r.symbol).toUpperCase(); if (!relBy.has(k)) relBy.set(k, []); relBy.get(k).push(r); }
  const prev = opts.symbols ? await store.readFigure('sourced').catch(() => null) : null;
  const s = prev && prev.v === V && prev.s ? prev.s : {};
  let built = 0;
  for (const sym of want) {
    try {
      const sec = (facts.get(sym) || []).filter((x) => String(x.periodEnd) >= secSince);
      const e = forCompany(rowsBy[sym], sec, relBy.get(sym) || [], today);
      if (e) { s[sym] = e; built++; } else delete s[sym];
    } catch (err) { /* one company never stops the build; what was stored stays */ }
  }
  // Companies that have left the screener drop out: the figure is derived,
  // and everything it was built from is kept.
  for (const k of Object.keys(s)) if (!rowsBy[k]) delete s[k];
  if (!opts.dry && (built || opts.symbols)) await store.writeFigures({ sourced: { v: V, at: Date.now(), s } });
  const used = { s: 0, r: 0, m: 0, o: 0 };
  for (const e of Object.values(s)) for (const x of Object.values(e.f)) used[x[1]] = (used[x[1]] || 0) + 1;
  return { built, companies: Object.keys(s).length, asked: want.length, used, ms: Date.now() - t0 };
}

// STAMP ONE ROW (the way out). Idempotent: Twelve Data's own figures are kept
// once in `srcTd` and every later stamp reads them from there, so a row held
// in a shared cache and stamped twice still knows what Twelve Data said. The
// fields with no Twelve Data fallback are blanked where we have no figure.
function apply(row, entry) {
  if (!row || row.error) return;
  if (!row.srcTd) {
    const o = {};
    for (const k of FIELDS) o[k] = row[k] == null ? null : row[k];
    row.srcTd = o;
  }
  const src = {}, qs = {};
  for (const k of FIELDS) {
    const x = entry && entry.f ? entry.f[k] : null;
    if (x) { row[k] = x[0] == null ? null : x[0]; src[k] = x[1]; if (x[2]) qs[k] = x[2]; }
    else if (NO_TD.has(k) && entry) { row[k] = null; src[k] = 'n'; }
    else row[k] = row.srcTd[k];
  }
  row.src = entry ? src : null;
  row.srcQ = entry ? entry.q : null;
  // A field on its own, older window (the cash flow fallback): its end.
  row.srcQs = entry && Object.keys(qs).length ? qs : null;
}
// Twelve Data's own figures back on the row, and the marks gone: what the
// stored snapshot keeps (computeStocks, after the Signal is scored).
function restore(row) {
  if (!row || !row.srcTd) return;
  Object.assign(row, row.srcTd);
  delete row.srcTd; delete row.src; delete row.srcQ; delete row.srcQs;
}

module.exports = { V, FIELDS, TTM_FIELDS, GROWTH_FIELDS, QE_FIELDS, DERIVED, NO_TD, SIGNAL_SET, SIGNAL_KEPT, forCompany, build, apply, restore, timeline, SEC_SINCE_DAYS, REL_SINCE_DAYS };
