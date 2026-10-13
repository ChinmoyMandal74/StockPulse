## Reports the SEC facts feed lacks, read from the report itself (2026-10-13)

**The fault.** `sec_facts` is filled from one feed, `data.sec.gov/api/xbrl/companyfacts`. The SEC probe (`sec-probe.md`) found that feed two to three months behind the SEC's own filing list for about 110 companies (140 on raw rows): the June 10-Q of Ford, Visa, PayPal, NextEra and the rest was on the list, filed in late July, and no fact from it was in any section of the feed. Citigroup's feed lacked its March 10-Q as well. Why the feed omits them is not known. No re-read could help.

**The owner's decision:** read those reports from their own data files, rather than leave the companies a quarter behind.

**How.** Every report has its figures in a file beside the document, `<stem>_htm.xml` (the XBRL instance; the file `segments.js` reads for the revenue breakdown). `secinstance.js`:

- `missing(recent, facts)` — the annual and quarterly reports on the list whose accession appears nowhere in the feed, and which were filed after the newest REPORT the feed carries. At most three a visit, oldest first. Amendments are left out.
- `extract(xml)` — the tags in the reader's catalogue (`CONCEPTS`, `IFRS_CONCEPTS`), for the company as a whole only: a context with a dimension is a breakdown and is skipped, as the feed skips it. Units are named as the feed names them (`USD`, `shares`, `USD/shares`).
- `inject(facts, report, obs)` — puts them into the feed's own shape, in place, BEFORE `normalise` runs. So the reader, the derived quarters, the gap-filling, the ratios and every page are unchanged: they see one more filing.

`secFillFromReports` in `server.js` does the fetching inside `secFetchOne`, in its own catch: a failure leaves the company where the feed alone would have put it.

- **A report is fetched once.** What `extract` returned is kept in `sec_instance` (symbol, accn, the figures as JSON) and replayed on every later refresh while the feed still lacks the report. A report with no data file (404) is recorded empty for the same reason. A 429 stops the loop and records nothing; any other failure is left to be tried again.
- **Once the feed gains the report, the feed is used** and the stored reading is simply no longer asked for. The row is left where it is.
- `sec_instance` is in `SYMBOL_TABLES` and on the query-plan list. It holds the same public figures as `sec_facts`.

**Dating the feed by its newest report, not its newest filing.** The first cut compared against the newest filing of any kind in the feed. Citigroup's feed carries prospectus fee tables (the `ffd` section) filed after the two reports it lacks, so both looked older than the feed and neither was read. Proved by reverting.

**Does it read a report as the feed does?** Measured, not assumed: `/api/sec/probe?symbol=X&check=1` reads the newest report the feed DOES carry from its own data file and lines the two up by tag, unit and period. MSFT (10-K), AAPL, F, JPM, NVDA and XOM: 297 figures, 297 identical, none missing on either side. `&fill=1` shows what a refresh would add without adding it; on F, V, NEE, QRVO it brought the newest quarter from March to June, and on C from December to June through two reports. Both are read only.

**What the re-read did (2026-10-13, `sec-reread.js`, 1,280 companies, 22 minutes).** The newest stored quarter advanced for 106 companies and went back for none. Against the vendor's snapshot, US-dollar filers whose filings were a quarter or more behind the vendor fell from 111 to 9, and those describing the same quarter rose from 1,006 to 1,106; the agreement rates on the filled quarters are the same as on feed-read ones (revenue 89% within 5%, net income 87%). The 37 still behind across the whole universe are foreign annual or half-year filers (AZN, SHEL, NVS, the Canadian banks) and odd fiscal calendars (COST, AZO): a different condition, and not this one.

**Found on the way, NOT fixed, and not caused by this.** The newest quarter has no operating cash flow for 35 of the 107 filled companies and for 305 of the 1,077 read from the feed. Ford shows why: its June 10-Q mentions one figure for the January-to-March quarter, which makes a nearly empty row for that quarter filed later than the real one. `deriveQuarters` takes the newest statement filing to speak for each period, so the half year minus that empty first quarter gives nothing. `latestFilled` repairs this for display, but the subtraction happens earlier, in `normalise`. It costs cash flow, capex, buybacks and dividends for the quarter, and so the trailing-year figures built on them. The repair is in `deriveQuarters` (take each concept from the newest filing that states it), needs a full re-read after it, and is the owner's call.

**The probe says `filled`** where the newest report is not in the feed and is stored.

- 36 checks on fixtures: which reports are missing, the instance reader (dimensions, signs, units, balance-sheet dates, duplicates, empty facts), the path through `normalise` including a quarter worked out from a half year, the comparison, and the wiring.
- **Not shown on any page**: a row read this way looks like any other, with its accession and filing date, and links to the same filing. Nothing here reaches the Signal.
- The cost is one request per missing report, once. The data files are a few MB; one over 60 MB is skipped.
