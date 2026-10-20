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

## Video from cards (the promo studio, 2026-10-20, admin only)
The owner, after trying Video from images: "It is not adding any dynamic content like the race charts". Offered three ways forward, they chose "A" (any studio card builds itself), "I should have the option to select the size and color".

- **The box** sits under Download PNG in the studio's side panel and is hidden in the member view (`body.mem #vidBox`). **Add this card to the video** queues the card on the stage: its template and every control value it was built with (`controlOpts()` plus `linkOpts`), named by template and title. There are up to four, which can be reordered and removed. The first card added sets the video's shape and colour to the studio's.
- **Shape** (9:16, 4:5, 1:1, each labelled with its Instagram use) and **Colour** (Dark, Navy, Light, Sky, the card grounds) apply to the whole video. Every queued card is redrawn at that shape and in that colour, whatever it was added with, and the end card takes the same colour. Picked colours are not offered here because a card can only be drawn on its four grounds. **Transition** and **Each card on screen** (4, 5, 6 or 8 seconds) work as on `/reelmaker`.
- **How a card builds itself** (`Reel.cardParts`, `cardSchedule`, `cardSlide` in `reel.js`). The card is built again off-screen (`vidCapture`: a parked `.s-art` at the video's size, `fillGap` applied). It is rebuilt every 300 ms until two builds agree and no loading words show, because its data was read while it was on the stage. Its parts are found from the layout, with no per-template code:
  - a chart (an `svg`, `canvas` or `img` wider than 300px) draws left to right;
  - repeated children (three or more of one tag and class) each arrive in turn: a wide, short one wipes in from the left (so a bar grows with its row), a squarer one pops in;
  - anything small fades up;
  - the brand and footer never move.

  The card is shot twice by `CardShot`, whole and with the parts hidden; each frame is the empty card plus each part cut from the whole one. At most 48 parts, staggered so the card is built in about 2.5 seconds. **What cannot move** is a number inside a part: it is pixels, so it arrives with its row and does not count up. The Reel (one stock) is the template that counts.
- `render()` stands aside while a card video plays (`vidPlaying`), so a data reply landing mid-recording cannot wipe the canvas.

Tested in the real studio (served from disk, APIs mocked from the stored snapshot). Four kinds of card were queued (Movers, the Reel cover for MU, Chart — any measure for NVDA, the Signal board) and the fifth add was disabled. Played at 4:5 Light and 9:16 Dark, with frames sampled during the build: rows wiping in with their bars, cells popping, the chart drawing, the dials arriving. Recorded both, and both MP4s decode (1080×1350 and 1080×1920, 23.8 s). The stage came back afterwards. Video from images was re-run after the shared slide painter changed.

## Music (2026-10-20, all three tools)
The owner asked how to add sound. Offered music, sound effects or both, they chose: "I don't need effect, Just add option for music". Instagram's desktop site has no music library (only the phone app does), so a track in the file is the only way a reel posted from the laptop gets sound.

- **One picker, three hosts.** `Reel.musicPicker(el)` sits in the studio's Reel box (`#rlMusic`), its Video from cards box (`#vidMusic`) and `/reelmaker` (`#rmMusic`, section 4). It offers a file button (MP3, WAV, M4A, AAC, OGG), the track's name and length, remove, **Volume** (100, 80 (the default), 60, 40, 25%) and **Start the track at** (the beginning, or 5 to 90 seconds in). The file is decoded in the browser (`Reel.loadMusic`, Web Audio) and never uploaded or stored; nothing new for `/privacy`.
- **Playback** (`Reel.run`'s `music` argument): the track starts with the picture (both clocks begin together), fades in over 0.4 s and out over the last 2 s, and loops from the chosen start if it is shorter than the video. It is heard during Play as well as recorded, so Play is a true preview.
- **The file:** with music the recorder asks for `video/mp4;codecs=avc1.42E01E,mp4a.40.2`, H.264 with AAC audio, the pairing Instagram takes. Chrome 155 offers it. Without music the file has no audio track, as before.
- The hint beside each picker says to use music that may be used commercially (royalty-free: Pixabay Music, the YouTube Audio Library).

Tested with generated tunes (30 s and 8 s WAVs) set through the real file inputs. On `/reelmaker` (1:1, 2.5 s an image, track from 5 s at 60%), the recording carries AAC (`mp4a`, no Opus) and its decoded audio holds a steady level each second, then falls over the last. The 8-second track loops through a 13-second video. After Remove, the next recording has no audio track. In the studio, Video from cards (4:5) and the Reel each recorded with their own picker's track (AAC, 19.7 s and 22.9 s of audio).

## Music made here (2026-10-20)
The owner: "I have to provide the music?" Offered generated loops or a bundled library of public-domain tracks, they chose: "yes option 1".

- **Four tracks composed in code** (`TRACKS` in `reel.js`). Each is eight bars, rendered by Web Audio's offline renderer (`renderTrack`) with synthesised instruments (`makeVoices`: detuned-saw pads, triangle plucks, sine and triangle bass, a swept-sine kick, noise hats and claps, a generated room reverb, a compressor):
  - **Calm**: 80 bpm, pads and slow plucks over Am–F–C–G, 24 s loop.
  - **Pulse**: 110 bpm, kick, off-beat hats, eighth-note bass, sixteenth arpeggio, 17.5 s loop.
  - **Bright**: 124 bpm, four-on-the-floor kick, claps on 2 and 4, off-beat chord stabs over C–G–Am–F, 15.5 s loop.
  - **Keys**: 90 bpm, a piano-like arpeggio with soft bass and pad, 21.3 s loop.
- **Seamless and level.** The reverb tail past the eighth bar is folded back onto the start, so the loop wraps without a cut (the measured jump at the wrap is under 0.007). Each track is levelled to the same loudness (an RMS of 0.19, peak kept under 0.95), so switching tracks does not change the volume (measured within 0.6 dB). Noise is seeded, so every render is identical. A render takes about 1.5–2.5 s, starts the moment a track is picked, is cached for the page, and `Reel.run` waits for it if Play comes first (`music.ready`).
- **The picker** (`musicPicker`) is now a list: No music (the default), the four tracks, or Your own file… (the earlier file button, with Start the track at). **Listen** plays the chosen music alone for ten seconds at the chosen volume; Volume applies to all. The hints say the made tracks need no licence.
- Synthesised and simple by design: background for an explainer, not a produced song.

Tested in headless Chrome. Each track renders with no NaN and no clipping, at the lengths above. A `/reelmaker` video with Pulse picked from the list carries AAC audio at a steady level, fading at the end. The studio's two pickers list six choices each, and the Reel still records. A WAV of each track was rendered for the owner to listen to.
