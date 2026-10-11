// Corporate margins from the filings -- the arithmetic and nothing else.
// No network, no database: the earngrowth.js shape. server.js reads the
// filings and hands them over.
//
// TWO QUESTIONS (2026-10-10, the owner: "is there good data on understanding
// corporate margin"). The filings already held every company's revenue and
// profit by quarter; what nothing did was add them up.
//
//   build()   a group's margin over time, and its sectors' now against a
//             year ago: the index-level series the commentary quotes.
//   change()  one company's margin now against a year ago, in points, for
//             the screener column.
//
// A GROUP'S MARGIN IS TOTAL PROFIT OVER TOTAL REVENUE, never the average of
// its companies' margins. An average lets a ten-million-dollar company
// losing three times its revenue outweigh Walmart; the total is what the
// group actually kept of what it actually sold.
//
// TRAILING FOUR QUARTERS AT EVERY POINT. A single quarter's margin is
// seasonal -- a retailer's fourth quarter, an insurer's storm quarter -- and
// a line of them is mostly the calendar. Four quarters ending at each point
// is one full year each time, so the line moves only when the business does.
//
// THE SAME COMPANIES AT EVERY POINT. A company counts only if it has every
// quarter the window needs. Letting membership drift would draw a company's
// arrival as a change in margin: add one large low-margin filer halfway
// along and "margins fell". The count that qualified is returned, and the
// card prints it.
//
// CALENDAR QUARTERS, by the middle of the fiscal quarter: earngrowth.js's
// own rule and its own function, so the two cards place Nvidia's January
// quarter in the same column.
'use strict';

const EarnGrowth = require('./earngrowth.js');

// A quarterly figure past these is not a company's. The filings carry the odd
// value a thousand times out of scale, and one of those would BE the total.
const REV_MAX = 5e11;
const NI_MAX = EarnGrowth.NI_MAX;

// The measures. `f` is the row field over revenue.
const METRICS = {
  net: { f: 'netIncome', label: 'Net margin', lower: 'net margin', what: 'net income' },
  op: { f: 'operatingIncome', label: 'Operating margin', lower: 'operating margin', what: 'operating income' },
  gross: { f: 'grossProfit', label: 'Gross margin', lower: 'gross margin', what: 'gross profit' },
  fcf: { f: 'freeCashFlow', label: 'Free cash flow margin', lower: 'free cash flow margin', what: 'free cash flow' },
};
const qIndex = (q) => Number(q.slice(0, 4)) * 4 + Number(q.slice(5)) - 1;
const qOf = (i) => Math.floor(i / 4) + 'Q' + (i % 4 + 1);
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));   // a null is not a zero

// One company's quarters by calendar-quarter index: { rev, netIncome, ... }.
// A quarter with no usable revenue is absent. Where two periods land in one
// calendar quarter (a changed year end) the later one wins.
function byQuarter(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || r.periodType !== 'Q') continue;
    const rev = num(r.revenue);
    if (rev == null || !(rev > 0) || rev > REV_MAX) continue;
    const q = EarnGrowth.quarterOf(r.periodEnd);
    if (!q) continue;
    const i = qIndex(q);
    const had = out.get(i);
    if (had && String(had.end) >= String(r.periodEnd)) continue;
    const o = { end: String(r.periodEnd), rev };
    for (const k of Object.keys(METRICS)) {
      const v = num(r[METRICS[k].f]);
      o[k] = v == null || Math.abs(v) > NI_MAX ? null : v;
    }
    out.set(i, o);
  }
  return out;
}

// The four quarters ending at index `i`: { rev, v } for one measure, or null
// unless all four are there with that measure on each.
function ttm(q, i, metric) {
  let rev = 0, v = 0;
  for (let k = i - 3; k <= i; k++) {
    const x = q.get(k);
    if (!x || x[metric] == null) return null;
    rev += x.rev; v += x[metric];
  }
  return rev > 0 ? { rev, v } : null;
}

// members: [{ symbol, sector, rows }]. opts.points: how many points (default
// 17, four years and the one before them). Returns null when nothing can be
// drawn.
function build(members, opts) {
  const o = opts || {};
  const P = Math.max(5, Number(o.points) || 17);
  const cos = (members || []).map((m) => ({ symbol: m.symbol, sector: m.sector || null, q: byQuarter(m.rows) }));
  if (!cos.length) return null;
  // THE LEAD is the newest calendar quarter most of the group has filed; the
  // newest of all is half-reported for weeks.
  const have = new Map();
  for (const c of cos) for (const i of c.q.keys()) have.set(i, (have.get(i) || 0) + 1);
  const need = (o.share == null ? 0.8 : o.share) * cos.length;
  const lead = [...have.keys()].sort((a, b) => b - a).find((i) => have.get(i) >= need);
  if (lead == null) return null;
  const idx = [];
  for (let i = lead - P + 1; i <= lead; i++) idx.push(i);

  const metrics = {};
  for (const m of Object.keys(METRICS)) {
    // The panel: every point present, for this measure.
    const panel = [];
    for (const c of cos) {
      const pts = idx.map((i) => ttm(c.q, i, m));
      if (pts.every(Boolean)) panel.push({ c, pts });
    }
    if (panel.length < 3) { metrics[m] = { n: 0, series: [], sectors: [] }; continue; }
    const at = (list, k) => {
      let rev = 0, v = 0;
      for (const p of list) { rev += p.pts[k].rev; v += p.pts[k].v; }
      return rev > 0 ? 100 * v / rev : null;
    };
    const series = idx.map((_, k) => at(panel, k));
    const by = {};
    for (const p of panel) if (p.c.sector) (by[p.c.sector] = by[p.c.sector] || []).push(p);
    const sectors = Object.keys(by).filter((s) => by[s].length >= 3).map((s) => ({
      sector: s, n: by[s].length, now: at(by[s], P - 1), prev: at(by[s], P - 5),
    })).filter((s) => s.now != null);
    metrics[m] = { n: panel.length, series, sectors };
  }
  return { lead: qOf(lead), quarters: idx.map(qOf), members: cos.length, metrics };
}

// One company: its trailing-year net margin now, and the trailing year
// before it. Null unless eight consecutive calendar quarters are on file and
// the newest is recent, and unless both margins are within +/-100%: a company
// with almost no revenue has a margin of minus several thousand percent, and
// a change in that is noise with a decimal point.
function change(rows, today) {
  const q = byQuarter(rows);
  if (!q.size) return null;
  const last = Math.max(...q.keys());
  const a = ttm(q, last, 'net'), b = ttm(q, last - 4, 'net');
  if (!a || !b) return null;
  const end = q.get(last).end;
  const t = Date.parse((today || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  if (!(t - Date.parse(end + 'T00:00:00Z') <= 230 * 86400000)) return null;      // stopped filing
  const now = 100 * a.v / a.rev, prev = 100 * b.v / b.rev;
  if (Math.abs(now) > 100 || Math.abs(prev) > 100) return null;
  return { now, prev, end };
}

module.exports = { METRICS, REV_MAX, build, change, byQuarter, ttm, qIndex, qOf };
