# Institutional holdings from Form 13F (2026-10-11)

Backlog 36a. The owner: "can you do the backlog 36, lets get all the institutional holdings". Who held each stock at the last quarter end the SEC has published: how many managers, the shares between them, the largest holders, and the change on the quarter before.

## What a 13F is, and is not

Every institutional manager with more than $100 million in US-listed securities reports its long positions within 45 days of each quarter end. The SEC publishes them all as one data set a quarter.

- **Not current.** A quarter-end snapshot, published about ten weeks after the quarter. In October the newest is June's. Every surface names the quarter.
- **Not everyone.** No managers under $100 million, no individuals, few foreign holders.
- **Not net.** Long only; a short is never reported and lent shares still are.
- **Options and bonds are left out**: a row with PUT or CALL, or an amount in principal, is not shares held.
- **Can double count.** Related managers sometimes report the same shares.

## Where things live

- `inst13f.js` (root, pure): `isoDate`, `header`, `mainPeriod`, `chosen` (which filings count), `holdingOf` (which rows count), `quarter()` (accumulator), `summarise`, `pctOf`, `change`, `quarterName`.
- `zipread.js` (root): a ZIP reader (central directory, stored and deflated entries, ZIP64 sizes) and `eachLine` over a buffer. Node has zlib and no ZIP container reader; the table is 400MB unpacked and cannot be one JS string.
- `inst13f-load.js`: the loader. **Local only**: a 100MB download and 3.8 million rows is not a serverless request.
- `db.js`: tables `inst_holdings` (one row per stock: counts, shares, the implied price, top 15 as JSON) and `cusip_map`, both in `SYMBOL_TABLES`. `writeInstHoldings`, `readInstHolding`, `readInstSummaries` (no holder lists), `writeCusipMap`.
- `server.js`: `GET /api/institutions?symbol=` and the `inst` part of the stored readings.

## Rules that must hold

- **The quarter is the commonest period in a data set, not the newest.** A window also carries late filings for old quarters; one manager filed for 2001 in the 2026 set.
- **Amendments.** A RESTATEMENT replaces what came before; a NEW HOLDINGS amendment adds. Per manager and quarter: the latest original-or-restatement, plus new-holdings amendments filed after it. Otherwise a manager who restated is counted twice.
- **A 13F names a security by CUSIP.** The map comes from the SEC's fails-to-deliver files, which carry CUSIP beside ticker; eight of them map 1,280 codes to 1,275 of 1,280 tracked symbols. **A share class is written without its dot there** (BRKB for BRK.B); each symbol is looked up under both spellings.
- **Dollar values as filed are not added up.** Some managers still report in thousands: T. Rowe Price's 370 million Nvidia shares arrived valued at $0.1 billion. Value is shares times one price per stock, the median of what managers implied (`px`), which is the quarter-end price and is unmoved by the few in the wrong units.
- **A position larger than the whole company is a units error and is dropped**, but only while the share count is credible. **For a two-class company the vendor's count can be the other class's**: Berkshire's B shares came with 1.4 million outstanding (the A class), and the first version threw out every real holder. The guard is off when more than five managers, or more than 2% of at least fifty, exceed the count. The route offers no percentage of the company at all when the total is past one and a half times the count.
- **A new holder reads `prev: 0`; no earlier quarter at all reads `null`**, and nothing claims a change it cannot compute.
- **Display only.** The signal is identical with the fields absent, present and lying.
- **The loader writes in batches of 25, each tried twice.** The connection sits idle through a minute of parsing and the first write on it can fail ("fetch failed"); `db.js` rightly never retries a write, but these are upserts on the symbol. The first version lost two whole runs to that.

## Surfaces

- **Stock page**: section `#inst`, "Institutional holders", before Large holders: four figures (managers, shares held and share of the company, change on the quarter with new and gone, worth at the quarter-end price) and the fifteen largest with their change. The heading reads "as of Q2 2026 (2026-06-30)".
- **Screener**: `instManagers` ("13F holders") and `instChange` ("13F chg", percent change in shares held on the quarter before), in Ownership after Institutions. Through `stampFlows`: `flows.inst` (`FLOWS_V` 7).
- Constants after these columns: Ownership 10 (a fund's blank run `naRun(10)`), `PAD_SPAN` 116, error row 111, empty row 113.
- The vendor's `institutionPct` column is left as it is. It is one number from the data provider; this is the SEC's own count, with names.

## Refreshing

**Four times a year, by hand**: `node --use-system-ca inst13f-load.js --commit`. It reads whichever two data sets are newest and says which quarters they are. Nothing schedules it, and running it before the SEC publishes a new set changes nothing. Downloads are kept in the system temp folder (`tickrlab-sec`) and reused.

## First load, 2026-10-11

Q2 2026 against Q1 2026: 8,857 managers, 3,830,274 rows, 1.73 million of them plain holdings of a tracked stock, 119,791 option rows left out. 1,274 of 1,280 symbols written. Apple: 6,111 managers, 9.70 billion shares (66.0%), BlackRock 1.16 billion, Vanguard Capital Management 959 million, State Street 615 million. Unmapped: FI, SKX, SOI, DRQ, VYLR.

Tests were a scratchpad Node suite (45 checks, including the ZIP reader against archives built in the test) plus the real run. Neither surface was rendered in a browser by the build.

## Who added, who cut, and every quarter kept (2026-10-16)
The owner asked which institutions increased or reduced their exposure, then "Go ahead" on the plan: fix splits, keep history, add buyers and sellers per stock, and net flow per holder.

- **Splits** (`splitadj.js`): last quarter's shares are multiplied by the splits dated in (last quarter end, this quarter end]. **Only the factors the holders confirm** (`SplitAdj.confirmed`): among managers holding the stock in both quarters, the median share ratio must be within 15% of the factor and the factor clearly away from 1. The provider lists spin-offs as price factors too; in Q2 2026 BKNG 25, KLAC 10, CVNA 5, SBS 5, POWL 3 and DD 1-for-3 were confirmed and applied, while FDX 1.241, HON 0.9535, ATRO 1.253 and SCCO 1.01 (spin-offs and a 1% stock dividend) were left alone. The loader prints each decision. Before this, every holder of a stock that split looked like a buyer, in "13F chg" too.
- **Buyers and sellers per stock** (`summarise`, stored as `inst_holdings.buyers`/`sellers`, served by `/api/institutions`): the 15 largest increases (new positions included) and cuts (exits included) by change in shares. **Only managers that filed in both quarters' data sets** (`filers`), and none at all for a stock nobody held last quarter (a new listing): a missing or late filing otherwise reads as a new holder of everything or an exit from everything. The stock page's Institutional holders section shows "Added the most" and "Cut the most" side by side, worth at the quarter-end price, in neutral ink.
- **Every quarter kept**: `inst_history (symbol, period)` gets a dated copy of each row as `writeInstHoldings` writes it; the latest table is still replaced. `inst_history` is in `SYMBOL_TABLES` and on the query-plan list.
- `added`/`exited` counts on the stock row are unchanged (they still count a manager missing from a set). The new lists are the stricter view.
- **Confirming a split also needs the holders' median nearer the factor than to 1** (in log terms). The first rule (within 15% of the factor) passed S&P Global 1.057 and Unilever 0.888 in the fund sets, whose holders' counts had not moved at all (ratio 1.000). Caught on the first fund load, fixed, tested with exactly that case (proven by reverting) and the fund load re-run: the same period's rows were replaced, not duplicated. The 13F load was unaffected: everything it applied was a large factor.
- **First run, 2026-10-16**: 1,274 stocks and 8,391 manager books for Q2 2026, 1,275 stocks and 7,147 fund books for 2026q3, each with a dated copy in the history tables, and both net buyer and seller figures written.

## Two years back, and drawn (2026-10-17)
The owner: "Now that we have the history what can be done to show it", then "go" on the recommended set.

- **`inst13f-backfill.js`** (local, by hand): reads earlier 13F data sets (default 8 quarters) with `inst13f-load.js`'s own reading code (it now exports `page`, `download`, `zipLinks`, `cusipMap`, `readSet` and runs only when called directly), and the same split, both-filed and one-price rules, quarter by quarter. It writes **only** `inst_history`, `holder_history` (books capped at 50 positions, not 250) and each quarter's `flow13f:M:<period>` figure, through `writeInstHistoryOnly` and `writeHolderHistoryOnly`, which **never overwrite a period already on file** (`do nothing`). The latest tables are untouched. Only today's universe is matched, through today's CUSIP map widened by `cusip_map`, so a company whose security code changed may be missing from older quarters. The first run covered Q2 2024 to Q1 2026; its split decisions matched the real splits (NVDA and CMG 2024, AVGO, NFLX, NOW and others).
- **Split-proof by construction**: every stored quarter carries last quarter's shares on its own footing, so the quarter-on-quarter change is comparable across a split, and chaining it gives an index a split cannot bend. `/api/institutions/history` returns each quarter's change, managers, value and that chained index (it restarts where a quarter cannot be chained).
- **Stock page**: "Quarter by quarter" under Added and Cut: each quarter's change in shares held by 13F managers as a bar above or below zero (accent and orange), managers beneath, and the change over the whole span in the heading.
- **Holder page**: a "Quarter by quarter" strip of net bought or sold in tracked stocks (`/api/holder/history`), and **a click on any position row** opens that stock over the periods: value at each period's price, change in shares beneath. **A period whose stored list was capped and does not carry the stock reads "?", not zero.**
- Tests: an in-memory server test (11 checks): chaining through a 10-for-1 split, a backfill not overwriting the live quarter, unknown versus zero, and bad input refused.

## A letter when a new data set is out (2026-10-17)
The owner: "Can I get an alert when the 13F arrives, I assume it is posted one day for each quarter". It is not one day: each manager files on its own, any day up to 45 days after the quarter (Q3 2026's deadline is Monday 16 November, the 45th day being a Saturday), and the SEC's bulk data set, the file the loader reads, covers a three-month window of filing dates and comes out a few weeks after the window closes. The window that opens in a quarter-end month carries that quarter: `01sep2026-30nov2026_form13f.zip` is Q3 2026, expected in December.
`secSetsCheck()` runs on the daily watchdog pass (`/api/cron/watchdog`, bounded at 45s and swallowed). It reads the 13F and the N-PORT data set pages, one after the other with `SEC_UA`, and takes the first `_form13f.zip` / `_nport.zip` link (the pages list newest first, as the loaders assume). The newest name per list is kept in `app_meta` (`sec_sets_seen`, `readSecSetsSeen` / `writeSecSetsSeen`). The first sighting is recorded without a letter; after that a name not seen before mails the operator once (`kind: 'sec-data-set'`), naming the quarter and the loader command. A page that fails records nothing, and a 429 or 403 stops the pass for the day. The loaders stay by hand.
