## Too much to read: the cartoon card (2026-10-28)
The owner showed a cartoon from another app's advertisement: a whirlwind of charts and jargon over someone at a laptop with their head in their hands, under "Tired of researching stocks on your own?". The ask: "I like this visual … it's kind of funny, can you add something like this under promo".

**Template `overload`: Brand › Too much to read, straight after Showcase.**
- `tplOverload` in `cards.js`. The `.ov-*` styles sit beside the Disclaimer's.
- `promo.html` registers it in `TPLS` and `BRAND_VIEWS`. It has no controls.

**What is on it:**
- The kicker "Tickr Lab · sound familiar?" and the headline "Reading it all / on your own?".
- The drawing: an inline SVG of a whirlwind narrowing onto the reader's head. Around it fly:
  - six chart tiles (rising, falling, level);
  - five filings, three labelled 10-Q, 8-K and 13F;
  - eleven jargon bubbles: P/E, RSI, MACD, ETF, BETA, FUD, FOMO, YIELD, EPS, GUIDANCE, IPO;
  - three sticky notes (?!, ??, !?), two EARNINGS calendar pages, four alert bells and four zigzag price arrows.
- The reader at a desk, head in hands, eyes shut, with a laptop.
- One line under the drawing: "Every stock, measured the same way after every close. Prices, filings, holders and headlines, side by side on one screen."

**Rules it keeps:**
- **No buy, sell, hold, HODL, bull or bear on it.** The advertisement's bubbles had them; this site never prints them. The test refuses them in the whole card's text.
- **Green and red only on the price marks:** the chart lines and fills, and the arrows. Bubbles, notes and the figure use accent and neutral tints. The calendar band is accent, not red. Every colour is a token or a `color-mix()` of one, so all grounds follow with no override block.
- **Evergreen, like the other Brand cards:** `chromeTop(false)`, no date and no count. It reads no data.
- **Seeded pen wobble.** Every line passes through a jitter from a fixed seed, so it looks hand-drawn and two builds are byte-identical: a saved post rebuilt on the phone is the same picture.
- **The figure's face, hands and hair are neutral tints**, so it is nobody in particular.
- **Not owner-only:** fixed text, nothing to type into, the same reasoning as the Disclaimer.

**The story shape stretches the scene** (`SY` 1.4) instead of centring a post-shaped drawing in empty bands. The first render did exactly that.
- Item heights scale. The whirlwind's top stretches while its tip stays on the head.
- The figure is translated to the foot of the taller view box.

**The stock-name linker skips the drawing** (`el.closest('.ov-art')` in `linkStockNames`). It links SVG text whose whole text is a ticker, and these bubbles are jargon. None of the 21 labels matched any of the 1,284 names on the day, so this guards against a future listing (Beta Technologies, say).

**Tested** with scratchpad `ov-test.js`, 59 checks in the real studio across three shapes and three grounds:
- the drawing and its 21 labels;
- no banned words;
- no links in the drawing;
- title, drawing, line and foot stacked inside the artboard;
- the drawing's drawn height per shape;
- green and red measured on the drawn elements, only on the price classes;
- byte-identical rebuilds;
- no page errors.

The link guard was proved by a made-up stock with the ticker FOMO. With the guard removed, the bubble became a link (1 failure).
