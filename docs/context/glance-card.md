# The At a glance card (2026-10-21)

The owner: "Do we have a promo card for at a glance section on a individual stock", then "build it your way".

- **Template `glance`**, in the Stock spotlight group of the studio (`SPOT_VIEWS`, after Month by month). One company's At a glance cards, the ones at the top of `/stock/<SYM>`, as a post.
- **One wording.** The cards come from `private/glance.js` (`Glance.build(row, rows)`), run by each host over its own rows through the `getGlance(sym)` channel: the studio over the rows it holds (it now loads `/glance.js`), the server's `/api/m/post` over the stamped snapshot. The card never words a topic itself.
- **Topics.** Eleven ticks in the box (`glcPick`, `|`-joined, kept by a saved post). The default is six: Long-term price, Growth, Profitability, Valuation, Balance sheet, Earnings. They are drawn in the page's order, as many as the shape holds: square 6, portrait 8, story 10 (`GLC_MAX`). The count under the ticks says when some ticked ones do not fit the shape.
- **Layout.** Two across. Rows size to their content and share out the spare height (equal rows clipped the wordiest stock, Gartner, on a story with ten topics). An odd last tile runs the full width. The type steps down with the number of topics and the longest wording.
- **Descriptive, as on the page.** Green and red arrows only on the two price topics; amber only for a stale short report. The Signal word is canonicalised (`ActionRules.canon`), coloured from the card's tints, and keeps the rule that fired. The note says an arrow is where the stock sits against the group its line names, not a rating.
- Tests (scratchpad, not in the repo): the studio over the live snapshot at every shape with the wordiest stock's longest topics (nothing clipped, note inside the card), ticks, default, Signal word, the Node host drawing the same tiles; and a saved post through `/api/m/post` on uni-boot. Removing the server's `getGlance` fails the second.
