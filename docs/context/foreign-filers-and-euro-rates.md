## Foreign filers, and euros in dollars (2026-10-10, owner's request)

**Asked as *"does Spotify not have SEC EDGAR data"*, then *"bring the data and show it on the individual stock page, also currency should be converted using the historical conversion rate … only bring from Euro at the moment"*.** Spotify does file, and EDGAR holds 231 tagged concepts for it. The reader could not see them: 69 of the universe read `empty` for this reason or one like it.

### Why they read empty
A foreign private issuer files a 20-F under INTERNATIONAL accounting standards, so its facts sit under `ifrs-full` in companyfacts rather than `us-gaap`, with different names for the same lines. `secfacts.js` read `us-gaap` and nothing else.

- **`IFRS_CONCEPTS`** maps the same fourteen concepts to their IFRS tags, read off Spotify's own file rather than the taxonomy index (`EquityAttributableToOwnersOfParent`, since `Equity` is not filed there; `AdjustedWeightedAverageShares` is the diluted count).
- **`taxonomyOf(facts)`** is US GAAP where that carries revenue, net income or assets, otherwise IFRS where it exists. **US GAAP filers are read exactly as before**: Apple, Microsoft and Tesla give byte-identical rows against the previous reader (980 rows).
- **`currencyOf(facts)`** is an IFRS filer's reporting currency, read off the unit most of its revenue, profit and assets are stated in. Null for a US GAAP filer.
- An IFRS filer is read in ITS reporting currency and nothing else (`unit === cur`, `cur/shares`, `shares`): a second currency in the same file is a note about a subsidiary, not the statement.
- **Mostly annual.** A 20-F is a year, and the interim results go out in a 6-K with no tagged facts. Some IFRS filers do carry quarters; Spotify does not. Anything built on four consecutive quarters (the trailing-twelve-month series, quarterly earnings growth) has nothing for an annual-only filer. The stock page already falls back to its Annual view.

### What the first run recovered
`fx-load.js`, dry run, 2026-10-10, over the 69: **41 recovered** — 28 IFRS filers that report in dollars and needed no rate at all (AZN, BP, SHEL, TTE, BHP, RIO, NVS, UBS, HSBC, INFY …), and **13 that report in euros** (SPOT, SAP, NOK, STLA, UL, VOD, CCEP, BBVA, SAN, FER, ASND, BIRK, SGHC). **23 report in a currency not converted yet** and are recorded as status `currency` with the reason ("reports in CAD"): CAD 8, GBP 4, BRL 3, TWD 3, and one each of CHF, CNY, DKK, INR, JPY. **5 are still empty** under US GAAP for their own reasons (AUGO, JMKE, MDA, SKHY, VYLR).

- Banks recover with no revenue line (BBVA, SAN, HSBC, UBS): a bank does not file `Revenue`. Novartis also shows none, so its revenue is under a tag not mapped yet.

### Euros, in dollars
**Converted WHEN THE FILING IS READ, at the rate of the period it describes, and the rate is kept on the row** (`sec_facts.currency`, `fx_avg`, `fx_end`). So every page that reads these rows gets dollars with no change of its own, and the figure as filed is still there: divide by the rate beside it.

- **A flow takes the period's AVERAGE rate** (revenue, costs, profit, cash flow, earnings per share). **A position takes the rate on the balance-sheet date** (assets, liabilities, equity, cash, debt), or the last working day before it. A share count is not money. This is the accountants' own convention; one "today's rate" would restate the past every time the euro moved.
- **A row whose period the rates do not cover is DROPPED**, not converted at the nearest rate. A position with no rate within seven days of its date is left blank on a row that otherwise stands.
- **Conversion happens before anything is derived**, so a gross profit is never a dollar revenue less a euro cost.
- **What it does to growth**: euro revenue up 10% in a year the euro rose 4% shows about 14% here. True of the dollar figure, and not the company's own growth. Margins, a ratio inside one period, are untouched (Spotify 2025: 12.87% either way). The stock page says so.
- Checked on Spotify 2025: €17,186M at the year's average 1.1300 is $19.42B, and divides back to 17,186.

### The rates
**The European Central Bank's daily euro reference rates**: one rate per working day back to 1999-01-04, free, no key. `eurofxref-hist.xml` is all of it (8MB, 7,111 days); `eurofxref-hist-90d.xml` is the last ninety days. A rate is DOLLARS PER ONE EURO.

- **`fx.js`** (pure): `parseEcb(xml)` and `book(rows)` → `{ at(d), avg(start, end), first, last, n }`. Its yearly averages match the ECB's published ones (2019 1.1195, 2021 1.1827, 2023 1.0813, 2024 1.0824).
- **`fx_rates (ccy, d, usd)`**, about 7,100 rows for the euro. `writeFxRates` is an UPSERT, never a replace: a top-up carries ninety days and must not cost the table the years before them.
- **`eurFx()` in server.js tops the table up by itself** when the newest stored rate is more than five days old, from the ninety-day file. It is asked for only when a euro filing is being read, never on a page view. A failed top-up is not a failed read.
- **`fx-load.js`** is the first fill and the re-read of the empty filers, sequential and paced, dry run by default. **Running it at all applies the schema** (`db.js` `init()` creates `fx_rates` and adds the three columns), dry run included.
- **Only the euro.** The ECB file carries about thirty currencies against the euro, so another reporting currency is a cross rate away. Nothing computes one yet; the 23 above are waiting on it.

### On the stock page
The SEC EDGAR card and the Financial statements card each carry one sentence, from one function (`fxNote`), where a row was converted: which currency, the two kinds of rate, and that growth includes the currency's move. Hovering a period shows its two rates. Nothing else on the page changed: the figures arrive as dollars.

**Display only, as before.** Nothing here reaches the Signal or the screener row.

### The Filer column (2026-10-10, owner: "add a column saying these are foreign listings … so it's easy to identify and filter")
**A screener column, `filer`, in the Info group after Instrument.** Values: `Foreign · EUR` (and `· USD`, `· CAD` …) for a foreign filer with its reporting currency, `US GAAP` for nearly everyone else, blank where no statements are on file (a fund). On the live universe: 1,180 US GAAP, 64 Foreign (28 USD, 13 EUR, 8 CAD, 4 GBP, 3 TWD, 3 BRL, and one each of CHF, CNY, DKK, INR, JPY), 36 blank.

- **Not called "foreign listing", because every stock here is US-listed.** What separates Spotify from Netflix is the FILER: only a foreign private issuer may file with the SEC under international standards, so IFRS facts mean a foreign company by the SEC's own rule, not by a guess from a name or an instrument type (Spotify is ordinary shares, not a depositary receipt).
- **`US GAAP` is not "American".** A foreign company may choose US GAAP and some do, so the label says how it files and stops there. The tooltip says so.
- **Stored on `sec_state`** as `taxonomy` and `currency`, written by every outcome that learned them (`writeSecFacts` meta, `noteSecMiss`'s fifth argument). **Both `insert or replace` statements name and COALESCE the two columns**: that statement rewrites the whole row, so a column it does not name comes back NULL, which is how the CIK and both dates were each lost once.
- A company with rows and no taxonomy recorded was read before the column existed, when US GAAP was the only taxonomy the reader knew; `filerLabel` reads it as `US GAAP`. It fills in properly as the rotation re-reads each company.
- **It reaches a row through `stampFlows`**: `buildFlows` reads `sec_state` once and stores `filer` by symbol in the same `app_meta` value as the short and insider readings. `FLOWS_V` was bumped to 2 so the stored value is rebuilt on the first read after deploy rather than six hours later.
- **Filterable**: `filer` is in `CAT_KEYS`, so the filter row offers its values as a list with counts. It is also a `FIELD_SPEC` row (`info|Filer`).
- Layout constants after it: `PAD_SPAN` 108, error row 103, empty row 105; Info banner 12.
- **The 64 were filled before the deploy** by `fx-load.js --only …`, so the first rebuilt value already had them. The loader passes taxonomy and currency on both of its writes.
- Display only: not read by the Signal.

### Every reporting currency, not only the euro (2026-10-10, the owner, an hour later: "we should convert the other currencies too")
**The 23 companies that reported in another currency are converted the same way**: flows at the period's average, positions at the rate on its last day, the rate kept on the row.

- **A cross rate from the same ECB file.** It quotes about thirty currencies as units per one euro, so dollars per one unit of any of them is `(dollars per euro) / (units per euro)`, both legs the ECB's own reference rate for that day. `Fx.parseEcbAll(xml, [ccys])` reads the file once into `{ CCY: [{ d, usd }] }`; its EUR output is identical to the euro-only parser's.
- **The currencies converted are an explicit list** (`ECB_CCYS`, 27 of them), not "whatever the file has": it still lists currencies that no longer exist. A reporting currency not on the list stays status `currency`.
- **Coverage starts later for some**: the yuan from 2005-04, the real from 2008-01, the rupee from 2009-01. A period before a currency's first rate is dropped, as any uncovered period is.
- **THE TAIWAN DOLLAR IS NOT IN THE ECB FILE**, and three filers report in it, TSMC among them. It comes from Twelve Data's daily `USD/TWD` series instead (`TD_CCYS`, `Fx.parseTd`): 5,000 sessions back to 2008-03-19, one credit, a market close rather than a central bank's reference rate. `Fx.sourceOf(ccy)` says which, the stock page's note says "daily market rates" for it, and the stored rows are the same shape either way. *The Federal Reserve's own series was the first choice and was not reachable from here.*
- **`fxFor(ccy)` in server.js** replaced `eurFx()` (kept as a one-line alias): one book per currency, memory-cached six hours, topped up from that currency's source when its newest rate is over five days old.
- The tooltip on a period prints rates to four SIGNIFICANT figures, not four decimals: a yen is 0.0067 dollars.
- **Recovered on the first run**: CAD 8 (BMO, BNS, RY, TD, CCJ, GFL, ALM, DPRO), GBP 4 (BTI, HLN, LYG, EVTL), BRL 3 (ABEV, SBS, XP), TWD 3 (TSM, ASX, UMC), and NVO, ONON, TME, WIT, SMFG. Checked against what is known: TSMC 2024 $90.16B, Novo Nordisk 2025 $46.79B, BAT 2025 $33.76B. Five companies remain empty under US GAAP for their own reasons.
- The Canadian banks carry quarters as well as years (66 quarterly rows each): they file quarterly reports with tagged facts, so the trailing-twelve-month cards work for them where they do not for Spotify.
