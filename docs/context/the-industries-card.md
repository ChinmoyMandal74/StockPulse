## The Industries card — the industry as the unit (2026-10-10, owner's request)

**A promo template, `industries`, the first view of a new picker group, Industry, between Market and Stock spotlight.** Asked as *"we have market and stock level but we don't have anything specifically as industry level … there should be a template for Industry where the granularity is Industry"*. Until it existed every card drew companies or sectors; several could be CUT to one industry, and Flow and the Treemap drill into a sector's industries, but nothing ranked the industries against each other.

**One row per industry, ranked on one measure**, highest or lowest first, 5 / 10 / 15 rows. Twelve measures in `IND_METRICS`, each stating how an industry's figure is made (`kind`):

| kind | measures | how |
|---|---|---|
| `ret` | today, week, month, 3 and 6 months, this year, past year | the plain average of its companies by default; weighted by market value on request |
| `share` | above the 200-day | the share of its companies above zero on `vs200ma`, on a fixed 0 to 100 scale |
| `sum` | market value | added up |
| `median` | forward P/E, revenue growth, profit margin | the middle company |

- **AN INDUSTRY IS ITS COMPANIES.** A fund is never a member (`instrumentType === 'ETF'`, the benchmarks, the sector funds). A company with no industry recorded is in none of them and is counted in the note, never pooled into an "Other" row that would rank.
- **AT LEAST `IND_MIN` (3) COMPANIES WITH A READING**, the peer table's floor. It is applied to the READINGS, not the membership: five companies of which one has a forward P/E do not have a median forward P/E. The small figure after each name is that count, so it can differ between measures for the same industry.
- **VALUE WEIGHTING USES BEGINNING WEIGHTS**, `cap / (1 + r/100)`, with `marketParts`' own −99 floor. Today's value already contains the move it is being used to weight. The control applies to returns only; a median and a share ignore it, and the note says which arithmetic was used.
- **A multiple off a loss leaves the median first** (`pos`), so "lowest forward P/E" is not a list of loss-makers.
- **Market value is the only money measure.** It is the one money field in dollars for every row; an industry's summed revenue would mix reporting currencies.
- **A missing return is absent, never zero**: rejected before it is coerced.
- **`foldListings` is NOT applied.** It needs the filers channel, which this card does not ask for, and it is inert on today's universe (no company is listed twice). If a second share class ever returns, the summed market value and the value-weighted return would count that company twice here.

### It draws with the Bars card's own code
`barDraw(top, m, N)` was lifted out of `tplBars` unchanged — the scale, the broken bar for a runaway value, the zero line where rows straddle it, the per-artboard type sizes — and both cards call it. **Proved by comparison**: fifteen Bars builds (five control sets on three artboards) are byte-identical against the file before the extraction. A row may carry `sub`, printed after its name. **The name gives way, never the count**: the first build put both in one clipped cell and four of the first ten rows drawn lost their figure, so a row with a count is a flex pair (`.ix-n` > `.ix-t` + `.ix-c`) where only the name shrinks. A Bars row is still the plain clipped cell.

- **So the fit is inherited, not measured**: same row cap (`BAR_CAP` 15 / 10 / 15), same sizes. Two things are new and were NOT measured in a browser: the note, which is longer than most of Bars', and the title's dim line, kept to 30 characters so it stays on one line ("industries · past 6 months"). **Look at all three artboards with fifteen rows before trusting it.**
- `barFig` prints a percentage to one decimal even when `dp` is 0 (`m.dp || 1`), so the breadth figure reads `75.0%`. Left alone: changing it would change Bars.

### Wiring
- Controls `indMetric`, `indDir`, `indCount`, `indWeight`, `indScope`, `indSector`, `indCap`, `indScreen`, `indSp500` — in `CONTROL_IDS` (180 of `POST_OPT_MAX` 200), the template's own listener list, and the four shared picker fills plus the list copy.
- **The prefix `ind` is deliberately NOT in `INDUSTRY_PREFIXES`.** `syncIndustries` reads `<prefix>Industry` for every prefix there and would throw on a card that has no such control. The cost is that this card's cut is its own and is not carried across from the scoped cards, like the Market cards'.
- A Sector here narrows WHICH industries are ranked. A cut that leaves fewer than three industries says so rather than ranking.
- The measure picker is filled from `Cards.indMetrics()`; an unknown key falls back to the one-month return.
- No extra data channel: the card reads snapshot rows only, so the phone draws it through `/api/m/post` with no change. `mobile.html`'s `TPL_NAMES` has the label.
- Verified: 26 checks in Node against a fixture (`ind-test.js` in the session scratchpad): the averages, the beginning-weight arithmetic against a hand calculation and against today's weights (which differ), the floor, the fund, the blank industry, the loss left out of a median, the note's counts, the empty state, the three artboards. Nothing was rendered.

### The owner saw the ranking on the 4:5 artboard (2026-10-10) and passed it
Ten rows, value weighted, S&P 500 cut: 69 industries drawn, 43 left out under the floor. That is the one artboard confirmed by eye; the square and the story are still inherited from Bars rather than seen.

## The industry spotlight — one industry in full (2026-10-10)

**A second view in the Industry group, `indspot`.** The Stock spotlight's layout block for block — header, line, twelve figures, a dial, a note — with an industry where the company was, **built from the same `sp-*` classes on purpose**: that card's fit on three artboards was measured, and this one could not be. Nothing was rendered when it was written.

What each block means for a group, which is where it differs:

- **The line** is the equal-weight index of its companies, rebased, beside the S&P 500's own fund over the same window (fainter, with its own end tag). **Only a company with a close on every session of the window is in it**: `symbolSeries` is null until a symbol's first close and carried forward after, so a member listed part-way would bend the line with a listing rather than a move. Under `IND_MIN` such companies there is no line, the card says why, and the figures still draw.
- **Returns** are the plain average of its companies. **The other figures are the middle company**, except "Above 200-day", which is a share, and "Market value", which is a total. The head over the grid says so.
- **The dial is the AVERAGE place of its companies on the six-step ladder, and the words beside it are a count** ("9 of 23 read Strong or better"), never one of the six. The engine reads companies; there is no rule that reads a group, and a signal word printed for an industry would be an invented one. A check asserts the big text is not in `ActionRules.ACTIONS`.
- **The note names both ends**: the company furthest up and furthest down over the window, names clipped at 26 characters.
- A figure needs `IND_MIN` readings, like a row of the ranking; under that it is a dash.

Wiring:

- **`Cards.industryList(rows)`** is every industry that can be drawn — three or more companies, funds not counted — largest by market value first, each with its modal sector. The studio's picker is built from it (grouped by sector), so it cannot offer an industry the card would refuse. An unknown or too-small `ispName` falls back to the largest.
- Controls `ispName`, `ispWin` (182 of `POST_OPT_MAX` 200). `indspot: 'ispWin'` joined `BASKET_WIN_KEY`, which is the one line that makes both hosts fetch the basket and the studio repaint when it lands.
- The basket is `/api/basket?name=All`. The index line is `series.SPY`, with the payload's own `bench[].index` (same rebasing) as the fallback.
- Verified: 27 checks in Node against a fixture (`indspot-test.js` in the session scratchpad) — the header, all twelve figures against hand arithmetic, the line's membership and end value, the fund kept out of it, the index line, both fallbacks, the waiting card before the basket arrives, the three artboards.

**NOT YET SEEN ON ANY ARTBOARD.** The risks, in the order to look for them: the square, where the chart is 158px tall and now carries two lines and two end tags; the note, which is three sentences where the stock card's is two; and the dial block, whose text is a count plus a sentence rather than a word plus a flag.
