## Running the app
```
node --use-system-ca server.js
```
Runs on port 3000. Requires `.env` with `TWELVE_DATA_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `ADMIN_PASSWORD`.

**Careful when running it just to look at the UI:** `computeStocks()` calls `ensureProfiles()`, which re-pulls any profile older than a day and rewrites the `profiles` and `snapshot` tables, burning API credits. To check frontend changes only, serve `public/` with a throwaway static server instead — the page falls back to admin-open mode when `/api/me` fails, so the whole chrome renders without touching the API.

