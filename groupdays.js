// Day by day: the last eight weeks, a row a week and a column a weekday, for
// one company or for a GROUP (the market, a sector, a theme).
//
// (2026-10-22, the owner: "create a promo similar to month by month and call
// it Day by Day, Only limit it to last 8 weeks hardcoded, Apply it anywhere we
// have the month by month sub template".) groupmonths.js has the month cards'
// reasoning; this is the same card one scale down.
//
// THE CALENDAR IS THE S&P 500 FUND'S. Its bar dates are the sessions: a day it
// has no bar for (a holiday) is no cell at all, and a company's return on a
// session is struck against the session before it on that calendar. BOTH ENDS
// MUST BE ON FILE: a company with a hole in its bars has no return for the day
// after the hole, rather than a two-day move filed under one day.
//
// A GROUP'S DAY is the plain average of its members' returns that day, EQUAL
// WEIGHT, today's members (groupmonths.js says why, and the card says so).
// Funds are not members.
//
// EIGHT WEEKS, HARDCODED: the week of the newest session and the seven before
// it, Monday to Friday. About 41 closes a company, so the whole universe is
// one bounded read of about 54,000 bar rows, done once a day and stored. A
// card reads the stored value.
//
// PURE. The route does the reads and hands them over. Display only: nothing
// here reaches the Signal.
const GroupMonths = require('./groupmonths.js');
const WEEKS = 8;
const MIN_CLOSE = 0.01;          // server.js's own floor: a sub-cent bar is not a price
const DAY = 86400000;
// A BREAK IN THE SERIES IS NOT A RETURN (groupmonths.js, MAX_MONTH): a day
// past ten times is a reorganisation or a bad bar, left out and reported.
const MAX_DAY = 1000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const noon = (d) => Date.parse(d + 'T12:00:00Z');

// The Monday of the week a date falls in.
function mondayOf(d) {
  const t = noon(d), wd = new Date(t).getUTCDay();      // 0 Sunday .. 6 Saturday
  return iso(t - ((wd + 6) % 7) * DAY);
}
// The first day drawn: the Monday seven weeks before the newest session's.
function windowStart(latest, weeks) {
  return iso(noon(mondayOf(latest)) - ((weeks || WEEKS) - 1) * 7 * DAY);
}
// The sessions drawn, and the one before the first (every return needs it).
// `calendar` is the fund's bar dates, any order.
function plan(calendar, weeks) {
  const cal = [...new Set((calendar || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))))].sort();
  if (!cal.length) return { start: null, latest: null, days: [], base: null };
  const latest = cal[cal.length - 1];
  const start = windowStart(latest, weeks);
  const days = cal.filter((d) => d >= start);
  const before = cal.filter((d) => d < start);
  return { start, latest, days, base: before.length ? before[before.length - 1] : null };
}
// One series' return on each session drawn, or null. `closes` maps a date to
// its close. The session before each day is the calendar's, never the
// series' own previous bar.
function daily(closes, P) {
  const get = (d) => { const c = closes && (closes.get ? closes.get(d) : closes[d]); const n = Number(c); return c == null || !(n >= MIN_CLOSE) ? null : n; };
  const out = [];
  for (let k = 0; k < P.days.length; k++) {
    const prev = k ? P.days[k - 1] : P.base;
    const a = prev ? get(prev) : null, b = get(P.days[k]);
    const v = a != null && b != null ? (b / a - 1) * 100 : null;
    out.push(v != null && v > MAX_DAY ? null : v == null ? null : Math.round(v * 100) / 100);
  }
  return out;
}
// Bars as readBars or readBarsWindow return them ({ datetime | d, close }) into
// a date -> close map.
function closeMap(bars) {
  const m = new Map();
  for (const b of bars || []) {
    const d = String(b.datetime || b.d || '').slice(0, 10);
    if (d.length === 10 && b.close != null && b.close !== '') m.set(d, Number(b.close));
  }
  return m;
}

// ONE COMPANY: its returns and the fund's, on the fund's calendar.
function forStock(o) {
  const benchMap = closeMap(o.benchBars);
  const P = plan([...benchMap.keys()], o.weeks);
  return { symbol: o.symbol || null, latest: P.latest, days: P.days, r: daily(closeMap(o.bars), P), idx: daily(benchMap, P) };
}

// EVERY GROUP AT ONCE. rows: snapshot rows (symbol, sector, instrumentType,
// spMember, ndxMember). themesOf(symbol) -> [theme names]. barsBySym: Map or
// object symbol -> bars. benchBars: the fund's bars.
function build(o) {
  const benchMap = closeMap(o.benchBars);
  const P = plan([...benchMap.keys()], o.weeks);
  const groups = {};
  const slot = (key) => groups[key] || (groups[key] = { members: 0, sum: P.days.map(() => 0), n: P.days.map(() => 0) });
  const broken = [];
  let companies = 0;
  for (const row of o.rows || []) {
    if (!row || !row.symbol || row.error || row.instrumentType === 'ETF') continue;
    const sym = String(row.symbol).toUpperCase();
    const bars = o.barsBySym && (o.barsBySym.get ? o.barsBySym.get(sym) : o.barsBySym[sym]);
    const m = closeMap(bars);
    const r = daily(m, P);
    for (let k = 0; k < P.days.length; k++) {
      if (r[k] != null) continue;
      const prev = k ? P.days[k - 1] : P.base, a = m.get(prev), b = m.get(P.days[k]);
      if (a >= MIN_CLOSE && b >= MIN_CLOSE && (b / a - 1) * 100 > MAX_DAY) broken.push(sym + ' ' + P.days[k]);
    }
    companies++;
    for (const key of GroupMonths.groupsOf(row, o.themesOf ? o.themesOf(sym) : [])) {
      const g = slot(key);
      g.members++;
      for (let k = 0; k < P.days.length; k++) if (r[k] != null && Number.isFinite(r[k])) { g.sum[k] += r[k]; g.n[k]++; }
    }
  }
  const out = {};
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    // A day nobody has a return for is absent, never zero.
    out[key] = { members: g.members, n: g.n, r: g.sum.map((s, k) => (g.n[k] ? Math.round((s / g.n[k]) * 100) / 100 : null)) };
  }
  return { latest: P.latest, weeks: o.weeks || WEEKS, start: P.start, days: P.days, idx: daily(benchMap, P), companies, broken, groups: out };
}

module.exports = { WEEKS, MAX_DAY, mondayOf, windowStart, plan, daily, closeMap, forStock, build };
