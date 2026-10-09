## Fundamentals history
`fundamentals_history` keeps one row per symbol per day (18 columns — valuation, size, margins, growth, balance sheet), so the movement of a P/E or a margin can eventually be charted. **Empty until the next Refresh all** — nothing is backfillable, because `profiles` only ever holds the current value and no API on this plan returns historical forward estimates.

- **Written during a Refresh all only**, gated on `readRefreshState()` being non-null. An ordinary price Refresh reuses day-old cached profiles, so recording then would store identical numbers under a new date and invent movement that never happened.
- **One set per day**, enforced by the `(symbol, d)` primary key. A Refresh all calls this on each of its dozen-odd rounds, so the write is an upsert: later rounds carry more populated profiles and replace what earlier ones wrote.
- **Rows without a profile yet are skipped, not stored empty** — a later round in the same run fills them in.
- **Explicit columns, not a JSON blob** (unlike `profiles`): the shape is ours and stable, and a chart wants `select d, forward_pe` over a year rather than 365 blobs to parse. Adding a field is an `ALTER` in `ADDED_COLUMNS`.
- **The scores are deliberately absent.** They are model output rather than measurement — the scoring has already been rewritten once and once removed outright, and a series mixing two regimes compares nothing to nothing.
- **A history write never fails a refresh**, the same rule the bar archive follows.
- The series will be **irregular**: a point exists only for days a Refresh all was run, not every calendar day. Fine for a chart, awkward for precise period comparisons.

