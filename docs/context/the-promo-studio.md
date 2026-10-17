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

## Stock pickers show the name and can be typed into (2026-10-12)

The owner, about to open the studio to every member: "stock drop down is on ticker only .. make it on both ticker as well as name .. make it easy to search for a name by just typing".

- **The option text is `TICKER — Short name`; the option VALUE is still the ticker alone**, which is what every card, the "stock carries across" rule and a saved post read. Nothing stored changed.
- **Every stock select gets a text box over it** (`enhanceStockPickers`, in `promo.html`). A select is a stock picker if its id ends in `Sym`, `SymA`, `SymB` or `Sym2`: nineteen today, and a new one named that way is picked up with no further edit. The select stays in the page, hidden, as the one value; choosing in the box sets it and fires the select's own `change` event, so no listener was touched.
- **Ranking** (`spMatches`): the ticker typed exactly, then tickers starting with it, then names starting with it, then a later word in the name starting with it, then anywhere in the name. Forty shown, with a count of the rest.
- Options are read from the select as you type, never copied, so a reload of the rows needs nothing done.
- `syncStockPickers()` runs at the top of `render()`, because code elsewhere sets a select's value directly.
- Keyboard: arrows, Enter, Escape. Not rendered in a browser by the build; the ranking has a scratchpad suite (21 checks).

## Member mode: the studio as a place to look (2026-10-12)

The owner: members "don't need to select the size and we should do our best to make the best use of the available screen size", and "don't need ability to export or post to instagram". The studio had been open to every account since 2026-09-15 with the admin's controls; for anyone who is not the admin it is now a viewer. `memberMode = !me.admin`, and `body.mem` carries it to the styles.

- **No shape to pick.** `bestSize(w, h)` scales each of the three artboards to the space and takes the one covering most of it, except that the 4:5 holds the most rows and is kept unless the square covers a fifth more or the tall one a seventh more. In practice: where the HEIGHT limits the card (a wide desktop, a phone on its side) the square wins, a quarter larger with text a quarter bigger; where the width limits it, the 4:5; a phone held upright gets the tall one. Chosen again on resize; a change of shape redraws. A member's card may scale UP to 1.6, the admin's is still capped at full size so a screenshot is never soft.
- **Not a reflow.** The cards are still fixed 1080-wide artboards, scaled. Cards that lay themselves out at any width would be a redesign of about sixty templates and were deliberately not started.
- **Nothing to download.** The button is hidden and `downloadPng` returns at once in member mode. A card carries the brand, and a member posting one would read as the site publishing it. A screenshot cannot be stopped. The stock page's own "Save chart" is a separate, older feature and was not touched.
- **No Brand group** (Intro, How to, Announcement, Disclaimer, Profile picture): `MEMBER_HIDDEN`, from `BRAND_VIEWS`, filtered in `visibleTpls()`.
- **Called "Charts"** for a member: the page title and heading, and the screener's link (`admin-only` / `member-only` spans). The admin still sees "Promo Studio".
- **A link can open it on a view and a stock**: `/promo?tpl=<id>&sym=<SYM>`, on the first load only, for a view the person may see and a stock on the screen. The stock page has a "Charts" link beside Save chart, hidden from guests.
- **A narrow screen stacks the controls over the card** (under 820px), for the admin too.
- **Nothing new was exposed.** Every data route the studio calls was already `requireAuth` or `requireMember`, and members could already reach them. The heavier ones (history, evolution, peer trend, line series, perf, months) keep an in-memory cache; more members clicking through cards means more rows read on a cold instance, which is the existing cost growing, not a new one. The page route still refuses guests.
- Not rendered in a browser by the build. The shape rule and the wiring have a scratchpad suite (25 checks).

## Called Visuals, and no colour theme for members (2026-10-12)

The owner: "end users also don't need the option to select the color theme, Can you rename Charts to Visuals for everyone including me".

- **The page is "Visuals" for everyone**: the title, the heading, the screener's button, the stock page's link, the phone's empty-posts line and the help page. "Charts" lasted a few hours and "Promo Studio" is no longer shown anywhere. The address is still `/promo`, the file `promo.html`, and these notes and the code still say "studio": stored keys and paths are not renamed.
- **A member has no Ground to choose** (`body.mem #themeLab, #cardTheme` hidden, and the value set to `dark` on entering member mode). The four grounds exist to match a post to a feed. The admin keeps them.
- **Help section 16 was rewritten** as "Visuals". It had described a Download PNG button and a "Cards" room with a Save image button, neither of which a member has.
- Still true and worth knowing: a member can open a SAVED post on the phone page (`/m`, Posts), which hands over a real image. Saving is the admin's; reading is `requireMember`. That was not changed.

## A watermark in every card a non-admin sees (2026-10-13)

The owner: "all visuals shown to non admin users should have a watermark".

- **What was already there**: `wmark.js` tiles the viewer's email across the window at 5% on every data page, the studio page included. It belongs to the page, is faint, and is not part of the card.
- **What was missing**: a saved post a member opens on the phone is handed over as a real image, with no page around it, so it carried nothing.
- **`Cards.watermark(who)`** returns the mark as markup: "tickrlab.com · <account>" repeated as real text on the slant across the whole artboard (`.s-wm`), in the card's own text colour so it shows on a light ground too. Real text and not a background image, because the phone rasterises the card and an embedded image is the one thing that cannot be trusted to survive that.
- **The host decides who is marked**; a card does not know who is looking, and `Cards.build` is unchanged. The studio adds it in member mode (`wmWho`, from `/api/me`). `GET /api/m/post` adds it for anyone who is not the admin. The admin's cards, which are the ones posted, stay clean.
- `holder.html` and `holders.html` now load `wmark.js` like every other data page; they had shipped without it.
- It prevents nothing; it signs. A crop of any part of a card still says where it came from and whose screen it was.
- Not seen rendered by the build: the opacity (0.085) and spacing are a first setting and may want adjusting from a screenshot.

### The card's watermark says "Tickr Lab", not the viewer's email (2026-10-13, the same day)

The owner: "watermark should say the name of the app not the user email". The first version read "tickrlab.com · <account email>". `Cards.watermark()` now repeats **Tickr Lab** and takes no account; both hosts stopped passing one. Set a little larger and heavier, since two words carry less than a line of text did.

- The card mark now says whose picture it is, not whose screen it was. It no longer identifies the account a capture came from.
- **The page watermark is a separate thing and was not changed**: `wmark.js` still tiles the account email at 5% across every data page, the Visuals page included, for members and guests. So on that page a member's card sits under both: the app's name in the card, and the faint email on the page. Whether the page mark should change too is the owner's call and was asked.

### The page watermark says "Tickr Lab" too (2026-10-13, later the same day)

Asked, the owner chose: "switch it to 'Tickr Lab' everywhere". `wmark.js` now tiles **Tickr Lab** for every member and guest (the guest's "Guest preview" went with the email); the admin and open mode are still skipped, and the tile, opacity and `.wmark` rule are unchanged. The paragraph above is therefore history: no surface carries the account email any more.

- **What was given up, knowingly**: a capture can no longer be traced to the account it came from. The mark now says where a picture came from, not who took it. Do not restore the email without the owner asking.
- `/help` "The watermark" was rewritten in the same commit; it had promised that a capture "identifies the account it came from".

## Every company name on a card is a link (2026-10-14)

The owner: "make all the other visuals clickable only on the stock names". **`linkStockNames(stage)` in `promo.html`, run after every render**, not a change to seventy templates: any element under `.s-in` with no child elements whose whole text is EXACTLY a company's name, short name or ticker becomes a link to `/stock/<SYM>` in a new tab; a label cut short with an ellipsis is matched when only one company starts that way; an SVG `<text>` (or `<tspan>`) is wrapped in an SVG `<a>`.

- **Funds are not in the index** ("S&P 500" on a card is the index), a name two companies share links to neither, and the brand line (`.s-top`) is skipped.
- **Measured before it shipped**: all 68 templates built from a real day's rows, 110 distinct texts matched, every one a company. A dozen tickers are also words (ALL, ON, NOW, IT, KEY, CAT, SO, BE, ARE, TECH); none stands alone as a label on any template. A new card that prints one of those as a bare label would link it: if that happens, skip that element by class here.
- **The picture is unchanged**: `#stage a.s-nl` keeps the colour and has no underline (hover only). Checked: the Bubble card's PNG export is 626,229 bytes with the links and without them; the Pulled back card exports with its 14 links in place.
- The Pulled back list's rows stopped being whole-row links, so a name is the one thing to click there too.
- The phone shows saved posts as images, so it has no links.

**Widened 2026-10-16** (the owner, over a Chart legend reading "MU +226.2%": "make the tickers clickable on all promo cards"). The pass now walks **text pieces** (a TreeWalker over `.s-in`), not childless elements. A legend chip holds a coloured dot element as well as its text, so the element test skipped every chip. A piece may also be **a ticker followed by a figure** (`LEAD_TICKER`: a symbol in capitals at the very start, then a space and a sign, `$` or digit, as in "MU +226.2%" or "NVDA $181"). In HTML only the ticker becomes the link, by splitting the text node, and the figure is left as it was. In SVG the whole `<text>` is wrapped. Measured on all 71 views in the harness, old code against new: no view lost a link, links went from 114 to 161 (Chart and Race legends, sparklines, Lines, the holder card, the one-stock cards' company name), and every HTML link is drawn in its parent's colour with no underline.

## The card frame: small brand top-right, the date in the footer (2026-10-16)
The owner: "Move the Sector, Company Name, etc .. The topic of the visual to the top right and move the date and time to the very bottom ... for all visuals, This will give more space to the middle content". Offered three layouts; **chosen: the topic stays at top-left at full size, the brand becomes a small mark top-right, the date goes to the footer.** That frees about the same space without halving the headline, which is what stops a scroll in a feed.

- **`chromeTop` / `chromeFoot`** (cards.js) are the only template-side change, so every template follows. `chromeTop(dated)` records `footDate` (null for the evergreen cards called with `false`). `chromeFoot` prints it after tickrlab.com (`.s-fdate`), in place of "Screened nightly", which the undated cards keep. The footer may wrap (`flex-wrap`), and the 9:16 footer is 18px like the others so the dated line fits on one.
- **`.s-top` is absolutely positioned** (top 48, right 64, a 40px glyph and 26px wordmark), out of the flow, so the body gains the old row. The first kicker or title (`.s-body > div > .s-kick:first-child`, `… > .s-title:first-child`) keeps `padding-right: 260px` clear of it; the first kicker's top margin is 10px.
- **Checked on every view at every size** (72 views × 3 = 216, `chrome-probe.js` in the session scratchpad), by glyph boxes from a Range, not element boxes. No text or drawing touches the brand mark; nothing newly runs into the footer, and one card that did (scatter, square) is now clear; every dated footer is one line (207 cards). The first pass found 11 long titles grazing the mark's lower edge at 44px, and the mark was raised and made 4px shorter to clear them.

## The export filled a line black (2026-10-16)
The owner sent the Growth and profitability card for NVIDIA: on screen the net-margin line was a line; in the downloaded PNG the shape between its points was solid black, and the computed fourth quarter's dashed, half-filled bars were solid. **`cardshot.js` skipped every computed value of `none`**, a size saving that is safe where `none` is the default. For SVG `fill` the default is black, so a class rule's `fill: none` (`.pf-chart .pc-line`) vanished from the export. And `stroke-dasharray`, `fill-opacity` and `stroke-opacity` were not on `INLINE_PROPS` at all. Fixed in the one rasteriser, so every card and the phone's saved image get it: `KEEP_NONE` (`display`, `fill`) writes `none` where it matters, and the four SVG properties joined the list. Proved by pixels with the studio's real export: a class-styled open path and a dashed 30% bar on a card. The old exporter gave black inside the path and solid blue in the bar; the new one gives the ground and the blend. **The rule for a card**: a property a card sets from a class reaches the PNG only if `INLINE_PROPS` names it, so a card using a new SVG or CSS property needs it added there, or set as a presentation attribute.

## The Chart card asks only for what it draws (2026-10-17)
The owner: "when I am changing the window from 6 months to YTD, it is taking a long time". Every window change read the whole screen's bars (about 1,300 stocks × 260 sessions) through `/api/basket`, even to draw four benchmark funds. `tplChart` now names its symbols, the Stock spotlight's fix one card over: one stock (`stock`), two (`two`), or a leaders list's members when the list has at most `BASKET_ONLY_MAX` (60). The whole screen, a large cut (a sector over 60) and the average mode, which draws the whole screen's line beside the cut, still read everything. The server's cap on named symbols went from 10 to 60, the same number. `/api/m/post`'s dry build, which finds the symbols a card names, now runs for `chart` as well as `race`.
- **The studio tracked one basket request in flight**, so a slower earlier reply cleared a later request's marker and the next redraw asked again: three identical reads of Mag 7 YTD in the harness. It is now one marker per request (`chartPending` is a Set); after the change, one read.
- The five-year note ("Drawn from the stocks with the largest five-year change") had keyed on "the card named its stocks", which is now true of every small list. It keys on `winKey === 'y5'`.
- Measured in the harness: Mag 7 YTD reads 7 symbols, MU 6M 1, NVDA vs AMD 2, the whole screen everything.

## Benchmarks (Market group, 2026-10-17)
The owner: "add this chart under Market Template, you can call it Benchmarks", over the Chart card's leaders of the Benchmarks theme. `tplBenchmarks` runs `tplChart` in leaders mode, the Race chart's way, with the four index funds from `BENCH` (SPY, QQQ, IWM, DIA) set through `chartScopeFixed` rather than the hand-edited "Benchmarks" theme, so the card cannot change when the theme does. Its one control, `bmkWin` (past month, three months, six months, this year (the default), past year), maps onto `chtWin`; `basketDays` answers for it. It reads the four funds' bars only (the Chart card's named-symbols path), takes the card's spare height (`FILL_TPLS`), and `/api/m/post` finds its symbols with the same dry build as `chart` and `race`. The regular Chart card is unaffected (checked: leaders of the whole screen still read everything after a Benchmarks build).

## Fall from highs (Market group, 2026-10-17)
The owner, over a social-media chart of AI stocks below their highs ("Are all these stocks present in my app", 14 of 16 were): "add that under market, call it Fall from Highs". `tplFallHigh`: a cut's stocks furthest below their high, as bars hanging from a zero line, the smallest fall on the left and the deepest on the right, with ticker above and distance below. Bars start at zero, so the lengths are honest. **Against the 52-week high (`pctFromHigh`) or the record close on file (`pctFromAth`, stamped on read)**, by `fallFrom`; `fallCount` 10, 15 (default) or 20, capped by size (20 at 4:5 and 9:16, 16 square, said in the hint). The usual scope controls on the `fall` prefix (theme, sector, industry, size, screen, index); funds left out. **Red is right** (every bar is a price below where it was). **The words are descriptive**: "Fall from highs", "N furthest down", a note naming the measure and the typical distance in the cut, never the post's "collapse" or "bloodbath", and "a distance from a high, not a view on what comes next". Bars take the card's spare height (`FILL_TPLS`).
