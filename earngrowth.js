// Who drove an index's earnings growth -- the arithmetic and nothing else.
// No network, no database: the secfacts.js / earnstudy.js shape, so every rule
// here is testable with no server. server.js reads the filings and hands them
// over.
//
// THE QUESTION (2026-10-09, owner, from an article saying two companies would
// supply a third of the S&P 500's earnings growth): for one calendar quarter,
// how much did the index's members earn against the same quarter a year
// earlier, and which companies is the difference made of?
//
// REPORTED, NOT FORECAST. The article's figures are analysts' estimates for a
// quarter not yet reported; no estimate is available on this plan. These are
// the quarters companies have actually filed, so the newest one here is
// always a quarter behind the headlines.
//
// NET INCOME, NOT EPS. An index's "EPS growth" is the growth of its members'
// summed earnings over a divisor; summed net income is the same reading
// without needing a share count per quarter (which a filing does not restate
// for a split). Each company's CONTRIBUTION is its own change in net income
// over the whole group's year-ago total, in points -- so the contributions
// add up to the group's growth EXACTLY, with no weights and nothing hidden.
(function (root) {
  'use strict';

  const DAY = 86400000;
  // A quarterly net income past this is not a company's: the largest real one
  // on file is two orders of magnitude under it. The filings carry the odd
  // value a thousand times out of scale (FactSet's 2018 revenue), and one of
  // those would BE the index's growth.
  const NI_MAX = 5e11;

  // WHICH CALENDAR QUARTER A FISCAL QUARTER BELONGS TO is decided by its
  // MIDDLE, not its end. Nvidia's quarter ends in late January and Micron's
  // in late August; by the end date those are Q1 and Q3, by where the three
  // months actually fall they are Q4 and Q3, which is how every index
  // earnings series assigns them. It is also what keeps a 52/53-week year,
  // whose period ends on 1 to 5 January, in Q4 where it belongs.
  function quarterOf(periodEnd) {
    const t = Date.parse(String(periodEnd) + 'T00:00:00Z');
    if (!isFinite(t)) return null;
    const mid = new Date(t - 45 * DAY);
    return mid.getUTCFullYear() + 'Q' + (Math.floor(mid.getUTCMonth() / 3) + 1);
  }
  const prevYear = (q) => (Number(q.slice(0, 4)) - 1) + q.slice(4);
  const qIndex = (q) => Number(q.slice(0, 4)) * 4 + Number(q.slice(5)) - 1;
  const qLabel = (q) => 'Q' + q.slice(5) + ' ' + q.slice(0, 4);

  // One company's quarters: { '2026Q2': { ni, end } }. `rows` are its filed
  // quarterly rows, any order. Where two land in one calendar quarter (a
  // changed fiscal year end) the later period wins.
  function byQuarter(rows) {
    const out = {};
    for (const r of rows || []) {
      if (!r || r.periodType !== 'Q' || r.netIncome == null) continue;
      const ni = Number(r.netIncome);
      if (!isFinite(ni) || Math.abs(ni) > NI_MAX) continue;
      const q = quarterOf(r.periodEnd);
      if (!q) continue;
      if (!out[q] || String(r.periodEnd) > out[q].end) out[q] = { ni, end: String(r.periodEnd) };
    }
    return out;
  }

  // members: [{ symbol, rows }]. Returns the quarters newest first.
  //
  // A COMPANY COUNTS IN A QUARTER ONLY WHERE IT HAS BOTH ENDS -- the quarter
  // and the same quarter a year earlier, 320 to 410 days apart. A company
  // with one end missing is ABSENT from both sums, never a zero in one of
  // them: a missing year-ago figure read as zero would make its whole profit
  // "growth".
  function build(members, opts) {
    const o = opts || {};
    const keep = o.keep || 25;
    const cos = (members || []).map((m) => ({ symbol: m.symbol, q: byQuarter(m.rows) }));
    const all = new Set();
    for (const c of cos) for (const k of Object.keys(c.q)) all.add(k);
    const quarters = [];
    for (const q of [...all].sort((a, b) => qIndex(b) - qIndex(a))) {
      const py = prevYear(q);
      const rows = [];
      for (const c of cos) {
        const a = c.q[q], b = c.q[py];
        if (!a || !b) continue;
        const gap = (Date.parse(a.end) - Date.parse(b.end)) / DAY;
        if (!(gap >= 320 && gap <= 410)) continue;
        rows.push({ s: c.symbol, cur: a.ni, prev: b.ni, d: a.ni - b.ni });
      }
      if (!rows.length) continue;
      const cur = rows.reduce((s, r) => s + r.cur, 0);
      const base = rows.reduce((s, r) => s + r.prev, 0);
      // A group that lost money a year ago has no growth RATE: the sign of a
      // percentage off a negative base inverts. The quarter is kept with its
      // dollar change and a null rate, and the card says so.
      const den = base > 0 ? base : null;
      const pts = (d) => (den ? 100 * d / den : null);
      rows.sort((x, y) => y.d - x.d);
      const without = (k) => {
        const rest = rows.slice(k);
        const c2 = rest.reduce((s, r) => s + r.cur, 0), b2 = rest.reduce((s, r) => s + r.prev, 0);
        return b2 > 0 ? 100 * (c2 - b2) / b2 : null;
      };
      const ups = rows.filter((r) => r.d > 0), dns = rows.filter((r) => r.d < 0).reverse();
      const pack = (r) => ({ s: r.s, cur: r.cur, prev: r.prev, pts: pts(r.d) });
      const pool = (list) => ({ n: list.length, d: list.reduce((s, r) => s + r.d, 0), pts: pts(list.reduce((s, r) => s + r.d, 0)) });
      quarters.push({
        q, label: qLabel(q), n: rows.length, members: cos.length,
        cur, base, change: cur - base, growth: pts(cur - base),
        ex2: without(2), ex5: without(5),
        upN: ups.length, dnN: dns.length,
        up: ups.slice(0, keep).map(pack), restUp: pool(ups.slice(keep)),
        dn: dns.slice(0, keep).map(pack), restDn: pool(dns.slice(keep)),
      });
    }
    return quarters;
  }

  // THE QUARTER TO LEAD WITH is the newest one most of the index has filed.
  // The newest quarter of all is always half-reported for weeks, and its
  // "growth" is whatever the early reporters happened to earn.
  function settled(quarters, share) {
    const need = share == null ? 0.8 : share;
    const i = (quarters || []).findIndex((x) => x.members && x.n / x.members >= need);
    return i < 0 ? 0 : i;
  }

  const api = { build, byQuarter, quarterOf, qLabel, settled, NI_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EarnGrowth = api;
})(typeof window !== 'undefined' ? window : globalThis);
