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
// EVERY CURRENCY THE FILE CARRIES (2026-10-10, the owner, an hour after
// "only the euro": "we should convert the other currencies too"). The file
// quotes about thirty currencies against the euro, each as UNITS PER ONE
// EURO, so dollars per one unit of any of them is a cross rate taken on
// the same day from the same publication:
//
//   dollars per CAD = (dollars per euro) / (CAD per euro)
//
// Both legs are the ECB's own reference rates for that day, so nothing is
// mixed across sources or times of day.
//
// THE TAIWAN DOLLAR IS NOT IN IT, and three filers report in one, TSMC
// among them. That one currency comes from Twelve Data's daily USD/TWD
// series instead (5,000 sessions, back to 2008, one credit): a market
// close rather than a central bank's reference rate, which over a quarter's
// average is the same number to three figures. `sourceOf` says which, and
// the stored rows are the same shape either way.
(function (root) {
  'use strict';

  // One <Cube time="YYYY-MM-DD"> per day, holding <Cube currency="USD" rate="…"/>.
  // Read with a pattern rather than an XML parser: the file is machine-made,
  // flat, and this needs one attribute from each day.
  // Currencies converted, and where each one's rate comes from. Explicit
  // rather than "whatever the file has": the file still lists currencies
  // that no longer exist (the lat, the kroon), and a filer cannot report in
  // those. A reporting currency not named here stays unconverted and is
  // recorded as that.
  const ECB_CCYS = ['EUR', 'GBP', 'CAD', 'CHF', 'JPY', 'DKK', 'SEK', 'NOK', 'AUD', 'NZD', 'HKD', 'SGD',
    'KRW', 'CNY', 'INR', 'BRL', 'MXN', 'ZAR', 'ILS', 'PLN', 'CZK', 'HUF', 'TRY', 'THB', 'MYR', 'IDR', 'PHP'];
  const TD_CCYS = ['TWD'];
  const sourceOf = (ccy) => (ECB_CCYS.includes(ccy) ? 'ecb' : TD_CCYS.includes(ccy) ? 'twelvedata' : null);
  const supports = (ccy) => sourceOf(ccy) != null;

  // The whole file in one pass: { CCY: [{ d, usd }] }, dollars per one unit.
  // A day on which either leg is missing has no rate for that currency --
  // the real is absent before 2008 and the rupee before 2009.
  function parseEcbAll(xml, want) {
    const pick = new Set(want || ECB_CCYS);
    const out = {};
    for (const c of pick) out[c] = [];
    const text = String(xml || '');
    const day = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g;
    const rate = /currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']/g;
    let m;
    while ((m = day.exec(text))) {
      const per = {};
      let r;
      rate.lastIndex = 0;
      while ((r = rate.exec(m[2]))) per[r[1]] = Number(r[2]);
      const usd = per.USD;
      if (!(usd > 0.5 && usd < 2.5)) continue;        // not a euro-dollar rate
      for (const c of pick) {
        if (c === 'EUR') { out.EUR.push({ d: m[1], usd }); continue; }
        const x = per[c];
        if (x > 0 && isFinite(x)) out[c].push({ d: m[1], usd: usd / x });
      }
    }
    for (const c of pick) out[c].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return out;
  }

  // Twelve Data's `time_series` values for USD/<CCY>: units of the currency
  // per one dollar at each close, newest first. Dollars per unit is the
  // reciprocal.
  function parseTd(values) {
    const out = [];
    for (const v of values || []) {
      const c = Number(v && v.close);
      const d = v && String(v.datetime || '').slice(0, 10);
      if (d && c > 0 && isFinite(c)) out.push({ d, usd: 1 / c });
    }
    out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return out;
  }

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

  const api = { parseEcb, parseEcbAll, parseTd, book, supports, sourceOf, ECB_CCYS, TD_CCYS,
    HIST_URL: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
    RECENT_URL: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
