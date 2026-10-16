// earndate.js: the next report date when the provider has none.
const E = require('./earndate.js');
let ran = 0, failed = 0;
const check = (name, got, want) => { ran++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { failed++; console.log('FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); } };

// Netflix, the case that raised it.
const nflx = ['2025-04-17', '2025-07-17', '2025-10-21', '2026-01-20', '2026-04-16', '2026-07-16'];
check('Netflix: 21 Oct 2025 + 52 weeks', E.estimateNext(nflx, '2026-07-16'), { date: '2026-10-20', basis: 'year' });
check('same weekday as the year-ago report', new Date(E.estimateNext(nflx, '2026-07-16').date + 'T12:00:00Z').getUTCDay(), new Date('2025-10-21T12:00:00Z').getUTCDay());
// Order does not matter.
check('unsorted history', E.estimateNext(nflx.slice().reverse(), '2026-07-16'), { date: '2026-10-20', basis: 'year' });
// No year-ago report: +91.
check('short history falls back to +91', E.estimateNext(['2026-04-16', '2026-07-16'], '2026-07-16'), { date: '2026-10-15', basis: 'q91' });
check('no history at all', E.estimateNext([], '2026-07-16'), { date: '2026-10-15', basis: 'q91' });
// The year-ago window: 25 days either side of last + 91 - 364 (= 2025-10-16 here).
check('a year-ago report 25 days off still counts', E.estimateNext(['2025-11-10', '2026-07-16'], '2026-07-16'), { date: '2026-11-09', basis: 'year' });
check('26 days off does not', E.estimateNext(['2025-11-11', '2026-07-16'], '2026-07-16'), { date: '2026-10-15', basis: 'q91' });
check('25 days early still counts', E.estimateNext(['2025-09-21', '2026-07-16'], '2026-07-16'), { date: '2026-09-20', basis: 'year' });
// The nearest of two candidates.
check('nearest of two', E.estimateNext(['2025-10-01', '2025-10-16', '2026-07-16'], '2026-07-16'), { date: '2026-10-15', basis: 'year' });
// A report on or after `last` is never the year-ago one.
check('later dates ignored', E.estimateNext(['2026-07-16', '2026-08-01'], '2026-07-16'), { date: '2026-10-15', basis: 'q91' });
// Missing input.
check('no last report', E.estimateNext(nflx, null), null);
check('bad last report', E.estimateNext(nflx, 'soon'), null);
// Noon parsing: no time-zone slip at the month boundary.
check('month boundary', E.estimateNext(['2025-11-01', '2026-08-01'], '2026-08-01'), { date: '2026-10-31', basis: 'year' });

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
