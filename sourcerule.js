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
// DISPLAY ONLY. Every field written here is one the Signal does not read
// (action.js reads market cap, forward P/E, net income, profit and gross
// margin, free cash flow and its margin, ROE, revenue and earnings growth,
// short % of float and Quality). Those stay on Twelve Data until the owner
// decides the Signal. sourcerule-test.js proves the boundary by scoring with
// and without this stamp.
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
// shows a dash where neither the release nor the SEC data gives the lines.
//
// Built whole on the daily filings pass (marginChangeBuild, which already
// holds every company's filings), and for the companies that just reported by
// release-load.js after each run. Stored as the figure `sourced`; stamped on
// the way out (stampSources in server.js), on copies of the rows the stored
// snapshot is never written from.
const SecFacts = require('./secfacts.js');

const V = 1;
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
const gapOk = (a, b) => { const g = (t(b) - t(a)) / DAY; return g >= 75 && g <= 105; };
const STALE_DAYS = 200;      // a newest quarter older than this is not current
const SEC_SINCE_DAYS = 800;  // two years of quarters, and the year before for a restated year-ago
const REL_SINCE_DAYS = 480;  // five releases: four quarters and one before for a year-to-date cash flow

// The fields written, by kind. TTM: four quarters summed; QE: at the newest
// quarter's end; the rest are worked out from those and today's market value.
// EBITDA is not on the list: ours (operating income plus depreciation) agreed
// with Twelve Data's for 20% of companies on the same quarter, which leaves
// impairments out (EchoStar -$15.6B against $2.2B). Another definition.
const TTM_FIELDS = ['revenueTtm', 'grossProfitTtm', 'operatingCashFlowTtm', 'dilutedEpsTtm'];
const QE_FIELDS = ['totalCash', 'totalDebt', 'netCash', 'debtToEquity', 'currentRatio', 'bookValuePerShare', 'sharesOutstanding'];
const DERIVED = ['operatingMargin', 'priceToSales', 'priceToBook', 'enterpriseValue', 'evToEbitda', 'netCashPct'];
const FIELDS = [...TTM_FIELDS, ...QE_FIELDS, ...DERIVED];
// Twelve Data's figure is on another definition: no fallback.
const NO_TD = new Set(['totalDebt', 'netCash', 'debtToEquity', 'enterpriseValue', 'evToEbitda', 'netCashPct']);
// Never a Signal input; sourcerule-test.js checks this list against action.js's.
const SIGNAL_INPUTS = ['marketCap', 'forwardPe', 'netIncomeTtm', 'profitMargin', 'fcfTtm', 'fcfMargin', 'roe',
  'qualityRating', 'revenueGrowthYoY', 'earningsGrowthYoY', 'grossMargin', 'shortPctFloat'];

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

// The release's quarter of operating cash flow: a three-month statement, or a
// year to date less the release before (three months shorter, a quarter back).
function relOcf(tl, i) {
  const x = tl[i] && tl[i].rel;
  if (!x || x.ocf == null || !x.cfMonths) return null;
  if (Number(x.cfMonths) === 3) return num(x.ocf);
  const p = tl[i - 1] && tl[i - 1].rel;
  return p && p.ocf != null && Number(p.cfMonths) === Number(x.cfMonths) - 3 && gapOk(tl[i - 1].end, tl[i].end) ? num(x.ocf) - num(p.ocf) : null;
}

// The release figure for quarter i: restated by a later release's year-ago
// column where one exists (that release is on today's basis), else as read.
function relValue(tl, i, line) {
  const L = LINES[line];
  if (line === 'ocf') return relOcf(tl, i);
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
  const T = {};
  if (four) {
    // A split inside the window leaves the quarters' EPS on two share counts.
    const split = row.lastSplitDate && t(row.lastSplitDate) > t(tl[n - 3].end) - 92 * DAY;
    const want = { revenueTtm: 'revenue', grossProfitTtm: 'grossProfit', operatingCashFlowTtm: 'ocf', dilutedEpsTtm: 'eps', _op: 'opIncome' };
    for (const [field, line] of Object.entries(want)) {
      if (field === 'dilutedEpsTtm' && split) continue;
      // Operating income has no Twelve Data figure; its margin (mostly one
      // quarter's) over our revenue is near enough to settle a sign.
      const td = field === '_op' ? (num(row.operatingMargin) != null && T.revenueTtm ? num(row.operatingMargin) / 100 * T.revenueTtm[0] : null) : num(row[field]);
      const x = ttm(tl, four, line, fin, td);
      if (x.v == null) continue;
      // Twenty times off Twelve Data is a unit, not a company, whatever
      // agrees with it (Berkshire's EPS is per A share in its filings and
      // release alike; the B shares trade at a fifteen-hundredth of it).
      if (field !== '_op' && off20(x.v, td)) continue;
      let v = x.v, code = codeOf(x.from);
      if (x.rel != null && td != null && close(x.rel, td) && !close(v, x.rel) && !close(v, td)) { v = x.rel; code = 'o'; }
      else if (!x.confirmed && farFromTd(v, td)) continue;
      T[field] = [v, code];
    }
  }
  for (const k of TTM_FIELDS) if (T[k]) f[k] = [k === 'dilutedEpsTtm' ? Math.round(T[k][0] * 100) / 100 : Math.round(T[k][0]), T[k][1]];
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
  const cap = num(row.marketCap);
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
  const src = {};
  for (const k of FIELDS) {
    const x = entry && entry.f ? entry.f[k] : null;
    if (x) { row[k] = x[0]; src[k] = x[1]; }
    else if (NO_TD.has(k) && entry) { row[k] = null; src[k] = 'n'; }
    else row[k] = row.srcTd[k];
  }
  row.src = entry ? src : null;
  row.srcQ = entry ? entry.q : null;
}

module.exports = { V, FIELDS, TTM_FIELDS, QE_FIELDS, DERIVED, NO_TD, SIGNAL_INPUTS, forCompany, build, apply, timeline, SEC_SINCE_DAYS, REL_SINCE_DAYS };
