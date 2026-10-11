# 8-K events (2026-10-11)

The owner found a third-party API (FilingRail) offering 8-K events and 13F holdings and asked what public data could be read. Both are the SEC's own; this takes the first from the source. The comparison and the reasons for not subscribing are backlog 36.

**What an 8-K is here**: the report a company files within four business days of something material. Its item numbers say what kind of thing (2.02 results, 5.02 an officer or director change, 1.01 a material agreement, 4.02 a restatement warning), and the items are the whole value: they make a filing something a reader can scan and filter.

## Where things live

- `events8k.js` (root, pure): the catalogue `ITEMS` (27 items: short name, the SEC's title, a rank for which leads), `NOTABLE`, `parse(recent, since)`, `label(items, max)`, `detail`, `url`, `sinceDate`.
- `db.js`: table `sec_events (symbol, accn, filed, form, items, report_date, doc)`, in `SYMBOL_TABLES`, with `idx_sec_events_filed`. `writeSecEvents` (upsert plus prune), `readSecEvents(symbol)`, `readSecEventsSince(since)` (named index).
- `server.js`: the hook in `secFetchOne`, `GET /api/events?symbol=`, and the `ev` part of the stored readings.
- `sec-events-load.js`: the first fill.

## Rules that must hold

- **No new SEC traffic to stay current.** `secFetchOne` already downloads `data.sec.gov/submissions/CIK…json` for every company to read one date (`SecFacts.newestResults`). The hook reads every 8-K out of the same response, in its own `try`, so a failed events write can cost neither the results date nor the filings.
- **An item names a kind of event, never whether it was good news.** 5.02 is a retirement and it is a dismissal. Nothing ranks or scores an event; no colour is used; the page sends the reader to the filing. `NOTABLE` marks the rare kinds in bold (bankruptcy, cybersecurity incident, debt accelerated, impairment, listing notice, auditor change, restatement warning, change of control): a fact about the category.
- **The names are ours and short; the SEC's title rides beside each** as a tooltip. Item 9.01 (exhibits) never leads and is named only when it is alone.
- **Kept about 400 days per company**, 40 at most, pruned in the same batch that writes.
- **Display only.** The signal is identical with the event absent, present and alarming.
- Links go only to `www.sec.gov`; a document name that is not a plain file falls back to the filing's index page.

## Surfaces

- **Stock page**: section `#ev`, "Company events", after the SEC section. `loadEvents()`; hidden until there is one, removed on failure. Guests get their twenty symbols.
- **Screener**: column `lastEvent`, "Last 8-K", in Reactions after Insider net: the newest 8-K in the last 60 days (`EVENT_RECENT_DAYS`), its label and how many days ago. A text filter (`TEXT_KEYS`), so typing "officer" finds them; sorts by date. It reaches the row through `stampFlows`: `buildFlows` reads the last sixty days by the `filed` index into `flows.ev` (`FLOWS_V` 5) and `flowsOf` sets `lastEvent`, `lastEventDate`, `lastEventNotable`.
- Constants after this column: Reactions 6, `PAD_SPAN` 113, error row 108, empty row 110.

## Freshness

An event appears when that company's filings are next re-read by the SEC rotation, not when it is filed. The column and the stock page both say "updated with the filings" rather than implying same-day.

Tests were a scratchpad Node suite (39 checks) plus a dry run of the loader against the live feed. Neither surface was rendered in a browser by the build.
