# Stock Momentum Screener — POC

A minimal proof of concept. Organise tickers into **portfolios** (strategies) and view
current price, multi-timeframe % change, and trend/momentum signals. A stock can belong
to **multiple portfolios** (many-to-many). State lives in **Turso** (hosted libSQL/SQLite);
all persistence goes through `db.js`.

Data source: [Twelve Data](https://twelvedata.com). Each refresh makes **one batched
`/time_series` call** for the *union* of all portfolios (so a stock in several portfolios
is fetched once) and derives price plus every % / trend column from the daily closes.
Company names and sectors/fundamentals are fetched once and cached in the database,
so a normal refresh is just the single time_series call.

## Setup

1. **Get a free API key** at https://twelvedata.com/pricing (Basic / free plan).

2. **Add the key:** copy the example env file and paste your key in.
   ```powershell
   Copy-Item .env.example .env
   ```
   Then edit `.env` and set `TWELVE_DATA_API_KEY=...`

3. **Install dependencies:**
   ```powershell
   npm install
   ```

4. **Run:**
   ```powershell
   npm start
   ```

5. Open http://localhost:3000

## Using it

- **Portfolio tabs** — switch between portfolios; **All** shows every stock across
  every portfolio. Each row's *Portfolios* column shows colored badges for the
  portfolios it belongs to (so overlaps are visible at a glance).
- **New portfolio** — click the `＋` tab. **Rename** a portfolio by double-clicking its
  tab (or the *Rename* button when it's active); **Delete** via the button on the active
  tab. Deleting a portfolio leaves its stocks in any others they belong to.
- **Add ticker** — type a symbol, pick the target portfolio in the *to …* dropdown,
  and click *Add* (or press Enter). Add the same symbol to several portfolios to
  create overlaps.
- **Remove** — the `×` on a row removes it from the *active* portfolio; on the **All**
  tab it removes the stock from every portfolio.
- **Refresh** — click *↻ Refresh* to re-pull the latest prices/momentum.
- **As of (backtest)** — pick a past date in the date box to recompute the **Momentum
  ranking as it looked then**, plus **Forward** columns (+1M/+3M/+6M/Since) showing what
  happened *after* that date — so you can backtest whether the ranking was predictive.
  Fundamentals/Quality are hidden in backtest mode (they aren't point-in-time). A banner
  shows while active; "← Back to live" exits. Note: uses *today's* ticker list, so
  results carry survivorship bias.
- **Refresh All** — clears the cached sector / fundamentals / analyst data and re-pulls
  everything fresh from the API (fundamentals then backfill over the next few refreshes,
  rate-limit permitting). Prices/momentum are always fetched fresh on any refresh.
- **Export to Excel** — downloads the current view (active tab, current sort order,
  all columns as raw numbers) as a CSV file that opens directly in Excel.
- **Ticker link** — click a stock's **Symbol** to open it on Google Finance in a new
  tab. The exchange Google needs is derived from the data feed's MIC code
  (`XNGS`→NASDAQ, `XNYS`→NYSE, `XKRX`→KRX, etc.). A few ETFs that Google reclassifies
  to Cboe/`BATS` may land on a "couldn't find" page with a one-click suggestion.
- **Sort** — click any column header (defaults to Buy Rating, descending).
- **Collapse/expand column groups** — columns are organised into groups (Info,
  Short-term %, Long-term %, Relative & Trend, Fundamentals). Click a group header,
  or the chips above the table, to hide/show that group's columns (Excel-style).

## Columns

| Column | Meaning |
| --- | --- |
| Overall | 1–10 blend: 65% Momentum + 35% Quality (Momentum-only when no company data). Green ≥8, amber 5–7, red ≤4 |
| Mom. | 1–10 Momentum score — price/trend/volume only |
| Qual. | 1–10 Quality score — company data only (`—` for ETFs/no fundamentals) |
| Rank | Position by Overall within the stocks currently shown (e.g. `3/8`) |
| Sector | Industry sector (via `/profile`, cached). ETFs may show `—` |
| Today / Yesterday % | Single-day return for the latest / prior trading day |
| 1W / 2W / 1M / 3M / 6M / 1Y % | Return over ~5, 10, 21, 63, 126, 252 trading days |
| RS vs S&P | 3-month return minus the S&P 500's (SPY). Positive = outperforming the market |
| % from 52W High | Distance below the 52-week high (0 = at the high) |
| RSI | 14-day Relative Strength Index; >70 overbought (red), <30 oversold (green) |
| vs 50D MA / vs 200D MA | Price relative to its 50- / 200-day moving average (trend filter) |
| MA Cross | 50/200-day cross: **Golden** (50 above 200) or **Death**, flagged with days-since when the cross is recent (≤20d); otherwise Bullish/Bearish. Hover for the MA values |
| MACD | MACD histogram (12/26/9) = MACD line − signal; green = bullish momentum. Hover for the line/signal |
| Vol Trend | 5-day avg volume vs 20-day avg; green = volume expanding (conviction) |
| Market Cap | Market capitalization — **needs Pro+ plan** (see below) |
| Next Earn | Next earnings date — **estimated** (~91 days after last report; Twelve Data has no confirmed forward date). Amber if within 7 days. Hover for last report date + EPS surprise % (both exact, via `/earnings`) |
| Earn Grth | Quarterly earnings growth YoY — **needs Pro+ plan** |
| Fwd P/E | Forward price/earnings ratio — **needs Pro+ plan** |
| PEG | P/E relative to growth; <1 cheap (green), >2 expensive (red) — **needs Pro+ plan** |
| Short % Fl | Short interest as % of float (from `/statistics`); amber ≥10%, red ≥20%. Also feeds the Momentum score as squeeze potential |

The price and all % / trend columns come from a single daily-close series per refresh
(SPY is fetched in the same batch as the benchmark for RS; it is not added to your list).
Market cap, Fwd P/E, PEG and earnings growth are **fundamental guardrails** (not
momentum signals) that help separate durable momentum from fragile momentum.
Symbols without enough history (e.g. recently listed) show `—` for the longer-window
columns.

## Ratings (1–10): Momentum, Quality, Overall

Two independent scores plus a blend — transparent, **not** investment advice. Each input
maps to a 0–1 sub-score via fixed thresholds; missing inputs drop out and the remaining
weights are renormalized.

- **Momentum** — price/trend/volume only: 6M/3M/1Y returns, RS vs S&P, vs 50/200D MA,
  MA cross, MACD, Vol trend, and RSI timing (RSI peaks ~55–70, penalized when overbought
  > 75). Needs ~3 months of history, else `—`.
- **Quality** — company data only: earnings growth, revenue growth, PEG, forward P/E,
  profit margin, ROE. `—` when there's no fundamental data (e.g. ETFs).
- **Overall** — `0.65 × Momentum + 0.35 × Quality` (falls back to Momentum-only when
  Quality is unavailable).

Reading the two together is the point: **high Momentum + high Quality** = durable
leaders; **high Momentum + low Quality** = hype/risk; **low Momentum + high Quality** =
value/early. **Rank** ranks by Overall within whatever is currently displayed. **Hover any
rating** for its breakdown (Momentum/Quality show per-factor 0–100 sub-scores & weights;
Overall shows the Momentum/Quality split). Weights live in `computeScores()` in `server.js`.

## Publishing (read-only mode)

To put this on a public URL while keeping full control to yourself, set an
**`ADMIN_PASSWORD`** in `.env`. That flips on a two-tier model:

- **Public visitors** get a **read-only snapshot** — the last data *you* refreshed,
  served straight from the stored snapshot with **zero Twelve Data calls** (so visitors
  can't burn your API credits or rate-limit you). They can sort, collapse column
  groups, and export to Excel. Add/remove, Refresh, Refresh All and the backtest date
  picker are hidden.
- **You (admin)** click **🔒 Admin login**, enter the password, and all controls
  unlock. Clicking **↻ Refresh** (or **Refresh All**, or adding/removing a ticker)
  recomputes live from the API and **overwrites the snapshot** the public sees. So the
  public board updates only when you refresh — you decide when.

How it works: login checks the password server-side and sets a signed, httpOnly
cookie (30-day). Every mutating endpoint and every live/backtest pull is enforced on
the server (`requireAdmin` / `isAdmin`) — hiding the buttons is just cosmetic; the API
itself rejects unauthenticated writes with `403`. When `ADMIN_PASSWORD` is **unset**
(the default, for local dev) the app is fully open with no login. Deploy behind HTTPS
so the cookie is sent securely (the app already trusts `x-forwarded-proto`).

## Notes / limitations (POC)

- **Fundamental columns need a Pro+ plan.** Market cap, Fwd P/E, PEG and earnings
  growth come from Twelve Data's `/statistics` endpoint, which is only available on
  **Pro / Ultra / Enterprise** plans (on lower tiers it 403s for every symbol except
  the AAPL demo). They are therefore **off by default** — after upgrading, set
  `ENABLE_FUNDAMENTALS=true` in `.env`. **Sector** (`/profile`) works on standard paid
  plans. When enabled, fundamentals are cached per symbol and refreshed once a day.
- **Analyst columns were removed** — consensus/price targets need a Twelve Data
  **Ultra+** plan (they 403 on Pro for real tickers). The backend scaffolding still
  exists behind `ENABLE_ANALYST` if you ever upgrade, but the columns are off.
- **News is not available from Twelve Data** (no news endpoint). It would require a
  different provider (e.g. Finnhub offers free company news).
- **MA Cross / MACD / Vol Trend** are computed locally from the daily series (no extra
  API cost). MA Cross needs 200+ days of history, so thin-history names show `—`.
- **% changes** are computed from trading-day offsets (~21/63/126/252), a calendar
  approximation.
- **Rate limit (credits/minute):** a normal refresh ≈ 1 credit per ticker (one
  time_series call). Cold-start fundamentals backfill costs ~17 credits per new
  ticker (`/profile` ~9 + `/statistics` ~8), so it's capped to a couple per refresh
  (`MAX_PROFILE_FETCHES_PER_CALL`) and fills in over successive refreshes, then
  caches for a day. If you hit a rate-limit message, wait a minute and refresh.
- **Corporate network / SSL:** the `start` script uses `node --use-system-ca` so
  Node trusts the company root certificate used for HTTPS inspection. Without it
  you'd get `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.
- Persistence: Turso (hosted libSQL/SQLite), via `db.js`. Tables: `portfolios`,
  `portfolio_tickers`, `names`, `profiles`, `snapshot`, `visitors`. Set
  `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env` — and in the Vercel project's
  environment variables before deploying. `migrate-to-turso.js` seeds the database
  from the pre-migration JSON files if you ever need to re-seed.

See [PLAN.md](PLAN.md) for the full database-backed architecture.
