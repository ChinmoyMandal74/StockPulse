## The database page
**`/database` (admin only, a `Database` row in the console's Data section) lists every table with its exact row and column count (2026-09-15).** `tableStats()` in db.js reads `sqlite_master`, then one **read batch** of `count(*) from pragma_table_info(?)` plus `count(*)` per table — measured 41-152ms for 21 tables and ~397k rows. Views would be listed with columns but not counted (counting a view runs its query); there are none today.

- **`GET /api/db-stats` caches the result five minutes per instance**, because every count reads every row and Turso meters rows read (~397k a count, nearly all `bars`); `?fresh=1` (the page's **Count again**) always counts.
- **Descriptions and areas are a static map in the page** (`TABLES`). A table added later still shows, under *Other*, with no description — add it to the map.
- **`/api/db-stats` must sit below `requireAdmin`'s definition.** The first cut registered it beside the page route near the top of server.js and the server failed to boot with a TDZ ReferenceError — `node --check` passes that; only the route walk caught it.
- Verified: local walk (anon/guest 302 and 403, admin 200, `/database.html` funnels), cached vs fresh responses, counts equal to an independent query.

