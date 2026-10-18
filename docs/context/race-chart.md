# The Race chart (promo template, admin only)

Added 2026-10-16. The owner asked: "Create a new Template called Race chart, Create a copy of this chart [Compare > Chart > The leaders in a list, Mag 7, This year, Top 5]. This feature always for Admin only, 25 seconds, 1Year or YTD".

## What it is
The Chart card in leaders mode, played as a video. Each stock's line is drawn day by day across a fixed date axis. The vertical scale grows as the lines climb. The labels at the line tips (`SYM +x.x%`, in the line's colour) re-sort as stocks overtake one another, and a large date counter runs in the bottom right of the plot. It plays for 25 seconds, holds on the finish for 2, and records at 30 frames a second.

## One chart, not a copy
`tplRace()` in `cards.js` maps its own controls (`rac*`) onto the Chart card's (`cht*`, with `chtMode: 'leaders'`) and calls `tplChart()`. The still card is therefore exactly the leaders chart, and the video animates exactly those lines with the same ranking and colours. The race passes one extra flag, `racTall`, which makes the plot taller on the 9:16 card (1240px against 1020).

- **Window:** `racWin` is `ytd` (the default), `y1` or `y5`. `basketDays` gives the race `CHART_WINDOWS.ytd` or `.y1`. YTD opens on last year's last close, as the Chart card does.
- **Past five years** (`y5`, added the same day at the owner's request) cannot read the whole screen: five years of every stock's bars is about 1.5M billed rows, and `/api/basket` caps a whole-screen read at 400 sessions. So `tplChart` names its stocks first. It takes the top N in scope by the snapshot's `fiveYearPct` and calls `getBasket(1260, only)`. The studio fetches `/api/basket?only=` for those few, and the route allows up to 1,300 sessions only when `only` is given, about 16k rows. A stock listed for less than five years has no `fiveYearPct` and is not in the race; the card's note says so. `/api/m/post` finds the list with one dry build of the card (race posts only), then reads the narrowed basket. `CHART_WINDOWS.y5` exists for this alone; the Chart card does not offer it.
- **Lines:** `racCount` is 3, 5, 7 or 10; the default is 5.
- **Scope:** the usual scope, sector, industry, size, screen and index lists (`SCOPE_PREFIX.race = 'rac'`). A theme such as Mag 7 is picked under "Within".

## The chart fills the card (2026-10-16)
The owner pointed out a gap above the kicker and another above the footer on the 4:5 card. `.s-body` centres its content, and the chart had a fixed height (590px at 4:5, 470px square), so the room it did not fill was split in two. That was 74px and 73px on the race card, and 87px and 86px on the leaders chart. On the square card with ten lines the content overflowed by about 30px at both ends. The studio's `fillGap()` measures the spare height after a draw, counting the kicker's collapsed top margin, keeps 32px spare, and draws once more with `ctx.fill` (`cardFill` in `cards.js`) added to the chart height, which never goes below 280px. Measured: 39px above the kicker and 38px above the footer at 4:5 and square, for both the Race and Chart cards. The video frame (no legend) measures its own. The 9:16 card is left alone: it already stretches its body (`.sz-story .s-body > div`). `/api/m/post` passes no fill, so a saved post on the phone keeps the fixed height.

## How the video is made (`promo.html`, `raceRun`)
1. `Cards.raceFrame(ctx)` builds the card with the chart's space left empty (`.race-plot`). It returns the model: dates, lines (symbol, colour, rebased series) and inks. The hook is `raceCap` in `cards.js`. When it is unset, `tplChart` behaves exactly as before.
2. That frame is rasterised **once** with `CardShot.shoot` into an ImageBitmap, so the chrome, title, note and footer are the card's own pixels.
3. A 1080-wide canvas replaces the stage. Every frame draws the bitmap, then the grid, the lines up to an interpolated day, the tip dots, the de-overlapped labels and the counter.
4. **Record** uses `canvas.captureStream(30)` and `MediaRecorder`. It prefers `video/mp4;codecs=avc1.42E01E`, which Chrome supports, and falls back to WebM with a warning, because Instagram does not take WebM. The file downloads as `race-<scope>-<ytd|1y>-<size>.<ext>`. Afterwards `render()` puts the still card back.

Recording happens in real time: the tab must stay in front, because a background tab throttles `requestAnimationFrame`. Headless Chrome under `--virtual-time-budget` stalls at the rasteriser; test it on real time through the DevTools protocol.

## Admin only, enforced in three places
- **Studio:** `OWNER_ONLY_TPLS` includes `race`, so the template is not offered unless `/api/me` says admin.
- **Server:** `postsFor(req)` drops saved `race` posts from `/api/promo-posts` and `/api/m/posts` for non-admins.
- **Server:** `/api/m/post` answers 404 to a non-admin asking for a race post.

Tested as owner, member and anonymous, and the test was proven by reverting the gate.

## Not done
- No audio. (The bar race arrived on 2026-10-17 with the filings measures, below.)
- The phone page cannot record. A saved race post opens there, for the owner only, as the still card.

## The race by the filings: revenue, net income, market value, P/E, profit margin (2026-10-17)
The owner: "Can the race chart be extended to other metrics such as revenue, net income, p/e ratio etc", then "Also include profit margin". A **Measure** control (`racMeasure`: `price` (default, the line race above), `rev`, `ni`, `cap`, `pe`, `margin`) and, for the five filings measures, **Years** (`racYrs`: 5 or 10) in place of the price window (`racWin` and its label hide). The filings measures are a **bar race** (`tplRaceBars`, `RACE_MEASURES` in `cards.js`): the N largest companies by today's market value in the cut, one bar each, re-sorting quarter by quarter.
- **The data is the Evolution card's series** (`evolutionSeries` through `/api/evolution`, the `getEvolution` channel): trailing-twelve-month revenue and net income, net margin, market value at each quarter end (split-adjusted shares times that day's close), and P/E as that value over trailing net income, null on a loss ("loss" on the still card).
- **Calendar quarters**, not fiscal: each frame is a calendar quarter end, and each company stands at its latest filed quarter on or before it, no older than `RCB_STALE` (200 days) or it has no bar.
- **Dollars only by construction**: stored filings are dollars (euro converted at the ECB rate per period; any other currency is stored as nothing), so currencies are never ranked against each other. Companies with no filings in the window (TSMC, SK hynix, SpaceX on 2026-10-17) are left out and counted in the note.
- **Colours** are one a company from `RCB_COLORS` (the chart palette plus fuchsia and slate), assigned to the companies shown, so ten never repeat.
- **The still card** is the last quarter ranked (HTML rows, the quarter in its own strip under them). **The video** (`raceBarsDraw` in `promo.html`) paints onto the same rasterised frame and records the same way: values eased between quarters, rows eased towards their rank, the scale following what is on screen, the quarter in the strip under the bars. File names carry the measure and years (`race-<scope>-rev-10y-portrait.mp4`).
- **No basket**: `basketDays('race')` is 0 for a filings measure. `evolutionNeed('race')` answers `{ race: true }`, so the studio repaints when a company's series lands, and `/api/m/post` finds the companies with one dry build (as the five-year price race does) and reads at most ten series.
- Each series read is a company's whole filing history plus its bars (the Evolution card's read), cached ten minutes; ten companies is the cap.
Tested on real stored filings for twelve of the largest (fixtures built from the database by a read-only script): still cards at all three sizes for revenue, net income and P/E, Play run in real time through DevTools with a frame captured mid-race, and the saved-post dry build naming the right seven.
