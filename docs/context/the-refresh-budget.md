## The refresh budget — pacing and rotation
**Two changes on 2026-09-14 took the nightly job from "breaks at 530 symbols" to "1,000 in 24 minutes", on the same Pro plan.** Both were prompted by costing an upgrade and finding it was not worth buying: 987 credits/minute is a slider inside Pro at $149 — no `/market_cap`, no forward estimates, no analyst data, all of which need Ultra at $999 — and it would have bought **nine minutes on an unattended midnight job**, while removing not one required fix. 1,001 price credits do not fit a 987 ceiling either.

**Prices are paced across rounds.** They cost 1 credit a symbol and the whole universe was pulled in one round, so above **529 symbols** the round asked for more than the minute allows and was refused — and a Refresh All could never get past its first round. A price round now takes the next slice that fits, anything outside it is read from the archive so the snapshot stays complete, and only the round reaching the last symbol stamps `prices_at`. `refresh_state.priced` is how a stateless function knows where it got to; `notePriceRound()` is the one place that advances it, so the cron route and `/api/stocks` cannot drift. Only freshly-priced symbols go to `persistBars` — re-persisting archive-sourced bars is a no-op upsert of the overlap window for every unpriced symbol, every round.

**Fundamentals rotate instead of being re-pulled nightly.** `PROFILE_TTL_MS` is now `FUND_ROTATION_DAYS` (env, default **7**) rather than 24 hours, and the cron's `?start=1` expires the **oldest** `ceil(N/7)` profiles (`expireOldestProfiles`) instead of all of them. The justification is measured and already in this file: the twelve tracked fundamental fields move on **1-5% of nights**, and when they move it is a step, not a wobble. A symbol with no profile at all is never waiting its turn — `ensureProfiles` treats a missing one as stale. `?full=1` on the cron, and the console's **Refresh all**, still sweep everything.

| universe | nightly before | nightly now | credits before → now |
|---|---|---|---|
| 270 (today) | 39 rounds, 40 min | **6 rounds, 6 min** | 21,909 → **3,396** |
| 500 | 73 rounds, 75 min | 12 rounds, 12 min | 40,573 → 6,272 |
| 1,000 | *impossible* | **23 rounds, 24 min** | 81,145 → 12,463 |

- **`MAX_ROUNDS=60` and `timeout-minutes: 45` did not need raising** — 23 rounds and 24 minutes at 1,000 symbols sit inside both. They would bind on a full sweep, which the nightly job no longer runs.
- **A plain Refresh above ~609 symbols prices what fits and leaves the rest on their archived close.** Honest but partial; Refresh All is what walks the whole list.
- Verified by simulating whole runs against the real `liveRefreshOpts()` at nine universe sizes from 93 to 1,500: **no round anywhere exceeds 610 credits and every profile is still pulled**. The load-bearing half of that is the bottom — 93 and 270 reproduce today's 14 and 39 rounds exactly, because below 529 the slice is the whole universe and the new path is never taken. The rotation SQL is unit-checked against a throwaway in-memory SQLite: oldest-first, the limit respected, never-fetched rows not counted against it.
- **What none of this fixes**, and what will bind next: the assistant's ~700-stock context wall, and `readBarsFor`'s 650-day window across the universe (3.5s at 85 symbols, so ~41s at 1,000) on every round.

