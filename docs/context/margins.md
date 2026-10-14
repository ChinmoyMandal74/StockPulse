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

## One sector, one industry: `secmargin` and `indmargin` (2026-10-10)

The owner, of the index card: "Can this be expanded to sector and industry templates in promo". Two more templates on the same builder (`marginsCard(tpl)`, table `MG_TPLS`), in the Sector and Industry groups as "Margins".

- **One level further down each time**: the index card breaks its line down by sector, the sector card by industry, the industry card by company. A company row is named from the screen's rows and carries no count.
- Controls: `smgName`, `smgSp500`, `smgMetric` and `imgName`, `imgSp500`, `imgMetric`. The name pickers are filled by the spotlight cards' own `fillGroupNames`, and the index picker refills them first.
- `Cards.marginsNeed(tpl, opts)` returns `{ cut, dim, value, key }`; a host caches under `key` and is handed the whole need (`ctx.getMargins(need)`). The route is `GET /api/margins?cut=&dim=sector|industry&name=`, and `marginsFor(cut, dim, value)` caches per key, cleared past 80 entries.
- `Margins.build` takes `group` on each member (falling back to `sector`) and `opts.minGroup`: 3 for sectors and industries, 1 where a row is a company.
- **The lead quarter is 80% of the best-covered of the last six quarters, not of the member count.** Foreign issuers file annually and new listings have few quarters; counted in the denominator they could never be reached, the lead slid back a year, and no company had twenty quarters behind that. Found on the first real industry: 38 semiconductor companies on the whole screen, lead 2025 Q2, an empty card. After the fix: 22 of 38, 26.7% to 43.4%. The S&P 500 figures did not move.
- The index card's last column heading was clipped to "VS YR ..."; the column is now never narrower than its heading.
- Checked against the filings: Technology in the S&P 500, 75 of 86 companies, 19.1% to 27.3%; Semiconductors in the S&P 500, 13 of 14, 27.0% to 43.9%.

## The column: `netMarginChg`, "Margin chg", in Fundamentals after Profit margin

- Points, signed, no colour. Tooltip gives both margins. `FIELD_SPEC` row `fund|Margin change`. A fund's blank run in that block is now `naRun(7)`.
- **Stored as one `app_meta` value** (`margin_chg`: `{ at, m: { SYM: [now, prev] } }`), rebuilt whole by `marginChangeBuild()` on the daily watchdog (about 36,000 rows read, raced against a 45-second clock), and never overwritten by a build that found nothing.
- **Reaches the row through `stampFlows`**: `buildFlows` reads the value into `flows.mg` (`FLOWS_V` 4) and `flowsOf` sets `netMarginChg`, `netMarginNow`, `netMarginPrev`. A missing end is blank, never a margin of zero.
- 978 of 1,280 companies have a figure. Blank: funds, companies with under eight quarters, banks whose filings carry no revenue line here (JPMorgan among them), and margins past 100%.
- Constants after this column: Fundamentals 23, `PAD_SPAN` 112, error row 107, empty row 109.
- Display only; the signal is identical with the field absent, present and lying.

Neither surface was rendered in a browser by the build.

## Built once a day for every group, so the card never waits (2026-10-14)

The owner, of a Theme Margins card showing "Reading the filings…" through a whole nightly run: "why do we have this limitation" and then "go ahead". The limitation is `standAside`: a live Margins or Earnings growth answer reads every company's filings at once (about 36,000 rows for the S&P 500), and since 2026-09-19 such reads wait out a running refresh rather than push its rounds past their deadline. Correct for a live read; wrong for a figure that only moves when a company files.

- **One computation, two callers.** `figuresCtx` (the universe, the index funds' holdings, the filer ids), `cutMembers` (who is in a cut, one company once), `egCompute` and `mgCompute` (the arithmetic, from facts in hand). `earnGrowthFor` and `marginsFor` are now the live path over them, reading only the companies they need, as before.
- **`groupFiguresBuild()`** reads the whole universe's filings once (5.6 years) and computes Earnings growth for the three cuts and Margins for every cut × the market, each sector, each industry and each theme. Each is stored as its own `app_meta` row, `fig:eg:<cut>` and `fig:mg:<cut>|<dim>|<name>`, so a card reads one row. Earnings growth keeps its own 3.6-year window by filtering the rows (`factsFrom`), so its answer is the one a 3.6-year read gives.
- **`POST /api/group-figures/rebuild`** (the cron secret or an admin, stands aside itself); `nightly-ping.js` asks for it as its last phase (`figures`).
- **Served first.** `/api/margins`, `/api/earnings-growth`, and the phone's saved-post route all go through `marginsFor` / `earnGrowthFor`, which look for the stored row before anything else; the routes stand aside only when there is neither a cached nor a stored answer. A group the build has not stored yet (a theme added today) still works live.
- The waiting message added the day before stays, for that live case.
- **First build, 2026-10-14**: 392 figures (389 Margins, 3 Earnings growth) from 1,240 companies' filings in 32 seconds, 11.5 of them reading. **Checked**: the stored answer against the previous code computing live, on eight cuts (market for each index, a sector, an industry, a theme, earnings growth for two cuts): identical every time, served in 18 to 78 ms where the live answer took 0.2 to 8.4 seconds.
- **What it took to get it written, for whoever builds the next one.** The whole universe's filings in one read dropped the connection on the deployed app, so `readFactsSliced` reads a hundred companies at a time. Then the WRITES failed every time, batches of a hundred, batches of ten and single statements alike, starting with the very first 33 KB figure: "fetch failed". The same writes work from a laptop. The connection the long read leaves behind is not usable on the deployed app, and the first request after it fails. **A small read first** (`snapshotUpdatedAt`) takes that failure, since a read may be retried and a write may not; after it every write goes through. The step marker (`step` in the build's answer) is what found it; keep it.
- The writes are one statement each (about 400 round trips, a few seconds), and an error names the figure and the network cause.

## Valuation: the index's P/E over ten years (2026-10-14)

The owner: "in Promo, I don't think we have anything talking about historical PE at the index level." Every P/E history was one company's. Template `idxpe`, **Market → Valuation**, control `ipeCut` (S&P 500, Nasdaq 100, every company tracked).

- **Two lines** (`indexpe.js`): the index's own P/E, the members' combined market value over their combined trailing-year net income with losses in the sum, as a published index P/E is struck; and the median member's own P/E, profitable members only. The first is led by the largest companies, the second is the typical one.
- **The per-company figures are the peer chart's** (`trendSeries`): market value at each quarter's last close on the share count filed then, split-adjusted, over the trailing year from the filings. 41 quarter ends.
- **Today's members, applied to every past quarter**, and a quarter is drawn only when half of them are on record there; the note names how many stand behind the earliest quarter (352 of the S&P 500's 499).
- **Built once a day** (`indexPeBuild`, `POST /api/index-pe/rebuild`, the nightly's last phase `index P/E`): the whole universe fifty companies a slice, about 52,000 close seeks and every member's filings, **90 seconds**; stored as `fig:pe:<cut>` (3 KB each) and read by `GET /api/index-pe` and the phone through `indexPeNeed`.
- **First reading**: S&P 500 26.3× (median member 23.0×), Nasdaq 100 31.2×, every company 27.7×. Ten-year range for the S&P 500 20× (Q3 2022) to 39× (Q4 2020, earnings collapsed). Plausible against the published history in shape; not checked against a published index figure, which is struck on different members.
- **Seen**: the first picture printed quarter ends as "Q09-30 '26" (`mgQ` reads the margins' `YYYY-Qn` keys, not dates), its right-hand axis labels overlapped, and the ten-year range ran off the card. `ipeQ` labels a quarter end; the range is in whole numbers.
