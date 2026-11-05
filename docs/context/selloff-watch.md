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

### The themes became the groups (2026-11-05)
Owner: "cleanup themes based on the list that you compiled here, rename all AI related themes to prefix with AI -". The placement above was written into the themes, one AI theme per group and each company in one of them (`retheme.js` in a scratchpad, dry run first, the old map saved beside it):
- Renamed: Memory → **AI - Memory**, Neoclouds → **AI - Neoclouds**, Hyperscalers → **AI - Hyperscalers**, Cloud Infra, Hardware & Networking → **AI - Servers & Data Centres**. AI - Power Generation and AI - Optical Networking kept their names.
- New: **AI - Semicap** (ASML AMAT LRCX KLAC TER ONTO AXTI IPGP AEHR) and **AI - Compute** (NVDA TSM AVGO AMD INTC MRVL UMC GFS TSEM).
- Moved out of a second AI theme: CSCO, ANET, ALAB, GLW to Optical Networking only; NTAP to Memory; CRWV to Neoclouds; INTC to Compute; the foundries, MRVL and the equipment makers out of Optical Networking. VRT and the list's chip names joined their themes. DRAM (an ETF) stays in AI - Memory and is still left off the list. 29 themes → 31, the eight AI themes together after Mag 7.

**Grouping now:** a company's first AI theme in `AI_THEMES` order is its group; a name on the 25 in no AI theme keeps its published group. `PLACE` and the industry rule are gone: the owner moves a company by moving it between themes, and the theme wins over the published group. `from` still says 'list' for the 25. The page's description names the themes from the answer's `aiThemes`.

Theme names are the keys of the stored group figures (`group_months`, `group_days`, `group_years`, `fig:mg:*|theme|<name>`): the new names fill in on the next nightly build, and the old names' `fig:mg` rows stay in `app_meta`, unread.

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

## Bouncing off the lows (2026-11-03)
A fourth tab (owner: "Remember we have the bouncing off the lows, Can you add this as a 4th option"), `?show=bounce`.
- **Source:** it is the screener's own stored screen `bouncelw`, read on every request from `store.readScreens()` (the starter definition if none is stored) and run through `Filters.screenRows`, as the screener and the phone run it. An edit to the screen on the screener shows here at once; the held answer is keyed on the screen's definition.
- **Rule today:** 52-week range position 30 or lower, 1 month over +3%, 2 weeks over 0%. Lowest in the range first.
- **Columns:** the usual readings, plus 52-week range (0 at the low, 100 at the high), 2 weeks and 1 month. It has no reaction columns and no window control.
- **Excel:** a "Bouncing off the lows" sheet, and a line on the About sheet giving the screen's rule.
- **Check:** the browser test compares its companies and order with `Filters.screenRows` over what `/api/stocks` serves: 98 on the test data.

## Renamed Ideas (2026-11-03)
The owner renamed the page from Selloff watch to **Ideas**.
- **Address:** the page is `/ideas`. `/selloff` answers 301 to `/ideas`, keeping a `show=` of lowercase letters only. So the published post `ai-watchlist-2026-11-03` still works; its link was also changed to `/ideas?show=watch`, with status and date kept.
- **What changed:** the bar button (still id `selloffLink`), the page title and heading, and the Excel file name (`tickrlab-ideas-<date>.xlsx`). The activity log now records `page ideas`.
- **What did not:** internal names (`selloff.js`, `selloff.html`, `/api/selloff`, the `sw-` classes). Stored keys and ids are never renamed.

## No text above the tables (2026-11-03)
The owner asked for no descriptive text on the page: "Remove all these texts for all the 4 options".
- **Removed:** the paragraph under the heading, and the line above each tab's table.
- **Where the rule went:** each tab's rule is now its tooltip (`what(view)` sets the tab's `title`).
- **Kept:** the footnote under the table, with the definitions and "Nothing here is a recommendation to trade".

## Tab order (2026-11-03)
AI watchlist is the first tab (owner), then Tech, Non-tech and Bouncing off the lows. It is also the tab the page opens on.

## Compact header (2026-11-03)
The owner asked for less space above the tables.
- **Removed:** the "Screens" label and the Filings button from the floating nav.
- **Heading:** now 30 to 40px (was 38 to 58px).
- **Spacing:** smaller margins, and the nav sits 12px from the top.
- **Result:** the tabs start about 130px from the top at 1440px, which the browser test checks.

## The Brand card (2026-11-03)
The promo studio has a Brand › Ideas card that restates this page's four views and their rules (`ideas-card.md`). Change it with any threshold, group or column.

## Article tone (2026-11-04)
A **Tone 7D** column, last on all four tabs, after Signal (owner: "add article tone field at the end similar to what is shown on screener").
- **What it is:** the screener's Tone 7D, from the same stored figure (`toneColumn`, written by the tone loader at the end of each run, read through `toneColumnFig()`, held two minutes). That is the seven-day average reading from −1 to +1, with the number of articles read beside it.
- **How it gets there:** `Selloff.withTone(views, rows)` lays `tone: {avg, n, pos, neg}` onto the rows `/api/selloff` sends, never onto a snapshot row. The held answer is keyed on the figure's `at`, so a new tone run shows on the next load. The body carries `toneAt` and `toneBand`.
- **Drawn** as on the screener: blue at +0.25 or more and orange at −0.25 or less (never green or red: a reading of words, not a price), the count beside it in faint type, linked to the stock page's articles (`#tone`), with a tooltip giving the read, positive and negative counts. Nothing read in seven days is a dash. Sorts by the average; blanks last.
- **Excel:** "Tone 7D (−1 to +1)" and "Articles read (7D)", explained on the About sheet.
- **Never an input to the Signal**, as everywhere.
- **Width:** to keep every tab fitting at 1280px, cell padding went from 7 to 6px, the Signal column's maximum from 19 to 17 characters, and company names now cut off at 14 characters instead of 16.
- **Checks:** `selloff-test.js` (67) covers `withTone` and the Excel columns. The browser test (137) seeds a tone figure and checks the drawn value, count, link, blue and orange, the sort, and the fit at 1280px. With the `withTone` call removed, its three tone checks fail.
- The Brand › Ideas card's readings row now ends with "Article tone, 7 days".

## Links open in a new tab (2026-11-04)
The ticker and the Tone 7D figure open the stock page in a new tab (`target="_blank" rel="noopener"`), so the table and its sort stay where they were (owner: "make sure clicking on the ticker open the stock page in a new tab"). The browser test checks every link on the page and fails with the attribute removed.

## Three more tabs (2026-11-05)
The owner: "add 3 more on the ideas page quality compounders on pullback and dividend growers near their lows and insider buying clusters". Tabs 5 to 7, `?show=quality`, `?show=divlow`, `?show=insider`.
- **Rules** (`IDEAS` in `selloff.js`, said once in words by `ideaRules()`, which the route sends as `ideaRules` for the tab tooltips, the footnote and the About sheet):
  - **Quality compounders on a pullback:** Compounding record 4 or 5 of its 5 checks, F-score 6 or more, 10% to 30% under the 52-week high, and not Declining on Compounding now (the owner's Lululemon point of 2026-10-26: the ten-year record cannot see a recent turn). Furthest under the high first.
  - **Dividend growers near their lows:** dividend raised 5 or more years running, 52-week range 25 or lower. Lowest in the range first.
  - **Insider buying clusters:** 3 or more distinct insiders bought on the open market in the screener's insider window (`INSIDER_NET_DAYS`, 90), and Insider net above zero. Most buyers, then the larger net, first.
- **Readings** are the screener's own, laid on by `stampFlows` inside `serveStamps` (crChecks, fScore, crNow, divStreak, divSince, divGrowth5y, insiderBuyers, insiderSellers, insiderNet) plus the row's `divYield`. A blank never passes. No new storage and no new reads; nothing feeds the Signal.
- **Insider net above zero** also drops token buying at the very largest companies: it is rounded to 0.001% of market value, so TSM's 30 executives buying a few thousand dollars each read 0 and are left out, while SPG's eleven directors (0.001%) stay in.
- **Columns:** quality adds Ten-year record, F-score and Quarters now (the screener's Compounding record and Compounding now; shorter headings so they fit); dividends add Dividend raised (with the year the run began), Dividend /yr 5Y, Yield and 52-week range; insiders add Insiders buying, Insiders selling and Insider net. 1 month was tried on the quality tab and dropped: at 1280px it pushed the table 36px past its card. The workbook keeps it.
- **Excel:** three sheets before About, and About explains each rule, the Compounding record's five checks, the F-score and Insider net.
- **On 2026-11-05:** 40, 32 and 17 companies.
- **Checks:** `selloff-test.js` 80 (both edges of every threshold, blanks, ETFs, the order, the sheets). With the Declining exclusion or the net-buying test removed, 5 fail. The page drawn in headless Chrome over a payload built from production's snapshot and flows: every row has a cell under every heading, every tab fits its card at 1300, 1440 and 1920, and nothing scrolls sideways at phone width.
- **The Brand › Ideas card still shows four views.** Seven boxes do not fit its 4:5 layout without a redesign, so it was left for the owner to decide (`ideas-card.md`).

## Strong three years, quiet this year (2026-11-05)
The owner: "stocks that have generally had good returns over the previous 3 years but have not done much this year", then "Add 3Y as a new column and then add a new ideas tab". Tab 8, `?show=quiet`; "winners" was avoided in the name (no rankings or winners wording anywhere).
- **Rule** (`IDEAS.quiet`, `quiet()`): the screener's 3Y at +50% or more (about 15% a year), YTD between −5% and +5%, revenue up on the year in the latest quarter (`revenueGrowthYoY` above zero), and not Declining on Compounding now, so a stock rolling over is not read as one resting. Biggest three-year rise first. A blank never passes, so a company with under three years of stored history is not listed.
- **Columns:** 3 years, This year, 1 year and Quarters now. Fits at 1300, 1440 and 1920 (the table is 1197px in a 1199px card at 1300).
- **On 2026-11-05**, with 3Y estimated from the local research copy because production's rows did not yet carry it: 44 companies (3Y known for 1,109 of 1,281). Thresholds tried: +50% and ±10% gives 101; +75% and ±5% gives 32; +100% and ±5% gives 23.
- **Seen on the first list:** flat on the year does not mean quiet all year. Almonty (−64% from its high) and Ubiquiti (−49%) rose and fell back within it. A cap on the distance from the 52-week high would keep only the ones that stayed level; not added, the owner's call.
- **Untested as a pattern.** The literature finds three-to-five-year winners giving some back over years (long-term reversal) and twelve-month strength persisting; at the one-to-two-month hold nothing here has been measured. A backtest belongs in `docs/research.md` before anyone reads more into it.
- **Checks:** `selloff-test.js` 85 (every edge, blanks, ETFs, the sheet). With the revenue and Declining tests removed, 3 fail.

## Column filters (2026-11-05)

The owner asked for column filters on `/ideas`. A second heading row holds a box under every column, pinned with the headings (its `top` is the first row's measured height, `--sw-h1`, below the nav). It uses the screener's grammar from `filters.js` (`Filters.compileNum` / `compileText`), so `>10b`, `-20..-5`, `=0`, `a|b` and `!word` mean what they mean on the screener. The word columns (Group, Sector, Quarters now, Guidance, Value vs industry, Growth & profit, Signal) are drop-downs of the values present on the tab.

- A filter reads what the cell shows, in the unit it shows. Guidance reads as its word, Reported as "Nov 3", and Tone 7D as its average. `FSPEC` in the page lists the exceptions; every other column filters its own number.
- A blank matches no filter. A row marked "Not on the screener" drops out once any filter is live.
- Filters persist across tabs and apply wherever their column appears. "Showing n of m" and Clear filters appear while any filter on the tab is live.
- A filter that isn't understood gets an amber border and is ignored.
- Typing repaints only the rows (`paintBody`), so the box keeps its focus. Sorting repaints the whole table and keeps each box's text.
- The Excel export ignores the filters and still carries every row.

Verified in headless Chrome over a real `/api/selloff` answer: 18 checks, covering number, dollar, range, text and drop-down filters, focus, the count, sort under a filter, Clear, a tab-only column, and blanks. Proved by reverting: a full repaint on each keystroke fails the focus check.
