## Adding a stock: what arrives on its own, and `onboard.js` for the rest (2026-10-08, owner's request)
**Asked as "what happens when I add new stocks, how will everything including history get pulled properly".** Most of a new stock's data arrives within a day; four pieces of HISTORY never did, and nothing said so. **`/onboarding` (admin, a `New stocks` row in the console's Data section) is the guide and the to-do list; `onboard.js` is the one command.**

| arrives on its own | when |
|---|---|
| name, provider check | at the add |
| ~300 days of prices | next price refresh |
| profile, fundamentals, earnings history | next nightly (gaps first), or Fill missing |
| SEC filings, Item 2.02 date | next nightly SEC step (never-fetched first) |
| S&P membership, news | immediately / next news run |
| split history | the nightly split step, below |

| loaded by `onboard.js` | loader it starts with `--only` |
|---|---|
| full price history | `backfill-bars.js --commit --rate 100` |
| record close (after the bars, which it reads) | `backfill-ath.js --commit` |
| short-interest history to 2017 | `shortint-load.js --commit` |
| split history, straight away | `backfill-splits.js --commit` |

- **Insider transactions are NOT in it**: the fix is a quarterly reload (`insider-load.js --commit --quarters 1 --force`), which is per quarter rather than per symbol and needs the CIK the filings fetch resolves first. The page says so.
- **`fundamentals_history` and the days-held count cannot be loaded** and start from the add.
- **"To finish" is a stock added after `ONBOARD_SINCE` with no `onboard_state` row.** The date is a constant (env-overridable for tests) rather than a seeded table: every stock present when this shipped had been loaded by hand, and marking 1,274 rows done in `init()` would be a write on every cold start. `onboard_state` is in `SYMBOL_TABLES`, so removing a stock removes its record and a re-add asks again. **`ONBOARD_SINCE` is restated in onboard.js and must match server.js.**
- **`onboard.js` adds no logic.** Dry run by default; `--commit`; `--only` for any tracked symbol (refused for one not in the universe); it prints the four commands it will run. **It refuses to start inside a nightly window** (07:25-08:20 and 19:25-20:20 Eastern, weekdays; `--force` overrides). A stock is marked finished **only if bars are actually stored**, never by an exit code.
- **The command names no symbol**, so the copy on the page and on `/holdings` after an add cannot go stale. `/holdings` now shows it in place of the bare `backfill-bars` command.
- `GET /api/onboarding` (admin) reports per pending stock: profile, filings status, first bar, record close, short-reading count, splits. State tables and per-symbol seeks only.

### Split history is kept current by the nightly (`GET /api/cron/splits`)
**Until this a new split was picked up only when somebody opened that stock's Evolution card, and the peer chart never fetches.** `splitRotate()` runs LAST in `nightly-ping.js`'s tail (so more than a minute has passed since the final round's credits): up to `SPLIT_MAX_CALLS` (5) calls of `SPLITS_CRON_MAX` (20) symbols, 65s apart.

- **Who is due** (`splitsDue`, shared with `splitsFor`): never fetched, then a profile naming a split newer than any held, then older than 180 days. On most nights nothing is, and it is one call that fetches nothing.
- **THE PROFILE'S DATE AND THE `/splits` DATE NEED NOT AGREE** (Mueller: 2026-07-01 against a series that steps on 06-25), so "the profile names a newer split" can stay true for ever after a good fetch. That branch therefore also requires that we have **not fetched since the named date plus `SPLITS_SETTLE_DAYS` (5)**. Without it one such stock is re-asked every night; the same flaw was in `splitsFor` and is fixed with it.
- **A refused symbol is left unrecorded, never written empty** (empty reads as "never split"). It is not counted as `remaining`, or the driver would spend its allowance re-asking the same refusals. It IS re-asked each night: `SKX` costs one call a night until it is removed or served.
- **It stands aside while any refresh is live**, and is not part of the profile pull: seven profiles a minute already use 560 of 610 credits.
- `changed` names a stock whose newest split moved, not a first fetch.
- **In 180 days all 1,241 backfilled on 2026-10-08 go stale together**; at 100 a run that drains in about a week, oldest first.
- Verified: **33 checks** (`onboard-test.js`), **proved by reverting nine times, every one load-bearing**; `splits-test.js` (20) and `tail-test.js` corrected for the new rule and the fourth tail phase.

