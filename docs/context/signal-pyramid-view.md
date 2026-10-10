# The Signal card's pyramid view (2026-10-10)

A fifth view of the Signal card (`advboard`): `advMode = 'pyramid'`, "The shape of the signals". Owner's idea ("a funnel or pyramid chart"), built inside `tplAdvBoard` in `private/cards.js`; styles are the `.apy-*` classes. No new control: it uses the card's own scope and index pickers.

**What it draws**: six bands, best signal at the top. Left of a centre line is the share of companies at each signal (count and percent); right is the share of their combined market value. Above each band, the signal word and the largest companies at it (three; two on the square).

**Rules**

- **A pyramid, not a funnel.** A funnel draws stages things pass through; every company has exactly one signal.
- **The widths are the real shares, on one scale for both sides.** Nothing forces a triangle. If Neutral is widest the shape is a diamond.
- **Companies only.** Funds and the index and sector ETFs are left out of both sides, so this view's count can be lower than the board's for the same cut.
- **Null is not zero.** A company with no market value counts on the left and adds nothing on the right. With no values at all the right side is dashes and the note drops the value sentence. A nonzero share under half a percent prints `<1%` and still draws a sliver.
- Market value is display only here; nothing feeds the engine.

**Two fixes made alongside**

- The board's note still said "clear the buy rules tonight" after the rename. It now says "read Strong or better tonight".
- `advScored` and `advScoredPrev` cached their results for the life of the module, so a card built after the studio re-pulled data (or on a server instance that outlived a refresh) drew the first rows' signals. `advFresh()` now clears both caches whenever `stocks` is a different array.

**Not built**: an outline of an earlier shape. `prevTech` gives one session back only, which is too small a change to draw; a week-ago outline would need stored history.

**Tests** were scratchpad Node suites on fixtures. The view was not rendered in a browser by the build.
