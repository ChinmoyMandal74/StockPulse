// reportdue.js: which companies are re-pulled because they just reported.
//   node reportdue-test.js
'use strict';
const R = require('./reportdue.js');
let ran = 0, failed = 0;
const check = (m, c, x) => { ran++; if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// "Now" is 2026-10-24 09:00 New York (13:00 UTC).
const now = Date.parse('2026-10-24T13:00:00Z');
const at = (iso, hhmmUtc) => Date.parse(iso + 'T' + (hhmmUtc || '12:00') + ':00Z');
const P = (o) => Object.assign({ instrumentType: 'Common Stock' }, o);
const syms = (list) => list.map((x) => x.symbol).join(',');

// AXP's shape: results filed Oct 17, profile pulled Oct 15.
let d = R.due(['AXP'], { AXP: P({ fetchedAt: at('2026-10-15'), lastEarningsDate: '2026-07-18', mostRecentQuarter: '2026-06-30' }) }, { AXP: { results: '2026-10-17' } }, { now });
check('pulled before the results: due', syms(d) === 'AXP' && /before/.test(d[0].why), d);
// Pulled on the filing day itself (the release came after the close): due.
d = R.due(['X'], { X: P({ fetchedAt: at('2026-10-17', '15:00'), lastEarningsDate: '2026-07-18', mostRecentQuarter: '2026-06-30' }) }, { X: { results: '2026-10-17' } }, { now });
check('pulled on the filing day: due', syms(d) === 'X', d);
// Late evening in New York is still that day, though it is the next day in UTC.
d = R.due(['X'], { X: P({ fetchedAt: Date.parse('2026-10-18T02:30:00Z'), lastEarningsDate: '2026-07-18', mostRecentQuarter: '2026-06-30' }) }, { X: { results: '2026-10-17' } }, { now });
check('10:30 pm New York on the filing day counts as that day', syms(d) === 'X', d);
// Pulled after, and the provider has the new report and quarter: not due.
d = R.due(['X'], { X: P({ fetchedAt: at('2026-10-20'), lastEarningsDate: '2026-10-17', mostRecentQuarter: '2026-09-30' }) }, { X: { results: '2026-10-17' } }, { now });
check('caught up: not due', d.length === 0, d);
// Pulled after, report recorded but the old quarter's figures, 4 days ago: due again.
d = R.due(['X'], { X: P({ fetchedAt: at('2026-10-20'), lastEarningsDate: '2026-10-17', mostRecentQuarter: '2026-06-30' }) }, { X: { results: '2026-10-17' } }, { now });
check('old figures after the pull, 4 days on: due again', syms(d) === 'X' && /old quarter/.test(d[0].why), d);
// The same, but pulled yesterday: rests until the recheck interval.
d = R.due(['X'], { X: P({ fetchedAt: at('2026-10-23'), lastEarningsDate: '2026-10-17', mostRecentQuarter: '2026-06-30' }) }, { X: { results: '2026-10-17' } }, { now });
check('old figures, pulled yesterday: waits', d.length === 0, d);
// The provider has not recorded the report at all, pulled 3+ days ago.
d = R.due(['X'], { X: P({ fetchedAt: at('2026-10-20'), lastEarningsDate: '2026-07-18', mostRecentQuarter: '2026-06-30' }) }, { X: { results: '2026-10-17' } }, { now });
check('report not recorded, pulled 4 days ago: due', syms(d) === 'X' && /not recorded/.test(d[0].why), d);
// Outside the window: the rotation's business.
d = R.due(['X'], { X: P({ fetchedAt: at('2026-09-20'), lastEarningsDate: '2026-07-18' }) }, { X: { results: '2026-10-09' } }, { now });
check('filed 15 days ago: not due', d.length === 0, d);
d = R.due(['X'], { X: P({ fetchedAt: at('2026-09-20'), lastEarningsDate: '2026-07-18' }) }, { X: { results: '2026-10-10' } }, { now });
check('filed 14 days ago: due', d.length === 1, d);
// A fund, no profile, no filing date, never fetched, an expired profile.
check('a fund is never due', R.due(['QQQ'], { QQQ: P({ instrumentType: 'ETF', fetchedAt: at('2026-10-01') }) }, { QQQ: { results: '2026-10-20' } }, { now }).length === 0);
check('no profile: not due', R.due(['X'], {}, { X: { results: '2026-10-20' } }, { now }).length === 0);
check('no results filing: not due', R.due(['X'], { X: P({ fetchedAt: at('2026-10-01') }) }, { X: { results: null } }, { now }).length === 0);
check('expired already (no fetchedAt): left to the rotation', R.due(['X'], { X: P({}) }, { X: { results: '2026-10-20' } }, { now }).length === 0);
// A filing date in the future (a clock or data fault) is ignored.
check('a filing after today: not due', R.due(['X'], { X: P({ fetchedAt: at('2026-10-01') }) }, { X: { results: '2026-10-27' } }, { now }).length === 0);
// Order and cap: newest filings first, at most max.
const uni = ['A', 'B', 'C', 'D'];
const prof = {}; const fl = {};
['2026-10-21', '2026-10-23', '2026-10-22', '2026-10-20'].forEach((r, i) => { prof[uni[i]] = P({ fetchedAt: at('2026-10-01') }); fl[uni[i]] = { results: r }; });
d = R.due(uni, prof, fl, { now, max: 2 });
check('newest filings first, capped', syms(d) === 'B,C', d);
check('the default cap is 100', R.MAX_DEFAULT === 100 && R.due(uni, prof, fl, { now }).length === 4);
check('max 0 means none', R.due(uni, prof, fl, { now, max: 0 }).length === 0);

console.log(`${ran} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
