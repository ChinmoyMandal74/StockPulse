## The history behind a number: click a screener cell (2026-10-13)

The owner: "drill down on numbers on the screener wherever possible ... only where there is a history available ... not for any price data but surely for fundamental data such as revenue, P/E ratio ... on click rather than hover." Then: not for guests; **not for thin vendor-only columns**; a chart and a small table.

**What it is.** A cell in a drillable column has a dotted underline and a pointer. Clicking it opens a panel anchored to the cell: the company and measure, the newest figure, a chart, the last eight periods in a table, one line on where it came from, and a link to the stock page. Escape, a click elsewhere, a click on another cell, a table scroll or a resize closes it.

**Three files.**
- `drillhist.js` (server, pure): `FIELDS` is the one list of what can be drilled, keyed by the header's `data-key`, and `build(field, data)` turns stored rows into `{ title, kind, source, basis, points, cols, colKinds, rows, note }`.
- `GET /api/drill?symbol=&field=` (`requireMember`, so a guest is refused): reads only what the field's source needs, for one symbol, and keeps the answer in memory ten minutes. Writes nothing.
- `private/drillpop.js` (page): the panel, the chart, the click handling and the underline. `index.html` only loads it and hands over `tbody`, a row lookup, `allowed()` and what to close first.

**Where each history comes from.** The cell is the price provider's figure; the provider gives no history, so:

| columns | source | chart | table |
|---|---|---|---|
| Revenue, Gross profit, Net income, Op cash, FCF, Buyback yield | `sec_facts` | trailing year at each quarter end, up to 40 quarters | the quarter, the trailing year |
| Gross / Operating / Profit / FCF margin, Margin chg | `sec_facts` | the trailing-year margin | the quarter's, the trailing year's |
| EPS TTM | `sec_facts` | each fiscal year as filed | the quarters as filed, the year where one ends |
| P/E, Live P/E, P/S, P/B | `trendSeries` for a list of one (the peer chart's builder) | at each of 20 calendar quarter ends | the multiple, market value, what it is over |
| Short ratio, Short % Fl, Short % Out | `short_interest` | about two years of settlements | shares, change, days to cover |
| Reported (last earnings date) | `earnings_history` | surprise per announcement, as bars | estimate, reported, against it |

- **Left out on purpose**: every price, return, trend and volume column; the provider-only ratios (Forward P/E, PEG, ROE, ROA, EV/EBITDA, debt to equity, current ratio, dividend yield, payout, insiders, the growth rates), which have a recorded history only since 2026-08-30; Put/Call OI (days of history); Institutions (the table keeps two quarters a stock); Cash and Debt (the filings' cash and debt are defined differently from the provider's, 63% and 25% within 5%). **Revisit the provider-only ones once six months are recorded.**
- **The cell and the history can differ, and the panel says so.** For revenue, gross profit, net income, operating cash flow and the three margins, when the filings' newest trailing year is more than 5% (2 points for a margin) from the cell, an amber line gives both. FCF and Buyback yield are defined differently from their cells and say that in the note instead of being compared.
- **No invented figures**: a trailing year needs four consecutive quarters with the figure in each; a P/E off a loss and a P/B off negative equity are blank; per-share figures are not added across quarters, so EPS has no worked-out fourth quarter; a surprise off a zero or negative estimate is blank.

**How a cell knows its column.** Body cells carry no key. `columns()` reads the header: it is two rows, the first holding the group banners and, at its start, cells that span both rows (Symbol, Name), so a body cell's column is those leading cells followed by the second row in order. **The first version took a body cell's index to be its header cell's own index and opened the column two to the left.** A browser test caught it before it shipped. The underline is one generated `nth-child` rule per drillable column from the same function, rebuilt when the header changes or the viewer's role is known, and empty for a guest.

**Checked.**
- 36 checks: the builders on fixtures (each source, gaps, losses, blanks, order), the page's formatting and panel, that the page's key list equals the server's and every key is a real column, the route's gate and that it writes nothing.
- **In a real browser** (headless Chrome, the screener's own header, the real module and stylesheet, the real builder's answer): the clicked cell opens its own column and not a neighbour, exactly 20 cells in a row are marked, a price cell has no key, a guest gets no underline and no panel, and the panel is on screen. Looked at for revenue and for announcements.
- **The real route against production**, from a local read-only server, for Microsoft: revenue 40 points from 2016, P/E, P/B and P/S 20 quarter ends, short interest 52 settlements, announcements 12; a fund answers empty; an unknown column and an unknown symbol are refused.
- Taking a headless screenshot fires a resize, which closes the panel as it should. The fixture stops that event; the page does not.
- **Not done by a person yet**: clicked on the live screener.

### It shipped doing nothing, and how that was missed (2026-10-13, an hour later)

The owner: "I don't see the click option on any number." The live header has a THIRD row, the column filters, built by `buildFilterRow()` at load: one cell a column, always present, hidden until switched on, and with no `data-key` on any cell. `columns()` took "the last header row" to be the row with the keys, read the filter row, found none, marked no cell and opened nothing. The browser test had passed because its header was the two rows in the markup.

- `columns()` now takes **the row with the most keys**, whichever it is.
- The fixture header has the filter row, and fails as shipped (0 cells marked).
- **`real-page.js`: the real `index.html` in a headless browser**, every file the repository's own, `/api/stocks` answered from a stored snapshot, `/api/drill` by the real builder, everything else 404 (which the page reads as open mode), and a probe appended to the page. It reports three header rows, 118 cells a row, exactly 20 marked and which, that the marked revenue cell sits under the Revenue TTM heading, and that clicking it opens "NVIDIA · Revenue" with eight rows. As a guest: none marked, nothing opens.
- **The lesson, twice in one feature**: a page that builds part of its own DOM at load cannot be tested from its markup. Test the page itself.

### The same history as a card in Visuals (2026-10-13)

The owner, of the panel: "you are providing a link at the bottom to open the stock page; is it possible to provide a link to open in Promo ... a complete read-only promo card with no option to choose on the side bar."

- **The panel's foot has a second link, "Open as a card"**, beside "Open SYM": `/promo?tpl=figure&sym=SYM&field=KEY`, in a new tab. Not offered where there is nothing to draw.
- **Template `figure`** (`tplFigure` in `cards.js`): the source and basis as the kicker, the company, the measure, four figures (latest, at the start, highest, lowest), the line or bars filling the height left, the last periods as a table (4 on a square, 6 on a portrait, 8 on a story), and the note. **It works nothing out**: every number is `/api/drill`'s, through a new `getDrill(sym, field)` channel, so the card and the panel cannot disagree. Its number formatting is the panel's, restated, and a test compares the two on nineteen values in seven kinds.
- **Reached by the link and nowhere else.** It is in no template list, has no control ids and cannot be saved as a post, so the phone never has to draw one. The stock and column ride in `linkOpts`, which `buildCard` lays over `controlOpts()`. The link is honoured only for a stock on the screen and a column name of plain letters; anything else opens the studio as usual.
- **`body.bare`**: the side bar is hidden and a strip sits over the card with "← Screener" and, for the admin, the three shapes and Download PNG (the side bar's own button, pressed from the strip). A member gets the back link only: the card fits itself, carries the watermark, and is not exported, as everywhere else in Visuals. `fit()` leaves room for the strip.
- **Checked on the real `promo.html`** through `real-page.js` and `harness.sh`: as the admin (strip with shapes and download, no watermark), as a member (`mem bare`, back link only, watermark, the shape chosen to fit), with an unknown symbol (the studio opens normally), and looked at in both views. 22 checks on the card and wiring.
- **`harness.sh` stops its own server by the PID on its port.** It replaced a pattern that killed every node process; see the nightly-job note in `CLAUDE.md`.

### "Reading the history takes time" (2026-10-13)

The owner asked whether the tables are indexed. They are, and the reads were never the slow part. Measured against production, each read the drill-down makes:

| read | time |
|---|---|
| one company's filings (47 to 346 rows) | 26 to 53 ms |
| short interest, announcements, splits | 20 to 43 ms |
| twenty quarter-end closes | 28 ms |
| **the stored snapshot** | **2,300 to 2,600 ms** (5 MB) |

The route read the whole snapshot only to learn whether the symbol was on the screen. It now reads the company's one profile row, which answers that and carries the share count and market value the valuation history needs; the price it also needs is the newest close on file, one seek. The whole route went from about 2.5 seconds to 0.05 to 0.19, and Microsoft's figures are the same to the last digit (P/E 28.58, P/B 8.64, P/S 11.52 at September 2026).

- The indexes involved: `sec_facts` and `earnings_history` are sought on the leading column of their primary keys, `short_interest` on `idx_shortint_sym (symbol, d)`, `bars` on its primary key.
- **The stored snapshot has grown to 5 MB.** Anything that reads it to look up one company pays 2.5 seconds for it. `snapshotCached()` hides that for 20 seconds within one instance, and no longer than that.
- A function that has been idle also pays about half a second to connect and check the schema. That is not this route's to fix.

## On the stock page too (2026-10-19)

The owner: "enable this drill down feature on the individual stock page section exactly how it behaves on the screener".

- **The same panel, endpoint and rule.** Rows in "Everything the screener knows" whose figure has a history open the screener's panel (`drillpop.js`), from `/api/drill`, members and the admin only. A guest's rows are not styled and a click asks for nothing.
- **How a row is found.** The stock page's rows are rowcard's `FIELD_SPEC`, keyed `group|label`, where the screener's cells are keyed by the column's `data-key`. `DrillPop.FIELD_OF` is the one map between them, beside `KEYS` (every key has its row). `RowCard.buildSections` takes it as an opt-in `drill` option, like `links` and `extra`, and marks a row `data-drill="<key>"` only where it has a value; only `/stock` passes it, so the screener's hover card is unchanged.
- **`DrillPop.attach({ root, symbol, row, allowed })`** is the second entry point (the screener keeps `init`). Rows look drillable (`.dp-on`, the screener's dotted underline) only once `/api/me` says the viewer is not a guest; `/api/me` failing is open mode and allows it, the rule the studio link on that page already follows. A link inside a row keeps its own click. On the stock page the panel's "Open SYM" link is left out (it would open the page it is on); "Open as a card" stays.
- **Two faults found while building it, both fixed for the screener too:**
  - **The panel was dark on the light theme.** Its background and hairlines were literal dark colours, so on a light page it drew dark text on a dark panel. They are `--glass` and `--wash` mixes now.
  - **A tall panel could cover its own cell.** Where it fitted neither below nor above, it was clamped to the top of the window, over the row it came from (measured: row at 440 px, panel 8 to 548). It now goes on the side with more room and is capped to that room; it already scrolls inside.
- The stock page scrolls as a whole and the panel is fixed, so a page scroll closes it, as a table scroll does on the screener.
- Verified in headless Chrome against a static host with Coca-Cola's real filings through the real `drillhist.js`: 21 rows marked, a click opens the Revenue history (chart and eight quarters, one request), the same row again closes it, another row opens its own, a scroll closes it, the light theme draws white with dark text, a guest gets no styling and no request, and the screener's own Revenue cell still opens Revenue.
