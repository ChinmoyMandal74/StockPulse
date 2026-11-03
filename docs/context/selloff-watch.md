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
