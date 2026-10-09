## The adjusted backtest — the same rules, replayed on what was public then (2026-09-29)

**`/adjustedbacktest` (admin, a Research row on the console): pick a date, and the Advice rules are re-run with every fundamental taken from filings PUBLISHED BY THAT DATE and every technical rebuilt from the bars.** The owner's framing: *"another page similar to /backtest ... everything should be based in Adjusted calculation, make sure nothing changes for the Balanced Advice calculation or front-end, this is just research."*

**IT STARTS IN 2018, WHERE `/backtest` STARTS IN JULY.** That is the whole point of it existing. `/backtest` is capped at two months because `fundamentals_history` begins 2026-08-30 and everything earlier imputes today's figures — a look-ahead. A filing carries `filed`, the day the number became public, so a 2018 replay is honest in a way the vendor snapshot can never be. The floor is **FINRA's** (short interest from 2017-12-29), not the filings'.

- **It reuses `btRun`, `btRowAt`, `btCurve` and `btMatrix` unchanged.** The only thing supplied differently is `recorded` — the overlay `btRun` already spreads over the snapshot row. A second row builder would drift from the Advice column inside a week, which is why those were extracted at all, and reusing them is what kept this small.
- **`Adjusted.overlayFrom` is shared with `/adjusted`**, so the card and the backtest cannot disagree about what a filings-derived fundamental is. The one thing that differs between them is which close the market cap is struck at.
- **THE BOUNDARY: `/api/backtest`, the Advice column and the screener are untouched.** `adjbt-test.js` asserts all three — including that `/backtest` still refuses a two-month-old date and still runs on a recent one, so "nothing changed" is checked rather than asserted.
- Admin only, behind `standAside`, cached ten minutes per (date, horizon, rules, theme, tiers).

### THE DERIVED QUARTER WAS DATED BY A FILING MADE TWO YEARS LATER
**The single finding that made this possible, and it took a non-monotonic measurement to notice.** Filtering the trail on `filed <= asOf` is the obvious move and it is not enough. Coverage measured across the universe — the share of filers with a full trailing year:

| as of | filtering on `filed` alone | re-derived (shipped) |
|---|---|---|
| 2018-07-01 | 62% | **81%** |
| 2020-07-01 | 71% | 89% |
| 2022-07-01 | 11% | 88% |
| **2024-07-01** | **7%** | **90%** |
| 2026-07-01 | 85% | 91% |

**A collapse in the middle is not a story about data depth**, which is what sent me looking. The cause: `deriveQuarters` attributes a derived quarter to `cur.filed` — the FY row it was differenced from — and `outranks` picks the NEWEST restatement of that year. Measured on MSFT:

```
period 2021-06-30   filed 2023-07-27   759 days after
period 2022-06-30   filed 2024-07-30   761 days after
```

That quarter **was** knowable in 2021: the FY2021 10-K and the Q3 10-Q were both public. Hiding it until 2023 understates what a reader had, and since a trailing year needs four consecutive quarters, one invisible Q4 kills the whole TTM — and with it the margins, ROE and the P/E that decides the company type.

- **`SecFacts.visibleAsOf(rows, asOf)`** keeps filings public by the date, **drops the stored derived rows and re-derives from what is left**. `outranks` then picks the newest annual THAT WAS PUBLIC, and the quarter carries its date. More accurate and more honest, not a workaround.
- **FCF margin went 0% → 70%** and gross margin 36% → 56% on the same measurement, because those depend on the differenced cash-flow ladder even harder than revenue does.
- **Rows are copied first.** `deriveQuarters` fills holes in its inputs in place and `fill` mutates, so asking a cached trail about the past would otherwise corrupt it. There is a check that the input is byte-identical afterwards.
- **`/stock`'s SEC card and `/adjusted` still use the stored derived rows**, which is right for them: they answer "what is true now", where the newest restatement IS the best answer.

### The three other point-in-time rules
- **`filed`, never `periodEnd`.** MU's quarter ending 2026-05-28 was not public until 2026-06-25; filtering on the period end buys four weeks of look-ahead. **Proved by reverting**: swapping the one comparison fails 2.
- **FINRA is published about eight business days after it SETTLES**, so a reading settled on the 15th was not knowable on the 16th. `SHORT_LAG_DAYS` is **15 calendar days** — deliberately longer than the ~10-12 the schedule implies, because erring late means the backtest knows LESS than a reader did, which is the safe direction. It is a constant rather than a measurement because the table stores settlement dates and nothing else; pinning it against FINRA's own calendar is still owed.
- **A SYMBOL WITH NO USABLE FILING IS DROPPED, NEVER IMPUTED.** Falling back to today's vendor figures for the stragglers is exactly the look-ahead this page exists to remove, and it would make the result a silent blend of two sources. They are counted on screen instead. **Proved by reverting**: letting them through scores a company whose every filing postdates the date.
- **The benchmark is NOT narrowed the same way.** Every stock with bars is in the equal-weight line, including the funds and the late filers the rules could not score — narrowing it to the pool the rules selected from would flatter the comparison.

### Two bugs the suite found that every probe had missed
- **`String(req.query.horizon)` is the STRING `"undefined"` when the parameter is absent.** The first cut looked the default up, found it, and then used the literal `"undefined"` as the key: `hzDays` came back undefined, the date arithmetic produced NaN and the route 500'd inside `toISOString`. **Every hand-run probe had passed a horizon explicitly.** The check that caught it asks for an unknown theme with no horizon given, which is why it reaches the arithmetic at all.
- **A 3M hold was 98 days.** The bar window was read six days past the horizon "so the last mark is not lost to a weekend" — but `btRun` measures the return to the LAST BAR IN THE WINDOW, so every extra day of bars is an extra day of holding while the page still says 3M. **A screenshot caught it**: the axis ended 2024-04-10 under a panel saying the hold ran to 2024-04-04. The window is the horizon exactly now; where it falls on a weekend the last session before it is the right close.

### The rebalance loop is SHARED, and the extraction was proved by diffing
**`btRebalance` was extracted from `/api/backtest` rather than copied**, because the only thing that differs between the two pages is where the fundamentals at each rebalance date come from: `/backtest` folds forward one read of `fundamentals_history`, this one asks the filings what was public on that date. Everything else — the exit-tier rule, the re-cut, the seeded random control, the coverage line, the trade log — is one implementation. Two would drift inside a week, the way the two row builders `techrow.js` exists to unify already had.

`funds(at)` is called ONCE per rebalance date and returns a per-symbol getter. That shape is what lets the fold-forward keep its cursor and the filings version compute a FINRA cutoff, without either leaking into the loop.

- **PROVED BY DIFFING, not by a suite** — `bt-test.js` is broken at HEAD (pre-existing), so there was nothing to lean on. `/api/backtest`'s full response was captured over five parameter sets (buy-and-hold, weekly rerun with cost, a top-5 cut, a fortnightly exit-only run, and a non-default rule set) before and after the extraction.
- **THE FIRST DIFF LOOKED LIKE A REGRESSION AND WAS THE MARKET BEING OPEN.** Three classes of value move between any two runs: SPY's newest close (fetched live), today's provisional bar — `priceNow` went 614 to 615.01 between captures — and every return computed off it, *including the order of the picks array*, which is sorted by return and so re-orders 1-ULP differences into the curves.
- **The control experiment is what settled it**: the same code run twice, minutes apart, differs in exactly the same places. Comparing structurally — **6,171 fields across the five cases: every pick's verdict, flag, type, cushion, priceThen, tierRank and selection; every trade block's date, held, sold and bought; turnover, rebalances and rankable** — gives **0 differences both for same-code-twice and for before-versus-after.**

### The honesty panel is not optional furniture
**It is LAST on the page since 2026-09-30 (owner's request), and that is a change of place, not of status.** It sat between the chart and the evidence for it; it now sits under the picks table, after everything it is a caveat about. It is still unconditional, still carries every limitation, and the five checks on its contents are unchanged — with a sixth asserting it is **drawn below** the chart and the picks, measured as position rather than markup order, so a later edit cannot quietly move it back.

Four spot readings came back with positive excess (+1.7, +4.0, +2.6, +0.8 points over the equal-weight universe at 2026-06, 2024-01, 2020-03 and 2018-06). **That is not a finding and the page says so in as many words.** One window is one observation; the research log has taken eleven framings and found ten flat; and **survivorship is untouched** — the pool is today's 1,181 tickers, so companies that went bankrupt or were acquired are absent from both the picks and the benchmark. A page that printed a positive excess without that panel would be the failure the whole research log exists to prevent. There are five checks asserting each limitation is on screen.

**What is NOT point-in-time, and is named there**: the share FLOAT that short interest is divided by is today's (no filing states one), and the company names and theme memberships are today's.

### Cost, and what is not built
- **About 35 seconds cold on production, 65-80s from a laptop**, cached ten minutes. The instrumented breakdown is on the response: **the six reads run CONCURRENTLY, so their times OVERLAP and must not be summed** — the first cut subtracted them from the wall clock and reported an overlay phase of MINUS 119 seconds. **The reads are the whole cost and the bars are nearly all of it**; the controls are close to free, measured on the same window: a top-N cut adds nothing at all (64.8s against 65.1s) and a fortnightly rebalance adds **1.2s of evaluation**. Production is about twice as fast as a laptop because the function is co-located with the database.
- **`readBarsWindow` is bounded at both ends and carries three columns**, not five. `readBarsFullFor` is open-ended forward, which suits the live refresh and would have carried six extra years per symbol here — past the ~83MB wall this file records. **It is still the dominant term by a distance**: measured in isolation against production, the bars are **56.0s** against 1.6s for the filings and 1.2s for short interest. Anything spent optimising the other two is spent in the wrong place.
- **The overlay is cached on the NEWEST FILING VISIBLE at a mark, not on the mark.** Most rebalance dates see exactly the filings the one before did, because nothing was filed in between. Measured over 1,019 filers and six marks: **3.73s** recomputing every time, **3.69s** with a per-(symbol, date) memo — which almost never hits — and **0.61s** keyed on the newest filing, reusing 5,095 of 6,114 lookups. The obvious memo was worth nothing; the key is what mattered.
- **Rebalancing, the top-N cut, the random band and the trade log ARE built** — added the same day, at the owner's request, after the first cut shipped without them. **A rolling sweep of many start dates is still not**, and that is the one that would turn this from an anecdote into evidence; at ~35s a window on production (65-80s from a laptop) it is out of reach until the read is cheaper — see [docs/backlog.md](docs/backlog.md) entry 17.
- Verified: **117 checks** — `visibleAsOf` both ways, the input left unmutated, the FINRA cutoff, the overlay setting every field (a field merely OMITTED would let the vendor's value through), and a fixture where **each company separates one mechanism from the others**: TURNED's vendor row is byte-identical to STEADY's and says strong while its 2023 filings say weak, LATEFIL's every filing postdates the date, and SHORTED/CLEAN are the same Early company differing only in FINRA history. Plus the boundary, the roles, the capitalised address, and the page. **Proved by reverting five times**: `periodEnd` for `filed` fails 2, keeping the stored derived rows fails 2, falling back to the vendor fails 1, the newest FINRA reading fails 2 (**the twins come out identical, `Buy with Risk vs Buy with Risk`**), and the six-day slack fails 2.
  - **A TOP-N CUT HAS TO BE RE-APPLIED AT EVERY REBALANCE, and the first version of this suite did not check.** `/backtest` shipped without that once and quietly held all twenty from the first mark while reporting a top-5 run — invisible until the trade log named the fifteen it bought. Disabling the re-cut in the shared loop broke **nothing**, which is how the gap was found: the check now asserts the held count never exceeds the cut at any mark, and reverting gives `4,4,4,4,4,4` against a cut of 2 — the production symptom in miniature.
  - **A FIXTURE WHERE EVERY STOCK HAS THE SAME PRICE PATH CANNOT TEST A CUT.** Holding two of four averaged to exactly the same number as holding four, so "the cut changes the answer" failed against a cut that was being applied correctly. The fixture now keeps the histories identical — so the verdicts still turn on the filings alone — and gives each stock a different FUTURE.
  - **THE CACHE KEY HAS TO CARRY EVERY CONTROL.** Leaving the cut and the rebalance out of it serves one run's numbers for another; reverting fails 12.
  - **A CUT THAT CANNOT BIND WAS INVISIBLE, and the owner asked why (2026-09-30).** `Top 10` in the control, `6 positions` in the book, and nothing on the page joining them: only six stocks were Strong Buy on that date under point-in-time filings, so `top` collapsed to 0 — hold them all — which is correct, since you cannot hold ten when six qualify. **The behaviour was right and the silence was not.** The payload carries **both** numbers now (`top` applied, `topAsked` requested) because *they differ exactly when a reader is confused*, and the page says so in the two places the question is asked: the band line, which had rendered **nothing at all** in precisely this case, and beside the count in the opening block. There is a check that it **stays quiet when the cut does bind**, or the sentence is furniture rather than an explanation. **Proved by reverting**: dropping the note fails 2, dropping `topAsked` from the payload fails 5.
  - **A CUT EQUAL TO THE PICK COUNT IS NOT A CUT, and the route is right to say so.** `top` collapses to 0 unless it is strictly smaller than the number of picks, so no random band is drawn — correct behaviour, and it made two page assertions fail over a control working as designed. The fixture gained a fourth qualifying company (`STEADY2`, filings identical to STEADY's so the verdicts still turn on the filings alone, its own price path after the date) because **the PAGE's smallest cut is Top 3** and three picks cannot be cut to three. Deliberately not solved by adding a `Top 2` option: the page offers cuts worth offering over a thousand stocks, not cuts that suit a fixture.
  - **`page.selectOption` ON A VALUE THE SELECT DOES NOT CARRY TIMES OUT AT 30s RATHER THAN FAILING**, logging *did not find some options* — so a test asking the page for a control value it does not have reads as a hang rather than as a wrong expectation. The API half of this suite drives `top=2` directly, which is fine; the page half has to use a value the page actually offers.
  - **THE BOUNDARY CHECK IS ON THE ROWS, not the serialised payload, and the coarse version cried wolf against production.** `/api/stocks` has carried a top-level `asOf` — the forward-returns date, null in normal use — since long before any of this, so searching the whole body reported a leak that did not exist. A boundary test that raises a false alarm is one that gets ignored, which is worse than not having it. **Proved by reverting**: stamping `notFund` and `ttmTo` onto the read path fails 2, naming both.
  - **Three fixture faults, all the same shape — the fixture did not actually isolate what it claimed.** LATEFIL's filings were pushed 400 days out, which moved only the recent quarters past the date and left the older ones perfectly visible, so it was scored on those. SHORTED was built Established, and **short % of float only gates an EARLY rule** — 95% of float changed nothing. And the twin comparison ran with four tiers, where the squeeze pushes SHORTED to a verdict the run does not ask for, so an absence was being compared against a verdict.

### What each book DID over its own period (2026-10-03, owner's request)
**"Can you also show me the returns of the stocks held for that period individually, and also a total return for the held period."** Every block in `The book at every date` gained a **This period** column beside the existing one, and a total row under it. The screenshot circled the empty return column in the OPENING block, which is the one that had nothing at all to put there.

#### THE PERIODS TILE THE RUN, WHICH IS WHAT MAKES EVERY NUMBER CHECKABLE
A book's period runs from the mark that opened it to the mark that replaces it, the last one to the end of the window — no gap, no overlap. `nav` is recorded **after** each rebalance, so `nav[0] → nav[m1] → … → nav[last]` telescopes, and **compounding every block's period return lands on the rebalanced return already printed on the card above**. That is the property worth having: a reader can check any figure in a block against a figure already on screen, rather than being handed a column of numbers that answer to nothing.

- **The obvious wrong answer is to end every period at the end of the WINDOW**, which still produces something that looks like a return for each block and compounds to nothing. **Proved by reverting**: it fails 3, including the compounding check on both runs.
- **THE OPENING BOOK IS A PERIOD TOO and had no row to hang one on** — the log begins at the first rebalance. `btSimulate` returns an `opening` object, and **its members come from the simulator's own opening set rather than from the picks table**, so the page cannot show a position the run did not actually take. **Proved by reverting**: fails 9.
- **The two numbers measure different spans and the row says which.** `Since entry` is what the position has done from the day it was bought; `This period` is what it did from this date to the next rebalance. On any fixture where nothing is flat they differ, and there is a check that they do.

#### THE TOTAL IS THE BOOK'S OWN VALUE, NOT THE MEAN OF THE ROWS — and the revert said so first
The two differ by any cash held, by the weights drifting in exit-only mode, and by the cost of the rebalance that ends the period. **On the main run they coincide to the decimal** — equal weights, fully re-weighted, no cost, so a portfolio's return simply IS the mean of its members' — and the first revert of this guard therefore reported **NOT LOAD-BEARING** over a claim the note makes in as many words. It is proved where the two CAN differ: at 200bps of dealing cost the gap reaches **1.03 points**, and that run's periods still compound to its own headline. *A guard that cannot bite on the default fixture needs a second fixture, not a quieter claim.*

#### A sold row carries none, deliberately
The position is gone at that mark, so a forward return on it would be *what it went on to do without us* — which reads as a verdict on the rule rather than a fact about the book, the line the peer table and the picks table both decline to cross. **Proved by reverting**: offering one fails 1.

- **A null is an em-dash, never `0.0%`**, which would claim the name went nowhere. Unreachable on real data (`btMatrix` carries a close forward, so a held name always has a price at both ends), so it is driven by **rewriting the response** — the technique the `rebalError` note already uses, and for the same reason.

#### Four layout faults, three of them found by eye
- **`#abTrades .tr` IS A GRID, NOT A FLEX LINE**, so a fifth cell needs a fifth **track**. Adding the span alone pushes every row's last value out of its column — caught by reading the CSS before applying the patch, and **proved by reverting**: the four-track version fails 2.
- **"SINCE ENTRY" WRAPPED TO TWO LINES in a 70px track** and doubled the header's height. Found on the screenshot; every assertion had passed over it. The honest measure is awkward here: these are **grid items, hence blockified**, so `getClientRects()` on the element returns ONE box however the text flows — **a Range over the contents is the only line count that can see a wrap**. The documented `getClientRects` lesson, met in the blockified case this time. **Proved by reverting**: fails 1.
- **The opening block heads only the column it fills.** Every position there was opened on that date, so `Since entry` is empty on every row and a heading over it reads as missing data.
- **`.q` carries no margin**, so the summary's new clause needed a literal leading space or it printed hard against the turnover figure (`turnover 1%· +3.3%`). There is a check on the rendered text, because this is the kind of thing that is invisible in the markup.

#### Worth knowing
- **`/backtest` gets the fields and ignores them.** The two pages already render this payload differently, so the shared half is `btSimulate` and `btTrades`; only the adjusted page draws the column.
- Verified: **34 checks**, the fixture giving every stock a **different drift** so a column wired to the wrong symbol, or a period wired to the wrong pair of dates, comes out at a different number rather than coincidentally the same one. Every position's period return is recomputed from the suite's **own** bar generator, never from the payload. **Proved by reverting eleven times**, every one load-bearing.
  - **THE `/backtest` CHECK WAS VACUOUS ON ITS FIRST RUN** — `trades.every(…)` over **0 blocks** passes trivially, and the fixture's bars stopped in 2025 while that route only accepts a date inside two months. The fixture reaches today now and the suite asserts the run really rebalanced before asserting anything about its blocks.
  - **`#abTrades` carries the explanatory note, so `details:first-child` matches nothing** — it is `:nth-of-type`. A selector that matches nothing reads as a missing feature.
  - **`adjbt-test.js` READ THE FIRST `.tr` IN A BLOCK and that is now the column header.** Its claim — kept rows lead the bought and sold ones — is intact, so the check was **corrected rather than worked around**: it reads the first DATA row (`.tr:not(.hdr):not(.tot)`), which is what it always meant.
  - **Three reverts aborted the suite and reported a load-bearing guard as a marginal one**, because a page read throws once the element it names is gone. Every page read is defensive now, and the harness prints `?? only N of 34 ran`.

### THE REBALANCE WALKED ONE AXIS AND READ ITS PRICES OFF ANOTHER (2026-10-03, owner: "why is the monthly buy and sell not showing anymore")
**A 1Y run from 2025-09-01 with Rebalance = Every month drew no rebalanced line, no trade log and no error.** Measured against production before changing anything:

| | first date | dates |
|---|---|---|
| the BASKET's axis (`tier.dates`, the picks' own union) | 2025-09-02 | 253 |
| the UNIVERSE's axis (`market.matrix`, every symbol's union) | **2025-09-01** | **261** |

`btRebalance` walks the basket's axis and was handed the universe's matrix. **1 September was Labor Day** and something in the universe carries a bar on it, so `btSimulate`'s first line — `px[sym][0] > 0` over the opening symbols — found null on every one, returned null, and the route reported **nothing**: `rebalanced` null, `trades` null, **`rebalError` null**.

- **THE MISALIGNMENT IS NOT ONLY AT INDEX 0, which is the half the report could not show.** The two axes differ by eight dates *throughout*, so every rebalance has been reading `px[sym][j]` off the wrong session wherever a non-pick traded on a day no pick did. The holiday start merely made it fail loudly enough to notice; on an ordinary start date it was silently wrong.
- **`/backtest` HAS THE SAME BUG and its own comment said otherwise** — *"Prices on the shared axis for EVERY symbol"*, above `btMatrix(r.everySeries, asked)`, which builds a different union from the `axis` two lines above it. A comment asserting the invariant that is being broken.
- **The fix is one parameter: `btMatrix(series, from, axisDates)`.** Given an axis it uses it instead of deriving the union, and the forward-pointer walk already carries a symbol's last close across a date it did not trade — which is the correct treatment and is what makes the parameter safe. Both call sites pass the basket's axis, because that is what the returned `values` are plotted against.
  - **`market.matrix` can no longer be reused**, which was the previous line's whole justification (*"reuse it rather than walking every symbol's series a second time"*). It is on the wrong axis. The second pass is ~1,283 × 253 and is not measurable against a 40-second run.

#### THE SILENCE IS THE OTHER HALF, and it is what made this a report rather than a bug report
`btSimulate` returns **null rather than throwing**, so the existing `catch` never fired and `rebalError` stayed null — and **neither page displayed `rebalError` at all**, so even a set one would have gone nowhere. Both routes now set it when a rebalance was asked for and produced nothing, and both pages print it where the section would have been, saying the buy-and-hold result above is unaffected.

- **A COUNT CANNOT PROVE THAT GUARD, and the harness says so rather than reporting it as residue.** It is shielded by the axis fix — with the axis right the rebalance never fails — so it is reverted *together with the axis bug*, and then two checks simply trade places (`nothing is reported as failed` starts passing as `never silent` starts failing) and the total stays at 8. The case therefore **names the check that must fail**, and the harness reports whether it did.

#### What the correction actually moved
- **`/adjustedbacktest`**: the owner's exact run went from nothing to **253 points, 12 rebalances, 13 blocks** (opening book plus twelve marks).
- **`/backtest`**, captured against production before the deploy and again after, over four runs (buy-and-hold, weekly with cost, monthly top-5, fortnightly exit-only): **`picks`, `rebalances`, `turnover`, `endNames` and the rebalanced return are byte-identical in all four.** What changed is the ORDER inside the sold lists, and with it which forty survive `BT_TRADE_CAP` — a sale is ranked worst-first by its own return, so a corrected intra-window price reorders the display. Buy-and-hold is identical throughout. Captured after the close with no job running, so this is the correction rather than the live-bar noise the `btRebalance` extraction records.
- Verified: **24 checks** over a fixture whose one unpickable symbol (`ODDBAR`, files nothing, so it can never be a pick) trades on the holiday **and on eight lone Saturdays** — the production shape in miniature, since its only job is to widen the universe's union at the start and in the middle. Plus the rebalanced line being exactly as long as the basket axis, the rebalanced return landing inside the picks' own range (an off-by-N read of a rising series pushes it outside), a start on an ordinary session unaffected, and `/backtest` still refusing an old date and still running on a recent one. **Proved by reverting four times.**
  - **THE EXPLANATION IS TESTED BY REWRITING THE RESPONSE, not by poking at the page.** `DATA` is a local of the boot IIFE and is unreachable from `page.evaluate` — the trap this file records for `payload`, `secData` and `baseStocks`, met a fourth time. `page.route` + `route.fetch()` + `route.fulfill` drives the real load path with the real payload shape.
  - **Two reads had to be made defensive or the reverts aborted** (`result.rebalanced.toFixed` and `$eval('#abTrades .err')` both throw once the data is null), and an aborted suite reports a load-bearing guard as a marginal one.
  - **`.err` is defined only on `#abSaveMsg` and `#abMsg`** on that page, so the new message needed its own scoped rule or it would have drawn as ordinary body text.

### The book rows name the company (2026-10-04, owner's request)
**"In the table of Book at every date, can you show the name of the stock as well"**, from a screenshot of the opening block — five tickers, "opened", the rule that fired, and a number. A `Name` cell now sits between the symbol and what happened, in the order the picks table lower on the page already uses (Symbol, then Name), so a reader moving between the two does not have to re-learn which column is which.

- **NOT ONE BYTE WAS ADDED TO THE PAYLOAD, which is the whole reason this is small.** `btTrades`' own `deco` has hung a `name` on every kept / bought / sold row since the log was built — **`/backtest` has been drawing it for a year** — and `picks` carries one for the opening book. The adjusted page simply never read it. There is a check that it still arrives, because the page has nothing to fall back on if it stops.
- **A PAGE CANNOT DERIVE THESE NAMES FROM `picks`, and that was the first idea.** `picks` holds only the stocks that qualified at the START date, so a name **bought at a later rebalance** would draw a blank — which on a cut that churns is most of the log. The fixture runs Top 3 of seven so later blocks really do buy names the opening book never held, and there is a check that the cut bit; without it every name in the log is an opening pick and the whole suite is answered by `picks` rather than by the trade rows.
- **A NAME THAT HAS COLLAPSED TO ITS TICKER IS OMITTED, not printed twice.** A fund, or a company whose only stored name is its symbol, would otherwise read `NAKED  NAKED` in two columns 70px apart, which looks like a fault. **Proved by reverting**: fails 1.
- **CLIPPED, NEVER WRAPPED, with the whole value on the cell's `title`.** One wrapped name makes its row twice as tall and a run holds a dozen blocks of them — the email log's rule, where an unbroken token once gave one row 300px.
- **THE CHIPS ABOVE THE ROWS STAY TICKERS.** `HELD FROM <date>` is a one-line list of the whole book; seven company names on it is a wall, and the rows directly beneath already carry them.

#### Every row is the same shape, or the grid lies quietly
A cell added to some rows and not others still renders — it slides every later cell one track to the left, so numbers sit under the wrong headings and the table looks perfectly well formed. Eight places emit a `.tr`: the column header, the total, the three trade rows, the opening row, the trimmed-list filler and the capped-book filler. They go through one `nmCell()` builder, called with no arguments where the cell has to hold the column open and carry nothing.

- The suite counts the cells in every row, demands one distinct count, and then asserts **every row starts its cells at the same x**, measured off `getBoundingClientRect()`. **Proved by reverting**: the header alone fails 3, the total 3, the opening row 9, the three trade rows 9.
- **The fixture is the test.** Seven stocks whose names share not one word with each other and contain no ticker, read **out of the same row as the symbol** — so a cell wired to the wrong lookup, or to the block's first member, comes out wrong rather than coincidentally right.

#### Two measurement faults worth keeping, both about fixtures
- **A FIXTURE WHOSE `shortName` IS THE TICKER PROVES NOTHING HERE**, and the suite it was copied from has exactly that shape. Worse, letting the derivation rule run makes the expectation a function of the rule: `Zephyr Mining Holdings, Inc.` comes back as **`Zephyr Mining`**, because `deriveShortName` strips a trailing *Holdings* — working exactly as designed, and a test asserting the wrong string. The fixture writes an explicit `names.short_name` **override**, which is the owner-typed path and makes the expected name a constant.
- **"LONG" IS A MEASUREMENT, NOT AN IMPRESSION — the second time this project has recorded it.** A 66-character name fits the track at 1500px, so the clip was never exercised and its revert read as a guard that never mattered. The longest display name in the live universe is **99 characters**; with that one in the fixture the revert fails.

#### THE PHONE RULE BITES BETWEEN A PHONE AND A LAPTOP, NOT AT 390px
Below 700px the name track goes to **zero** and the fixed tracks narrow. Measuring that at 390px reported it as not load-bearing, and the reason is the arithmetic: at 390 the fixed tracks already consume the whole row, so **both flexible tracks starve to zero whatever the media query says**. At 560px there is free space, and without the rule the name takes a share of it that the rule column needs far more. The check moved to 560.

- **THE TRACK GOES TO ZERO RATHER THAN THE CELL TO `display: none`.** Removing the item lets every cell after it auto-place one track left — which still renders and is silently the wrong column. A name column is the first thing to go on a phone anyway: the ticker is immediately beside it and the numbers are what the block is read for, the rule the peers table follows below 620px.

#### A pre-existing overflow found while measuring it
**At 390px the five-track grid already ran 49px past the viewport**, with the `SINCE ENTRY` cells at x=439 on a 390px screen. `1fr` is `minmax(auto, 1fr)`, so the rule column's longest word held the grid open — the documented track trap, in a third place. `minmax(0, …)` on both flexible tracks fixes it, and the narrower fixed tracks on a phone give the rule column real room. **The honest measure is each cell's right edge against the VIEWPORT**: `#abTrades` keeps its own width while its tracks overflow, so a check against the container's box reported `-14px` on a log that was 49px too wide.

- Verified: **29 checks** against the real server on an in-memory database and the real page at 1500, 560 and 390px. **Proved by reverting eight times**, every one load-bearing. `period` 34, `abdefaults` 30, `adjbt`, `btruns` 83 and `rebalaxis` 24 re-run unchanged.
  - **THREE ROWS SHARE THE SAME LINE WORD FOR WORD** — kept, bought and sold — so the harness's assert-exactly-one-hit guard refused the patch, which reads as a broken harness rather than as the one guard it is. A case names its hit count now.

### The owner's own settings are the defaults, and the legend is a set of toggles (2026-10-04, owner's request)
**"Default the fields to what I have chosen here — everything except the start date"**, from a screenshot of the run they actually make, and **"is it possible to give options on the graph to show or hide the metric as needed"**.

#### Four defaults moved, and the date deliberately did not
| control | was | is |
|---|---|---|
| Hold for | 3M | **1Y** |
| Verdicts | Strong Buy **+ Buy** | **Strong Buy alone** |
| How many to hold | all of them | **Top 10** |
| Rebalance | never | **every month** |

Rules, Theme, Rank by, On each rebalance and Cost were already on the chosen value.

- **THE START DATE IS THE ONE FIELD LEFT ALONE, and the owner named it.** It keeps its rolling *400 days back* rule: a date frozen into the page goes stale the day after it is written, and it is the one field anybody changes on every visit. There is a check that it still computes rather than being pinned.
- **The address bar still beats every default**, or a link somebody sends would reproduce their settings and somebody else's run. **Proved by reverting**: a default that wins fails 1.
- **Strong Buy ALONE is a real change, not tidying.** Adding Buy roughly triples the basket and takes it most of the way to being the benchmark — which is the documented reason the twenty-year trend sweep's own result was hard to read ("the tier qualifies 108 of 336 stocks, so the basket is nearly the benchmark").
- **A consequence worth knowing: the page now rebalances on every load.** `every=30` is the default, so the shared `btRebalance` loop runs each time. Measured when it was built: a fortnightly rebalance adds **1.2s of evaluation** against a ~35s run whose cost is almost entirely the bar read, so this is inside the noise.
- **Top 10 and a monthly rebalance also mean `Rank by`, `On each rebalance` and `Cost` open LIVE rather than greyed**, which `syncCtl` works out for itself — no second place to keep in step. **Proved by reverting**: the old pair fails 3, the third being exactly that.

#### The legend IS the control
It already names every line and carries its colour, so a second row of tick boxes beside it would be two places saying the same thing — the indicator lab's era chips, in a second place. Each entry is a `button` with `aria-pressed`, delegated on `#abLegend` because the legend is rebuilt on every run.

- **A HIDDEN LINE LEAVES THE SCALE, not just the drawing.** Dropping it from the plot while leaving it in the `lo`/`hi` sweep is the version that looks like it works: hiding the S&P is how you get the other three to use the height, and a frozen axis hands back exactly the squashed chart the reader was trying to escape. **Measured in the suite rather than asserted on labels** — see below.
- **OFF IS LEGIBLE, NOT INVISIBLE.** The entry stays, dimmed, with a dotted rule and its value struck through. A control that removes itself is a trapdoor — the news ticker's rule — and here it would also take away the only way to bring the line back.
- **THE LAST VISIBLE LINE CANNOT BE HIDDEN.** An empty chart is not a view of anything, and the reader would be left with nothing to click. The lab's rule, and it matters more here because this chart is the page's headline. **Proved by reverting**: fails 1.
- **Remembered per device** in `localStorage`, the way the stock page remembers its chart layers and `/compare` its hide-matching toggle. It is deliberately **NOT** stored on a saved run: a saved run freezes the numbers, never where somebody happened to be looking — the pivot preset's own rule, and there is a check that the stored row carries no such state.
- The frozen view at `/adjustedbacktest/run/<id>` gets the toggles too, because it is the same painter.

- Verified: **30 checks** driving the real page — every default read off the control, the rolling date still computing, the address still overriding, one legend button per drawn line, the entry surviving a hide, the reload, the refusal, and the frozen view's own toggles. **Proved by reverting eight times**, every one load-bearing.
  - **THE AXIS LABELS CANNOT PROVE THE RESCALE on a fixture whose lines overlap** — they are rounded to whole percent, so hiding a mid-pack line moves `hi` by less than one label and the check failed over a chart that was working. The honest claim is that the SURVIVORS get the height back, so the suite reads the drawn path geometry, works out **which line owns the top of the chart** rather than guessing, hides that one and asserts the others' vertical span grows (198px → 228px). That is also the stronger statement: a chart could relabel its axis without redrawing anything.
  - **"AT LEAST ONE LINE IS LEFT" PASSED OVER A STALE CHART.** With the refusal removed every line is hidden, and `chart()` then finds no finite values and returns **before** it rewrites either the svg or the legend — so four paths and four lit buttons are still on screen and **the page lies about what is on**. The stored set is written before that return and is the only honest witness; the check reads it.
  - **A WAIT THAT THROWS ENDS THE RUN.** With the legend reverted to plain spans, `waitForSelector('#abLegend button')` never resolves and took the suite with it at check 13 of 30 — reported as a guard that never mattered. Every wait swallows its timeout now and the assertions decide.
  - **`adjbt-test.js` asserted the OLD defaults in three places and was CORRECTED, not worked around**: a hardcoded "three curves are drawn" (there are four once the page rebalances — derived from the control now, since this went stale once already), and two checks that `Rank by` / `On each rebalance` / `Cost` open greyed. The behaviour they describe is still right, so they SET the control to zero first and there is a new check that the three are live at the defaults.
  - The save route's body field is **`data`**, not `payload` — a wrong name answers *"That does not look like a backtest result."*, which reads as a broken payload rather than a wrong key.

### Saved runs — a frozen result with a link (2026-10-03, owner's request)
**"I want to save the backtest results so that I can show it to other people", then "I only need this for the Adjusted Backtest, there should be a list of all Adjusted backtest I have run and option to delete".** A `Save run` button beside Run, a `Saved runs` panel under the controls with Open / Copy link / Delete on every row, and **`/adjustedbacktest/run/<id>`**, which anybody with the link can open.

#### A SAVED URL WOULD NOT HAVE WORKED, AND THAT IS THE WHOLE FEATURE
The obvious build is a bookmarkable address — the page already writes its controls into one. It fails at the only thing being asked for: **the same settings give a different answer over time.** The pool is today's universe (1,181 when this page was written, **1,284 now**), restatements arrive on the nightly SEC rotation, the FINRA float is today's, and the names and theme memberships are today's. So a link re-computes and the person you sent it to sees numbers you never saw. A saved run is the **payload, frozen**.
- **Proved the only way that cannot pass by coincidence**: the suite saves a run and then **deletes every row from `bars` and `sec_facts`**. A live run afterwards finds nothing (`picks=0, scored=0`) and the saved one still draws its picks, its chart, its headline figures and its honesty panel in full.

#### THE PAYLOAD IS THE CLIENT'S OWN COPY, deliberately rather than lazily
The instinct — and my first draft — was *the server freezes its own output, never the body it is handed*. Two measurements killed it. **`adjBtCache` is an in-process `Map`**, so on this platform a save almost always lands on an instance with a cold cache and would re-read the archive: **~35s and the heaviest read this app makes**, for a run computed seconds earlier. And a recompute against a database that has since taken a nightly restatement returns **numbers the owner never saw**, which is the exact failure the feature exists to prevent. Freezing what was on screen is the honest thing to store.
- It is safe because **`requireAdmin` means the only caller is the owner**, and the body is **shape-checked rather than trusted** — date, `result`, `counts`, a `picks` array and `basket`, all present or 400. **Proved by reverting**: neutering the refusal fails 11 and stores a string as a backtest.
- **The list columns are derived from the payload**, not from separate client-supplied fields, so a row can never describe a different run from the blob it points at.
- **`cached` is stripped on the way in.** It describes the live ten-minute cache and means nothing once frozen; a saved run claiming to be cached is a small lie on a page whose entire job is provenance. **Proved by reverting**: fails 1.

#### THE LIST NEVER READS A PAYLOAD
A run is **28 KB** (20.8 KB of it `picks`), so `backtest_runs` carries eighteen explicit scalar columns beside the blob and `BT_RUN_COLS` leaves `payload` out. **The guard is the PROJECTION, not the SELECT** — `btRunRow` builds its output field by field, so merely selecting the payload changes nothing a caller sees, and the revert had to undo the projection to bite. Measured: a list row is **381 bytes against 9,758** with the payload attached, so twenty runs is 7 KB rather than half a megabyte.
- `idx_btruns_at (created_at)`. **The list reads as `SCAN backtest_runs USING INDEX idx_btruns_at` and is not one** — an ordered index walk bounded by a LIMIT, the shape `query-plan-test.js` already allowlists for the two log tails. My first assertion called that a failure; the assertion was wrong, not the query. `count(*)` genuinely scans and is fine over a 200-row cap.
- `BT_RUNS_MAX` is **200** — a guard against a table nothing prunes, not a budget. The refusal says what to do about it.

#### PUBLIC BY LINK, which is the point and is one line to change
The page it mirrors is admin only, so an owner-only saved run could not be shown to anybody — and "show it to other people" was the request. The id is **16 random hex**, listed in no sitemap and on no index, so a run is reachable only by someone handed the link, and **Delete takes it back** (the link then 404s, and the page says so rather than drawing an empty shell). If that trade is ever wrong, add the `isAdmin` guard the route directly below it already has.

#### ONE PAGE, NOT TWO
The frozen view is the **same file**, the same painters, over the stored payload. A second template is how the shared view comes to disagree with the live one, and here the two are read side by side.
- **The controls GO, not just their effect.** A reader who cannot run anything must not be shown a Run button that would refuse them: `body.frozen` hides both control bars, the saved-runs panel and the two admin links, and shows a way back to the site instead. **Proved by reverting**: fails 4.
- **The honesty panel travels with it**, which is the half a shareable page most needs — survivorship, one-window, what is point-in-time and what is not. Asserted by name.
- **`/wmark.js` lives in `private/`, so `gateAssets` 401s it for a signed-out reader.** It left the markup and is appended by the boot in the live view only; the shared view **returns before any of the live wiring**, which also keeps `/api/portfolios` and the activity beacon from 401ing on the one page strangers see. **Proved by reverting**: the shared page asks for the watermark.
- **The admin paragraph is trimmed there too** — it repeated *Research only* three lines under the banner that already says it, and linked to `/backtest`, a **dead link for anyone without an account**.
- The banner names the run, says when it was saved, and says **re-running the same settings today would not necessarily give these numbers** — which is the provenance claim stated rather than implied.

#### Worth knowing
- **Saving is explicit.** Every run is not recorded automatically: most runs are exploratory, 28 KB each, and a link you can hand somebody should be one you chose to make.
- **`express.json()` defaults to 100 KB** and a 1Y hold at a 200-name cut approaches it, so the save path gets its own `2mb` mount beside the posts-image one. A save refused for being 4 KB over a limit nobody chose would read as a bug.
- Verified: **83 checks** against the real server — a REAL run saved rather than a hand-written payload, the picks and curves byte-identical on the way back, six malformed bodies refused with nothing stored, the label's newlines stripped and its length capped, newest-first, the page's own save and delete, the frozen view with the archive deleted, a phone, and **22 on the roles** (stranger and member refused all three admin routes with nothing deleted by trying, both still able to read a shared run). **Proved by reverting nine times**, every one load-bearing.
  - **A member fixture is THREE steps.** The first account registered becomes the admin, so registering once and calling it a member tests an admin — and `REQUIRE_APPROVAL` defaults ON, so the second one lands `pending` and cannot sign in at all.
  - **`requireAdmin` answers 403 and the session gate 401**, so a suite asserting one number reports a failure over a working refusal. Assert *refused*, and assert separately that nothing changed.
  - **A `<details>` opens shut, so its buttons are not visible** — a `page.click` on one times out against a perfectly good page.
  - **A REVERT THAT STOPS THE SUITE RUNNING REPORTS `0 failed`**, indistinguishable from a guard that never mattered: a `false &&` wrapper left an unbalanced paren, the module would not parse, and the harness read it as not load-bearing. It now compares the check COUNT against the baseline and says the run aborted. Neuter the refusal, not the condition.
  - **`db.js` was CRLF on disk while `server.js` and `adjustedbacktest.html` were LF**, in the same working copy, on the same afternoon — the documented hazard, met again. Detect per file, at the moment the patch runs.

### One company, one position (2026-10-05, owner: "Alphabet appears twice, is there a way to fix it")
**GOOGL and GOOG held two of ten slots in a top-10 book.** They are one filer with two share classes, correlated at essentially 1, so that is **one bet taking two positions** — not a display quirk but a flaw in what the simulation was measuring.

#### KEYED ON THE SEC FILER ID, NOT THE DISPLAY NAME — and the measurement is what decided it
The peers table already solves this problem by display name, so reusing that key was the obvious move. **Measured against the live universe first, and it would have been wrong.** Ten display names are shared by two tickers; the CIK agrees with the name on seven, cannot judge two, and **contradicts it on one**:

| | | |
|---|---|---|
| BRK.A/BRK.B, GOOGL/GOOG, HEI.A/HEI, FOXA/FOX, NWS/NWSA, Z/ZG, LBTYA/LBTYK | same CIK | one company, fold |
| **OWL / OBDC** — both "Blue Owl Capital" | **1823945 vs 1655888** | **two companies, keep both** |
| FI/FISV, SQ/XYZ | no CIK stored | the dead renamed tickers |

**OWL is Blue Owl Capital Inc. and OBDC is Blue Owl Capital Corporation** — an asset manager and a BDC. A name key would silently drop a real, independent holding from the book, which is the expensive direction: a missing position looks like the rules simply did not pick it.

- **A SYMBOL WITH NO CIK IS NEVER FOLDED.** Unknown is not *the same as*, so the two the universe cannot key are left as two rows. An under-catch, which is the safe direction, and the measured cost today is nil — both are dead tickers.
- **It costs no query on `/adjustedbacktest`**: that route already reads `secState` for the overlay (a fund files nothing), so the map is in hand at the cut.

#### THE SURVIVOR IS CHOSEN EX-ANTE — tier, then cushion, then the symbol
**Never by return.** Keeping whichever class happened to do better is a look-ahead that puts the answer into the question — the trap `btPick`'s own sort already exists to neutralise, where the pick list arrives sorted by realised return and every tie would otherwise resolve by what happened next. **The fixture is built on exactly that**: `ALFAC` has the better cushion and the *worse* return, so a rule resolving the pair by outcome keeps `ALFAA` instead. **Proved by reverting**: sorting by `ret` first fails 3 and keeps the better performer.

#### THE POOL IS CLEANED, NOT THE CUT — one intervention, four surfaces
`btOneEach` runs inside `btRun` **before the sort by return**, so the picks table, the "all of them" basket, the random control band and the Top-N cut all read one clean list.

- **Deduping the cut alone would have broken the control.** `btBand` draws its 400 random baskets from the same pool, so a cut that cannot hold two Alphabets compared against baskets that can would make the percentile measure the dedupe as well as the ranking. One pool, and the comparison stays honest by construction.
- **`everySeries` is deliberately untouched** — that is the equal-weight universe line, the benchmark, and narrowing it would flatter every comparison on the page.
- **`btRebalance` gets the same rule at every mark**, or a later re-cut quietly buys back the class the opening book was careful not to hold. **Proved by reverting**: fails 2.

#### `/backtest` HAD THE IDENTICAL FLAW and is fixed with it
It shares `btPick`, `btRun` and `btRebalance`, so passing the key on one page and not the other would have made one shared function behave two ways. It needed the CIK map it does not otherwise read: **one small read of a ~1,300-row table against the ~157,000 bars that route already pulls**. Its own correctness here rests on the shared helper (tested) plus `adjbt-test`'s boundary check that the route still refuses an old date and still runs on a recent one — it is not separately fixture-tested, and `bt-test.js` is broken at HEAD.

#### THE DROP IS NAMED, because the reader can see the book
A ticker missing from a list its sibling is on reads as a missing pick. The page says which went and which it was folded into, and that the match was on the filer id rather than the name — **neutral, not amber**: nothing is wrong and nothing is stale, and amber on this page already means *notice this, it is old*.

#### Worth reporting: the peers table has the same latent fault
`peersFor` deduplicates by display name, with a comment naming eight pairs — so on a Blue Owl peer table it would drop **OWL or OBDC**, two genuinely different companies, and the reader would never know. **Not fixed here**: it is a different page, it was not what was asked, and it needs the CIK map threading into a path that does not currently read it. One line of the same key would do it.

- Verified: **19 checks** — four on the helper lifted out of server.js, the rest against the real routes and the real page. The fixture's load-bearing properties are that the two classes disagree about which is better (cushion against return) and that two real companies share one display name — so a name key and an outcome-resolved key each come out at a different answer rather than coincidentally the same one. Plus the control band, every rebalanced book rather than just the opening one, and the note's wording and its drawn colour. **Proved by reverting six times, every one load-bearing**: no dedupe fails 8, the page note 4, the look-ahead 3, the name key 2, and the rebalance and the no-filer-id guard 1 each.
  - **THE NO-FILER-ID GUARD FIRST REPORTED 0 AND IT WAS UNREACHABLE, not unimportant.** `/adjustedbacktest` drops a symbol with no CIK before it can ever be a pick, so only `/backtest` can meet one — and this fixture cannot reach that route. Four checks on the helper lifted straight out of server.js prove the branch, and the revert then fails 1. *A guard that no fixture can reach needs a smaller test, not a quieter claim.*
  - **The book only exists when the run REBALANCES**, so a page check on a buy-and-hold run finds no `#abTrades` blocks and asserts over nothing — which is what the first run did, reporting an empty list as a failure.
  - **A `\r\r\n` IN A PATCH, for the second time on this project.** The script joined its replacement lines with the detected CRLF *and then* converted `\n` again in the loop, doubling the CR. **`node --check` passes a file like that** and only `cat -A` shows it. Convert the newline ONCE, at the moment of writing.

### A saved run names itself (2026-10-05, owner: "come out with a standard naming convention so that I don't have to key in the name")
**The Name this run field shows the name it will use, and an empty field saves under it.** The formula is the owner's: `2025-08-31 · 1Y · Balanced · Technology · Strong Buy, Buy · Top 10 · monthly` — start date, hold, rules, theme, verdicts, cut, cadence.

- **RANK BY, ON EACH REBALANCE AND COST ARE OUT, which the owner named.** Each is **inert unless another control is set** — rank does nothing without a cut, mode and cost do nothing without a rebalance, and `syncCtl` greys all three for exactly that reason — so they would lengthen every name to separate runs that are otherwise identical. There is a check that setting all three away from their defaults changes the name by **not one character**.
- **A DEFAULT SAYS NOTHING; A CHOICE SAYS ITSELF.** *All stocks*, *All of them* and *never rebalanced* are what you get by changing nothing, so a name reciting them is longer and says less. A part appears when it was **chosen**, which is also what makes two names differ exactly where the two runs do — asserted as eight distinct names from eight one-part changes.

#### THE NAME IS THE RESULT'S, NEVER THE CONTROLS'
It is set where `DATA` changes and nowhere else. Move a dropdown after a run and the controls no longer describe what Save would store — the result is the last one computed — so a name derived from the live controls would be **a label that lies about the thing it is attached to**. **Proved by reverting**: a Save that reads the controls fails 3 and stores a label claiming **1Y** for a run that is **3M** -- the lie, written down.

- It is a **placeholder, not a value**, so a name typed over it is never clobbered and the owner can still write their own. The field's own `maxlength` is the cap the formula budgets against.

#### THE SUBLINE BECAME THE COMPLEMENT OF THE NAME, not a copy of it
`howRun` already printed horizon · rules · theme · verdicts · top-by-rank · rebalance under every row, so a formula name made the row say all of it **twice**. The first cut dropped the subline outright where the name matched — and that **silently took rank-by, exit-only and cost out of the list entirely**, three facts the owner asked to keep out of the NAME, which is not the same as out of the page.

- `restRun` carries exactly those three, each shown only when its own control is live and not on its default — the same guards `syncCtl` greys them with. Usually it is empty, and an empty subline is not drawn at all.
- **A run the owner NAMED keeps the full summary**, because its name says none of it. Which line to draw is decided by **comparing the label with the formula at render time**, so there is no stored flag to get out of step with the label beside it.
- **Proved by reverting**: putting `howRun` back on both paths fails 2, including a plain run that should draw no subline at all drawing one.

#### ONE FORMULA, TWO SHAPES — and that is where a second copy would have drifted
The result payload names these facts `date`/`topAsked`/`every` with `tiers` an array; the stored row names them `startDate`/`topAsked`/`everyDays` with `tiers` a joined string. One `autoName`, two adapters. **It has to be one**, because the list decides whether to draw a subline by comparing the stored label against the formula recomputed from the row — two implementations that disagreed by a space would print the subline on every auto-named run and nothing would look broken. **Proved by reverting**: reading the row with the payload's field names fails 2, and the two shapes come out at different strings -- a dateless name against a full one.

#### THE BUDGET IS THE EXISTING CAP, and the first version overflowed on an ordinary run
All six verdicts in full are 60 characters on their own, so the list collapses to `6 verdicts` — **only when the whole name would not otherwise fit**, which keeps the common one- and two-verdict runs reading in the page's own words.

- **`rebalanced monthly` was 18 characters and it broke the commonest shape there is.** A theme, two verdicts, a cut and a monthly rebalance came to **87**, so that name both collapsed its verdicts to a count *and* took an ellipsis. The bare cadence word — `monthly`, which is what the control itself says — costs 11 fewer and brings the same run to **76 with its verdicts still named**. **The unit test is what caught it**, as an expectation that would not match; it is a case in the suite now, by name.
- The ellipsis is the last guard, for a theme name long enough to blow the budget by itself.

#### Worth knowing
- **The server's `Run of <date>` fallback is untouched and is now the last resort for a caller that sends no label at all** — an API client rather than the page. It is deliberately NOT the same formula: it cannot be, having no access to the page, and making it so would be a second implementation of the thing the section above exists to keep single.
- **A FIXTURE TRAP WORTH KEEPING: the page sets its controls from the query and then runs with the CONTROL values.** A `?top=2` the select does not offer is silently dropped and the run uses the default of 10 — which is exactly what the first draft of this suite did, and it reported the code wrong on four checks when the fixture was wrong.
- **THE FIELD HAS TO SHOW THE NAME IT GIVES YOU.** At the old 190px the placeholder clipped to `2024-01-02 · 3M · Balanced · St` — which says the convention is working and not what the run will be called, and reading it is the whole point of not typing it. Its row holds only this field and Save, so the width was already there. **`min-width: 0` on the flex item is what lets it shrink again on a phone**: a flex item's floor is its content, so a 420px basis without it runs straight past a 390px screen — the `1fr` trap the trade log and the sparks grid have both met. Measured as drawn: **360px of text in a 538px field**, and **296px with no sideways scroll** at 390px.
#### IT FOUND A PRE-EXISTING DEFECT THAT IT ALSO MAKES WORSE
**At 390px the saved-runs table runs 82px past the edge, and `body` is `overflow-x: clip` here — so it is CLIPPED, not scrollable.** Measured on production with a real wheel gesture, which moves **0px**: the overflowing cell is exactly the Open / Copy link / Delete buttons, so **none of them can be reached on a phone**. The formula name widens the first column further, which is what makes a pre-existing fault this change's to fix.

- **The house rule, applied**: only a wide table may run past the edge, and it gets `overflow-x: auto` on **its own container** so the page body never scrolls sideways. `#abWrap` already does exactly this for the picks table.
- **`overflow-wrap: anywhere` on the name cell**, because a name is a sentence now: at ~76 characters it would otherwise hold the column open. It wraps, which costs row height and nothing else.
- **THE CHECK IS THAT DELETE CAN BE REACHED**, not that the table is narrower: the box is scrolled to its end and the button's own rect is asked whether it is inside the viewport. A width assertion would pass on a table that is merely a bit smaller and still clipped. **Proved by reverting**: without the container it fails 2, reporting `inView: false` and **81px** of page overflow — the production symptom in miniature.
- The page itself is asserted still not to scroll sideways, which is the half the container could have broken.

- Verified: **20 checks** on the formula with no server and no browser — it is pure, so the budget, the collapse and the two shapes are all reachable that way — plus **17** driving the real page and the real save route. **Proved by reverting nine times, every one load-bearing**: a default spelled out fails 4, the placeholder never set 3, Save reading the controls 3, the subline repeating the name 2, the old cadence 2, the row read with the payload's names 2, and the verdict collapse and the empty-field fallback 1 each.
  - **ONE OF THEM FIRST REPORTED 0 AND IT WAS THE REVERT, NOT RESIDUE.** The DATA-not-controls guard was reverted on the PLACEHOLDER line, which is written once per run -- so neither version re-runs when a control moves afterwards and the two are indistinguishable. The guard is load-bearing on the SAVE path, where the divergence is actually stored, and it fails 3 there. *A revert has to be put where the bug would do its damage, not where the same words appear.*

### It wears `/backtest`'s chrome now (2026-10-05, owner: "make the Adjusted Backtest page look nice similar to Backtest")
**The controls moved into a bezel panel, the labels, inputs and verdict pills took `/backtest`'s treatment, and the stat cards became cards.** Nothing about what the page computes changed — this is the skin, and the skin was the whole of the ask.

- **THE DIFFERENCE WAS THE CARD, not the colours.** `/backtest` puts its controls in `<section class="bezel panel"><div class="core panel">`; this page had them bare on the page background, which reads as debug chrome rather than as the instrument. One wrapper is most of the fix.
- **THE VERDICT PILLS ARE THE OTHER HALF, and they are a legibility fix rather than decoration.** They were grey-on-grey when pressed, so *which* verdicts were selected could not be read without going along all six; `/backtest` paints the ladder — green, light green, amber, grey, rose, red — and `data-t` was already on the button, so this is six CSS rules and no JS.
- **The cards put the KEY ABOVE THE VALUE**, which is `/backtest`'s order and the right one: the label is what you scan for and the number is what you stop on. `#abCards` is a `repeat(auto-fit, minmax(170px, 1fr))` grid, so they share one width and read as a set instead of as boxes sized by whatever text they happened to hold.
- **A FLOOR AND A CEILING ON THE SELECTS (150/250px), because this page has TEN against `/backtest`'s eight** and they are wildly uneven on their own: `1Y` is three characters and a theme name is forty. Without the floor the row reads as ragged offcuts; without the ceiling one long option sets a 360px control and pushes the verdicts onto a line of their own.
- **One rule for every control in the panel, `#abName` included.** It had its own lighter surface (`--surface`/`--hair` against the rest's `--surface-2`/`--hair-2`) and sat visibly apart from its neighbours.

#### TWO ELEMENTS SHARED `id="abBar"`, and wrapping them is what ended it
`getElementById` returns the first and CSS matches both, so `body.frozen #abBar` really did hide both rows and **nothing was visibly wrong** — which is why it survived. The rows are `.abrow` inside one `#abPanel` now, and the frozen rule hides the panel, so every control inside it goes with one selector rather than relying on a duplicate id to do the work of two.

- **`btruns-test` asserts the frozen view by MEASURING `#abGo`, `#abSave`, `#abDate` and `#abRunsBox` at zero height**, not by naming the container — so hiding the panel instead satisfies it unchanged, and that is the check doing its job rather than luck.

#### Two dead hooks found and NOT shipped
- **`btn-accent` IS NOT DEFINED ANYWHERE** — not in `app.css`, not in any page's own styles — and **`/backtest`, `/trend-backtest` and nothing else have carried it on their Run buttons all along**, so all three render as a plain `.btn`. It was added here for a few minutes and taken out again: residue reads as intent, and *defining* it would make this page diverge from the one it is meant to match. Worth deciding across all three if a primary action should ever look like one.
- **`.stb` was a class hook nothing styled.** The bezel does the work on its own.
- **`.st` IS ON THE CORE ONLY, deliberately.** The `/quality` lesson: that page put `.card` on the bezel AND the core, `querySelectorAll` matched two per card, and one click toggled its filter twice. `#abCards .st` is what `adjbt-test` counts, so it must stay one node per card.

#### THE PANEL'S DEAD FOOT IS THE ONE THING ABOUT `/backtest` NOT WORTH COPYING
`.panel { padding: 18px 20px; margin-bottom: 18px }` is applied there to **both** the shell and the core, so the core's margin lands *inside* the card — measured here as **18px of empty space under the last control** before it was scoped. `section.abpanel` takes the margin, `.abpanel` takes the padding. The doubled *padding* is kept, because that inset is what gives the reference card its weight.

- **Found by looking at the rendered page**, as every layout fault on this project has been. No assertion would have seen it: the markup was correct and the numbers were right.

#### Worth knowing
- **The phone keeps one control per row and that is a choice, not an oversight.** Two-up fits at ~134px, which truncates `Never — buy and hold` and `Cushion (room to the exit)` — and **truncating a control's label is worse than truncating a display name**, because the reader cannot tell what is selected. The page scrolls; legibility wins.
- **The shot harness now phones the LIVE view too.** `btruns-shot.js` only ever phoned the frozen one, where the panel is hidden by design — so the new markup was the half it could not see.
- Verified: **adjbt (all), abdefaults 30, btruns 83, rebalaxis 24, period 41 and bookname 29 all pass unchanged**, which is the point — a skin that moved a selector any of them reads would have said so.

