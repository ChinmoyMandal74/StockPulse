## Persistence (Turso)
Everything goes through `db.js`. Tables: `portfolios`, `portfolio_tickers`, `names`, `profiles`, `snapshot`, `visitors`.

- **The accessor names are unchanged** from the flat-file era (`readPortfolios`, `writeProfiles`, …) and return the same shapes, so call sites only gained an `await`. `server.js` destructures them from `db.js`.
- **Writes are whole-collection replaces** — delete-then-insert inside one `db.batch`. That mirrors the old "rewrite the file" semantics and keeps `writeProfiles({})` working as the cache-clear `/api/refresh-all` depends on. Fine at tens of rows; revisit if the universe grows.
- **Portfolio order is an explicit `position` column.** The UI colours portfolios by index, so order has to survive the round trip — don't rely on insertion order.
- **`profiles.data` is a JSON blob** because it caches a third-party response whose shape we don't control. `fetched_at` is lifted into its own indexed column because the 24h TTL check runs against it every refresh.
- **`/api/visitors` aggregates in SQL** now (counts + `LIMIT 500`), instead of parsing the whole log into memory on every request.
- **`/api/refresh-all` expires profiles, it does not delete them** (`expireProfiles()` sets `fetched_at = 0`). Deleting them used to strip sector, market cap and fundamentals out of the shared snapshot for the ten-odd minutes the backfill ran, so every other viewer saw the holes. `readProfiles()` treats `0` as "keep the values, drop the timestamp": the row still renders, and `ensureProfiles()` still re-pulls it. **The blob also carries a `fetchedAt`, so the column has to override it** — otherwise the stale copy inside the JSON makes an expired profile look fresh.
- **Express 4 does not catch async handler rejections.** Every async route is wrapped in the `route()` helper near the top of `server.js`, which turns a database error into a 500 instead of a hung request. Any new async route must use it.
- **WHICH TURSO: the hosted libSQL service, not the Rust rewrite — probed against production 2026-10-05.** `select sqlite_version()` answers **3.47.0** and `libsql_version()` does not exist, so this is the SQLite **fork**; `@tursodatabase/serverless` 1.4.0 talks to it over HTTP at a `libsql://` URL. The two products share a brand and a version line, and **"Turso 0.8" is the ENGINE rewrite (formerly Limbo) whose release notes do not describe what this database runs** — worth knowing before reading a feature announcement as available here. What production already has, asked rather than assumed: window functions including `ntile`, `WITH RECURSIVE`, `NULLS FIRST`/`NULLS LAST` and `jsonb`. Two things to watch if the hosting ever moves to that engine: `explain query plan` returns classic TEXT rows, which is the shape `query-plan-test.js` parses, and `BEGIN CONCURRENT` is irrelevant here either way — every write is one `db.batch` from a serverless function, so there is no connection contending with another.

### `init()` runs on EVERY cold start, and it is the floor under every response
**A schema statement added to `db.js` is not free — it is a round trip paid before the instance can answer anything (2026-09-18).** `init()` ran 46 `SCHEMA` statements and 36 `ADDED_COLUMNS` sequentially: measured against the live database, **46 sequential is 1.72s and the same 46 in one batch is 0.04s**. It is a batch now — safe because every schema statement is `if not exists`, which `init-test.js` asserts rather than assumes, since a batch is all-or-nothing and one "already exists" would sink the lot. The old per-statement tolerance stays as a fallback for the real race it was written for (2026-09-14, every instance that lost it cached its rejected init and served 500s until recycled).

- **The ALTERs cannot be batched.** `alter table add column` throws "duplicate column" on every boot after the first — 36 guaranteed failures a cold start. Ask what the columns ARE instead, in one read batch of `pragma_table_info`, and run only what is genuinely missing. Normally that is nothing.
- **How it showed: a long refresh makes every OTHER tab cold.** With a Fill missing running, `/api/stocks` on a second tab took 41.6s, 9.4s and 81.5s to first byte while `/api/status` stayed at 0.14-0.16s. The long run holds the warm instance for its whole duration, so everything else lands on a new one. Timing each read this path makes from a laptop against the same production database showed the database was never the bottleneck (`readSnapshot` 0.31s, the four smaller reads 0.05-0.07s each) — **an unexplained slowdown that a direct query cannot reproduce is a cold-start cost, not a query cost.**
- Two round trips per cold start now, against 82.

### A DROPPED CONNECTION IS RETRIED ONCE, AND ONLY ON A READ (2026-10-04, owner: "what is this error")
**Reported as a 500 on `/adjustedbacktest` and read as a bug in the backtest. It was the database.** The stack, pulled from the live Vercel log:

```
GET /api/adjusted-backtest?date=2021-01-04&... failed: LibsqlError: fetch failed
    at LibSQLClient.batch
    at async Object.readSecFactsSince (db.js:2279)
    at async Promise.all (index 1)
  cause: TypeError: fetch failed
    cause: SocketError: other side closed  (UND_ERR_SOCKET)
```

Turso closed the TLS socket part-way through one of that read's chunked batches. It is **one of six reads the adjusted backtest runs CONCURRENTLY**, so the `Promise.all` rejected and the whole **thirty-five-second** computation was thrown away. Measured by hammering production: **one failure in sixteen cold runs**, no pattern in the date or any control — the same query succeeded on the next two attempts, and ten other cold runs (including four at once) were clean.

#### WHY A RETRY IS SAFE HERE AND IS NOT SAFE IN GENERAL
`fetchJson`'s rule for Twelve Data is *retry only when the attempt provably did nothing*, because a charged call retried breaches the credit ceiling. The database question is whether the statement **may already have been applied** when the socket died — and for a `select` the answer cannot matter, because running it twice changes nothing. For a write it does matter and is unknowable from here, so **a write is never retried**: most of ours are idempotent upserts, but `chat_usage` and the signup throttle are `set n = n + 1`, and a silent double-count is exactly the kind of wrong nobody would ever notice.

- **THE TEST IS THE SQL, never a flag a caller passes** — every statement in the call must begin `select`, `pragma` or `with`. The same mechanical guard the production write-block harness used. A caller cannot forget to opt in, and cannot opt a write in by mistake. **Proved by reverting**: `readOnly = () => true` fails 3, including a mixed batch where one insert sits among selects.
- **AN EMPTY BATCH IS NOT A READ.** `every` on `[]` is true, so the obvious guard says yes to nothing — and there is nothing to re-run. **Proved by reverting**: fails 1.
- **THE CAUSE CHAIN IS WALKED, because the code that names the drop is three levels down**: libSQL's `LibsqlError` wraps undici's `TypeError`, which wraps the `SocketError` carrying `UND_ERR_SOCKET`. A top-level message test finds nothing on the real error. Bounded at eight hops so a self-referential chain cannot spin. **Proved by reverting**: one hop fails 1.
- **ONE retry, deliberately.** A second drop inside a second is a database that is down rather than a blip, and the caller is better served by an error than by a page that takes another thirty-five seconds to fail. **Proved by reverting**: a loop fails 5.
- **`withDeadline`'s own throw must NOT match** — it reads *"… did not answer within 60s"*, and retrying a timeout would re-run the work the deadline exists to abandon. There is a check on that exact string.
- The retry is **logged, not swallowed**: a rising count is a database problem, and a retry nobody can see is a symptom hidden rather than fixed.

#### "Server error. Please try again." IS WHAT MADE IT READ AS A BUG
`route()` turns every exception into one sentence, so a reader cannot tell a network blip from a fault in the page — which is why this was reported rather than retried. It now says the connection dropped and that nothing is wrong with what was asked for. **The words are OURS, never the driver's**: an upstream message can restate the query, and the auth token travels in the same request. A check asserts no `libsql`, `UND_ERR`, `SocketError` or SQL reaches the body.

- **What reaches that catch now is a write, or a second drop** — the read retry handles the rest.
- **The exposure was never specific to this page.** `/api/stocks` makes six parallel reads too; the adjusted backtest is simply the most exposed, because its reads are by far the longest-lived.

- Verified: **23 checks**. The fixture is the REAL error shape — a `LibsqlError` wrapping a `TypeError` wrapping a `SocketError` — because a hand-made `new Error('fetch failed')` passes the message test and proves nothing about the walk, which is where the code actually lives. Drops are **counted at the stub client**, so a retry is counted rather than inferred from the result. **Proved by reverting seven times**, every one load-bearing.
  - **A ROUTE THAT IS BROKEN IN THE FIXTURE READS AS A BROKEN GUARD.** The end-to-end check first used `/api/stocks`, which 500s in `uni-boot` for its own reasons (no API key, empty snapshot) — so a working retry reported as a failure. Every such check now asserts a **baseline with nothing armed** first.
  - **TWO DROPS WERE NOT ENOUGH TO REACH `route()`, and that is a feature of the route.** `/api/portfolios` reads five times and **tolerates one read failing on purpose** — `serveStamps` catches per stamp so a slow auxiliary read costs one field rather than the page. The fixture has to take the database away entirely.
  - **AN UNGUARDED `await` IN THE SUITE TURNED A LOAD-BEARING REVERT INTO "0 failed".** With the retry removed the read THROWS, the run ended at check 5 of 23, and the harness reported the whole fix as not load-bearing. Every read in the suite is defensive now, and the harness prints `?? only N of 23 ran`.

