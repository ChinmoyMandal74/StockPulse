# Stock Momentum Screener — Build Plan

A Node.js website to track a universe of stock tickers and surface **momentum**:
company profile, market cap, and multi-timeframe percentage returns.

## Goal

For every tracked stock, show:

1. Company Name
2. Sector
3. Market Cap
4. % Change today
5. 1-Month % change
6. 3-Month % change

Plus additional momentum-relevant data points (see below).

## Data source decision

**Twelve Data** (chosen).

- Free tier: ~**8 requests/minute**, ~**800 requests/day**.
- Provides both a live `quote` endpoint AND free `time_series` daily historical prices.
- Single official provider with an API key (no unofficial/scraping risk).

> **Note on Google Finance:** there is no usable public Google Finance API
> (deprecated in 2012; only `GOOGLEFINANCE()` inside Google Sheets survives).
>
> **Note on Finnhub:** free tier gives Name, Sector (`finnhubIndustry`),
> Market Cap, and today's % — but historical candles are **premium (403 on free)**,
> so 1M/3M returns can't be computed on Finnhub's free tier. That's why we chose
> Twelve Data.

## Scale

**100+ tickers** — screening a broad universe. Requires batching, background jobs,
and a stored price database (not on-demand API calls).

## Key architectural insight

Historical prices don't change intraday, so:

- **1M / 3M / 6M / MAs / RSI / 52-week** → computed from *daily* history refreshed
  **once per day** (after market close). ~100 calls/day for 100 tickers → under 800/day.
- **Today's price + % change** → the only thing needing frequent intraday refresh.

**Principle:** the frontend never calls Twelve Data. It reads pre-computed rows from
the database. Background jobs populate the DB on a schedule.

> ⚠️ Free-tier caveat: refreshing live quotes for 100+ tickers every few minutes
> strains the 800/day limit. Options: refresh quotes ~every 15 min, batch symbols
> per request, or move to a paid Twelve Data plan for frequent intraday updates.
> The **daily momentum numbers stay free** regardless.

## Architecture

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Frontend   │◄───►│   Node/Express API   │◄───►│   SQLite    │
│ (screener   │     │  /api/stocks (reads  │     │  (history + │
│  table)     │     │   from DB, not API)  │     │  metrics)   │
└─────────────┘     └──────────┬───────────┘     └──────▲──────┘
                               │                        │
                    ┌──────────▼───────────┐            │
                    │  Background jobs      │────────────┘
                    │  • Daily history sync │
                    │  • Intraday quotes    │──► Twelve Data API
                    │  • Metric computation │    (rate-limited queue)
                    └───────────────────────┘
```

## Data model (SQLite)

- **`tickers`** — the universe (symbol, added date)
- **`profiles`** — name, sector, market cap (refresh weekly; changes rarely)
- **`daily_prices`** — symbol, date, close (raw history; drives all momentum math)
- **`metrics`** — computed snapshot per symbol: today %, 1M/3M/6M/YTD %,
  52-wk high/low & % from high, 50/200-day MA, RSI, relative strength vs SPY,
  last-updated. **This is what the API serves.**

## Additional momentum data points

- 6-month & YTD % change
- % from 52-week high (and 52-wk high/low)
- Price vs 50-day & 200-day moving average
- 50/200-day crossover (golden cross / death cross)
- RSI (14-day) — overbought/oversold
- Relative volume (today vs average)
- Relative strength vs S&P 500 (stock return minus index return)
- Beta

All computable from a stored daily price history series.

## Background jobs

1. **Daily history sync** (~30 min after US close): pull latest daily candles per
   ticker, upsert into `daily_prices`.
2. **Metric computation** (right after sync): recompute `metrics` from stored
   history. Pure local math — zero API calls.
3. **Intraday quote refresh** (~every 15 min during market hours): update today's
   price/% only, batched, through a rate-limited queue.
4. **Profile refresh** (weekly): name/sector/market cap.

A **throttled request queue** (respecting 8 req/min + a daily budget counter) sits
in front of every Twelve Data call so no job can exceed limits.

## API endpoints

- `GET /api/stocks` — full screener table (sortable/filterable server-side)
- `POST /api/tickers` / `DELETE /api/tickers/:symbol` — manage the universe
- `GET /api/stocks/:symbol` — detail view (optional, later)

## Frontend

A **sortable, filterable table**:

- Columns: Name, Sector, Market Cap, Today %, 1M %, 3M % (+ extras)
- Sort by any momentum column (find strongest movers)
- Filters: sector, market-cap range, "% change above X"
- Color coding: green/red on % columns, highlight new 52-wk highs
- "Last updated" timestamp for data freshness

## Build phases

1. **Data layer** — SQLite, schema, Twelve Data client with throttled queue
2. **History + metrics** — daily sync job + metric computation (the heart of it)
3. **API** — `/api/stocks` reading from DB
4. **Frontend** — screener table with sort/filter
5. **Intraday + scheduling** — quote refresh, cron scheduling, ticker management UI
6. **Polish** — extra columns, error/stale-data handling, market-hours awareness

## Suggested stack

- **Backend:** Node + Express
- **DB:** SQLite via `better-sqlite3` (zero-config; swap to Postgres only if outgrown)
- **Scheduling:** `node-cron`
- **Data:** Twelve Data via `axios`, wrapped in a rate-limited queue
- **Frontend:** React + Vite (or plain HTML/JS for minimal)
- **Config:** `.env` for the API key (`dotenv`)

## Open questions to resolve before building

1. **Initial ticker list source** — manual entry, CSV import, or a preset universe
   (e.g. S&P 500)?
2. **Sector taxonomy** — true GICS 11 sectors, or Twelve Data's own labels fine?

## References

- Twelve Data API docs: https://twelvedata.com/docs
- Finnhub Company Profile2: https://finnhub.io/docs/api/company-profile2
- Finnhub free-tier candle limitation: https://github.com/finnhubio/Finnhub-API/issues/546
