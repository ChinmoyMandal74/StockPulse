# The Race chart (promo template, admin only)

Added 2026-10-16. The owner asked: "Create a new Template called Race chart, Create a copy of this chart [Compare > Chart > The leaders in a list, Mag 7, This year, Top 5]. This feature always for Admin only, 25 seconds, 1Year or YTD".

## What it is
The Chart card in leaders mode, played as a video. Each stock's line is drawn day by day across a fixed date axis. The vertical scale grows as the lines climb. The labels at the line tips (`SYM +x.x%`, in the line's colour) re-sort as stocks overtake one another, and a large date counter runs in the bottom right of the plot. It plays for 25 seconds, holds on the finish for 2, and records at 30 frames a second.

## One chart, not a copy
`tplRace()` in `cards.js` maps its own controls (`rac*`) onto the Chart card's (`cht*`, with `chtMode: 'leaders'`) and calls `tplChart()`. The still card is therefore exactly the leaders chart, and the video animates exactly those lines with the same ranking and colours. The race passes one extra flag, `racTall`, which makes the plot taller on the 9:16 card (1240px against 1020).

- **Window:** `racWin` is `ytd` (the default) or `y1`. `basketDays` gives the race `CHART_WINDOWS.ytd` or `.y1`. YTD opens on last year's last close, as the Chart card does.
- **Lines:** `racCount` is 3, 5, 7 or 10; the default is 5.
- **Scope:** the usual scope, sector, industry, size, screen and index lists (`SCOPE_PREFIX.race = 'rac'`). A theme such as Mag 7 is picked under "Within".

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
- No audio, no bar-chart race (bars re-sorting). The lines version was what the owner pointed at.
- The phone page cannot record. A saved race post opens there, for the owner only, as the still card.
