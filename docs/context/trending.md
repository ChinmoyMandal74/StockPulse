## Trending — `/trending` (2026-11-07, owner's request)

The owner: "Create a page similar to ideas called trending … add 4 sub tabs .. trending up by gain .. trending down by loss .. trending by volume up and down .. trending by market cap up and down".

- **Who:** members, never guests, as `/ideas`.
- **Where:** the screener bar, after Ideas (`trendingLink`, hidden for guests with the other member links).
- **Live:** each load reads the latest served rows. Nothing is stored, and no rule reads any of it.

### One page, two addresses

`/trending` serves `private/selloff.html`, the Ideas page, which reads its own address (`TREND`) and switches mode. One table serves both pages, with its sorting, column filters, frozen heading, Signal and Tone 7D cells; there is no second copy.

In Trending mode the page:
- swaps the eight Ideas tabs (in `#tabs`) for four;
- relabels the window control **Period** (Today, 1 week, 1 month);
- shows a **Price up / Price down** switch on the two tabs that have both;
- shows only its own columns. A column marked `pg: 'ideas'` or `pg: 'trend'` belongs to one page; anything unmarked appears on both, subject to its `only`.

The address keeps the state: `?show=volume&side=down&period=1w`.

### The four tabs (`trending.js`)

Up to `TOP` (50) companies a list. Funds, error rows and blank moves are left out.

| Tab | The rule | Order |
|---|---|---|
| **Trending up · by gain** | the move over the period is above zero | largest rise first |
| **Trending down · by loss** | the move is below zero | largest fall first |
| **By volume** | Rel. volume (`volX`, the latest session's volume against its 20-day average) at 1.5 times or more, split by whether the price rose or fell that session | heaviest first |
| **By market cap** | the dollar change in market value: the value now less the value the move started from (`capChange`) | largest change first, each way |

- **Volume always reads the latest session,** whatever the period: relative volume is a one-session reading, so the period control is hidden on that tab. During trading it is the volume so far against a full-day average, so it reads low in the morning.
- **The period's move** is the screener's own Today, 1W or 1M (`todayPct`, `oneWeekPct`, `oneMonthPct`).
- **Market value** is the one money figure reliably in US dollars, so its changes compare across companies.

### Serving

- **Rows:** `trendingAnswer(period)` in server.js reads the same rows as Ideas, through the shared `pageRows(snap, pf)` helper. That helper scores the Signal as `/api/stocks` does (after `sourcedNow()`), then lays on `serveStamps`, `stampCapDerived` and `stampPeerValue`. Every reading is therefore the screener's own, and `selloffAnswer` now uses the same helper.
- **Caching:** the answer is held per period, keyed on the snapshot stamp and the tone figure's `at`, so it follows the intraday refreshes.
- **Routes:**
  - `/api/trending?period=` (an unknown period reads `today`)
  - `/api/trending.xlsx?period=`: six sheets and an About sheet (`Trending.workbookSheets`). A blank figure is an empty cell; the activity log gets `export trending.xlsx`.

### Columns

| Column | Where |
|---|---|
| Company, Sector, Market cap, Today, 1 week, 1 month, Rel. volume, From 52-week high, RSI, P/E, Fwd P/E, Value vs industry, Growth & profit, Signal (with its rule), Tone 7D | every Trending tab |
| Value change | By market cap |
| $ volume | By volume |

Revenue growth, profit margin, Reported and Guidance are left off Trending so every tab fits its card at 1300px. Green and red are used only on price moves and Value change, which is a price move.

### Verified

- **`trending-test.js`** (34 checks) covers:
  - each list's edges: exactly 1.5×, a flat day, a blank move, funds and error rows
  - the period, at most 50 rows, and ties ordered by symbol
  - `capChange`: null is not zero, and a −100% move has no starting value
  - the workbook, and that no trade wording appears
- **In-memory end to end** over production's snapshot, with the browser in headless Chrome: 63 checks, plus a separate check on the screener button.
  - Access: anonymous visitors are sent to login and refused at both APIs; a member gets the page.
  - Every list matches an independent re-reading of `/api/stocks`, and every Signal is the screener's.
  - Tabs, the side switch, the period, the address, the filters, the colours, and a cell under every heading.
  - Every tab fits at 1300, 1440 and 1920px; nothing scrolls sideways at 390px; no script errors.
  - Ideas is unchanged: eight tabs, its columns, its window control.
  - The screener bar wraps, so the new button adds no width.
