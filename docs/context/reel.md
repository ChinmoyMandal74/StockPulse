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

## Video from images (`/reelmaker`, 2026-10-20, admin only)
The owner: "a seperate tool only for the admin wherein admin can select upto 4 images and the app create a video, adds the 5th Tickr Lab mark and adds all the transitions etc", then "include all 3 sizes, There seems to be confusion on what sizes are accepted, Also include the color for the 5th slide".

- **The page** is `private/reelmaker.html`, served at `/reelmaker` to the admin only (the route redirects anyone else, and the page itself says so if opened another way). It is linked from the Reel's box in the studio.
- **Images** (PNG, JPG, WebP; up to four, a fifth is refused with a message) are decoded in the browser with `createImageBitmap` and **never uploaded or stored**, so there is nothing new on `/privacy`. Each can be reordered, removed, and given an optional caption (90 characters). The caption is typed onto the image on a dark band, inside the 9:16 safe area, or near the foot on the feed shapes.
- **Three shapes** (`Reel.SHAPES`), each with what it is for written on its button:
  - **9:16** (1080×1920): Reel or Story. Full screen; the profile grid shows the middle 3:4.
  - **4:5** (1080×1350): feed post, the tallest shape the feed shows.
  - **1:1** (1080×1080): square post.

  The page notes that Instagram posts every new video as a Reel, so a 4:5 or square one plays at its shape in the feed and with space around it in the Reels screen. An image of another shape sits whole in the middle over a blurred, darkened copy of itself (`Reel.composeImage`, composed once per image because blurring every frame stalls the recording).
- **Pace:** crossfade, slide, or slow zoom (100% to 108%, crossfaded), each image 2.5, 3, 4 or 5 seconds, 650 ms transitions, then the end card for 3.4 seconds.
- **The end card** is the Reel's (`endCard`, now drawn at any of the three sizes), without the readings date, with "Mechanical readings — not investment advice". **Its colour:** the promo cards' four grounds (Dark, Navy, Light, Sky, from `Cards.reelInk`, the same colour set the Reel uses), or any colour picked by hand. A picked colour gets dark or light ink by its brightness (`Reel.customInk`), and its accent is the ink itself, because the site's blue can vanish on a ground somebody chose.
- **Preview:** a scrubber shows any moment (the painter is a pure function of time), and a tick box shades where Instagram's own header, caption and buttons sit over a 9:16 Reel (preview only, never recorded). Picking an end colour jumps the preview to the end card.
- **Recording** is `Reel.run`, now shared with the studio's Reel: real time, H.264 MP4 in Chrome, saved as `tickrlab-<n>-images-<shape>.mp4`.

Tested on the page served from disk with real images of three shapes (two 4:5 cards, a 3:2 screenshot, a 9:16 cover):
- frames from every shape at each image, mid-crossfade, mid-slide and on the end card;
- all four grounds and two picked colours, yellow (dark ink) and violet (light ink);
- a fifth image refused;
- the non-admin view shows the refusal;
- a 4:5 recording with slides at 3 seconds decodes at 1080×1350, 15.7 s;
- the studio Reel re-recorded through the shared recorder.
