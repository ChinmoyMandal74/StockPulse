// reportdue.js — which companies' fundamentals to re-pull because they just
// reported (2026-10-25).
//
// The owner, on the Out of date column showing June figures beside October
// results (AXP, JPM, MU, TSM): "Yes build the report triggered refresh". The
// 7-day rotation stays; this picks the companies that should not wait their
// turn, and the nightly's start expires them alongside the rotation's slice
// (server.js, the cron route's ?start=1), so the rounds pull them and the
// snapshot that run writes carries them.
//
// THE TRIGGER IS THE COMPANY'S OWN RESULTS 8-K (Item 2.02), from sec_state's
// last_results: the morning SEC read (secdaily.js) sets it the day after the
// filing, before the rotation starts. A company that announces under another
// item (Energy Fuels, 7.01) is not seen here and keeps the rotation.
//
// DUE when the results were filed in the last WINDOW_DAYS and either
//   - its profile was last pulled on or before the filing day (before the
//     release reached the provider), or
//   - it was pulled since, but the provider still shows the old report (its
//     last report date more than 3 days before the filing) or the old
//     quarter's figures (the period more than 75 days before that report:
//     RowCard.staleIssues' "Figures predate last results"), and the last pull
//     is RECHECK_DAYS old: the provider often catches up days after a release.
// Newest filings first, at most `max`. A fund is never due.
//
// PURE: no fetches, no database.
'use strict';

const WINDOW_DAYS = 14;
const RECHECK_DAYS = 3;
const MAX_DEFAULT = 100;
const FIG_DAYS = 75;          // the same line as RowCard.staleIssues

const day = (iso) => Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z');
// The calendar day in New York a timestamp falls on: the SEC's days, and the
// day a filing date names.
function dayET(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

// universe: [symbol]; profiles: { SYM: { fetchedAt, lastEarningsDate,
// mostRecentQuarter, instrumentType } } (readProfiles); filed: { SYM:
// { results } } (readSecFiled). Returns [{ symbol, results, why }].
function due(universe, profiles, filed, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const today = dayET(now);
  const max = o.max == null ? MAX_DEFAULT : Math.max(0, Math.floor(o.max));
  const out = [];
  for (const sym of universe || []) {
    const p = profiles && profiles[sym];
    const f = filed && filed[sym];
    const res = f && f.results;
    if (!p || !res || !/^\d{4}-\d{2}-\d{2}$/.test(res)) continue;
    if (p.instrumentType === 'ETF') continue;
    const age = (day(today) - day(res)) / 864e5;
    if (age < 0 || age > WINDOW_DAYS) continue;
    const fetched = Number(p.fetchedAt) > 0 ? Number(p.fetchedAt) : null;
    // Never fetched, or already expired: the rotation pulls it anyway.
    if (fetched == null) continue;
    const fetchedDay = dayET(fetched);
    let why = null;
    if (fetchedDay <= res) why = 'pulled before the results';
    else {
      const rep = p.lastEarningsDate ? String(p.lastEarningsDate).slice(0, 10) : null;
      const per = p.mostRecentQuarter ? String(p.mostRecentQuarter).slice(0, 10) : null;
      const behindReport = !rep || (day(res) - day(rep)) / 864e5 > 3;
      const behindFigures = !!(rep && per) && (day(rep) - day(per)) / 864e5 > FIG_DAYS;
      const rested = (now - fetched) / 864e5 >= RECHECK_DAYS;
      if ((behindReport || behindFigures) && rested) why = behindReport ? 'the provider has not recorded the report' : 'the provider still has the old quarter’s figures';
    }
    if (why) out.push({ symbol: sym, results: res, why });
  }
  out.sort((a, b) => (a.results < b.results ? 1 : a.results > b.results ? -1 : a.symbol < b.symbol ? -1 : 1));
  return out.slice(0, max);
}

module.exports = { due, dayET, WINDOW_DAYS, RECHECK_DAYS, MAX_DEFAULT, FIG_DAYS };
