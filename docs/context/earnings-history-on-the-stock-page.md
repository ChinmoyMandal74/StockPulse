## Earnings history on the stock page (2026-09-23)
**`earnings_history` had been filling since the earnings column was built and nothing had ever shown it** — 28,000 rows across 940 of 943 symbols. `readEarnings(symbol)` was written for this (its comment says "for the stock page and the post-earnings-drift study") and had never been called; only the DATES were read, by the advice backtest's earnings guard. The section sits above About: a verdict line, a strip of one bar per quarter oldest-left, and a folded table of estimate, reported, surprise and time of day.

- **THE SCALE IS ROBUST, and it has to be.** A surprise is a ratio against the estimate, so a near-zero estimate makes it enormous: the archive holds a **-262%**, and this file already records **+214% on two mega-caps at once** as a feed artefact. Scaling to the largest bar would flatten every honest quarter. The ceiling is the **90th percentile** of what is there, floored at 10%; a bar past it is drawn full height and says so on hover rather than being clipped silently.
- **A quarter with no estimate is neither a beat nor a miss** — excluded from the count, drawn as a hairline, and a dash in the table rather than `0.00`, which would be a number nobody reported. The summary therefore reads "9 of 11", not "9 of 12".
- **Depth varies enormously and the header says so.** NVDA holds 26 quarters; the MEDIAN symbol reaches back only to **2020-05**, and 75 symbols have under three years. Do not quote the archive's earliest date as its depth — only 233 rows across 24 symbols predate 2015, all foreign names (VOD, BHP, CRH) where the provider happens to hold more.
- `readEarnings` joins `/api/stock`'s existing `Promise.all` and keeps its own catch; it seeks on the `(symbol, d)` primary key.
- **A trailing-P/E HISTORY is reconstructible and is not stored.** `fundamentals_history.trailing_pe` only starts at 2026-09-15 and the provider serves no historical ratios — but price ÷ TTM EPS is computable from `bars` and this table for as far back as both reach. Checked: AAPL's last four reported quarters sum to **8.72** against the provider's own `diluted_eps_ttm` of **8.71**. Note the provider's `trailing_pe` implies an EPS about 1% off that, so a reconstructed series and the stored one would show a small step where they meet — compute the whole series one way.

### The strip became a dumbbell (2026-10-07, owner's request)
**"Dumbbell chart for earnings surprise: estimate and actual joined by a line for each quarter, with color for beat or miss."** It REPLACED the strip of surprise percentages in the Earnings card (the owner's call when offered both), and **the price chart is untouched** — their explicit condition, and the right place anyway: EPS and price share no axis, and a second y-axis is the thing this page has refused before.

- **One column per quarter, oldest left**: a hollow dot at the estimate, a filled dot at what was reported, a line between, green for a beat and red for a miss. A quarter nobody forecast is ONE grey dot and no line; an exact match counts as a beat, as the summary already counts it.
- **IT IS BETTER THAN THE STRIP TWICE OVER.** The robust 90th-percentile scale above existed only because a percentage against a near-zero estimate explodes; plotting the two real numbers makes that problem disappear (the fixture's +260% quarter is simply thirteen cents), so `earnScale` and its "beyond the scale" marking are DELETED. And it shows the LEVEL — earnings climbing or falling — which a row of percentages cannot.
- **Twelve quarters by default, with an `All N quarters` button.** Twenty-six on one linear axis flattens a fast grower's early years, and a log axis cannot be used because EPS goes negative.
- **The zero line is drawn only where the window crosses zero**, and labelled in the gutter.
- **HTML, never SVG**: the box is as wide as the page and a stretched svg turns a dot into an ellipse. Marks are placed by percentage inside a box inset by the dot's radius, and the gutter shares that inset so a percentage means one height in both.

#### REPORTED EPS IS NOT RESTATED FOR A SPLIT, so the chart keeps to one share count
**Measured on the stored rows before drawing anything: NVIDIA reads 3.37 / 4.02 one quarter and 0.46 / 0.52 the next**, across its ten-for-one. Each quarter's own pair is on one basis, so beat-or-miss was always right — but one axis over both sides draws a collapse in earnings that never happened. This is the FINRA short-interest lesson (not restated either) in a third dataset.

- `earnSegment` uses the profile's `lastSplitDate`: **the quarters reported since the last split where there are at least three, otherwise the ones before it.** The note says which, names the date, and says how many are held back; the table still lists every quarter.
- **Only the LAST split is known**, so the "before" branch can still span an earlier one (a company that split twice, the second time within the last two quarters). Rare, and not solvable from the profile; an adjusted series would need split factors we do not store.
- `stock` is script-scope on this page, but `earnSplit` is set beside `earnRows` at boot anyway, so the function reads nothing it was not handed.

- Verified: **45 checks** (`earn-dumbbell-test.js`) over four fixture stocks — sixteen quarters crossing zero with a beat, a miss, an exact match and an unforecast quarter, with gaps of DIFFERENT sizes so a fixed-length line cannot pass; a split mid-history; a split one quarter ago; and a stock with no earnings. Positions, line ends against dot centres, the gap-to-length proportion, the drawn colours, hollow against filled, the gutter's values, the toggle both ways, nothing added inside `#chart`, and a phone (labels neither colliding nor running off the card — they did both on the first render, found by screenshot). **Proved by reverting eight times, every one load-bearing**: one axis across a split fails 5, newest-on-the-left 3, and the three-quarter rule, the zero line, the fixed-length line and the unforecast quarter 2 each, the hollow dot and the phone's label count 1 each.
- **`earnings-section-test.js` asserted the strip and was CORRECTED, not worked around**: its two checks on the capped percentage scale describe something that no longer exists, and are replaced by one that the near-zero quarter is drawn at its real size.

### Month by month — a year-by-month grid of returns (2026-10-07, owner's request)
**A `Month by month` card on `/stock`, above Earnings: one row per year, one column per month, each cell that month's return, coloured by direction and strength, with a Year column and a count along the foot.** Asked as *"Seasonality calendar heatmap: a grid of month × year (or weekday × week) colored by return"*; the owner took month × year, on the stock page only. **The price chart is untouched.**

- **WEEKDAY × WEEK WAS OFFERED AND NOT BUILT.** Day-of-week effects in large US stocks are too small to see against daily noise, so the grid would be confetti that invites over-reading.
- **IT COSTS NO QUERY.** `/api/stock` already reads ~10 years of bars for the earnings study; `monthEnds()` reduces them to the last close of each month and ships ~125 pairs as `monthly.stock`. The index's month ends (`monthly.bench`, for the switch below) are read once per instance and kept half an hour, since they are the same for every stock.
- **FULL PRECISION, which is why it is not built from `/api/history`.** That route rounds closes to cents, and a split-adjusted close of $0.16 cannot carry a monthly return at that — the `/single` lesson.
- **`Own return` / `Against the S&P 500`**, a two-button switch defaulting to the stock's own return. Against the index is the month less the index's month, in points: in a year like 2022 nearly every stock's grid is red in the same columns, which says more about the market than the stock. A month the index has no reading for is blank rather than shown raw.

#### IT IS A RECORD, NOT A SEASONAL PATTERN, and the card is built to say so
Ten years is ten samples a month, and with twelve months to choose from one always looks special by chance — the research log's ten-flat-of-eleven, in the place most likely to be read as a trading calendar.

- **The foot is a COUNT (`2/3`), never an average return**, and the note prints the stock's share of up months across the whole grid beside it, which is what any one month has to be read against.
- **No best-month or worst-month callout**, and the note ends *"a record of what happened, not a pattern to trade"*.
- **A flat month is not an up month**, and the month still running is left out of the count.

#### The rules that keep a cell honest
- **The LAST close of the month**, each month against the month end before it. **A missing month is never bridged**: the return across two months filed under one would be a wrong cell, so the month after a gap is blank.
- **A sub-cent close is not a price** (`MIN_CLOSE`) — one at a month end would print a six-figure percentage.
- **The sign comes from the rounded value**, so a move that prints `0.0` is neither green nor `−0.0`.
- **The colour is capped** (±20% own, ±12 points relative): a +50% month is drawn at full colour and still prints +50. The number is the data and the tint only its strength.
- **The running month is outlined and says "so far"**; the Year column compounds December to December and is blank where the December before is not held.
- **Under thirteen month ends there is no card.** The grid scrolls sideways inside its own box on a phone.
- **Corteva and Mueller will each show one false month** of −50% to −84% — the standing unadjusted-split data, not something this card can see.

- Verified: **42 checks** (`months-test.js`). The fixture gives every month a decoy bar on the 10th and the real month end later, plants every return, drops one month outright, makes one month end a sub-cent print, and has the index rise exactly 1% a month so the relative reading is the raw one less a point everywhere. **Proved by reverting nine times, every one load-bearing**: the switch wired to nothing fails 5, the first close of the month 3, the sub-cent bar 2, and the bridged gap, the running month, the flat month, the colour cap, the rounded sign and the five-month card 1 each.
- **`sed -i` in Git Bash rewrote the whole of `stock.html` from CRLF to LF** while inserting one line. Git stores LF either way so the diff was unaffected, but any patch carrying a hardcoded `\r\n` would have gone inert from that moment. Detect per file, at the moment of writing.

### Month by month, as a card (2026-10-07, owner: "Can you add the same to promo")
**A twenty-sixth template, `months`: the stock page's year-by-month grid for one company, on all three artboards.** Two controls, `monSym` and `monView` (own return / against the S&P 500); like the spotlight and Evolution the card IS its scope, so no sector, industry, size or screen pickers and `INDUSTRY_PREFIXES` is untouched.

- **A FIFTH DATA CHANNEL, wired the way Evolution's is.** `ctx.getMonths(symbol)` returns `{stock, bench}` month ends or null while loading; `Cards.monthsNeed(tpl, opts)` is asked of the module by BOTH hosts — the studio, which fetches `GET /api/months?symbol=` and **repaints when it lands**, and `/api/m/post`, which loads them for the phone. `monthsFor()` is one assembly over the same `monthEnds` / `benchMonthEnds` the stock route uses, cached ten minutes, so the card and the page cannot be handed different month ends.
- **THE ARITHMETIC IS RESTATED in cards.js** (`monReturns`, `monYears`) rather than shared with stock.html — the `BENCHMARKS` bargain, since this module has no requires and no DOM. Both suites draw the same planted fixture and demand the same cells.
- **Eleven years on the 4:5 and the story, eight on the square**, newest kept. **The foot counts over the years DRAWN**, so the count under a column is the count of the cells above it.
- **Asked for the index reading with no index held, it draws the stock's own return AND SAYS SO in the subtitle** — raw figures under a heading claiming otherwise is the silent-fallback class this module exists to keep out.
- The company name is the headline: stepped down by length, then clipped to one line (the longest in the universe is 99 characters).
- **Same refusals as the page**: a count along the foot rather than an average, the overall share of up months in the note, and *"a record of what happened, not a pattern to trade"* on the card itself, where a posted picture has no page around it.

#### THE GROUND SWEEP FOUND WHITE NUMBERS ON BRIGHT GREEN — on the card AND on the page shipped an hour earlier
The fill ran to 80% of the signal colour, and near-white text on that is **2.49:1 on dark and 2.37:1 on navy** against a 4.5 floor. It read as fine in a screenshot because only the two or three strongest cells do it. The strength now stops at **50%** on both surfaces (10–50% on the card, 8–50% on the page); the light grounds take a further `--mh-k` because their greens and reds are darker inks.

- Control ids **149 against `POST_OPT_MAX` 200**.
- Verified: **31 checks** (`months-card-test.js`) — the placeholder, short-history and no-index states off-page; in the studio the fetch landing and the card redrawing, planted cells, the foot, both views, a second stock, the 99-character name, a 12-combination fit sweep, and a saved post rebuilt by the phone's own route. Plus the ground sweep, the width sweep, note fit and size-scope with the template registered. **Proved by reverting nine times, every one load-bearing**: the controls left out of `CONTROL_IDS` fails 7, the index reading ignored 3, the listener list 2, and the square cap, the running month, the silent fallback, the name clip and the phone 1 each; with no repaint when the fetch lands the suite stops at check 10 of 31, the card sitting on its placeholder for ever.

### The statements, laid out as statements (2026-10-05, owner's request, from two screenshots)
**A `Financial statements` card above the SEC EDGAR one: line items down, periods across, newest first, with three tabs — Income, Balance sheet, Cash flow.** The raw card is untouched, which was the owner's condition.

#### IT IS THE TRANSPOSE, and that is why it is not a duplicate
The SEC EDGAR card reads **period-per-ROW with the concepts as columns**, which is right for *what did this filing say* — it carries the filing link and the per-filing provenance — and is **not how a financial statement is read**. This is the other orientation, which is the one the screenshots show and the one anyone comparing a line across quarters needs.

- **IT FETCHES NOTHING.** Same `secData`, same request, a second reading of the rows already on the page. That is the whole reason the feature is small.
- **ONE PERIOD SWITCH DRIVES BOTH CARDS.** A second Quarterly/Annual pair would be two controls for one question, and they could be set to disagree. **Proved by reverting**: the Annual switch is asserted to empty both together.
- **NO DETAIL/SUMMARY TOGGLE, though the reference has one.** We store one level of detail, so it would be a control with nothing behind it — the hazard this project records as *a control that looks live and does nothing when you touch it*.

#### "TOTAL OPERATING EXPENSE" IS ON THE REFERENCE AND IS NOT HERE
We do not store it, and revenue minus operating income is **not** the same thing — it omits the non-operating lines. Inventing a row to complete a layout is how a card starts asserting something no filing says, which is the line the SEC card's own rules already draw. Every line drawn is a field the filings state.

#### ONE SCALE DOWN A COLUMN, which is the one real formatting difference
`secMoney` picks a unit per value — right for a mixed row, wrong for a column you read **down**: `$1.2B` above `$985.0M` is a comparison the eye has to make twice. Figures are in millions, thousands separated, negatives in parentheses, which is what every statement does and what the screenshots do. Per-share data and the share count are exempt and the note says so. **Proved by reverting**: per-cell units fail 3.

#### THE TREND RUNS THE OTHER WAY FROM THE COLUMNS, and the note says so
The two conventions genuinely conflict: a statement puts the newest period first, a sparkline is universally read left to right as time passing. **Matching the columns would draw every trend backwards**, which is the worse error, so the column is labelled rather than silently reversed.

- **SIGNED, scaled to the largest magnitude in its OWN row.** Half these lines go negative, so plotting `|v|` would draw a loss as a gain — **proved by reverting**, which fails 1 — and a shared scale would flatten EPS to nothing beside revenue.
- **A DERIVED VALUE IS STILL MARKED.** No company files a fourth quarter and a cash-flow statement is year-to-date, so those quarters are differenced here; the dotted cell and its tooltip carry over from the SEC card, because passing arithmetic off as a filing is the one thing neither surface may do. **Proved by reverting**: fails 3.
- **A LINE WITH NOTHING IN IT IS DROPPED**, never drawn as five dashes: the balance sheet is sparse for some filers, and a labelled row of em-dashes says only that we hold nothing. **Proved by reverting**: fails 1.
- **Both cards go together when a company files nothing** — an empty card headed *Financial statements* is worse than no card. **Proved by reverting**: fails 1.

- Verified: **34 checks** on the real page. **The fixture is the test**: every concept in every period carries a value nothing else on the page shares, so a row wired to the wrong field or a column read off the wrong period lands on a number that belongs somewhere else; one period is loss-making, which exercises the parentheses, the red and the signed spark together. Plus the raw card asserted **unchanged in shape**, the jump bar offering Statements before SEC EDGAR, and the phone. **Proved by reverting seven times, every one load-bearing**: the periods reversed fails 6, per-cell units 4, an empty line drawn 3, the derived marking 2, and the unsigned trend, the note and the removal 1 each.
  - **THREE OF THE SEVEN FIRST REPORTED 0, and all three were gaps in the TEST.** The spark check read the bar's CLASS, which comes from the sign, while the revert moved its `y` — so a chart drawing every bar upward in red passed; it asserts the position now. The fixture populated every field in every period, so the drop-an-empty-line rule could never fire; one line is now filed nowhere. And the only symbol had filings, so the removal path was unreachable; there is a second company that files nothing.
  - **THAT LAST ONE FOUND A REAL DEFECT.** `loadSec` drops its card on THREE paths — a refused fetch, a company with no periods, and the catch — and the first cut covered only the catch, leaving `#stmt` hidden-but-present on the other two. Invisible, because the jump bar filters on `hidden`, and wrong. There is one `drop()` with three callers now.
  - **`derivedFields` IS A COMMA-JOINED STRING, not an array** — read off `secfacts.js` (`Object.keys(diff).join(',')`) rather than guessed at, which cost one run: an array will not bind to the text column. The existing card's `(r.derivedFields || []).indexOf(k)` works on it only because `indexOf` is a string method too.
  - **`stock-jumps-test.js` ASSERTED A COUNT OF HIDDEN CARDS and went stale the day this one shipped.** Corrected, not worked around: it names the cards that start hidden rather than counting them, which is strictly stronger and cannot rot the same way.
  - **A SUITE PRINTING INDENTED `PASS` READ AS 0 passed / 0 failed** in the regression runner, whose grep is anchored at the line start — and that suite had a real failure in it. Second time in one session that a runner's own grep hid a result; run a silent suite directly rather than believing the zero.
  - **The jump chips ARE the `.jump` elements; the container is `.jumps`.** A `.jump a` selector looks inside a chip, finds nothing, and reports a missing section on a page that has it.

