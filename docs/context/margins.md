# Corporate margins: the Margins card and the Margin chg column (2026-10-10)

The owner: "Is there good data on understanding corporate margin", then "Yes build and add the rest to backlog". The filings already held every company's revenue and profit by quarter; nothing added them up. Built: the index and sector margin history as a promo card, and a per-stock margin-change column. The rest is backlog 35.

## The arithmetic: `margins.js` (root, pure)

- **A group's margin is total profit over total revenue**, never an average of company margins. An average lets a tiny loss-maker outweigh Walmart.
- **A trailing four quarters at every point**, so the line is not the calendar. A seasonal company draws a flat line; the test asserts it.
- **The same companies at every point.** A company counts only with every quarter the window needs (17 points, so 20 quarters). The panel size is returned and printed. Without this, a large low-margin filer arriving halfway would be drawn as "margins fell".
- **Calendar quarters by the middle of the fiscal quarter**: `EarnGrowth.quarterOf`, so this and the Earnings growth card place a quarter in the same column.
- **The lead is the newest quarter 80% of the group has filed.**
- Four measures: `net`, `op`, `gross`, `fcf`, each with its own panel. Guards: quarterly revenue over 5e11 or profit over `EarnGrowth.NI_MAX` is not a company's.
- Sectors within a measure's panel, three companies or more: now, and four quarters earlier.
- `change(rows, today)`: one company's trailing-year net margin now and the year before. Null unless eight consecutive calendar quarters are on file, the newest within 230 days, and both margins within 100% either way.

Checked against the filings, 2026-10-10, S&P 500: net margin 14.8% for the year to Q2 2026 from 11.4% four years earlier, on 377 of 499 companies; operating 292, gross 237, free cash flow 196 companies.

## The card: `margins` (Market group)

`tplMargins` in `private/cards.js`; controls `mgSp500` (S&P 500, Nasdaq 100, the whole screen: the Earnings growth cuts) and `mgMetric`. Data through `ctx.getMargins(cut)`, asked by `Cards.marginsNeed`; the studio fetches `GET /api/margins?cut=` (member, half-hour cache, stands aside for a refresh) and `/api/m/post` calls `marginsFor`.

- Three figures (now, change in points on a year earlier, range), one line at its true pixel size with the year-ago and newest points marked, then sector rows with the change.
- **Blue and orange for widened and narrowed, never green and red**: a margin is not a price.
- The subtitle is "profit as a share of revenue". An earlier wording used the word "sell", which the no-trading-words rule catches even in an innocent sense.
- Reads about 39,000 filing rows for the S&P 500 per cold cache.

## The column: `netMarginChg`, "Margin chg", in Fundamentals after Profit margin

- Points, signed, no colour. Tooltip gives both margins. `FIELD_SPEC` row `fund|Margin change`. A fund's blank run in that block is now `naRun(7)`.
- **Stored as one `app_meta` value** (`margin_chg`: `{ at, m: { SYM: [now, prev] } }`), rebuilt whole by `marginChangeBuild()` on the daily watchdog (about 36,000 rows read, raced against a 45-second clock), and never overwritten by a build that found nothing.
- **Reaches the row through `stampFlows`**: `buildFlows` reads the value into `flows.mg` (`FLOWS_V` 4) and `flowsOf` sets `netMarginChg`, `netMarginNow`, `netMarginPrev`. A missing end is blank, never a margin of zero.
- 978 of 1,280 companies have a figure. Blank: funds, companies with under eight quarters, banks whose filings carry no revenue line here (JPMorgan among them), and margins past 100%.
- Constants after this column: Fundamentals 23, `PAD_SPAN` 112, error row 107, empty row 109.
- Display only; the signal is identical with the field absent, present and lying.

Neither surface was rendered in a browser by the build.
