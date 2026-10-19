# The Long run group

**A screener group, `lrun`, between Fundamentals and Ownership: figures that take years of a company's own filings to measure.** Asked for on 2026-10-19 after the owner looked at Macrotrends' screener; the four pieces quoted that day and all four agreed: growth over several years, P/E against its own ten-year median, the dividend record, and financial health (interest coverage and the Piotroski F-score). The owner's choices: **net income, not EPS**, for growth; **no P/S** beside the P/E; **Piotroski yes**; on the **screener, the stock page and the promo cards**.

Phase 1 (this section) is growth. The rest is built on the filings re-read and is documented below as it lands.

## Growth over three and five years (phase 1)

- **Four figures**: revenue and net income growth a year, compounded, over three and five years. `revGrowth3y`, `revGrowth5y`, `niGrowth3y`, `niGrowth5y`, with `growthEnd` (the period the latest figure runs to) and `growthBasis` (`q` or `fy`) for the tooltips.
- **The arithmetic is `longrun.js`** (pure, the `margins.js` shape): the trailing four quarters now against the same four quarters three and five years earlier, `(now / then)^(1/years) - 1`. Calendar quarters by their middle (`EarnGrowth.quarterOf`), so a changed fiscal year end lines up.
- **Revenue and net income are separate.** A bank files no revenue line and still has net income growth; a company with a loss at either end has a revenue rate and no net income one.
- **Null, never zero, and never invented**:
  - from a loss there is no rate, **including a loss at both ends** (the ratio of two negatives is positive, so a loss doubling would otherwise read as +26% a year growth; the first revert proof missed this until the test planted it);
  - a missing quarter in either trailing year blanks that rate only;
  - the newest quarter more than 230 days old (stopped filing) blanks the company;
  - a negative revenue quarter (a reversal filed under the tag) blanks that revenue rate;
  - a rate past 1,000% a year is a base too small to measure from, and is blank.
- **A company filing in another currency is measured on its annual reports, in that currency.** The reader converts every period to dollars at that period's average rate (`toDollars`), so a growth rate between two converted years carries the currency's move; `own()` divides the stored rate back out. A derived quarter carries no rate, which is why the quarterly path is dollar filers only. JD reads in yuan, Spotify in euros. A dollar filer with no quarterly trailing year (annual reports only) takes the same annual path; the newest annual report must be under 460 days old and the year three or five back is matched on the date within 45 days.
- **ONE READ, NOT TWO.** `marginChangeBuild` (the daily check's filings pass) now reads 6.8 years instead of 2.7, and hands the margin change, capital returns and filings-quality builders exactly the 2.7 years they had, filtered in memory on `period_end`, which is the read's own condition. Measured on production the first day: **112,164 rows, 13 seconds**, for 1,242 companies with filings. A second read would have added ~50,000 rows a day for nothing.
- **Stored** as `app_meta` `long_run`: `{ at, g: { SYM: [rev3, rev5, ni3, ni5, end, basis] } }` (`readLongRun` / `writeLongRun`). Derived from `sec_facts`, so the next pass rebuilds it. Folded into the rows by `buildFlows` / `flowsOf` / `stampFlows` (`FLOWS_V` 9 → 10), so every read path that stamps flows carries it, the phone's saved posts included. **Not stamped on the snapshot.**
- **Coverage on the first day** (1,281 symbols): revenue 3Y 1,062, 5Y 1,019; net income 3Y 851, 5Y 793; 1,044 measured on quarters, 87 on annual reports.
- **Where it shows**: the four screener columns (signed, **uncoloured**: growth is not a price move), `FIELD_SPEC` rows `lrun|Revenue /yr 3Y` and so on (stock page, hover card, tiles, phone, `/compare`), the Bars and Scatter cards (`rg3`, `rg5`, `ng3`, `ng5`), and a drill-down on each cell to the revenue or net income history behind it.
- **The new group touched**: `index.html` (`GROUPS`, the colour, its light tint, the label, the banner, `PAD_SPAN` 119 → 123, the fund `naRun(4)`), `rowcard.js` (`GROUP_ORDER`, colours, labels), `mobile.html`, `mobile-setup.html`, `columns.html`, `app.css` (`--sand`, both themes) and `TILE_FIELD_RE` in server.js. Colour sand (`#d6c58b`, light `#6f6118`): the palette's free region, kept away from amber, which means "notice this".
- **Display only.** All 1,280 real rows score identical verdicts with each of the four fields absent, realistic and ±1e9; the same check on `vs200ma`, which the rules read, changes verdicts.

### Verified
- `longrun-test.js`, 29 checks. Every guard proved by reverting it: the positive base, the own-currency division, the quarter staleness, the 1,000% cap, the positive revenue quarter, the annual date match and the annual staleness.
- The screener rendered in headless Chrome from a static host with a 1,280-row fixture: 123 header columns, 123 cells on every row, every cell's group class equal to its header's. Dropping one growth cell made 30 of 31 rows fail the check (NI 5Y showed a share count), so it can fail.
