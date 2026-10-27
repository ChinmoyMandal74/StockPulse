## Page-load speed: the stored snapshot (2026-10-13)

The owner, after the screener drill-down felt slow and that turned out to be a whole-snapshot read: "do an audit ... promo first time load is also slow."

**Measure where it runs.** `GET /api/diag/serve-timing` (admin or the cron secret, read only) runs each read a page load makes ON THE SERVER and answers with milliseconds. A laptop is a continent from the database and said the snapshot read was 2.4 s; the function, beside the database in `iad1`, said 3.8 to 4.2 s. Keep the route: it is the only honest stopwatch.

**What it found, before** (three runs, ms):

| read | 1st | 2nd | 3rd |
|---|---|---|---|
| one tiny read | 6412 | 38 | 7 |
| **the snapshot: read and parse** (5.2 MB, 1,280 rows) | **4164** | **3941** | **3791** |
| stringify it for the browser | 56 | 52 | 48 |
| score the Signal | 68 | 31 | 37 |
| all six serve stamps together | 674 | 260 | 235 |
| portfolios | 129 | 29 | 29 |
| **the snapshot again, for a second route** | **4149** | **3933** | **3773** |
| period anchors (two closes a stock) | 4449 | 288 | 407 |

So `/api/stocks`, which every page starts with, cost about 4.3 s of which 3.9 s was one read; nothing else on the path mattered. Parsing 5 MB is 35 ms: the time is the transfer of one very large text value, not the JSON.

**Twenty-four routes and functions read the snapshot** (`/api/stocks`, `/api/stock`, `/api/lab`, `/api/m/post`, `/api/holder`, `/api/news`, `/api/pivot-periods`, `/api/period-anchors`, the peer and line series, the group index, the mobile rows, data quality, the backtests, the chat, the alert pass and others). Several wanted one company or a list of symbols.

**Two changes.**

1. **`readSnapshot()` keeps the payload text in memory and fetches it again only when the row's `updated_at` has changed** (`db.js`). The stamp is read first, a tiny read; both writers stamp a fresh one to the millisecond, since a snapshot is always a new computation, so it is a version. The text is parsed afresh for every caller, because callers stamp and score the rows they are handed. `writeSnapshot` drops the copy. A row with no stamp is never served from memory. This fixes all twenty-four at once, with no caller changed.
2. **Visuals asked for five things one after another before drawing** (`/api/stocks`, then period anchors, personal lists, screens, filer ids), and period anchors read the snapshot a second time. The four that do not need the stocks are now started with it.

**After** (ms): the snapshot 4011 on an instance's first read, then **38 and 37**; a second route asking, **43, 40, 40**. The whole timing call fell from about 9 s to 1.2 s.

- Checked against production, read only: three reads in a row 3005, 53, 48 ms from the laptop; each caller gets its own object and one caller's edits do not reach the next; the stored verdict words are still canonised on the way out.
- **What is left.** A new instance, or any instance after the snapshot is rewritten (every intraday refresh, and each nightly round), still pays the 4 s once. Halving that means storing the payload compressed (it is 1.2 MB gzipped) or splitting it by row, which changes the write path of the one table everything reads; not done, and the owner's call.
- The first tiny read of one run took 6.4 s. Seen once, while the nightly job was running; not explained.
- The drill-down route was fixed separately by not reading the snapshot at all (`screener-drill-down.md`).

## The stock page, lighter (2026-10-27)

The owner: "Look at the individual stock page and give me ideas of how make it load faster", then "Yes" to the first five. Measured first with `/api/diag/serve-timing`: the snapshot read was 4.5 s on a cold instance, 70 ms warm.

- **`cards.js` (1.1 MB) is no longer a blocking script in the stock page's head.** Only the Drawdowns card uses it (four `Cards.drawdown*` helpers), so `loadDrawdowns` asks for it through `needCards()`: a script tag added once, versioned like the rest, fetched beside the card's history.
- **The Drawdowns history shares the volatility pane's request.** `RowCard.loadHistory(SYMBOL, VOL_MED_DAYS)` (1290 sessions) is cut to the last 1265, the window the card always measured. That is identical to `days=1265`, since `readBars` takes the newest N. It was a separate uncached `/api/history` call.
- **`/api/news` reads one name, not the snapshot.** On a stale feed it read the whole snapshot for `row.name`; it now uses `store.readNameOf`, a seek on the names table, which is where the snapshot's names come from (`computeStocks`).
- **The fifteen section loaders run in page order, six at a time** (`SECTION_LOADS`), rather than all at once. They don't wait for a scroll: every card starts hidden and the jump menu lists drawn cards, so a scroll-triggered section could not be jumped to.
- **Private scripts are cached by the browser.** `/stock/:symbol` is served through `versionedPage()`, which names each private script `/x.js?v=<ASSET_V>`. `ASSET_V` is the Vercel commit, or the boot time locally. `express.static` for `private/` takes `setHeaders: privateCacheHeaders`: a request carrying the current `v` gets `private, max-age=31536000, immutable`, anything else `private, no-cache`. "private" keeps the CDN from storing gated files. A deploy changes `v`, so the page names new URLs. The page HTML itself is `private, no-cache`. Only the stock page is served this way so far; other pages can take `versionedPage` the same way.
- Tests: a scratchpad browser suite (13 checks) on the in-memory server. It checked:
  - no cards.js tag, and cards.js asked once, after the data request;
  - the Drawdowns card draws from a single 1290-day history request;
  - section requests peak at six at once, and every section still asks;
  - the header for the current, missing and old `v`;
  - a second visit takes every versioned script from the browser's cache.

  The news change was checked by reading it, not run (news is off in the test harness).
- **Not done yet**, from the same list: moving the 412 KB inline script into a cacheable `stock.js`; storing the snapshot compressed or reading one row for `/api/stock` (the owner's call: it changes how the one shared table is written); a `?symbol=` mode for the timing route.
