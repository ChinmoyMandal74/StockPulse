## Growth & profit and Value vs industry (2026-11-02, owner's request)

The owner: *"a classification column ... 1) Growing and Profitable 2) Growing not profitable 3) Stagnant but Profitable 4) Stagnant and less profitable 5) Stagnant and not profitable 6) Declining and not profitable ... it will be good this can also be combined with valuation within respective PE group or may be that can be a separate column"*. Built as two columns, after a proposal the owner accepted ("go ahead").

### Growth & profit (`growthProfile`, Profitability group, first column)

Two axes of three, so every company is in exactly one cell. The owner's list had no "shrinking but still profitable" (the mature company) and no separate "growing, loss-making" (the young one); the grid has both.

| | Profitable | Thin margin | Loss-making |
|---|---|---|---|
| **Growing** (revenue +5% or more) | Growing, profitable | Growing, thin margin | Growing, loss-making |
| **Flat** (within 5%) | Flat, profitable | Flat, thin margin | Flat, loss-making |
| **Shrinking** (−5% or less) | Shrinking, profitable | Shrinking, thin margin | Shrinking, loss-making |

- **"Flat" and "Shrinking", not "Stagnant" and "Declining"**: the words describe the figures, not the company (no rankings rule).
- **Growth**: the filings' newest quarters (up to four) summed against the same quarters a year before, the Compounding now sum `crNowRevG`, where it is read; else `revenueGrowthYoY` (the newest quarter against its year-ago quarter, by the source rule). Measured: 460 of the 581 Growing, profitable rows read on the filings sum. ±5% because inflation alone is about 3%, and a band this wide keeps a word from changing every quarter.
- **Profit**: `profitMargin` (twelve months) and `fcfMargin`. Profitable is 5% or more with free cash flow not negative; Loss-making is a net margin below zero; Thin margin is between, or a paper profit while burning cash. No free cash flow figure: the net margin alone. **Financial Services** reads the net margin alone (free cash flow means nothing for a bank). **Real Estate** reads the free cash flow margin where there is one (a REIT's net income is depreciation-heavy).
- **Pre-revenue**: under $50M of revenue over twelve months, dollar reporters only (a yen figure under 50M is not small). A company's revenue of 0 is real (Viking, Revolution Medicines) and is Pre-revenue.
- **Funds are blank**: every fund's profile carries `revenueTtm: 0`, and all 24 read Pre-revenue before the explicit fund check. The in-memory page check caught it.
- Either axis unknown is a blank, never a guess (null is not zero).

### Value vs industry (`valueVsIndustry`, Valuation group, after P/E vs peers)

P/E vs peers (`peerPe`) in words: **Below industry** under 0.8×, **In line** 0.8× to 1.25×, **Above industry** over 1.25×. Where there is no `peerPe` (a loss-maker, no forward estimate, or a group under five with a P/E), **price-to-sales against the industry median** (`peerPs`, new, stamped in `stampPeerValue` with the same median and five-name floor) stands in, **dollar reporters only** on both sides: a market value in dollars over revenue in another currency is not a multiple. Measured: 78 rows read on P/S. "Below", never "cheap" or "undervalued".

### Where it lives

- `private/filters.js`: `growthProfileRead`/`growthProfileOf`, `valueVsIndustryRead`/`valueVsIndustryOf`, `GP_ORDER`, `PV_ORDER`; both keys are `CAT_KEYS` (dropdowns with counts, in the ladder's order).
- `server.js`: `growthProfile` is stamped in `stampCapDerived` right after `stampSources` (so it reads the source rule's margins and growth); `peerPs`, `peerPsMedian` and `valueVsIndustry` in `stampPeerValue`. Read-path stamps only: **nothing is stored**, so nothing joins `/privacy`.
- `private/index.html`: `growthProfileCell`, `valueVsIndustryCell`; the tooltip names the figures and the basis (filings sum or quarter; net, net only, or cash; P/E or P/S). Sort follows the ladder. Uncoloured.
- `private/rowcard.js`: one `FIELD_SPEC` row each (`profit|Growth & profit`, `value|Value vs industry`), so the stock page, tiles, phone and `/compare` carry them.
- Starter screens `grwprof0` "Growing and profitable" (no price cut, the gap `cheapgrw` and `peerval1` leave) and `grwprof1` "Growing, profitable, below its industry". Sorted by market cap: a list, not a ranking.
- `fieldsource.js` and `td-release-map.js` (`/fields`, `/sources`) say where each comes from; `/help` describes both.
- **Not the Signal.** Neither field is read by `action.js`; `growthprofile-test.js` scores three rows with the words absent, present and lying both ways and requires identical verdicts.

### Constants after the change

The Valuation banner **12**, Profitability **8**, `PAD_SPAN` **176**, the error row **151**, the empty row **153**, the profitability fund run `naRun(8)`.

### Measured at launch (production's data in memory, 1,282 rows)

Growing, profitable 581 · Flat, profitable 185 · Growing, thin margin 160 · Growing, loss-making 115 · Flat, thin margin 73 · Pre-revenue 35 · Shrinking, loss-making 33 · Flat, loss-making 32 · Shrinking, profitable 31 · Shrinking, thin margin 12 · blank 25 (24 funds). Value vs industry: Below 270 · In line 508 · Above 322 · blank 182. Growing, profitable and Below industry together: 102.

The thresholds are the proposal's starting points; the owner may move them once the counts are seen.

### Verified

`growthprofile-test.js`, **65 checks**: every cell, both sides of every threshold, blanks, funds, Pre-revenue and its currency rule, the sector rules, the growth basis, P/E before P/S, filters (a comma inside the word is one value), and the Signal boundary. **Proved by reverting twelve guards**, each failing at least one check. A drawn-page check over production's data in an in-memory server (30 checks: header over cell for both columns and their neighbours, banners, the three static spans against the drawn header count, a fund row the same width, the dropdown order, the two filters together, the starter screen matching the payload, nothing written to the stored snapshot), **proved by six page reverts** (body cell left out fails 6, the fund run, the spans, the banner and the dropdown order 1 or 2 each).
