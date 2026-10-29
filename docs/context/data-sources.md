## Data sources for the fundamentals: the release, the SEC data and Twelve Data

Written 2026-10-29, the day the owner set the rule below. It brings together the measurements made that day (detail in `earnings-releases.md`) and the plan on the admin page `/sources` (built by `td-release-map.js`). **Nothing here is built into the screener yet.** The rule is the owner's decision; applying it to a Signal input is a further decision (see "The Signal").

### The three sources

| | Earnings release | SEC data (`sec_facts`) | Twelve Data |
|---|---|---|---|
| What it is | The results 8-K's press release (Exhibit 99.1), read by Claude Haiku into `earnings_releases` (`releases.js`) | The company's own 10-Q and 10-K XBRL data (`secfacts.js`), every filing kept with its filing date | The price provider's `/statistics`, `/earnings`, `/profile` (`fetchProfile` in `server.js`) |
| When | The day of the release: read at 09:15 or 18:15 Eastern | Same day as the release for 48%; median 1 day after; 90th percentile 13 days; fourth quarter (10-K) median 5, p90 23; banks and insurers median 4, p90 22 | A median 6 days after the release (p90 16); 13-16% had not caught up by the end of the measurement; plus our 7-day profile rotation |
| Periods | The quarter and the same quarter a year earlier; the balance sheet at quarter end; cash flow for the quarter or the year to date | Quarters, halves, nine months, years, each with its filing | Twelve months, the latest quarter, current values; no quarter history |
| Strength | First; the company's own words and labels (adjusted EPS, guidance, its own free cash flow) | The structured, dated record; restatements visible; free | Covers what the filings lack: estimates, float, forward dividends, classification, prices |
| Weakness | An AI reading: checked against the release text and scale, but releases differ in what they print (cash flow in about 40%, gross profit in 44%) | Our choice of one tag per concept goes wrong sometimes (ADM revenue $6.3B against $21B; a few share counts x1000; debt stored as `LongTermDebtNoncurrent` only); coverage gaps (banks' revenue, foreign filers) | Undisclosed definitions (levered free cash flow; operating margin mostly one quarter's; trailing P/E at its own week-old price); about 80 credits a profile |

### The rule (the owner, 2026-10-29)

> "lets take the data from Earning release if that is available as it comes first However SEC data is more accurate when it comes to restatements if SEC data exists we should take the data from SEC, if for some reason SEC data is not dependable we should get it from Twelve data."

In order, for each figure of each company:

1. **The release**, while it is the newest: from the release until the SEC data has the same quarter.
2. **The SEC data**, once it has that quarter and is dependable: it carries restatements (the latest filing for each period).
3. **Twelve Data**, where neither gives a dependable figure.

**Dependable** is mechanical. An SEC value is not dependable when:
- it is missing, or the SEC data's newest quarter is older than the release's (the 10-Q is not filed yet; the release is used);
- it fails a scale check (a thousandfold off the company's size);
- it disagrees with **both** the release and Twelve Data while those two agree with each other (two out of three; ADM's revenue is the case).

**Twelve months** follow the rule a quarter at a time: each quarter of the four takes its SEC figure (latest filing) where dependable, else its release figure; an older quarter whose release figure was later restated (a later release's year-ago column, or the SEC data's latest filing) takes the restated one, in the calculation only. The original reading stays on file (keep all history). Twelve Data gives no quarters, so it stands in for the whole twelve-month figure only when the four quarters cannot be put together. **Growth** is taken from the release's own two columns (this quarter and the same quarter a year earlier, printed on one basis), then the SEC data's.

**Visible, not silent.** When the source changes and the value moves (a restatement, a bank's net against total revenue), the cell's hover says which source is used and what the other said: "Release $X; 10-Q $Y, used". In about 90% of cases the 10-Q confirms the release and nothing visibly changes.

### Definitions come first

The rule swaps sources, so it only works where the three mean the same thing. Settled: revenue, operating income, net income (attributable to the company), diluted EPS, gross profit, margins, growth, operating cash flow, current ratio. **Open, the owner's decisions:**
- **Free cash flow**: Twelve Data's is levered free cash flow (`levered_free_cash_flow_ttm`); the filings and releases give operating cash flow less capex. Microsoft: $16.5B against $60.0B from four releases ($67.0B in the 10-K). Only 3% of companies agree within 2%. It feeds FCF TTM, FCF margin, FCF yield, and two Signal inputs.
- **Total debt**: no two sources agree often enough (12-38%). Define it once (current and long-term borrowings, leases apart) and extract the missing SEC lines.
- **Banks' revenue**: net revenue (what banks headline) or total revenue (what the filing tag gives). One line, used throughout.

Until a definition is set, its columns stay on Twelve Data.

### What was measured (2026-10-29)

From `release-compare.js`, `signal-release-measure.js` and `td-release-map.js`, all on the local research copy (`analysis-db.js --sec`), no API calls.
- **The release against the 10-Q** (5,672 releases matched since July 2025; share within 0.5%): diluted EPS 98.6%, operating income 98.2%, gross profit 98.5%, total assets 99.6%, operating cash flow 96.8%, revenue 90.6%, net income 90.3%. The misses traced are mostly definitions (banks' net revenue, non-controlling interests) or the SEC data's own faults (ADM).
- **Against Twelve Data on the same report, Revenue TTM**: four releases summed agree 88.5% (n 799); the SEC data 83.1% (n 907). The release is not less accurate than the SEC data on revenue.
- **Restatements**: a release's year-ago figure differs from what the original release said by more than 0.5% for 3.6% of revenue figures and 4.6% of net income (most by over 5%); in the SEC data a quarter filed again later changed by more than 0.5% for 5.1% of revenue and 7.5% of net income. Part of the release figure is the reader taking a different line (Arch Capital, an insurer), part real recasts (Arcosa after a sale): not yet separated.
- **Yahoo Finance waits for the 10-Q** (0 of 18 before it); **TradingView takes the release** (15 of 18 before the 10-Q). On the home page since 2026-10-29.
- **The Signal**: with the release-based inputs where the release is newer than Twelve Data's report, 9 of 1,258 verdicts change (the new quarter arriving); 32 if always used, 14 of them from the free cash flow definition alone.

### The plan around it (the admin page `/sources`)

- **One period a column, said in the header** (TradingView names every field by period): TTM, Q YoY, Q end, Now, Fwd. Header text only; `FIELD_SPEC` labels are stored `group|label` keys and are never renamed.
- **Regroup the screener by statement** (17 groups, ids kept, a new Cash flow group `cflow`; moved fields through `FIELD_KEY_MOVED`).
- **Half-yearly reporters on their own period** (twelve months from the halves; growth on the half a year earlier).
- **Fix Operating margin** (twelve months, not Twelve Data's quarter).
- **Add**: operating income, capex, interest cover (data stored); EBITDA margin, ROIC, FCF per share (after new data).
- **New data to extract**: depreciation and amortization, cover-page shares outstanding, short-term investments and the rest of the debt lines (SEC concepts for `secfacts.js`, one `sec-reread.js` pass, no API credits); the declared dividend per share with its dates (a release field, about $8 to backfill); employees and public float (measure coverage first).

### The Signal

The Signal reads Twelve Data's fundamentals (`action.js`: market cap, forward P/E, net income, profit and gross margin, free cash flow and its margin, ROE, revenue and earnings growth, short % of float, Quality). Applying the rule to those is a change of verdict inputs: **the owner's decision, made separately**, after the display columns have run on the rule. Prove the boundary behaviourally as CLAUDE.md requires.

### Order of work agreed

1. This document.
2. Encode the rule on `/sources` as the best source (release, then SEC once filed, then Twelve Data, with the dependability test) and measure, column by column, how often each source would be used and how often the SEC data fails the test.
3. Then, with the owner: the period tags and the regrouping (display only), the definitions above, the new SEC concepts, and the display columns onto the rule. The Signal last, and only on the owner's word.

### The rule, simulated on /sources (2026-10-29)

`td-release-map.js` now runs the rule for every company on each column where a source on the same definition exists (21 columns; judgment rows such as free cash flow, debt, market cap, shares out and the forward dividend rows are left out until their definitions are set). For each company it picks: the release when the SEC data is not yet on the release's quarter; the SEC data when it is and passes the test; the release when the SEC data fails the scale check (more than twenty times off **every** other source present; first written against the release alone, which set Clearway aside against a near-zero release figure though the SEC and Twelve Data agreed) or is outvoted (the release and Twelve Data agree within 2%, or 1 point, and the SEC agrees with neither); Twelve Data where neither the release nor the SEC data has a figure. A source on another definition does not take part (the SEC's cash, without short-term investments, waits for that line). Measured at the level of the column's twelve-month figure; the build applies it a quarter at a time.

On 2026-10-29, over the 21 columns: **the release 5,497 company-columns (21%), the SEC data 16,039 (62%), Twelve Data 4,241 (16%)**. Revenue TTM: release 251, SEC 846, Twelve Data 161; SEC set aside 230 times (187 not yet on the release's quarter, 12 failed the scale check, 31 outvoted). Traced, the set-asides are the SEC data's real faults: Charter's revenue $0.51B against $54.4B in the release and at Twelve Data; MetLife's $2.68B against $79.4B; GM's without GM Financial ($169.8B against $187.0B); on net income, Digital Realty, KKR, MetLife and Charter, where the SEC figure carries non-controlling interests and the other two do not. The page shows each column's split as a bar (release, SEC, Twelve Data) with these examples on hover; the Excel export carries the counts.

### Done (2026-10-29)

**Step 1, period tags and the regrouping**, in the screener table: see `column-groups.md`. The `/sources` page shows each plan step's status (done, open, decided, your decision), a dated decisions log (`DECISIONS` in `td-release-map.js`), and "Moved to" on the three columns moved. The catalogue behind the stock page, hover card, phone and tiles is not regrouped yet (its keys are stored).
