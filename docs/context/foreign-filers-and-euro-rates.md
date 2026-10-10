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
