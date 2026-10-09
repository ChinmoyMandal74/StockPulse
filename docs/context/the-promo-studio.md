## The promo studio
**The template picker is a dropdown (2026-09-17, owner's call).** Nine templates as a stack of buttons cost most of the panel's height, and the panel is the thing you scroll while tuning a card — the picker is 52px now against roughly 450. The note that used to sit on every button follows the chosen template underneath it, so nothing was lost, and the control matches every other one on the panel. The options are rebuilt only when the LIST changes, since `/api/me` decides whether the owner-only Announcement template is in it and that answer lands after the first paint.

**Every scope in the studio has an Industry picker under its Sector picker (2026-09-15)** — `movIndustry`, `chtIndustry`, `spkIndustry`, `rngIndustry`, `advIndustry`, `fundIndustry`. `scopeOf()` in cards.js derives the industry key from the sector key (`xxSector` → `xxIndustry`), so a host without the control (the phone, which renders a saved post) filters nothing and is unchanged; the kicker names the narrowest cut (the industry alone, since it implies its sector). `syncIndustries()` runs at the top of every studio render and refills an industry list only when its sector changed, offering just that sector's industries (`Cards.industries(rows, sector)`) and dropping a choice the new sector does not hold. Verified headlessly on the live snapshot: 19 checks (placement under Sector in all six, nesting, card rows only semiconductors, reset on sector change, a second template, a host with no control). **Open to every signed-in member since 2026-09-15, from a `Promo Studio` button in the screener's bar after Rules** (hidden for guests, whose `/api/basket` 403s; the route redirects them, and signed-out visitors go to `/login`). **The Announcement template stays the owner's** — `OWNER_ONLY_TPLS` in promo.html filters it from the template list unless `/api/me` says admin; it is free text with no data behind it, so there is nothing server-side to guard. The page now loads `wmark.js` like every member data page (the owner is skipped). The Promo row left the admin console's Studio section, which keeps the Member cards row. Verified: headless template lists per role (member 8 templates without Announcement, owner 9) and a route walk (anon → login, guest → `/`, owner 200). *Originally:* **`/promo` (admin only, ⋯ menu): fixed marketing-card templates rendered from tonight's data in the site's own theme, for manual screenshotting** — no social integration by design (2026-09-14). A real 1080px artboard (4:5 / square / 9:16) scaled to fit the window, so crops line up post after post; every card carries the same chrome (wordmark, date, `tickrlab.com · N stocks screened nightly · Mechanical readings — not investment advice`). Five templates, all client-side from `/api/stocks` (tickers as typographic monogram tiles — logos were removed): **Movers of the week** (top |1W| moves), **The rules changed their mind** (advice changes with the fired rule named — the differentiator card), **Breakout radar** (fresh 3M highs, amber ≥1.5× volume badge), **Where the market stands** (universe by trend state), and **Announcement** (kicker/headline/body free text in the house type). **The no-verdict rule extends to marketing**: cards report what the screen and the rules did, never "stocks to buy" — the owner signed off on that line explicitly. Empty states are written to still be postable ("every verdict held today"). Templates were VM-smoke-tested (four builders + two empty states) and the route walk verified (admin 200, anon/guest redirect, `/promo.html` funnels to `/promo`).

### A BULK ADD BREAKS THE NEXT PRICE REFRESH, until the bars are backfilled (2026-09-22)
**Reported as "refresh price not working this morning", and it was a hard 504 rather than the usual false alarm.** Reproduced directly: `GET /api/stocks?refresh=1` answered **HTTP 504 at 300.128s, `FUNCTION_INVOCATION_TIMEOUT`**, and the snapshot's `updatedAt` never moved — so unlike 2026-09-20 the round did not finish and merely lose its response; it did not finish at all.

- **The fingerprint of a killed round is `rounds=0, credits=0, error=null`.** Runs 67 and 68 both carried it. Nothing is recorded because `recordRound` and the credit meter are written AFTER the work, so a function killed mid-round leaves a run that looks like it never started. A run left `running` with no rounds is this, not a stall.
- **The cause was the bulk add, not the code.** The universe went 652 → 769 in a day, and **47 of the new symbols held under `LIGHT_MIN_ARCHIVE` (300) sessions — 27 had no bars at all** (ELV, UPS, CI, BSX, SO, DUK, EOG, SLB, HCA, AIG, D, ED…). A thin archive is deliberately pulled **deep** rather than at the usual 12 bars, and every one of those pulls is fetched *and written* inside the single refresh request. At this archive's measured write rate (~7 symbols/min for deep writes) that is ~6½ minutes on its own, against a 300s ceiling.
- **So the rule: after a bulk add, run `backfill-bars.js` BEFORE the next price refresh.** Otherwise the first refresh tries to build every new archive at once, inside one request, and cannot. The script exists precisely because 5000 bars a symbol has no business in a serverless function; doing it locally is paced, costs 1 credit a symbol, and takes the work off the request path.
- **The dry run is the diagnosis.** `/quality` already counts the thin archives and prints a ready `--only` command; the script's default dry run then says what the provider will actually serve before anything is written. Here: 45 of 47 fillable, 35,156 bars.
- **Two symbols could not be filled and both left the universe**, which is the other half of the fix — a permanently unfillable ticker is a gap every future Fill missing re-attempts forever:
  - **BBX** — the provider answered *"not authorized to access **XASX** data"*. It had resolved to the **Australian** listing. **The bulk add is how a foreign listing gets in**: the paste is symbol-shaped text, and `POST /api/universe/check` only warns when a symbol is absent from the NASDAQ file, never when it is present but resolves elsewhere at the provider. The standing rule is the LISTING, not the domicile.
  - **PXD** — Pioneer Natural Resources, acquired by ExxonMobil and delisted. A dead ticker fails forever.
- **Never judge a backfill by its silence.** It is network-bound, so a healthy run prints nothing and sits near zero CPU — identical to a hang. Judge it by the row count, the same lesson the `tech_history` build records.
- **Measured, before and after.** The backfill wrote **35,156 bars for 45 symbols in 2.5 minutes** (archive 1,831,641 rows, 767 symbols) and the same call that had 504'd came back **HTTP 200 in 173.2s** with the run recorded `complete`:

  `profiles 17.5s · prices 45.9s · score 0.3s · trend-bars 11.9s · persist-bars 65.2s`

  **`persist-bars` is the biggest phase even now** — writes are the cost on this database, and they grow with the archive, so this is the number to watch as the universe grows rather than `trend-bars`, which this file used to name.
- **Twenty symbols are still under 300 sessions and always will be** (CBRS 91, SKHY 52, SPCX 72, DRAM 120…): genuine recent listings, where a deep pull returns the handful of bars that exist and costs almost nothing. **Thin is only expensive when the provider HAS history to send** — the 27 empty archives were pulling 1,300 bars each. So do not read a nonzero "under 300" count as work left to do; check whether a dry run can actually fill them.

### The 2026-09-21 nightly: missed by GitHub, then outgrown by the universe
**Two separate failures in one night, and neither was the app.**

**First, the schedule.** The job registers two crons (20:15Z for EDT, 21:15Z for EST) and a guard runs only the one that lands on New York hour 16. **GitHub delivered exactly one firing all day, at 23:16:24Z** — about two hours late. That is New York hour **19**, so the guard correctly refused and the job exited **success in 18 seconds**. The 20:15Z cron, the one that should have run, never fired at all. No run record, no report, no email — every one of those the correct consequence of the job never starting, and exactly the failure the watchdog exists for (`nightVerdicts()` read `missed`).

**Then the manual re-run failed with exit code 28 — curl's timeout — after 3m05s.** `?start=1` does not merely start the run: it expires the profiles, creates the record, and then **falls through and executes a whole round**, and round ONE is the live price round. Measured on the two runs either side of it: **257.2s at 640 symbols and 234.3s at 652**, against the workflow's `-m 180`. It fit when a round was ~146s at 430 symbols; **the universe grew 430 → 652 in a day (+52%) and it stopped fitting.** The nightly did not break, it was outgrown.

- **`|| true` on the call sites is load-bearing, and it was missing on both.** The step runs under GitHub's default `bash -e {0}` (the script adds `-u` and `pipefail` on top), so a curl that times out kills the script on the spot — before the loop and before `finish()`. That is why run 62 was left stranded `running` with the flag up instead of being closed, and why it took the 9-minute sweep to clear.
- **It also made dead code of the script's own tolerance.** The `if [ -z "$loaded" ]` branch — *"a rate limit or a cold start, not a reason to abandon the night"* — could never be reached, because the curl that would produce an empty response killed the shell first. Both call sites carry `|| true` now and that branch is live.
- **Patched**: `-m 180` → **300**, `timeout-minutes: 45` → **90** (at 652 the rotation is 94 profiles = 14 rounds; with round 1 at ~257s, archive rounds ~130s and a 62s gap each, a clean run is ~47 minutes, which 45 cut off).
- **300s is the ceiling worth asking for, not a margin.** The platform kills a function at about 300s and a **504 at 300.1s is already on record**. Past this size the answer is not a longer timeout — it is **Fast refresh**, whose rounds are `/api/refresh-profiles` (profiles only, no bars, no snapshot) and take seconds, with one heavy rebuild at the end. This file already said so: *"Fast refresh is the one to use as the universe grows."* The cron route has no fast mode yet; that is the real fix.
- **Verified before pushing**: the driver block extracted out of the YAML and run through `bash -n`, both call sites confirmed guarded, and no tabs in the file. A broken workflow fails silently until the night it is needed.

### The 2026-09-19 nightly: a failed workflow over a successful refresh
**The job reported failure; the data was perfect.** The run record read `complete` — 9 rounds, 430 of 430 loaded, 0 refused, 5,001 credits — while GitHub mailed "All jobs have failed" after 26m32s. The same SHAPE as the 2026-09-18 news incident, and again the owner reasonably read it as "the refresh failed" when it had not.

**Two causes, both mine, both from the tech-history work.**

- **A full scan in the refresh tail.** `noteTechMark` asked `techHistorySpan()` for the newest mark — `count(*), count(distinct symbol), min(d), max(d)`, which SCANS. Measured against production at **14 seconds cold, 303ms warm, over 228k rows**, and it ran on EVERY round of a Refresh all. Nine rounds of that is ~2 minutes of waste and ~2M rows against the meter; on the final round it sits in the tail that must finish before the response, so the round was recorded, the run closed — and then time ran out before the report could be built or the job answered. **The stored report is empty and `reportSent` is null, which is how to spot this from the outside.** It is one indexed seek now (`select max(d)`, a covering-index lookup, 0ms), and a test pins the plan.
- **A finished run kept being asked to work.** The job only exits 0 when a round answers `done`. That one response was lost, and every later call fell through to a fresh full refresh, timed out at the job's 180-second curl limit, and counted as a round with no progress — three of those and it gives up and reports failure. **The extra ~8 minutes in the workflow's 26.5 against the run's 24.5 is exactly three of those calls.** The route now answers `{done:true}` at once for a run already `complete` or `incomplete`, the way it already did for `stopped`: measured at **43ms against a 180-second timeout**.

**The lesson, which the news incident already taught and this repeated: work added to the refresh tail is not free, and a slow query there does not fail loudly — it fails as a job that says the night went wrong when it went right.** Before adding anything to that path, time it COLD against production, and prefer a seek. And when a refresh "fails", read the run record before believing it: `complete` with a full `loaded` and an empty report means the work succeeded and the tail did not.

### The refresh timeouts sat AT the worst case, so growth buried a working run
**Run 55 (Fill missing, 2026-09-21) was marked `abandoned` while it was still working** — 4 rounds, 26 profiles, 572 of 602 loaded, **0 refused and 0 failed**. Nothing was lost; only 24 stocks still lacked a profile afterwards. The owner reported it as a failure, correctly, because that is what the page said. **The fourth time a healthy refresh has been reported as a failed one** (news 2026-09-18, tech-history 2026-09-19, the benchmark 2026-09-20, this).

| round | took | credits |
|---|---|---|
| 1 | 73s | 561 |
| 2 | **244s** | 561 |
| 3 | **218s** | 1,082 |
| 4 | **251s** | 1,082 |

Gaps between recorded rounds: 5m38s, 5m30s, **6m08s**. `RUN_ABANDON_MS` was **6 minutes**, so the last gap crossed it and the lazy sweep buried the run; round 4 then landed anyway, because `recordRound` writes whatever the status says. **The fingerprint is a run whose `ended_at` is EARLIER than its `updated_at`** — marked over, then kept reporting.

- **The cause was the universe going 430 → 602.** ~172 stocks were added; rounds 3 and 4 cost 1,082 credits each — a full 602-symbol live price pull (**paced**, since 602 is over the 529 that fits in one minute) plus 6 profiles, then their first bars written into a 1.7M-row archive. Measured afterwards: 402 stocks hold 1,000+ sessions, 179 hold 300–999 (the new ones, now past `LIGHT_MIN_ARCHIVE` and on the shallow path), 21 under 300 and **none at zero** — so the 250s rounds were the cost of onboarding, not the new normal.
- **Both tolerances are DERIVED now, not guessed.** A round writes its progress when it FINISHES, and the platform kills a function at ~300s, so the longest legitimate silence is `ROUND_CEILING_MS (300s) + ROUND_GAP_MS (62s)` ≈ **6 minutes, whatever the universe grows to**. Six minutes was therefore exactly the worst case with no slack. `REFRESH_STALE_MS` is that + 1 min (~7), `RUN_ABANDON_MS` that + 3 (~9).
- **`REFRESH_STALE_MS` (was 4 min) has to outlast a WHOLE ROUND, not the gap between two.** `/api/status` raises the banner from it and `standAside()` guards the heavy reads with it, so a value under the round time makes both flicker off mid-round — the guard would stand down for the tail of every long round, which is exactly when a refresh most needs the database to itself. A 251s round already crossed the old 240s.
- **The order is deliberate: the live flag lets go first, the history waits longer.** A lingering banner and a lingering read guard cost little; calling a working run dead is what sends a false failure. Measured: the flag clears at 422s of silence, the run is not called dead until 542s.
- **The cost, stated:** an admin closing the tab mid-backfill now pins the notice for ~7 minutes rather than 4, and the heavy reads stay guarded for that long after a run dies.
- Verified: 8 behaviour checks against the real tables on an in-memory database, aged by rewriting the clock rather than by sleeping — run 55's own 6m08s and the full 362s ceiling both stay `running`, a 20-minute silence is still swept, the flag survives a 251s round and a 362s one, a closed tab still clears it, and the two tolerances are ordered. **Proved by reverting**: the old constants fail 4 of the 8. The stand-aside suite needed its ageing moved from 6 minutes to 20 — an "eventually releases" assertion must sit clear of the boundary, not on it.

### Serving the screener was SIX round trips in series (2026-09-21)
**Reported as "screener load is slow when a Fill missing is in progress", and the recorded timings agreed: browser-measured screener load at median 8.8s, p95 27.6s, max 40.7s** (the `load` kind in `/activity`, which exists for exactly this).

**The decomposition is the whole finding, and it rules out three plausible culprits at once.** Measured against production while a Fill missing ran:

| route | what it touches | time to first byte |
|---|---|---|
| `/api/health` | **nothing** | **0.09, 0.12, 0.09, 0.09s** |
| `/api/status` | two tiny indexed reads | **3.1, 6.3, 9.2, 47.2s** |
| `/api/stocks` | the snapshot + five more | 4.2, 9.7, 81.2s |

- **Not the payload.** The response is 3.1MB of JSON and Vercel serves it **brotli at 620KB**; `time_starttransfer` equals `time_total` in every run, so the bytes were never the wait.
- **Not the cold start, and not the code.** `/api/health` runs the same function on the same instances and answers in 90ms *every time*. Whatever is slow is behind the first database call.
- **It is the DATABASE, and it is per-ROUND-TRIP.** Under a refresh a single small read costs seconds — so a path's cost is its number of round trips, not its number of rows.

**The screener's read path was six, in series**: the snapshot, short names, advice age, priced-at, the portfolios, the refresh flag. **None of the five after the snapshot depends on any other** — they only need `snap`, and each writes a different field. They were sequential for no reason but the order they were written in. They are one `Promise.all` now: **six round trips became two.** The identical arithmetic `init()` already records — 46 sequential is 1.72s, the same 46 in one batch is 0.04s.

- **Each stamp keeps its own `catch`**, so a slow auxiliary read degrades one field instead of 500-ing the screener — which matters most exactly when the database is struggling. **`readPortfolios()` is deliberately NOT tolerant**: memberships drive the badges and the tab counts, and silently dropping them would be a wrong table rather than a thin one.
- **TIMING IS NOT THE ASSERTION.** On an in-memory database every read is sub-millisecond, so a stopwatch passes either way. The test wraps the client and records **peak concurrent round trips**: 1 in series, many in parallel. Measured **6 of 7 in flight together; reverting to sequential drops it to 2**, which is how the test was proved to catch the regression. `uni-boot.js` exposes `global.__client` for it.
- **What this does NOT fix**: the refresh still saturates the database, and a round is 63–257s at 640 stocks with 156–382s between rounds (run 59). This cuts the screener's exposure to that by two thirds; it does not remove it. The remaining lever is caching the four small slow-changing reads per instance, which trades against the rule that an edited short name shows on the next load.
- Verified: 13 checks — every stamped field still arriving, a live refresh still reported, the overlap, and a failing auxiliary read leaving the page up with its rows intact.

### The heavy reads stand aside while a refresh runs
**Nothing may compete with a refresh for the database (2026-09-21, owner's instruction).** A refresh round reads ~118,671 rows and **cannot wait**: nothing may run after a response on this platform, so the tail has to finish inside the request, and the nightly job gives up after three rounds without progress. A page can wait; a night cannot. The 2026-09-19 nightly is the proof — it reported failure over data that was perfect.

`standAside(res)` in server.js answers **503** with the run's name and its progress, and the four heaviest reads call it:

| route | what it reads |
|---|---|
| `/api/db-stats` (`/database`) | every row of every table — **1.7M**, nearly all `bars` |
| `/api/backtest` | ~157,000 bars, plus the snapshot blob, earnings and recorded fundamentals |
| `/api/trend-backtest` | 76,531 marks |
| `/api/data-quality` (`/quality`) | ~33,000 rollup rows + every profile blob |

- **It guards the READ, not the page.** A cached answer touches nothing, so `/api/db-stats` and `/api/data-quality` still serve theirs, and a trend sweep whose marks are already in memory still runs — `tbMarksWarm()` is one definition of "warm" shared by the loader and the guard, so they cannot disagree. **A guard that refuses free work is a regression dressed as safety.** The test proves both halves at once: the same endpoint is served warm and refused cold in the same run.
- **Validation runs first**, so a malformed request still gets the 400 that explains it rather than being told to come back later and then refused again.
- **The refusal has to be a SENTENCE.** All four pages render `j.error` straight into the page, so a bare status reaches a human as "HTTP 503". `/quality` was the one discarding the body (`throw new Error('HTTP ' + r.status)`) and now reads it.
- **What it covers, and the gap is deliberate.** `readRefreshState()` is non-null only while a **multi-round** run is live — Refresh all, Fill missing, Fast refresh, the nightly. A plain price Refresh writes no state row *on purpose* (a row there raises the refreshing banner for every viewer, thirteen times a trading day), so the ~30-second intraday rounds are not covered. They are not the hazard; the 25-minute run is.
- **No override, and none is needed**: the flag ages out after `REFRESH_STALE_MS`, so a run that dies mid-flight cannot lock the pages out. The answer is cached 5s so a page firing several guarded calls pays one round trip, and **a failure to read the flag counts as not-busy** — a database hiccup must not be able to lock out the research pages.
- **The product is not collateral damage.** `/api/stocks`, `/api/sparklines`, `/api/status` and `/api/basket` are untouched: refusing a member's own page is a regression, not a safeguard.
- Verified: 25 checks against the real server on an in-memory database — all four refused mid-run with the run named and its progress in the text, Retry-After set, cached and warm answers still served, the cold/warm pair on one endpoint, a 400 still a 400, the screener and its polls unaffected, and a stale flag unlocking everything on its own.

### The slowest thing in the app was a row count in the refresh tail
**`archiveStats()` ran `select count(*), max(d) from bars` — over 1,708,408 rows, uncached — in the tail that must finish before the response, on every report build (2026-09-20).** Measured cold against production:

| | |
|---|---|
| `count(*) from bars` | **135.9s** |
| `max(d) from bars` | **268.9s** |
| `d order by d desc limit 1` | 253.0s |
| `max(d)` again, same connection | 0.9s |
| `readSnapshot()` beside it | 2.1s |

- **How it showed.** A plain one-round price refresh, the simplest operation here, answered **HTTP 504 after 300.1s** — Vercel's gateway ceiling. The round itself was 99.6s and the snapshot was written correctly at +100s; the remaining ~200s was this. So the work succeeded, the response died, the run was swept `abandoned`, and the night reads as a failure. **That is the third time this shape has bitten** — news (2026-09-18), tech-history (2026-09-19), this — and each time the tail was the cause.
- **`max(d)` is the trap, not the count.** It looks like the cheap half and is twice as expensive, because there is **no index on `bars(d)`** — the primary key is `(symbol, d)`. Its plan reads `SEARCH bars USING COVERING INDEX`, the second time in one day a SEARCH line concealed a minutes-long walk (see `select distinct d` in the trend backtest). **"Drop the count, keep the through-date" would have been a 2x regression shipped as a fix**, and it was what I proposed before measuring.
- **Neither is needed.** The report's `Prices as of` already carries that date from `asOf`, computed from rows in memory; the **Bar archive line is deleted** rather than made cheap, since it said the same thing twice. `/api/refresh-runs/health` wanted only the through-date and **threw the row count away** — it uses `barsThrough()` now, which is `barsMaxDates()`: one indexed seek per symbol on the primary key. Its own comment had called it "the slower half of the page" and blamed the profiles. The archive's SIZE stays on `/database` and `/quality`, cached, where counting is the point of the page.
- **`sendRefreshReport` took a `snap` argument** so the two refresh-tail callers hand over the payload instead of re-reading the 1.3MB snapshot they just wrote — 2.1s, and the same trap `/quality` records (readSnapshot took that page from 2.4s to 10.8s).
- **`query-plan-test.js` could never have caught this, and that is fixed too.** Its allowlist carried a bare `/^select count\(\*\)/`, justified for `/database`, which silently licensed every count over every big table. It is now **eight named entries** — barsStats, fundamentalsStats, techHistorySpan, the two clear-with-count confirms, the two log summaries, the news coverage tile — each saying where it runs. The file now also states what it cannot do: **it reads plans, not call sites, and a count that is fine on a cached admin page is a disaster in the refresh tail while the SQL looks identical.**
- Verified: the guard fails if the `bars` aggregate returns, and the report suites assert the Bar archive line is gone while `Prices as of` still carries the date. **Against production, the same call that 504'd:**

| | before | after |
|---|---|---|
| a plain one-round refresh | **504 at 300.1s** | **200 at 146.2s** |
| its run record | `abandoned` | **`complete`** |
| `/api/refresh-runs/health` | ~145s+ | **4.4s cold, 0.7s warm** |

- **AND THE PHASES FINALLY ARRIVED, which corrects the standing claim about what a round costs.** The response carrying `phases` is the thing a 504 destroys, so this was unmeasurable until the tail was fixed:

  `profiles 7.0s · prices 67.1s · score 0.3s · trend-bars 18.4s · persist-bars 20.4s` — 113.2s of phases inside a 146.2s wall, at 430 symbols.

  **The dominant cost of a refresh round is the PROVIDER, not the database**: 67.1s of 113s is the batched `time_series` call. The database's share is ~39s (`trend-bars` + `persist-bars`), and **`trend-bars` — the 650-day window this file names as the thing to watch — is 18.4s**, not the bulk of it. A previous reading of this round as "~100s of largely database time" was wrong in its attribution; the round's own `ms` measures everything, and only the phases say where it goes. Note also that prices are already paced above ~529 symbols, so at 1,000 that phase is capped by the credit budget by design rather than growing without bound.

### The 2026-09-20 nightly: a benchmark run against production during the run
**The failure was mine and it was not in the code — it was a 106.7MB query aimed at the live database at 4:26 PM on a nightly day.** Run 49 went `abandoned` after one round, 370/430 loaded, and GitHub mailed a failure.

| | |
|---|---|
| 16:24:49 | the workflow starts |
| 16:25:02 | the server records run 49 |
| **16:26:09 → 16:28:15** | **my whole-table benchmark: 332,883 rows, 106.7MB, 126.2s** |
| 16:27:56 | the workflow dies — 187s, its `-m 180` curl limit |
| 16:28:43 | the server finishes round 1 (106.5s of compute), 47s too late |

- **The contention runs BOTH ways, and this file only documented one.** The `init()` section records that a long refresh makes every other tab cold. The reverse is just as true and bit harder: **a long query makes the refresh miss its deadline.** The round was 106.5s of compute where a normal one is a fraction of that, the start call overran 180 seconds, and nothing called `DELETE`, so the flag aged out and the run was swept to `abandoned`.
- **A deploy was NOT the cause, though three landed minutes later.** The Actions API settles it: the workflow died at 20:27:56Z and the first push was 16:29:06 EDT, afterwards. Worth checking rather than assuming — `run_started_at` / `updated_at` on `/actions/runs/<id>` is public even when the log is not, and it is the cheapest way to time a workflow's death against anything else.
- **What it actually cost was small, and reading the run record is how you know that**: prices were pulled live for all 430 and the snapshot was written at 16:26:49, so the day's data was in. The one real gap was the profile rotation — 2 of ~62 — which self-heals, since each night expires the oldest `ceil(N/7)` again. The failure email described a night that had mostly succeeded, for the third time (see 2026-09-18 news and 2026-09-19 tech-history).
- **NEVER PUT A BACKTICK INSIDE A DOUBLE-QUOTED SHELL STRING when editing this file from the command line.** Bash reads it as command substitution and **silently deletes the contents** — it cost two mangled CLAUDE.md lines on 2026-09-28 (`activeDim()` and two test filenames vanished mid-sentence), both caught only by re-reading what landed rather than trusting a "success" exit. Use the Edit tool for prose, or a quoted heredoc; and note the related trap that a heredoc here ate one level of backslash, turning `\n` into a real newline and silently breaking a patch anchor. **Re-read what you wrote to this file; the write reports success either way.**
- **DO NOT ASK GIT BASH WHAT TIME IT IS IN NEW YORK.** On this machine `TZ=America/New_York date` **silently ignores `TZ` and prints UTC** — measured 2026-09-28, when it read 12:36 against a true 08:36 EDT. A four-hour error in the wrong direction puts a heavy job straight into the window the rule below exists to protect, and it reads as a plausible time, so nothing looks wrong. The bare `date` is right (it printed `08:36:22 EDT`), and `node -e "new Date().toLocaleString('en-US',{timeZone:'America/New_York'})"` is right. **It cost a wrong diagnosis the day it was found**: the intraday schedule was reported broken and the screener stale, when it was simply pre-market and the first slot was an hour away. The ping's own log is what caught it, by disagreeing.
- **The rule this leaves: research reads belong on the LOCAL copy, and anything whole-table aimed at production must not run between 4:15 and 4:45 PM Eastern.** `analysis-db.js` exists precisely so a 100MB question never has to be asked of the live database; the benchmark above had a reason to hit production (it was measuring production's own wall) and still should have waited for the window to clear.

