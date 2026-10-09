## Editing portfolios does not pull
**Adding or removing a ticker, and creating, renaming or deleting a portfolio, no longer refresh from the API.** Every one of them used to call `refresh()`, which sets `?refresh=1` and recomputes the entire universe from Twelve Data — roughly **560 credits and a ten-second wait** to reflect a change the server had already made and had already told the client about. Refresh is a button; it stays one.

- **`applyPortfolioMap(map)` reconciles the table from the response.** All five endpoints answer with the fresh `name -> symbols` map, and membership, badges, tab counts, the portfolio picker and the purge warning all derive from it. Only the price and fundamental columns need a pull.
- **A symbol with no row yet gets a placeholder**, reusing the `s.error` branch the row renderer already has: `No data yet — click ↻ Refresh to pull it.` It is in the portfolio, so it belongs in the table and in the count — silently not appearing looks like the add failed. `applyLens()` already skips error rows, so nothing downstream needed changing.
- **A symbol left in no portfolio loses its row**, because the server has just purged its stored data.
- **`activeTab` falls back to `All`** when the portfolio it names stops existing. `renamePortfolio()` sets the new name *before* reconciling, so a rename keeps you where you were.
- **The add route returns the company name it resolves** (1 credit, cached, and it was already being fetched). That lookup is now the only thing that touches the symbol before the next Refresh, so a name coming back empty is the earliest hint of a typo and the page says so. Without it a mistyped ticker would sit as a placeholder until the next refresh turned it into an error row.
- **The as-of date still pulls**, both setting and clearing it — a forward-returns view is computed live by definition.
- Verified against the extracted function with eight cases: a new ticker, a ticker already in the universe added to a second portfolio, removal from one of two holders, removal of the last holder, rename, delete with one orphan and one survivor, a null map, and a placeholder being replaced by real data.

