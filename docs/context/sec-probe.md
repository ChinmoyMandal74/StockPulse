## The SEC probe: why one company's newest quarter is missing (2026-10-13)

**Where it came from.** A comparison of the vendor's fundamentals with the same figures worked out from stored filings found about 110 US-dollar filers (140 on raw rows) whose `sec_facts` ended at the March 2026 quarter, though `sec_state.lastResults` showed a July results announcement and every one had been re-read a day earlier with status `ok`. Ford, Visa, PayPal, Citigroup and NextEra were among them. A direct request to the SEC from the owner's machine was answered 403, so the question had to be asked from the deployed app.

**What it is.** `GET /api/sec/probe?symbol=F`, the cron secret or an admin. It makes the refresh's two requests for ONE company (the filing list, then the facts feed), runs `SecFacts.normalise` exactly as a refresh would, reads what the table holds, and **writes nothing**. `secprobe.js` is the pure part: it lines the newest six annual and quarterly reports up against the feed, the reader and the table, and names where the newest one stops.

| verdict | meaning |
|---|---|
| `feed` | the report is on the SEC's list but no fact in the feed carries its accession: nothing we read could contain it |
| `reader` | the feed carries it, and `normalise` made no row from it (the answer says whether any tag we know was present) |
| `stored` | `normalise` makes rows from it, and the table does not hold them |
| `instep` | list, feed, reader and table agree |
| `nofeed`, `nolist`, `nocik` | no facts file, no report on the list, no company under the ticker |

**What it found (2026-10-13).** Twelve of the affected companies, twelve `feed`: F, V, C, PYPL, NEE, SPGI, CB, NXPI, DLR, BE, QRVO, VFC. Each one's June 10-Q is on the SEC's filing list (filed late July or early August) and **no fact in any section of the facts feed carries its accession**; the feed's newest filing is the March 10-Q. Citigroup's feed lacks its March 10-Q as well and stops at the 10-K. The controls, MSFT and AAPL, are `instep`. So the reader and the table are not at fault: the SEC's `companyfacts` feed is two to three months behind its own filing list for these companies, and another re-read will not help. Why the feed omits them is not known. The way round it, not built, is the one `segments.js` already uses: read the report's own XBRL instance from the filing when the feed has no facts for an accession on the list.

- **A report found only under a section the reader does not read** (`dei`, `srt`, a company extension) is reported as `reader`, not `feed`: the first version looked under the accounting taxonomy alone and could have blamed the SEC for our own gap.
- **One company a call, on purpose.** A sweep is the refresh's job, and this address has had a 429 then a 403. To look at several, call it several times with a pause between.
- The answer carries counts and dates, never figures.
- 18 checks on fixtures (each verdict, the empty cases, that the route writes nothing and makes two requests).
- Not on any page. If it earns a button, it belongs on `/sec` beside the coverage table.
