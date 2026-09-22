// The Refresh all / Fill missing round loop, defined once.
//
// A Refresh all is a dozen-odd rounds a minute apart, and no serverless
// function stays awake that long, so a browser tab drives it: start the run,
// ask for a round, wait out the rate limit, repeat until every profile is in.
// The screener and /refreshes both start runs, so the loop lives here rather
// than in either page — two copies of the pacing and budget rules would drift,
// and the budget has already been wrong once (a flat 15 rounds stopped a run
// at 78 of 84). The nightly job drives the same endpoints from a workflow.
//
// Pages pass their own api() (so a lapsed session behaves the way that page
// handles it) and hooks for progress; the loop touches no DOM.
(function (root) {
  'use strict';

  const GAP_MS = 62000;              // measured: two rounds inside a minute were refused
  const PROFILES_PER_ROUND = 7;      // archive rounds afford 7 × 80 credits; the price round pulls fewer
  const PRICE_SLICE = 500;           // must match PRICE_SLICE in server.js — it only sizes the budget
  const REFUSALS_ALLOWED = 8;        // a refused round fetched nothing, so it has its own allowance
  const STAGNANT_LIMIT = 3;          // rounds without progress before giving up

  // mode: 'all' (Refresh all), 'missing' (Fill missing), 'fast' (Fast refresh)
  // or 'prices' (Refresh prices). Fill missing and Fast refresh run LIGHT
  // rounds — profiles only, then ONE rebuild at the end; see the note in run().
  // Refresh all keeps the heavy round on purpose: it is the "everything,
  // visibly" sweep, and its whole point is that the table moves while you
  // watch. A price sweep is heavy too, for the same reason, but it ends on
  // prices rather than on profile coverage.
  // hooks: onStart(started), onRound({ loaded, total, rounds, data }),
  //        onWait(reason) — 'refused' or 'gap'.
  // Resolves { outcome, started, data } where outcome is
  //   'done'     every row has a profile — or, for 'prices', every symbol priced
  //   'nothing'  Fill missing found nothing to do
  //   'stopped'  the run was stopped from /refreshes
  //   'gaveup'   out of rounds, out of refusals, or no progress
  async function run(mode, api, hooks = {}) {
    const fill = mode === 'missing';
    const fast = mode === 'fast';
    // A PRICE sweep. Heavy rounds like a Refresh all — it is the table it is
    // refreshing — but it ends on a different signal: prices, not profiles.
    const prices = mode === 'prices';
    // THE ROUND'S SHAPE IS A SEPARATE DECISION FROM THE MODE, and until
    // 2026-09-22 it was not: `fast` chose both, so Fill missing was stuck with
    // the expensive round. The two narrow different things and they multiply —
    // the mode decides WHICH profiles are pulled (Fill missing expires only the
    // gaps), a light round decides what pulling them COSTS.
    //
    // Measured on run 66, at 742 stocks: an ordinary round reads a 650-day bar
    // window across the whole universe, rescores momentum, re-runs advice and
    // rewrites the 1.3MB snapshot — 101s median, 233s worst — to fold in the
    // seven profiles it fetched. Forty rounds took 2h28m and still did not
    // finish, because nobody keeps a tab open that long: seven of the last
    // eight runs were swept `abandoned` having lost nothing at all.
    //
    // A light round fetches the same seven profiles and does none of the rest;
    // the table is built once, after the last one. `ensureProfiles` is shared,
    // so the two shapes pull exactly the same stocks — only the cost differs.
    const light = (fast || fill) && !prices;
    const sleep = hooks.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let started = null;
    let data = null;
    let outcome = 'gaveup';
    try {
      started = await api('POST', '/api/refresh-all' +
        (fill ? '?mode=missing' : fast ? '?mode=fast' : prices ? '?mode=prices' : ''));
      if (fill && started && started.nothing) { outcome = 'nothing'; return { outcome, started, data }; }
      if (hooks.onStart) hooks.onStart(started);

      // Every round names its run, so a Stop on /refreshes ends the loop on its
      // next round instead of it carrying on as plain refreshes.
      const runQ = started && started.runId ? '&run=' + started.runId : '';
      // Fill missing sizes its budget from the stocks it targets, not the universe.
      const work = fill ? (Number(started && started.targets) || 0) : (Number(started && started.total) || 84);
      // A price sweep is bounded by how many symbols a round may price, not by
      // how many profiles it may fetch — at 500 a side that is two rounds for
      // 1,000 stocks, plus slack for a refusal.
      const budget = prices
        ? Math.ceil(work / PRICE_SLICE) + 3
        : Math.ceil(work / PROFILES_PER_ROUND) + 6;

      let rounds = 0;
      let refusals = 0;
      let lastLoaded = -1;
      let stagnant = 0;
      while (rounds < budget && refusals < REFUSALS_ALLOWED) {
        try {
          // A light round fetches profiles and nothing else; the table is
          // built once, after the last one.
          data = await api('GET', light ? '/api/refresh-profiles?x=1' + runQ : '/api/stocks?refresh=1' + runQ);
        } catch (e) {
          refusals++;
          if (hooks.onWait) hooks.onWait('refused');
          await sleep(GAP_MS);
          continue;
        }
        if (data && data.stopped) { outcome = 'stopped'; break; }
        rounds++;
        // A light round answers with the counts directly; an ordinary one
        // answers with the table, and the counts come off its rows. Both count
        // the SAME thing — a profile with a fetch time on it — which is what
        // lets a run that expired its gaps to zero terminate correctly.
        const total = light ? (data.total || 0) : (data.stocks || []).length;
        // A PRICE sweep counts what has been PRICED, which the server carries
        // on the flag as `priced`. Counting profiles here would report 767 of
        // 767 on the first round and stop with most of the universe still on
        // yesterday's close.
        // A cleared flag means the sweep is OVER, so the last round reports the
        // whole universe rather than the zero a missing `priced` would read —
        // which would have shown "0 of 767 priced" on the round that finished.
        const loaded = prices ? (data.refreshing ? Number(data.refreshing.priced || 0) : total)
          : light ? (data.loaded || 0)
            : (data.stocks || []).filter((s) => s.profileFetchedAt != null).length;
        if (hooks.onRound) hooks.onRound({ loaded, total, rounds, data });
        // The server clears the flag on the round that finishes the sweep, so
        // a null `refreshing` IS the finish line for a price run — and it
        // cannot disagree with the server about when that was.
        if (prices ? !data.refreshing : (total === 0 || loaded >= total)) {
          outcome = 'done';
          // The one rebuild: scores, advice, the snapshot, the report and the
          // email all come from this round, the same way a Refresh all ends.
          if (light) {
            if (hooks.onWait) hooks.onWait('rebuild');
            data = await api('GET', '/api/stocks?refresh=1' + runQ);
          }
          break;
        }
        if (loaded === lastLoaded) stagnant++; else stagnant = 0;
        lastLoaded = loaded;
        if (stagnant >= STAGNANT_LIMIT) break;
        if (hooks.onWait) hooks.onWait('gap');
        await sleep(GAP_MS);
      }
      return { outcome, started, data };
    } finally {
      // Whether it finished or gave up, drop the shared flag so no one is left
      // watching a notice for work that has stopped — and a run that stopped
      // short is reported as incomplete by the server.
      try { await api('DELETE', '/api/refresh-all'); } catch (e) { /* it ages out anyway */ }
    }
  }

  // A plain price refresh: one request, logged by the server as a run of one round.
  function runPlain(api) {
    return api('GET', '/api/stocks?refresh=1');
  }

  root.RefreshLoop = { run, runPlain, GAP_MS, PROFILES_PER_ROUND };
})(typeof window !== 'undefined' ? window : globalThis);
