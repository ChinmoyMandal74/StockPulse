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
| `backfill-bars.js` | One-off deep pull of the daily bar archive; `--commit`, `--depth`, `--only` |
| `set-password.js` | Local account admin — list accounts, set a password, change a role |
| `public/app.css` | **Shared stylesheet** — tokens, atmosphere, bezel, buttons, table base, row card. Linked by all four pages |
| `public/index.html` | Single-page frontend (no build step, vanilla JS, page-specific CSS inline) |
| `public/analysis.html` | Signal screens at `/analysis` — see **Analysis screens** below |
| `public/stock.html` | One stock in full at `/stock/<SYMBOL>` — chart, range buttons, every field |
| `public/chat.html` | The assistant at `/chat` — any signed-in user, see **Chatbot** below |
| `public/visitors.html` | Admin-only visitor log page at `/visitors` |
| `public/users.html` | Admin-only account maintenance at `/users` — list and delete, no add |
| `public/contact.html` | Signed-in contact form at `/contact` — subject + message, mailed to the owner |
| `public/screens.js` | **The seven analysis screens, defined once** — loaded by `analysis.html` and `require`d by `server.js` |
| `.github/workflows/nightly-refresh.yml` | The 8PM Refresh all — see **The nightly job** below |
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
- **`/api/refresh-all` expires profiles, it does not delete them** (`expireProfiles()` sets `fetched_at = 0`). Deleting them used to strip sector, market cap and fundamentals out of the shared snapshot for the ten-odd minutes the backfill ran, so every other viewer saw the holes. `readProfiles()` treats `0` as "keep the values, drop the timestamp": the row still renders, and `ensureProfiles()` still re-pulls it. **The blob also carries a `fetchedAt`, so the column has to override it** — otherwise the stale copy inside the JSON makes an expired profile look fresh.
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
- **Password reset is by email**, via `POST /api/forgot` → a link to `/reset?token=…` → `POST /api/reset`. `set-password.js` remains the local fallback for when mail is unavailable or an account is locked out of its own inbox; it prompts rather than taking the password as an argument, which would leak it into shell history. `--role owner|member` changes a role, refusing to demote the last owner.
  - **The token is never stored — only its SHA-256**, for the same reason sessions and passwords are hashed: a database read must not hand anyone a working reset link.
  - **Single use and 30 minutes.** Valid tokens are deleted as they are read, so a link cannot be replayed even while unexpired, and issuing a new one deletes any older link for that account.
  - **`/api/forgot` answers identically whether or not the address exists** — the login endpoint already refuses to confirm which emails have accounts, and this one would otherwise give it away. It also refuses to issue more than one token a minute per account, or it becomes a way to flood someone's inbox.
  - **The password length is checked before the token is consumed**, so a typo does not burn the link.
  - `setPassword()` already drops every session and clears the lockout counter, which is what a reset should do.
- A signed-in user can change their own password via `POST /api/password` (needs the current one). Both paths drop that user's sessions, so a change signs other devices out.
- **`/users` is list-and-delete only, never create.** Accounts come from sign-up (gated by `SIGNUP_CODE`); an admin-created account would need a password set for it, which means either mailing a secret or inventing one — `set-password.js` already covers the rare case properly.
- **`deleteUser()` purges `prefs` and `chat_usage` too.** Those are keyed on email, not user id, so without it a new account registered at the same address would inherit the deleted one's saved column layout and its chat quota for the day.
- **Two guards, both enforced server-side and mirrored in the UI as a disabled button:** the only owner cannot be removed, and nobody can delete the account they are signed in as — that would revoke their own session mid-request. `listUsers()` also returns active session count, last sign-in and any lockout, which is what makes the page worth opening.
- Password hashing (`hashPassword`, `newSalt`, `verifyPassword`) lives in **db.js**, beside the users table — `server.js` and `set-password.js` both import it so scrypt parameters can't drift apart.
- `isAdmin(req)` and `isSignedIn(req)` are **async** now — always `await` them. `requireAdmin` / `requireAuth` are middleware built on the `route()` wrapper.

## Email
Sent through **Resend** over plain `fetch` — a REST call does not justify a fourth dependency. Needs `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL`; without all three `MAIL_READY` is false and `/api/forgot` still returns its normal reply while logging that mail is unconfigured, so the endpoint never reveals the difference.

- **Sending is scoped to `mail.tickrlab.com`**, a subdomain, so a reputation problem cannot reach the domain the site is served from. SPF, DKIM and an `MX` for bounce feedback live under it; **DMARC sits at the root** (`_dmarc`), where one policy covers every subdomain.
- **DMARC started at `p=none`** — monitoring only, no delivery effect. Tighten to `p=quarantine` after the aggregate reports come back clean.
- **`APP_URL` is `https://www.tickrlab.com`**, the canonical host — the bare domain 308s to it, and a link in an email should not depend on a redirect.
- **Nothing receives mail at the sending address.** Set `MAIL_REPLY_TO` to a real inbox, or add a forwarder (ImprovMX or Forward Email work with Vercel DNS; Cloudflare Email Routing does not, since it needs Cloudflare as the DNS host).
- Upstream errors are logged by type only, never echoed to the client — the response body can restate the request, and the key travels in the same headers.
- **`/contact` is signed-in only**, which is what makes it safe without a captcha or a honeypot: every sender is a known account and the address comes off the session rather than a form field. That is also why the address can be used as `Reply-To` — replying in a mail client answers the person, not the server.
- **The subject has CR and LF stripped, not escaped.** A newline in a header is how a subject line becomes extra headers; the body is the only place free text belongs. The subject is prefixed `[Ticker Lab]` and capped at 120 characters, the body at 4,000.
- **Destination is `CONTACT_TO`, falling back to the owner account's email**, so the form works even if the variable is never set.
- The daily cap reuses `chat_usage` under a `contact:` key prefix — that table is a generic per-key-per-day counter that happens to be named for its first caller.

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
| `#morePicker` | `⋯` (admin only) | Rename/Delete portfolio, Change password, Sign out |

- `openPicker(id)` opens one and closes the rest; `closePickers()` closes all. They close on outside click, Escape and resize.
- `placeMenu()` clamps an opened menu inside the viewport — it shifts left of its trigger rather than overflowing, and never crosses the left gutter. Don't replace it with a static `left`/`right` anchor; no single anchor suits both triggers at every width.
- `#morePicker` holds the *real* buttons (`#renameBtn`, `#deleteBtn`, `#changePwBtn`, `#logoutBtn`) restyled as `.pick` rows, so their existing listeners and disabled-state logic still apply. `#portfolioActions` and `#sessionActions` wrap the contextual rows with their separators so both hide together.
- **`#stockLink` ("Stock") is the bar's door into `/stock/<SYMBOL>`.** It points at whatever row is currently on top — it is set from `sorted[0]` in `render()`, not from the ranking, so it follows the sort and the portfolio filter rather than quietly always meaning rank 1. Which stock it lands on matters little now the page has its own picker; the point is not having to hunt for a name to click first.
- **Analysis, Visitor log, Refresh and Refresh all are top-level bar buttons**, not menu rows. Refresh and Refresh all are both labelled `.btn` pills — they run the same kind of action, so they carry the same weight; only their icons differ.
- The column menu is rebuilt by `renderColumnMenu()` from inside `applyGroups()`, so the trigger count can't drift from the table state. It deliberately stays open while you toggle.
- **Each menu row also carries a jump arrow** that scrolls that group into view — 48 columns across ~3,400px is more than a scrollbar should be asked to do, and the groups are how anyone thinks about the table anyway. The toggle and the jump are siblings in a `.pick-row`, because a button cannot nest inside a button. The arrow is disabled while its group is collapsed.
- **`scrollToGroup()` works from `getBoundingClientRect()` plus the current `scrollLeft`, never `offsetLeft`.** A table cell's `offsetParent` here is `main.page`, not the table, so `offsetLeft` overstates by the table's own inset and lands the group ~29px *underneath* the frozen columns. It also subtracts the frozen block's measured width, or the target hides behind Symbol and Name.
- **Arrow keys scroll the table horizontally**, shift for a page, home/end for the ends — the hint at the foot of the columns menu is where they are advertised, since Shift+wheel already works natively but nobody knows. The handler ignores keystrokes aimed at an input and does nothing when there is no horizontal overflow.

## Design system
Dark-only. "Ethereal glass": OLED black with a fixed radial mesh aura and a film-grain overlay, glass chrome, hairline borders.

### Where CSS lives
`public/app.css` holds everything common to all four pages — tokens, `.aura`/`.grain`, `#sprite`/`.ic`, `.bezel`/`.core`, `.btn` and variants, the signal colours, table base, `#rowcard` and `.reveal`. Each page links it and then keeps **only its own layout** in an inline `<style>`.

- **The page's block loads second, so it wins ties.** That is how `login.html` keeps its full-width white submit button and its tinted card interior while still inheriting the rest.
- **Match the shared selector exactly when you mean to override it.** `login.html` styles `.bezel > .core`, not `.core`, because the shared rule is more specific and would otherwise win regardless of order.
- **Watch grouped selectors.** A page rule like `th, td { font-size: … }` sits after the shared `th { font-size: … }` at equal specificity and silently takes it over. `index.html` and `analysis.html` set their table font sizes on `td` alone for this reason.
- Before changing a shared rule, check the other three pages — the four style blocks used to be copies of each other and drifted (`20px` where the token said `var(--r-core)`, buttons that had lost `font-family`).

- **Type** — `Geist` / `Geist Mono` from Google Fonts (`--sans` / `--mono`). Numeric table cells use the mono face with `font-variant-numeric: tabular-nums`. This is the app's only external dependency; it degrades to `system-ui` offline.
- **Double bezel** — every card is `.bezel` (translucent shell, hairline, `--r-shell` radius, 6px padding) wrapping `.core` (opaque `--surface`, `--r-core` radius, inset top highlight). `--r-core` = `--r-shell` − padding, for concentric curves.
- **Icons** — inline SVG sprite in `#sprite`, used as `<svg class="ic"><use href="#i-name" /></svg>`. No emoji, no icon font. Add new glyphs as `<symbol id="i-...">` with 1.35px strokes on a 24×24 viewBox.
- **Motion** — only `--ease` / `--ease-soft` cubic-beziers, never `linear` or `ease-in-out`. `.reveal` + `IntersectionObserver` gives blocks a fade-up-and-deblur entry; table rows stagger via `--i` on each `<tr>`. All of it is disabled under `prefers-reduced-motion`.
- **Performance rules** — `backdrop-filter` only on fixed/sticky elements (island menus, mobile sheet, tooltip), never on a scrolling container. The grain and aura are fixed `pointer-events: none` layers. Animate `transform`/`opacity` only.
- **Layers** — `--z-sheet: 45`, `--z-nav: 46`, `--z-tip: 55`, `--z-grain: 60`. Menus sit at `z-index: 30` inside `.page`'s stacking context.

### CSS tokens (`:root` in `public/app.css`)
```
--void #050505      page          --text  #e9ecf2   17.2:1
--surface #0a0c11   card interior --muted #9aa3b2    7.7:1
--surface-2 #0d1017 group headers --faint #7d8797    5.4:1
--shell   rgba(255,255,255,.028)  --green #34d399   --red   #fb7185
--hair    rgba(255,255,255,.07)   --amber #fbbf24
--hair-2  rgba(255,255,255,.13)   --accent #7c9cff  --accent-2 #a78bfa
```
`--bg`, `--panel` and `--border` are kept as aliases so older rules and inline styles keep resolving.

**The two greys are contrast-floored.** Ratios above are against `--surface`; both clear WCAG AA (4.5:1). `--faint` used to be `#59616f` at 3.1:1 and it painted the column headers, the hover card's field names and every em-dash placeholder — the least legible text in the app. Don't darken either one back below 4.5:1.

**`--surface` must stay opaque.** The frozen table columns and the sticky header cells paint on it to mask the rows scrolling underneath; a translucent value makes them see-through.

## Column groups (frontend)
Each group has a fixed colour used for the group header `th` and its row in the columns menu:
- Rank `#a3e635` · Info `#7c9cff` · Chart `#a8a29e` · Short-term `#34d399` · Long-term `#a78bfa` · Forward `#fb923c`
- Relative `#22d3ee` · Trend `#fbbf24` · Volume `#f472b6` · Size `#94a3b8` · Fundamentals `#fb7185`

**To add a group:** append the id to `GROUPS`, give it a colour in `GROUP_COLORS` and a label in `GROUP_LABELS`, add the `th.group` banner with the right `colspan`, and tag every header/body cell with `class="grp-<id>"`. Then mirror it in **three more places**: `GROUP_ORDER` and `FIELD_SPEC` in `public/rowcard.js`, and the palette copies at the top of `public/analysis.html`. `applyGroups()` and the columns menu pick it up with no further changes.

The **Rank** group carries the four score columns (Overall, Mom., Qual., Rank) and **Info** the five metadata ones (Portfolios, Price, Sector, Market Cap, Next Earn) — they were one 9-column group until they were split, so that the scores and the metadata can be collapsed independently.

The **Size** group carries the absolute-size columns — Revenue TTM, Gross Profit TTM, Gross Margin, Net Income TTM, FCF TTM, FCF Margin, Net Cash. Every one comes out of the `/statistics` call `fetchProfile()` already makes, so the group costs **no extra API credits**.

The **Info** banner spans nine columns — Overall, Mom., Qual., Rank, Portfolios, Price, Sector, Market Cap, Next Earn — and all nine collapse together.

### Sparklines
The **Chart** group is one column (`90d`) between Rank and Short-term, holding a 90-session price line per row. A group of its own rather than a column inside Info, because the columns menu toggles *groups* — inside Info it could only be hidden by hiding Price, Sector and Market Cap too. `data-group="vol" colspan="1"` was already the precedent for a one-column group.

- **`RowCard.sparkSVG()` is separate from `chartSVG()`**, not a flag on it. At 63×20px there is no room for a baseline, an end dot or padding, and a function that draws "everything except" is harder to follow than two small ones.
- **The line is neutral (`--muted`), not green/red.** The five percentage columns immediately to its right are already coloured; a sixth coloured element there is noise. The shape carries the information, colour is left to the numbers. It brightens to `--text` on row hover.
- **`/api/sparklines` is one query for the whole universe** (`readCloses`), ~41 KB, fetched *after* the table paints — a decoration must not make the data wait. Each line is scaled to its own high and low, so the shape is readable but levels are not comparable between rows; the column header says so.
- **The generated markup is cached per symbol.** The table rebuilds every row on each sort and filter, and regenerating 69 paths each time would make sorting feel heavy. Measured at 81ms per sort with all 69 intact afterwards.
- Row height is unchanged at 37px — a 20px line fits inside the existing `padding: 7px` cells.

## Table specifics
- **Frozen columns are Symbol and Name only** (`.frz0`, `.frz1`). The classes are *positional*: `updateStickyOffsets()` measures header cell widths left-to-right to compute the cumulative `left` offsets, so reordering columns means re-dealing the `frz` numbers in DOM order, not just moving the markup. `.frz1` carries the boundary shadow.
- Two sticky header rows; `--h1` is measured at runtime because the second row's top offset depends on the first row's wrapped height.
- The sorted column is marked by a small accent arrow absolutely positioned in the header's bottom padding — it's positioned, not inline, so it can't reflow a wrapped label.
- Score cells (`td.rating`) open the factor-breakdown tooltip (`#tip`, fixed-position glass card) on hover.

### The score tooltip
**`RowCard.scoreTip(stock, kind, opts)` builds it and `RowCard.placeTip()` positions it**; `#tip`'s styles live in `app.css`. Both were inline in `index.html` until the stock page needed to explain the same three numbers — a second copy of "why is this an 8" is exactly what `rowcard.js` exists to prevent. Only the markup is shared: each page keeps its own hover wiring, because one hovers table cells and the other a chip and a card row.

- `kind` is `overall` | `momentum` | `quality` | `rank`, and it returns **`null` when there is nothing to explain**, so a caller can skip showing rather than flash an empty card.
- **`rank` is not a factor breakdown** — a rank is a position in a sorted list, so the card explains the number it sorts on: the Overall score, its 65/35 split, and that the ordering runs across every stock in the screener.
- **`buildSections(s, { tips: true })`** marks the Overall/Mom./Qual./Rank rows with `data-tip`. Off by default: inside the hover card those rows are already in a tooltip, and a tooltip on a tooltip helps nobody. Only `/stock/<SYMBOL>` passes it, where there is no table to hover and the scores would otherwise be four bare numbers.

## Fundamentals data — things that will bite you
- **All three margins are derived, not taken from the API.** `financials.gross_margin` does *not* equal `gross_profit_ttm / revenue_ttm` — it's computed on a different basis and differs by up to ~4 points (Samsung: 61.2% vs 57.5%). `profit_margin` is worse: it agrees with `net_income / revenue` for 42 of 44 tickers and is flatly wrong for the other two (JOBY +45.1% vs −755.1%, MSTR +68.7% vs −6294.2% — both loss-makers with small revenue). `fetchProfile()` derives `grossMargin`, `fcfMargin` **and `profitMargin`** from the absolutes the table displays, so dividing the two columns on screen gives the number shown.
- **Absolute columns are in the company's reporting currency.** Samsung's revenue is ₩485T. Pass `s.currency` to `fmtMktCap()` for every money column, and treat sorting on them as within-currency only — a KRW reporter tops any cross-currency sort.
- **ADR fundamentals can be incoherent.** SKHY returns net income (116.8B) larger than gross profit (104.0B), which is impossible, and its EBITDA appears to be in a different unit from its revenue. Don't assume a populated field is a correct one.

Forward revenue / EPS estimates (`/revenue_estimate`, `/earnings_estimate`, `/growth_estimates`) are **Ultra-plan only** — they 403 on the current Pro key. AAPL returns data for them because it's Twelve Data's free sample symbol, which makes it a misleading symbol to test plan access with. `/income_statement?period=quarterly` works but costs 100 credits/symbol (vs ~45 for `/statistics`) and is capped at 6 quarters, so trailing-twelve-month growth — which needs 8 — can't be computed on this plan.

## Scores / ratings
Three composite scores per stock (1–10): **Momentum** (price strength), **Quality** (company fundamentals), **Overall** (65% momentum + 35% quality). Computed in `computeScores()` in server.js.

### Momentum is cross-sectional
Momentum is scored **against the universe**, not against fixed thresholds, so it needs every row before it can be worked out: `computeStocks()` builds the rows, then `applyScores()` percentile-ranks the return factors and scores each one. Adding a momentum factor that is a *number* means adding it to `applyScores()`; a *category* (like trend regime) can stay inside `computeScores()`.

| factor | weight | notes |
|---|---|---|
| 12-1 momentum | 20 | 12-month return **skipping the last month**, risk-adjusted |
| 6M return | 18 | risk-adjusted |
| 3M return | 17 | risk-adjusted |
| % from 52W high | 10 | |
| Trend regime | 10 | 200D side + cross freshness; categorical, not ranked |
| Consistency | 10 | share of the last 12 months that closed up |
| 1M reversal | 8 | **inverted** — the biggest recent movers score lowest |
| RSI timing | 7 | non-monotonic, peaks at 70–75 |

Everything comes from the daily bars already fetched, so the extra factors cost **no API credits**. 12-1 and consistency need ~260 of the 300 bars `outputsize=300` returns.

**Why percentiles instead of `lin()` thresholds.** Measured against the live universe, the old absolute cut-offs left **33–51% of stocks pinned** at a floor or ceiling on every major factor — a factor that is constant across half the list cannot rank anything. Percentiles also survive a regime change: in a bad quarter the best names still score well *relatively* rather than everything collapsing to zero at once.

**Four factors were removed, each for a measured reason:**
- **RS vs S&P** was `threeMonthPct` minus a constant identical for every stock — correlation with 3M return was exactly **1.000**, so it could not reorder anything while consuming a quarter of the weight. Ranking within the universe is already relative.
- **MACD** was binary (0.8/0.2), discarding magnitude; correlation with the composite was **0.022**.
- **Vol trend** was unsigned, so a crash on heavy volume scored like a breakout, and **51%** of the universe sat at its floor while none reached the ceiling. If it returns, sign it: `volTrend × sign(1M)`.
- **Short squeeze** rewarded heavy short interest, which predicts *weaker* returns; it correlated **−0.223** with the composite, pulling against everything else.

**Do not add 1W/2W/1M as more-is-better factors.** At those horizons the evidence is reversal, not continuation — the same reason 12-1 skips its final month. `rsi` already correlates 0.745 with the 1-month return, so the horizon was partly in the score even before `1M reversal` made it explicit.

**Quality guards against bad feed data** — without these it rated a company 8/10 while it lost $878M:
- **Loss-makers exclude the three earnings-based factors** (earnings growth 25%, PEG 20%, forward P/E 10%). None of them means anything without earnings, and the feed happily returns a healthy-looking PEG of 0.16 on a large loss — `pegScore`/`peScore` only guard a ratio ≤ 0, so a *positive* nonsense value sails through. Excluded rather than penalised: `scoreFactors()` renormalises over what remains.
- **`QUALITY_MIN_WEIGHT` (0.4)** — below that share of usable factor weight, no quality score is reported and Overall falls back to momentum alone. A score resting on one factor is not a score.
- **Do not add a blanket cap on extreme growth.** MU, Samsung and SKHY report 1,200–1,400% earnings growth, which is real — memory in a cyclical upswing off a near-zero base. `lin(v, 0, 30)` already clamps the contribution, so the magnitude does no harm; rejecting it would throw away genuine signal.

Applying these moved 9 of 44 ratings — MSTR 5→2, JOBY 8→5, AVAV 7→5, four loss-makers down one, and SPCX 3→**5** (its meaningless PEG of 86.7 had been scoring zero and dragging it down).

## Fundamentals history
`fundamentals_history` keeps one row per symbol per day (18 columns — valuation, size, margins, growth, balance sheet), so the movement of a P/E or a margin can eventually be charted. **Empty until the next Refresh all** — nothing is backfillable, because `profiles` only ever holds the current value and no API on this plan returns historical forward estimates.

- **Written during a Refresh all only**, gated on `readRefreshState()` being non-null. An ordinary price Refresh reuses day-old cached profiles, so recording then would store identical numbers under a new date and invent movement that never happened.
- **One set per day**, enforced by the `(symbol, d)` primary key. A Refresh all calls this on each of its dozen-odd rounds, so the write is an upsert: later rounds carry more populated profiles and replace what earlier ones wrote.
- **Rows without a profile yet are skipped, not stored empty** — a later round in the same run fills them in.
- **Explicit columns, not a JSON blob** (unlike `profiles`): the shape is ours and stable, and a chart wants `select d, forward_pe` over a year rather than 365 blobs to parse. Adding a field is an `ALTER` in `ADDED_COLUMNS`.
- **The scores are deliberately absent.** They are model output rather than measurement — momentum has already been rewritten once, and a series mixing two scoring regimes compares nothing to nothing.
- **A history write never fails a refresh**, the same rule the bar archive follows.
- The series will be **irregular**: a point exists only for days a Refresh all was run, not every calendar day. Fine for a chart, awkward for precise period comparisons.

## Saved column layout
Which column groups a user has collapsed is stored per account in the `prefs` table (`user_key`, JSON `data`), read by `GET /api/prefs` and written by `PUT /api/prefs`.

- **Server-side, not `localStorage`.** The choice belongs to the person, so it follows them to another browser or machine rather than belonging to a device and being shared by whoever sits at it.
- **Keyed on the signed-in email**, falling back to `'admin'` for the legacy password cookie and for open mode, where there is no user row — the same convention `chat_usage` uses.
- **`fwd` is never persisted.** It is derived state: `refresh()` sets it from whether a backtest is running, so saving it would only store a value the next load overwrites.
- **Prefs are awaited before the first render**, in the boot chain `checkAuth().then(loadPrefs).then(refresh)`. Applying them afterwards would paint the default layout and then visibly rearrange it.
- **Writes are debounced 600ms** — the columns menu stays open while toggling, so changes arrive in bursts — and are suppressed until the load lands, or the defaults would be written back over the values being fetched.
- **The server stores only what it understands.** `PUT` rebuilds the `collapsed` map from scratch against `/^[a-z]{1,16}$/`, so the endpoint cannot be used as free per-user storage and `__proto__` cannot get in.

## Refresh state
A Refresh All re-pulls only `MAX_PROFILE_FETCHES_PER_CALL` (6) symbols per call, 62s apart, so it runs for several minutes. The `refresh_state` table (at most one row; absent = idle) lets every instance know — a process variable cannot work, since Vercel shares nothing between them.

- `POST /api/refresh-all` expires the cache and calls `beginRefresh()`; `DELETE /api/refresh-all` ends it when the client's loop finishes or gives up.
- Each `?refresh=1` round calls `noteRefreshProgress()`, which **only updates a refresh that is already running** — that is what stops an ordinary price Refresh (seconds long) from raising the banner. It closes the flag itself once every row has a profile.
- `readRefreshState()` returns `null` once `updated_at` is older than `REFRESH_STALE_MS` (4 min), so an admin closing the tab mid-backfill can't pin the notice up forever.
- **`endRefresh()` returns the run it cleared, or `null`.** Both the natural finish and the client's `DELETE` land there, and only the caller whose `delete` actually removed a row gets the state back — that is what stops one run sending two report emails. Anything hung off completion must go through its return value, not just call it.
- `GET /api/status` is a cheap poll for viewers — every open page hits it every 30s while a refresh runs, so it deliberately does not return the snapshot. When the flag clears the page pulls the finished data on its own.

## Charts and the stock page
Charts are hand-rolled inline SVG in `rowcard.js` — no library, no build step. `chartSVG(closes)` returns `{ svg, log }`.

- **The y-axis goes logarithmic above a 4× range.** MU ran from $1.69 to $932, so on a linear axis nineteen of twenty years flatten onto the floor and only the last month is visible. The caption says "log scale" when it happens, because an unmarked log axis misleads. A single year rarely trips it, so the default view stays linear.
- **The chart window is 253 bars, not 252.** A change is measured across the *gaps* between bars, so matching `pctChange(values, ONE_YEAR)` — bar 0 against bar 252 — needs one bar more than there are intervals. One short and the headline disagreed with the card's own 1Y row by 27 points on a name that gapped on earnings a year ago.
- **`/api/history` reads the archive only** — no API call, so it costs nothing and works for members. It returns `dates`, `closes` and `volumes`; ~1.9 KB for a year of closes. Fetched per symbol on hover and cached by `symbol|days`, so the card never waits on the network to appear. **The `days` floor is 2**, because the stock page's shortest range is a trading week — it was 20, which silently returned 20 bars for a 1W request.
- **No area fill — the price is a stroked line only.** Keep `fill` off `.ln`: the stroke and fill rules are deliberately *not* grouped, because setting `fill` on the line path closes it back to its start and paints a filled wedge. The area path masked that for a while.
- **`chartSVG(closes, { volumes, ticks })` draws volume bars and price gridlines**; without them it is a plain line. It returns `{ svg, log, ticks }`, each tick carrying `top` as a fraction of the viewBox so the caller can place an HTML label at the same height.
- **The price axis replaced the floating high/low captions** on the stock page — with real gridlines the two said the same thing twice. Ticks are evenly spaced along whichever scale is in use and rounded to significant figures; even spacing beats round numbers, because on a log axis round values land unevenly and the gridlines look accidental. The hover card passes none — at 104px there is no room — so the two surfaces share one function without the card becoming cramped. Bars are scaled to the largest in view, not an absolute, so a quiet stretch still shows its own shape, and each is green or red by whether that session closed above the one before it.
- **Axis labels are HTML, not SVG text.** The chart stretches with `preserveAspectRatio="none"`, which would distort any glyph inside it. The same reason the price captions are absolutely-positioned spans, anchored by percentage to the bands they describe rather than to the box.
- **Stock page ranges are 1W/2W/1M/3M/6M/1Y/5Y/Max** in trading days (5/10/21/63/126/253/1260/5200).
- **The symbol in the masthead is the stock picker.** Clicking it opens a filtered list of the whole universe, alphabetically, matching on symbol *or* company name. It is styled as the heading it replaced — only the caret says it opens — so the page gained navigation without gaining a control or a row.
  - **The list comes from `universe` on `/api/stock`**, `[{symbol, name}]`. That route already holds the whole snapshot in memory to work out the rank, so the field costs a `map` and ~3 KB rather than a query or a second request.
  - **Selecting navigates (`location.href`) rather than swapping in place**: back and forward keep working, and the per-symbol history fetch dominates the timing anyway.
  - Arrow keys move, Enter goes, Escape and an outside click close. On open the current symbol is the active row and is scrolled to **`center`**; arrowing uses `nearest`, so the list moves as little as possible.
- **The sector/portfolio/rank chips sit inside `.head`, not on a row of their own.** A separate band cost 26px plus 30px of margins and pushed the chart 265px down the page; inline they cost nothing above ~900px wide and simply wrap below it.
- **Indicators stack as panes below the price, in the order RSI then volume** — RSI is 0–100 and price is in currency, so it cannot share the price axis. Turning a pane on **grows the chart** (viewBox 213 → 270, and the CSS height 320 → 406px in the same proportion) rather than squeezing the price panel: the svg stretches with `preserveAspectRatio="none"`, so a taller viewBox alone would just squash every band.
- **`chartSVG` returns `panes`**, each with `top`/`bottom` as fractions of the viewBox, so the caller positions HTML labels against real geometry. The volume label moves down on its own when RSI appears — an earlier hardcoded percentage had to be fixed once already.
- **Those fractions are of the viewBox, and the svg does not fill the box** — 18px at the bottom is reserved for the date axis. Every pane label therefore goes through `atY()`, which converts with `calc(f * (100% - 18px))`. A raw `top: %` lands things progressively low and pushed the oversold label clean out of its pane.
- **The chart has a hover crosshair** — a dotted line, a dot on the price, a date pill on the axis, and a readout of price, day change, volume and RSI. All of it is HTML overlaid on the svg, never drawn inside it: `preserveAspectRatio="none"` would stretch the dot into an ellipse and distort any text. `panes.price.at(v)` exists so the dot can sit on the line without the caller knowing whether the scale is log or linear. The static change caption and MA legend fade while hovering, so the top-left says one thing at a time.
- **`priceTicks()` returns low-to-high**, so in the DOM the *first* axis label is the bottom of the scale and the *last* is the top — the reverse of reading order. The end-clamping rules were briefly backwards and pushed the top label 6px above the chart, where `overflow: hidden` ate it.
- **The RSI band is taller than the volume band** (58 vs 44 viewBox units) because it carries threshold lines with words above and below them, where volume only needs bars. It also paints its own `.pane-bg`, a shade off the chart's ground, so the indicator reads as a separate instrument. 70 is red and 30 is green — the colours mean overbought and oversold; 50 stays neutral because it is only an anchor for the eye.
- **`RowCard.rsiSeries()` uses Wilder smoothing**, matching `rsi()` in server.js. Wilder is an exponential average and converges slowly, so it is computed over the padded window and sliced. Cross-checked against the screener's own RSI column for six symbols: **gap 0.000**, at both 300- and 453-bar warm-ups.
- MACD is the obvious next pane and is already computed per row (`macdLine`, `macdSignal`, `macdHist`); adding it is a pane entry rather than a rewrite.
- **Moving averages are a list (`MAS` in stock.html), 50-day and 200-day.** Adding another is one entry there plus a colour in `app.css`.
  - **The page fetches `range.days + MA_PAD`**, padded by the *longest* average rather than by whichever are switched on, so toggling redraws from the cache instead of refetching. Without the run-up a line would start 200 sessions late and leave a gap at the left edge; with it, even the 1M view draws both averages as unbroken paths.
  - **Overlays are folded into the y-scale.** An average sits above a falling price and below a rising one, so scaling to the price alone clips it. A `null` breaks the path rather than joining across the gap.
  - `RowCard.sma()` is exported for it. Cross-checked against the screener's own `vs50ma` and `vs200ma` for six symbols: exact agreement, gap 0.000 on both.
- **`.rc-*` classes are unscoped in `app.css`**; only the floating container is tied to `#rowcard`. The hover card and `/stock/<SYMBOL>` render the same sections from the same `FIELD_SPEC` via `RowCard.buildSections()` — a third copy of the field list is exactly what the row card existed to prevent.
- **`GROUP_COLORS` / `GROUP_LABELS` now live in `rowcard.js`** and are exported. `index.html` still keeps its own copy because it also colours the table's group banners and the columns menu, so **those two must stay in step**.
- The name cell links to `/stock/<SYMBOL>` on **both** the screener and the analysis page; the symbol cell still links out to Google Finance. All of them open in a new tab (`target="_blank" rel="noopener"`), so a click never loses your place in the list. `.namelink` lives in `app.css` because two pages use it; only the frozen-column truncation (`td.frz1 .namelink`) stays in index.html. `.namelink` inherits its colour and only underlines on hover — 69 rows of blue underlines would wreck the table.

## Bar archive
The `bars` table keeps one row per symbol per trading day (`open/high/low/close/volume`, keyed on `(symbol, d)`). **Currently 241,022 rows across 69 symbols, 2006-05-25 → 2026-08-28.**

**It costs no API credits.** Every refresh already fetches ~300 daily bars per symbol and discards them; `persistBars()` writes them instead. Twelve Data charges **1 credit per symbol regardless of `outputsize`** — measured, `Api-Credits-Request: 1` for 5000 bars — which is why the deep backfill was affordable in the first place.

- **`backfill-bars.js` is a local script, not a route.** 5000 bars is ~580 KB per symbol and ~40 MB across the universe: fine locally, far past what a serverless function should hold. Same one-off pattern as `migrate-to-turso.js`, dry-run by default.
- **Writes are incremental, not wholesale.** `persistBars()` upserts only bars newer than the stored `max(d)` plus a `BAR_OVERLAP` of 5. Steady state is a handful of rows per symbol per refresh, not 300.
- **The overlap is not decoration.** Twelve Data returns a bar for *today* while the market is open, with the current price as its close, so a mid-session refresh stores a provisional value. Re-upserting the recent window replaces it with the settled close. Measured drift on a real pull: 0.003–0.007%.
- **Splits are detected, not ignored.** A split re-prices all of history, so a stored bar `SPLIT_PROBE_BARS` (60) back would silently disagree with the fetched one and leave a phantom cliff in any chart. `persistBars()` compares that one bar per symbol — one query for the whole universe, since US symbols share trading days — and rewrites the symbol in full when it differs by more than `SPLIT_TOLERANCE` (0.5%). Re-running `backfill-bars.js --only SYM` is the manual repair.
- **Backtests must never write.** `computeStocks(asOf)` fetches a truncated range; persisting from it would corrupt the archive. Guarded by `if (!asOf)`, the same rule the snapshot uses.
- **A failed archive write never fails the refresh** — it is caught and logged. The screener is the product; the archive is a by-product.
- `open` is stored although nothing reads it yet. `high`/`low` drive the 52-week range and `volume` the volume trend, so an archive without them could draw a chart but not reproduce the screener — which is the point of keeping it.

## The nightly job
`.github/workflows/nightly-refresh.yml` runs a full Refresh all at **00:00 UTC** — 8PM Eastern in summer, 7PM in winter. Both are after the 4PM close, which is the part that matters; the hour of drift is deliberate rather than worth a second cron entry and a timezone guard.

**A runner, not a Vercel cron, because a full pass takes ~13 minutes** and no serverless function stays alive that long. The workflow drives exactly the loop the browser drives.

- **`POST /api/cron/refresh`** is the job's only endpoint, authenticated by `Authorization: Bearer $CRON_SECRET`. Deliberately **not** admin: the secret satisfies that one route, so a leak cannot delete a portfolio. Unset leaves the route closed, not open. `?start=1` expires the cache and raises the flag; every later call runs one round. `DELETE` on the same path ends a run early and reports what it got.
- **The 62-second gap between rounds is not conservatism — it is measured.** Two rounds inside one minute returned *"1128 API credits were used, with the current limit being 610"*. A round costs roughly **560 credits**, nearly all of it the batched `time_series`, so the plan allows about one round per minute and the loop cannot be collapsed into a single call. Don't lower `GAP` without measuring again.
- The job stops after 3 rounds without progress, same as the browser loop, and cleans up the flag on its way out.
- Repository secrets required: `APP_URL`, `CRON_SECRET`.

### The refresh report
**Both kinds of refresh email the owner** — a Refresh all and an ordinary price Refresh — **whoever started it**, the job or the button. The Refresh all path hangs off `endRefresh()` rather than the cron route, because both ways of finishing one converge there.

- **Which report goes out is decided by whether a run was live a moment earlier, not by what the `delete` returned.** `endRefresh()` runs either way so a flag left stale by an abandoned run gets cleared, but a *stalled* Refresh all still reports nothing, and the click that happens to complete the universe is reported as the ordinary Refresh it was.
- **An ordinary Refresh has no `refresh_state` row**, so `/api/stocks` passes its own `startedAt` and actor into `finishLiveRefresh()` as `ctx`. No `ctx`, no plain report — which is what keeps the nightly job's dozen rounds quiet.
- **The plain report says `Fundamentals: not re-pulled — prices only`.** A price Refresh reuses cached profiles, so presenting the fundamentals as fresh would make the mail actively misleading. It is judged on failed symbols alone; coverage is a Refresh all's measure, and "no profile yet" is omitted entirely.
- **Every click of Refresh sends one.** There is no throttle — add a floor if it gets noisy.

- **Receipt**: run time first and largest, then the start and finish clock times, actor, `n/total` coverage, failed symbols, symbols still without a profile, prices-as-of, fundamentals rows recorded, bar-archive size and through-date. The duration leads because it is the number that says whether the night went normally — a Refresh all that finishes in seconds did not really run.
- **Clock times are rendered in `REPORT_TZ`, defaulting to `America/New_York`** — the runner is UTC and the reader is not. `fmtClock()` uses explicit `month`/`day`/`hour` components rather than `dateStyle`/`timeStyle`, because ECMA-402 refuses to combine those with `timeZoneName` and the throw lands in the fallback, which would quietly print UTC instead of saying so.
- **Digest**: the seven screens run against the fresh snapshot, the day's five best and worst movers, and the highest Overall ratings.
- A run that *stalls* sends nothing — nobody calls `endRefresh()` and the flag ages out on its own. The cron job covers that case, since it is the thing still awake.
- `REPORT_TO` overrides the destination; unset it falls back to the owner account's email, so it works before anything is configured.
- **Fundamentals rows are dated by `marketDay(rows)`** — the freshest bar in the universe, not the server clock. At 8PM Eastern the server's UTC date is already tomorrow, so dating by `new Date()` would file every automated run one day ahead of the bars it was computed from.

## Chatbot
`/chat` answers questions about the screener data. Open to **any signed-in user** (`requireAuth`), with the allowance set by role.

**The whole dataset goes in the system prompt — there is no retrieval layer, and adding one would make it worse.** Measured against the live API, not estimated: the system prompt is **~17,500 tokens** for 69 stocks, roughly 250 per stock. (A bytes/4 estimate said 7,400 — it underestimates dense numeric CSV by well over 2x, so trust `usage` in a real response, not arithmetic on the payload.) That still fits a 200k context about eleven times over and stays viable past 700 stocks, well beyond the 119-ticker ceiling the price API imposes. Embeddings are the wrong tool twice: the data is a numeric table where "margin above 15%" is an exact filter rather than a similarity, and retrieval could only drop rows the answer needs.

- **`cache_control` sits on the data block, which caches everything before it too** — so the rules block rides along and the whole system prompt is cached. A real call showed `cache_read_input_tokens: 17470` against `input_tokens: 31`: after the first question, all you pay for is the question and the answer.
- **`max_tokens` must cover the model's reasoning, not just the reply.** At 1200 a ranking question spent the entire budget thinking and came back with a single `thinking` block and no text at all — a silent empty answer. It is 6000 now. The reasoning is worth paying for: working through 69 rows is exactly where a model miscounts. `stop_reason === 'max_tokens'` is reported to the user as "ask something narrower" rather than a generic failure.
- **`CHAT_FIELDS` is the glossary and the column list at once.** Adding a column to the bot means adding one entry there — nothing else. Fields absent from older snapshots simply come through blank.
- **Derived values are computed server-side on purpose** (`fcfYield`, `netCashPct`, all three margins, `range52Pos`). Asking a model to divide across 69 rows is where it goes wrong, so the prompt tells it to use the column rather than re-derive it.
- **Four behavioural rules live in `chatRules()`**, and they are the actual product: name the specific gap and redirect rather than refusing bare; general finance and company knowledge is fine but flagged as background; no buy/sell/hold verdicts (declined for the same reason as any unsupported claim, *not* as a standing disclaimer); "will it go up" is unknowable rather than missing. The prompt lists what the data does **not** contain — a general "say you don't know" instruction does not stop confabulation, an explicit inventory does.
- **Quota lives in `chat_usage`** (one row per user per UTC day), because an in-memory counter cannot work when consecutive requests need not share a process. It is charged only after the config and validation checks, so a malformed request cannot burn it, and the 429 is returned before any API call — a member over their limit costs nothing.
- **Two ceilings:** `CHAT_DAILY_LIMIT` (60) for the owner, `CHAT_DAILY_LIMIT_MEMBER` (3) for everyone else. The owner pays for the key and does the prompt tuning; members get enough to be useful. **Keyed on the account**, so a shared login shares the allowance rather than multiplying it. With the current roster that caps daily exposure at 60 + 3 per member.
- **Upstream errors are never echoed to the client** — the response body can restate the request, and the API key travels in the same headers.
- Not streaming yet. Responses are a few seconds behind a "thinking" indicator; streaming is the obvious next step but could not be verified against Vercel from here.
- `public/chat.html` carries a ~60-line markdown renderer for the reply (tables, lists, headings, bold/italic/code). **It escapes HTML before applying any markdown**, so nothing a model returns can inject markup.

**Gated pages are no longer served raw.** `public/` is mounted wholesale, which used to hand out `/chat.html`, `/analysis.html` and `/visitors.html` at their file path and skip the guard. `GATED_PAGES` redirects those to the routed path.

## Analysis screens
**The seven predicates live in `public/screens.js`, not in the page.** `analysis.html` loads it with a `<script>` tag and `server.js` `require`s it, so the nightly report and the page can never disagree about what "bouncing off the lows" means — the same reason `rowcard.js` exists. Only the *selection* is shared (which rows, in what order); the columns, the prose and the empty messages stay with whichever surface is drawing them. Verified equivalent against the live universe on extraction: all seven lists identical, order included.

`/analysis` is seven filtered views built from the **raw fields, not the composite scores** — the scores already drive the table's ranking, and a screen that just re-sorts them adds nothing. Every threshold below was set by running the candidate against the live universe: a screen returning 0 names is a dead box, and one returning 25 of 69 is not a signal.

| screen | rule | hits when set |
|---|---|---|
| Bouncing off the lows | `range52Pos ≤ 30` (or `pctFromHigh ≤ −25`), `1M > 3%`, `2W > 0` | 5 |
| Just started moving | `2W > 5%` while `3M < 0` | 2 |
| Drifting after a beat | surprise 10–100%, reported ≤ 21d | 2 |
| Reporting in 14 days | unchanged | 4 |
| Cheap, growing, profitable | fwd P/E < 20, rev > 15%, margin > 15% | 13 |
| Business improving, price isn't | rev > 25%, `3M < −10%` | 13 |
| Overextended | RSI > 75 and > 12% above the 50-day | 2 |

- **`range52Pos`** (0 = on the 52-week low, 100 = on the high) and **`pctFromLow`** are derived in `computeStocks()` from bars already fetched, so they cost no credits. Snapshots written before they existed fall back to `pctFromHigh ≤ −25`, and the section prints a note saying so. **The `≤ 30` threshold is unverified against real range data** — it was tuned on the fallback — so expect to adjust that one number after the first refresh.
- **Earnings surprises above 100% are excluded** as feed artefacts. Two different mega-caps currently report *exactly* +214%, which is a data bug rather than a coincidence; without the cap they would top the drift screen.
- **`netCash` is meaningless for financials** — if a balance-sheet screen is ever added, exclude the Financial Services sector, or JPM and HOOD will lead it.
- `analystConsensus`, `targetUpside` and the forward estimates are **0/69** on the current plan, so nothing can be built on them.
- Two removed screens ("Good business, price not working" / "Price working, business not") keyed off Quality and Momentum ratings; "Business improving, price isn't" is the same idea on raw revenue growth. "Deepest drawdowns" went too — it is the bounce screen's population without the part that matters, whether the thing has turned.

## API patterns
- `GET /api/stocks` — serves snapshot to public; `?refresh=1` recomputes live (admin only)
- `GET /api/stocks?asOf=YYYY-MM-DD` — backtest mode (admin only)
- `POST /api/refresh-all` — expires the profile cache, forces re-pull (admin only); `DELETE` ends the refresh flag
- `GET /api/status` — `{ refreshing }` only; polled by every open page during a refresh
- `POST /api/cron/refresh` — the nightly job's one round (bearer `CRON_SECRET`, not admin); `?start=1` begins a run, `DELETE` ends one early
- All portfolio/ticker CRUD routes require admin

## Conventions
- All persistence goes through `db.js` — never reintroduce `fs` reads/writes for state; a serverless filesystem discards them
- No build step — vanilla JS, plain CSS. The design system lives in `public/app.css`; each page keeps only its own layout in one inline `<style>` block
- Admin-only UI elements use class `admin-only` — toggled by `applyAdminUI()` in index.html
- The CSV export column order is deliberately *not* kept in sync with the on-screen column order, so saved exports stay stable
