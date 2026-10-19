# Corrections: the Drawdown column and two cards (2026-10-10)

Backlog 34, pieces a, b and c. The owner: "There is nothing in my app about market and individual stock corrections." The distance below the 52-week high was always on the row (`pctFromHigh`); what was missing was the vocabulary, a count, and the history.

## a. The state, and the screener column

`Filters.ddStateOf(pctFromHigh, historyDays)` in `private/filters.js`, with `DD_STATES`, `DD_ORDER`, `DD_RANGE`:

| Below the 52-week high | State |
|---|---|
| under 5% | Near high |
| 5 to 10% | Pullback |
| 10 to 20% | Correction |
| 20% or more | Bear market |

- **Against the 52-week high, not the record.** A stock 40% off a two-year-old peak and at a one-year high is not "in a bear market" in the sense a reader means. `% from record` is the other question and keeps its own column.
- **No state under 126 sessions of history** (`DD_MIN_HISTORY`): a three-month high is not a year's. An unknown history is taken as enough.
- **A null is not "Near high".** Empty is rejected before coercion.
- **Stamped on the way out** as `ddState` in `stampCapDerived` (server.js), beside the size band: never stored, and read by no rule. Proved by scoring one row with the field absent, present and lying.
- **The column** is `ddState`, "Drawdown", in the Relative group after `% from 52W Hi`; a category filter and sortable in ladder order. `FIELD_SPEC` row `rel|Drawdown`. No colour: "Near high" is faint and the other three are plain text. Constants after this column: Relative 17, `PAD_SPAN` 109, error row 104, empty row 106.
- Not in `CHAT_FIELDS`; that needs an owner decision.

## b. The Corrections card (`corrections`, Market group)

`tplCorrections` in `private/cards.js`; one control, `corSp500`.

- The four indexes, each with its fund's distance from its own 52-week high and its state.
- One stacked bar of the cut's companies by state, with counts and shares.
- The same split per sector (three companies or more), ordered by the share 10% or more below.
- **Tints are blue, grey, amber, orange, never green or red**: a state is a place, not a move.
- The card restates the thresholds (`ddStateC`) because `cards.js` has no requires and the stock page and phone do not load `filters.js`. `Cards.ddStateOf`, `Cards.ddStates()` and `Cards.ddMinHistory` are exported so a test asserts agreement with `Filters`; it was swept over every hundredth of a percent from -70 to +5.
- The index status lives on this card. The Snapshot card's index chips were left alone.

## c. Drawdowns (`drawdown`, Stock spotlight group, and the stock page)

- **`Cards.drawdownAnalyse(dates, closes, minPct)`** is pure and is the one definition of an episode: from a high to the first close back at or above it; depth is the lowest close between. Days are calendar days. It returns the underwater series, the episodes at or past the threshold, medians, and where the price stands now.
- **The window cannot see a high from before it opens.** The first close is treated as a high, so an episode starting there is flagged `fromStart` and printed "before <date>".
- An exact threshold counts (a hair of slack for floating point).
- **`Cards.drawdownBlock(an, { rows })`** draws the chart and table, sized in em so each host sets one font size. Labels are HTML over a stretched SVG. Red is correct here: the area is a price below where it was.
- **The card**: controls `ddSym`, `ddYears` (3, 5, 10, max), `ddMin` (10 or 20). History comes through `getHistory`, at the depth `Cards.drawdownNeed` asks for; the studio repaints on arrival and `/api/m/post` reads the same depth. An index is picked by its fund and titled by the index name.
- **The stock page**: section `#dd`, "Drawdowns", filled by `loadDrawdowns()` from `/api/history?days=1265`. It takes only the drawdown rules of the card stylesheet (`Cards.drawdownStyle()`, the slice between the `dd:start` and `dd:end` markers), stays hidden under 250 closes, and removes itself on any failure.

Checked against the archive: SPY over five years gives two episodes, January to October 2022 at 25.4% and February to April 2025 at 19.0%.

## d. Two history columns: Corr. 5Y and Median recov. (2026-10-10)

The owner, of the stock page table: "The median days to recover can be calculated at the stock level, why don't we show that on screener". Keys `ddCount` and `ddMedBack`, in Relative after Drawdown; `FIELD_SPEC` rows `rel|Corrections 5Y` and `rel|Median recovery`.

- **`ddCount`**: drawdowns of 10% or more in five years, each counted once from its high to the first close back at it; one still open counts. **`ddMedBack`**: median calendar days from the bottom back to the old high, over those that recovered.
- **An episode already under way when the window opens is left out** (`Cards.drawdownStats`): its high is unseen, so a median cannot use it. The chart still draws it, marked "before".
- **Zero is a real count; the median is null when none has recovered.** Under 500 sessions in the window (`MIN_SESSIONS`) both are blank, stored as `n = NULL`.
- **Stored, not computed on the way out.** The figure needs five years of closes per stock, about 1.6 million rows for the universe. Table `drawdown_stats` (in `SYMBOL_TABLES`); `drawdowns.js` `slice()` rebuilds the 200 stalest symbols per call, in chunks of 40 through `readCloseSeries`.
- **Refresh**: the daily watchdog cron calls the slice, bounded by its own 25-second budget and raced against a 45-second clock, so every symbol is redone about weekly for roughly 250,000 rows read a night. `drawdown-load.js` (dry run by default, `--commit`, `--only`) is the first fill and the rebuild by hand.
- **Reaches the row through `stampFlows`**: `buildFlows` reads the table once into the stored `flows` value (`FLOWS_V` 3, six-hour life) as `dd: { SYM: [count, median] }`, and `flowsOf` sets the two fields. No new stamp site.
- Constants after these columns: Relative 19, `PAD_SPAN` 111, error row 106, empty row 108.
- First fill, 2026-10-10: 1,127 of 1,280 with a count, 153 under two years of history, 4 with no drawdown of 10%, 195 with none recovered; the median stock's median recovery is 63 days.
- The stock page reads 1,265 sessions and this reads 1,830 calendar days, so an episode right at the window's edge can differ between the two by a few days of start.

## Not built

The rest of piece d (deepest drawdown in a year) and piece e (the market's own correction history as a table). Neither card was rendered in a browser by the build; tests were Node suites on fixtures plus the read-only check above.

## Renamed: Drawdowns in the Market picker (2026-10-19)

The owner looked for a visual of the screener's Drawdown column under Market and did not find one: the card that counts its four states was called Corrections. It reads **Drawdowns** in the Market group's picker now, and **Market drawdowns** in the template list and on the phone, where the Stock spotlight's one-company Drawdowns card already has the plain name. The template id stays `corrections`, so saved posts and links still open it; the card's own heading ("Who is in a correction") is unchanged. The two history ideas offered the same day (an index's own drawdowns over the years; the share of stocks in a correction week by week) were not asked for and are not built.
