// The long-run figures from a company's own filings -- the arithmetic and
// nothing else. No network, no database: the margins.js shape. server.js reads
// the filings and hands them over.
//
// (2026-10-19, the owner, after looking at Macrotrends' screener: growth over
// several years, valuation against the stock's own past, the dividend record
// and financial health.) This file starts with the first of those.
//
//   growth()   revenue and net income, compound yearly growth over three and
//              five years, for the screener's Long run group.
//
// DISPLAY ONLY. Nothing here is read by the Signal rules.
'use strict';

const EarnGrowth = require('./earngrowth.js');

const DAY = 86400000;
// A quarterly figure past these is not a company's (margins.js, earngrowth.js).
const REV_MAX = 5e11;
const NI_MAX = EarnGrowth.NI_MAX;
// The newest period must be this recent, or the company has stopped filing and
// its "growth now" is growth then. A quarter is reported within about 45 days
// of its end; a year can take 120 more for a foreign filer.
const Q_STALE_DAYS = 230;
const FY_STALE_DAYS = 460;
// A yearly rate past this is a base too small to measure from, not growth.
const GROWTH_MAX = 1000;
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));   // a null is not a zero
const qIndex = (q) => Number(q.slice(0, 4)) * 4 + Number(q.slice(5)) - 1;
const daysBetween = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY;

// One field's quarters by calendar-quarter index (earngrowth.js's rule: a
// fiscal quarter belongs where its middle falls). Where two periods land in one
// calendar quarter (a changed year end) the later one wins.
function quarters(rows, field, max) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || r.periodType !== 'Q') continue;
    const v = num(r[field]);
    if (v == null || Math.abs(v) > max) continue;
    const q = EarnGrowth.quarterOf(r.periodEnd);
    if (!q) continue;
    const i = qIndex(q);
    const had = out.get(i);
    if (had && had.end >= String(r.periodEnd)) continue;
    out.set(i, { end: String(r.periodEnd), v });
  }
  return out;
}

// The four quarters ending at index i, summed; null unless all four are there.
function ttmAt(q, i) {
  let t = 0;
  for (let k = i - 3; k <= i; k++) {
    const x = q.get(k);
    if (!x) return null;
    t += x.v;
  }
  return t;
}

// Compound yearly growth from `then` to `now` over `years`, in percent. BOTH
// ENDS MUST BE POSITIVE: from a loss there is no rate (the sign inverts, and
// "from -1 to +5" is not +600% a year in any useful sense), and from nothing
// there is no base.
function cagr(now, then, years) {
  if (now == null || then == null || !(now > 0) || !(then > 0)) return null;
  const g = (Math.pow(now / then, 1 / years) - 1) * 100;
  if (!isFinite(g) || Math.abs(g) > GROWTH_MAX) return null;
  return Math.round(g * 100) / 100;
}

// A row's figure in the company's OWN currency. A foreign filer's rows are
// converted to dollars when read (secfacts.js toDollars), each period at its
// own average rate, so a growth rate between two of them would carry the
// currency's move as well as the company's. Dividing the rate back out undoes
// that; a row without its rate is no use for growth.
function own(r, field) {
  const v = num(r[field]);
  if (v == null) return null;
  if (!r.currency) return v;
  const fx = num(r.fxAvg);
  return fx && fx > 0 ? v / fx : null;
}

// ---- growth over three and five years ---------------------------------------
//
// TRAILING FOUR QUARTERS NOW AGAINST THE SAME FOUR QUARTERS THREE AND FIVE
// YEARS EARLIER, where the company files quarters in dollars. A year of four
// quarters ending at each end, so a seasonal business compares like with like
// and nothing waits a year for the next annual report.
//
// THE ANNUAL REPORTS INSTEAD, in the company's own currency, where it files in
// another currency (a 20-F is annual only, and a derived quarter carries no
// rate to divide out) or has no quarterly trailing year at all. The newest
// fiscal year against the one ending three or five years before it, matched
// on the date within six weeks.
//
// Revenue and net income are separate: a bank files no revenue line and still
// has a net income, and a company with a loss at either end has a revenue rate
// and no net income one. Each figure is null on its own; nothing is ever a 0.
//
// rows: latestFilled rows for one company. today: 'YYYY-MM-DD'.
// Returns { rev3, rev5, ni3, ni5, end, basis } or null when there is nothing.
function growth(rows, today) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const t = today || new Date().toISOString().slice(0, 10);
  const foreign = list.some((r) => r && r.currency);
  if (!foreign) {
    const rev = quarters(list, 'revenue', REV_MAX), ni = quarters(list, 'netIncome', NI_MAX);
    const all = [...rev.keys(), ...ni.keys()];
    if (all.length) {
      const last = Math.max(...all);
      const end = (rev.get(last) || ni.get(last)).end;
      const fresh = daysBetween(end, t) <= Q_STALE_DAYS;
      const revNow = fresh ? ttmAt(rev, last) : null, niNow = fresh ? ttmAt(ni, last) : null;
      if (revNow != null || niNow != null) {
        // A revenue quarter must itself be positive: a negative "revenue" is
        // a reversal filed under the tag, and summing it hides the fault.
        const posRev = (i) => { for (let k = i - 3; k <= i; k++) { const x = rev.get(k); if (!x || !(x.v > 0)) return false; } return true; };
        const at = (q, n) => ttmAt(q, last - 4 * n);
        const out = {
          rev3: posRev(last) && posRev(last - 12) ? cagr(revNow, at(rev, 3), 3) : null,
          rev5: posRev(last) && posRev(last - 20) ? cagr(revNow, at(rev, 5), 5) : null,
          ni3: cagr(niNow, at(ni, 3), 3),
          ni5: cagr(niNow, at(ni, 5), 5),
          end, basis: 'q',
        };
        return out.rev3 == null && out.rev5 == null && out.ni3 == null && out.ni5 == null ? null : out;
      }
    }
  }
  // The annual path.
  const fy = list.filter((r) => r && r.periodType === 'FY' && r.periodEnd)
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
  if (!fy.length) return null;
  const top = fy[0];
  if (!(daysBetween(top.periodEnd, t) <= FY_STALE_DAYS)) return null;
  const back = (n) => {
    const want = new Date(top.periodEnd + 'T00:00:00Z');
    want.setUTCFullYear(want.getUTCFullYear() - n);
    const w = want.toISOString().slice(0, 10);
    let best = null, gap = Infinity;
    for (const r of fy) { const g = Math.abs(daysBetween(r.periodEnd, w)); if (g < gap) { gap = g; best = r; } }
    return gap <= 45 ? best : null;
  };
  const val = (r, f) => {
    if (!r) return null;
    const v = own(r, f);
    return v == null || Math.abs(v) > (f === 'revenue' ? REV_MAX : NI_MAX) * 4 ? null : v;
  };
  const b3 = back(3), b5 = back(5);
  const out = {
    rev3: cagr(val(top, 'revenue'), val(b3, 'revenue'), 3),
    rev5: cagr(val(top, 'revenue'), val(b5, 'revenue'), 5),
    ni3: cagr(val(top, 'netIncome'), val(b3, 'netIncome'), 3),
    ni5: cagr(val(top, 'netIncome'), val(b5, 'netIncome'), 5),
    end: top.periodEnd, basis: 'fy',
  };
  return out.rev3 == null && out.rev5 == null && out.ni3 == null && out.ni5 == null ? null : out;
}

// How far back the filings must reach for growth(): five years before a
// trailing year that began nearly a year before a quarter up to 230 days old,
// or five years before an annual report up to 460 days old, with room.
const GROWTH_YEARS = 6.8;

module.exports = { growth, cagr, quarters, ttmAt, own, GROWTH_YEARS, GROWTH_MAX, Q_STALE_DAYS, FY_STALE_DAYS };
