# Options open interest (2026-10-11)

The owner, from the list of public data not yet read (backlog 39b): "can you work on options open interest". For each tracked stock: how many call and put contracts are open, where they sit by expiry and strike, and puts per call.

## What open interest is, and what it is not

The number of option contracts that exist and have not been closed, exercised or expired. **Every contract has a buyer and a seller**, so it says how much is outstanding and not which way anyone is leaning: a large put position can be a bet on a fall, insurance on shares someone owns, or one leg of a trade that is neutral overall. Every surface counts and none reads a direction into the count. No "bullish", "bearish" or "sentiment" anywhere.

## The source

The Options Clearing Corporation clears every listed US option and publishes, for any underlying, each series with its call and put open interest:

`https://marketdata.theocc.com/series-search?symbolType=U&symbol=AAPL`

Tab-separated text, one request a stock, about 100KB for a heavily traded one. Figures are as of the last trading day's close and change once a day, overnight.

- A share class is asked without its dot: `BRK.B` is `BRKB`. With the dot the answer is "Invalid symbol."
- A symbol with no options answers "No data exists for X symbol".
- **The OCC's main site sits behind a bot challenge** (its `robots.txt` returned a challenge page from this machine); the data host answered plainly. The terms of use could not be read for that reason and **have not been reviewed**. Requests are sequential, declared with the project's contact address, and once a day a stock.
- The report carries no date. It is taken as the last weekday before the New York date it is read on (`asOf`). A market holiday is not known, so the label is a day late after one; the figures are right.

## Where things live

- `optionsoi.js` (root, pure): `url`, `occSymbol`, `asOf`, `parse(text, sym)` -> `{ status, series }`, `summarise(series, date)`, `pcr`, `ofShares`, `change`.
- `db.js`: `options_state` (one row a stock: newest reading, with expiries and largest strikes as JSON; status `ok` or `none`) and `options_oi` (history: symbol, day, calls, puts). Both in `SYMBOL_TABLES`; `options_oi` on the `query-plan-test.js` list. `writeOptions`, `readOptionsState`, `readOptionsHistory`, `readOptionsAll`.
- `server.js`: `optionsFetchOne`, `POST /api/options/refresh?n=` (cron secret or admin; the stalest stocks not read in twenty hours, up to 40 a call), `optionsPayload(symbol)`, `GET /api/options?symbol=`.
- `options-load.js`: the same work from the owner's machine; the first fill.

## Rules that must hold

- **Standard contracts only.** The same report lists FLEX contracts (product symbols `1AAPL`, `2AAPL`) and contracts adjusted for a corporate action (`AAPL1`, which no longer deliver 100 shares). Only rows whose product symbol is the stock's own are counted, so every contract is 100 shares.
- **A series that expired on or before the as-of date is not open.** The report still lists the contracts that expired at that close.
- **Puts per call is null with no calls**, never infinite, and the screener withholds it under a thousand contracts in all: 3 puts to 1 call on a stock nobody trades options on is not a reading of 3.0.
- **The expiries shown are the eight largest, in date order**, not the nearest eight, which for a heavily traded stock are weeklies holding a sliver of what is open. The count of all expiries travels with them and both surfaces say "of N".
- **A failed fetch writes nothing**, so the last reading stands. A web page where a report should be is a refusal: the batch (or the loader) stops and says so.
- **Display only.** Nothing here is read by `action.js` or added to `CHAT_FIELDS`.

## Surfaces

- **Stock page**: section `#opt`, "Options open interest", before capital returns. Five figures (contracts open with the change on the reading before, calls, puts, puts per call, shares spoken for), a table by expiry with a two-part bar, and the five largest call and put positions. `loadOptions()`.
- **Screener**: column `optPcr`, "Put/Call OI", the last Ownership column. It sits **outside** the fund placeholder, since an index fund has options (SPY's is the most watched there is). Tooltip gives the counts and the date. Uncoloured. Stamped by `flowsOf` from the `oi` part of the stored flows value (`FLOWS_V` 9), with `optCalls`, `optPuts`, `optDate`.
- **Promo**: card `optoi`, "Options open interest", in Stock spotlight; one control, `oiSym`. Calls in the accent and puts in orange, never green or red. Through `ctx.getOptions`, asked by `Cards.optionsNeed`.
- **Column bookkeeping after this**: Ownership banner 11, `PAD_SPAN` 118, error row 113, empty row 115.

## Keeping it current

**The nightly ping drives it.** The deployed app was confirmed to reach the OCC (three of three read, not refused, 2026-10-11), so `nightly-ping.js` has an `options` phase after splits: it calls `POST /api/options/refresh?n=25` until nothing is stale, about 52 calls, and stops for the night on a refusal.

- **A stock is stale when it was not read in the last twenty hours and does not already hold the day this read would be labelled.** The first keeps the 07:30 run from reading: the OCC may not have published the night's figures by then, and they would be stored under the wrong day. So the 19:30 run does the work and each reading is the previous close's. The second stops a weekend or repeated run fetching reports that cannot have changed.
- History is therefore one row a stock a weekday, a session behind.
- By hand, from the owner's machine: `node --use-system-ca options-load.js --commit` (about 35 minutes for every stock; `--all` to re-read the fresh ones).

## Seen on real data (close of 2026-10-09)

Apple 2.77M calls and 2.13M puts (0.77 puts per call) over 24 expiries; Tesla 3.11M and 2.44M; SPY 5.50M calls and 12.78M puts (2.32); Berkshire B 0.59; Coca-Cola Consolidated a few thousand of each.

Tests were a scratchpad Node suite (44 checks, the parser on a synthetic report and on Apple's real one). No surface was rendered in a browser by the build.
