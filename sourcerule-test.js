// The owner's source rule (sourcerule.js): one case per decision it makes, and
// the Signal boundary proven by scoring, not by grep. No database, no network.
//   node sourcerule-test.js
const S = require('./sourcerule.js');
const Action = require('./private/action.js');
require('./private/rowcard.js');
const RowCard = globalThis.RowCard;

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

const TODAY = '2026-10-29';
const ENDS = ['2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'];
// SEC quarter rows as db.js reads them (camelCase), one filing each.
const sec = (end, o, filed) => Object.assign({ symbol: 'TST', accn: 'a-' + end + '-' + (filed || ''), form: '10-Q', filed: filed || end.replace(/-(\d\d)-\d\d$/, (m, mm) => '-' + String(Math.min(12, Number(mm) + 1)).padStart(2, '0') + '-05'), periodType: 'Q', periodEnd: end }, o);
const rel = (end, o, filed) => Object.assign({ symbol: 'TST', isResults: true, periodEnd: end, filed: filed || end.replace(/-(\d\d)-\d\d$/, (m, mm) => '-' + String(Math.min(12, Number(mm) + 1)).padStart(2, '0') + '-01') }, o);
const row = (o) => Object.assign({ symbol: 'TST', currency: 'USD', sector: 'Technology', marketCap: 100e9, mostRecentQuarter: '2026-06-30' }, o);

// 1. All four quarters in the SEC data, confirmed by the releases: SEC, summed.
{
  const q = [1e9, 1.1e9, 1.2e9, 1.3e9];
  const s = ENDS.slice(1, 5).map((e, i) => sec(e, { revenue: q[i], operatingIncome: q[i] / 5, epsDiluted: 0.5, cash: 2e9, equity: 10e9, currentAssets: 4e9, currentLiabilities: 2e9, debtCurrent: 1e9, ltdNoncurrent: 3e9 }));
  const r = ENDS.slice(1, 5).map((e, i) => rel(e, { revenue: q[i], opIncome: q[i] / 5, epsGaap: 0.5 }));
  const e = S.forCompany(row({ revenueTtm: 4.5e9 }), s, r, TODAY);
  eq(e && e.f.revenueTtm, [4.6e9, 's'], 'four SEC quarters summed');
  eq(e.f.dilutedEpsTtm, [2, 's'], 'EPS summed');
  eq(e.f.operatingMargin, [20, 's'], 'operating margin over twelve months');
  eq(e.f.totalDebt, [4e9, 's'], 'total debt: DebtCurrent plus long-term noncurrent');
  eq(e.f.netCash, [-2e9, 's'], 'net cash');
  eq(e.f.debtToEquity, [40, 's'], 'debt to equity in percent, as Twelve Data gives it');
  eq(e.f.currentRatio, [2, 's'], 'current ratio');
  eq(e.f.priceToSales, [Math.round(100e9 / 4.6e9 * 100) / 100, 's'], 'P/S over our revenue');
  eq(e.f.enterpriseValue, [102e9, 's'], 'EV = cap + debt - cash');
  eq(e.q, '2026-06-30', 'newest quarter');
}
// 2. The release is newest (the 10-Q not filed yet): its quarter is used.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 1e9 }));
  const r = ENDS.slice(2, 6).map((e) => rel(e, { revenue: 1e9 }));
  r[3].revenue = 1.5e9;
  const e = S.forCompany(row({ revenueTtm: 4e9 }), s, r, TODAY);
  eq(e && e.f.revenueTtm, [4.5e9, 'r'], 'the release supplies the newest quarter');
  eq(e.q, '2026-09-30', 'newest quarter is the release’s');
}
// 3. Twelve Data already has a newer quarter than ours: nothing is set.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 1e9 }));
  eq(S.forCompany(row({ mostRecentQuarter: '2026-09-30', revenueTtm: 4e9 }), s, [], TODAY), null, 'Twelve Data newer: kept');
}
// 4. A disputed quarter, settled by Twelve Data both ways.
{
  // Martin Marietta: the SEC tag is wrong, the release and Twelve Data agree.
  const s = ENDS.slice(1, 5).map((e) => sec(e, { epsDiluted: 4 }));
  s[2].epsDiluted = 25.06;
  const r = ENDS.slice(1, 5).map((e) => rel(e, { epsGaap: 4 }));
  r[2].epsGaap = 1.31;
  const e = S.forCompany(row({ dilutedEpsTtm: 13.3 }), s, r, TODAY);
  eq(e && e.f.dilutedEpsTtm && e.f.dilutedEpsTtm[0], 13.31, 'disputed: the release where the SEC tag is wrong');
  // Varonis: the reader dropped a minus sign; the SEC data and Twelve Data agree.
  const s2 = ENDS.slice(1, 5).map((e) => sec(e, { epsDiluted: -0.3 }));
  const r2 = ENDS.slice(1, 5).map((e) => rel(e, { epsGaap: -0.3 }));
  r2[0].epsGaap = 0.3; r2[3].epsGaap = 0.3;
  const e2 = S.forCompany(row({ dilutedEpsTtm: -1.2 }), s2, r2, TODAY);
  eq(e2 && e2.f.dilutedEpsTtm, [-1.2, 's'], 'disputed: the SEC data where the release lost a sign');
}
// 5. A restatement: the SEC figure from a filing well after the release wins.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 1.75e9 }));
  s[0] = sec(ENDS[1], { revenue: 1.8e9 }, '2026-02-17');   // recast in the 10-K after a spin-off
  const r = ENDS.slice(1, 5).map((e) => rel(e, { revenue: 1.75e9 }));
  r[0].revenue = 3.07e9;                                     // the original, before the spin-off
  // No Twelve Data figure, so nothing settles a dispute: only the filing date can.
  const e = S.forCompany(row({ revenueTtm: null }), s, r, TODAY);
  eq(e && e.f.revenueTtm, [7.05e9, 's'], 'restated in a later filing: the SEC figure');
}
// 6. A release that printed only the year gives no quarter.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { revenue: null }));
  const r = ENDS.slice(1, 5).map((e) => rel(e, { revenue: 0.18e9 }));
  // 3.3 times a quarter, under the jump test's bound, so only the label can tell.
  r[1] = rel(ENDS[2], { revenue: 0.6e9, periodLabel: 'Fiscal Year 2025' });
  const e = S.forCompany(row({ revenueTtm: null }), s, r, TODAY);
  ok(!(e && e.f.revenueTtm), 'a year-only release is not a quarter');
}
// 7. A jump: a quarter far below the company's others, unconfirmed, is not used.
{
  const s = ENDS.map((e) => sec(e, { revenue: 0.3e9 }));
  s[4].revenue = 0.007e9;
  const e = S.forCompany(row({ revenueTtm: 1.2e9 }), s.slice(0, 5), [], TODAY);
  ok(!(e && e.f.revenueTtm), 'a quarter a fortieth of the others is a wrong tag');
}
// 8. Unconfirmed and far from Twelve Data: not used; confirmed: used.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 0.4e9 }));
  const e = S.forCompany(row({ revenueTtm: 15e9 }), s, [], TODAY);
  ok(!(e && e.f.revenueTtm), 'unconfirmed and far from Twelve Data (CNA): Twelve Data kept');
  const r = ENDS.slice(1, 5).map((e) => rel(e, { revenue: 0.4e9 }));
  const e2 = S.forCompany(row({ revenueTtm: 0.45e9 * 4 / 3 }), s, r, TODAY);
  eq(e2 && e2.f.revenueTtm, [1.6e9, 's'], 'confirmed by the release: used though Twelve Data differs');
}
// 9. Twenty times off Twelve Data is a unit (Berkshire's per-A-share EPS), even confirmed.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { epsDiluted: 8000 }));
  const r = ENDS.slice(1, 5).map((e) => rel(e, { epsGaap: 8000 }));
  const e = S.forCompany(row({ dilutedEpsTtm: 21 }), s, r, TODAY);
  ok(!(e && e.f.dilutedEpsTtm), 'per-A-share EPS is not the B share’s');
}
// 10. Banks: net revenue where filed.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 1e9, netRevenue: 4e9 }));
  const e = S.forCompany(row({ sector: 'Financial Services', revenueTtm: 16e9 }), s, [], TODAY);
  eq(e && e.f.revenueTtm, [16e9, 's'], 'a bank’s revenue is its net revenue');
}
// 11. A split inside the window: no EPS sum.
{
  const s = ENDS.slice(1, 5).map((e) => sec(e, { epsDiluted: 1 }));
  const e = S.forCompany(row({ dilutedEpsTtm: 4, lastSplitDate: '2026-01-15' }), s, [], TODAY);
  ok(!(e && e.f.dilutedEpsTtm), 'split inside the four quarters: EPS left to Twelve Data');
}
// 12. The release's operating cash flow from year-to-date statements.
{
  const r = [rel(ENDS[1], { ocf: 3, cfMonths: 9 }), rel(ENDS[2], { ocf: 5, cfMonths: 12 }), rel(ENDS[3], { ocf: 1, cfMonths: 3 }), rel(ENDS[4], { ocf: 2.5, cfMonths: 6 }), rel(ENDS[0], { ocf: 1.8, cfMonths: 6 })];
  const e = S.forCompany(row({ operatingCashFlowTtm: null }), [], r, TODAY);
  eq(e && e.f.operatingCashFlowTtm, [Math.round(1.2 + 2 + 1 + 1.5), 'r'], 'quarters of operating cash flow from year-to-date statements');
}

// THE STAMP. Twelve Data's own figures kept once; idempotent; the debt family
// blank without our figure; a row with no entry left as it was.
{
  const r = { symbol: 'TST', revenueTtm: 10, totalDebt: 7, netCash: 3, sharesOutstanding: 5 };
  const entry = { q: '2026-09-30', f: { revenueTtm: [12, 'r'] } };
  S.apply(r, entry);
  eq([r.revenueTtm, r.totalDebt, r.netCash, r.sharesOutstanding], [12, null, null, 5], 'stamped: ours, the debt family blank, the rest Twelve Data’s');
  eq([r.src.revenueTtm, r.src.totalDebt, r.srcTd.revenueTtm, r.srcTd.totalDebt], ['r', 'n', 10, 7], 'source codes and Twelve Data’s figures kept');
  S.apply(r, entry);
  eq([r.revenueTtm, r.srcTd.revenueTtm, r.srcTd.totalDebt], [12, 10, 7], 'stamping twice reads Twelve Data’s from srcTd');
  S.apply(r, null);
  eq([r.revenueTtm, r.totalDebt, r.src], [10, 7, null], 'no entry: Twelve Data’s figures back');
  ok(/results release/.test(RowCard.srcNote(Object.assign({}, r, { src: { revenueTtm: 'r' }, srcQ: '2026-09-30' }), 'revenueTtm')), 'the hover names the release');
  eq(RowCard.srcNote({ revenueTtm: 1 }, 'revenueTtm'), '', 'no source: no hover text of ours');
}

// THE SIGNAL'S INPUTS (the owner, 2026-10-29: "just rebuild signal").
// 13. Net income, free cash flow (operating cash flow less capex), the margins,
// ROE on average equity, and growth from the release's own two columns.
{
  const s4 = ENDS.slice(1, 5).map((e, i) => sec(e, { revenue: 10e9, grossProfit: 4e9, netIncome: 1e9, operatingCashFlow: 2e9, capex: -0.5e9, equity: 20e9 }));
  s4.unshift(sec(ENDS[0], { revenue: 9e9, netIncome: 0.8e9, equity: 18e9 }));
  const r4 = ENDS.slice(1, 5).map((e) => rel(e, { revenue: 10e9, revenuePrior: 8e9, netIncome: 1e9, netIncomePrior: 0.8e9 }));
  const e = S.forCompany(row({ revenueTtm: 40e9, netIncomeTtm: 4e9, grossMargin: 41, profitMargin: 9, roe: 21, revenueGrowthYoY: 20, earningsGrowthYoY: 20 }), s4, r4, TODAY);
  eq(e && e.f.netIncomeTtm, [4e9, 's'], 'net income over four quarters');
  eq(e.f.fcfTtm, [6e9, 's'], 'free cash flow is operating cash flow less capex');
  eq([e.f.grossMargin, e.f.profitMargin, e.f.fcfMargin], [[40, 's'], [10, 's'], [15, 's']], 'the margins over our revenue');
  eq(e.f.roe, [Math.round(4e9 / ((20e9 + 18e9) / 2) * 10000) / 100, 's'], 'ROE on average equity, now (0B) and a year earlier (8B)');
  eq([e.f.revenueGrowthYoY, e.f.earningsGrowthYoY], [[25, 'r'], [25, 'r']], 'growth from the release\u2019s own two columns');
  eq(e.f.fcfYield, [6, 's'], 'FCF yield over market value');
}
// 14. Growth off a loss is no percentage; past five hundred is not dependable.
{
  const s5 = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 1e9, netIncome: 0.1e9 }));
  const r5 = ENDS.slice(1, 5).map((e) => rel(e, { revenue: 1e9, revenuePrior: 1e9, netIncome: 0.1e9, netIncomePrior: -0.05e9 }));
  const e = S.forCompany(row({ revenueTtm: 4e9, netIncomeTtm: 0.4e9, earningsGrowthYoY: 30 }), s5, r5, TODAY);
  eq(e && e.f.earningsGrowthYoY, [null, 'r'], 'earnings growth off a year-ago loss: blank');
  const r6 = r5.map((x) => Object.assign({}, x, { netIncomePrior: 0.0001e9 }));
  const e6 = S.forCompany(row({ revenueTtm: 4e9, netIncomeTtm: 0.4e9, earningsGrowthYoY: 30 }), s5, r6, TODAY);
  ok(e6 && !e6.f.earningsGrowthYoY, 'earnings growth of 99,900% off a tiny base: Twelve Data\u2019s kept');
}
// 15. A margin 25 points from Twelve Data's is a definition (CVS's gross margin).
{
  const s7 = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 10e9, grossProfit: 4.5e9 }));
  const r7 = ENDS.slice(1, 5).map((e) => rel(e, { revenue: 10e9, grossProfit: 4.5e9 }));
  const e = S.forCompany(row({ revenueTtm: 40e9, grossProfitTtm: 18e9, grossMargin: 14 }), s7, r7, TODAY);
  ok(e && e.f.grossProfitTtm && !e.f.grossMargin, 'gross margin 45% against Twelve Data\u2019s 14%: Twelve Data\u2019s kept');
}
// 16. No cash flow lines: free cash flow blank, never Twelve Data's levered one.
{
  const s8 = ENDS.slice(1, 5).map((e) => sec(e, { revenue: 1e9 }));
  const e = S.forCompany(row({ revenueTtm: 4e9, fcfTtm: 0.7e9, fcfMargin: 17 }), s8, [], TODAY);
  const r = row({ revenueTtm: 4e9, fcfTtm: 0.7e9, fcfMargin: 17 });
  S.apply(r, e);
  eq([r.fcfTtm, r.fcfMargin, r.src.fcfTtm], [null, null, 'n'], 'no cash flow lines: free cash flow blank, marked');
}
// 17. restore(): what the stored snapshot keeps is Twelve Data's own.
{
  const r = row({ netIncomeTtm: 5, revenueTtm: 10, grossMargin: 30 });
  S.apply(r, { q: '2026-09-30', f: { netIncomeTtm: [7, 'r'], revenueTtm: [12, 'r'] } });
  S.restore(r);
  eq([r.netIncomeTtm, r.revenueTtm, r.grossMargin, 'srcTd' in r, 'src' in r], [5, 10, 30, false, false], 'restored: Twelve Data\u2019s figures, no marks');
}

// THE SIGNAL, BEHAVIOURALLY. Real-shaped rows (the legacy snapshot backup),
// all six words among them. The rule's Signal inputs MOVE the verdict (lying
// values change it); the display-only fields never do; market value, forward
// P/E and short % of float are never touched.
{
  for (const k of S.SIGNAL_SET) ok(S.FIELDS.includes(k), 'a Signal input on the rule: ' + k);
  for (const k of S.SIGNAL_KEPT) ok(!S.FIELDS.includes(k), 'kept Twelve Data\u2019s: ' + k);
  let rows = [];
  try { rows = (require('./snapshot.json').stocks || []).filter((x) => x && x.symbol && !x.error); } catch (e) { rows = []; }
  ok(rows.length >= 40, 'real-shaped rows to score (' + rows.length + ')');
  const cfg = (() => { const { cfg } = Action.resolve(null, 'Balanced'); cfg.__resolved = true; return cfg; })();
  const verdicts = (list) => Action.apply(list, cfg).map((x) => (x ? JSON.stringify([x.action, x.flag, x.fund, x.type, x.estScore]) : null));
  const base = rows.map((r) => Object.assign({}, r));
  const v0 = verdicts(base);
  ok(v0.filter(Boolean).length >= 40 && new Set(Action.apply(base, cfg).filter(Boolean).map((x) => x.action)).size === 6, 'verdicts were scored, all six words among them');
  const display = S.FIELDS.filter((k) => !S.SIGNAL_SET.includes(k));
  const lie = (keys) => rows.map((r, i) => { const o = Object.assign({}, r); S.apply(o, { q: '2026-06-30', f: Object.fromEntries(keys.map((k, j) => [k, [((i * 7 + j) % 2 ? -1 : 1) * 1e15, 'o']])) }); return o; });
  const lyingDisplay = lie(display);
  // apply() blanks the no-fallback fields it is not given, two of them Signal
  // inputs (free cash flow and its margin): hand those back for this check.
  for (let i = 0; i < rows.length; i++) for (const k of S.SIGNAL_SET) lyingDisplay[i][k] = base[i][k];
  eq(verdicts(lyingDisplay), v0, 'display-only fields lying: verdicts unmoved');
  const truth = rows.map((r) => { const o = Object.assign({}, r); S.apply(o, { q: '2026-06-30', f: Object.fromEntries(S.SIGNAL_SET.map((k) => [k, [r[k] == null ? null : Number(r[k]), 's']])) }); return o; });
  eq(verdicts(truth), v0, 'the rule giving the same inputs: the same verdicts');
  const moved = verdicts(lie(S.SIGNAL_SET)).filter((v, i) => v !== v0[i]).length;
  ok(moved >= 10, 'the rule\u2019s Signal inputs lying: verdicts move (' + moved + ' of ' + rows.length + ')');
  const lyingAll = lie(S.FIELDS);
  for (const k of S.SIGNAL_KEPT) ok(lyingAll.every((o, i) => JSON.stringify(o[k]) === JSON.stringify(base[i][k])), 'never touched: ' + k);
}

// THE RELEASE'S QUARTER IN THE DRILL-DOWN HISTORY (2026-11-05, Reddit's margin
// chart a quarter behind the cell): newestReleaseQuarter, then drillhist.
{
  const DH = require('./drillhist.js');
  const rev = [1e9, 1.1e9, 1.2e9, 1.3e9, 1.4e9];
  const ni = [1e8, 1.1e8, 1.2e8, 1.3e8, 2.8e8];
  // Four quarters filed to June 2026 (and one before), the September release newer.
  const startOf = (e) => { const d = new Date(e + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 3); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const s = ENDS.slice(0, 5).map((e, i) => sec(e, { periodStart: startOf(e), revenue: rev[i], netIncome: ni[i], operatingCashFlow: 2e8, capex: 5e7 }));
  const r = [rel('2026-06-30', { revenue: rev[4], netIncome: ni[4], cfMonths: 6, ocf: 4e8, capex: 1e8 }),
    rel('2026-09-30', { revenue: 1.5e9, netIncome: 3e8, cfMonths: 9, ocf: 6.5e8, capex: 1.6e8, currency: 'USD' }, '2026-10-29')];
  const q = S.newestReleaseQuarter(s, r);
  ok(q && q.fromRelease && q.periodEnd === '2026-09-30' && q.periodStart === '2026-07-01' && q.filed === '2026-10-29', 'release quarter: the September quarter, starting the day after the filed one');
  eq([q.revenue, q.netIncome, q.operatingCashFlow, q.freeCashFlow], [1.5e9, 3e8, 2.5e8, 1.9e8], 'release quarter: figures, the cash flow a nine-month year to date less the six-month');
  ok(!('grossProfit' in q), 'release quarter: a figure the release does not give is left out, not zero');
  ok(S.newestReleaseQuarter(s.concat([sec('2026-09-30', { revenue: 1.5e9 })]), r) === null, 'release quarter: none once the SEC data has the quarter');
  ok(S.newestReleaseQuarter(s, [rel('2026-09-30', { revenue: 1.5e9, currency: 'EUR' })]) === null, 'release quarter: none for a release not in dollars');
  ok(S.newestReleaseQuarter(s.slice(0, 3), r) === null, 'release quarter: none when it would leave a hole after the filed quarters');
  ok(S.newestReleaseQuarter(s, [rel('2026-09-30', { revenue: 6e9, periodLabel: 'Fiscal year 2026' })]) === null, 'release quarter: none from a year-only release');
  ok(S.newestReleaseQuarter([], r) === null && S.newestReleaseQuarter(s, []) === null, 'release quarter: none without both sources');
  // The drill-down: the newest point is the release quarter plus three filed ones.
  const pm = DH.build('profitMargin', { facts: s, releaseQuarter: q });
  const last = pm.points[pm.points.length - 1];
  ok(last.d === '2026-09-30' && last.rel === true && last.v === Math.round((3e8 + 2.8e8 + 1.3e8 + 1.2e8) / (1.5e9 + 1.4e9 + 1.3e9 + 1.2e9) * 10000) / 100, 'drill: the newest margin point is the release quarter with three filed', last);
  ok(!pm.points[pm.points.length - 2].rel, 'drill: the filed points stay unmarked');
  eq(pm.rows[0].slice(0, 2), ['Sep 2026 · release', 20], 'drill: the table names the release quarter');
  ok(pm.source === 'SEC filings and the results release' && /results release of 29 Oct 2026/.test(pm.note) && pm.release.periodEnd === '2026-09-30', 'drill: source and note say so');
  const gm = DH.build('grossMargin', { facts: s, releaseQuarter: q });
  ok(gm.source === 'SEC filings' && !gm.release && !gm.points.some((p) => p.rel), 'drill: a measure the release lacks is drawn as filed and says so');
  const plain = DH.build('profitMargin', { facts: s, releaseQuarter: null });
  ok(plain.source === 'SEC filings' && plain.points[plain.points.length - 1].d === '2026-06-30', 'drill: no release quarter, as before');
  const old = DH.build('revenueTtm', { facts: s, releaseQuarter: Object.assign({}, q, { periodEnd: '2026-06-30' }) });
  ok(!old.release && old.points[old.points.length - 1].d === '2026-06-30', 'drill: a release quarter not newer than the filings is ignored');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
