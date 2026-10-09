## Dropping a symbol
**A ticker removed from the screener (the All view's ×) takes its data with it** — `bars`, `fundamentals_history`, `profiles`, `names` and headlines, via `purgeSymbol()`. *Before 2026-09-15 this happened when a ticker left its last portfolio; see the universe table above.* `purge-orphans.js` sweeps up anything left, comparing against the universe.

- **Two of those come back, one does not.** Bars cost a single API credit to re-pull at any depth and every technical is recomputed from bars, but **`fundamentals_history` cannot be rebuilt** — the API only ever returns today's numbers, so a deleted row is gone and re-adding the ticker starts that series from zero. Every surface says so: the confirm dialog, the dry run, and the comment on `purgeSymbol()`.
- **The decision is made from the universe before and after the edit, not from the route.** A symbol still in another portfolio is untouched — verified: removing AAPL from one of two lists purged nothing, deleting the last portfolio holding SPY removed all 9,739 of its rows.
- **`snapshot` is deliberately not in `SYMBOL_TABLES`.** It is one JSON row rewritten wholesale on the next refresh, so it heals itself.
- **A failed purge never fails the edit.** Losing the portfolio change because the cleanup broke would be worse than leaving rows behind, and the sweep exists to collect them.
- **The UI confirms only when data will actually be destroyed.** `lastHome()` asks whether this removal leaves the symbol in no portfolio, so removing it from one of several still passes without a dialog — that really is trivially undone. Deleting a portfolio names the symbols that will lose their history. Both then report the row count through `setStatus()`, because a silent ten-thousand-row delete is not something to discover later.
- Swept on introduction: **SPY 9,739 rows, XLF 5,009, BTC 1** — the database now holds data for exactly the 83 symbols in the portfolios.

