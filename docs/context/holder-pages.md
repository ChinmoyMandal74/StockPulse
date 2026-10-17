# A page for each institution and each fund (2026-10-12)

The owner: "We now have institutional and fund holders at the stock level, can you create page for each of these different entities so that I can see what they hold". The stock page answers "who holds this"; these answer "what does this one hold".

## What had to change

Only each stock's largest fifteen holders were stored (`inst_holdings.top`, `fund_holders.top`), so a holder's own list could not be read back. The two quarterly loaders already hold the full picture in memory (stock -> holder -> shares) while they run; it is now turned round and stored as one row a holder.

## Where things live

- `holderbook.js` (root, pure): `invert(cur, prev, opts)`, `finish(book)`, `view(book, rowOf)`.
- `db.js`: table `holder_books (kind, id)`, kind `M` (13F manager, id = its CIK) or `F` (fund, id = `N.fundKey`). The positions are JSON, capped at 250 by value; `positions` and `value` are of all of them. Indexes on `(kind, value desc)` and `(kind, name_lc)`. On the `query-plan-test.js` list. **Not** in `SYMBOL_TABLES`: it is keyed by the holder, and a dropped symbol leaves on the next load (the page drops it at once, since `view` asks the screen for each stock). `writeHolderBooks`, `clearHolderBooks`, `readHolderBook`, `listHolderBooks`.
- `inst13f-load.js`, `nport-load.js`: after the per-stock rows, build and write the books, twenty a batch, each tried twice. Books from an earlier load that this one did not write are deleted **only after every batch went in**.
- `server.js`: pages `/holders` and `/holder/:kind/:id`; `GET /api/holder-directory?kind=&q=` and `GET /api/holder?kind=&id=`.
- `private/holders.html` (the directory), `private/holder.html` (one holder). Linked from each holder's name in the two tables on the stock page.

## Rules that must hold

- **For members, by the owner's decision (2026-10-12).** The pages shipped admin only that morning, because a fund's page lists positions with weights and for an index fund that resembles what `/holdings` is kept behind the admin gate for. Told so, the owner answered: "The page can be visible to non-admin users too, they can come from the individual stock page". So the line is drawn between sources: a fund's own public SEC filing, months old, is shown to members; the issuer's live daily file on `/holdings` stays admin only and is unchanged. **Guests are refused** (page routes redirect, the API answers 403): the preview is twenty stocks and a holder's page lists hundreds. The stock page links a holder's name for a member and leaves it as text for a guest.
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

## A route name that was already taken (2026-10-12)

The directory first shipped as `GET /api/holders`, which is the address of the 13D and 13G filings about one stock (`large-holder-filings.md`). Express gives a request to the first route registered for a path, and the new one sat above the old, so for about an hour the stock page's Large holders section and the promo Large holders card were handed the directory instead. Found while opening the pages to members, by grepping the route list. Renamed `/api/holder-directory`. **Before adding a route, grep `server.js` for the path**; `node --check` and booting both pass with a duplicate.

## What one holder holds: a holder page as a card (2026-10-15)

The owner, on `/holder/M/1045810` (NVIDIA): *"Can you make a new promo template for this"*.

- **Template `holderbook`**, in a new **Holders** group. Controls `hbkKind` (M, a 13F manager; F, a fund) and `hbkId`, filled from `/api/holder-directory` (the 200 largest of the kind). `hbk`, not `hb`: a saved post's option keys must open with three to six lowercase letters (`POST_OPT_KEY`).
- **The data is the page's own**: `holderPayload(kind, id)` in server.js, which `/api/holder` now calls, through the `getHolderBook` channel. The studio fetches `/api/holder`; the saved-post renderer asks `Cards.holderBookNeed` and calls `holderPayload`.
- The card: kind and quarter, the name, four figures (in tracked stocks, stocks held, new, gone) on the capital-returns card's `cr-figs` grid, the sector split as one bar with its key, and the largest positions as bars (value, share of what is shown, `NEW` for a new position). Rows: 9 portrait, 5 square, 13 story. **Only the tracked stocks**, said in the subtitle and the note; a fund's note adds that its holdings are reported again inside its manager's 13F.
- **The holder page links to it**: a Visuals button opens `/promo?tpl=holderbook&hkind=M&hid=<id>`. A holder outside the 200 is added to the picker under its own name once its book arrives.
- Verified: built in Node at all three sizes from NVIDIA's figures; drawn in the studio from the holder page's link in dark and light.

## The studio's holder picker is searchable (2026-10-16)
The owner: "make the which one drop down searchable" (Holders › What one holder holds). `hbkId` became one of the studio's type-to-search pickers (`enhanceStockPickers`), through a small per-select config, `SP_NAMED`:

- **It matches anywhere in the names already loaded** (the 200 largest of the kind, largest first within each rank).
- **From two letters it also asks `/api/holder-directory?kind=&q=`**, 220ms after typing stops, which finds any holder on file by the start of its name. A reply for a term no longer in the box, or for the other kind, is dropped (`scope`).
- **Picking a holder the select does not hold adds it as an option and chooses it**, so the card, saved posts and the change listener work as before.
- Holder rows show the name and value without a ticker; the stock pickers are unchanged.

Checked in the studio harness: "black" and "rock" find BlackRock in the loaded list, "zeb" finds a holder only the server knows and choosing it selects and draws it, nonsense finds nothing, and a stock picker still shows ticker and name.
