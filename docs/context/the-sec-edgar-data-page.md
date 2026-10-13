## The SEC EDGAR data page
**`/edgar` (admin, a `SEC EDGAR data` row in the console's Data section): the status of every data pull that is not prices or profiles, and what can be done to refresh each (2026-10-08, owner's request).** It replaced the SEC EDGAR panel on `/admin`, which showed two of the six pulls and no clock for either.

- **A seventh card, Quality of the filings (2026-10-13)**, directly under Company filings: see the section at the end.
- **Six cards**: company filings, earnings-announcement dates (Item 2.02), insider transactions, short interest (FINRA), S&P 500 membership (the SPY holdings file) and split history. The last three are not SEC sources and each card says so; they are here because they are the same kind of thing, a scheduled pull with a clock.
- **Each card carries a verdict pill, its counts and dates, a "Kept up to date by" line, and its actions.** Insider transactions says *Nothing keeps this up to date on its own*, which is true: the quarterly files are loaded from the laptop and the daily walk is a button.
- **`GET /api/edgar-status` (admin) reads only state tables** (`sec_state`, `insider_state`, `short_state`, `fund_state`, `split_state`) plus the covering-index `max(filed)` the insider route already made. Eight reads in parallel, each with its own catch. Nothing scans `sec_facts` or `short_interest`.
- **The actions are the existing routes, not new ones**: `POST /api/sec/refresh` (missing / rotate / all), `POST /api/insider/daily`, `GET /api/cron/shortint`, `GET /api/cron/holdings`. Work that does not belong in a web request is shown as a command to copy (`insider-load.js`, `sec-results-load.js`, `shortint-load.js`, `backfill-splits.js`).
- **"Check the overdue" counts the never-fetched as well**, because `mode=rotate` takes those first; "Fetch missing" takes only those.
- **Announcement dates are counted against the whole universe**, not against the companies with filings: an IFRS filer has a 2.02 date and no statements.
- `insiderCoverage()` is one function for `/api/insider/coverage` and this page. `store.splitCoverage()` is two aggregates over `split_state`.
- Verified: **34 checks** (`edgar-test.js`) with every outside address stubbed: the status route's figures against a fixture with overdue, never-fetched, errored and no-filings companies; each card's pill, facts and actions; both filings loops run to completion with the card re-read; the FINRA and holdings checks reporting in words; the commands; the admin console's row and the removed panel; guest and stranger refused. **Proved by reverting four times, each load-bearing.**


## Quality of the filings, and the filings against the API (2026-10-13)

The owner first asked for a new data quality page for the SEC data, then: "Don't create a new one, we already have the SEC page, update it." So it is a card on `/edgar`, under Company filings.

**Why it exists.** The existing Data quality page is about the price provider only (bars, profiles, vendor fundamentals), and every flag on it asks whether data is PRESENT. The filings card above this one reports whether a fetch succeeded. Neither could see the two faults found on this day: 110 companies a quarter behind and 340 with no quarterly cash flow, all reading "ok" (`sec-reports-the-feed-lacks.md`).

**Two kinds of check**, `secquality.js`, pure:

- **The filings alone**: behind the SEC list (the newest report on the SEC's list is newer than the newest held), never fetched, fetch failed, no quarters, no trailing year, no cash flow in the newest quarter, currency not converted, newest quarter is old (200 days), annual reports only, read from the report, and the three reasons a company has no filings.
- **The filings against the API**: API ahead, filings ahead, revenue / net income / cash flow differs (trailing year, more than 5% apart), API only, filings only, not compared (currency).

Each flag has a kind in `SecQuality.KIND`: `fault` (look at it), `gap` (amber, a real shortfall or disagreement), `note` (a fact about the company). A company is "nothing to look at" when it has filings and only notes.

- **A difference is not a verdict on either side.** Both figures are shown. Revenue differing is mostly OUR reader on banks, insurers and property trusts (a partial revenue tag); net income differing is mostly what is counted.
- **Compared only where comparable**: the same quarter in both (quarter ends within 10 days), a company reporting in dollars under US GAAP. A foreign filer's stored rows are converted and the provider's are not, so it is counted as not compared.
- **`sec_state.last_report`** is new: the filing date of the newest 10-K, 10-Q, 20-F or 40-F on the company's list, amendments left out, written on every refresh from the submissions file already in hand. `last_filed` is the newest HELD. **Both `insert or replace` statements over `sec_state` carry the column**, or the next refresh would blank it; it is the fourth column they have had to be told to keep.
- **Built on the daily pass, read as one stored value.** `marginChangeBuild` already holds every company's rows, so `SecQuality.build` rides it in its own catch and writes `app_meta` `sec_quality` (about 290 KB: one compact record a company and the summary). `GET /api/edgar-quality` (admin) reads that and nothing else. `POST /api/edgar-quality/rebuild` (admin or the cron secret) runs the daily pass by hand: about 50,000 filings rows read, so it is a button.
- **The page**: seven figures, then every count as a button in two rows; choosing one lists its companies with the filings' quarter, the API's quarter, both trailing figures and how far apart, largest gap first, 300 at most, and one sentence on what the count means. Amber only; no red or green.
- **First reading, 2026-10-13**: 1,181 companies with filings, 858 with nothing to look at; the same quarter in both for 1,108, API ahead 34, filings ahead 38; revenue within 5% for 919 of 1,031 compared, net income 939 of 1,074, operating cash flow 1,058 of 1,072; 105 newest quarters read from the report itself. After a re-read recorded the list dates: **17 behind the SEC list, every one a foreign company on Form 20-F** (TSM, Toyota, Sony, Infosys, Vale, Petrobras and others) whose newest annual report is on the list and not held. Not chased: they report in currencies that are not converted, or under IFRS, and are a separate piece of work.
- 39 checks on fixtures (each flag on both sides of its threshold, the summary, and the card drawn from a built value through the page's own script with the DOM stubbed). **Not looked at in a browser.**
