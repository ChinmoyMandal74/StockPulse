// Day by day (groupdays.js and the four cards in private/cards.js): the
// window, the calendar, the gaps, the group average, and what the grid draws.
const GD = require('./groupdays.js');
require('./private/cards.js');
const Cards = global.Cards;
let ran = 0, failed = 0;
const near = (a, b, e = 1e-6) => a != null && b != null && Math.abs(a - b) < e;
const check = (name, ok, extra) => { ran++; if (!ok) { failed++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// The window: the week of the newest session and the seven before it.
check('Monday of a Wednesday', GD.mondayOf('2026-10-21') === '2026-10-19');
check('Monday of a Monday', GD.mondayOf('2026-10-19') === '2026-10-19');
check('Monday of a Sunday', GD.mondayOf('2026-10-25') === '2026-10-19');
check('window starts seven Mondays back', GD.windowStart('2026-10-21') === '2026-08-31', GD.windowStart('2026-10-21'));

// A calendar of weekdays from 2026-08-20 to 2026-10-21, Labor Day (09-07) closed.
const cal = [];
for (let t = Date.parse('2026-08-20T12:00:00Z'); t <= Date.parse('2026-10-21T12:00:00Z'); t += 86400000) {
  const d = new Date(t), wd = d.getUTCDay(), iso = d.toISOString().slice(0, 10);
  if (wd > 0 && wd < 6 && iso !== '2026-09-07') cal.push(iso);
}
const P = GD.plan(cal);
check('plan: latest', P.latest === '2026-10-21');
check('plan: first day drawn is the window Monday', P.days[0] === '2026-08-31', P.days[0]);
check('plan: base is the session before it', P.base === '2026-08-28', P.base);
check('plan: the holiday is no session', !P.days.includes('2026-09-07'));
check('plan: 38 sessions (7 weeks less a holiday, plus Mon-Wed)', P.days.length === 7 * 5 - 1 + 3, P.days.length);

// The fund: +1% every session from 100.
const bench = []; let lvl = 100;
for (const d of cal) { bench.push({ datetime: d, close: lvl }); lvl *= 1.01; }
// Company A: +2% every session. B: a hole on 2026-10-14, so 10-14 AND 10-15
// have no return (10-15's session before is the hole). C: listed 2026-10-05.
// D: a reorganisation (x50 in a day) on 2026-09-15. E: a fund, never a member.
const series = (from, step, skip) => { const out = []; let c = 10; for (const d of cal) { if (d >= from && d !== skip) out.push({ datetime: d, close: c }); c *= step; } return out; };
const A = series('2000-01-01', 1.02);
const B = series('2000-01-01', 0.99, '2026-10-14');
const C = series('2026-10-05', 1.03);
const Dd = series('2000-01-01', 1.0).map((b) => (b.datetime >= '2026-09-15' ? { datetime: b.datetime, close: b.close * 50 } : b));
const r = (sym) => GD.daily(GD.closeMap(sym), P);
check('daily: A is +2% on the first day drawn (against the base)', near(r(A)[0], 2), r(A)[0]);
check('daily: across the holiday is one session, +2%', near(r(A)[P.days.indexOf('2026-09-08')], 2));
check('daily: the hole has no return', r(B)[P.days.indexOf('2026-10-14')] === null);
check('daily: nor the day after it', r(B)[P.days.indexOf('2026-10-15')] === null);
check('daily: and B is back on 10-16', near(r(B)[P.days.indexOf('2026-10-16')], -1));
check('daily: before listing, nothing', r(C)[P.days.indexOf('2026-10-02')] === null && r(C)[P.days.indexOf('2026-10-05')] === null);
check('daily: the day after listing, a return', near(r(C)[P.days.indexOf('2026-10-06')], 3));
check('daily: a x50 day is a break, not a return', r(Dd)[P.days.indexOf('2026-09-15')] === null);
check('daily: a sub-cent close is not a price', GD.daily(new Map([[P.base, 0.001], [P.days[0], 5]]), P)[0] === null);

const rows = [
  { symbol: 'A', sector: 'Tech', spMember: true },
  { symbol: 'B', sector: 'Tech', spMember: false },
  { symbol: 'C', sector: 'Energy' },
  { symbol: 'D', sector: 'Energy' },
  { symbol: 'E', sector: 'Tech', instrumentType: 'ETF' },
];
const built = GD.build({ rows, barsBySym: { A, B, C, D: Dd, E: A }, benchBars: bench, themesOf: (s) => (s === 'A' || s === 'C' ? ['Picks'] : []) });
const k = (d) => built.days.indexOf(d);
check('build: four companies, the fund left out', built.companies === 4, built.companies);
check('build: groups', ['all', 'sp', 'sec:Tech', 'sec:Energy', 'thm:Picks'].every((g) => built.groups[g]), Object.keys(built.groups));
check('build: Tech members', built.groups['sec:Tech'].members === 2);
check('build: Tech on 10-13 is the mean of +2 and -1', near(built.groups['sec:Tech'].r[k('2026-10-13')], 0.5), built.groups['sec:Tech'].r[k('2026-10-13')]);
check('build: Tech on 10-14 is A alone (B has a hole)', near(built.groups['sec:Tech'].r[k('2026-10-14')], 2) && built.groups['sec:Tech'].n[k('2026-10-14')] === 1);
check('build: Energy on 09-15 has only C? no: C not listed, D broken -> absent', built.groups['sec:Energy'].r[k('2026-09-15')] === null);
check('build: the break is reported', built.broken.includes('D 2026-09-15'), built.broken);
check('build: S&P is a known Yes only', built.groups.sp.members === 1);
check('build: theme Picks', built.groups['thm:Picks'].members === 2 && near(built.groups['thm:Picks'].r[k('2026-10-06')], 2.5));
check('build: the fund\'s returns travel with it', near(built.idx[5], 1));

const one = GD.forStock({ symbol: 'A', bars: A, benchBars: bench });
check('forStock: same calendar', one.days.length === P.days.length && one.latest === '2026-10-21');
check('forStock: own and index', near(one.r[3], 2) && near(one.idx[3], 1));

// ---- the cards --------------------------------------------------------------
const size = { id: 'portrait', w: 1080, h: 1350 };
const stocks = [{ symbol: 'A', name: 'Alpha Corporation', sector: 'Tech', portfolios: ['Picks'] }, { symbol: 'B', name: 'Beta', sector: 'Tech' }];
const draw = (tpl, opts, extra) => Cards.build(tpl, Object.assign({ stocks, size, opts: opts || {}, myLists: {}, screens: [] }, extra));
const html = (b) => (b && (b.html || b)) + '';
const cellsIn = (h) => (h.match(/class="mh-c[ "]/g) || []).length;
const rowsIn = (h) => (h.match(/class="mh-y"/g) || []).length;

let h = html(draw('days', { dbdSym: 'A' }, { getDays: () => one }));
check('stock card: eight weeks', rowsIn(h) === 8, rowsIn(h));
check('stock card: 8 x (5 days + week) cells', cellsIn(h) === 48, cellsIn(h));
check('stock card: day by day in the title', /day by day/.test(h));
check('stock card: the holiday is a shaded slot', (h.match(/dd-off/g) || []).length === 1, (h.match(/dd-off/g) || []).length);
check('stock card: Thu and Fri of this week are plain empty (still to come)', (h.match(/class="mh-c mh-na"><\/span>/g) || []).length === 2);
// Week compounding: five sessions of +2% is 10.4% -> "+10.4".
check('stock card: a full week compounds (+10.4)', />\+10\.4</.test(h));
check('stock card: the running week is outlined', (h.match(/mh-yr mh-part/g) || []).length === 1);
check('stock card: the holiday week still has a figure (four sessions, +8.2)', />\+8\.2</.test(h));
check('stock card: newest week first', h.indexOf('Oct 19') < h.indexOf('Aug 31'));
check('stock card: no buy/sell/hold words', !/\b(buy|sell|hold)\b/i.test(h.replace(/<[^>]+>/g, ' ')));
// Against the S&P 500: +2 less +1 is +1.0 a day.
h = html(draw('days', { dbdSym: 'A', dbdView: 'rel' }, { getDays: () => one }));
check('stock card rel: titled against the S&P 500', /against the S&amp;P 500|against the S&P 500/.test(h));
check('stock card rel: a day reads +1.0', />\+1\.0</.test(h));
h = html(draw('days', { dbdSym: 'A', dbdView: 'rel' }, { getDays: () => Object.assign({}, one, { idx: one.idx.map(() => null) }) }));
check('stock card rel without an index falls back and says so', /own return, no index reading held/.test(h));
h = html(draw('days', { dbdSym: 'A' }, { getDays: () => null }));
check('stock card: loading state', /Drawing/.test(h));

h = html(draw('secdays', { gdsName: 'Tech' }, { getGroupDays: () => built }));
check('sector card: eight weeks', rowsIn(h) === 8 && cellsIn(h) === 48, [rowsIn(h), cellsIn(h)]);
check('sector card: equal weight and members', /equal weight/.test(h) && /2 companies today/.test(h));
h = html(draw('thmdays', { gdtName: 'Picks' }, { getGroupDays: () => built }));
check('theme card draws', rowsIn(h) === 8 && /Picks/.test(h));
h = html(draw('mktdays', { gdkGroup: 'sp' }, { getGroupDays: () => built }));
check('market card: S&P members', /S&amp;P 500 members|S&P 500 members/.test(h) && /1 company today/.test(h));
h = html(draw('mktdays', {}, { getGroupDays: () => ({ days: [], groups: {} }) }));
check('market card: not built yet', /not been built yet/.test(h));
check('needs: stock', JSON.stringify(Cards.daysNeed('days', { dbdSym: 'NVDA' })) === '{"symbol":"NVDA"}' && Cards.daysNeed('months', {}) === null);
check('needs: groups', !!Cards.groupDaysNeed('secdays') && Cards.groupDaysNeed('secmonths') === null);
for (const z of [{ id: 'square', w: 1080, h: 1080 }, { id: 'story', w: 1080, h: 1920 }]) {
  const hz = html(Cards.build('days', { stocks, size: z, opts: { dbdSym: 'A' }, myLists: {}, screens: [], getDays: () => one }));
  check('eight weeks on the ' + z.id, rowsIn(hz) === 8);
}

console.log(`${ran} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
