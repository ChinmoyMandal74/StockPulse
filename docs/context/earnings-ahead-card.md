# The Earnings ahead card (2026-10-10)

Template id `earnahead`, in the studio's Market group. Owner's request: there was no promo card for upcoming earnings. Builder `tplEarnAhead` in `private/cards.js`; controls `eaWin`, `eaCount`, `eaEst`, `eaSp500`.

**What it draws**: the largest companies in a cut that report inside a window, under a heading for the day each one reports. Columns: company and ticker, market value (bar and figure), and the previous quarter's earnings per share against the consensus (`lastSurprise`).

**Rules**

- **The largest N are chosen first, then laid out by day.** Each day's heading says "3 of 7 reporting" when it shows fewer than are due; a day with only smaller companies is counted in the note.
- **The window runs from the data's day (`marketDay`), strictly after it**, never the reader's clock. `eaWindow`: "the coming week" is the rest of the week from Monday to Thursday, and the following Monday to Friday from a Friday or a weekend. The title prints the dates, never "this week" or "next week".
- **Confirmed dates only by default.** `nextEarningsEstimated` rows (last report plus 91 days) are left out and counted in the note; "Include estimated dates" shows them marked `est.`.
- **No green or red.** The bar is a size and the surprise is not a price, so neither takes a direction colour.
- **No Signal on this card**, and nothing here feeds the engine. The note ends "A calendar, not a forecast."
- A missing market value is a dash with no bar and sorts last; a missing surprise is a dash.
- Size caps: portrait 12, square 8, story 14 rows.

**Not on the row, so not on the card**: whether a company reports before the open or after the close. The provider returns it (`time` in `earningsRows`) but it is not stamped onto the snapshot row.

**Tests** were a scratchpad Node suite on fixtures (49 checks). The card was not rendered in a browser by the build.
