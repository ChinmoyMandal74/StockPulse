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

## Theme lines (, the same day)
The owner: "Go ahead with themes as well". Under Theme, **Lines — any measure**, controls . A theme is one of the site's own hand-made lists. A company may be in several and **counts in each** (Mag 7 and Hyperscalers share members). Funds in a theme are never members.
- **Membership:** the card reads it from the rows'  field, which the screener stamps when it serves (). The server reads the themes table itself (), because the stored snapshot has no membership on it; it is asked as .
- **The list:** 22 of the 27 themes are offered on 2026-10-20. The others have fewer than three companies, or only funds (Benchmarks, ETFs). The defaults are the five largest by market value: Mag 7, Hyperscalers, Space, Memory, and Cloud Infra, Hardware and Networking.
- **Tested:** the route on an in-memory database (two more checks: a theme's sum with its fund left out, a company in two themes counting in both), and the studio over the live tables (three more: the list, the share price drawn, revenue from the server).
