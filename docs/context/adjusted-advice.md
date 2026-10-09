## Adjusted Advice — the same rules, read off the filings (2026-09-29)

**`/adjusted` (admin, a Research row on the console): one line per ticker carrying every field the Advice engine reads, with each technical taken from Twelve Data's price bars and each fundamental from the company's own SEC filings, and the verdict `action.js` produces from that.** The owner's framing: *"a new sheet showing the tickers and all the fields used in the advice calculation, Twelve data for Price and Edgar for fundamental, the rules remain the same"* — and explicitly **not** a backtest yet; see the design note in [docs/backlog.md](docs/backlog.md) entry 17 for where that goes next.

**IT IS NOT A NEW RULE SET.** No rule, threshold or ordering is touched, which is the whole point: the only variable is where the numbers came from, so a difference between the two verdict columns is a difference of SOURCE and nothing else. Inventing rules tuned to filings-native metrics was the alternative and was refused — it would mean fitting thresholds against the same data a backtest would then test on.

**Deliberately plain, at the owner's instruction** ("Nothing fancy, No hover etc."): no hover card, no score tooltip, no ladder panel, no chart. There are checks asserting `#rowcard` and `#tip` do not exist on the page, because "no hover" is a property worth keeping rather than a preference that quietly erodes.

- **`adjusted.js` is pure** — no network, no database, no `store` — the `secfacts.js` / `insider.js` / `news.js` shape, which is what lets every substitution below be tested without a server.
- **THE BOUNDARY IS UNCHANGED and is the condition of this existing.** Nothing is stamped onto a snapshot row, so it cannot become a screener column, then a filter, then a screen, then a promo card. `adjusted-test.js` asserts that against the real `/api/stocks` payload and the real rendered header, and asserts the screener still serves the LIVE verdict for a stock whose adjusted one differs.
- **Admin only**, like the two backtests, and for their reason: it shows what a verdict WOULD be under other inputs, which is not a thing this product says anywhere else.
- **Three reads for the whole universe** — the snapshot, plus batched indexed seeks into `sec_facts` and `short_interest`. `readSecFactsSince` is bounded on purpose, measured against production: `where symbol = ? and period_end >= ?` SEARCHes, while `where period_end >= ?` SCANs all 270,054 rows, which on this database is a quota event rather than a slow query. Bounded: **24,281 rows for 1,093 symbols in 3.6s**; the whole route builds in **3.4-3.8s**, cached 10 minutes, and stands aside for a refresh only when it would actually have to read.
- **`readShortLatestFor` exists because `readShortInterest` returns a symbol's history OLDEST FIRST** — the card draws a series left to right. Reusing it for "the current reading" hands back the 2017 one, which the first draft of the probe did. There is a test with a 2017 reading at 90% of float and a 2026 one at 3%.

### What comes from where, and the three inputs that come from neither

| engine input | source |
|---|---|
| vs200ma, vs50ma, rsi, 1M, 3M, from-high, vol trend, history, price | Twelve Data bars, via the snapshot |
| revenue/earnings growth, gross/profit/FCF margin, net income TTM, FCF TTM, ROE | SEC EDGAR |
| market cap | a filed diluted share count at the latest close |
| shortPctFloat | **FINRA**, over the vendor's float |
| nextEarningsDate | the vendor's |
| forwardPe | **substituted** — see below |
| qualityRating | withheld; Balanced has `use_quality: false` and never reads it |

- **Margins are TRAILING TWELVE MONTHS and growth is the latest quarter**, which is not an inconsistency — it is what the rules already mean, and matching it is what keeps "the rules remain the same" true. Comparing one quarter's margin against a TTM figure manufactured a 33.9-point gap on MU once already.
- **`forwardPe` is a TRAILING P/E and the page says so on its own face.** Forward estimates are Ultra-plan only and are in no filing. Its only jobs in the engine are one establishment point (`0 < pe <= 40`) and the fund test; a trailing multiple is normally the higher, so a company near the line loses a point here that it keeps on the screener. **80 of the type flips are exactly that**, and it is named rather than buried.
- **It is market cap over TTM net income, never a sum of quarterly EPS.** Summing `epsDiluted` was the first attempt and returned null for **96% of the universe**: there is no Q4 in a filing, it is differenced out of the annual ladder, and a per-share figure cannot be differenced because each quarter's denominator is its own weighted average — `secfacts.js` correctly leaves it blank (`NO_DIFF`), so almost every trailing year is missing exactly one EPS.
- **FINRA is the SOURCE the vendor's own short interest is derived from** (measured to 0.00pt when the card was built), so taking it first-hand is the more direct reading rather than a substitution. The float is still the vendor's — no filing states one.

### ABSENCE IN A NEWER FILING IS NOT A RESTATEMENT TO NOTHING — `SecFacts.latestFilled`
**A real defect in the existing card, found while building this.** `latestPerPeriod` takes the winning filing's row WHOLESALE, which is right for the stock page — every number on a line then comes from the one document the line links to — and it costs an enormous amount of coverage. A 10-Q carries sparse comparatives for older quarters, often a net income and nothing else; being newer and the same form rank, that row wins the period and the revenue the original 10-Q reported is discarded although it is still in the table one filing down:

```
AVGO  quarter to 2026-05-03   10-Q of 2026-09-10  net income only     <- picked
                              10-Q of 2026-06-09  revenue 22.19B, gross 15.41B
```

Confirmed on AVGO, GM, KLAC, SMCI and hundreds of others. The consequence is that a TTM cannot be summed, because one of its four quarters has no revenue.

- **`latestFilled` fills a winning row's BLANKS from the rest of that period's trail, best-ranked first, and never overwrites.** A genuine restatement always wins; the older filing is consulted only where the newer one is silent. `filledFrom` records which accession supplied each borrowed field.
- Measured across 1,100 filers: **a full TTM 65% → 90%**, profit margin / net income / ROE **65% → 90%**, gross margin **41% → 58%**.
- **Checked against the invariant that validates all of this — four quarters must sum to the year — filling made ZERO years worse**, while making 871 more years checkable at all (2,062 → 2,933).
- **The stock page's SEC card still uses `latestPerPeriod` and still shows those dashes.** That is a separate decision: its claim is one row, one filing, and the two should not be changed together without deciding what the card is for. Worth revisiting.

### A FILING THAT CONTRADICTS ITS OWN EARLIER STATEMENTS — the trail as a cross-check (2026-09-29)
**The restatement trail is free evidence, and it catches two faults that are otherwise invisible because both leave a number that looks perfectly plausible on its own.** Found while measuring cyclicality: a ranking by revenue drawdown put **FactSet at 99.9%**, which is not something that happens to a subscription business.

```
FDS  quarter to 2018-02-28, as filed by four documents:
     10-Q 2018-04-09  335,231,000      10-Q 2019-04-09  335,231,000
     10-K 2018-10-30  335,231,000      10-K 2019-10-30      335,231   <- the one used
```

A thousand times out, and it summed into a trailing year of **$1M for a company earning $1.4bn**. The SOLS lesson again: one junk value destroys a column and the only warning is a figure somebody happens to look at. **It was on a live page** — FactSet's revenue strip on `/stock` fell to nothing across 2018.

- **Measured before fixing**: across 1,100 filers and **62,101 periods that have a trail to check against**, 25 symbols and 51 field-periods — **2.3%**. Small, and it is invisible in the middle of a distribution while **dominating both tails**, which is why the percentiles read sane while the top-15 was garbage.
- **NEITHER "PREFER THE NEWEST" NOR "PREFER THE OLDEST" IS THE FIX**, and that is the whole difficulty: FDS's newest filing is the wrong one, while **IRDM's OLDEST claims $89.7bn for a quarter that is really $119M**. A rule anchored to either end would break as much as it mends.
- **The arbiter is the symbol's OWN NEIGHBOURING PERIODS.** A value a thousand times off the rest of its series is the wrong one, whichever document carried it, and the comparison is made in **orders of magnitude** rather than in dollars — the question is which candidate is on the same scale, not which is nearer. Verified on the six worst cases: it mends FDS and ADC and correctly leaves IRDM, MKSI and REXR alone.
- **A ZERO IS NOT A RESTATEMENT.** No company restates real money to exactly nothing, so a zero beside a filing stating millions is a value that failed to carry. That rule needs no arbitration and catches ALK, ETN, AGO, FLS and OGE.
- **Quarters arbitrate quarters only.** Pooling the period types would drag every annual toward a quarter of its size.
- **`mended` records which fields were changed and why** (`scale` or `zero`), the way `filledFrom` records which accession supplied a borrowed value.
- **`latestPerPeriod` is deliberately NOT changed**, so the stock page's SEC card still shows exactly what one document says — that is its stated claim, and the card links to the filing. Only `latestFilled`, the aggregation path where a wrong value silently corrupts a sum, is reconciled. Worth revisiting together with the older note that says the same about coverage.
- **No collateral movement**: MU, MSFT, AAPL and CRM have **0 rows mended** and MU's trailing revenue is unchanged at $90,274.0M, matching the figure read off production before the change. NVDA gains one mend on `debt` in a 2016 quarter.
- Verified: **15 checks**, and **half of them exist to prove it leaves things alone** — the IRDM shape where the oldest is the bad one, a genuine 7.4% restatement, a real zero nothing contradicts, too few neighbours to arbitrate with, and annuals kept apart from quarters. Every shape is taken from a real symbol.

#### What it cannot see, and the residual is three different faults
The same ranking after the fix still shows REITs at 99%, and diagnosing them found **three faults the trail is blind to**, all with a **trail of one** — nothing to cross-check against:

1. **A tiny revenue on a single filing.** REXR files $0.0-0.2M for quarters whose real revenue is ~$250M; CPT the same at ~$390M. Almost certainly a tag `CONCEPTS` does not map well for REITs, the same family as XOM's unmapped revenue tag.
2. **A NEGATIVE derived revenue.** FRHC's Q4 to 2023-03-31 differences out at **−$566.6M**. Revenue cannot be negative; the ladder subtraction produced it and nothing refuses it.
3. **A whole RUN restated together**, where the neighbours agree with the bad value and the trail disagrees with none of it.

Each is a separate small fix and none is done. The first is the one that matters, because it lands on REITs and financials — already the sectors with the worst filings coverage.

### `notFund` — the one engine change, and it is inert
`classify()` calls a row an ETF when its theme names say so OR when it has neither a Quality score nor a P/E. That second half is a **heuristic for "we hold no fundamentals for this thing"**, not a rule. Quality is withheld on this page by design, so every loss-maker — no positive earnings, so no honest P/E — was typed as a fund and scored by the all-technical rulebook: **263 of 1,084 rows (24%)**, with nothing on screen looking wrong.

- A caller that KNOWS better may now say so with `notFund`, and the guess is skipped. `/adjusted` sets it from the SEC CIK map, which answers "is this a company that files?" directly. **Nothing in the live path sets it.**
- **Proved inert**: the whole live snapshot scored under all five rule sets against the engine lifted out of `git show HEAD` — **5,905 evaluations, zero differences** — and the same probe asserts the guard really bites (a no-Quality no-P/E row types ETF without it and Early with it). Comparing the new engine with itself would have proved nothing.
- **`Adjusted.verdict` still checks the outcome rather than trusting it**: where the engine says ETF and the company files with the SEC, the verdict is WITHHELD with the reason named. A blank with a stated cause beats a wrong word.

### A FILING THAT CONTRADICTS ITSELF — the share-count guard
**Net income over diluted EPS is the same quantity read a second way out of the same document**, which makes it a free independent check on the one figure the filings cannot otherwise corroborate. It is needed:

- **WAT's two newest 10-Qs state 98,204.0M and 82,139.0M diluted shares** against 59.7M in its own 10-K and 97.8M implied by its own EPS — a factor of **1,004**, which put its market cap at **$43,498B** and would have been by a distance the loudest number on the page. **The SOLS lesson exactly**: one junk value destroys a column and the only warning is a figure somebody happens to look at. A stated count more than 10x from its own EPS-implied one is rejected in favour of the implied one, and the row records what it rejected.
- **The annuals are consulted when no quarter states a count** — a 20-F filer (CHKP) states it only there — and the EPS reading stands in when nothing states one at all (XOM and other majors use a tag `secfacts.js` does not map; widening that means re-fetching 1,167 companies from an address that has already answered 429 once).
- Measured after: market cap reproduces the vendor's own figure to a **median 0.2%**, within 15% on **1,000 of 1,048** rows, nulls down from 37 to 24. **The page prints that ratio**, because it is how far to trust the column and the reader should not have to discover it.

### ONE 81-CHARACTER NAME WAS HIDING NINE COLUMNS (2026-10-04, owner: "can you show the P/E on this page")
**The P/E was already there and had been since the page shipped — `P/E (trail)`, the twentieth of twenty-seven columns, carrying a value on 873 of 1,155 rows.** It was simply **off the right-hand edge**: measured at a 1600px window, its header sat at x=1704 against a container whose right edge is 1573, so it could only be reached by scrolling the sheet 131px sideways. *A column nobody can find has not been shown.*

- **THE CAUSE IS ONE ROW, AND THAT IS WHY IT IS WORTH FIXING RATHER THAN EXPLAINING.** Every cell here is `white-space: nowrap` and the Name column had no cap, so the longest display name in the universe set the width for all 1,155 rows. Measured: **median 13 characters, p90 24, and one of 81** (`Delek Logistics Partners L.P. Common Units representing Limited Partner Interests`) — which made the column **460px of a 1,546px viewport, a third of the visible sheet, to serve 0.1% of the rows.**
- **Capped at 190px on an inner block**, with the whole name on the cell's `title` — the treatment the screener's frozen name column and the backtest's book rows already use. 95.8% of names are under 28 characters and are untouched; the sheet narrows 2,687 → 2,338px and **ROE, P/E and Market cap all come on screen** (the P/E's right edge lands at 1451 against 1573).
- **THE CAP MUST SIT ON A BLOCK INSIDE THE CELL, AND THE REASON IS NOT THE OBVIOUS ONE — my own comment said so wrongly until a revert measured it.** I wrote that `max-width` on a `td` is *"advisory and browsers routinely ignore it"*. **It is honoured**: the column really did come back to 190px. What does not work is the clipping — **a `td` is not a clipping context**, so `overflow: hidden` and `text-overflow` do nothing there and the text escapes its own box over the next column with no ellipsis. Right fix, wrong reason, and the comment now says the measured one.
- **NINE OF THE TWENTY-SEVEN COLUMNS WERE OFF SCREEN, and the P/E was not the worst of them.** `Adjusted Advice` (x=2143), `Rule that fired` (2257) and `Live advice` (2611) — **the three columns the page exists for** — all needed a 1,100px scroll. The cap does not reach them; they are still off. Worth deciding separately: moving them left after Name, or freezing them right, are both design calls rather than a width bug, and they are the owner's.
- Verified inside `adjusted-test.js`, that page's own suite, which went 97 → **104 checks**. **The fixture had to gain a name at production's real length** — every fixture company was 5–7 characters, so the cap was never exercised and its revert read as a guard that never mattered; *"long" is a measurement, not an impression*, the second time this project has recorded that. Plus the P/E's **whole cell** inside the visible box (a column half off the edge is not a column you can read), the clip, the title, an ordinary name left alone, no row grown taller, and the header still sorting. **Proved by reverting four times**: the cap removed fails 3, the class dropped from the body cell 3, and the `td`-level cap and the missing title 1 each.
  - **A FIXTURE OVERRIDE ON THE WRONG FIELD PROVES NOTHING.** The first attempt set `name` and the page draws the **display** name (`shortName`), so the cell rendered `GAPCO` and both new checks failed against a working fix.
  - **A QUOTED HEREDOC ATE A BACKSLASH LEVEL FOR THE FIFTH TIME**: `'\n-- the sheet fits --'` arrived as a real newline inside a JS string and the suite would not parse. Use Write/Edit for anything carrying an escape.

### What the first full reading says
1,181 snapshot rows → **1,074 on the page** (13 funds with no CIK, 94 filers with no usable quarter). **954 agree with the live verdict, 120 differ.**

- **The disagreements are overwhelmingly the company TYPE, not the fundamentals bucket** — Established → Early in 88 of them. The establishment points lost, in order: **free cash flow 151, priced on earnings 80, ROE 42, profitability 35, size 9**.
- So the binding constraint is **coverage, not disagreement**: FCF margin reaches 54% of filers and gross margin 58%, because capex and cost-of-revenue are not tagged for every quarter of a trailing year. A missing point is not a weaker company, and the counts strip says how many rows have no trailing year (84) and no market cap (24) so that cannot be read as a finding.
- **A filer with one quarter still gets a row**, with every trailing figure dashed. The rules read a missing fundamental as "the data made no case", which is a state they already handle — but a verdict resting on nine dashes is worth being able to count rather than having to notice.
- Verified: **97 checks** — the module with no server, `latestFilled` both ways, the route over a fixture where **every company separates the filings from the vendor** (SPLITCO's vendor fundamentals are strong and its filings weak, so a page reading the vendor would return the same verdict for it as for GOODCO), the boundary, the roles, and the page. **Proved by reverting four times**: `latestPerPeriod` in place of `latestFilled` fails 3, dropping `notFund` fails 5, reading the vendor's fundamentals fails 13, and dropping the share-count guard fails 3.
  - **Two fixture faults worth keeping.** The filings' profit margin was built at exactly 25% and the FCF margin at 20% — which are precisely the vendor's — so "the vendor's number is not what is shown" passed over two identical numbers and proved nothing; every ratio in the fixture is now deliberately unequal. And an assertion that a loss-making quarter is "left alone" by the share guard was simply wrong about the sign: a loss over a negative EPS implies a **positive** count, which is WAT's real case and the one the guard most needs to reach.

