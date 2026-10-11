# The Sector snapshot card (2026-10-11)

Template id `secsnap`, in the Sector group as "Snapshot". The owner, of the market Snapshot: "can you also create sector snapshot". Builder `tplSecSnap` in `private/cards.js`, a sibling of `tplDay` that reuses its layout classes (`dy-*`) so the two read as a pair. Controls `ssnName`, `ssnPeriod`, `ssnCount`, `ssnFloor`, `ssnSp500`.

**The three blocks, one level down from the market card**

- **Chips**: the sector's own Select Sector fund, the S&P 500, the gap between them in points, and how many of the sector's companies rose. A sector whose fund is not on the screen drops the fund and gap chips.
- **Industries**, where the market card has sectors: cap-weighted from the sector's own companies, one company one listing (`foldListings`), three companies or more. No fund divides a sector into industries, and the head says "cap-weighted". When there are more than the card holds (12, 6 on the square, 16 on the story) it shows the largest by market value and says "the 12 largest of 14".
- **Top and bottom movers** among the sector's companies, with the market card's count caps (10, 5, 15) and cap floor.

**Where it differs from the market card, on purpose**

- **The index cut narrows the whole card below the fund chip**, not the movers alone. On the market card the other blocks are index readings already; here the breadth, the industries and the movers are all made from the same companies, and cutting one block and not another would put two sets of companies on one card. The fund chip is never cut.
- **Percent only.** The market card's "value added" is today-only arithmetic and is not offered.
- One period for the whole card, from the market card's own list (`Cards.snapPeriods`); the studio copies the options from `daySnapPeriod`.
- A missing return is absent, never flat: it is out of the breadth count, the industry means and the movers.

`tplDay` was not refactored to share code with this. It is long, measured against the real artboards, and could not be re-rendered by the build; a sibling was the lower risk. If the two drift, the market card is the reference.

Tests were a scratchpad Node suite on fixtures (28 checks). Not rendered in a browser by the build.
