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
`barDraw(top, m, N)` was lifted out of `tplBars` unchanged — the scale, the broken bar for a runaway value, the zero line where rows straddle it, the per-artboard type sizes — and both cards call it. **Proved by comparison**: fifteen Bars builds (five control sets on three artboards) are byte-identical against the file before the extraction. A row may carry `sub`, printed after its name inside the clipped name cell (`.ix-c`), so a long industry name loses the count before it wraps.

- **So the fit is inherited, not measured**: same row cap (`BAR_CAP` 15 / 10 / 15), same sizes. Two things are new and were NOT measured in a browser: the note, which is longer than most of Bars', and the title's dim line, kept to 30 characters so it stays on one line ("industries · past 6 months"). **Look at all three artboards with fifteen rows before trusting it.**
- `barFig` prints a percentage to one decimal even when `dp` is 0 (`m.dp || 1`), so the breadth figure reads `75.0%`. Left alone: changing it would change Bars.

### Wiring
- Controls `indMetric`, `indDir`, `indCount`, `indWeight`, `indScope`, `indSector`, `indCap`, `indScreen`, `indSp500` — in `CONTROL_IDS` (180 of `POST_OPT_MAX` 200), the template's own listener list, and the four shared picker fills plus the list copy.
- **The prefix `ind` is deliberately NOT in `INDUSTRY_PREFIXES`.** `syncIndustries` reads `<prefix>Industry` for every prefix there and would throw on a card that has no such control. The cost is that this card's cut is its own and is not carried across from the scoped cards, like the Market cards'.
- A Sector here narrows WHICH industries are ranked. A cut that leaves fewer than three industries says so rather than ranking.
- The measure picker is filled from `Cards.indMetrics()`; an unknown key falls back to the one-month return.
- No extra data channel: the card reads snapshot rows only, so the phone draws it through `/api/m/post` with no change. `mobile.html`'s `TPL_NAMES` has the label.
- Verified: 26 checks in Node against a fixture (`ind-test.js` in the session scratchpad): the averages, the beginning-weight arithmetic against a hand calculation and against today's weights (which differ), the floor, the fund, the blank industry, the loss left out of a median, the note's counts, the empty state, the three artboards. Nothing was rendered.

### Intended second view
An **industry spotlight** — one industry in full, the counterpart of the Stock spotlight: its line against the index, its standard-period returns, how many companies and how much value, leaders and laggards, median fundamentals, the tally of signals. `/industry/<name>` (`basketPayload`) already computes most of it. Not built: it is a new layout and needs a browser to fit.
