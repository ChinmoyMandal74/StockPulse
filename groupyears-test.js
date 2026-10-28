// groupmonths.js, year by year: the rules a year at a time. Pure, no network.
const G = require('./groupmonths.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.011;

// Three years: 2024, 2025, 2026 to Oct 26.
const latest = '2026-10-26';
const { years, bounds } = G.planYears(latest, 2024);
ok(JSON.stringify(years) === '["2024","2025","2026"]' && bounds[0] === '2024-01-01' && bounds[3] === '2026-10-27', 'years from the first asked to the newest, the last boundary the day after the newest bar', { years, bounds });
ok(G.planYears(latest)[ 'years' ][0] === '2007', 'the default first year is 2007, the archive’s first full year');

const c = (d, close) => ({ d, close });
// A company there all along: 100 -> 120 -> 90 -> 99.
const steady = [c('2023-12-29', 100), c('2024-12-31', 120), c('2025-12-31', 90), c('2026-10-26', 99)];
const r = G.yearly(steady, bounds);
ok(near(r[0], 20) && near(r[1], -25) && near(r[2], 10), 'each year is the close over the close a year before', r);

// Listed in March 2024: its first close before 2024-01-01 does not exist.
ok(G.yearly([null, c('2024-12-31', 50), c('2025-12-31', 60), c('2026-10-24', 66)], bounds)[0] === null, 'a company listed mid-year has no return for that year');
// Bars stop in June 2024 and start again in November 2025 (the GM shape).
const gm = G.yearly([c('2023-12-29', 40), c('2024-06-28', 0.5), c('2024-06-28', 0.5), c('2026-10-26', 30)], bounds);
ok(gm[0] === null && gm[1] === null && near(gm[2], null) === false, 'a series that stops mid-year: no return for the year it stopped or the year it was absent', gm);
// A close more than a fortnight before the boundary does not belong to it.
ok(G.yearly([c('2023-11-30', 100), c('2024-12-31', 110), null, null], bounds)[0] === null, 'a start close from November is not the year-end close');
// A break: 0.11 to 34.20 inside a year is no return.
ok(G.yearly([c('2023-12-29', 0.11), c('2024-12-31', 34.2), null, null], bounds)[0] === null, 'a move past 50 times in a year is a break in the series, not a return');
ok(near(G.yearly([c('2023-12-29', 10), c('2024-12-31', 300), null, null], bounds)[0], 2900), 'a 30-fold year is kept: the cap is 50 times');

// The groups: equal weight, today's members, funds left out, three-state index flags.
const closesBySym = new Map([
  ['AAA', steady],
  ['BBB', [c('2023-12-29', 50), c('2024-12-31', 50), c('2025-12-31', 60), c('2026-10-26', 54)]],
  ['NEW', [null, c('2024-12-31', 10), c('2025-12-31', 20), c('2026-10-26', 20)]],
  ['SPY', [c('2023-12-29', 400), c('2024-12-31', 500), c('2025-12-31', 550), c('2026-10-26', 605)]],
]);
const rows = [
  { symbol: 'AAA', sector: 'Tech', spMember: true }, { symbol: 'BBB', sector: 'Energy', spMember: null },
  { symbol: 'NEW', sector: 'Tech', spMember: false }, { symbol: 'SPY', instrumentType: 'ETF' },
];
const b = G.buildYears({ latest, first: 2024, rows, closesBySym, benchCloses: closesBySym.get('SPY') });
ok(b.companies === 3 && !b.groups.all.r.includes(undefined), 'funds are not members; three companies counted', b.companies);
ok(near(b.groups.all.r[0], 10) && b.groups.all.n[0] === 2, '2024, every company: (20 + 0) / 2, NEW not yet listed', b.groups.all);
ok(near(b.groups.all.r[1], (-25 + 20 + 100) / 3) && b.groups.all.n[1] === 3, '2025: three members, each counting the same', b.groups.all.r[1]);
ok(b.groups.sp.members === 1 && near(b.groups.sp.r[0], 20), 'S&P 500: only a known Yes counts (null and false are not members)', b.groups.sp);
ok(b.groups['sec:Tech'].members === 2 && near(b.groups['sec:Tech'].r[1], 37.5), 'a sector group, equal weight', b.groups['sec:Tech']);
ok(near(b.bench[0], 25) && near(b.bench[1], 10) && near(b.bench[2], 10), 'the fund’s own year over the same boundaries', b.bench);
const none = G.buildYears({ latest, first: 2024, rows: [{ symbol: 'ZZZ' }], closesBySym: new Map() });
ok(none.groups.all.r.every((v) => v === null), 'a year nobody has a return for is absent, never zero', none.groups.all.r);

// The month build is untouched by the year one.
const m = G.build({ latest: '2026-02-15', years: 1, rows: [{ symbol: 'AAA' }], closesBySym: new Map([['AAA', [c('2025-12-31', 100), c('2026-01-30', 110), c('2026-02-13', 121)]]]) });
ok(JSON.stringify(m.months) === '["2026-01","2026-02"]' && near(m.groups.all.r[0], 10) && near(m.groups.all.r[1], 10), 'the month build still answers as before', m.groups.all);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
