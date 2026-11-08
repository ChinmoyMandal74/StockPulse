## Health (2026-11-07)

**The owner's brief:** "one field that gives one score based on everything that we know about the stock .. if the short term price move is acceptable .. long term is good on annualized basis .. the growth is good .. the valuation reasonable compared to its history and peers and short interest is acceptable .. its earning is above .. guidance raised … and recent news is positive etc .. it should get a score of 100."

**Agreed the same day, after two proposals:**
- Weights set by the owner's judgement on five pillars, not fitted to past returns. A fit would learn noise: ten of eleven backtests found nothing that predicts the next one to two months.
- Checks share their pillar's weight, so adding a check does not make its topic heavier.
- Three caps act as deal-breakers.
- The field is called **Health**. Everyone sees the number; **only admin sees the workings**, "like Signal".

### The rules (`health.js`, repository root)

| Pillar | Weight | Checks |
|---|---|---|
| Business | 30 | revenue growth, profitability (both through `Filters.growthProfileRead`, so Health and the Growth & profit word cannot disagree), balance sheet (net cash, else interest cover; no reading for Financial Services), share count (`sharesChg`) |
| Results | 25 | last quarter against the estimate (`erVsEstWord`), guidance change (`erGuideChange`) |
| Valuation | 20 | P/E against its own ten-year median (`peVsMed`), Value vs industry (`Filters.valueVsIndustryRead`) |
| Price | 15 | one month, three years as a yearly rate, trend (200-day and the 50/200 cross) |
| Sentiment | 10 | short % of float, Tone 7D |

- **Scoring:** a pass is 1, a middling reading ½, a miss 0. A pillar's points are the mean of its checks that have data. The score is the weighted mean over the pillars with data, times 100, rounded.
- **Floor:** under 60% of the weight with data, the score is null (a dash). Funds and error rows are null.
- **Caps:**
  - guidance Lowered or Withdrawn: at most 60
  - the Signal reads Very Weak (through `canon`): at most 50
  - shares up more than 10% in a year: at most 70

  The lowest firing cap holds.
- **Thresholds:** each check's thresholds are in its `rule` string, which the admin panel shows. Change them in `health.js` and in `health-test.js` together.
- **Guidance:** only Raised scores the full point. Reaffirmed, Initiated and Mixed score ½, because the owner's brief said "guidance raised".

### Where it is worked out

**On the server, as rows are served** (`stampHealth` in `server.js`), never in the browser and never stored:
- **Read paths:** `/api/stocks`, `/api/stock`, the phone's `mobileRows` and the CSV export.
- **Order:** it runs last, after `scoreActionInto`, `serveStamps` and `finishServe`, because it reads the Signal, the folded filings figures (`sharesChg`, `peVsMed`, `intCover`) and the peer ratios.
- **Tone and release inputs:** these are members-only surfaces. `healthView` lays them over each row through `Object.create(row)`, so the row itself gets only `healthScore`. A guest is served the same number as a member without ever receiving the inputs (checked by the harness).

**Why not in the browser like the Signal:**
- A guest's browser never has the tone or release data, so a browser-side score would differ by tier.
- `health.js` sits outside `private/`, so its thresholds are never served at all.

**The workings:**
- **Route:** `/api/stock-health?symbol=` (`requireAdmin`) works them out over the whole snapshot, with the same stamps in the same order, so the panel's number is the column's number. A harness sample of 13 symbols agreed.
- **On the screener:** an admin clicks the Health cell, and the panel (`openHealthPanel`, in `#actionPanel`) draws each pillar, each check's figure, its rule in words and the caps. For a member the cell is plain text: no pointer, no title, and the click does nothing.

### The screener column

- **Placement:** in the Scores group beside Qual.; the banner colspan went from 1 to 2.
- **Fixed counts:** `PAD_SPAN` went from 177 to 178, the error row from 152 to 153 and the empty row from 154 to 155.
- **Funds:** `naRun(1, 'grp-rank')`.
- **Elsewhere:**
  - one `FIELD_SPEC` row (`rank|Health`), which feeds the hover card, tiles, phone and /compare
  - a tile chip beside Qual
  - a source line in `fieldsource.js`
- **Colour:** none. Green and red mean price; the panel marks a check's 1, ½ and 0 in accent, muted and orange.
- **Sorting and filtering:** it sorts and filters like any number column (`>=70`). It is an ordering of a description, labelled as one on /help (section 3, `#health`), which states the topics but not the weights or thresholds.

### Today's spread (2026-11-07, 1,281 rows)

- **Coverage:** 1,229 rows carry a number. The rest are 24 funds and 28 companies without enough data, mostly foreign filers.
- **Distribution:** median 67, quartiles 50 and 80, p10 44, p90 88. A peak at 50 comes from the Very Weak cap: 383 rows read Very Weak.
- **Examples:**
  - MSFT 98
  - NVDA 90: one month −19% and a mixed trend
  - ALB 50: 70 raw, capped by its Very Weak Signal
  - AXON 38

### Tested: research entry 27 (the same day)

- **The test:** a lookalike rebuilt month by month from 2010 by the live rules, on filings as filed, prices, and from 2017 the releases' outlook change. The estimate, short interest and tone checks were missing throughout, so it rests on 65% to 90% of the weight. The tests were written down in advance (scratchpad `hl/PREREG.md`). The scripts are `hl/replay.js`, which takes 23 minutes, and `hl/analyse.js`.
- **Health 90+ after a 15% fall:** it did no better than the average stock, typically 0.8 to 1.6 points behind over one to two months. It also did no better than Health 90+ near its high.
- **The bands:** higher Health did not come before better returns. On the average, under-50 beat 80+, carried by a few huge rebounds, while the under-50 median was the worst band. What Health orders is the downside: the worst tenth was 3 to 8 points shallower for 80+ than for under 50, in both periods.
- **Traps:**
  - The release history stores outlook changes in lower case (`lowered`); Health matches `Lowered`, so the replay has to map them as `ReleaseView` does.
  - Before 2014 few companies have the 20 quarter-ends the P/E history needs, so valuation rests on the industry comparison alone.
- **Against the S&P 500 (entry 28, the same day):** equal-weight baskets by Health band against SPY. 80+ was ahead before 2020 (+0.35 points over 42 sessions) and level from 2020 (−0.09), and behind the basket of every stock in both periods. Scripts `hl/analyse-spy.js`, plan `hl/PREREG-SPY.md`.
- **Stored history in production:** none. The inputs are all kept by date, so any day's Health can be rebuilt (the owner). Backlog 59 is Done.

### The kept history, for later tests (2026-11-07)

The owner: "Keep the health history … I might ask for more such tests in future."

- **Where:** `health-history.db`, a local file in the repository folder, gitignored. It is never in Turso and never deployed.
- **What:**
  - `health_months`: one row per build, stock and month. It holds the score, the weight with data, whether a cap held, each pillar's points, the next 21 and 42 sessions' returns, and every input as JSON.
  - `health_bench`: the equal-weight average stock and SPY over the same windows.
  - `health_builds`: when each build was made, a hash of `health.js`, and a note.
- **A build never replaces an earlier one.** Each run adds a build id, and studies read the newest. Build 1 is the run behind entries 27 and 28, imported from its scratch file.
- **Building:**
  - `node --use-system-ca --no-warnings health-replay.js` makes a new build in about 25 minutes. It reads `analysis.db` (sync it with `--sec` first) and makes one Turso read of the snapshot, for today's sector and industry taxonomy.
  - Months without 42 sessions ahead are kept with blank returns, so a later build fills them in.
- **Studying:**
  - `health-study.js` prints the bands against the average stock (entry 27) and the band baskets against SPY (entry 28), and reproduces both to the decimal.
  - `--build N` reads an older build.
  - `--rescore` runs today's `health.js` over the stored inputs, so a changed threshold can be tested without a replay.
  - For a new test, start from `HealthReplay.load()`: write the plan down first, then add a research entry.

### Tests

- **`health-test.js`** (114 checks):
  - every threshold from both sides, null versus zero, rescaling, the floor, the caps, funds and the filter grammar
  - the Signal boundary: identical verdicts with Health absent, present and lying
- **Proved by breaking guards:** null as zero fails 14 checks, no caps fails 7, no floor fails 3.
- **Screener harness:** a 32-check run on the in-memory database seeded with the real snapshot covers column alignment, admin and member behaviour, the API refusing members and anonymous callers, and `health.js` not being served. It lives in the session scratchpad and is not checked in.
