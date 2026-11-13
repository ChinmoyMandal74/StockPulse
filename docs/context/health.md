## Health (2026-11-07)

**The owner's brief:** "one field that gives one score based on everything that we know about the stock .. if the short term price move is acceptable .. long term is good on annualized basis .. the growth is good .. the valuation reasonable compared to its history and peers and short interest is acceptable .. its earning is above .. guidance raised … and recent news is positive etc .. it should get a score of 100."

**Agreed the same day, after two proposals:**
- Weights set by the owner's judgement on five pillars, not fitted to past returns. A fit would learn noise: ten of eleven backtests found nothing that predicts the next one to two months.
- Checks share their pillar's weight, so adding a check does not make its topic heavier.
- Three caps acted as deal-breakers; two since 2026-11-13, when the owner dropped the Very Weak cap (below).
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
  - ~~the Signal reads Very Weak: at most 50~~ dropped 2026-11-13 by the owner after research entry 29 found capped stocks did no worse than their peers; Health no longer reads the Signal at all (`health-test.js` holds it: a Very Weak row scores as its parts do)
  - shares up more than 10% in a year: at most 70

  The lowest firing cap holds.
- **Thresholds:** each check's thresholds are in its `rule` string, which the admin panel shows. Change them in `health.js` and in `health-test.js` together.
- **Guidance:** only Raised scores the full point. Reaffirmed, Initiated and Mixed score ½, because the owner's brief said "guidance raised".

### Where it is worked out

**On the server, as rows are served** (`stampHealth` in `server.js`), never in the browser and never stored:
- **Read paths:** `/api/stocks`, `/api/stock`, the phone's `mobileRows` and the CSV export.
- **Order:** it runs last, after `scoreActionInto`, `serveStamps` and `finishServe`, because it reads the folded filings figures (`sharesChg`, `peVsMed`, `intCover`) and the peer ratios.
- **Tone and release inputs:** these are members-only surfaces. `healthView` lays them over each row through `Object.create(row)`, so the row itself gets only `healthScore`. A guest is served the same number as a member without ever receiving the inputs (checked by the harness).

**Why not in the browser like the Signal:**
- A guest's browser never has the tone or release data, so a browser-side score would differ by tier.
- `health.js` sits outside `private/`, so its thresholds are never served at all.

**The workings:**
- **Route:** `/api/stock-health?symbol=` (`requireAdmin`) works them out over the whole snapshot, with the same stamps in the same order, so the panel's number is the column's number. A harness sample of 13 symbols agreed.
- **On the screener:** an admin clicks the Health cell, and the panel (`openHealthPanel`, in `#actionPanel`) draws each pillar, each check's figure, its rule in words and the caps. For a member the cell is plain text: no pointer, no title, and the click does nothing.

### The Health card: the workings for everyone (2026-11-13)

**The owner:** "everyone sees the health breakdown, this is going to be an important feature, most reel videos going forward need to show this as well .. keep the existing hover code somewhere .. no need of word, just score is enough." This replaces "only admin sees the workings" above, for the parts and figures; **the threshold rules stay admin-only** (the panel above).

- **The card** is the screener's hover since this day, after a mock-up the owner approved (modelled on a quality-score card they liked): the symbol, name, price and the day's change; one year of closes with the 50-day (blue) and 200-day (orange) averages and their values; Health as a number (no word beside it); a bar split by weight (30, 25, 20, 15, 10), each slice filled by its points; the sum line (`30 + 25 + 20 + 15 + 7.5 = 97.5 → 98`, or `… = 64 of 75 → 85` when a part has no data); a cap line in amber when a cap held the score; a tile per part (its points of its weight, a bar, each check's dot and figure: full pass, half, empty miss, dashed "no reading, left out"); a key tile; the Signal with its rule.
- **A colour a part** (the owner, the same day: "a little bit more colorful"): Business indigo, Results cyan, Valuation orange, Price sand, Sentiment blue (`PART_COLOR`; Valuation was fuchsia and Sentiment pink until the owner asked for brighter, more distinct ones on 2026-11-13, after the Instagram Health card, set inline as `--pc`), on the part's slice of the bar, its name under it, its tile's top edge and tint, pill, bar and dots. A ring round the score shows each part's share of it in its colour (a conic gradient over the weight with data, so a full ring is 100). Never green or red (price) or amber (stale or wrong); the averages are blue and orange. The key tile's dots are muted.
- **One builder:** `RowCard.healthCardHTML(s, opts)` draws the frame, `RowCard.paintHealthCard(el, s)` fills the chart and the workings (returns a promise); `maChartSVG` the chart. For the reels and promo cards to draw the same card. Styles under `.hcard` in `app.css`, tokens only (both themes checked).
- **On the stock page** (the owner, the same day: "shown on top of the individual stock page as well"): a Health section first under the jump bar, above At a glance (`#health`, in the jump bar; none for a fund). The workings only, without the card's head, chart and Signal, which the page has: `RowCard.paintHealthWorkings(box, symbol)` draws them flat (`.hcard.hc-flat`, no second frame), the tiles across the width (six a row at 1400px, one on a phone, where the names under the bar are hidden as too narrow). Data from `/api/health-parts?symbol=`, that stock only, the same working; the whole set if the page already holds it. The harness's same run fixed an older fault: the page read `#tip` once while drawing, before the parser reached it on a fast answer, so every scroll and resize threw; it now looks it up when used.
- **The old hover** (every field of the row) is `RowCard.buildHTML` with `paintChart`, unchanged and still exported; `RowCard.attach({ legacy: true })` draws it.
- **The data:** `/api/health-parts` (`requireAuth`), every stock's workings in one request, worked out exactly as `/api/stock-health` (the same stamps in the same order), packed by `Health.parts` (no rule strings) with `Health.layout` sent once: about 430 KB raw for 1,257 stocks. The screener asks 1.2s after its table is first drawn (where the card can open), the card itself if it gets there first, and the answer is kept ten minutes (`HEALTH_KEEP_MS`). On production the request takes 1.1 to 1.6s warm and 3.8s cold, about 80 KB compressed; one stock at a time took 0.7 to 1.2s, every hover. A guest gets the twenty stocks they are served, and with them the tone figure behind the Sentiment check (members-only before; the owner's "everyone").
- **The chart's history:** `HISTORY_DAYS + 199` closes (452), so the 200-day average is drawn across the whole year; the year shown is `HISTORY_DAYS`, the 1Y figure's window.
- **Placement:** placed on showing and again once filled (it grows to its full height then); `#rowcard` scrolls inside a window shorter than the card.
- **Tests:** `health-test.js` (the packed form: points add up to the raw score, a part without data, a cap, no rule text). A 24-check harness in the session scratchpad (`hc/hc-test.js`, in-memory database seeded with production's rows) checks every scored stock's card number against the column, the pillars adding up, no rules or funds in the answer, and in the browser the card drawn for MSFT (number, five pills, thirteen dots, both averages in the theme's colours and the 50-day equal to the mean of the last 50 closes, the bar split by weight, names inside it, inside the window), a stock with no history, light and dark; `LOCKED=1` checks signed out (401) and a guest. Proved by breaking: no guest filter fails 2, skipping the scoring pipeline makes 1,087 numbers disagree.

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
- **Distribution:** median 67, quartiles 50 and 80, p10 44, p90 88. A peak at 50 came from the Very Weak cap: 383 rows read Very Weak (figures from before the cap was dropped on 2026-11-13).
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
- **The Very Weak cap (entry 29, 2026-11-13, the owner asked after NVIDIA showed 50 on parts of 88):** stock-months whose parts came above 50, split by whether the Signal read Very Weak, within bands of the uncapped score. Capped stocks did no worse in the typical case (42 sessions: +0.39 points against peers before 2020, +0.34 from 2020, both intervals across zero); both tails were about 3 points wider. The cap marks a sharp fall, not weaker months ahead; keeping it was a presentation choice. **The owner dropped it the same day**: NVIDIA now reads its parts, 88. Script and plan in the session scratchpad (`hc/capstudy/cap.js`, `PLAN.md`), reading `HealthReplay.load()` and rescoring with today's rules.
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
