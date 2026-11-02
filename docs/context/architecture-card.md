## How it's built: the architecture card (2026-11-02)
The owner: "create one slide in promo on the technical architecture of this tool, You can put this under brand".

**Template `arch`: Brand › How it's built, straight after Too much to read.**
- `tplArch` in `cards.js`, with the `.ar-*` styles beside the cartoon's.
- `promo.html` registers it in `TPLS` and `BRAND_VIEWS`. It has no controls and is not owner-only (fixed text, nothing to type), so it behaves like the Disclaimer.

**What is on it:** the kicker "Tickr Lab · under the hood", the headline "How it's built / from source to screen", four numbered stages joined by an accent rail, each a row of tiles, and one closing line ("Every figure traces back to a public source. Measured the same way, after every close.").
1. **Sources:** Twelve Data, SEC EDGAR, FINRA, OCC, news feeds, earnings calendars.
2. **Collect and check:** the scheduled jobs (prices every 30 minutes in market hours, a full run before the open and after the close), the AI reading (a Claude model reads each results release and article; every figure must appear in the text), the source rule (release, then filing, then Twelve Data).
3. **Store:** Turso (hosted SQLite), history kept by date, backtests on a local copy.
4. **Measure and show:** the readings, the Signal (ordered rules, first match wins, names the rule), Vercel serving the pages and cards.

**It restates facts from code**, the `/help` bargain. If the schedule, the source rule, the AI checks, a source or a host changes, this card changes in the same commit. The one date on it, 1998, is where the price archive starts.

**Rules it keeps:** evergreen (`chromeTop(false)`, no date, no count, reads no data); no buy, sell, hold or recommendation wording; no green or red (it makes no up/down reading; the house kicker colour aside); every colour a token or a `color-mix()` of one, so all grounds follow. The laptop-only jobs are not named as such: "scheduled jobs" covers both hosts.

**The stock-name linker skips the diagram** (`el.closest('.ar-map')` in `linkStockNames`): tile names are data sources, and OCC, for one, is a ticker.

**Shapes:** post and square put the stage label beside its tiles; the story stacks the label over its tiles and grows the type, so the stages fill the height instead of floating.

**Tested** with scratchpad `ar-test.js`, 67 checks in the real studio across three shapes and three grounds: fifteen tiles, no banned words, no links in the diagram, no tile clipped, overlapping or off the card, title, stages, line and foot stacked inside the artboard, no green or red, smallest text at least 13px, no page errors. The link guard was proved with a made-up stock OCC: with the guard removed, the tile became a link (1 failure).
