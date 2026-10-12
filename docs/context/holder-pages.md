# A page for each institution and each fund (2026-10-12)

The owner: "We now have institutional and fund holders at the stock level, can you create page for each of these different entities so that I can see what they hold". The stock page answers "who holds this"; these answer "what does this one hold".

## What had to change

Only each stock's largest fifteen holders were stored (`inst_holdings.top`, `fund_holders.top`), so a holder's own list could not be read back. The two quarterly loaders already hold the full picture in memory (stock -> holder -> shares) while they run; it is now turned round and stored as one row a holder.

## Where things live

- `holderbook.js` (root, pure): `invert(cur, prev, opts)`, `finish(book)`, `view(book, rowOf)`.
- `db.js`: table `holder_books (kind, id)`, kind `M` (13F manager, id = its CIK) or `F` (fund, id = `N.fundKey`). The positions are JSON, capped at 250 by value; `positions` and `value` are of all of them. Indexes on `(kind, value desc)` and `(kind, name_lc)`. On the `query-plan-test.js` list. **Not** in `SYMBOL_TABLES`: it is keyed by the holder, and a dropped symbol leaves on the next load (the page drops it at once, since `view` asks the screen for each stock). `writeHolderBooks`, `clearHolderBooks`, `readHolderBook`, `listHolderBooks`.
- `inst13f-load.js`, `nport-load.js`: after the per-stock rows, build and write the books, twenty a batch, each tried twice. Books from an earlier load that this one did not write are deleted **only after every batch went in**.
- `server.js`: pages `/holders` and `/holder/:kind/:id`; `GET /api/holders?kind=&q=` and `GET /api/holder?kind=&id=`.
- `private/holders.html` (the directory), `private/holder.html` (one holder). Linked from the admin console, and from each holder's name in the two tables on the stock page.

## Rules that must hold

- **ADMIN ONLY, and that is the licensing question rather than a permission one.** A fund's page lists its positions with the weight of each; for an index fund that is the index's constituents with their weights, which is what the standing rule keeps behind the admin gate ("Index-fund holdings weights never leave admin"). The source here is the fund's own public SEC filing, months old, which may change the answer, but that is the owner's decision. A manager's 13F raises no such question; the two kinds share a page and are gated together until it is decided. The stock page links a holder's name only for the admin; everyone else sees the name as text, as before.
- **Only the tracked stocks.** A book's total is "in tracked stocks", never the size of the manager or the fund, and every surface says so.
- **The same two decisions as the stock side, from the same code.** A 13F position is valued at the stock's one quarter-end price (the median the managers implied), not the dollars a manager filed; a position larger than the whole company is left out, by `Inst13f.shareCap`, the function `summarise` now uses too. A fund's position takes the value the fund itself reported.
- **Last period's shares**: the figure where held, `0` for a new position, `null` where there is no earlier period at all. `added` and `exited` are null in that last case, not zero.
- **A fund's id.** A fund in a series has the SEC's own id (`S000002277`). A single-fund registrant (the SPDR S&P 500 ETF Trust) has none; `N.fundKey` gives it `N` plus a fingerprint of its names, stable from one data set to the next. The id is checked against `^[A-Za-z0-9]{1,24}$` before it reaches the database.
- **The directory search matches the START of a name**, so it rides the name index and stops at the limit; "vanguard" finds Vanguard funds, "500" does not find "Vanguard 500".
- **Never added together.** A fund is inside its manager's 13F; both pages say so.

## The pages

- **`/holders`**: two tabs (managers, funds), the 200 largest by what they hold in tracked stocks, or up to 100 whose name starts with what is typed.
- **`/holder/M/<cik>`, `/holder/F/<id>`**: four figures (held in tracked stocks, stocks held, new, gone), a sector bar of what is shown, a sortable and filterable table (value, share of these holdings, share of the fund for a fund, shares, share of the company, change in shares), and the positions held last period and not now. Each symbol links to its stock page.

## Refreshing

With the loaders, four times a year by hand: `inst13f-load.js --commit` then `nport-load.js --commit`. About 22,000 rows between them.

## First load, 2026-10-12

8,391 managers hold at least one tracked stock. The largest in tracked stocks: BlackRock $5.97T in 1,263 stocks, Vanguard Capital Management $4.39T, State Street $3.16T, Vanguard Portfolio Management $2.05T, FMR $1.99T.

Tests were a scratchpad Node suite (32 checks). Neither page was rendered in a browser by the build.
