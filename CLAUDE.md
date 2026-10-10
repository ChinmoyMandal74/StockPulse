# StockPulse — Claude Code Context

**This file is deliberately short.** It is loaded in full at the start of every session; on 2026-10-09 it had grown to 1.4 MB and sessions stopped starting. The detail now lives in `docs/context/<topic>.md`, one file per area, indexed at the bottom.

- **Before changing an area, read its file in `docs/context/`.** The large ones (100 KB+) are build logs: grep them for the function or field you are touching rather than reading them whole.
- **New notes go in `docs/context/`, not here.** Add to this file only a rule that applies project-wide, in a line or two. Keep it under about 300 lines.
- The repository is **public**: this file, `docs/` and every commit message are world-readable.

## What this is
A stock screener. Every symbol in the universe is measured the same way after every close — returns, trend, relative and volume readings, company fundamentals, and a mechanical **Signal** that names the one rule that fired. State lives in **Turso** (hosted libSQL/SQLite, the SQLite fork — not the Rust engine rewrite). Price and fundamentals data come from the Twelve Data API (Pro plan). The owner (admin) manages the universe and refreshes data; members see a read-only cached snapshot; guests see twenty symbols.

The repo/folder is `StockPulse`; the app is branded **Tickr Lab** in the UI. Production is `https://www.tickrlab.com` on Vercel.

The universe is hand-edited and every count written down anywhere is a snapshot — ask `node --use-system-ca analysis-db.js --stats`. The screener is descriptive, not predictive: eleven backtest framings have been tried and ten came back flat. **Read `docs/context/does-any-of-this-predict-anything.md` before designing any backtest**, and `docs/backlog.md` before proposing new work — it may already be there with numbers attached.

## Running the app
```
node --use-system-ca server.js
```
Port 3000. Needs `.env` with `TWELVE_DATA_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD` (unset means fully open, everyone admin).

**The local server talks to the PRODUCTION database and spends real API credits.** `computeStocks()` calls `ensureProfiles()`, which re-pulls stale profiles and rewrites `profiles` and `snapshot`. To look at frontend changes only, serve the page with a throwaway static server instead — it falls back to admin-open mode when `/api/me` fails. Never boot a local server to do a scheduled job's work.

## Key files
| File | Purpose |
|---|---|
| `server.js` | Express backend — every route, auth, data computation |
| `db.js` | Turso persistence — every read and write goes through here |
| `private/action.js` | **The Signal rules** (`ActionRules`) — ordered lists, first match wins. Shared by server and browser |
| `action-test.js` | One case per rule. Run after touching any rule |
| `private/index.html` | The screener — single page, vanilla JS, no build step |
| `private/rowcard.js` | `FIELD_SPEC`, the one field catalogue, plus hover card and chart SVG. Feeds `/stock`, tiles, phone, `/compare` |
| `private/filters.js` | The column-filter grammar, defined once (`filterValue`, `screenRows`, `CAP_BANDS`) |
| `private/cards.js`, `private/cardshot.js` | Promo card templates (global `Cards`) and the one rasteriser |
| `private/stock.html`, `compare.html`, `basket.html`, `mobile.html` | `/stock/<SYM>`, `/compare/<A>/<B>`, the group page, the phone page `/m` |
| `public/app.css` | Shared design system — tokens, bezel, buttons, table base |
| `barmath.js`, `techrow.js` | Indicators from bars alone; the one backtest row builder |
| `secfacts.js`, `insider.js`, `shortint.js`, `holdings.js`, `news.js` | Auxiliary data pulls (SEC filings, insiders, FINRA short interest, index membership, headlines) |
| `adjusted.js` | Filings-fed Signal overlay for `/adjusted` and `/adjustedbacktest` (admin research) |
| `analysis-db.js` | **Local SQLite copy of the archive for research.** `--full` rebuilds, no flag syncs, `--stats` reports |
| `strategy-runs.js`, `single-data.js`, `lab-grid.js` | Offline builders writing derived JSON into `private/` |
| `backfill-*.js`, `onboard.js`, `purge-orphans.js`, `*-load.js` | Local maintenance scripts — dry run by default, `--commit` to write |
| `nightly-ping.js`, `intraday-ping.js`, `news-ping.js` + `*-task.ps1` | The schedulers: Windows Task Scheduler on the owner's laptop, calling the deployed app over HTTP |
| `docs/backlog.md` | Work identified and deliberately not done |

`portfolios.json`, `snapshot.json`, `profiles.json`, `names.json`, `visitors.log` are legacy pre-migration backups; nothing reads them.

## Hard rules

**Deploys and serving**
- **Production deploys happen by `git push` to `main` only.** Never `vercel` CLI deploys. `vercel env add` is not a deploy; it takes effect on the next push.
- **`public/` is served by Vercel's CDN without running any code — nothing there can be protected.** Anything needing a session lives in `private/`, mounted at the root behind `gateAssets`. The offline builders write into `private/`.
- Vercel functions are stateless and are killed at about 300s. Nothing runs after the response: await every write that matters. Shared state lives in tables (`refresh_state`, `app_meta`), never process variables. Long work is one bounded batch per request with the caller looping.

**The Signal engine is sacrosanct** (the column was "Action", then "Advice", and is "Signal" since 2026-10-09)
- **Six words, one rule set.** Very Weak · Weak · Neutral · Strong – Elevated Risk · Strong · Very Strong (the dash is an en dash). They replaced Sell Immediately / Avoid / Hold / Buy with Risk / Buy / Strong Buy as a legal precaution: a reading of strength, not an instruction to trade. **Never reintroduce buy, sell or hold wording** on any surface, including card glosses and tooltips.
- **Stored rows still carry the old words** (`advice_state`, `tech_history`, old screens, alert sides). Anything read back from storage goes through `ActionRules.canon()` / `canonRow()`; a new read path of a stored verdict must too. Colour tests are `/Strong/` (up) and `/Weak/` (down).
- Only Balanced is offered. The other presets remain in `action.js`, unused; `Cards.ADV_PROFILES` is the one list of what is live.
- New data may feed display surfaces, never the verdict. Nothing new is read by `action.js` / `classify()`, stamped onto a snapshot row, or added to `CHAT_FIELDS` without an owner decision. Prove the boundary behaviourally (score with the field absent, present and lying; require identical verdicts), not by grep.
- The rules are first-match-wins ordered lists, not a score. Sell/Avoid/Hold rules sit above every Buy rule. Thresholds may move; order may not.
- Do not change verdict inputs at source to fix a display fault (`shortPctFloat`, `lastEarningsDate`, `nextEarningsDate`). Fix the display.
- No buy/sell recommendations, rankings, "winners" or price targets anywhere — pages, cards, chat, marketing. A verdict always travels with the rule that fired. The threshold ladder is admin-only.

**The universe**
- US-listed only. Pin provider lookups to `country=United States`; a bare symbol can resolve to a foreign exchange.
- Adding or removing a ticker is the owner's call. Report evidence; do not act. The `Faded` laggards are deliberate ballast against survivorship bias — never prune them.
- After a bulk add, run `backfill-bars.js --commit --rate 100 --only ...` before the next price refresh, or the refresh 504s.
- After any removal, rebuild in order: `analysis-db.js --full`, `single-data.js`, `strategy-runs.js`, `lab-grid.js`.

**Budgets**
- **Twelve Data: 610 credits a minute, hard.** Prices cost 1 per symbol; a profile about 80 (`/statistics` 50, `/earnings` 20); `/splits` 20. Two jobs in one minute breach it — every job stands aside for a running refresh, and nothing overlaps the nightly windows (07:30 and 19:30 Eastern) or the intraday slots (:15 and :45). Quote the cost before bulk work.
- **Adding a key to `emptyProfile()` makes every stored profile a gap and re-pulls the whole universe** (about 96,000 credits). Backfill first, through `mergeProfileFields()`.
- **Turso bills rows read.** No `group by`, `count(*)` or date-only scans over big tables (`bars`, `sec_facts`, `short_interest`, `fundamentals_history`, `tech_history`). Use per-symbol seeks on `(symbol, d)` as `closesBefore` does. Run `query-plan-test.js` after touching `db.js`; put any new big table on its list.
- Research runs against the local copy (`analysis-db.js`), never Turso.

**Data safety**
- All persistence goes through `db.js`. Never reintroduce `fs` reads or writes for state.
- Every async route is wrapped in `route()`; Express 4 does not catch async rejections. Routes using `requireAdmin` must be registered below its definition (`node --check` does not catch this; booting does).
- A schema statement in `db.js` is paid on every cold start: keep statements `if not exists` so `init()` can batch them.
- **Reads may be retried once; a write is never retried.**
- Irrecoverable if deleted: `fundamentals_history`, `advice_state`. `backfill-bars.js` replaces each symbol wholesale — always `--only`, never a shallow `--depth` over deep history.
- Any new per-symbol table goes in `SYMBOL_TABLES`. Any new stored data is listed on `/privacy` in the same commit.
- A restore or backfill must never pass through a transforming path (`cleanScreens`, `writeScreens`, `readProfiles`/`writeProfiles`). Use targeted writes. The sanitizers (`cleanScreens`, `cleanPosts`, `cleanPivots`, `cleanViews`) silently drop unknown keys and still answer `ok`.
- A failed fetch must not blank stored data, and a refused call is left unrecorded rather than written empty. Bookkeeping (history, run tracking, purge, mail log) never fails the main operation.
- Never add work to the refresh tail. Post-round phases go in `tailPhases()` and are non-fatal.

**Access**
- Four tiers: anonymous, guest (`GUEST_SYMBOLS`, 20), member, admin. Enforce in the route on every new endpoint; a hidden button is not security. Test auth changes as guest and as member.
- Gates default closed (`REQUIRE_APPROVAL`, `REQUIRE_TERMS`). No account enumeration. Never echo upstream error bodies to a client. Logs hold facts, never content.
- Research pages and the chatbot are admin only. Index-fund holdings weights never leave admin.

**Values**
- **Null is not zero.** `Number(null)` is 0: reject empty before coercing. A missing value is blank (em dash), sorts last, matches no comparison, and is never bucketed. `spMember` is three-state — compare `=== true` / `=== false`.
- Withhold rather than invent: a multiple off a loss is a dash, a missing return is absent, never 0.
- Only market cap is reliably USD. Other money fields are in the reporting currency — never sum or difference them across companies.
- Parse dates at local noon (`+'T12:00:00'`), never a bare `new Date('YYYY-MM-DD')` or `toISOString`.

## Area gotchas worth knowing up front
- **Adding a screener column** means editing, in step: header cell, body cell, the group banner `colspan`, `PAD_SPAN`, the error row (`PAD_SPAN - 5`), the empty row (`PAD_SPAN - 3`), the fund `naRun` count, and one `FIELD_SPEC` row. A miscount does not throw; it slides every later value one column over. A profile field reaches the row only if `computeStocks` names it. See `column-groups.md`.
- **Stored keys are never renamed** — group ids, `group|label` keys, card template ids, control ids, screen ids (exactly eight lowercase alphanumerics). Labels are free. Internal names still say `action` and `advice` where the UI says Signal; leave them. The field key is `act|Signal` (`act|Advice` is read as it).
- **Read-path stamps are a set** (`stampShortNames`, `stampAdviceAge`, `stampPricedAt`, `stampCapDerived`, `stampAthDistance`, `stampSpMember`, `stampPeerValue`). Any new read path applies all of them, each with its own catch.
- **`/api/stocks` re-derives the verdict; `/api/stock` serves the stored one.** Test fixtures differ accordingly.
- **Backtests:** one row builder (`techrow.js`); filter filings on `filed`, never `periodEnd`; the `bt*` helpers are shared by `/backtest` and `/adjustedbacktest`; `/backtest` has a two-month hard cap; maximum hold is one to two months (owner). If a result improves after the universe shrinks, suspect the universe.
- **SEC:** this address has already had a 429 then a 403. Declared `SEC_UA`, sequential fetches, a 429 is a wait, not a retry.
- **Promo cards:** a new control joins `CONTROL_IDS` and its template's hardcoded listener list in `promo.html`, under `POST_OPT_MAX`. A card needing data beyond the snapshot needs a `ctx` channel asked by both hosts (studio and `/api/m/post`).
- **Scheduled tasks:** the `.ps1` script and the live `TickrLab *` task must match; `.ps1` files are ASCII only. The ping scripts are HTTP calls and must never become `node server.js`.
- **Mail:** every send goes through `sendMail`/`sendMailResult` with a `kind`. No email in the alerts feature. Bulk and transactional mail never share a send path.
- **User-facing copy restates facts from code** (`/help`, `/terms`, `/privacy`, landing, `/architecture`). A claim leaves with the feature, in the same commit.

## Testing and tooling on this machine
- **Prove every guard by reverting it.** "0 failed" can mean the suite aborted — check the count of checks that ran.
- Assert what is drawn (`getBoundingClientRect`, computed colour), not markup or stored state. Fixtures use real payload shapes and production-length names; probe thresholds on both sides.
- Every harness boots a server on port 3999: run one suite at a time. `uni-boot.js` defaults `ADMIN_PASSWORD` to `''` (open mode), `REQUIRE_TERMS` false and `NEWS_PROVIDER` off. The first account registered becomes admin.
- **Local tests can write to the production database.** Restore through a path that cannot transform data.
- `server.js`, `db.js` and `index.html` can be CRLF on disk and `git stash` flips endings. Patch anchors must be single-line and hit exactly once.
- Use the Write/Edit tools, not heredocs or `sed -i`, for anything with backslashes or backticks. No backticks inside `Cards.STYLE` or SQL comments in `db.js` (both are template literals). `python3` does not exist here. `| tail` hides exit codes — judge a build by its artefact.

## Conventions
- No build step: vanilla JS, plain CSS. The design system is `public/app.css`; each page keeps only its own layout in one inline `<style>` block. Dark only. No emoji, icon fonts or company logos.
- One implementation per concept, in a shared module loaded by page, server and phone. Never a second copy in a page.
- Scope every new CSS selector; unscoped classes (`.warn`, `.card`, `.sub`) have captured later markup nine times.
- Green and red mean price up and down only. Amber means "notice this, it is stale or wrong". Other series use accent, blue or orange.
- On the screener the page never scrolls; anything that appears above the table calls `paintWindow(true)`. Labels over a stretched SVG are HTML overlays, never SVG text.
- Admin-only UI uses class `admin-only`, toggled by `applyAdminUI()`. The page-level escaper in `index.html` is `we()`.
- No new dependencies for small jobs.

## Index — `docs/context/`
Verbatim sections of the old file. Three headings also hold unrelated material, noted below.

**Foundations** — `what-this-is` · `running-the-app` · `key-files` · `persistence` · `deploys` · `serving-and-the-gate` · `api-patterns` · `conventions` · `feature-flags-in-env`

**Accounts and mail** — `auth-model` · `email` · `alerts` · `the-admin-announcement` · `activity-logging` · `visitor-logging` · `member-portfolios` · `saved-column-layout`

**Screener front end** — `frontend-layout` · `design-system` · `table-specifics` · `column-groups` (190 KB: every column, plus tiles, views, the filter row, hidden columns) · `screens` · `analysis-screens` (retired) · `the-awesome-oscillator`

**Fundamentals and the universe** — `fundamentals-data` · `scores-ratings` · `everything-the-profile-call-returns-is-kept-now` · `fundamentals-history` · `which-dates-the-fundamentals-actually-describe` · `the-universe-and-the-ballast-that-has-been-draining-out-of-it` · `the-universe-table` · `adding-a-stock` · `dropping-a-symbol` · `editing-portfolios-does-not-pull` · `the-nasdaq-reference-list`

**Refreshing** — `the-refresh-budget` · `a-live-price-pull-is-shallow` · `fast-refresh` · `fill-missing` · `intraday-price-refreshes` · `refresh-runs` · `refresh-state` · `the-nightly-job` · `bar-archive` · `price-as-of`

**Signal and research** (file names keep the old word) — `the-advice-column` · `does-any-of-this-predict-anything` · `the-advice-backtest` · `adjusted-advice` · `the-adjusted-backtest` · `the-trend-only-backtest` · `the-strategy-backtest` · `the-single-stock-strategy` · `the-indicator-lab`

**Regulatory and auxiliary data** — `sec-edgar` (140 KB: also insiders, FINRA short interest, index membership, the add-gate, the FUND/EARN/SHORT chart strips) · `the-sec-edgar-data-page` · `news` · `logos` (removed)

**Stock, group and comparison pages** — `charts-and-the-stock-page` · `earnings-history-on-the-stock-page` · `similar-stocks` · `against-its-peers` · `growth-and-profitability` (also promo template grouping and split history) · `the-basket-page` · `the-compare-page` · `the-pivot-view` · `consolidated` · `the-phone-page`

**Promo studio** — `the-promo-studio` (also seven refresh post-mortems) · `cards-and-the-module-behind-them` · `the-promo-studio-cards` (180 KB) · `the-promo-studio-cards-2` (105 KB) · `the-industries-card` (also the Sector cards) · `evolution-two-stocks` · `saved-posts`

**Admin pages and the public side** — `the-admin-console` · `the-architecture-diagram` · `the-build-log` · `the-data-quality-page` · `the-database-page` · `the-help-page` · `the-public-side` · `chatbot`

Also in `docs/`: `backlog.md`, `momentum-scoring.md`, `momentum-delta.md`.
