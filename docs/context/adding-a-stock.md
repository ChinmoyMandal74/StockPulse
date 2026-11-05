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

### One click: the add is all (2026-11-04)
The owner, on the checklist below: "This should all be one one click of a button somehow". **`onboard.js` now runs every step of the checklist**, and the laptop task **`TickrLab onboard`** (`onboard-task.ps1`, every half hour 07:05 to 22:05, declared in `schedule.js` as `onboard`) runs it with `--auto` for whatever is waiting. So the add on `/themes` is the click; the stock is loaded by the next half-hour run.

- **Waiting** is unchanged (added after `ONBOARD_SINCE`, no `onboard_state` row), so most runs read one small query and end silently.
- **Remote steps through the cron secret**: `/api/admin/refresh-stock` now takes the cron secret as well as an admin (`cronOrAdmin`), so the profile needs no press of the Refresh button; `/api/sec/refresh?mode=missing` is looped until `remaining` is 0; `/api/sources/build?symbols=` last. A 429 or 503 is waited out (70 s, five tries).
- **Twelve Data**: before the price loaders and each profile it waits while `Schedule.busyAt` names a slot or window; a run that starts inside a nightly window stops (`--force` overrides), and `--auto` exits 0 so the task stays green.
- **One run at a time**: `onboard.lock` holds the pid (and the task is `IgnoreNew`, three-hour limit). The log is `onboard.log`.
- **Holders (added the same evening, the owner: "Do we have institutional investor and fund holdings for these fire and safety stocks")**: none for the four new names, since the 13F and N-PORT loaders run by hand once a quarter. They have no `--only`, so `onboard.js` re-runs them for the quarter on file (`inst13f-load.js --commit`, `nport-load.js --commit`: every stock rewritten with the same figures, the new ones added; downloads reused from the temp folder) and then `inst13f-backfill.js --commit --quarters 8` (history tables only, `do nothing` over a quarter on file; it does recompute each earlier quarter's net buyers figure). Done by hand for NSSC, FSS, BRC, REZI on 2026-11-04: 258, 469, 337 and 435 managers, 264, 426, 230 and 337 funds, nine 13F quarters each like the rest.
- **The record**: `onboard_state.steps` says "all 19 steps" or names the steps that failed; finished still means bars stored.
- `/onboarding` and the After you add card on `/themes` say so. The laptop has to be on; running `onboard.js --commit` by hand does the same at once.
- The task has to be registered once on the laptop: `.onboard-task.ps1` (Claude was refused Task Scheduler registration as persistence, so the owner runs it).

### The whole checklist, local copy included (2026-11-04)
The owner, after the fire and safety adds: "When we add a new stock how do I make sure everything is refresh including local copy". Everything below names the stocks with `--only A,B` (`--symbols` for the releases loader). Twelve Data steps (1, 2) stay off :15 and :45, 09:32 and the nightly windows; the rest cost no Twelve Data credits.

1. **Add** on `/themes` (or `POST /api/universe/bulk`), each checked first as one US common-stock listing.
2. **`onboard.js --commit --only ...` the same day**, before the next price refresh: bars to 2006, record close, short interest, splits (about 21 credits a stock).
3. **Profile and earnings history:** the Refresh button on `/stock/SYM`, one stock at a time; a 429 means another job had the minute, so wait one and press again. Otherwise the nightly takes stocks with no profile first. **No screener row until this is done**, and news tone, `/ideas` and the screener columns follow from that row.
4. **SEC filings:** `POST /api/sec/refresh?mode=missing` with `Authorization: Bearer <CRON_SECRET>`, repeated until `remaining` is 0 (or the next nightly SEC step). It resolves the CIK that every step below needs.
5. **SEC history:** `sec-events-load.js`, `sec-holders-load.js`, `sec-segments-load.js`, then `drawdown-load.js` and `options-load.js`, each `--commit --only ...`.
6. **Earnings releases since 2017:** `release-history-load.js --commit --symbols ...` (cents of AI credit a company; a company with no results 8-K, like Federal Signal, gets none).
7. **The local copy:** `analysis-add.js --only ... --commit` copies each stock's bars, fundamentals history, SEC facts and releases into `analysis.db`. The ordinary sync brings a new stock only its last ten days, so steps 8 and 9 would find nothing without this.
8. **Release text archive:** `release-archive-load.js` (local only; it lists what to fetch from the copy, hence after 7).
9. **`tech_history`:** `build-tech-history.js --commit --only ...` (reads the copy, hence after 7).
10. **Source rule:** `POST /api/sources/build?symbols=...` with the cron secret, after 4 and 6, or wait for the daily filings pass.
11. **Theme**, if wanted, on `/themes`. Then check `/onboarding` and open `/stock/SYM`.

Arrives on its own: insider trades (the quarterly loads keep every filer), news and tone once the stock has a screener row, split rotation, report dates and the earnings calendar. The research files (`single-data.js`, `strategy-runs.js`, `lab-grid.js`) are rebuilt after a removal; after an add only when the new stock should be in them.

### Split history is kept current by the nightly (`GET /api/cron/splits`)
**Until this a new split was picked up only when somebody opened that stock's Evolution card, and the peer chart never fetches.** `splitRotate()` runs LAST in `nightly-ping.js`'s tail (so more than a minute has passed since the final round's credits): up to `SPLIT_MAX_CALLS` (5) calls of `SPLITS_CRON_MAX` (20) symbols, 65s apart.

- **Who is due** (`splitsDue`, shared with `splitsFor`): never fetched, then a profile naming a split newer than any held, then older than 180 days. On most nights nothing is, and it is one call that fetches nothing.
- **THE PROFILE'S DATE AND THE `/splits` DATE NEED NOT AGREE** (Mueller: 2026-07-01 against a series that steps on 06-25), so "the profile names a newer split" can stay true for ever after a good fetch. That branch therefore also requires that we have **not fetched since the named date plus `SPLITS_SETTLE_DAYS` (5)**. Without it one such stock is re-asked every night; the same flaw was in `splitsFor` and is fixed with it.
- **A refused symbol is left unrecorded, never written empty** (empty reads as "never split"). It is not counted as `remaining`, or the driver would spend its allowance re-asking the same refusals. It IS re-asked each night: `SKX` costs one call a night until it is removed or served.
- **It stands aside while any refresh is live**, and is not part of the profile pull: seven profiles a minute already use 560 of 610 credits.
- `changed` names a stock whose newest split moved, not a first fetch.
- **In 180 days all 1,241 backfilled on 2026-10-08 go stale together**; at 100 a run that drains in about a week, oldest first.
- Verified: **33 checks** (`onboard-test.js`), **proved by reverting nine times, every one load-bearing**; `splits-test.js` (20) and `tail-test.js` corrected for the new rule and the fourth tail phase.


### The steps on /themes (2026-10-17)
The owner: "on the page /themes, can you clearly add instruction what I need to do if I new stocks". A card under the two Add cards, **After you add stocks, what to do** (`#afterAdd`), restates this file in order: `onboard.js --commit` the same day and before the next price refresh (about 21 credits a stock: 1 for bars, 20 for splits; it refuses inside the nightly windows); company data with the next nightly or Fill missing after step 1 (linked to `/refreshes`, **not** `?do=refreshmissing`, which starts a run on load); the insider reload once filings are fetched; `/onboarding` to check. A warning line names what cannot be backfilled and the rebuild order after a removal. Both add confirmations now point at the card instead of saying "Run Fill missing". **The card restates facts from code: change it with `onboard.js`, the nightly windows, or the credit costs.**

### Switching a theme off site wide (2026-10-23)
The owner: "Can you add a feature to disable a theme site wide by admin" (an investment theme, not a colour theme). Each row on `/themes` has an **On / Off** switch (`PUT /api/portfolios/:name/enabled {enabled}`, admin).

- **Off means gone for everyone**, the admin's screener included: the theme list and tabs, row badges, group pages (`/api/basket` answers "No such theme"), cards, backtest theme scopes, the landing count. Its stocks stay in the screener and keep refreshing; its membership, order and history are untouched. On restores everything.
- **Stored** as one `app_meta` row, `themes_disabled` (a JSON array of names; `readDisabledThemes` / `writeDisabledThemes`). Not a column on `themes`: `writePortfolios` deletes and re-inserts every theme row.
- **Two readers in server.js.** `readPortfolios` is now the themes that are on, so every display path filters without being touched. `readPortfoliosAll` (the stored list) is used by every edit route, because they read, modify and write the whole map: reading the filtered list there would delete a theme that is off on the next write (proved by reverting it). Also by the stored group builds (`GroupMonths`, `GroupDays`) and the bulk check on `/themes`.
- **The manager sees everything.** `/themes` sends `?all=1` on every call; an admin asking so gets every theme plus `disabled`, anyone else the filtered list. Rename carries the switch to the new name; delete drops it from the list.
- **At once, not at the next refresh.** Stored snapshot rows carry the memberships of the last refresh, so `snapshotCached` re-stamps them from the filtered list whenever it reads (every 20 s at most per instance), and the switch drops that cache. A group page's basket cache (ten minutes per instance) can still serve a theme for up to ten minutes after it goes off.
- Tests (scratchpad): `theme-off-test.js`, 18 checks as admin and member; `theme-off-page.js`, 8 checks on the drawn page.


### Fire and safety names, added 2026-11-04 (owner)
The owner asked to add the fire and safety companies not yet tracked and to load all their history, SEC and earnings data included: **NSSC** (Napco Security), **FSS** (Federal Signal), **BRC** (Brady), **REZI** (Resideo). Each was checked first as a single US common-stock listing at Twelve Data. No theme was asked for, so none was made. What was run, in order:
- **The add:** `addManyToUniverse` plus `writeNames`, the same calls as `POST /api/universe/bulk`.
- **`onboard.js --commit --only ...`:** prices to 2006 (REZI from its 2018 listing), record close, short interest (about 200 readings each) and splits.
- **SEC filings:** `POST /api/sec/refresh?mode=missing` with the cron secret. It read all four, 1,061 facts, and resolved their CIKs.
- **Other SEC history:** `sec-events-load.js`, `sec-holders-load.js` and `sec-segments-load.js`, each `--only`, then `drawdown-load.js` and `options-load.js`.
- **Earnings releases:** `release-history-load.js --symbols`, 114 since 2017 for $0.23. **Federal Signal files no results 8-K** (its 8-Ks are items 7.01, 8.01, 5.0x and 2.01), so it has none. Its figures come from its 10-Q and 10-K and from Twelve Data.
- **`tech_history`:** `build-tech-history.js --only`, 3,325 marks from 2007. It reads the local copy, whose incremental sync brings only recent bars for a new stock, so the four stocks' full bars were copied into `analysis.db` first.

Insider trades needed nothing: the quarterly loads keep every filer, so 12 to 40 transactions each were already stored, and the daily walk takes them now they are tracked. The 13F and N-PORT loaders take them at the next quarterly load.

What a script cannot do is the Twelve Data profile and earnings history (the one-stock refresh needs an admin session). The nightly takes stocks with no profile first, and **a new stock has no snapshot row until then**.

**`release-history-load.js --symbols` now also reads a named company that is not in the snapshot yet**, provided its SEC filer id is known. It used to take its list only from snapshot rows, so on the add day it found 0 companies.

**The theme `Fire & Safety`** was made the same day at the owner's request: MSA, APG, JCI, ALLE, ADT, NSSC, FSS, BRC, REZI, written through `writePortfolios` on the full stored list, as the Themes page does (28 themes to 29, 273 memberships to 282). Honeywell, Oshkosh and Carrier have fire-safety businesses too but were left out, since fire safety is a small part of each.
