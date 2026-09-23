# Tickr Lab

A nightly stock screener. It tracks a universe of US-listed symbols and, after every
close, measures each one the same way: multi-timeframe returns, trend state against the
50- and 200-day averages, relative and volume readings, company fundamentals, and a
mechanical **Advice** verdict that always names the one rule that fired.

It is **descriptive rather than predictive**, deliberately — a consistent way to see
where every stock stands and how it got there. It gives no investment advice.

Live at **[tickrlab.com](https://www.tickrlab.com)**. The repo folder is `StockPulse`;
the product is branded Tickr Lab.

## Running it

```
npm install
node --use-system-ca server.js          # or: npm start
```

Port 3000. Needs a `.env` with `TWELVE_DATA_API_KEY`, `TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN` and `ADMIN_PASSWORD`.

- `--use-system-ca` is not optional behind a corporate proxy — without it Node fails
  with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.
- **The local server talks to the PRODUCTION database.** Never test by mutating data.
- Starting it calls `ensureProfiles()`, which re-pulls stale profiles and burns API
  credits. To look at frontend changes only, serve `public/` with a static server.

## The shape of it

| | |
|---|---|
| `server.js` | Express — every API route, auth, and the nightly computation |
| `db.js` | Turso (hosted libSQL/SQLite). Every read and write goes through here |
| `private/` | Every gated page and shared module — served by Express, behind the gate |
| `public/` | `login.html`, `app.css`, the favicon — served by Vercel's CDN, unprotected |
| `private/action.js` | The Advice rules, shared by the server and the browser |
| `barmath.js` | Indicators from a bar series and nothing else — RSI, realised volatility |

No build step: vanilla JS, plain CSS, one shared stylesheet in `public/app.css`.

**Nothing in `public/` can be protected** — Vercel's CDN answers it before the function
runs. Anything needing a session lives in `private/`.

## Deploying

**`git push` to `main`, and nothing else.** Deploys made with the `vercel` CLI have
replaced production with foreign code before. Verify afterwards, including
`GET /api/health`.

## Where the real documentation is

**[CLAUDE.md](CLAUDE.md)** is the working reference and is kept current: the data model,
the refresh budget and its measured credit costs, the auth model, the research log of
what has been tested and come back flat, and a long list of things that will bite you.
Read it before changing anything here.

- [docs/backlog.md](docs/backlog.md) — work identified and deliberately not
  done, with what is already measured about each
- [docs/momentum-scoring.md](docs/momentum-scoring.md) — the price-strength score and the
  Overall composite, removed 2026-09-23, and why
- [docs/momentum-delta.md](docs/momentum-delta.md) — the score's history and delta,
  retired 2026-09-15 after five framings came back flat
