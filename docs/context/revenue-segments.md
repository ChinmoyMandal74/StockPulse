# Revenue segments: where a company's revenue comes from (2026-10-11)

The owner, after seeing a third-party API (StockFit) that sells footnote data: "can you build revenue segments". Built from the SEC directly. One company's latest fiscal year, broken down the way the company tagged it in its own annual report: by product or service, by business segment, by region.

## Why it needs its own files

`companyfacts`, the feed the filings refresh downloads, carries only totals. A breakdown is a dimensional fact (revenue for the iPhone, revenue for Europe) and lives only in the filing's XBRL **instance document**. So for each company's newest annual report two files are read: the instance (`<stem>_htm.xml`, about 1MB to 15MB unpacked, 70KB to 700KB on the wire) and the label file (`<stem>_lab.xml`, the company's own names for its members).

## Where things live

- `segments.js` (root, pure apart from `collect`): `AXES`, `REVENUE`, `parse(instanceXml, labelXml)`, `contexts`, `labels`, `subtotals`, `nameOf`, `urls`, `latestAnnual`, `collect`.
- `db.js`: table `sec_segments (symbol pk, accn, filed, form, url, data, at)`, in `SYMBOL_TABLES`. `data` is NULL for a report that was read and had no breakdown, so it is not fetched again.
- `server.js`: the hook in `secFetchOne`, `segmentsPayload(symbol)`, `GET /api/segments?symbol=`.
- `sec-segments-load.js`: the first fill (`--commit`, `--only`, `--limit`, `--redo`).

## Rules that must hold

- **Three axes, one at a time.** `srt:ProductOrServiceAxis`, `us-gaap:StatementBusinessSegmentsAxis`, `srt:StatementGeographicalAxis`, and their IFRS equivalents. A fact tagged on two axes at once (iPhone in Europe) is in neither list. A context with a typed member is skipped.
- **The year is the newest full-year period an undimensioned revenue fact covers**, read from the facts, not the cover page.
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

`secFetchOne` reads a company's newest annual report only when its accession number is not the one on file: two requests a company a **year**, in its own `try` with a 20-second clock. A 429 records nothing; a 404 (no instance beside the document) is recorded as nothing-to-read; a server error is left to be retried.

## Surfaces

- **Stock page**: section `#seg`, "Where the revenue comes from", before Institutional holders. One table per breakdown; a subtotal is kept in the table, set apart and greyed, since here there is room to show what it is the sum of. `loadSegments()`.
- **Promo**: card `revmix`, "Revenue mix", in Stock spotlight. Controls `rmSym` and `rmKind` (auto, product, segment, geo). Draws the parts only; a breakdown the company does not report falls back to one it does and says so. Bars in the accent, the change in blue or orange (a change in sales, not in price). Through `ctx.getSegments`, asked by `Cards.revMixNeed`.

## Known limits, seen in the dry runs

- **Some breakdowns are partial and say so.** UnitedHealth's premiums are a different concept from the ones read here, so its product list covers a fifth of its revenue. Visa's includes client incentives as a negative member. Pfizer's drug-by-drug list is tagged on two axes and is not read.
- A company whose list of recent filings holds no annual report has no breakdown (seen for one large company whose CIK on file returned only 34 filings).
- A label file that cannot be read costs the names, not the numbers.

Tests were a scratchpad Node suite (59 checks, three real annual reports among the fixtures) plus dry runs over thirty-five well-known companies. Neither surface was rendered in a browser by the build.
