## Bar archive
The `bars` table keeps one row per symbol per trading day (`open/high/low/close/volume`, keyed on `(symbol, d)`). **Currently 4,582,357 rows across 1,182 symbols, 1998-12-23 → today** (measured 2026-09-28, after the backfill below).

### 61% of the universe had fourteen months of history, and nothing would ever have fixed it (2026-09-28)
**Reported by the owner as "why does URI only go back to July 25 — this is a very old company".** United Rentals has been listed since 1997 and held **303 bars from 2025-07-14**. Everything else about it was fine: SEC facts back to 2009, 26 earnings quarters, a fresh profile and a fresh price. It was the archive alone.

- **The cause is `LIGHT_MIN_ARCHIVE`, and the shape of it is worth remembering.** A new ticker gets one ~300-bar pull; a live refresh is then deliberately shallow (12 bars) and only re-pulls deep when the archive is **under 300**. URI sat at **303 — three bars over the line that would have rescued it**, so it grew forward for ever and never backward. **A threshold that heals the symbols below it strands the ones that land just above it.**
- **It was not one stock.** Measured off `/api/data-quality`: **750 of 1,182 flagged *no 5Y*, and 722 of those sat in a 300-399 band with only ten distinct start dates clustered in July 2025** — the September 2026 bulk adds, each given one ~300-bar pull. The 2026-09-22 repair had covered only the 47 that were genuinely *under* 300, which is precisely the band the auto-deepening already handles.
- **`/quality` had the answer all along** — its `thin` list is every stock flagged `no 5Y` or `too short`, 781 of them, with a ready `--only` command. **Ignore its `--depth 1300`**: five years clears the flag and still discards twenty years, and the depth costs the same 1 credit either way.

| | before | after |
|---|---|---|
| clean | 401 | **1,070** |
| no 5Y | 750 | **80** |
| 300-399 sessions | 722 | **10** |
| 1,260+ sessions | 401 | **1,071** |
| archive | ~1.85M rows | **4,582,357**, earliest bar 2003-01-09 → **1998-12-23** |

- **Every one of the 112 still flagged holds exactly what the provider serves** — checked symbol by symbol against the dry run, 0 short of it. The remaining shortfall is the market's, not the archive's, the same conclusion the 2026-09-19 pass reached.
- **WRITES ARE 8x FASTER THAN THIS FILE SAYS, and the old number would have talked you out of the job.** Measured: **2,934,059 bars in ~16 minutes across seven batches (~203,000 bars/min)**, against the 2026-09-19 reading of 24,259/min. Budgeting from the old figure predicted 2-3 hours and an overlap with the nightly, which is why it was batched at all. Re-measure before planning around either number.
- **Batched 130 symbols at a time, deepest first**, so an early stop leaves the most valuable symbols done rather than queued — and each batch is independently resumable, since a symbol is replaced wholesale.
- **`--rate 100`, not the default 580.** An intraday price round needs ~500 credits inside one minute against the plan's 610, so the default starves the live refresh. The fetch side is never the bottleneck here (writes are), so the throttle is free. As it happened the run was pre-market and contended with nothing — see the Git Bash timezone trap above, which is why I thought otherwise.
- **`FAILED: terminated` with an exit code of 1 does NOT mean the batch failed.** One batch reported `130 symbols ok, 0 failed, 307,264 bars written` and *then* exited 1: the closing `archiveStats()` is a whole-table `count(*)` over what is now 4.5M rows, and the socket was dropped. Spot-checking six of its symbols found all of them written. **Judge a batch by its row count, not its exit code** — the same lesson the `tech_history` build records about silence.

**What this invalidates, and none of it is rebuilt yet**: `tech_history` (the trend backtest's usable floor was 2008 with 278 symbols and could now reach much further), the local analysis copy (`analysis-db.js --full`), and the three derived files built from it — `single-closes.json`, `strategy-*.json`, `lab-grid.json`. Every backtest number on those surfaces still describes the shallow archive.

**It costs no API credits.** Every refresh already fetches ~300 daily bars per symbol and discards them; `persistBars()` writes them instead. Twelve Data charges **1 credit per symbol regardless of `outputsize`** — measured, `Api-Credits-Request: 1` for 5000 bars — which is why the deep backfill was affordable in the first place.

- **The backfill is PACED, and it had to be (2026-09-15).** One symbol is one credit and the plan allows 610 a minute; the unpaced script fetched at ~15 symbols a second (900/min) and only survived the 190-symbol run because the whole job was 190 credits in 13 seconds. `makePacer(limit, windowMs)` is a sliding-window meter shared by the workers — `take()` resolves only when one more credit keeps the last 60s under `--rate` (default **580**) — and a refusal (`/credit|rate limit|429|too many/i`) waits 62s and retries up to 3 times rather than writing the symbol off. The receipt prints symbols/min and how long was spent waiting. Verified: the pacer on a fake clock (8 checks — no 60s window over the limit across 1,000 symbols, a 190-symbol run never delayed, the window sliding, the refusal pattern) and a live 3-symbol dry run at `--rate 2` that waited exactly 60s.
- **Throughput is dominated by WRITES, and it degrades as the archive grows.** Two measurements, same script, same depth:
  - 2026-09-15: 190 symbols, **755,991 bars in 3 min 45 s** (~50 symbols/min), against an archive of ~1.08M rows.
  - 2026-09-19: 177 symbols, **640,433 bars in 26.4 min** (~7 symbols/min), against an archive of ~1.13M rows growing to 1.71M. Fetching was 0.1 min of that — the dry run over the identical list finished in six seconds.
  **Seven times slower per row for a comparable job**, with no pacing wait in either. So budget a backfill by the archive it is writing INTO, not by the symbol count, and do not quote the 2026-09-15 figure as the expectation.
- *(Superseded, kept for the comparison above)* **Measured throughput, 2026-09-15**: 190 symbols at depth 5000 took **3 min 45 s** and wrote **755,991 bars** — fetching was 13s of that, so writes are ~95% of the wall clock. Extrapolating to a 1,000-symbol universe: ~2.9M more rows, ~15-20 minutes, ~730 credits. **What actually costs at that size is profiles, not bars**: 730 new stocks is ~58,000 credits and ~1h45m of Fill missing.
- **The 2026-09-19 deep backfill, and what it bought.** Run as Phase 0 of the trend-only backtest: 177 symbols (the `/quality` page's own thin list, verified to contain none of the 196 deep ones), at the default depth 5000. **640,433 bars written, 0 failed, 0 retried.** The archive went **1,125,447 → 1,708,406 rows** and its earliest bar moved from 2006-10-12 to **2003-01-09** — three years further back than the file had ever recorded, because several long-listed names had only ever had one shallow price pull.

| reaches back | before | after |
|---|---|---|
| 3 years | 260 | **406** |
| 5 years | 253 | **392** |
| 10 years | 211 | **332** |
| 15 years | 183 | **297** |
| 19 years | 169 | **276** |

  `/quality`'s own flags moved with it: `noFiveYear` **166 → 27**, clean **250 → 389**, thin **177 → 38**. **Only 12 stocks now hold under 320 sessions and every one is a genuine recent listing** (CBRS from 2026-05-14, SKHY 2026-07-10, GOOGM/GOOGN 2026-06-03…), so there is nothing left for a backfill to fix — the remaining shallowness is the market's, not the archive's.
  - **Use the default depth, not the page's command, for a deep study.** `/quality`'s fix command says `--depth 1300` — five years, which is what its own "no 5Y" flag is about. A nineteen-year study wants the default 5000.
  - **The dry run is the cheap way to find out what is actually available**, and it corrected a wrong inference: "164 stocks under 320 sessions were never backfilled" was only half right. CBRS returns 88 bars because it listed in May 2026, while VSAT returns the full 5000 back to 2006. One credit a symbol, six seconds for 177, and it reports the real first date per symbol before anything is written.
- **Never run a shallow `--depth` over symbols that already have deep history** — each symbol is replaced wholesale, so `--depth 1300` would truncate twenty years to five. Use `--only` with the shallow ones (2026-09-15: 190 of 271 had under 1,300 bars).
- **`backfill-bars.js` is a local script, not a route.** 5000 bars is ~580 KB per symbol and ~40 MB across the universe: fine locally, far past what a serverless function should hold. Same one-off pattern as `migrate-to-turso.js`, dry-run by default.
- **Writes are incremental, not wholesale.** `persistBars()` upserts only bars newer than the stored `max(d)` plus a `BAR_OVERLAP` of 5. Steady state is a handful of rows per symbol per refresh, not 300.
- **The overlap is not decoration.** Twelve Data returns a bar for *today* while the market is open, with the current price as its close, so a mid-session refresh stores a provisional value. Re-upserting the recent window replaces it with the settled close. Measured drift on a real pull: 0.003–0.007%.
- **Splits are detected, not ignored.** A split re-prices all of history, so a stored bar `SPLIT_PROBE_BARS` (60) back would silently disagree with the fetched one and leave a phantom cliff in any chart. `persistBars()` compares that one bar per symbol — one query for the whole universe, since US symbols share trading days — and rewrites the symbol in full when it differs by more than `SPLIT_TOLERANCE` (0.5%). Re-running `backfill-bars.js --only SYM` is the manual repair.
- **An as-of pull must never write.** `computeStocks(asOf)` fetches a truncated range; persisting from it would corrupt the archive. Guarded by `if (!asOf)`, the same rule the snapshot uses.
- **A failed archive write never fails the refresh** — it is caught and logged. The screener is the product; the archive is a by-product.
- `open` is stored although nothing reads it yet. `high`/`low` drive the 52-week range and `volume` the volume trend, so an archive without them could draw a chart but not reproduce the screener — which is the point of keeping it.

