# Sector, Industry and Theme lines (promo templates `seclines`, `indlines`, `thmlines`, 2026-10-20)

The owner, over the Lines card (Compare → Lines — any measure, five largest companies on share price): "Can I get this visual under sector where every line reprsents one sector, I should be able to plot this against these same measures, Ideally it will be good to have option to multi-select sectors, The same should be under the Industry template as well".

## What they are
The Lines card's measures (share price, volatility, revenue, gross profit, operating income, net income, free cash flow, the four margins, revenue growth, market value, P/E, P/S), its windows and its drawing (`linesCore`), with **one line a sector or industry**. Under Sector and under Industry, each as **Lines — any measure**.
- **Picking:** up to eight groups, ticked in a list (`glnPick` / `ilnPick`, `|`-joined, so a saved post keeps the picks). The list has Five largest, All (sectors) and Clear buttons. Industries can be narrowed by sector and searched; ticked ones stay listed. The five largest by market value are ticked when nothing is. At eight, the rest are disabled.
- Funds are never members. Lenders are left out of gross profit and gross margin (as on the Lines card), and the note says so. A group needs three companies with figures to draw.

## How a group is one number (`grouplines.js`, pure; `grouplines-test.js`)
- **Flows and value** (revenue, gross profit, operating income, net income, free cash flow, market value): the **sum** over the group's companies. Stored filings are dollars only, so currencies are never added.
- **Margins:** summed numerator over summed revenue, never an average of margins.
- **P/E and P/S:** summed market value over summed net income or revenue. No P/E where the summed income is not positive.
- **Revenue growth:** summed revenue against the same companies' revenue a year earlier.
- **The same companies in every quarter drawn:** a company that starts or stops filing part-way would move a sum by its whole size. The note gives the coverage ("Built from 590 of the 837 companies in the sectors shown").
- **Share price: the median company's return since the window's start**, daily or quarterly. This was measured before choosing, over ten years on the live data:

  | Sector | Buy-and-hold average | Median | Geometric | Compounded quarterly average |
  |---|---|---|---|---|
  | Technology | +2,065% | +347% | +363% | +1,437% |
  | Energy | +323% | +90% | +123% | +1,221% |

  The averages are led by a few winners, or pumped by volatile small members. The median reads what the typical company did. (The sector spotlight's own daily line is an equal-weight average; this card's windows go to ten years, where that misleads.)
- **Volatility:** the median of the members' own 30-day volatility (the typical company's swings), not the volatility of an average.

## Where the data comes from
- **Daily windows** (share price up to a year, volatility): drawn in the card from the studio's whole-screen basket (`basketDays` answers for both templates through `lineBasketDays(opts, prefix)`).
- **Filed measures and the price over years:** `GET /api/group-lines?dim=&names=&nq=&m=` (members; at most eight names; daily measures refused), `groupLinesFor` in `server.js`. It reads each member's stored quarterly series by primary key and combines them with `GroupLines.aggregate`. The quarters drawn end at the newest quarter end most members hold, so a member rebuilt before the quarter rolled over cannot pull the end back; it is left out until rebuilt. Kept ten minutes.
- **`line_series`** (one row a company: trailing-year revenue, gross profit, operating income, net income, free cash flow, quarterly market value and the quarter-end close, at 41 quarter ends) is written by the **Long run slice**, which now runs `trendSeries` in full mode and stores what it built. It is in `SYMBOL_TABLES`. So each company is refreshed about weekly, at no extra read of its filings. First fill, 2026-10-20: seven calls of `POST /api/long-run/slice?limit=200`, about two minutes, 1,257 companies.
- **The phone** (`/api/m/post`): `Cards.groupLinesNeed(tpl, ctx)` does one dry build to learn what the card asks (the default picks depend on the rows), then `groupLinesFor`.
- The group note also says when points sit above the scale's ceiling (the ordinary Lines card's measure note already does).

## Tested
- `grouplines-test.js` (21 checks): sums with a late filer left out of a window it does not cover and in where it does; losses summed; margins, P/E (and none when earnings are not positive), P/S; growth with and without a year before; the median price (one hundred-bagger not leading, a missing close carried); too few companies; quarters matched by date. The same-companies rule was proven by loosening it (7 failures).
- `/api/group-lines` on the real server with an in-memory database (11 checks): sums, the fund left out, lenders out of gross margin, an industry, unknown names, bad parameters, the eight-name cap, a member a quarter behind.
- Both cards in the studio over the live `line_series` (through the lifted `groupLinesFor`, reads only) and a whole-screen basket from the analysis copy (11 checks): default picks stored, ticking to seven and eight, the cap, volatility, revenue, profit margin, P/E and price over ten years, gross margin's lender note, industries by sector filter and search. Drawn at 4:5, and the company Lines card re-checked unchanged.

## Theme lines (`thmlines`, the same day)
The owner: "Go ahead with themes as well". Under Theme, **Lines — any measure**, controls `tlnMetric`, `tlnWin`, `tlnPick`. A theme is one of the site's own hand-made lists. A company may be in several and **counts in each** (Mag 7 and Hyperscalers share members). Funds in a theme are never members.
- **Membership:** the card reads it from the rows' `portfolios` field, which the screener stamps when it serves (`finishServe`). The server reads the themes table itself (`readPortfolios`), because the stored snapshot has no membership on it; it is asked as `dim=theme`.
- **The list:** 22 of the 27 themes are offered on 2026-10-20. The others have fewer than three companies, or only funds (Benchmarks, ETFs). The defaults are the five largest by market value: Mag 7, Hyperscalers, Space, Memory, and Cloud Infra, Hardware and Networking.
- **Tested:** the route on an in-memory database (two more checks: a theme's sum with its fund left out, a company in two themes counting in both), and the studio over the live tables (three more: the list, the share price drawn, revenue from the server).

## The index cut (2026-10-20, all three)
The owner: "All the 3 news cards, I shoukd still be able to filter index membership, I am more interested in s&p only".

- An **Index** picker on Sector, Industry and Theme lines (`glnSp500`, `ilnSp500`, `tlnSp500`), with the Cards module's cuts (All stocks, S&P 500, Nasdaq 100, either, Nasdaq 100 not S&P, neither). **It opens on the S&P 500**, and a saved post without the key reads as the S&P 500 too (`glnCut`).
- **Every part is cut:** the list of groups to tick (counts and the five largest are within the cut, `Cards.groupNames(dim, rows, cut)`), the daily lines (members through `spFilter`), and the server's filed lines (`cut=` on `/api/group-lines`; `glCutTest` strikes it on the two funds' holdings files, the same as the screener's flags). A cut that asserts membership or absence finds no members when the file it needs is missing: unknown is never "in".
- The kicker reads "S&P 500 · Sectors · 5 shown", and the note "…companies in the sectors shown that are in the S&P 500".
- **Fixed with it:** the tick list's labels had taken the side panel's uppercase heading style, and its three buttons stretched to full width (seen in the owner's screenshot). They are scoped back to names and side-by-side buttons.
- **Tested:**
  - The route on an in-memory database (16 checks): the S&P cut with a seeded holdings file, no Nasdaq 100 file meaning no members, an unknown cut read as All. Proven by removing the cut (2 failures).
  - The studio over the live tables with the real index files, 503 and 101 holdings (18 checks): the default kicker and note, All stocks dropping the prefix and raising the counts, the label and button styling measured, every filed request asking for the S&P 500, and Theme lines within it (18 themes have enough S&P 500 members).

## Bars, any measure, for a sector, industry or theme (2026-10-21, owner: "Can you add the bars any measure to Industry, Sector and Theme level like how you added the Lines any measure")
- Templates `secbars`, `indbars`, `thmbars` ("Bars — any measure" in each group, after Lines), `tplGroupBars` in cards.js. **The Bars card's whole catalogue** (`BAR_METRICS`, 68 measures; the group Ranking offers twelve), a bar a group, drawn by the shared `barDraw`.
- **A group's figure is its middle company**: the median of its companies' readings, after every guard the Bars card applies to a row (funds out; `co` rows not in dollars; `noFin` lenders; `coh` rows whose figures disagree; `pos` losses), with at least `IND_MIN` (3) readings. The small figure is how many readings stand behind the bar. Left-out counts in the note; themes overlap and the note says so.
- Controls: measure (grouped as on Bars), order, how many (5/10/15, capped by shape as Bars), Index (`SP_CUTS`, the S&P 500 by default); the Industry card also a sector filter (`igbSector`). Prefixes `sgb`, `igb`, `tgb`.
- Tested in the studio over the live snapshot, index file and themes: the top sector, industry and theme's median and reading count recomputed from the rows; both orders; forward P/E leaving losses out before the median; gross margin drawing no Financial Services bar; the sector filter; every shape with fifteen asked; the Node host drawing the same bars.
