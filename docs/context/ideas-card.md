## Ideas: the Brand card for the Ideas page (2026-11-03)
The owner: "create promo slide under brand template called Ideas. Keep it a one slide with enough info on these ideas".

**Template `ideas`: Brand › Ideas, straight after How it's built.**
- `tplIdeas` in `cards.js`, with the `.id-*` styles after the architecture card's.
- `promo.html` registers it in `TPLS` and `BRAND_VIEWS`. It has no controls and is not owner-only, like How it's built.

**What is on it:** the kicker "Tickr Lab · Ideas", the headline "Ideas / four ways to look at the market", four numbered boxes (one per view, each with a one-line description and three rules), a row of the readings every name carries, and the closing line "Live on the Ideas page, and in one Excel download. What happened, not what happens next."
1. **AI watchlist:** AI-linked companies, each once, largest first, in the eight groups.
2. **Strong results, fell anyway** (technology and communication): revenue up 10% or more, a net profit and guidance, shares down 7% or more on the reaction day.
3. **Growing, profitable, fell after results** (every other sector): the same results test; growing, profitable, valued at or below its industry; down 5% or more.
4. **Bouncing off the lows:** the bottom 30% of the 52-week range, up more than 3% over a month, and up over two weeks.

**Readings:** market cap, Today, from 52-week high, RSI, P/E and forward P/E, value vs industry, revenue growth, profit margin, growth & profit, and the Signal with the rule that fired.

**It restates the page's rules.** If `MIN_GROWTH` or `DROP` in `selloff.js`, the `bouncelw` screen, the AI groups or the page's columns change, this card changes in the same commit.

**Rules it keeps:**
- Evergreen: `chromeTop(false)`, no date, no count, reads no data.
- No buy, sell, hold, recommendation, opportunity, winner or target wording.
- No green or red (it makes no up/down reading); every colour is a token or a `color-mix()` of one.

**Link guard.** The stock-name linker skips `.id-map` and `.id-rd`: group and reading names (Power, Compute, RSI) are not companies. Proved with a made-up stock called RSI: with the guard removed, the RSI reading became a link (1 failure).

**Shapes:**
- **Post 4:5 and square:** the four boxes in a 2×2 grid that stretches to fill the height. The square has its own type sizes.
- **Story:** the boxes stack in one column.

**Tested** with scratchpad `id-test.js` (built from `ar-test.js` by `make-id-test.js`): 85 checks in the real studio across three shapes and three grounds.
- **Content:** four views, twelve rules, ten readings; the rules' figures on the card; no banned words; no links.
- **Layout:** no box or reading clipped, overlapping or off the card; title, views, readings, line and foot stacked inside the artboard.
- **Style:** no green or red; smallest text at least 13px; no page errors.
