# StockPulse — Claude Code Context

## What this is
A stock momentum screener POC. No database — all state lives in flat JSON files. Price data comes from the Twelve Data API. The owner (admin) manages portfolios and refreshes data; the public sees a read-only cached snapshot.

## Running the app
```
node --use-system-ca server.js
```
Runs on port 3000. Requires `.env` with `TWELVE_DATA_API_KEY` and `ADMIN_PASSWORD`.

## Key files
| File | Purpose |
|---|---|
| `server.js` | Express backend — all API routes, auth, data computation |
| `public/index.html` | Single-page frontend (no build step, vanilla JS) |
| `public/visitors.html` | Admin-only visitor log page at `/visitors` |
| `portfolios.json` | Portfolio → symbol membership (many-to-many) |
| `snapshot.json` | Last computed screener data served to the public |
| `profiles.json` | Cached sector/fundamentals per symbol (refreshed daily) |
| `names.json` | Cached company names (fetched once on add) |
| `visitors.log` | JSON Lines file — one entry per page load |
| `.env` | `TWELVE_DATA_API_KEY`, `ADMIN_PASSWORD`, optional feature flags |

## Auth model
- `ADMIN_PASSWORD` unset → fully open (local dev, everyone is admin)
- `ADMIN_PASSWORD` set → public sees read-only snapshot; admin logs in via "🔒 Admin login" button (cookie-based, 30-day session)
- Auth is checked via `isAdmin(req)` / `requireAdmin` middleware in server.js
- Admin cookie is an HMAC of the password — no separate secret needed

## Feature flags in .env
- `ENABLE_FUNDAMENTALS=true` — requires Twelve Data Pro+ plan
- `ENABLE_ANALYST=true` — requires Twelve Data Ultra+ plan

## Visitor logging
- Every `GET /` is appended to `visitors.log` (JSON Lines, one object per line)
- Fields: `ts`, `ip`, `ua` (user-agent), `ref` (referrer)
- Admin-only endpoint: `GET /api/visitors` — returns summary + last 500 entries
- Admin-only page: `/visitors` — dark-themed table UI

## Column groups (frontend)
Each column group has a fixed color used for both the header `th` and the toggle chips:
- Info: blue `#388bfd` · Short-term: green `#2ea043` · Long-term: purple `#a371f7`
- Forward: orange `#f0883e` · Relative: teal `#39c5cf` · Trend: gold `#c9a227`
- Volume: pink `#db61a2` · Fundamentals: red `#e5534b`

Colors are defined in `GROUP_COLORS` in index.html and applied via `applyGroups()`.

## Scores / ratings
Three composite scores per stock (1–10): **Momentum** (price/trend/volume), **Quality** (company fundamentals), **Overall** (65% momentum + 35% quality). Computed in `computeScores()` in server.js.

## API patterns
- `GET /api/stocks` — serves snapshot to public; `?refresh=1` recomputes live (admin only)
- `GET /api/stocks?asOf=YYYY-MM-DD` — backtest mode (admin only)
- `POST /api/refresh-all` — clears profile cache, forces re-pull (admin only)
- All portfolio/ticker CRUD routes require admin

## Conventions
- No database — use flat JSON files (`fs.readFileSync` / `fs.writeFileSync`)
- No build step — frontend is a single `public/index.html` file, vanilla JS
- Dark theme CSS vars: `--bg: #0f1419`, `--panel: #1a212b`, `--border: #2a333f`, `--text: #e6edf3`, `--muted: #8b98a5`, `--accent: #388bfd`
- Admin-only UI elements use class `admin-only` — toggled by `applyAdminUI()` in index.html
