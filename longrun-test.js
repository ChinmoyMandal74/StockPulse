// The long-run figures (longrun.js), held to their brief.
//
//   node longrun-test.js
//
// Pure: planted filing rows in the shape SecFacts.latestFilled returns, no
// database and no server.
'use strict';
const LR = require('./longrun.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}
const near = (a, b, tol = 0.02) => a != null && b != null && Math.abs(a - b) <= tol;

// Quarter ends from 2019 Q1 to 2026 Q2, calendar quarters.
const ENDS = [];
for (let y = 2019; y <= 2026; y++) for (const md of ['03-31', '06-30', '09-30', '12-31']) ENDS.push(y + '-' + md);
const UPTO = ENDS.indexOf('2026-06-30');
const TODAY = '2026-10-19';
// rev(i), ni(i): the quarter's figures, i counting from 2019 Q1.
function company(rev, ni, opts = {}) {
  const rows = [];
  for (let i = 0; i <= (opts.upto == null ? UPTO : opts.upto); i++) {
    if (opts.skip && opts.skip.includes(i)) continue;
    rows.push({ periodType: 'Q', periodEnd: ENDS[i], revenue: rev ? rev(i) : null, netIncome: ni ? ni(i) : null });
  }
  return rows;
}
// 10% a year, compounded quarterly: each quarter 1.1^(1/4) times the last.
const q10 = (base) => (i) => base * Math.pow(1.1, i / 4);

console.log('the trailing year now against three and five years before');
{
  const g = LR.growth(company(q10(100e6), q10(10e6)), TODAY);
  check('basis is quarters, ending at the newest quarter', [g.basis, g.end], ['q', '2026-06-30']);
  check('revenue growing 10% a year reads 10.00 over three years', near(g.rev3, 10), true);
  check('...and over five', near(g.rev5, 10), true);
  check('net income the same', [near(g.ni3, 10), near(g.ni5, 10)], [true, true]);
}
{
  // Doubling over three years is 26.0% a year, not 33.3 (compounding).
  const rows = company((i) => (i <= UPTO - 12 ? 100e6 : 200e6), null);
  const g = LR.growth(rows, TODAY);
  check('a doubling over three years is 25.99% a year, compounded', near(g.rev3, 25.99), true);
}

console.log('null, never zero');
{
  const g = LR.growth(company(q10(100e6), (i) => (i <= UPTO - 12 ? -5e6 : 8e6)), TODAY);
  check('a loss three years back leaves net income growth blank', g.ni3, null);
  check('...and five years back too', g.ni5, null);
  check('revenue is still read', near(g.rev3, 10), true);
}
{
  const g = LR.growth(company(q10(100e6), (i) => (i >= UPTO - 3 ? -1e6 : 5e6)), TODAY);
  check('a loss now leaves net income growth blank', [g.ni3, g.ni5], [null, null]);
}
{
  const g = LR.growth(company(null, q10(10e6)), TODAY);
  check('a bank (no revenue line) has net income growth and no revenue growth', [g.rev3, g.rev5, near(g.ni5, 10)], [null, null, true]);
}
{
  const g = LR.growth(company(q10(100e6), q10(10e6), { skip: [UPTO - 13] }), TODAY);
  check('a missing quarter in the year three back leaves that rate blank', g.rev3, null);
  check('...and does not touch the five-year one', near(g.rev5, 10), true);
}
{
  // Three years back, the trailing year still needs the three quarters before
  // it: from 2022 Q3 is the least that gives a 3Y rate.
  const rows = company(q10(100e6), null).filter((r) => r.periodEnd >= '2022-09-30');
  const g = LR.growth(rows, TODAY);
  check('four years on file: a 3Y rate, no 5Y', [near(g.rev3, 10), g.rev5], [true, null]);
  const short = LR.growth(company(q10(100e6), null).filter((r) => r.periodEnd >= '2022-12-31'), TODAY);
  check('one quarter fewer: no 3Y rate either', short, null);
}
{
  const g = LR.growth(company(q10(100e6), q10(10e6), { upto: ENDS.indexOf('2025-12-31') }), TODAY);
  check('the newest quarter 292 days old: stopped filing, no reading', g, null);
  const ok = LR.growth(company(q10(100e6), q10(10e6), { upto: ENDS.indexOf('2026-03-31') }), TODAY);
  check('...201 days old is still read', ok && ok.basis, 'q');
}
{
  const g = LR.growth(company((i) => (i === UPTO - 21 ? -3e6 : 100e6), null), TODAY);
  check('a negative revenue quarter in the base year leaves that rate blank', g.rev5, null);
}
{
  const g = LR.growth(company(q10(100e6), (i) => (i <= UPTO - 12 ? 1e3 : 5e9)), TODAY);
  check('a rate past 1,000% a year (a base too small) is blank', g.ni3, null);
}
{
  // A loss at BOTH ends: the ratio of two negatives is positive, so without
  // the guard a loss doubling from -5M to -10M would read as +26% a year.
  const g = LR.growth(company(q10(100e6), (i) => (i <= UPTO - 12 ? -5e6 / 4 : -10e6 / 4)), TODAY);
  check('a loss at both ends (a widening loss) is blank, not growth', g.ni3, null);
}
check('nothing on file is null', LR.growth([], TODAY), null);
check('cagr: a zero base has no rate', LR.cagr(100, 0, 3), null);
check('cagr: a shrinking business is negative, not blank', near(LR.cagr(50, 100, 3), -20.63), true);

console.log('a foreign filer: annual reports, in its own currency');
{
  // Revenue flat at 1,000 in its own currency every year; the euro rose so
  // the dollar figure grew. Growth must read 0, not the currency's move.
  const fy = [];
  for (let y = 2019; y <= 2025; y++) {
    const fx = 1 + (y - 2019) * 0.05;
    fy.push({ periodType: 'FY', periodEnd: y + '-12-31', currency: 'EUR', fxAvg: fx, revenue: 1000 * fx, netIncome: 100 * fx });
  }
  const g = LR.growth(fy, TODAY);
  check('basis is the annual reports', g.basis, 'fy');
  check('flat revenue in its own currency reads 0, though the dollar figure rose 30%', [g.rev3, g.rev5], [0, 0]);
  check('net income too', [g.ni3, g.ni5], [0, 0]);
  const noRate = fy.map((r) => Object.assign({}, r, { fxAvg: null }));
  check('a foreign row without its rate is no use for growth', LR.growth(noRate, TODAY), null);
  const old = fy.filter((r) => r.periodEnd <= '2024-12-31');
  check('the newest annual report 657 days old: no reading', LR.growth(old, TODAY), null);
  const gap = fy.filter((r) => r.periodEnd !== '2022-12-31');
  check('the year three back missing: no 3Y rate, the 5Y still read', [LR.growth(gap, TODAY).rev3, LR.growth(gap, TODAY).rev5], [null, 0]);
}
{
  // A dollar filer with only annual reports (no quarters) uses them too.
  const fy = [];
  for (let y = 2019; y <= 2025; y++) fy.push({ periodType: 'FY', periodEnd: y + '-12-31', revenue: 100 * Math.pow(1.2, y - 2019), netIncome: null });
  const g = LR.growth(fy, TODAY);
  check('a dollar filer with annual reports only falls back to them', [g.basis, near(g.rev3, 20), near(g.rev5, 20)], ['fy', true, true]);
}

// ---- phase 2 ------------------------------------------------------------------
console.log('P/E against its own ten-year median');
{
  const pts = Array.from({ length: 40 }, (_, i) => (i % 2 ? 20 : 10));      // median 15 over 40
  const ttm = { netIncome: 100, d: '2026-06-30' };
  const r = LR.peVsHistory(pts, 3000, ttm, TODAY);
  check('now is market value over the newest trailing year', r.now, 30);
  check('the median of the quarter-end multiples', [r.med, r.n], [15, 40]);
  check('vsMed is percent above the median', r.vsMed, 100);
  const nineteen = pts.slice(0, 19).concat(Array(21).fill(null));
  check('nineteen quarters with a multiple: no median', LR.peVsHistory(nineteen, 3000, ttm, TODAY), null);
  check('twenty is enough', LR.peVsHistory(pts.slice(0, 20), 3000, ttm, TODAY) != null, true);
  check('a loss now has no P/E', LR.peVsHistory(pts, 3000, { netIncome: -5, d: '2026-06-30' }, TODAY), null);
  check('a trailing year 292 days old is stale', LR.peVsHistory(pts, 3000, { netIncome: 100, d: '2025-12-31' }, TODAY), null);
  check('a multiple past 1,000 is left out of the median', LR.peVsHistory(pts.concat([5000, 5000, 5000]), 3000, ttm, TODAY).n, 40);
  check('no market value, no reading', LR.peVsHistory(pts, null, ttm, TODAY), null);
}

console.log('the dividend record');
// fy(year, dps, filed, extra): an annual row.
const fyRow = (y, dps, filed, extra) => Object.assign({ periodType: 'FY', periodEnd: y + '-12-31', filed: filed || (y + 1) + '-02-20', dividendsPerShare: dps }, extra || {});
{
  const rows = [fyRow(2025, 2.0), fyRow(2024, 1.9), fyRow(2023, 1.8), fyRow(2022, 1.8), fyRow(2021, 1.7)];
  const d = LR.dividends(rows, [], TODAY);
  check('raised 2024 and 2025, held flat in 2023: a streak of 2 since 2023', [d.streak, d.since], [2, '2023']);
  check('years of dividends on file', d.years, 5);
}
{
  const rows = [fyRow(2025, 1.9), fyRow(2024, 2.0), fyRow(2023, 1.8)];
  check('a cut in the latest year is a streak of 0, a real reading', LR.dividends(rows, [], TODAY).streak, 0);
}
{
  // A 4-for-1 split in August 2020: the 2019 report (filed Feb 2020) states
  // 3.00; in today's shares that is 0.75, below 2020's 0.80.
  const rows = [fyRow(2021, 0.85), fyRow(2020, 0.80), fyRow(2019, 3.00, '2020-02-20'), fyRow(2018, 2.80, '2019-02-20')];
  const d = LR.dividends(rows, [{ d: '2020-08-31', f: 4 }], TODAY.replace('2026', '2022'));
  check('a report filed before a split is put in today’s shares', [d.streak, d.years], [3, 4]);
  const noAdj = LR.dividends(rows, [], TODAY.replace('2026', '2022'));
  check('...and without the split the record would break at the split', noAdj.streak, 1);
  const spin = LR.dividends(rows, [{ d: '2020-08-31', f: 1.05 }], TODAY.replace('2026', '2022'));
  check('a spin-off price factor (1.05) is not a split', spin.streak, 1);
}
{
  // A 1.05 spin-off price factor after the 2020 report: divided as if it were
  // a split, a cut from 1.02 to 1.00 would read as a raise (1.02 / 1.05 = 0.97).
  const rows = [fyRow(2021, 1.00), fyRow(2020, 1.02, '2021-02-20')];
  check('a spin-off factor does not turn a cut into a raise', LR.dividends(rows, [{ d: '2021-06-01', f: 1.05 }], '2022-10-19').streak, 0);
}
check('no split history held: no record at all', LR.dividends([fyRow(2025, 2), fyRow(2024, 1.9)], null, TODAY), null);
{
  // Started paying in 2023: a zero year before it is the start, not a raise.
  const d = LR.dividends([fyRow(2025, 1.2), fyRow(2024, 1.1), fyRow(2023, 1.0), fyRow(2022, 0)], [], TODAY);
  check('a year of no dividend ends the record: starting is not a raise', [d.streak, d.since, d.years], [2, '2023', 3]);
}
check('no dividend on the latest report: no record (not zero)', LR.dividends([fyRow(2025, null), fyRow(2024, 1.9)], [], TODAY), null);
{
  const rows = [fyRow(2025, 2.0), fyRow(2024, 1.9), fyRow(2022, 1.5), fyRow(2021, 1.4)];
  check('a missing year ends the record', [LR.dividends(rows, [], TODAY).streak, LR.dividends(rows, [], TODAY).years], [1, 2]);
}
{
  const rows = [2025, 2024, 2023, 2022, 2021, 2020].map((y, i) => fyRow(y, 2 / Math.pow(1.1, i)));
  check('dividend growth over five years', near(LR.dividends(rows, [], TODAY).g5, 10), true);
  const eur = [2025, 2024, 2023, 2022, 2021, 2020].map((y, i) => fyRow(y, 1 * (1.3 - i * 0.05), null, { currency: 'EUR', fxAvg: 1.3 - i * 0.05 }));
  check('in its own currency: a flat euro dividend is no raise, though the dollar figure rose', LR.dividends(eur, [], TODAY).streak, 0);
}

console.log('interest coverage');
{
  const rows = company(null, null).map((r) => Object.assign(r, { operatingIncome: 50, interestExpense: 10 }));
  check('trailing operating income over trailing interest', LR.coverage(rows, TODAY, false).cover, 5);
  check('a lender has none', LR.coverage(rows, TODAY, true), null);
  const none = company(null, null).map((r) => Object.assign(r, { operatingIncome: 50, interestExpense: null }));
  check('no interest expense filed: blank, not infinitely covered', LR.coverage(none, TODAY, false), null);
  const netIncome = company(null, null).map((r) => Object.assign(r, { operatingIncome: 50, interestExpense: -5 }));
  check('a negative interest expense (net interest income) is no coverage', LR.coverage(netIncome, TODAY, false), null);
  const loss = company(null, null).map((r) => Object.assign(r, { operatingIncome: -20, interestExpense: 10 }));
  check('an operating loss reads negative', LR.coverage(loss, TODAY, false).cover, -2);
}

console.log('the Piotroski F-score');
// Three annual reports where every test passes.
const good = () => [
  { periodType: 'FY', periodEnd: '2025-12-31', filed: '2026-02-20', netIncome: 120, operatingCashFlow: 150, assets: 1000, revenue: 900, grossProfit: 450, currentAssets: 300, currentLiabilities: 150, debt: 100, sharesDiluted: 100 },
  { periodType: 'FY', periodEnd: '2024-12-31', filed: '2025-02-20', netIncome: 100, operatingCashFlow: 120, assets: 1000, revenue: 800, grossProfit: 380, currentAssets: 280, currentLiabilities: 160, debt: 120, sharesDiluted: 101 },
  { periodType: 'FY', periodEnd: '2023-12-31', filed: '2024-02-20', netIncome: 80, operatingCashFlow: 90, assets: 1000, revenue: 700, grossProfit: 320, currentAssets: 250, currentLiabilities: 160, debt: 130, sharesDiluted: 102 },
];
{
  check('every test passes: 9', LR.piotroski(good(), [], TODAY), { score: 9, bits: '111111111', end: '2025-12-31' });
  const g = good(); g[0].netIncome = -10;
  const r = LR.piotroski(g, [], TODAY);
  check('a loss fails net income and return on assets up, and passes cash flow above net income', [r.score, r.bits], [7, '010111111']);
  const noCa = good(); noCa[0].currentAssets = null;
  check('a test that cannot be scored means no score, not a fail', LR.piotroski(noCa, [], TODAY), null);
  check('a lender has none', LR.piotroski(good(), [], TODAY, true), null);
  check('two annual reports are not enough', LR.piotroski(good().slice(0, 2), [], TODAY), null);
  check('no split history held: no score', LR.piotroski(good(), null, TODAY), null);
  const split = good(); split[0].sharesDiluted = 400;           // a 4-for-1 split after the 2024 report
  check('a split is not new shares', LR.piotroski(split, [{ d: '2025-06-01', f: 4 }], TODAY).bits[6], '1');
  check('...and without the split history it would read as dilution', LR.piotroski(split, [], TODAY).bits[6], '0');
  const nodebt = good(); nodebt[0].debt = null; nodebt[1].debt = null;
  check('no long-term debt in either year passes the leverage test', LR.piotroski(nodebt, [], TODAY).bits[4], '1');
  const oneDebt = good(); oneDebt[1].debt = null;
  check('debt tagged in one year only cannot be compared', LR.piotroski(oneDebt, [], TODAY), null);
  const gap = good(); gap[2].periodEnd = '2022-12-31';
  check('the reports must be consecutive years', LR.piotroski(gap, [], TODAY), null);
}

console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exitCode = failed ? 1 : 0;
