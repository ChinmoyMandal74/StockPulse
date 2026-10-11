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

## Known limits, seen in the dry runs

- **Some breakdowns are partial and say so.** UnitedHealth's premiums are a different concept from the ones read here, so its product list covers a fifth of its revenue. Visa's includes client incentives as a negative member. Pfizer's drug-by-drug list is tagged on two axes and is not read.
- A company whose list of recent filings holds no annual report has no breakdown (seen for one large company whose CIK on file returned only 34 filings).
- A label file that cannot be read costs the names, not the numbers.
- **Heavy filers have short lists.** The backfill plans from the `recent` list of a company's filings (its newest thousand). A bank that files hundreds of prospectus supplements a month has only about a year in it: JPMorgan got one annual report and three quarterlies, and its quarterlies tag no breakdown.
- Six quarterly reports give about nine quarters, not twelve: three a year, so their comparatives overlap.
- Some companies' own standard labels are odd (Microsoft: "Microsoft Three Six Five Commercial Products And Cloud Services"). They are shown as filed.

Tests were scratchpad Node suites (59 checks on the parser with three real annual reports among the fixtures, 37 on periods, the filing plan, `readReport` and the card, 15 on the fourth quarter and its guards) plus a committed run on five companies read back through the payload. Neither surface was rendered in a browser by the build.
