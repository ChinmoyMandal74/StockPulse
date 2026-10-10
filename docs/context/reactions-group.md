## The Reactions group — five columns between Relative and Trend (2026-10-10, owner's request)

**A new screener group, id `react`, label "Reactions" (the owner's word), `#f472b6`.** It holds **Chip selloff**, moved from Relative, and four new columns: **Market selloff**, **Market rally**, **Short build** and **Insider net**. Asked as *"similar to chips sell off, do you have any other unique ideas that I can add as column"*, then *"add Market selloff, Market rally and also Short interest build and Insider net buying, maybe under a new column grouping"*.

Layout constants after it: `PAD_SPAN` 107, error row 102, empty row 104; banners Relative 16, Reactions 5. The move changed one stored key: a tile or phone setup naming `rel|Chip selloff` is read as `react|Chip selloff` (`FIELD_KEY_MOVED` in server.js, beside the Advice → Signal rename). Screens, views and filters key on the FIELD (`chipSelloff`) and did not move. `TILE_FIELD_RE` has the new id.

**None of the five is read by the Signal.** A check scores one row with the four new fields absent, present and lying and requires the same verdict and flag, and asserts `action.js` does not name them.

### Market selloff and Market rally — measured before building
What a stock typically did on the S&P 500 fund's worst 5% of days in the past year (about thirteen), and on its best 5%. `marketTailCtx(series, benchSym, rmap)` in server.js picks the days off the index's RAW return; the reading is `chipSelloffOf`'s own median, on the same date-aligned returns (it reuses the chip context's return map when there is one, and does not depend on the chip basket). Computed at refresh, so they are blank until the first full round after deploy and in the forward-returns view. Fields `marketSelloff`, `marketRally`.

**The measurement**, on the local archive copy (`mkt-study.js` in the session scratchpad): seven non-overlapping one-year windows from 2019, about 1,100 stocks each.

| year to year, Spearman | selloff | rally | plain beta |
|---|---|---|---|
| six folds | 0.56 0.42 0.67 0.67 0.78 0.68 | 0.24 0.40 0.50 0.51 0.65 0.61 | 0.66 0.60 0.83 0.81 0.80 0.77 |

Both pass the gate Chip selloff passed at 0.53. **Two things the same run showed, and both are in the column tooltips:**

- **They are one sensitivity seen from two sides.** In the latest window the two correlate at −0.82 with each other and at about 0.9 with a plain beta, which itself carries over better. These are a beta a reader can say out loud ("fell 2.6% on the market's worst days"), not a new fact about a stock.
- **The gap between them is not a trait.** "Catches the rallies and dodges the selloffs" (rally + selloff) carries over at 0.20, 0.04, 0.10, 0.10, 0.09 and −0.01. Nothing ranks or screens on the difference, and the Market rally tooltip tells the reader not to.

Spread in the latest window: selloff p5 −5.20, median −1.49, p95 +0.52; rally p5 −0.69, median +1.03, p95 +6.16. Market selloff is negative on nearly every row, so its cell is uncoloured (`magPctCell`, Bad day's rule); the rally cell is signed and uncoloured.

### Short build and Insider net — the owner lifted an earlier condition
**FINRA and insider data were display-only by the owner's earlier condition: no `FIELD_SPEC` entry, no stamp on a row, no screener column.** For these two readings the owner reversed it. The condition still holds for everything else in those tables (the filings card, the insider table, the short-interest history), and the engine's `shortPctFloat` still comes from the profile.

- **Short build** is the change in shares sold short between the two most recent FINRA settlements — `shortMovesPayload`'s own window, so a symbol off that window and a split between the two reports are blank for the reasons recorded there. The cell's tooltip names the two dates.
- **Insider net** is open-market purchases less unplanned sales over `INSIDER_NET_DAYS` (90), as a percentage of the company's market value. Measured on the live table before choosing that shape:
  - **Raw dollars are unusable.** The filings carry values far out of scale: one company shows **$1.6 quadrillion** bought in ninety days, another $23.6B. So a side larger than `INSIDER_JUNK` (25%) of the company's own market value is not believed and the reading is blank, with the tooltip saying why. On the live screen that was 2 of 689.
  - **45% of selling by value is under a pre-arranged plan** (`planned = 1`) and is left out of the read: it was scheduled months earlier.
  - **Selling dominates**: of 687 readings, 570 are net selling and 116 net buying, most of it pay being cashed in. The median is −0.005% of market value, so **half the column rounds to nothing**; a reading that rounds to zero prints `0.00%`, faint, never `-0.00%`. The tooltip says a small negative is the ordinary case and gives the count of insiders who bought and sold.
- **Both are uncoloured and signed** (`signedPctCell`, `V.smag`): green and red mean the price rose or fell, and a short position growing or an insider buying is neither.

### How they reach a row
**Read-path stamps, from ONE stored value.** `stampFlows(rows)` joined the stamp set (`serveStamps` and the three sites that list stamps one by one). It reads `app_meta` key `flows` through `flowsNow()`, memory-cached ten minutes; the value is rebuilt by `buildFlows()` when older than `FLOWS_TTL_MS` (six hours) and written back.

- **Why stored**: the rebuild reads about 30,000 rows. A cold serverless instance paying that on its first page view, every time, would be most of this database's read bill. Stored, it is one row.
- **`flowsOf(row, f)` is pure** — one row, one stored value — so the arithmetic is tested with no database. Null, never zero: no trade on file is a different statement from "netted to nothing".
- A half that fails to read keeps the stored half rather than blanking it; `insider: null` means "the read failed", never "nobody traded".
- By symbol through `filerIds()`: the insider table is keyed on the issuer.

### `INDEXED BY` on the insider read is load-bearing
`readInsiderNetSince(since)` in db.js groups by company. **Left to itself the planner satisfies the `group by cik` by walking `idx_insider_cik` — the whole table — and applies the date afterwards.** `query-plan-test.js` caught it (`SCAN insider_trans USING INDEX idx_insider_cik`) before it shipped. The first probe of this read had explained a simpler statement without the grouping, and so had not seen it. With `indexed by idx_insider_filed` the plan is a range seek on the ninety days: confirmed on production, 2,698 companies in 340ms.

### Also
- The Bars card can rank on all four (`mdn`, `mup`, `sbld`, `insn`), with no green or red on the two ownership measures.
- Not in `CHAT_FIELDS`.
- Verified: 30 checks in Node (`rx-test.js`), the server functions lifted out of server.js by name and run with no server: the tails on a synthetic year, one junk print inside the thirteen days, a stock without the days, the junk guard at its exact limit, the failed-read cases, the catalogue, the group's order, and the Signal boundary. Header cells, banner spans and body cells were counted per group (all match, groups contiguous). **Nothing was rendered**, and the two market columns cannot show a value until a refresh has run on the new code.
