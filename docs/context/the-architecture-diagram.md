## The architecture diagram
**`/architecture` (admin only, an `Architecture` row in the console's Reference section) — every moving part and what talks to what (2026-09-17).** Six bands top to bottom: who is asking, the Vercel edge, the function, persistence, what is scheduled, and what only runs on the owner's machine.

- **The drawing is DATA, not markup.** `BANDS`, `NODES` and `EDGES` are three arrays and a fifty-line renderer emits one SVG; moving a band or renaming a store is an edit to a list rather than to a pile of coordinates. No library, the same call the charts made.
- **SVG text is safe here and nowhere else in this app.** The diagram keeps its own aspect ratio, so glyphs are not distorted — unlike every price chart, which stretches with `preserveAspectRatio="none"` and has to carry HTML labels.
- **Three routing cases, and the middle one was wrong first.** Two boxes in the SAME band have to be joined across, not up and over; the first cut sent `db.js → sessions` climbing out of the band and back down through everything between. And where another box sits between them the line goes UNDER the row, or four stores hanging off one accessor read as a chain passing work along.
- **Edge labels hug the source box on a plate.** Anchored mid-run they landed on a box title whenever an edge skipped a band; a same-band label with less clear room than it needs is dropped rather than printed across two boxes.
- **It restates facts that live in code**, which is the `/help` bargain: the 610-credit ceiling, rows-read metering, nothing running after a response, `public/` being unprotectable. If those change, this page changes with them.
- **Download PNG** goes through the shared `cardshot.js`, so the diagram can be pasted into a document at 1600px.
- Verified: a route walk (anon and guest redirected, `/architecture.html` funnelled, owner 200), and the drawing itself — 23 boxes each with a title, 22 edges all real paths, nothing off the canvas, **no two boxes overlapping**, no sideways scroll at 1500px or 390px, the console's link and its icon resolving, and the PNG coming back with ink in it.

