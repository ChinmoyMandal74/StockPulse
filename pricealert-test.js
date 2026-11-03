// pricealert.js: once-a-day job alerts with an all-clear, and the dropped
// and stale symbol report. Pure.   node pricealert-test.js
'use strict';
const A = require('./pricealert.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// ---- A job failing.
let r = A.onFail({}, 'intraday', '2026-11-03', 'HTTP 404: Data not found', 1);
ok(r.send && r.state.intraday.day === '2026-11-03' && r.state.intraday.error === 'HTTP 404: Data not found', 'the first failure of the day mails');
let s = r.state;
r = A.onFail(s, 'intraday', '2026-11-03', 'again', 2);
ok(!r.send && r.state.intraday.error === 'HTTP 404: Data not found', 'a second failure that day does not');
r = A.onFail(s, 'nightly', '2026-11-03', 'gave up', 3);
ok(r.send, 'another job is its own alert');
r = A.onOk(s, 'intraday', '2026-11-03', 5);
ok(r.send && r.failedAt === 1 && r.state.intraday.recovered, 'the next success that day sends the all-clear');
s = r.state;
r = A.onOk(s, 'intraday', '2026-11-03', 6);
ok(!r.send, 'only one all-clear');
r = A.onFail(s, 'intraday', '2026-11-03', 'broke again', 7);
ok(r.send && !r.state.intraday.recovered, 'failing again after the all-clear mails again');
ok(!A.onOk({}, 'intraday', '2026-11-03', 1).send, 'a success with no failure on file says nothing');
ok(!A.onOk({ intraday: { day: '2026-11-02', at: 1, recovered: false } }, 'intraday', '2026-11-03', 2).send, 'yesterday’s failure gets no all-clear today');
ok(A.onFail({ intraday: { day: '2026-11-02', at: 1, recovered: false } }, 'intraday', '2026-11-03', 'x', 2).send, 'and a new day’s failure mails');

// ---- Symbols the provider does not serve.
const bar = (d) => ({ values: [{ datetime: d + ' 15:59:00', close: '1' }, { datetime: '2026-10-01', close: '1' }] });
const asked = ['AAPL', 'MSFT', 'NVDA', 'QRVO', 'WBD', 'KVUE'];
const got = { AAPL: bar('2026-11-03'), MSFT: bar('2026-11-03'), NVDA: bar('2026-11-02'), WBD: bar('2026-10-06'), KVUE: bar('2026-10-30') };
let u = A.unserved(asked, got, {}, '2026-11-03');
ok(u.gone.map((g) => g.symbol + ':' + g.kind).join() === 'QRVO:none,WBD:stale', 'not served, and served weeks stale, are reported', u.gone);
ok(!u.gone.some((g) => g.symbol === 'KVUE' || g.symbol === 'NVDA'), 'four days behind is not stale (a long weekend is not a delisting)');
ok(u.state.WBD.last === '2026-10-06' && u.state.QRVO.last === null && u.state.QRVO.since === '2026-11-03', 'the mark holds the last bar and since');
let u2 = A.unserved(asked, got, u.state, '2026-11-03');
ok(!u2.gone.length && !u2.back.length, 'the next round says nothing new');
u2 = A.unserved(['AAPL', 'QRVO', 'WBD'], { AAPL: bar('2026-11-04'), QRVO: bar('2026-11-04') }, u.state, '2026-11-04');
ok(u2.back.map((b) => b.symbol).join() === 'QRVO' && u2.gone.map((g) => g.symbol + ':' + g.kind).join() === 'WBD:none', 'back is reported once, and stale turning to none is a change', [u2.back, u2.gone]);
ok(!('QRVO' in u2.state) && u2.state.WBD.since === '2026-11-03', 'a symbol back leaves the mark; since is kept across a change');
const other = A.unserved(['AAPL', 'MSFT'], { AAPL: bar('2026-11-03'), MSFT: bar('2026-11-03') }, u.state, '2026-11-03');
ok(other.state.QRVO && !other.back.length, 'a symbol not asked for this round is left as it was');
const outage = A.unserved(asked, { AAPL: bar('2026-11-03') }, {}, '2026-11-03');
ok(outage.skipped && !outage.gone.length, 'served under half: a provider problem, nothing reported');
ok(A.unserved([], {}, {}, '2026-11-03').skipped, 'nothing asked, nothing said');
ok(A.unserved(['aapl', 'qrvo'], { AAPL: bar('2026-11-03') }, {}, '2026-11-03').gone[0].symbol === 'QRVO', 'symbols compared in upper case');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
