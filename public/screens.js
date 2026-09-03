// The seven analysis screens, defined once.
//
// These used to live inline in analysis.html, which was fine while the page was
// the only thing that ran them. The nightly refresh email reports the same
// screens, and a second copy of "what counts as bouncing off the lows" would
// have drifted from the page within a month — the same reason rowcard.js exists.
//
// Only the *selection* lives here: which rows a screen contains and in what
// order. How a screen is drawn — its columns, its prose, its empty message —
// stays with whichever surface is drawing it, because a table and an email want
// different things.
//
// Loaded as a plain <script> by the page and required() by server.js, so it has
// to work in both. No build step to bridge them.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Screens = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const num = (n) => n != null && isFinite(n);

  // Where a stock sits in its own 52-week range, 0 = on the low. Older
  // snapshots predate the field, so fall back to distance from the high.
  const rangePos = (x) => (num(x.range52Pos) ? x.range52Pos : null);
  const lowInRange = (x) => (num(x.range52Pos)
    ? x.range52Pos <= 30
    : (num(x.pctFromHigh) && x.pctFromHigh <= -25));

  // Surprises above this are feed artefacts, not results — two different
  // mega-caps currently report exactly +214%, which is not a coincidence.
  const SURPRISE_CAP = 100;

  // Whole days from midnight today to an ISO date: negative is the past.
  function dayDelta(iso, today) {
    if (!iso) return null;
    const t = new Date(iso);
    if (isNaN(t)) return null;
    return Math.round((t - today) / 86400000);
  }

  // Server-derived now, so the page, the export and the chatbot all read one
  // number. The fallback keeps snapshots written before the field existed working.
  const fcfYield = (x) => (num(x.fcfYield) ? x.fcfYield
    : ((num(x.fcfTtm) && x.marketCap) ? (x.fcfTtm / x.marketCap) * 100 : null));

  const SCREENS = [
    {
      id: 'bounce',
      title: 'Bouncing off the lows',
      blurb: 'low in the 52-week range but rising over both the last month and the last fortnight',
      test: (x) => lowInRange(x)
        && num(x.oneMonthPct) && x.oneMonthPct > 3
        && num(x.twoWeekPct) && x.twoWeekPct > 0,
      sort: (a, b) => (rangePos(a) ?? 999) - (rangePos(b) ?? 999) || a.pctFromHigh - b.pctFromHigh,
    },
    {
      id: 'waking',
      title: 'Just started moving',
      blurb: 'up more than 5% in a fortnight while still negative over three months',
      test: (x) => num(x.twoWeekPct) && x.twoWeekPct > 5
        && num(x.threeMonthPct) && x.threeMonthPct < 0,
      sort: (a, b) => b.twoWeekPct - a.twoWeekPct,
    },
    {
      id: 'drift',
      title: 'Drifting after a beat',
      blurb: 'beat consensus by more than 10% and reported within the last three weeks',
      test: (x, ctx) => num(x.lastSurprise) && x.lastSurprise > 10
        && x.lastSurprise <= SURPRISE_CAP
        && x.lastEarningsDate
        && -ctx.days(x.lastEarningsDate) <= 21 && -ctx.days(x.lastEarningsDate) >= 0,
      sort: (a, b) => b.lastSurprise - a.lastSurprise,
    },
    {
      id: 'earnings',
      title: 'Reporting in the next 14 days',
      blurb: 'a catalyst and a risk in the same event',
      test: (x, ctx) => x.nextEarningsDate
        && ctx.days(x.nextEarningsDate) >= 0 && ctx.days(x.nextEarningsDate) <= 14,
      sort: (a, b) => a.nextEarningsDate.localeCompare(b.nextEarningsDate),
    },
    {
      id: 'value',
      title: 'Cheap, growing and profitable',
      blurb: 'forward P/E under 20 while revenue grows more than 15% and the net margin clears 15%',
      test: (x) => num(x.forwardPe) && x.forwardPe > 0 && x.forwardPe < 20
        && num(x.revenueGrowthYoY) && x.revenueGrowthYoY > 15
        && num(x.profitMargin) && x.profitMargin > 15,
      sort: (a, b) => a.forwardPe - b.forwardPe,
    },
    {
      id: 'disconnect',
      title: "Business improving, price isn't",
      blurb: 'revenue growing more than 25% while the price has fallen more than 10% over three months',
      test: (x) => num(x.revenueGrowthYoY) && x.revenueGrowthYoY > 25
        && num(x.threeMonthPct) && x.threeMonthPct < -10,
      sort: (a, b) => b.revenueGrowthYoY - a.revenueGrowthYoY,
    },
    {
      id: 'hot',
      title: 'Overextended',
      blurb: 'RSI above 75 and more than 12% above the 50-day average',
      test: (x) => num(x.rsi) && x.rsi > 75 && num(x.vs50ma) && x.vs50ma > 12,
      sort: (a, b) => b.rsi - a.rsi,
    },
  ];

  // Runs every screen over one set of rows. `now` is injectable so a caller can
  // reproduce a past night rather than only ever meaning "today".
  function run(rows, now) {
    const today = now ? new Date(now) : new Date();
    today.setHours(0, 0, 0, 0);
    const ctx = { days: (iso) => dayDelta(iso, today), today };

    const out = {};
    for (const s of SCREENS) {
      out[s.id] = rows.filter((x) => s.test(x, ctx)).sort(s.sort);
    }
    return out;
  }

  return { SCREENS, run, num, rangePos, lowInRange, fcfYield, SURPRISE_CAP, dayDelta };
});
