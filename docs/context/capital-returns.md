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
- No screener column yet. A buyback yield and a share-count change would come from the pass `marginChangeBuild` already makes over every company's rows.

## Seen on real data

Apple, twelve months to Jun 27 2026: $97.9B returned ($82.2B bought back, $15.6B dividends), 72% of free cash flow, share count down 2.6%. JPMorgan: $49.0B, share count down 3.4%, no free-cash-flow share (a bank's capex line is not filed). Tesla: neither line filed.

Nvidia's fiscal 2022 share count predates its split and is ten times smaller than the next year's: the case the split guard exists for.

## Known limits

- A company that tags its buybacks under another concept (for instance inside a combined "repurchase and retirement" line not listed above) reads as not reported.
- Preferred dividends are inside `PaymentsOfDividends` where the company does not file the common-only line.
- Rows written before the company was next re-read hold null in the three columns; `sec-reread.js` was run once on 2026-10-11 to fill them.

Tests were a scratchpad Node suite (38 checks, including the reader on a synthetic year-to-date ladder and cards built from three companies' live filings). Neither surface was rendered in a browser by the build.
