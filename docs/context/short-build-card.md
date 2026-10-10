## The Short build card — the position before and after (2026-10-10, owner's request)

**A promo template, `shortbuild`, in Rankings after Short moves.** Asked as *"create a card for Short build, it has to be specific because need to show the short position before and after within the 2 weeks, use a good visual"*. Where the shorts moved ranks the CHANGE and draws one bar for it, so a reader cannot tell a position that went from 1% of the float to 2% from one that went from 20% to 40%. This card draws the two positions themselves.

### One bar, two parts, both from zero
Each row is one company: its name, the change in shares short after it, a bar, and the two readings (`8.2% → 10.4%`, before then after).

- **A build**: grey to where the position WAS, then blue for what was added.
- **A cover**: grey to where it IS now, then orange for what was bought back.
- **The grey is always the position held on both dates**, so the two parts end exactly at the larger of the two readings and neither can overstate (a check sums them).
- A key under the title names the two parts and the scale (`0 to 33% of the float`), which is the largest position drawn.
- **Blue and orange, never green and red** — the Short moves card's rule and its reason: a build is a bet against and also the fuel for a squeeze.

### As a share of the float
The only axis two companies can share: a share count favours whoever has more shares and a dollar figure whoever is bigger. It is the unit of the screener's Short % Float column.

- The share COUNTS are FINRA's, as settled on each date. **The float is today's, for both ends**, so the bar moves only because the position did.
- A company with no float on file cannot be placed and is counted in the note.
- **A reading past 100% of the float is left out**, the dual-class artefact the column already withholds (short interest is reported per issuer, the float per class).
- The percentage after the name is the change in the share count, the Short build column's own number.

### Which companies
- Builds or covers (`sbaDir`), top 5 / 8 / 12 (`sbaCount`; caps 12 / 8 / 12 per artboard).
- **Two orderings (`sbaRank`) that give different companies**: by how much the position changed (the default, and the column), or by points of the float. A position that doubled from 1% is not the one that added five points.
- The floor is on the POSITION in dollars (`sbaFloor`, the Short moves card's list, default $250M), taken at the larger of the two dates so a position that was covered down through the floor is still a cover.
- Funds are never rows. The Index cut is the usual six.

### Wiring
- **It reads the Short moves card's own data**: `shortMovesNeed(tpl)` answers for both, so the studio's fetch and the phone route needed no change. One window for everybody, splits skipped, as recorded for that card.
- Rows reuse the Bars card's `bx-*` grid and the Industries card's name-and-figure pair, so the name clips and the change stays. `SBA_RANKS` is exported as `Cards.shortBuildRanks()` for the picker.
- Controls `sbaDir`, `sbaRank`, `sbaCount`, `sbaFloor`, `sbaSp500` (204 of `POST_OPT_MAX` 300).
- Verified: 29 checks in Node (`sb-test.js` in the session scratchpad): both orderings, the bar's two parts against hand arithmetic for a build and a cover, the floor, no float, past 100%, the fund, the index cut, the empty states, the three artboards. The Short moves card is byte-identical before and after.

**NOT YET SEEN ON ANY ARTBOARD.** The row grid is Bars', which was measured, but this card adds a key line under the title and its row caps (12 / 8 / 12) are a guess one step under Bars' (15 / 10 / 15), not a measurement. Look at twelve rows on the portrait and eight on the square first.
