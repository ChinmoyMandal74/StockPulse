## Table specifics
- **Frozen columns are Symbol and Name only** (`.frz0`, `.frz1`). The classes are *positional*: `updateStickyOffsets()` measures header cell widths left-to-right to compute the cumulative `left` offsets, so reordering columns means re-dealing the `frz` numbers in DOM order, not just moving the markup. `.frz1` carries the boundary shadow.
- Two sticky header rows; `--h1` is measured at runtime because the second row's top offset depends on the first row's wrapped height.
- **Overall is centred (`ta-c`) and Mom. is left-aligned (`ta-l`);** everything else stays right-aligned. Those are alignment-only classes on purpose — `.left` also switches the cell to the sans face, and a rating is a number that belongs in the mono one. The sorted-column marker is `left: 50%`, so it is unaffected by either.
- The sorted column is marked by a small accent arrow absolutely positioned in the header's bottom padding — it's positioned, not inline, so it can't reflow a wrapped label.
- Score cells (`td.rating`) open the factor-breakdown tooltip (`#tip`, fixed-position glass card) on hover.

### The score tooltip
**`RowCard.scoreTip(stock, kind, opts)` builds it and `RowCard.placeTip()` positions it**; `#tip`'s styles live in `app.css`. Both were inline in `index.html` until the stock page needed to explain the same three numbers — a second copy of "why is this an 8" is exactly what `rowcard.js` exists to prevent. Only the markup is shared: each page keeps its own hover wiring, because one hovers table cells and the other a chip and a card row.

- `kind` is `quality` — the only composite left. The parameter stays because the shape is right and a second score may come back; `overall`, `momentum` and `rank` went with the removal. It returns **`null` when there is nothing to explain**, so a caller can skip showing rather than flash an empty card.
- **`rank` is not a factor breakdown** — a rank is a position in a sorted list, so the card explains the number it sorts on: the Overall score, its 65/35 split, and that the ordering runs across every stock in the screener.
- **`buildSections(s, { tips: true })`** marks the Overall/Mom./Qual. rows with `data-tip`. Off by default: inside the hover card those rows are already in a tooltip, and a tooltip on a tooltip helps nobody. Only `/stock/<SYMBOL>` passes it, where there is no table to hover and the scores would otherwise be four bare numbers.

