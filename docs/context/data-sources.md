## Data sources for the fundamentals: the release, the SEC data and Twelve Data

Written 2026-10-29, the day the owner set the rule below. It brings together the measurements made that day (detail in `earnings-releases.md`) and the plan on the admin page `/sources` (built by `td-release-map.js`). **The display columns and, by the owner's decision of the same day, the Signal's inputs are on the rule since 2026-10-29** (`sourcerule.js`, see the last two sections).

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

### The owner's answers (2026-10-29)

- **Free cash flow is operating cash flow less capex**, not Twelve Data's levered figure. The FCF columns follow the rule from the release (our operating cash flow less capex, not the company's own stated free cash flow, whose definitions vary) and the SEC data; Twelve Data's figure is another measure, so it is **no fallback**. Simulated: release 144, SEC 839, and **275 companies blank** (banks and insurers, for which it is not worked out, and companies with no cash flow lines in either source), where today they show Twelve Data's levered figure. The Signal's two free cash flow inputs stay on Twelve Data until the owner decides the Signal.
- **Total debt is borrowings, leases apart**: short-term borrowings, commercial paper, current and long-term debt. Waits for the missing SEC lines (`EXTRACT.debt`); Twelve Data until then.
- **Banks' revenue is net revenue**: the release headlines it; the SEC data needs its net revenue concept (`EXTRACT.banknet`, RevenuesNetOfInterestExpense first for financial companies).
- **Regroup the catalogue too**: the stock page, hover card, phone and tiles into the screener's groups, saved setups carried through `FIELD_KEY_MOVED`.

All four are on `/sources` (`DECISIONS`, the plan's statuses, the FCF and Debt rows, the new extraction item).

**The catalogue regrouped too (2026-10-29)**: the stock page, hover card, /compare, phone and tiles use the screener's groups; five keys moved through `FIELD_KEY_MOVED` (see `column-groups.md`). Marked done on `/sources`.

### The new SEC items, extracted (2026-10-29)

`secfacts.js` reads: **depreciation and amortization** (flow; quarters subtracted from the year to date), **banks' net revenue** (`RevenuesNetOfInterestExpense`, else net interest income plus non-interest income in `fill()`: only 15 of 153 financial companies file the direct tag; Capital One's total revenue tag says $2.76B where its net revenue is $15.85B); after the second re-read (2026-10-29, 23 minutes, 1,246 of 1,282 ok) 49 of 153 have it, every company that files both lines; the rest are insurers, card networks, asset managers, exchanges, Citi, Berkshire and Schwab, which headline total revenue and keep it, **short-term investments**, **the debt lines kept apart** (current portion, long-term, `DebtCurrent`, `LongTermDebt`, short-term borrowings, commercial paper, and the lease-inclusive pair as fallback), and from the cover page (`dei`) **shares outstanding, employees, public float**. Twenty new `sec_facts` columns (`SEC_COLS`). **`totalDebt` / `debtParts`**: the owner's definition, borrowings, leases apart; the long-term part LongTermDebtNoncurrent, else the lease-inclusive noncurrent line (traced: NXP, Corning, Micron file `DebtCurrent` beside `LongTermDebtAndCapitalLeaseObligations` and nothing plainer; the pair equals their release's debt exactly), else `LongTermDebt` less the current portion; `debtWithLeases` says when a lease line stood in.

Every company re-read once (`sec-reread.js`, 1,282 companies, 25.5 minutes, no refusals). Coverage of the 1,152 with SEC data: shares outstanding 878, total debt 881, depreciation (EBITDA) 822, public float 1,109, short-term investments 314, employees 29. **Against the release on the same quarter** (the fair test where Twelve Data's definition differs): revenue 92.6%, cash with short-term investments 90.5%, **total debt 81%**, net cash 76%. Against Twelve Data: shares outstanding 94%, cash 77.5% (58% before short-term investments), book value per share 83.5%; debt 21% (Twelve Data counts leases). EBITDA against the release 10% (releases print adjusted EBITDA) and Twelve Data 21% (median gap 9%; Apple exact).

On `/sources`: debt and all built on it, cash, EBITDA, shares outstanding and market cap follow the owner's rule; Twelve Data on another definition (free cash flow, debt) is no fallback but still votes in the two-out-of-three test (Qualcomm, SLB, Williams, General Mills: SEC debt outvoted by the release and Twelve Data agreeing); an "SEC vs release" measure on every row. **A second re-read** loads the banks' net interest and non-interest income lines (added after the first); scheduled after the 16:00 nightly so two SEC jobs never overlap.

### Built: the display columns on the rule (2026-10-29)

The owner: "yes start and then we can tackle signal". **`sourcerule.js`** builds, for every company, the figures below by the rule, and **`stampSources`** (server.js) puts them on the rows on the way out.

**The fields** (none a Signal input; `sourcerule-test.js` checks the list against `action.js` and scores verdicts with the fields absent, stamped and lying, all six words among 43 real-shaped rows, and requires identical verdicts):
- Twelve months, a quarter at a time: `revenueTtm` (banks: net revenue where filed), `grossProfitTtm`, `operatingCashFlowTtm` (the release's quarter worked out from year-to-date statements), `dilutedEpsTtm` (not where a split falls inside the four quarters).
- At the newest quarter's end: `totalCash` (with short-term investments), `totalDebt` (the owner's definition, `SecFacts.totalDebt`; release: current plus long-term debt lines), `netCash`, `debtToEquity` (percent, as Twelve Data gives it), `currentRatio`, `bookValuePerShare` (dollar reporters), `sharesOutstanding` (the newest filing's cover page; a count off Twelve Data's by more than two times is a share class filed apart, Alphabet, and is not used).
- Worked out: `operatingMargin` (**now twelve months**; the header says TTM, the cell's hover says when it is still Twelve Data's quarter), `priceToSales`, `priceToBook`, `enterpriseValue`, `evToEbitda` (over Twelve Data's EBITDA), `netCashPct`. `stampCapDerived` runs after the stamp, so live P/E, earnings yield, EV/sales, P/op cash and net cash per share follow.
- **Not on it**: the Signal inputs (net income, free cash flow and its margin, gross and profit margin, ROE, revenue and earnings growth, market cap, forward P/E); EBITDA (ours, operating income plus depreciation, agreed with Twelve Data for 20% on the same quarter: impairments, EchoStar -$15.6B against $2.2B); trailing P/E (Twelve Data's own, at its pull price; Live P/E is the one on today's price and now follows our EPS); the free cash flow family (waits for the Signal, as two of its fields are inputs).

**Dependable, as built** (each traced on production data before it was set):
- **A quarter's two figures a tenth apart, or of opposite sign, are disputed**, and the twelve-month figure is worked both ways; the one nearer Twelve Data's wins. Martin Marietta Q1 2026 EPS: SEC $25.06, release $1.31 (the release). Varonis Q3 2025 EPS: the release read 0.26 for -0.26 (the SEC data). The first cut, twenty times off, let Martin Marietta through at nineteen.
- **A restatement wins**: an SEC figure from a filing more than 45 days after the quarter's release, not filled in from an older filing (DuPont's quarters recast in the 10-K after the Qnity spin-off; Becton Dickinson after Waters). Without it the release's pre-spin original was taking DuPont's revenue to $8.27B against $6.99B.
- **Confirmed** is the release and the SEC data agreeing (2%) on one of the two newest quarters, or a restatement there. An **unconfirmed** twelve-month figure more than half again, or under two thirds of, Twelve Data's is not used (CNA's revenue tag $1.5B against $15.2B; SBA Communications, Omega Healthcare and Valaris, whose 2026 revenue tags are a few million while their releases' revenue was not read). Confirmed, ours stands against Twelve Data (Marriott $26.9B against $7.4B, Corteva $17.8B against $5.0B: Twelve Data's are wrong).
- **A jump**: a revenue or gross profit quarter under a quarter of, or over four times, the company's other quarters and not agreed by the other source is not used (Omega's Q1 2026 $0.007B against about $0.3B).
- **Twenty times off Twelve Data is a unit**, never used even when both our sources agree (Berkshire's EPS is per A share in its filings and its release).
- **A release that printed only the year** (CleanSpark's and Versant's fourth quarter, two of 6,017) gives no quarter.
- **Twelve Data has a newer quarter** than both of ours: the company keeps Twelve Data's throughout.
- **No Twelve Data fallback on another definition**: the debt family (debt, net cash, debt to equity, enterprise value, EV/EBITDA, net cash %) is a dash where neither source gives the lines; the hover says why and gives Twelve Data's total with leases. 235 companies for debt, about 300 for the ratios.

**Measured on the first build** (1,153 companies, 3 seconds on the laptop, reads only), against Twelve Data where both are on the same quarter: revenue 91.5% within 2% (n 555), operating cash flow 98.5%, current ratio 99%, cash 89.6%, book value per share 88.5%, shares outstanding 93.3%, EPS 78.7% (GAAP with discontinued operations: Occidental after OxyChem, Arcosa after its sale), gross profit 75.6% (insurers and health insurers define it apart: CVS, Cigna). Debt 20% and operating margin 24% are definitions (leases; Twelve Data's quarter). Where we are newer: Microsoft, Alphabet and Amazon show the September quarter they reported this week where Twelve Data is on June.

**Built and kept current**: the whole universe on the daily filings pass (`marginChangeBuild`, which already holds every company's filings: no extra SEC read), and the companies whose release was filed in the last four days after every `release-load.js` run (`writeSourced`). By hand: `POST /api/sources/build` (admin or the cron secret; `?symbols=A,B`, `?dry=1`). Stored as the figure `sourced` ({ v, at, s: { SYM: { q, f: { field: [value, code] } } } }; codes s SEC, r the release for the newest quarter, m a disputed quarter from its release, o outvoted, n no figure on the definition). Held per instance ten minutes (one when empty). Stamped on copies of what `readSnapshot()` parses for each caller; on the shared 20-second cache the stamp keeps Twelve Data's figures in `srcTd` the first time and reads them from there after, so it is idempotent. `db.js` `readReleaseFiguresSince` reads the figures without the summaries.

**The hover**: `RowCard.srcNote(row, field)`, one implementation for every page; the screener's fourteen cells use it (`srcT` in `render`). The stock page's catalogue and the phone show the same values (same rows) without the note yet.

### Built: the Signal on the rule (2026-10-29)

The owner, after the display columns went live: "just rebuild signal, No need to re-run the measurement".

**The inputs on the rule** (`SourceRule.SIGNAL_SET`): `netIncomeTtm` (attributable, four quarters, the same guards as revenue), `fcfTtm` (operating cash flow less capex, the SEC data's quarters or the release's worked out from year-to-date statements; **no Twelve Data fallback**, its figure is levered: 243 companies blank, banks and insurers mostly, whose free cash flow rules then do not fire), `grossMargin`, `profitMargin`, `fcfMargin` (twelve months, each line over our revenue), `roe` (net income over twelve months against the average of equity now and a year earlier), `revenueGrowthYoY` and `earningsGrowthYoY` (the newest quarter on the same quarter a year earlier: the release's own two columns first, unless the SEC data has that quarter and disputes the release; then the SEC data's two quarters, only where that line's twelve months passed the checks; net income attributable, reported GAAP, so a swing to a loss reads as a fall: Pfizer, Flutter and Teva in Q2 2026; blank where the year-earlier figure is a loss or nothing, as everywhere on the site). `fcfYield` follows for display. **Kept Twelve Data's** (`SIGNAL_KEPT`): market value, forward P/E, short % of float.

**Dependable, added for these**: a margin or ROE more than 25 points from Twelve Data's is a definition or a tag, not a quarter's change, and keeps Twelve Data's (CVS's gross margin read 44% from a cost line that is not a health insurer's cost of revenue, against 14%; AES's ROE on a thin equity); growth beyond ±500% is a base too small to mean anything and keeps Twelve Data's (Americold, -22,375%).

**Where the verdict is scored**: `scoreActionInto` lays the rule over the rows (`stampSources`) and scores Quality again (`applyScores`, whose inputs include net income, profit margin, ROE and growth) before `Action.apply`. Every caller awaits `sourcedNow()` first: `computeStocks` (the stored verdict and everything a refresh records from it: advice_state, the refresh report), `/api/stocks`, the landing preview, the export, the phone, `/api/m/post`, `/backtest`, the alert pass. `computeStocks` then puts Twelve Data's own figures back (`SourceRule.restore`) and scores Quality on them before the snapshot is stored, so **the stored snapshot, `fundamentals_history`, `/recon` and `/sources` still hold and read Twelve Data's figures**; only the verdict stored beside them is the rule's. An as-of (rewound) table is not stamped.

**Measured on the first build** (same quarter as Twelve Data): net income 87.2% within 2%, profit margin 83.5% within a point, gross margin 78.7%, ROE 73.7%, revenue growth 83.5%, earnings growth 69.9% (GAAP against Twelve Data's other basis). Free cash flow 3% (levered against operating cash flow less capex: the definition, as expected).

**Proven** (`sourcerule-test.js`, real-shaped rows with all six words): the display-only fields lying move no verdict; the rule giving the same inputs gives the same verdicts; the rule's Signal inputs lying move them (every guard proven by reverting it). The screener harness: the verdict served equals the engine run on the row as served; Microsoft's moves (Strong to Neutral) with a loss from its release; the stored snapshot keeps Twelve Data's figures. `/api/stock` serves the stored verdict, which takes the rule at the next refresh after this deploy (the 04:00 nightly); `/api/stocks` re-scores on every load and has it at once.

### Free cash flow: fewer blanks (2026-10-29)

The owner: "do 1 and 3" (close the free cash flow gaps; the screener follow-ups). Of 152 companies outside banks and insurers with no free cash flow after the Signal moved onto the rule, the causes traced:
- **The newest quarter from a release with no cash flow statement** (Intel, Merck): the four quarters before were all filed, but the newest had none, so the twelve months went blank. `sourcerule.js` now gives operating and free cash flow the four filed quarters to the quarter before (`CF_FALLBACK`, `fourPrev`), stored with their own period end as a third element and stamped as `row.srcQs`; the FCF margin is over revenue for the same four quarters; the hover says why. Revenue and net income keep the newest four.
- **52/53-week calendars**: a sixteen-week quarter runs about 112 days, so `secfacts.js` read it as a half year (`periodType`, Q up to 110 days) and the fourth quarter was never derived (`deriveQuarters`, gap up to 110), and the rule's four-in-a-row test allowed 105. All three are now 120 days (a real half is about 182); `capreturns.js` and `td-release-map.js` follow. Costco, PepsiCo, Kroger, AutoZone.
- **Capex tags**: `PaymentsToAcquireOtherPropertyPlantAndEquipment` (Lilly), `PaymentsToAcquireOtherProductiveAssets` (Verizon, Twilio), `PaymentsForConstructionInProcess` (utilities), last in the list so a company filing the plain tag keeps it.
- **Exxon** (XOM): ExxonMobil Holdings Corp (CIK 2115436) became the registrant in a 2026 reorganisation and has filed only 8-Ks and proxy material; the 10-Q and 10-K history is Exxon Mobil Corp's (CIK 34088). `SEC_PREDECESSOR` in `server.js` reads the predecessor's facts too and merges them, the newest filing winning a period.
- **REITs** (about 40: Prologis, Welltower, Realty Income...) file development spending rather than capex; like banks they have no free cash flow on this definition, and stay blank.
- **Left** (backlog 55): companies that file capex only under their own company-specific tag (Valero, ConocoPhillips, AppLovin, Airbnb, Phillips 66) and print no cash flow statement in the release.

A third re-read of every company (`sec-reread.js`) loaded the new tags, quarters and Exxon's history.

## Sources as members see them (2026-10-30)

`/fields` gives every screener column a short Source line from `fieldsource.js`. The source-rule columns take theirs from `sourcerule.js` (FIELDS, NO_TD), so a change to the rule shows there without an edit; a change to any other column's source (a new provider, a column moving from Twelve Data to the filings) updates its entry in `fieldsource.js` in the same commit as /sources.
