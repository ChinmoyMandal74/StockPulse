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

console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exitCode = failed ? 1 : 0;
