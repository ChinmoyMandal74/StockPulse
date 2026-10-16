// THE NEXT REPORT DATE WHEN THE PROVIDER HAS NONE (2026-10-16, the owner:
// "Netflix earning is next tuesday and not yesterday").
//
// The provider's /earnings feed lists an upcoming date for very few stocks
// (18 of 1,276 on the day this was written), so the next date is nearly
// always ours. It used to be the last report plus 91 days. Netflix reported
// on 16 July, so that gave 15 October; it reports on Tuesday 20 October,
// which is exactly 52 weeks after it reported the same quarter last year
// (21 October 2025).
//
// THE SAME QUARTER LAST YEAR, PLUS 364 DAYS. A company keeps a yearly
// calendar, and 364 days is 52 weeks, so the weekday carries over. The
// year-ago report is the one nearest to (last + 91 - 364), within 25 days.
// Back-tested on 26,864 reported quarters that had a year-ago report:
//   last + 91       median miss 5 days, within a week 70.6%, exact 33.0%
//   year ago + 364  median miss 1 day,  within a week 89.0%, exact 42.3%
// With no year-ago report (a new listing, or a short history), or a result
// that does not fall 45 to 140 days after the last report, it falls back
// to the last report plus 91.
//
// IT FEEDS THE SIGNAL. The engine's "Earnings soon" rule reads this date,
// so the change moved verdicts: on the day, 83 stocks entered its 7-day
// window and 65 left it. That was the owner's decision.
(function (root) {
  'use strict';
  const DAY = 86400000;
  const ms = (d) => Date.parse(String(d).slice(0, 10) + 'T12:00:00Z');
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const WINDOW = 25, MIN_GAP = 45, MAX_GAP = 140;

  // `reported`: report dates (ISO, any order; may include `last`).
  // `last`: the latest report. -> { date, basis: 'year' | 'q91' } or null.
  function estimateNext(reported, last) {
    if (!last || !isFinite(ms(last))) return null;
    const L = ms(last);
    const target = L + (91 - 364) * DAY;
    let best = null;
    for (const d of reported || []) {
      const t = ms(d);
      if (!isFinite(t) || t >= L) continue;
      const e = Math.abs(t - target);
      if (e <= WINDOW * DAY && (!best || e < best.e)) best = { t, e };
    }
    if (best) {
      const next = best.t + 364 * DAY;
      const gap = (next - L) / DAY;
      if (gap >= MIN_GAP && gap <= MAX_GAP) return { date: iso(next), basis: 'year' };
    }
    return { date: iso(L + 91 * DAY), basis: 'q91' };
  }

  const api = { estimateNext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EarnDate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
