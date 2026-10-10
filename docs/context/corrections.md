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

## Not built

Pieces d (deepest drawdown in a year, count of corrections in three years; days since the 52-week high already exists as a column) and e (the market's own correction history as a table). Neither card was rendered in a browser by the build; tests were Node suites on fixtures plus the read-only check above.
