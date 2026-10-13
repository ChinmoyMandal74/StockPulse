# Coverage: what the site tracks, as cards (2026-10-13)

The owner asked whether any promo visualisation talks about the coverage of the universe, "number of companies by size for example". None did. Then: "Create a new group called Coverage, no need to hide it from users, it's more transparency".

## What it is

A seventh entry in the studio's Template list, **Coverage**, with three views from one builder, `coverageCard(tpl)` in `cards.js`:

- `covsize`, "By size": a row a size band in the ladder's order, with what the band means.
- `covsector`, "By sector": a row a sector, most companies first, with how many industries it holds.
- `covindex`, "By index": in the S&P 500, in the Nasdaq 100, in both, in neither, and membership not known.

Each row: a bar scaled to the largest count, the count, its share of the companies, and their combined market value. Four figures above: companies, funds, combined value, sectors and industries. No controls, so no control box.

## Rules that must hold

- **Computed from the rows when the card is drawn.** The universe is hand-edited and every count written down anywhere is a snapshot; nothing here is a stored number.
- **It makes no claim to be complete.** The note says these are counts of what is covered, not a claim to cover everything, and that the list is chosen by hand and changes. No "all of" anything, and no denominator for an index: "499 in the S&P 500" is what is on the screen, not "499 of 503".
- **Funds are counted apart** (`isFundRow`): no band, no sector, and no membership of an index they track.
- **A company with nothing on file for the cut has its own row** (no market value, no sector, membership not known), with a muted bar. It is neither put in a band nor dropped from the count.
- **Index membership is three-state.** Unknown is not "in neither". The first two index rows overlap, and the note says the rows do not add up.
- **Visible to members.** It is its own group, deliberately not in Brand, which member mode hides.

## The universe on the day

1,256 companies and 24 funds, $92.41T combined, 11 sectors and 138 industries. By size: Mega 74, Large 215, Mid-Large 509, Mid 390, Small 55, Micro 12, one with no market value. S&P 500 members 499, Nasdaq 100 members 99, in both 84, in neither 742.

Tests: a scratchpad suite, 24 checks, including all three cards built from the real screen. Not rendered in a browser by the build.
