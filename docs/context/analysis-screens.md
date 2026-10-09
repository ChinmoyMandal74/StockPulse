## Analysis screens (retired — kept for the thresholds' history)
**The seven predicates live in `private/screens.js`, not in the page.** `analysis.html` loads it with a `<script>` tag and `server.js` `require`s it, so the nightly report and the page can never disagree about what "bouncing off the lows" means — the same reason `rowcard.js` exists. Only the *selection* is shared (which rows, in what order); the columns, the prose and the empty messages stay with whichever surface is drawing them. Verified equivalent against the live universe on extraction: all seven lists identical, order included.

`/analysis` is seven filtered views built from the **raw fields, not the composite scores** — the scores already drive the table's ranking, and a screen that just re-sorts them adds nothing. Every threshold below was set by running the candidate against the live universe: a screen returning 0 names is a dead box, and one returning 25 of 69 is not a signal. **The hit counts in the table were measured at 69 symbols and the universe is now 116 — expect every one of them to be larger, and the 33 `Faded` names to crowd the bounce and value screens in particular.** Re-tune the thresholds against a fresh snapshot before reading anything into them.

| screen | rule | hits when set |
|---|---|---|
| Bouncing off the lows | `range52Pos ≤ 30` (or `pctFromHigh ≤ −25`), `1M > 3%`, `2W > 0` | 5 |
| Just started moving | `2W > 5%` while `3M < 0` | 2 |
| Drifting after a beat | surprise 10–100%, reported ≤ 21d | 2 |
| Reporting in 14 days | unchanged | 4 |
| Cheap, growing, profitable | fwd P/E < 20, rev > 15%, margin > 15% | 13 |
| Business improving, price isn't | rev > 25%, `3M < −10%` | 13 |
| Overextended | RSI > 75 and > 12% above the 50-day | 2 |

- **`range52Pos`** (0 = on the 52-week low, 100 = on the high) and **`pctFromLow`** are derived in `computeStocks()` from bars already fetched, so they cost no credits. Snapshots written before they existed fall back to `pctFromHigh ≤ −25`, and the section prints a note saying so. **The `≤ 30` threshold is unverified against real range data** — it was tuned on the fallback — so expect to adjust that one number after the first refresh.
- **Earnings surprises above 100% are excluded** as feed artefacts. Two different mega-caps currently report *exactly* +214%, which is a data bug rather than a coincidence; without the cap they would top the drift screen.
- **`netCash` is meaningless for financials** — if a balance-sheet screen is ever added, exclude the Financial Services sector, or JPM and HOOD will lead it.
- The analyst fields and the forward estimates were **0/69** on this plan, so nothing could be built on them; the analyst half was deleted outright on 2026-09-23 (below).
- Two removed screens ("Good business, price not working" / "Price working, business not") keyed off the Quality and price-strength ratings; "Business improving, price isn't" is the same idea on raw revenue growth. "Deepest drawdowns" went too — it is the bounce screen's population without the part that matters, whether the thing has turned.

