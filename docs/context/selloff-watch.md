## Selloff watch — `/selloff` (2026-11-03, owner's request)

**Members (never guests), on the screener bar after Paper positions** (in the `⋯` menu for its first day). Three tables the owner had been sent by email made a page: *"create a new menu ... and on the page shows these 3 tables as separate views"*. The owner asked for the name "Trading Opportunities"; asked whether that fit the no-recommendation rule, they chose **Selloff watch**. Live, not frozen: each load reads the latest served rows.

Files: `selloff.js` (pure: the release test, the reaction day, the screens, the watchlist), `selloff-test.js` (30 checks), `private/selloff.html`, routes `/selloff` and `/api/selloff` in server.js beside `/ipos`.

### The three views
- **Tech: strong results, fell anyway.** Sector Technology or Communication Services; the company's newest results release (the stored `releaseColumn` figure) filed in the window, revenue up 10% or more on the year (`revenue` / `revenuePrior`), net income above zero, guidance in the release (a `guideChange` word or a `guideKind`; withdrawn is no guidance); reaction −7% or worse.
- **Non-tech: growing, profitable, fell after results.** Every other sector, the same release test, the screener's words `Growing, profitable` and value `Below industry` or `In line`; reaction −5% or worse.
- **AI selloff watchlist.** 25 names in five groups from an Instagram carousel (@stockswithpawan, seen 2026-11-02), fixed in `Selloff.WATCH`. Not a screen. A symbol not on the screener would be listed as such, not dropped.

**The reaction day** is the worse of the filing day (previous close to that day's close: a pre-market report) and the day after (that close to the next: an after-hours report). A release filed on a day with no trading takes the last close before to the first after. "Since" is the reaction day's close to the latest price. Window: 30, 45 (default), 60 or 90 days.

**Every reading is the screener's own**: the route takes the stored snapshot, applies the read-path stamps (`serveStamps`, `stampCapDerived`, `stampPeerValue`), so the words, the source-rule growth and margin, and the Trail P/E's dash off a loss are exactly what the screener shows. Reported falls back to the provider's `lastEarningsDate` for a company with no results 8-K (ASML, TSM). Nothing is stored and no rule reads any of it.

**Cost.** One snapshot read and the release-column figure (held ten minutes, shared with the screener's own route) per change of the snapshot stamp; bars only for the screens' candidates (`readBarsWindow`, the window plus ten days), held per trading day and candidate set. First answer about 0.4s on the in-memory check, held answers 4ms.

### The emailed tables had a guidance bug (found building this)
The scratch scripts behind the 2026-11-02 emails tested `guides || guide_kind`. A release with no guidance stores `guides` as the text `"[]"`, which is truthy, so the guidance test passed everything. **GOOGL and AXTI (tech) and CAT (non-tech) gave no guidance and should not have been listed.** The page applies the test correctly. The first screen in backlog entry 56 used the same expression but all fifteen of its companies do carry guidance, so that table stands. Against the emails the page also adds TTMI (a filing-day fall, which the tech email's day-after-only move missed), LITE and FANG (reported Nov 2), and JBL and SNX (late-September releases inside the 45-day window).

### Verified
- `selloff-test.js`: 30 checks over the release test's edges (exactly +10%, a zero profit, withdrawn guidance), the reaction in its four shapes, both screens' filters and the watchlist.
- In-memory end to end over production's snapshot and release column with the local copy's bars (29 checks): anonymous and guest refused at the API and the page, `.html` gated; RDDT's reaction recomputed by hand from the bars; LITE's P/E a dash, MU's the provider's; every row drawn with a cell under every heading, a fall drawn red, sorting by RSI, the window control hidden on the watchlist, no sideways scroll at 390px, no script errors.

## Frozen heading (2026-11-03)
The heading row stays put while the page scrolls (owner: "freeze panes on the row heading").
- **First version:** the table scrolled in its own box with the heading sticky inside it. The owner turned it down the same day: "I don't like 2 scrollbars on the page".
- **Now it uses the page's one scroll.** A sticky heading needs every box between it and the page to leave `overflow` alone. So on screens wider than 1180px, where every tab's table fits (checked at 1200, 1280, 1440 and 1920):
  - neither this card's core (`.sw-card > .core`, which clips by default in app.css) nor `.sw-wrap` clips;
  - `thead th` sticks at `--sw-stick`, the floating nav's height, measured in script.
- **Once stuck,** `body.sw-stuck` paints the nav's band with `--bg`, so rows pass under it instead of showing round the nav.
- **At 1180px and narrower,** the card scrolls sideways again and the heading is ordinary.
- **Tests:** the browser test checks that the table has no scroll of its own, the heading waits under the nav while the rows move, and the band is painted. With the sticky rule removed, the checks fail; with the band rule removed, they fail too.

## Market cap (2026-11-03)
The owner asked for a market cap column. It sits after Company (and after Group or Sector), on all three tabs.
- **Data:** `fields()` carries `cap` (`marketCap`, null when blank) and `currency`.
- **Display:** the page draws it with the screener's own `RowCard.fmtMktCap`, loading `/rowcard.js`, so it reads exactly as the screener does.
- **Checks:** every tab still fits at 1200px.

## The AI watchlist (2026-11-03)
The third tab was "AI selloff watchlist", the 25 names from Instagram. It is now **AI watchlist**.
- **Owner's request:** "there are many more AI related stocks in my theme"; asked how to join them, "combine logically into one big list".
- **Themes chosen by the owner:** AI - Optical Networking, AI - Power Generation, Memory, Cloud Infra, Hardware & Networking, Hyperscalers, Neoclouds. Quantum Computing was not chosen.
- **The list:** the 25, then every company in those themes, each once. On 2026-11-03 that was 81 companies. ETFs are left out (the Memory theme's DRAM), as the screens leave them out.

**Grouping (`selloff.js` `watch`), first rule that applies:**
1. A name on the 25 keeps its published group.
2. `PLACE` puts GFS, TSEM, UMC (foundries, beside TSMC) and INTC in Compute.
3. Industry Semiconductor Equipment & Materials goes to Semicap (ONTO, AXTI, AEHR).
4. Otherwise the company's first theme in `AI_THEMES` order, mapped to a group: Memory → Memory, Power Generation → Power, Optical → Networking, Neoclouds, Hyperscalers, Cloud Infra → Servers & data centres. Neoclouds is ordered before Cloud Infra so CoreWeave reads as a neocloud.

- **Order:** groups in `GROUP_ORDER`; within a group, the largest market value first, blanks last.
- **Each row carries:** `from` ('list', or the theme it came in by) and `themes` (every AI theme it is in). The page shows `from` under the group name, with the themes in its tooltip.

**Live themes.** The stored snapshot's theme memberships change only at a refresh. So `/api/selloff` reads `readPortfolios()` on each request and stamps `membershipOf` onto the rows, as the screener does, and its held answer is keyed on the AI themes' members. The browser test edits a theme in the in-memory database and sees the change on the next load.

## Export to Excel (2026-11-03)
An **Export to Excel** button on the bar downloads `/api/selloff.xlsx?days=N`, for the window chosen on the page. Members only: guests get 403, anonymous visitors 401.
- **One answer, two routes:** `selloffAnswer(days)` builds the result; both `/api/selloff` and the download read it, so the file always matches the page.
- **Sheets** (`selloff.js` `workbookSheets`): Tech, Non-tech, AI watchlist, and About (what each column means, prices-as-of time, the rules).
  - Every figure is a number: percent as a number of percent, market value in $ billions.
  - A blank figure is an empty cell, never 0.
  - Heading row frozen, with filters.
  - The watchlist sheet adds Group, Source and every AI theme a company is in.
- **File:** written by `xlsx.js`; the activity log gets `export selloff.xlsx`.
- **Checks:** the browser test opens the file in Excel itself (read-only, through COM). It checks the sheet names, a row per company, the worst reaction first with market cap as a number, and the filters.

## Default tab (2026-11-03)
The page opens on the **AI watchlist** (owner). `DEFAULT_VIEW` in the page; the address stays `/selloff` for it, and the two screens are `?show=tech` and `?show=nontech`. The blog post links `/selloff?show=watch`, which still works.

## Today (2026-11-03)
A **Today** column on all three tables, after Market cap (owner: "add todays performance").
- **Data:** `fields()` carries `today` from the row's `todayPct`, the screener's own Today: the previous close to the latest price during trading, or to the close.
- **Display:** one decimal; green for a rise and red for a fall, since it is a price move. A missing move is a dash.
- **Excel:** the workbook has `Today (%)`, explained on the About sheet.
- **Freshness:** the page's held answer is keyed on the snapshot stamp, so it follows the intraday refreshes.

## Signal (2026-11-03)
A **Signal** column, last on all three tables (owner: "Add Signal at the end, Feel free to increase the width of the table").
- **Shown:** the word, with the rule that fired under it; never the word alone.
- **Colour:** `/Strong/` green and `/Weak/` red, as the screener draws it.
- **Sorting:** by strength, strongest first, blanks last.
- **Excel:** the workbook has Signal and "Signal: the rule that fired", explained on the About sheet.
- **Where it comes from.** `/api/selloff` scores the Signal on the way out exactly as `/api/stocks` does (`await sourcedNow()`, then `scoreActionInto(rows)`), before the stamps. So the word and the rule are the screener's own, over the source rule's figures. Display only: nothing new is read by the rules.
- **Check:** the browser test compares every row on all three tabs (103) with what `/api/stocks` serves for the same company.
- **Width:** the page's width went from 1280 to 1600px. The narrow layout (sideways scroll inside the card, ordinary heading) now starts below 1280px instead of 1180px; every tab is checked to fit at 1280, 1440, 1600 and 1920.
