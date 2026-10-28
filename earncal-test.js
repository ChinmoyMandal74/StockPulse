// earncal.js: reading the two earnings calendars. Pure, no network.
const C = require('./earncal.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// Alpha Vantage's real header, with a quoted name that carries a comma.
const av = 'symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay\r\n'
  + 'AMZN,Amazon.com Inc,2026-10-29,2026-09-30,2.01,USD,post-market\r\n'
  + 'BRK-B,"Berkshire Hathaway, Inc.",2026-11-02,2026-09-30,,USD,\r\n'
  + 'XYZ,Twice Listed Co,2026-12-10,2026-11-30,0.1,USD,\r\n'
  + 'XYZ,Twice Listed Co,2026-11-12,2026-09-30,0.1,USD,\r\n'
  + 'BAD,No Date Co,,2026-09-30,,USD,\r\n';
const r = C.parseAlphaVantage(av);
ok(r.AMZN && r.AMZN.d === '2026-10-29' && r.AMZN.time === 'post-market', 'a plain row, with its time of day', r.AMZN);
ok(r['BRK.B'] && r['BRK.B'].d === '2026-11-02', 'a quoted name with a comma; BRK-B read as BRK.B', r['BRK.B']);
ok(r.XYZ && r.XYZ.d === '2026-11-12', 'a company listed twice keeps its earliest day', r.XYZ);
ok(!('BAD' in r), 'a row with no date is not a listing');
ok(C.parseAlphaVantage('{"Information": "We have detected your API key as ... rate limit"}') === null, 'a refusal (JSON) is no calendar, not an empty one');
ok(C.parseAlphaVantage('') === null, 'an empty answer is no calendar');

// Nasdaq's JSON shape, as returned on 2026-10-28.
const nq = C.parseNasdaq({ data: { rows: [
  { symbol: 'AMZN', time: 'time-after-hours' }, { symbol: 'LLY', time: 'time-pre-market' }, { symbol: 'BRK/B', time: 'time-not-supplied' },
] } }, '2026-10-29');
ok(nq.AMZN.d === '2026-10-29' && nq.AMZN.time === 'after-hours' && nq.LLY.time === 'pre-market', 'Nasdaq rows carry the day asked and the time', nq);
ok(nq['BRK.B'] && nq['BRK.B'].d === '2026-10-29', 'BRK/B read as BRK.B', nq);
ok(Object.keys(C.parseNasdaq(null, '2026-10-29')).length === 0 && Object.keys(C.parseNasdaq({ data: null }, 'x')).length === 0, 'a day with no rows is empty, not an error');
ok(C.normSym(' brk/b ') === 'BRK.B' && C.normSym('AAPL') === 'AAPL', 'symbols upper-cased, class shares dotted');
ok(C.addDays('2026-10-30', 3) === '2026-11-02' && C.addDays('2026-03-07', 1) === '2026-03-08', 'day arithmetic across a month and a clock change');

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
