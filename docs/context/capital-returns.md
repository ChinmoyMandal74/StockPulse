# Capital returns: what a company did with its cash (2026-10-11)

The owner, choosing from a list of public data not yet read (backlog 39): "lets work on capital returns". For one company: shares bought back, dividends paid, pay given in stock and the change in the share count, from the cash-flow statements it filed.

## Where the figures come from

The SEC company facts feed the filings refresh already downloads. Three concepts were added to `secfacts.js` `CONCEPTS` (and their IFRS equivalents), so they ride the existing reader, the existing quarter derivation and the existing table:

- `buybacks`: `PaymentsForRepurchaseOfCommonStock`, `PaymentsForRepurchaseOfEquity`
- `dividendsPaid`: `PaymentsOfDividendsCommonStock`, `PaymentsOfDividends`, `PaymentsOfOrdinaryDividends`
- `stockComp`: `ShareBasedCompensation`, `AllocatedShareBasedCompensationExpense`

They are cash-flow lines, so a 10-Q carries them year-to-date and the quarter is derived by the same subtraction as operating cash flow (`deriveQuarters`). All three are in `FLOWS`, so a euro filer's are converted at the period's average rate like every other flow, and in `FILLABLE`.

The share count is `sharesDiluted`, which was already stored.

## Where things live

- `capreturns.js` (root, pure): `build(rows, today)` -> `{ basis, last, years, sharesChange, currency }` or null; `ratios(last, marketCap)`; `shareChange`.
- `db.js`: three columns on `sec_facts` (`buybacks`, `dividends_paid`, `stock_comp`) through `ADDED_COLUMNS`, `SEC_COLS` and `SEC_FIELD`. No new table.
- `server.js`: `capReturnsPayload(symbol)`, `GET /api/capital-returns?symbol=` (guests: their twenty).
- `sec-reread.js`: asks the deployed app to re-read every company's filings once. Needed after a change to what the reader keeps, because a stored row predates it. HTTP calls only.

## Rules that must hold

- **A line that is not filed is not a zero.** Tesla files no buyback line and no dividend line. Both are a dash and "not reported", never $0. What was returned is whichever of the two lines was filed, and null where neither was.
- **The last twelve months are four quarters**, only where all four are there and consecutive (60 to 110 days apart) and at least as recent as the newest fiscal year. Otherwise the latest fiscal year stands in and `basis` is `FY`. Four quarters that lack a line the fiscal year has are worse than the year (a derived quarter was missing): the year stands.
- **Bought back is not net.** Shares handed out as pay offset buybacks, so the share count is shown beside them and every surface says so.
- **A split is not a change in the share count.** Older filings are not restated for a later split; a year-on-year ratio outside 0.7 to 1.4 is withheld.
- **A payment filed as a negative number is withheld.**
- **A newest period more than 550 days old is not "latest"**: no result.
- **Ratios need the market value** (`profile.marketCap`), the one figure not from a filing. Without it, or with free cash flow or revenue not positive, the ratio is null.
- **Display only.** Nothing here is read by `action.js`, stamped on a snapshot row or added to `CHAT_FIELDS`. No surface says whether returning the cash was right, and nothing ranks one company's payout against another's.

## Surfaces

- **Stock page**: section `#capret`, "What it did with its cash", before Revenue mix. Five figures (returned, bought back, dividends, stock pay, share count) and a table by fiscal year with a two-part bar. `loadCapReturns()`.
- **Promo**: card `capreturn`, "Capital returns", in Stock spotlight; one control, `crSym`. Four figures above a row a fiscal year (up to six, oldest first): a bar in two parts, bought back, dividends, and the two as a share of free cash flow. Accent and violet, never green or red. Through `ctx.getCapReturns`, asked by `Cards.capReturnNeed`.
- **Screener**: column `buybackYield`, "Buyback yield", in Fundamentals after Payout. Tooltip gives the dollars, the twelve months they cover and the share-count change. Uncoloured. One `FIELD_SPEC` row.
- **Promo, Rankings**: card `buybacks`, "Buybacks". Controls `bbBy` (yield, amount), `bbFloor` (over $2B by default, $10B, $50B, every company) and `bbCount`. Reads the row, like the column, so the two cannot disagree; a company with no buyback line, or a filed zero, is not in the pool. Shows the share count beside each and says at how many of the listed it fell.

## The screener column and the ranking (same day)

The owner: "Yes add the buy back Yield column ... there should be a promo card on stocks doing buybacks under rank".

- **Where the figures are stored**: `marginChangeBuild` already walks every company's rows once a day, so it also runs `CapReturns.build` and writes `cr: { SYM: [bought back, dividends, share change %, period end, basis] }` into the same `app_meta` value as the margins (`margin_chg`). `buildFlows` carries it as the `cr` part of the stored flows value (`FLOWS_V` 8), and `flowsOf` stamps `buybackTtm`, `buybackYield`, `buybackEnd` and `sharesChg` on the row.
- **The yield is computed at read time** against the row's current market value, so it moves with the price between filings. Null where the company files no buyback line; `0` where it filed a zero; null where it would exceed 100% (a market value of the wrong share class).
- **Column bookkeeping after this**: Fundamentals banner 24, `PAD_SPAN` 117, error row 112, empty row 114. The header row has `PAD_SPAN - 3` cells.

## A US GAAP filer can report in another currency

Found by this feature: JD.com read as a 59% buyback yield. It files under US GAAP **in Chinese yuan**, and `currencyOf` returned null for every US GAAP filer, so the reader took the figures as dollars. Its revenue had been shown as dollars too.

- `secfacts.js` `currencyOf` now asks the same question of a US GAAP filer and still answers **null where it is dollars**, which leaves every US company's path as it was. `normalise` treats any non-dollar filer as `foreign`: read in that currency alone, converted by `toDollars`, and **no rows at all** where there is no rate, rather than yuan under a dollar sign.
- The refresh already asked `currencyOf` and already had rates for about thirty currencies (`fx.js`), so nothing changed in `server.js`.
- `sec_state.currency` is now set for these filers with `taxonomy` still `us-gaap`. The screener's "Foreign" label reads the taxonomy and is unchanged.
- Known and not fixed: Toyota files IFRS now but still has old US GAAP facts, so it is read as a US GAAP filer in yen and its newest rows are years old; it gets no capital-returns figures.

## Seen on real data

Apple, twelve months to Jun 27 2026: $97.9B returned ($82.2B bought back, $15.6B dividends), 72% of free cash flow, share count down 2.6%. JPMorgan: $49.0B, share count down 3.4%, no free-cash-flow share (a bank's capex line is not filed). Tesla: neither line filed.

Nvidia's fiscal 2022 share count predates its split and is ten times smaller than the next year's: the case the split guard exists for.

## Known limits

- A company that tags its buybacks under another concept (for instance inside a combined "repurchase and retirement" line not listed above) reads as not reported.
- Preferred dividends are inside `PaymentsOfDividends` where the company does not file the common-only line.
- Rows written before the company was next re-read hold null in the three columns; `sec-reread.js` was run once on 2026-10-11 to fill them.

Tests were scratchpad Node suites (42 checks on the arithmetic, the reader, the currency case and the card, with cards built from three companies' live filings; 36 on the column, the stamp and the ranking card). No surface was rendered in a browser by the build.
