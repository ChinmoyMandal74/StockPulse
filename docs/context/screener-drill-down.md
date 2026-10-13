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
