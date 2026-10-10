// Euro reference rates -> a book that can price a period. Pure: no database,
// no network. server.js and fx-load.js fetch the file and store the rows.
//
// WHY THESE RATES. A company that reports in euros is shown here in dollars,
// and "in dollars" has to mean something a reader could check. The European
// Central Bank publishes one euro reference rate per currency per working
// day, back to the euro's first day in 1999, free and without a key:
//
//   https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml       all of it (~8MB)
//   https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml   the last 90 days
//
// A rate there is DOLLARS PER ONE EURO (1.1206 on 2026-10-09), so a euro
// figure times the rate is the dollar figure.
//
// WHICH RATE FOR WHICH NUMBER is the accountants' own convention, and it is
// the reason a single "today's rate" would be wrong twice:
//
//   a FLOW (revenue, profit, cash flow, earnings per share) was earned across
//     a period, so it takes the AVERAGE of the daily rates over that period;
//   a POSITION (assets, cash, debt) is a balance on one date, so it takes the
//     rate ON that date -- or the last working day before it.
//
// Converting 2019's revenue at today's rate would restate the past every
// time the euro moved, and growth from one year to the next would be the
// currency's growth as much as the company's.
//
// ONLY THE EURO, for now (the owner's instruction, 2026-10-10). The file
// carries about thirty currencies against the euro, so another reporting
// currency is a cross rate away -- but nothing here computes one yet.
(function (root) {
  'use strict';

  // One <Cube time="YYYY-MM-DD"> per day, holding <Cube currency="USD" rate="…"/>.
  // Read with a pattern rather than an XML parser: the file is machine-made,
  // flat, and this needs one attribute from each day.
  function parseEcb(xml) {
    const out = [];
    const text = String(xml || '');
    const day = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g;
    let m;
    while ((m = day.exec(text))) {
      const u = /currency=["']USD["']\s+rate=["']([\d.]+)["']/.exec(m[2]);
      const v = u ? Number(u[1]) : NaN;
      // A rate outside this band is not a euro-dollar rate; it has been
      // between 0.82 and 1.60 for the whole of the euro's life.
      if (isFinite(v) && v > 0.5 && v < 2.5) out.push({ d: m[1], usd: v });
    }
    out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return out;
  }

  // A book over stored rows [{ d, usd }], any order.
  function book(rows) {
    const list = (rows || []).filter((r) => r && r.d && isFinite(Number(r.usd)) && Number(r.usd) > 0)
      .map((r) => ({ d: String(r.d), usd: Number(r.usd) }))
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const first = list.length ? list[0].d : null;
    const last = list.length ? list[list.length - 1].d : null;
    // index of the last row on or before `d`, or -1
    const floor = (d) => {
      let lo = 0, hi = list.length - 1, at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].d <= d) { at = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return at;
    };
    const DAY = 86400000;
    const gap = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

    // The rate ON a date: that day's, or the last working day before it.
    // NEVER a rate from further back than `MAX_STALE` days -- a balance sheet
    // dated after the rates end has no rate, and the nearest one is a guess.
    const MAX_STALE = 7;
    function at(d) {
      if (!d) return null;
      const i = floor(String(d));
      if (i < 0) return null;
      return gap(list[i].d, String(d)) <= MAX_STALE ? list[i].usd : null;
    }

    // The average over a period, both ends included. Null unless the rates
    // COVER the period: a year averaged over its first eight months is not
    // that year's average, and would be wrong by exactly the move it missed.
    function avg(start, end) {
      if (!start || !end || String(start) > String(end) || !list.length) return null;
      const s = String(start), e = String(end);
      if (gap(first, s) < -MAX_STALE || gap(e, last) < -MAX_STALE) return null;
      let i = floor(s);
      if (i < 0 || list[i].d < s) i++;
      let sum = 0, n = 0;
      for (; i < list.length && list[i].d <= e; i++) { sum += list[i].usd; n++; }
      // A quarter has about 63 working days; fewer than half a period's worth
      // means a hole in the stored rates rather than a short period.
      const want = Math.max(1, Math.floor((gap(s, e) + 1) * 5 / 7 * 0.5));
      return n >= want ? sum / n : null;
    }

    return { at, avg, first, last, n: list.length };
  }

  const api = { parseEcb, book,
    HIST_URL: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
    RECENT_URL: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
