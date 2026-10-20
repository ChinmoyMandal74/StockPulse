// grouplines.js: a group's line from its companies' quarterly series, for the
// Sector and Industry Lines cards (2026-10-20, the owner, of the Lines card:
// "Can I get this visual under sector where every line represents one sector,
// I should be able to plot this against these same measures ... multi-select
// sectors, The same should be under the Industry template as well").
//
// PURE: the server reads each member's stored series (line_series, built a
// slice a night by the Long run pass) and hands them here.
//
// HOW A GROUP IS ONE NUMBER, measure by measure, and the site's own rules for
// a group each time:
//   - a flow or a value (revenue, gross profit, operating income, net income,
//     free cash flow, market value): the SUM over its companies. The filings
//     are stored in dollars only (euros converted, other currencies not stored),
//     so the sum never adds two currencies;
//   - a margin: the summed numerator over the summed revenue, the aggregate
//     margin the Margins card uses, never an average of margins;
//   - P/E and P/S: summed market value over summed earnings or revenue (the
//     Valuation card's index P/E); no P/E when the group's earnings are not
//     positive;
//   - revenue growth: the summed trailing-year revenue against the same
//     companies' summed revenue a year earlier;
//   - the share price: the median company's return since the window's first
//     quarter end (see aggregate for why not an average).
//
// THE SAME COMPANIES IN EVERY QUARTER DRAWN. A company that starts filing, or
// stops, part-way through would move a sum by its whole size and read as
// growth or collapse. So a filed measure uses the companies with a figure in
// every quarter of the window; the count used and the count in the group come
// back with the line, and the card says them.
'use strict';

const KEYS = ['rev', 'gp', 'oi', 'ni', 'fcf', 'cap', 'px'];
const MIN_COMPANIES = 3;
// What each measure needs from each company, and how a quarter is made from
// the sums. `num`/`den` sum over the companies kept; `pos` keys must be above
// zero to count (a revenue of nothing is not a base).
const RULES = {
  rev: { need: ['rev'], pos: ['rev'], val: (s) => s.rev },
  gp: { need: ['gp'], val: (s) => s.gp },
  oi: { need: ['oi'], val: (s) => s.oi },
  ni: { need: ['ni'], val: (s) => s.ni },
  fcf: { need: ['fcf'], val: (s) => s.fcf },
  cap: { need: ['cap'], pos: ['cap'], val: (s) => s.cap },
  gm: { need: ['gp', 'rev'], pos: ['rev'], val: (s) => pct(s.gp / s.rev) },
  om: { need: ['oi', 'rev'], pos: ['rev'], val: (s) => pct(s.oi / s.rev) },
  pm: { need: ['ni', 'rev'], pos: ['rev'], val: (s) => pct(s.ni / s.rev) },
  fm: { need: ['fcf', 'rev'], pos: ['rev'], val: (s) => pct(s.fcf / s.rev) },
  pe: { need: ['cap', 'ni'], pos: ['cap'], val: (s) => (s.ni > 0 ? r2(s.cap / s.ni) : null) },
  ps: { need: ['cap', 'rev'], pos: ['cap', 'rev'], val: (s) => r2(s.cap / s.rev) },
};
const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (v) => r2(v * 100);
const ok = (v) => v != null && isFinite(Number(v));
const median = (xs) => { const a = xs.filter((x) => x != null && isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// A member's figure for a key at a quarter end, by date (members built on
// different nights may hold different quarter lists).
function at(m, key, q) {
  const i = m.index ? m.index.get(q) : (m.quarters || []).indexOf(q);
  if (i == null || i < 0) return null;
  const v = ((m.body || {})[key] || [])[i];
  return ok(v) ? Number(v) : null;
}
// The quarter end four before q in a member's own list (a year earlier).
function yearBefore(m, q) {
  const i = m.index ? m.index.get(q) : (m.quarters || []).indexOf(q);
  return i == null || i < 4 ? null : m.quarters[i - 4];
}
function indexed(members) {
  return (members || []).map((m) => Object.assign({}, m, { index: new Map((m.quarters || []).map((q, i) => [q, i])) }));
}

// The group's line over `quarters` (oldest first) for measure `mk`. `members`
// is [{ symbol, quarters, body: { rev: [...], ... } }]. Returns
// { values, used, of } (values null where no quarter can be drawn), or
// { values: null, used, of } when fewer than MIN_COMPANIES qualify.
function aggregate(members, quarters, mk) {
  const ms = indexed(members);
  const of = ms.length;
  const Q = quarters || [];
  if (mk === 'px') {
    // THE MEDIAN COMPANY'S RETURN since the window's first quarter end, at each
    // quarter end: what the typical member did. Measured on 2026-10-20 over ten
    // years: an equal-dollar average read Technology +2,065% and Energy +323%,
    // led by a few winners; compounding each quarter's average return read
    // Energy +1,221% (volatile small members pump it). The median read +347%
    // and +90%, beside a geometric average's +363% and +123%. A member counts
    // when it has a close at the first quarter end; a quarter with no close
    // carries its last.
    const kept = ms.filter((m) => { const p0 = at(m, 'px', Q[0]); return p0 != null && p0 > 0; });
    if (kept.length < MIN_COMPANIES) return { values: null, used: kept.length, of };
    const last = kept.map((m) => at(m, 'px', Q[0]));
    const base = last.slice();
    const values = Q.map((q) => {
      const rel = kept.map((m, k) => { const p = at(m, 'px', q); if (p != null && p > 0) last[k] = p; return last[k] / base[k]; });
      return r2((median(rel) - 1) * 100);
    });
    return { values, used: kept.length, of };
  }
  if (mk === 'rg') {
    // Growth: the same companies' revenue now and a year before, both above zero.
    const kept = ms.filter((m) => Q.every((q) => { const y = yearBefore(m, q); const a = at(m, 'rev', q), b = y ? at(m, 'rev', y) : null; return a != null && a > 0 && b != null && b > 0; }));
    if (kept.length < MIN_COMPANIES) return { values: null, used: kept.length, of };
    const values = Q.map((q) => {
      let now = 0, then = 0;
      for (const m of kept) { now += at(m, 'rev', q); then += at(m, 'rev', yearBefore(m, q)); }
      return then > 0 ? pct(now / then - 1) : null;
    });
    return { values, used: kept.length, of };
  }
  const R = RULES[mk];
  if (!R) return { values: null, used: 0, of };
  const kept = ms.filter((m) => Q.every((q) => R.need.every((k) => { const v = at(m, k, q); return v != null && (!(R.pos || []).includes(k) || v > 0); })));
  if (kept.length < MIN_COMPANIES) return { values: null, used: kept.length, of };
  const values = Q.map((q) => {
    const s = {};
    for (const k of R.need) s[k] = 0;
    for (const m of kept) for (const k of R.need) s[k] += at(m, k, q);
    return R.val(s);
  });
  return { values, used: kept.length, of };
}

// What a company contributes to a group for a measure that means nothing for a
// lender (gross profit and gross margin): the caller leaves lenders out first.
const NO_FIN = new Set(['gp', 'gm']);

module.exports = { KEYS, RULES, MIN_COMPANIES, NO_FIN, aggregate, median };
