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

// THE SIGNAL BOUNDARY, BEHAVIOURALLY. Real-shaped rows (the legacy snapshot
// backup), scored with every field the rule writes absent, present and lying;
// the verdicts must not move. And the written fields are none of the Signal's.
{
  for (const k of S.FIELDS) ok(!S.SIGNAL_INPUTS.includes(k), 'not a Signal input: ' + k);
  let rows = [];
  try { rows = (require('./snapshot.json').stocks || []).filter((x) => x && x.symbol && !x.error); } catch (e) { rows = []; }
  ok(rows.length >= 40, 'real-shaped rows to score (' + rows.length + ')');
  const cfg = (() => { const { cfg } = Action.resolve(null, 'Balanced'); cfg.__resolved = true; return cfg; })();
  const verdicts = (list) => Action.apply(list, cfg).map((x) => (x ? JSON.stringify([x.action, x.flag, x.fund, x.type, x.estScore]) : null));
  const base = rows.map((r) => Object.assign({}, r));
  const absent = rows.map((r) => { const o = Object.assign({}, r); for (const k of S.FIELDS) delete o[k]; return o; });
  const present = rows.map((r) => { const o = Object.assign({}, r); S.apply(o, { q: '2026-06-30', f: Object.fromEntries(S.FIELDS.map((k) => [k, [Number(r[k]) || 1, 's']])) }); return o; });
  const lying = rows.map((r, i) => { const o = Object.assign({}, r); S.apply(o, { q: '2026-06-30', f: Object.fromEntries(S.FIELDS.map((k, j) => [k, [((i * 7 + j) % 2 ? -1 : 1) * 1e15, 'o']])) }); return o; });
  const v0 = verdicts(base);
  ok(v0.filter(Boolean).length >= 40 && new Set(Action.apply(base, cfg).filter(Boolean).map((x) => x.action)).size === 6, 'verdicts were scored, all six words among them');
  eq(verdicts(absent), v0, 'verdicts with the fields absent');
  eq(verdicts(present), v0, 'verdicts with the fields stamped');
  eq(verdicts(lying), v0, 'verdicts with the fields lying');
  for (const k of S.SIGNAL_INPUTS) ok(lying.every((o, i) => JSON.stringify(o[k]) === JSON.stringify(base[i][k])), 'stamp leaves the Signal input alone: ' + k);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
