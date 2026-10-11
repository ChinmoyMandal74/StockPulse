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
