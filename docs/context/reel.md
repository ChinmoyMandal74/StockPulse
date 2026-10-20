# The Reel (promo template, admin only)

Added 2026-10-19. The owner shared a stock-data API's Instagram ad: a 23-second motion-graphics piece with typed headlines, a JSON reply and a chart drawing itself over a dark grid. They asked: "Can you help me creating such marketing videos for instagram reel". Offered a storyboard, they replied: "One stock storyboard is fine .. I want to see this in action first and then decide changes".

## What it is
One stock as a 22.6-second 1080×1920 video. It sits in the Stock spotlight group as **Reel (video)**, and the stock picked carries across from the other spotlight views. The five scenes (`SCENES` in `private/reel.js`):

| Scene | Time | What is painted |
|---|---|---|
| open | 0–3.4s | "One stock. / Every reading. / After every close." typed with a cursor |
| figures | 3.4–9.8s | Sector · industry, the name, ticker · price · today; then the spotlight's twelve figures rising one by one and counting up |
| signal | 9.8–14.6s | The six words as a ladder, a highlight sweeping down to this stock's step, then the rule that fired typed underneath, with "Balanced rules · a reading of strength, not an instruction" |
| chart | 14.6–19.4s | A year of closes drawn left to right with the move counting up beside it; the first close dashed |
| end | 19.4–22.6s | The glyph, Tickr Lab, tickrlab.com, the one-line description, and the date of the readings |

On every frame: the ground in the card theme picked, a faint grid, a drifting accent glow, the brand at top left, a "Close of <date>" chip, and "Mechanical readings — not investment advice".

**Safe area.** Instagram lays its header over the top of a Reel, its caption and buttons over the bottom, and its like/share column down the right. Everything to be read sits inside x 64–940 and y 250–1560. The grid fades out towards the foot.

## How it is built
- **`tplReel` in `cards.js`** is both the still card and the model. The still card is the Reel's cover: the name, ticker and price with the year's move, the twelve figures, and the Signal with its dial and rule, centred on the 9:16 card (`.rl-in`, `.rl-wrap`). When `reelCap` is set (`Cards.reelFrame(ctx)`), it hands back every figure the video paints, already formatted. The video and the cover therefore cannot disagree, and `reel.js` does no arithmetic on data.
- **The twelve figures are the spotlight's own.** `spotFigures(row)` was lifted out of `tplSpotlight` so the two cards share one list and one set of formatting rules. Checked: the Overview card's HTML is byte-identical before and after, across seven stocks, three sizes and two themes (42 cards). The check was proven by mutating one label (42 differ).
- **The closes** come through `historyNeed` (`reelNeed`: the stock, 253 sessions), the channel the Drawdowns, Bands and "Chart — any measure" cards use. Play and Record refuse with a message until the history has landed.
- **`Reel.paint(g, M, t)`** in `private/reel.js` is a pure function of the time and the model. Any frame can be drawn in any order, which is how the test harness grabs mid-scene frames without recording.
- **Recording** (`reelRun` in `promo.html`) reuses the Race chart's recorder: `canvas.captureStream(30)`, `MediaRecorder` preferring H.264 MP4 (`raceMime`), 10 Mbit/s. It saves `reel-<sym>.mp4`. It runs in real time, so the tab must stay in front. Choosing the template forces the 9:16 size, as the avatar forces square.

## Admin only, in three places
- Studio: `OWNER_ONLY_TPLS` includes `reel`.
- Server: `OWNER_ONLY_POSTS` (`race`, `reel`) drops saved reels from `/api/promo-posts` and `/api/m/posts` for non-admins, and `/api/m/post` answers 404. Tested by lifting the gate code from `server.js` and running it as owner, member and guest (21 checks); against the previous server code, 4 fail.

## Tested
In headless Chrome on the stored snapshot (1,281 rows) with closes from the analysis copy:
- frames from every scene, dark and light;
- a two-line company name (FWONK, 54 characters), which wraps rather than taking an ellipsis;
- a stock with no stored history, whose chart scene says so;
- the real `promo.html` served from disk with mocked APIs: pick the Reel, check the cover, Play, then Record. That saved a 6.7 MB MP4 that decodes at 1080×1920 and 22.8 seconds.

## Not done (the owner is to decide after seeing it)
- No audio. Music is added in Instagram, where licensed tracks live.
- One storyboard only; further reels (a market week, what the filings say) would reuse the scenes.
- The phone page cannot record. A saved Reel post opens there as the cover, for the owner only.
