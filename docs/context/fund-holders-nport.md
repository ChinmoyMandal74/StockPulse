# Which funds hold a stock: Form N-PORT (2026-10-11)

The owner quoted an earlier note back ("Which funds hold a stock. Useful and popular. It comes from a different SEC filing type ... a new loader like the 13F one") as the request to build it. For each tracked stock: how many mutual funds and ETFs hold it, the shares between them, and the largest, each with how much of that fund the stock is.

## What N-PORT is

Every registered fund reports its whole portfolio to the SEC each month. The report for the last month of each of the fund's fiscal quarters is made public, sixty days after that month ends. The SEC publishes everything made public in a calendar quarter as one data set: about 460MB zipped, 5.6 million holdings rows.

## How it differs from 13F (and why the two are never added)

- **13F is by manager**: "BlackRock holds 1.16 billion Apple shares."
- **N-PORT is by fund**: "iShares Core S&P 500 ETF holds 202 million of them."

The second is inside the first: a manager's 13F adds up its funds and its other accounts. The stock page says so under the fund table, and the card's note does too.

## Where things live

- `nport.js` (root, pure): `isoDate`, `header`, `tidyName`, `pickReports` (one report a fund), `holdingOf` (which rows count), `dataset()` (accumulator), `summarise`, `pctOf`, `change`, `span`.
- `zipread.js`: `entriesOfFile` and `streamLines`, added for this. The archive stays on disk; its directory is read from the tail of the file and one entry at a time is piped through the inflater and handed over line by line. The 13F loader holds its 100MB ZIP in memory; this one cannot.
- `nport-load.js`: the loader. **Local only.** Needs `cusip_map`, which `inst13f-load.js` writes; on a fresh database run that first.
- `db.js`: table `fund_holders` (one row per stock; top 15 as JSON), in `SYMBOL_TABLES`. `writeFundHolders`, `readFundHolders`, `readCusipMap`. (The older `readFundHoldings(fund)` is index membership, a different thing.)
- `server.js`: `fundHoldersPayload(symbol)`, `GET /api/fund-holders?symbol=`.

## Rules that must hold

- **What counts as holding the stock**: a long position (`PAYOFF_PROFILE` Long) in the common equity (`ASSET_CAT` EC), reported in shares (`UNIT` NS). A short, an option or swap on the stock, a convertible, the same issuer's bond and a principal amount are all left out.
- **One report a fund**: per series, the newest as-of date, then the newest filing. So an amendment replaces the original.
- **The dates are not one date.** Funds are on different fiscal calendars, so one data set holds reports as of three different month ends. Each fund carries its own; the summary gives the range ("May to Jul 2026"), never a single quarter end.
- **Weight is the stock's value over the fund's net assets**, computed here, not taken from the file's own percentage column. Null where the fund reported no net assets.
- **A fund's name as filed is not always a name.** A unit investment trust has no series and its series name arrives as "N/A": the SPDR S&P 500 ETF Trust was listed as "N/A" in the first dry run. Then the registrant's name stands in. Names filed in capitals are set as names with fund abbreviations kept (ETF, S&P, FTSE, MSCI); trademark marks `(R)`, `(TM)`, `(SM)` are dropped.
- **No share of the company where the funds alone exceed the share count**: that is the wrong class's count (see the 13F note).
- **A new fund reads `prev: 0`; no earlier data set reads `null`.**
- **Display only.**

## Surfaces

- **Stock page**: section `#fundh`, "Funds that hold it", after Institutional holders. Three figures and the fifteen largest: shares, share of the company, share of the fund, change on the quarter, as-of month. `loadFundHolders()`.
- **Promo**: card `fundholders`, "Fund holders", in Stock spotlight; one control, `fhSym`. The bar and first figure are shares held; the second is the weight in that fund, headed separately so it is not read as a share of the company. Through `ctx.getFundHolders`, asked by `Cards.fundHoldersNeed`.
- No screener column. The 13F columns already cover "how widely held"; this adds names, which a column cannot show.

## Refreshing

**Four times a year, by hand**: `node --use-system-ca nport-load.js --commit`, after the SEC publishes a new data set (a few weeks after each calendar quarter). About 30 seconds to download and two and a half minutes to read both sets. Downloads are kept in the system temp folder (`tickrlab-sec`), about 900MB for the two, and reused.

## First load, 2026-10-11

Sets 2026q3 and 2026q2: 13,908 funds, 5,627,083 holdings rows, 650,683 of them a long position in a tracked stock. 1,275 of 1,280 symbols written. Apple: 2,111 funds, 3.72 billion shares; Vanguard Total Stock Market 466 million (5.87% of the fund), Vanguard 500 381 million, iShares Core S&P 500 202 million, Fidelity 500 188 million, SPDR S&P 500 178 million.

Tests were a scratchpad Node suite (42 checks, including the streaming reader against an archive written to disk in the test) plus the real run. Neither surface was rendered in a browser by the build.
