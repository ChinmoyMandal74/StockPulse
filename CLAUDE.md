# StockPulse — Claude Code Context

## What this is
A stock momentum screener POC. State lives in **Turso** (hosted libSQL/SQLite). Price data comes from the Twelve Data API. The owner (admin) manages portfolios and refreshes data; the public sees a read-only cached snapshot.

The repo/folder is `StockPulse`; the app is branded **Ticker Lab** in the UI (`<title>` and the bar wordmark).

## Running the app
```
node --use-system-ca server.js
```
Runs on port 3000. Requires `.env` with `TWELVE_DATA_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `ADMIN_PASSWORD`.

**Careful when running it just to look at the UI:** `computeStocks()` calls `ensureProfiles()`, which re-pulls any profile older than a day and rewrites the `profiles` and `snapshot` tables, burning API credits. To check frontend changes only, serve `public/` with a throwaway static server instead — the page falls back to admin-open mode when `/api/me` fails, so the whole chrome renders without touching the API.

## Key files
| File | Purpose |
|---|---|
| `server.js` | Express backend — all API routes, auth, data computation |
| `db.js` | Turso persistence layer — every read/write goes through here |
| `migrate-to-turso.js` | One-off JSON → Turso seeder; `--commit` to write, idempotent |
| `set-password.js` | Local account admin — list accounts, set a password, change a role |
| `public/index.html` | Single-page frontend (no build step, vanilla JS, all CSS inline) |
| `public/visitors.html` | Admin-only visitor log page at `/visitors` |
| `public/favicon.svg` | Momentum-line mark, emerald on OLED black |
| `portfolios.json`, `snapshot.json`, `profiles.json`, `names.json`, `visitors.log` | **Legacy.** Pre-migration backups only — nothing reads or writes them any more. Safe to delete once you trust the database. |
| `.env` | `TWELVE_DATA_API_KEY`, `TURSO_*`, `ADMIN_PASSWORD`, optional feature flags |

## Persistence (Turso)
Everything goes through `db.js`. Tables: `portfolios`, `portfolio_tickers`, `names`, `profiles`, `snapshot`, `visitors`.

- **The accessor names are unchanged** from the flat-file era (`readPortfolios`, `writeProfiles`, …) and return the same shapes, so call sites only gained an `await`. `server.js` destructures them from `db.js`.
- **Writes are whole-collection replaces** — delete-then-insert inside one `db.batch`. That mirrors the old "rewrite the file" semantics and keeps `writeProfiles({})` working as the cache-clear `/api/refresh-all` depends on. Fine at tens of rows; revisit if the universe grows.
- **Portfolio order is an explicit `position` column.** The UI colours portfolios by index, so order has to survive the round trip — don't rely on insertion order.
- **`profiles.data` is a JSON blob** because it caches a third-party response whose shape we don't control. `fetched_at` is lifted into its own indexed column because the 24h TTL check runs against it every refresh.
- **`/api/visitors` aggregates in SQL** now (counts + `LIMIT 500`), instead of parsing the whole log into memory on every request.
- **Express 4 does not catch async handler rejections.** Every async route is wrapped in the `route()` helper near the top of `server.js`, which turns a database error into a 500 instead of a hung request. Any new async route must use it.

## Auth model
The app is a **door**: the screener is shared, and accounts only decide who gets in.

- **Anonymous** → `/` redirects to `/login`; `/api/stocks` and `/api/portfolios` return 401.
- **`member`** → sees the same shared screener, read-only (sort, collapse, export).
- **`owner`** → everything: add/remove tickers, Refresh, Refresh all, backtest, visitor log, user management.
- `ADMIN_PASSWORD` unset → fully open, everyone is admin (local dev). Set → sign-in required.

Accounts live in Turso (`users`, `sessions`). Passwords are hashed with **`crypto.scrypt`** and a per-user random salt — no dependency needed. Sessions are random 32-byte tokens in the `sessions` table with a 30-day expiry, so a single session can be revoked; they are *not* the old deterministic HMAC cookie, which cannot work for more than one user.

- **The first account created becomes `owner`**, so a fresh install bootstraps itself. Everyone after is a `member`.
- **`SIGNUP_CODE`** (optional env var) gates registration. Without it anyone who finds the URL can sign themselves up — set it before making the site public.
- **`POST /api/login` with a password but no email still checks `ADMIN_PASSWORD`.** That escape hatch is deliberate: a broken `users` table can't lock you out of your own instance. **Do not change the HMAC salt `'stock-tracker-admin-v1'`** in `adminToken()` or every legacy admin cookie dies.
- Login failures are counted on the user row (`failed_count`, `locked_until`) and lock the account for 15 minutes after 8 tries. Tracked per user, not per IP, because an in-memory counter is useless on serverless.
- Wrong password and unknown email return the **same** error, so the endpoint can't enumerate accounts.
- **There is no email sender, so there is no "forgot password" link.** Recovery is `node --use-system-ca set-password.js <email>` run locally against the same Turso database the deployed app uses — it prompts for the password rather than taking it as an argument, which would leak it into shell history and the process list. `--role owner|member` changes a role, refusing to demote the last owner.
- A signed-in user can change their own password via `POST /api/password` (needs the current one). Both paths drop that user's sessions, so a change signs other devices out.
- Password hashing (`hashPassword`, `newSalt`, `verifyPassword`) lives in **db.js**, beside the users table — `server.js` and `set-password.js` both import it so scrypt parameters can't drift apart.
- `isAdmin(req)` and `isSignedIn(req)` are **async** now — always `await` them. `requireAdmin` / `requireAuth` are middleware built on the `route()` wrapper.

## Feature flags in .env
- `ENABLE_FUNDAMENTALS=true` — requires Twelve Data Pro+ plan
- `ENABLE_ANALYST=true` — requires Twelve Data Ultra+ plan

## Visitor logging
- Every `GET /` inserts a row into the `visitors` table (fire-and-forget, so a logging failure can't block the page)
- Fields: `ts`, `ip`, `ua` (user-agent), `ref` (referrer)
- Admin-only endpoint: `GET /api/visitors` — returns summary + last 500 entries
- Admin-only page: `/visitors` — same visual system as the screener

## Frontend layout
Everything above the table is **one bar**. There is no separate masthead, no tab rail, no chip row — they were merged to reclaim vertical space (the table used to start ~685px down; it now starts ~91px down).

```
.page (100dvh flex column, never scrolls)
├── header.bezel.bar          ← wordmark · portfolio picker · columns picker
│                               · add-ticker field · as-of field · status
│                               · Refresh · Export · ⋯ more menu
├── #readonlyNote / #backtestBar / .error   (flex: none, shown conditionally)
└── .table-bezel (flex: 1, min-height: 0)
    └── .table-wrap           ← the only scroll container on the page
```

- **The page itself does not scroll.** `body` is `height: 100dvh; overflow: hidden`; the table bezel is the flexible row and `.table-wrap` scrolls inside it. Never reintroduce a `max-height: calc(100dvh - Npx)` on the table — its height is derived from the flex column, so adding a notice steals from the table instead of pushing the page taller.
- **`.deck`** (add-ticker field, as-of field, status, Refresh) is `display: contents` on desktop, so its children join the bar's flex row directly. Below 768px it becomes a fixed full-screen glass sheet toggled by `#menuBtn` (a hamburger that morphs into an X, fixed to the top-right corner).
- **`.status`** uses `flex: 1 1 0` — a zero flex-basis makes it invisible to flex line-breaking, so it can never wrap a button onto a second line; it absorbs the slack instead. It's a **block** with `text-align: right`, not a flex row: a flex row justified to the end clips its *start* with no ellipsis.
- The bar stays on one line down to ~1280px; below that it wraps, which is intended.

### Dropdown menus
Three menus share one controller. Only one is open at a time.

| id | trigger | contents |
|---|---|---|
| `#picker` | portfolio name + count | All + every portfolio + "New portfolio" |
| `#colPicker` | `Columns n/10` | multi-select column groups + Show all / Hide all |
| `#morePicker` | `⋯` (admin only) | Refresh all, Visitor log, Rename/Delete portfolio, Log out |

- `openPicker(id)` opens one and closes the rest; `closePickers()` closes all. They close on outside click, Escape and resize.
- `placeMenu()` clamps an opened menu inside the viewport — it shifts left of its trigger rather than overflowing, and never crosses the left gutter. Don't replace it with a static `left`/`right` anchor; no single anchor suits both triggers at every width.
- `#morePicker` holds the *real* buttons (`#refreshAllBtn`, `#renameBtn`, `#deleteBtn`, `#logoutBtn`) restyled as `.pick` rows, so their existing listeners and disabled-state logic still apply. `#portfolioActions` and `#sessionActions` wrap the contextual rows with their separators so both hide together.
- The column menu is rebuilt by `renderColumnMenu()` from inside `applyGroups()`, so the trigger count can't drift from the table state. It deliberately stays open while you toggle.

## Design system
Dark-only. "Ethereal glass": OLED black with a fixed radial mesh aura and a film-grain overlay, glass chrome, hairline borders.

- **Type** — `Geist` / `Geist Mono` from Google Fonts (`--sans` / `--mono`). Numeric table cells use the mono face with `font-variant-numeric: tabular-nums`. This is the app's only external dependency; it degrades to `system-ui` offline.
- **Double bezel** — every card is `.bezel` (translucent shell, hairline, `--r-shell` radius, 6px padding) wrapping `.core` (opaque `--surface`, `--r-core` radius, inset top highlight). `--r-core` = `--r-shell` − padding, for concentric curves.
- **Icons** — inline SVG sprite in `#sprite`, used as `<svg class="ic"><use href="#i-name" /></svg>`. No emoji, no icon font. Add new glyphs as `<symbol id="i-...">` with 1.35px strokes on a 24×24 viewBox.
- **Motion** — only `--ease` / `--ease-soft` cubic-beziers, never `linear` or `ease-in-out`. `.reveal` + `IntersectionObserver` gives blocks a fade-up-and-deblur entry; table rows stagger via `--i` on each `<tr>`. All of it is disabled under `prefers-reduced-motion`.
- **Performance rules** — `backdrop-filter` only on fixed/sticky elements (island menus, mobile sheet, tooltip), never on a scrolling container. The grain and aura are fixed `pointer-events: none` layers. Animate `transform`/`opacity` only.
- **Layers** — `--z-sheet: 45`, `--z-nav: 46`, `--z-tip: 55`, `--z-grain: 60`. Menus sit at `z-index: 30` inside `.page`'s stacking context.

### CSS tokens (`:root` in index.html)
```
--void #050505      page          --text  #e9ecf2
--surface #0a0c11   card interior --muted #8b94a4
--surface-2 #0d1017 group headers --faint #59616f
--shell   rgba(255,255,255,.028)  --green #34d399   --red   #fb7185
--hair    rgba(255,255,255,.07)   --amber #fbbf24
--hair-2  rgba(255,255,255,.13)   --accent #7c9cff  --accent-2 #a78bfa
```
`--bg`, `--panel` and `--border` are kept as aliases so older rules and inline styles keep resolving.

**`--surface` must stay opaque.** The frozen table columns and the sticky header cells paint on it to mask the rows scrolling underneath; a translucent value makes them see-through.

## Column groups (frontend)
Each group has a fixed colour used for the group header `th` and its row in the columns menu:
- Rank `#a3e635` · Info `#7c9cff` · Short-term `#34d399` · Long-term `#a78bfa` · Forward `#fb923c`
- Relative `#22d3ee` · Trend `#fbbf24` · Volume `#f472b6` · Size `#94a3b8` · Fundamentals `#fb7185`

**To add a group:** append the id to `GROUPS`, give it a colour in `GROUP_COLORS` and a label in `GROUP_LABELS`, add the `th.group` banner with the right `colspan`, and tag every header/body cell with `class="grp-<id>"`. Then mirror it in **three more places**: `GROUP_ORDER` and `FIELD_SPEC` in `public/rowcard.js`, and the palette copies at the top of `public/analysis.html`. `applyGroups()` and the columns menu pick it up with no further changes.

The **Rank** group carries the four score columns (Overall, Mom., Qual., Rank) and **Info** the five metadata ones (Portfolios, Price, Sector, Market Cap, Next Earn) — they were one 9-column group until they were split, so that the scores and the metadata can be collapsed independently.

The **Size** group carries the absolute-size columns — Revenue TTM, Gross Profit TTM, Gross Margin, Net Income TTM, FCF TTM, FCF Margin, Net Cash. Every one comes out of the `/statistics` call `fetchProfile()` already makes, so the group costs **no extra API credits**.

The **Info** banner spans nine columns — Overall, Mom., Qual., Rank, Portfolios, Price, Sector, Market Cap, Next Earn — and all nine collapse together.

## Table specifics
- **Frozen columns are Symbol and Name only** (`.frz0`, `.frz1`). The classes are *positional*: `updateStickyOffsets()` measures header cell widths left-to-right to compute the cumulative `left` offsets, so reordering columns means re-dealing the `frz` numbers in DOM order, not just moving the markup. `.frz1` carries the boundary shadow.
- Two sticky header rows; `--h1` is measured at runtime because the second row's top offset depends on the first row's wrapped height.
- The sorted column is marked by a small accent arrow absolutely positioned in the header's bottom padding — it's positioned, not inline, so it can't reflow a wrapped label.
- Score cells (`td.rating`) open the factor-breakdown tooltip (`#tip`, fixed-position glass card) on hover.

## Fundamentals data — three things that will bite you
- **Margins are derived, not taken from the API.** `financials.gross_margin` does *not* equal `gross_profit_ttm / revenue_ttm` — it's computed on a different basis and differs by up to ~4 points (Samsung: 61.2% vs 57.5%). `fetchProfile()` derives `grossMargin` and `fcfMargin` from the same absolutes the table displays, so a user dividing the two columns gets the number shown.
- **Absolute columns are in the company's reporting currency.** Samsung's revenue is ₩485T. Pass `s.currency` to `fmtMktCap()` for every money column, and treat sorting on them as within-currency only — a KRW reporter tops any cross-currency sort.
- **ADR fundamentals can be incoherent.** SKHY returns net income (116.8B) larger than gross profit (104.0B), which is impossible, and its EBITDA appears to be in a different unit from its revenue. Don't assume a populated field is a correct one.

Forward revenue / EPS estimates (`/revenue_estimate`, `/earnings_estimate`, `/growth_estimates`) are **Ultra-plan only** — they 403 on the current Pro key. AAPL returns data for them because it's Twelve Data's free sample symbol, which makes it a misleading symbol to test plan access with. `/income_statement?period=quarterly` works but costs 100 credits/symbol (vs ~45 for `/statistics`) and is capped at 6 quarters, so trailing-twelve-month growth — which needs 8 — can't be computed on this plan.

## Scores / ratings
Three composite scores per stock (1–10): **Momentum** (price/trend/volume), **Quality** (company fundamentals), **Overall** (65% momentum + 35% quality). Computed in `computeScores()` in server.js.

## API patterns
- `GET /api/stocks` — serves snapshot to public; `?refresh=1` recomputes live (admin only)
- `GET /api/stocks?asOf=YYYY-MM-DD` — backtest mode (admin only)
- `POST /api/refresh-all` — clears profile cache, forces re-pull (admin only)
- All portfolio/ticker CRUD routes require admin

## Conventions
- All persistence goes through `db.js` — never reintroduce `fs` reads/writes for state; a serverless filesystem discards them
- No build step — the frontend is a single `public/index.html`, vanilla JS, CSS in one `<style>` block
- Admin-only UI elements use class `admin-only` — toggled by `applyAdminUI()` in index.html
- The CSV export column order is deliberately *not* kept in sync with the on-screen column order, so saved exports stay stable
