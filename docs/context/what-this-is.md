## What this is
A stock screener. Every symbol in the universe is measured the same way after every close — returns, trend, relative and volume readings, company fundamentals, and a mechanical Advice verdict that names the one rule that fired. State lives in **Turso** (hosted libSQL/SQLite). Price data comes from the Twelve Data API. The owner (admin) manages portfolios and refreshes data; the public sees a read-only cached snapshot.

The repo/folder is `StockPulse`; the app is branded **Tickr Lab** in the UI (`<title>` and the bar wordmark).

**93 symbols**, 14 of which are deliberate ballast — see **The universe, and the ballast that has been draining out of it**. **Read that section before trusting any number in this file**: the universe was 116 with 33 laggards until 2026-09-10, most measurements here were taken on that universe, and shrinking it moved them. Before designing any backtest, read **Does any of this predict anything? — the research log**: eleven framings have been tested and ten came back flat, and it records what is ruled out so the next attempt is a new one.

