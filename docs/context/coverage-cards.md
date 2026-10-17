# Coverage: what the site tracks, as cards (2026-10-13)

The owner asked whether any promo visualisation talks about the coverage of the universe, "number of companies by size for example". None did. Then: "Create a new group called Coverage, no need to hide it from users, it's more transparency".

## What it is

A seventh entry in the studio's Template list, **Coverage**, with three views from one builder, `coverageCard(tpl)` in `cards.js`:

- `covsize`, "By size": a row a size band in the ladder's order, with what the band means.
- `covsector`, "By sector": a row a sector, most companies first, with how many industries it holds.
- `covindex`, "By index": in the S&P 500, in the Nasdaq 100, in both, in neither, and membership not known.

Each row: a bar scaled to the largest count, the count, its share of the companies, and their combined market value. Four figures above: companies, funds, combined value, sectors and industries. No controls, so no control box.

## Rules that must hold

- **Computed from the rows when the card is drawn.** The universe is hand-edited and every count written down anywhere is a snapshot; nothing here is a stored number.
- **It makes no claim to be complete.** The note says these are counts of what is covered, not a claim to cover everything, and that the list is chosen by hand and changes. No "all of" anything, and no denominator for an index: "499 in the S&P 500" is what is on the screen, not "499 of 503".
- **Funds are counted apart** (`isFundRow`): no band, no sector, and no membership of an index they track.
- **A company with nothing on file for the cut has its own row** (no market value, no sector, membership not known), with a muted bar. It is neither put in a band nor dropped from the count.
- **Index membership is three-state.** Unknown is not "in neither". The first two index rows overlap, and the note says the rows do not add up.
- **Visible to members.** It is its own group, deliberately not in Brand, which member mode hides.

## The universe on the day

1,256 companies and 24 funds, $92.41T combined, 11 sectors and 138 industries. By size: Mega 74, Large 215, Mid-Large 509, Mid 390, Small 55, Micro 12, one with no market value. S&P 500 members 499, Nasdaq 100 members 99, in both 84, in neither 742.

Tests: a scratchpad suite, 24 checks, including all three cards built from the real screen. Not rendered in a browser by the build.

## What we collect (2026-10-17)
The owner: "I don't think there is any promotional visual on the various data points the app currently collects and has history of and how frequently they are refreshed". A fourth view, `covdata` (`coverageData()`), from a fixed list `COV_DATA` in `cards.js`: each data set as a bar on one time axis (1998 to today) from its earliest stored day, with the source, "stored since" and how often it is refreshed. A short bar is where the site began recording a source that cannot be backfilled, and the note says so; "latest only" is a data set with no history (the profile). The 1:1 card keeps the nine rows marked `sq`. Accent-2 bars (not green, which is price). `FILL_TPLS` includes it (rows grow).

**The list restates facts and has to move with them.** Where each row's figures come from:

| Row | From | Refreshed | Source of the figures |
|---|---|---|---|
| Daily prices | 1998-12-23 (longest listed) | intraday every 30 min, settled nightly | `bar-archive.md`, `intraday-task.ps1` |
| Weekly trend readings (`tech_history`) | 2001-03-21 | weekly mark on Refresh all | `the-trend-only-backtest.md` |
| Financial statements (`sec_facts`) | 2007 for long-listed | SEC rotation, each company about weekly | `sec-edgar.md` |
| Short interest | 2017-12-29 | nightly, new settlement twice a month | `sec-edgar.md` |
| Earnings, reported | median company to 2020-05 ("typically") | profile rotation, 7 days | `earnings-history-on-the-stock-page.md` |
| 13F | Q2 2024 (backfill) | quarterly | `institutional-holdings-13f.md` |
| Insider trades | 2024 Q3 (`insider_state`, read 2026-10-17: 2024q3 to 2026q3) | nightly daily index | `sec-edgar.md` |
| 13D/13G | December 2024 (structured forms) | SEC rotation | `large-holder-filings.md` |
| 8-K | about 2025-09 (400-day first fill on 2026-10-11) | SEC rotation | `8k-events.md` |
| N-PORT | 2026q2 set | quarterly | `fund-holders-nport.md` |
| Fundamentals, day by day | 2026-08-30 | each Refresh all | `fundamentals-history.md` |
| Days each Signal has held | 2026-09-17 | each Refresh all | `the-advice-column.md` |
| Headlines | 2026-09-22 | news job 09:00, 13:00, 17:00 daily | `news.md`, `news-task.ps1` |
| Index membership | 2026-10-03 (SPY) | nightly | `sec-edgar.md` |
| Options open interest | 2026-10-09 close | nightly, 19:30 run | `options-open-interest.md` |
| Company profile and ratios | latest only | 7-day rotation | `server.js` `FUND_ROTATION_DAYS` |

Left off on purpose: splits (depth undocumented), drawdowns, margins, capital returns, group months and index P/E (worked out from the above, not collected), euro rates, the Nasdaq listing.

## What we measure (2026-10-17)
The owner, over two quantfinance.ai explainer grids ("20 quant trading strategies", "15 must-know quant concepts"), asked whether any applied; of the offer of "12 readings we take on every stock": "Can you build the first one .. where will it appear". A fifth Coverage view, `covread` (`tplReadings`): the explainer grid with the site's own readings instead of strategies it does not run. Twelve tiles (nine at 1:1, `RD_SQ`), each a field the screener computes for every company, with a small chart, the value and one line of definition, all drawn from one stock (`covSym`, NVDA by default; a year of closes plus 200 before it through getHistory, `readingsNeed`, asked by `/api/m/post` with the other single-stock reads): trend (price and its 200-day average, computed on the card from the same closes), returns (six windows), the year's range, against the S&P 500 (`relStrength`: three months less SPY's), RSI 14, volatility (`realisedVol`, with the last 60 daily moves as bars), short interest (a 0 to 25% gauge, days to cover), valuation, margins, growth, ownership, and the Signal **with the rule that fired** (`actionFlag`, the word through `ActionRules.canon`).
House rules kept: RSI and the range are measures, never "overbought"; green and red only for moves; a loss shows no multiple; the note says none of these alone has predicted the next month in the site's tests. **The definitions restate the code** (`vs200ma`, `relStrength`, `realisedVol` over 126 sessions, `shortPctFloat`, `shortRatio`): change a tile when its field changes.
**Stuck on "Reading prices" (fixed the same day).** The owner, on CoreWeave in production: "The trend is stuck". The studio repainted on a `/api/history` reply only for a hardcoded list (`chart`, `drawdown`, `bands`), the trap the basket channel's comment already names; What we measure and the Showcase phone were not on it, so their Trend and Volatility tiles waited for ever unless something else redrew the card. Now `Cards.historyNeed(tpl, opts)` (drawdown, bands, showcase, covread) is the one list, asked by the studio's repaint and by `/api/m/post`. Proved by revert in real time (DevTools, the history reply held 4s): reverted, "2 waiting, 0 lines"; fixed, "0 waiting, 2 lines". The headless screenshot harness could not show it: something else repaints there.
