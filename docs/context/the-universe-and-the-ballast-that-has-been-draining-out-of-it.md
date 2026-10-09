## The universe, and the ballast that has been draining out of it
**Every row count and symbol count in this file is a snapshot, and the universe is edited by hand.** Check against the database before relying on one: `node --use-system-ca analysis-db.js --stats`. The three derived files (`private/single-closes.json`, `private/strategy-*.json`, `private/lab-grid.json`) are built from a **local** copy, and `analysis-db.js` without `--full` syncs forward only — **it does not drop symbols that were purged upstream**, so after any ticker removal the rebuild sequence is `analysis-db.js --full`, then `single-data.js`, `strategy-runs.js`, `lab-grid.js`. Skipping the `--full` silently keeps dead tickers in every one of them.

**93 symbols, of which 14 sit in a portfolio called `Faded`** — BA, DIS, EL, ERIC, GE, HPQ, IBM, KSS, LUMN, PFE, PTON, SBUX, VFC, ZM. They are **deliberate ballast, not picks.**

> **It was 33 until 2026-09-10, and losing 19 of them measurably re-introduced the bias they exist to counter.** Removed entirely from the universe: T, VZ, WBD, NOK, XRX, CVS, TGT, DG, GPS, M, BBY, NKE, HAS, MMM, F, BMY, VTRS, PYPL, KHC. Measured before and after, on the same code:
>
> | | 116 symbols, 33 faders | 93 symbols, 14 faders |
> |---|---|---|
> | buy-and-hold CAGR | +18.6% | **+21.8%** |
> | buy-and-hold Sharpe | 0.95 | **1.03** |
> | best velocity \|t\| on the lab grid | 1.73 | **2.76** |
> | best RSI \|t\| on the lab grid | 1.76 | **2.73** |
>
> Nothing was discovered between those two columns. The indicators did not get better; the pool got easier. A t of 2.8 across 144 tests still is not a finding, but it is close enough to the conventional bar to be tempting, and that is exactly the trap the ballast was added to prevent. **If a result improves after the universe shrinks, suspect the universe.** Re-adding laggards is the cheapest way to sanity-check any new result — bars cost one credit per symbol at any depth.

Every backtest before they existed ran on 83 stocks chosen *because they are worth following in 2026*, so the whole archive was conditioned on having survived to that date — visible as a **+1.02% per fortnight baseline, about 30% a year**, which no universe returns. A ranking test needs losers in the pool or it only measures the selection.

- **29 of the original 33 had pre-2010 history**, which was the selection criterion that mattered: the pre-2020 window is where every result vanished, and a 2021 IPO cannot de-bias it. Candidates were validated against the API *before* being added — a dead symbol would sit in a portfolio erroring forever. WBA was rejected that way (taken private).
- **This is survivorship-*lite*, and it is now thinner than it was.** Every fader still trades. Companies that went bankrupt or were acquired are still absent, and those are the tail that matters most. Treat it as a large reduction in the bias, not its removal.
- **The 119 ceiling fell on 2026-09-13** — the price fetch is chunked (≤120 symbols per `time_series` call, SPY in the first chunk), so the batch cap no longer binds. The practical ceiling is now **~300 symbols** (the owner's stated target: 200–300), set by the refresh economics below and, further out, the single-payload/single-prompt architecture (chat measured viable to ~700). The growth caveat stands: **add losers as the universe grows** or every backtest number quietly improves for the wrong reason.
- **They cost the screener something**, and that was accepted: the All tab grew and a Refresh all needs more rounds (`MAX_ROUNDS=25` covers up to the API ceiling). Filter to a portfolio to get a smaller view back.
- **What adding them proved.** `from_high` had looked like the one factor with a consistent sign across the whole archive (1m long-short t −2.2 pre-2020). On the broadened universe it **fell to t −1.4 and lost half its magnitude** — it was universe-dependent, exactly the kind of result the hold-out discipline exists to catch. Meanwhile the post-2020 continuation effect *survived* de-biasing almost intact (the 12-month-minus-1 return, top-decile t 3.3 before and after), which makes it more likely a regime than pure selection. The pre-2020 window stayed flat for everything (best t 0.9). Nothing yet clears a bar worth trading.

