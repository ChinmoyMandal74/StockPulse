## Key files
| File | Purpose |
|---|---|
| `server.js` | Express backend — all API routes, auth, data computation |
| `db.js` | Turso persistence layer — every read/write goes through here |
| `migrate-to-turso.js` | One-off JSON → Turso seeder; `--commit` to write, idempotent |
| `barmath.js` | **Indicators from a bar series and nothing else** — RSI and realised volatility, no database, no API, no universe. Shared by the live refresh, `techrow.js` and the chart. What is left of `momentum.js`; see [docs/momentum-scoring.md](docs/momentum-scoring.md) |
| `analysis-db.js` | **The local SQLite copy of the archive, for analysis.** `--full` rebuilds, no flag syncs, `--stats` reports. Never query Turso for research when this exists |
| `private/action.js` | **The Action rules** — Company Type + Action from ordered rule lists, first match wins. Shared by server and browser |
| `action-test.js` | 64 hand-built cases, one per rule with its expected flag. Run after touching any rule |
| `action-backtest.js` | Replays the technical rules over 18 years of bars; reports per-Action downside (p10) |
| `purge-orphans.js` | Deletes data for symbols in no portfolio; `--commit`, `--only`. Dry run by default |
| `backfill-bars.js` | One-off deep pull of the daily bar archive; `--commit`, `--depth`, `--only` |
| `set-password.js` | Local account admin — list accounts, set a password, change a role |
| `public/app.css` | **Shared stylesheet** — tokens, atmosphere, bezel, buttons, table base, row card. Linked by all four pages |
| `private/index.html` | Single-page frontend (no build step, vanilla JS, page-specific CSS inline) |
| `private/strategy.js` | **The backtest engine** — signal to position to daily P&L. Pure functions; `require`d by the runner and loaded by the page |
| `strategy-runs.js` | Builds `private/strategy-index.json` + one `strategy-u-*.json` per universe: every rule variant over every portfolio. Runs against the local copy |
| `single-data.js` | Builds `private/single-closes.json`: every symbol's daily closes, delta-encoded, for `/single` to simulate in the browser |
| `private/single.html` | The single-stock strategy at `/single` — one stock in or out, plus the same rule swept across the whole universe |
| `private/strategy.html` | The strategy backtest at `/strategy` — equity curve, drawdown, costs |
| `private/indicators.js` | **Tunable short-horizon indicators, defined once** — loaded by `/lab`, `require`d by the server and the offline grid |
| `lab-grid.js` | Builds `private/lab-grid.json`: the cross-sectional result for every parameter setting the lab can reach. Runs against the local copy, never Turso |
| `private/lab.html` | The indicator lab at `/lab/<SYMBOL>` — sliders, a chart, and the universe-wide truth beside it |
| `private/stock.html` | One stock in full at `/stock/<SYMBOL>` — chart, range buttons, every field |
| `private/compare.html` | **Two stocks side by side** at `/compare/<A>/<B>` — a rebased chart, a ratio line, and every field with the distance between them. Two, never more |
| `private/chat.html` | The assistant at `/chat` — any signed-in user, see **Chatbot** below |
| `private/visitors.html` | Admin-only visitor log page at `/visitors` |
| `private/users.html` | Admin-only account maintenance at `/users` — list and delete, no add |
| `private/edgar.html` | Admin-only status of every auxiliary data pull at `/edgar` — filings, announcements, insiders, short interest, index membership, splits |
| `private/contact.html` | Signed-in contact form at `/contact` — subject + message, mailed to the owner |
| `private/help.html` | User-facing help at `/help` — reading the table, the Quality score, the Advice rules |
| `private/filters.js` | **The column-filter grammar, defined once** — `filterValue`, `compileFilter`, `screenRows`. Loaded by the screener and `require`d by the server, which runs screens for the phone page |
| `private/mobile.html` | The phone page at `/m` — screens, rows, a stock sheet, and a view switcher. No settings of its own |
| `private/mobile-setup.html` | The admin editor at `/mobile-setup` — which views the phone offers and what each row shows |
| `private/architecture.html` | The system diagram at `/architecture` (admin) — boxes and edges from a layout spec, drawn as one SVG |
| `private/cardshot.js` | **The rasteriser, defined once** — inlines computed styles, embeds the fonts, paints a card onto a canvas at its true 1080px. Used by the studio and the phone |
| `.github/workflows/nightly-refresh.yml` | The 4:15PM Eastern Refresh all — see **The nightly job** below |
| `public/favicon.svg` | Rising-line mark, emerald on OLED black |
| `portfolios.json`, `snapshot.json`, `profiles.json`, `names.json`, `visitors.log` | **Legacy.** Pre-migration backups only — nothing reads or writes them any more. Safe to delete once you trust the database. |
| `.env` | `TWELVE_DATA_API_KEY`, `TURSO_*`, `ADMIN_PASSWORD`, optional feature flags |
| `docs/backlog.md` | **Work identified and deliberately not done** — what it is, what is already measured, and what would make it a bad idea. Read it before proposing something; it may already be there with numbers attached |

