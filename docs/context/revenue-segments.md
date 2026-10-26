# Revenue segments: where a company's revenue comes from (2026-10-11)

The owner, after seeing a third-party API (StockFit) that sells footnote data: "can you build revenue segments". Built from the SEC directly. A company's revenue broken down the way the company tagged it in its own reports: by product or service, by business segment, by region.

**Annual and quarterly, with history (same day).** The first version kept one row a company, the newest fiscal year only. The owner: "annual data could be very old, why not store annual and quarter and also the history". It now keeps every fiscal year and every quarter it reads, one row a period.

## Why it needs its own files

`companyfacts`, the feed the filings refresh downloads, carries only totals. A breakdown is a dimensional fact (revenue for the iPhone, revenue for Europe) and lives only in the filing's XBRL **instance document**. So for each report two files are read: the instance (`<stem>_htm.xml`, about 1MB to 15MB unpacked, 70KB to 700KB on the wire) and the label file (`<stem>_lab.xml`, the company's own names for its members).

## Where things live

- `segments.js` (root, pure apart from `readReport`): `AXES`, `REVENUE`, `SPANS`, `periods(instanceXml, labelXml, 'FY'|'Q')` (every period an instance carries, newest first), `withPrior(period, yearBefore)`, `reports(recent)`, `plan(recent)`, `readReport({cik, report, getText, labelsFrom})`, `contexts`, `labels`, `subtotals`, `nameOf`, `urls`. `parse`, `latestAnnual` and `collect` are the first version's one-year shape; nothing in the app calls them.
- `db.js`: `seg_periods (symbol, ptype, d) -> accn, form, filed, url, data` and `seg_filings (symbol, accn)`, the record of which reports were read, including those with no breakdown. Both in `SYMBOL_TABLES` and on the `query-plan-test.js` list. `writeSegReport`, `readSegAccns`, `readSegPeriods`. The old `sec_segments` table is superseded and unread.
- `server.js`: the hook in `secFetchOne`, `segmentsPayload(symbol)`, `GET /api/segments?symbol=`.
- `sec-segments-load.js`: the history backfill (`--commit`, `--only`, `--limit`, `--redo`). Resumable: a report already read is not fetched again.

## Rules that must hold

- **Three axes, one at a time.** `srt:ProductOrServiceAxis`, `us-gaap:StatementBusinessSegmentsAxis`, `srt:StatementGeographicalAxis`, and their IFRS equivalents. A fact tagged on two axes at once (iPhone in Europe) is in neither list. A context with a typed member is skipped.
- **A period is what its length says**: 350 to 380 days is a fiscal year, 80 to 100 a quarter. The six- and nine-month year-to-date figures in a quarterly report are neither and are not read. Periods come from the facts, not the cover page.
- **One filing yields several periods.** An annual report carries its year and usually the two before; a quarterly one its quarter and the same quarter a year earlier. All are kept.
- **A period already on file is replaced only by a later filing.** A newer report restates its comparatives in the company's current groupings, which is what makes a history line up; an older report read afterwards (the backfill goes newest first) must not undo that.
- **The fourth quarter is worked out, not stored.** Companies report it only inside the annual figure. The owner, seeing Microsoft's newest quarter stop at March with a June year already filed: "do the 4th quarter". `Segments.fourthQuarter(fy, quarters)` is the year less the three quarters before its end, line by line, computed in `segmentsPayload` at read time and marked `derived` (`derivedAt` in the history). It is withheld wherever the subtraction is not like-for-like: a quarter missing, another currency, a breakdown on a different revenue concept, a member list that differs between the year and any of the three quarters, or a result that is not positive. A breakdown that fails is dropped; with none left there is no fourth quarter (Nvidia's January 2026 quarter: it regrouped its product lines in the following year's reports). The stock page marks one with an asterisk and "worked out"; the card says so in its note. Where the year and its fourth quarter end on the same day, "most recent" is the fiscal year.
- **Change is against the same period a year before**, found among the stored periods (an end date within twelve days of 365 earlier), member by member on the company's own member code. No such period, or the member absent from it: null, never zero.
- **Labels are not always in a label file.** Some filings carry them in the schema (`<stem>.xsd`) and have no `_lab.xml` (Microsoft's 2026 annual report). A 404 on the label file tries the schema. The backfill fetches labels once a company and reuses them.
- **One revenue concept per breakdown: whichever the company used most on that axis**, the total's own on a tie, and the breakdown is measured against that concept's own total (`kinds[k].total`). Pfizer tags two small lines with the contract-revenue concept and its drug list with plain Revenues; preferring the total's concept drew the two small lines as the mix.
- **Subtotals sit in the same list as their parts.** Apple tags "Products" beside iPhone, Mac and iPad. `subtotals()` finds members equal to a sum of two or more others, to a tight tolerance (0.05%: a filing's subtotal is the exact sum; at 0.4% a fifteen-drug list produced coincidences for nearly every large member).
- **Candidates are only candidates.** A member can equal a sum by coincidence. The marking kept is the smallest set of candidates that leaves parts adding up to the total. Where none does: in a list of up to eight the candidates stand; in a longer one none is marked.
- **The same total split two ways on one axis.** Microsoft tags Product and Service (the whole) and also its ten product lines (the whole again); together twice the revenue. Where the parts overshoot, the largest set of them that makes exactly the total is kept and the rest are marked like subtotals.
- **`complete`** is whether the parts add up to the total within 1.5%. Where they do not, the page and the card say so and claim no whole.
- **Not comparable across companies.** The members are each company's own; Apple reports "Americas" and Microsoft "United States". Nothing ranks one company's mix against another's.
- **No conversion.** A foreign filer's breakdown stays in its reporting currency, named beside the figures; the card prints "EUR 15.3B", never a dollar sign.
- **Names**: the company's standard label, " [Member]" removed; a long all-capitals label is set as a name ("UNITED STATES"), a short one is left as the abbreviation it is ("EMEA"); with no label file the member code is spaced out ("Server Products And Cloud Services").
- **Display only.**

## Freshness

`secFetchOne` reads any annual or quarterly report filed after the newest one already read, **at most two a visit**, oldest first, in its own `try` with a 20-second clock. A company never read starts with its newest of each. With the rotation visiting each company about weekly, a new report is on the page within about a week of filing. A 429 records nothing; a 404 (no instance beside the document) is recorded as nothing-to-read; a server error is left to be retried.

The payload (`segmentsPayload`) gives two views, `views.FY` and `views.Q`, each with `ends` and `totals` (six years or eight quarters, newest first) and `past` on every member; the top level repeats whichever view ended most recently.

## Surfaces

- **Stock page**: section `#seg`, "Where the revenue comes from", before Institutional holders. Fiscal year / Quarter tabs where both are on file, opening on the more recent. One table per breakdown (a subtotal is kept, set apart and greyed), and under it the same members period by period, oldest on the left. `loadSegments()`.
- **Promo**: card `revmix`, "Revenue mix", in Stock spotlight. Controls `rmSym`, `rmKind` (auto, product, segment, geo) and `rmPeriod` (auto = most recent, FY, Q); a period it does not have falls back to the one it does, and the card's wording follows what is drawn. Draws the parts only; a breakdown the company does not report falls back to one it does and says so. Bars in the accent, the change in blue or orange (a change in sales, not in price). Through `ctx.getSegments`, asked by `Cards.revMixNeed`.

## The mix over time (2026-10-11)

The owner: "evolution of revenue mix on individual stock page and also on promo". One stacked column a period, each column a whole, so the eye reads how the proportions moved.

- `Segments.mixOver(cur, hist)` -> `{ ends, derivedAt, parts: [{ name, other, shares }], skipped }` (oldest first) or null. Computed in `segmentsPayload` as `mix` on every breakdown of both views, over the same six years or eight quarters as the history table.
- **A period is drawn only if it is the same breakdown as the newest one**: every part it names must be a part the company reports now. One that names another is a regrouping and is left out and counted in `skipped`; both surfaces say how many. A part absent from an earlier period is taken as not yet existing: a share of zero.
- Also left out: a period with a negative part, and one whose parts do not add up where the newest one's do. A newest period with a negative part has no mix at all (Visa's client incentives).
- **A period missing between two drawn columns is a gap and is drawn as one.** The owner, of Nvidia, whose Jul 25 column stood beside Apr 26 with two quarters left out between them: "indicate the gaps clearly". `mixOver(cur, hist, ptype)` checks the spacing of the columns (about 91 days a quarter, 365 a year) and inserts an empty column for each period skipped: `gapAt` true, every share null (never zero), dated from the period on file where there is one and where it would have fallen otherwise. Both surfaces draw it dashed with "no comparable figures". `skipped` now counts only the periods before the first column.
- **Shares are of the parts drawn**, so a column is always 100. Where the breakdown does not add up to the company's revenue the surfaces say "shares of the parts reported".
- Six named parts at most, the largest in the newest period, and the rest as one "Other (n smaller)"; seven parts are all named. Fewer than three columns is not an evolution: null, and the card says there is too little history rather than drawing two columns.
- **Stock page**: under each breakdown's history table, "How the mix has changed", with a legend giving each part's first and last share.
- **Promo**: the same `revmix` card, control `rmView` (`latest`, `evo`), like the pyramid inside the Signal card. Legend with first share, last share and the change in percentage points (blue or orange). Colours come from `RM_INKS`; a part is not a price, so no green or red. The palette is repeated in `stock.html`.
- Seen on real data: Amazon online stores 51% to 38% of revenue over six years while AWS went 12% to 18%; Nvidia by product has three columns and three left out (it regrouped).

## Known limits, seen in the dry runs

- **Some breakdowns are partial and say so.** UnitedHealth's premiums are a different concept from the ones read here, so its product list covers a fifth of its revenue. Visa's includes client incentives as a negative member. Pfizer's drug-by-drug list is tagged on two axes and is not read.
- A company whose list of recent filings holds no annual report has no breakdown (seen for one large company whose CIK on file returned only 34 filings).
- A label file that cannot be read costs the names, not the numbers.
- **Heavy filers have short lists.** The backfill plans from the `recent` list of a company's filings (its newest thousand). A bank that files hundreds of prospectus supplements a month has only about a year in it: JPMorgan got one annual report and three quarterlies, and its quarterlies tag no breakdown.
- Six quarterly reports give about nine quarters, not twelve: three a year, so their comparatives overlap.
- Some companies' own standard labels are odd (Microsoft: "Microsoft Three Six Five Commercial Products And Cloud Services"). They are shown as filed.

Tests were scratchpad Node suites (59 checks on the parser with three real annual reports among the fixtures, 37 on periods, the filing plan, `readReport` and the card, 15 on the fourth quarter and its guards, 32 on the mix over time including cards built from the real payload of seven companies) plus a committed run on five companies read back through the payload. Neither surface was rendered in a browser by the build.

## The mix over time, in amounts (2026-10-13)

The owner, of the mix-over-time card: "you are showing the %, can you also show the absolute value as another option". A third choice under Show on the Revenue mix card, `rmView: evoabs`, "How the amounts have changed".

- `Segments.mixOver` now returns `values` on each part (the part's figure in each column) and `totals` (each column's sum of parts), in the reporting currency; null in a gap, like the shares. "Other" is the sum of the parts it stands for.
- The card draws the same columns, each **as tall as that period's total on one scale**, with the total printed above it and each part labelled in money where there is room. The legend gives the first and last amounts and each part's **growth**, where the share view gives points of share.
- The title reads "revenue by product, over time", not "revenue mix".
- A payload with no amounts (cached from before they existed) draws the shares, not an empty chart.
- Promo only. The stock page already has the amounts in the period-by-period table beside its share chart.
- Seen on real data: Micron by quarter, $8.7B to $54.2B over eight quarters, where the share view shows DRAM at 73% at both ends.
- Scratchpad suite, 21 checks including Micron's real payload. Not rendered in a browser by the build.

## Two more shapes, and the companies still without a mix (2026-10-26)

The owner, on Ross Stores' empty Revenue mix card: *"Why Ross Stores does not have revenue mix"*, then *"yes, also see which other companies has missing revenue mix data and if there is a way to fix it"*.

**Survey (before the change): 174 of 1,259 companies had no mix**: 150 read with nothing found, 16 foreign IFRS filers, 4 never read, 4 with no SEC filer. Each of the 150's newest annual data file, read from the SEC (scratch `seg-survey.js`):

| shape | companies | |
|---|---|---|
| dollar revenue on two axes (segment x `srt:ConsolidationItemsAxis` OperatingSegmentsMember, the newer disclosure; Netflix region x Streaming) | 41 | **read now** |
| another revenue concept on the axis (rental income for REITs, premiums for insurers, regulated revenue for utilities, interest income for banks) | 35 | not yet: each needs its own total to measure against |
| no breakdown tagged (single segment, mortgage REITs, BDCs) | 28 | nothing to read |
| shares of revenue only (`us-gaap:ConcentrationRiskPercentage1` with a revenue benchmark): Ross, TJX, Ulta, Zscaler, Palantir, Chubb, Roblox | 24 | **read now** |
| revenue only on other axes (one segment, legal entities, related parties; O'Reilly, Casey's) | 17 | nothing to read |
| no data file or no annual report read | 5 | |

**`segments.js`**:
- `read()` also keeps concentration percentages whose benchmark member names revenue or sales (`shares`), and reads concept names with digits.
- `twoAxis(facts, kind, inP)`: facts on two axes where the second holds ONE member throughout (the operating segments member of ConsolidationItemsAxis, never eliminations or corporate; or one member of another breakdown's axis), returned as if on the one axis.
- `shareKind(shares, kind, inP, total, lab)`: a breakdown from shares alone, members worked out as share x total for ordering, marked `fromShare`; only the breakdown's axis and the concentration axes may be on the fact; a share above 1.5 is a percent.
- Order in `periodOf`: the axis alone; if it has fewer than two members (Netflix tags one region alone, Ulta one product), `twoAxis`; if still fewer, `shareKind`. Amounts always win over shares.
- `nameOf` unescapes a label escaped twice in its file (Ulta's "&amp;amp;").
- `segmentsPayload` passes `fromShare` and gives such a breakdown no change between years; the stock page shows a share-only breakdown's shares (no amount, no change, the year-by-year table in shares) and says "shares of revenue as reported; the report gives no amounts". The At a glance card skips a breakdown whose parts add up to more than 103% of revenue (PNC's bank segments read 120%).
- Checked on real filings: Ross (Home Accents and Bed and Bath 26%, Ladies 22% ...), TJX (Marmaxx 61% ...), Ulta (Cosmetics 38% ...), Netflix (US and Canada 44%, EMEA 32% ...), Fox; Apple and Microsoft unchanged.
- **`segments-test.js`** (new, 13 checks on made-up instances): the plain shape, segment x operating segments, eliminations refused, Netflix's lone region, a customer axis refused, Ross's shares, a percent written as 26, amounts over shares, a receivables share refused, a share on two breakdowns refused, the doubled escape. The operating-segments rule and the lone-member fallback each proved by reverting.

- **Re-read 2026-10-26** (`sec-segments-load.js --commit --redo --only` the 154 without a mix): 1,123 reports in 12.8 minutes, no failures. **50 companies gained a mix** (Ross, TJX, Ulta, Netflix, Zscaler, Chubb, Palantir, Roblox, Fox, Prologis, Colgate, Darden, Burlington, Constellation Brands and others): 1,135 of 1,259 companies now have one. Still without: the 35 with another revenue concept, the 28 with no breakdown tagged, the 17 with revenue only on other axes, the 16 IFRS filers, and a few without a filing.
