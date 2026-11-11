// trending.js: the four views, their edges, blanks, funds and the workbook.
//   node trending-test.js
const T = require('./trending.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const row = (sym, o) => Object.assign({ symbol: sym, name: sym + ' Inc', sector: 'Technology', marketCap: 1e10, currency: 'USD' }, o);

// capChange: value now less the value the move started from
ok(Math.abs(T.capChange(110, 10) - 10) < 1e-9, 'cap +10% of 110 is +10');
ok(Math.abs(T.capChange(90, -10) - -10) < 1e-9, 'cap -10% of 90 is -10');
ok(T.capChange(null, 5) === null, 'no cap, no change');
ok(T.capChange(0, 5) === null, 'zero cap, no change');
ok(T.capChange(100, null) === null, 'no move, no change (null is not zero)');
ok(T.capChange(100, '') === null, 'empty move is blank');
ok(T.capChange(100, -100) === null, 'a -100% move has no start value');
ok(T.capChange(100, 0) === 0, 'a flat move is a zero change');

const rows = [
  row('AAA', { todayPct: 5, oneWeekPct: -2, oneMonthPct: 1, volX: 2, marketCap: 5e11 }),
  row('BBB', { todayPct: 8, oneWeekPct: 3, oneMonthPct: -4, volX: 1.49, marketCap: 1e9 }),
  row('CCC', { todayPct: -3, oneWeekPct: 10, oneMonthPct: null, volX: 1.5, marketCap: 2e12 }),
  row('DDD', { todayPct: -9, oneWeekPct: -12, oneMonthPct: -1, volX: 3, marketCap: 3e9 }),
  row('EEE', { todayPct: 0, oneWeekPct: 0, volX: 5 }),
  row('FFF', { todayPct: null, volX: 4 }),
  row('ETF1', { todayPct: 20, volX: 9, instrumentType: 'ETF' }),
  row('ERR', { todayPct: 30, error: 'bad' }),
  null,
];
const v = T.views(rows, 'today');
ok(v.up.map((r) => r.symbol).join() === 'BBB,AAA', 'up: rises only, largest first: ' + v.up.map((r) => r.symbol));
ok(v.down.map((r) => r.symbol).join() === 'DDD,CCC', 'down: falls only, largest fall first: ' + v.down.map((r) => r.symbol));
ok(!v.up.concat(v.down).some((r) => r.symbol === 'EEE'), 'a flat day is neither up nor down');
ok(!Object.values(v).flat().some((r) => r.symbol === 'ETF1' || r.symbol === 'ERR' || r.symbol === 'FFF'), 'funds, error rows and blank moves are left out');
ok(v.volUp.map((r) => r.symbol).join() === 'AAA', 'volume up: 1.5x or more and a rise (BBB at 1.49 out): ' + v.volUp.map((r) => r.symbol));
ok(v.volDown.map((r) => r.symbol).join() === 'DDD,CCC', 'volume down: heaviest first, 1.5 exactly in: ' + v.volDown.map((r) => r.symbol));
ok(v.capUp[0].symbol === 'AAA', 'cap up: AAA +5% of 500B beats BBB +8% of 1B');
ok(v.capDown[0].symbol === 'CCC', 'cap down: CCC -3% of 2T beats DDD -9% of 3B');
ok(v.up[0].move === 8 && v.up[0].w1 === 3 && v.up[0].m1 === -4, 'rows carry the move, 1W and 1M');

const w = T.views(rows, '1w');
ok(w.up.map((r) => r.symbol).join() === 'CCC,BBB', '1 week reads oneWeekPct: ' + w.up.map((r) => r.symbol));
ok(w.down.map((r) => r.symbol).join() === 'DDD,AAA', '1 week falls');
ok(w.volUp.map((r) => r.symbol).join() === 'AAA' && w.volDown.map((r) => r.symbol).join() === 'DDD,CCC', 'volume reads the latest session whatever the period');
ok(w.capUp[0].symbol === 'CCC', '1 week market value change follows the week');
const m = T.views(rows, '1m');
ok(!m.up.concat(m.down).some((r) => r.symbol === 'CCC'), '1 month: a blank 1M is left out');
ok(T.views(rows, 'bogus').up.map((r) => r.symbol).join() === 'BBB,AAA', 'an unknown period reads Today');

// at most TOP, ties broken by symbol
const many = Array.from({ length: 80 }, (_, i) => row('S' + String(i).padStart(2, '0'), { todayPct: 1 + (i % 3), volX: 2 }));
const mv = T.views(many, 'today');
ok(mv.up.length === T.TOP, 'at most ' + T.TOP + ' a list');
ok(mv.up[0].symbol === 'S02' && mv.up[1].symbol === 'S05', 'ties in symbol order');

// rules in words
const ru = T.rules('1w');
ok(/over 1 week/.test(ru.up) && /in the latest session/.test(T.rules('today').down), 'rules name the period');
ok(/1\.5 times/.test(ru.volume), 'volume rule names the threshold');
ok(!/\b(buy|sell|hold)\b/i.test(Object.values(ru).join(' ')), 'no trade wording in the rules');

// the workbook: a sheet a list and About, blanks empty, numbers numbers
const sh = T.workbookSheets({ period: 'today', views: v, rules: T.rules('today'), at: '2026-11-07T21:00:00Z' });
ok(sh.map((s) => s.name).join('|') === 'Trending up|Trending down|Volume, price up|Volume, price down|Market cap, up|Market cap, down|About', 'sheet names');
const up = sh[0], ci = (h) => up.cols.findIndex((c) => c[0] === h);
ok(up.rows.length === 2 && up.rows[0][0] === 'BBB', 'up sheet rows in order');
ok(up.rows[1][ci('Market cap ($B)')] === 500, 'market cap in $ billions');
ok(ci('Health (0 to 100)') === 2, 'Health the third column');
ok(up.rows[0][ci('Tone 7D (−1 to +1)')] === null, 'no tone is an empty cell');
ok(sh[3].rows[1][ci('1 month (%)')] === null, 'a blank 1M stays empty, never 0');
ok(!/\b(buy|sell|hold)\b/i.test(sh[6].rows.map((r) => r.join(' ')).join(' ')), 'no trade wording on About');

console.log(`${pass + fail} checks, ${fail} failed`);
process.exit(fail ? 1 : 0);
