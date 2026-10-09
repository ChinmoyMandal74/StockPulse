### The Histogram — the shape of the whole screen on one measure (2026-10-06, owner's request)

**A nineteenth template, `histogram`, fifth in the studio's picker, with two modes: the distribution on its own, and the same distribution with one stock pinned to it.** Asked as *"One chart we do not have is Histogram, can you give me some ideas"*, answered with a measurement of which distributions actually have a shape, and the owner took **both** of the two concepts offered.

#### IT IS THE ONE SHAPE THE STUDIO COULD NOT DRAW
Every other data card is a **ranking** (movers), a **relationship** (bubble, fund), a **time series** (chart, evolution) or a **composition** (flow, size). None of them answers *what does the whole screen look like on this measure* — which is also the thing that makes a single stock's reading mean anything. `stock` is `screen` plus a pin, so they are two MODES of one template rather than two templates; the `fund` and `chart` pattern.

#### THE MEASURES WERE CHOSEN BY DRAWING THEM, not by sounding interesting
Twelve, each binned against the live distribution rather than guessed. The three with a genuinely striking shape:

| | what it looks like |
|---|---|
| **% below its own record** | a broad body with a long left tail — median **−30.5%**, p10 −72.4, and 27 companies more than 90% below |
| **a bad day** | sharply peaked: **376 companies at −3 to −4** and a thin tail to −14, so "normal bad" is 3-4% |
| **position in the 52-week range** | **not** the U-shape anyone would predict — a pile at the bottom (133 + 108 in the lowest two bins), a flat middle, a small lift at the top |

**Value added today was measured and REFUSED**: 1,141 of 1,262 fall in two bins, because dollar amounts spanning orders of magnitude do not make a histogram.

#### THE BINNING IS PER MEASURE AND FIXED, never derived from the data
A range taken from today's own percentiles moves every time the card is drawn, so two posts a week apart would not be comparable — and **the range is most of what a histogram asserts**.

- **AN OPEN END BIN IS THE TRAP SPECIFIC TO THIS CHART.** Drawn without saying so, everything beyond the range piles against the edge and reads as a real mode. Measured on the live screen: **forward P/E has 125 values outside a 0-60 window and revenue growth 81**. An open end is labelled with a sign (`≤−90`) and counted in the note.
- **THE AXIS LABELS ARE BIN EDGES, not midpoints.** The bins were chosen to land on round numbers and a midpoint label throws that away — the first render read `−77, −62, −47` where the bins start at −75, −60, −45.
- **THE AXIS IS ZERO-BASED, AND THAT IS THE OPPOSITE OF THE EVOLUTION CARD'S RULE.** A bar is read as a quantity measured from the baseline, so a truncated one is the classic misleading chart; a LINE carries no such claim, which is why that card may use its data's own range and this one may not. **Do not "fix" this to match it** — the comment in the builder says so.

#### COLOUR ONLY WHERE ZERO IS A DIRECTION
`signed` is true for returns, margins and growth, where a reader already reads red as down. It is false for everything whose values are all one sign — *a column negative on every row says nothing by being red*, the Bad day rule — and **false for `peerPe`, which is a measurement rather than a style choice**: this project found the cheapest third of each industry has the worse growth, margin, ROE and Quality, so a green bar there would be the card asserting the opposite of its own data.

#### Worth knowing
- **FUNDS ARE OUT.** A fund has no fundamentals and reports AUM as a market cap, so it does not belong in a distribution OF companies — the rule `/consolidated`, the Snapshot card and the flow card all keep. The fixture gives both funds a value in a bin the data otherwise leaves **empty**, so including them would be visible rather than a rounding difference.
- **THE PERCENTILE IS THE PAYLOAD of the subject mode**, not the value — the row already carries the value. Worded neutrally (*higher than 18% of them*), because whether higher is better is the reader's to decide.
- **A FLOOR OF 30 READINGS.** Below it the card says so rather than drawing a row of single-count spikes, and it names how many it found.
- **The flag anchors to whichever side has room.** Centred is right in the middle and runs off the artboard at either end — measured on the story, where a subject at its own record pins at 100%.
- **A null is counted and named, never binned at the left edge**, which is what `Number(null)` would do.

#### IT FOUND A REAL GAP IN THE CONTRAST SWEEP
**`groundBehind` starts at `el.parentElement`** — exactly right for the SURFACE check (a background compared with itself would always pass) and **wrong for the INK check: text sits on its OWN background when it has one.** The subject's flag is ground-coloured text on an accent pill, so it measured **1:1 against the artboard**, a failure that is not there. The two checks now take two different grounds, which is what they always meant. *Same class as the text/graphic floor fix the day before: a sweep gets the wrong answer when one model is asked to serve two questions.*

#### A SCOPED TEMPLATE HAS TO JOIN SIX LISTS, NOT TWO
This page documents the hardcoded **listener** lists (now sixteen) and `CONTROL_IDS`. There are **four more that FILL the pickers** — sector, size, screen, S&P — plus a line that copies the scope options. Missing from a fill list, a picker exists carrying only its placeholder: **the control is there, it is in `CONTROL_IDS`, it is wired to a listener, and it still cannot be changed to anything.** Caught by the suite asking whether changing `histSector` redrew the card, not by reading.

- Control ids **117 against `POST_OPT_MAX` 200**, counted rather than assumed.
- Verified: **41 checks**, plus the ground sweep (**229 over 168 combinations**) and the width sweep (**109 over 126**) with the template registered and **both modes swept** — a template with no `MODES` entry is visited on its default mode only, the coverage hole the Intro's step slides sat in for weeks.
  - **THE FIXTURE IS THE TEST.** Every value is planted in a KNOWN bin, the counts per bin are all different, and **the median is deliberately not the midpoint of the range** (−3.5 on a −14..0 axis is 75%), so a card that bins wrongly, or that splits the difference, comes out at a different picture rather than coincidentally the right one. **A histogram that mis-bins looks perfectly well formed.**
  - **THE ZERO BASELINE IS PROVED BY PROPORTION** rather than asserted: if the drawn heights are proportional to the counts then the baseline is zero, and if it were lifted they would not be.
  - **THE PHONE IS THE SECOND HOST** and is round-tripped through the page's own Save button — a round-trip written against the API exercises the server and never `controlOpts()`, which is what reads `CONTROL_IDS`.
  - **Three fixture faults worth keeping.** The three rows added to make a below-floor scope reachable **also carried the measure**, so the pool was 39 and not 36 and the suite reported the CODE wrong when the fixture was. `peerPe` is a **read-path stamp** computed from `forwardPe`, so a fixture that sets `peerPe` directly has it overwritten with null — the no-colour claim was being asserted over an empty card. And `init()` is async, so seeding at module load gives `no such table: names`.
  - **A SEEDER THAT LOADS `.env` CHANGES THE SERVER'S AUTH MODE.** The shot harness pulls real production rows so the shapes are the real ones; `dotenv` runs at require time, which handed `uni-boot` the real `ADMIN_PASSWORD`, turned off open mode, and sent `/promo` to `/login` — which reads exactly like a page that failed to render.
  - **`size-scope-test.js` ACCOUNTS FOR EVERY TEMPLATE as either scoped or unscoped, and correctly failed** until the histogram was added to its scoped list — which is that check doing exactly its job rather than going stale. **Corrected, not worked around.**
  - **Four faults were found by LOOKING and none by assertion**: the subtitle inheriting the 66px title size (the Evolution card's own bug, met again because `.s-title .dim` is shared), the midpoint axis labels, the median line and its label drawn *behind* the bars so the rule showed only above them and the word not at all, and the flag off the artboard at the extremes.

#### Short interest and days to cover, as distributions (2026-10-06, owner's request)
**Two entries in `HIST_MEASURES` and nothing else** — the picker is `<select id="histMeasure"></select>` in the markup and filled from `Cards.histMeasures()`, so a measure added to the module appears in the studio with no second edit, and `histScope` already narrows it to a sector or a screen. No new template, no new control, nothing in `CONTROL_IDS`, nothing on the phone.

**They answer the one question a single stock's number cannot: what is normal.** Measured on the live screen, short % of float runs p10 **1.4**, median **4.7**, p90 **14.2**, and days to cover p10 **2.1**, median **4.2**, p90 **8.2** — both unimodal with a long right tail, which is a real shape rather than one bin holding everything (the reading that killed *value added today* as a histogram measure).

- **THE BINS ARE FIXED AND CHOSEN BY DRAWING THEM**, this card's own rule: a range taken from today's percentiles moves every time the card is drawn, and the range is most of what a histogram asserts. Short % of float is **0–30 in 2-point bins** with an open top (1.4% of the screen is past 30, and the peak lands at 2–4%); days to cover is **0–15 in whole-day bins** (0.6% past, peak at 3–4), because a day is the unit it is read in.
- **UNCOLOURED, both of them.** `signed` is for a measure whose zero is a direction; these are one sign throughout, and *a column negative nowhere says nothing by being red* — the Bad day rule. It would also be the card taking a view on whether being shorted is bad, which is the one thing this template must not do. **Proved by reverting**: `signed: true` fails the check.
- **LAST IN THE LIST**, because positioning is neither a return nor a fundamental and belongs among neither.
- **What reaches this card is already sane**, because the read path withholds a reading larger than the float (`SHORT_PCT_MAX`) — so the long tail here is real rather than the Berkshire artefact.

##### "EACH BAR IS 1 POINT" FOR A COUNT OF DAYS
The note's bar-width phrase hardcoded *point* in its `step === 1` branch, and **no existing measure had ever reached it with a non-percentage** — `badDay` is the only other step-1 entry and it is a percentage. Days to cover arrived with whole-day bins and read *"Each bar is 1 point"*. The Flow card's *"a industry that fell"*, in a third place.

`unitWord` is the measure's own noun, and without one the wording is byte-for-byte what it was — **asserted rather than assumed**: all fourteen phrases are checked, and the twelve that existed are unchanged (`5 points`, `1 point`, `5 wide`, `one point`, `0.1 wide`, `0.5 points`, …). **Proved by reverting twice**: dropping the word, and neutering the branch, each fail 3.

- Verified: **26 checks**, mostly off-page since the module is pure. **The fixture plants every value in a KNOWN bin with all the counts different**, so a card that mis-bins comes out at a different picture rather than coincidentally the right one — a histogram that bins wrongly looks perfectly well formed. **Proved by reverting six times**: each entry removed fails 13 and 12, the wrong bins 5, the unit word 3 twice, and the colouring 1.
  - **THE HEIGHT IS ON THE INNER `.hg-f`, NOT ON `.hg-b`** — read off the builder rather than guessed, which cost a run reporting **0 bars** on a card the page check could see drawing fifteen.
  - **EACH ROW MUST CARRY ONE MEASURE AND EACH MEASURE ITS OWN 30 READINGS.** Giving every row both made the counts the whole fixture rather than the planted group; splitting them then put each under the card's own too-few floor, so every assertion was about an empty card. Both were the fixture reporting the code wrong.
  - **THE EXPECTATION IS BINNED FROM THE ROWS, never restated from the plan.** The plan omitted a trailing row carrying a `shortRatio` and no `shortPctFloat` — the shape the read-path guard itself produces — and the suite blamed the card for a count that was one out.
  - **`w` EQUALS `avail` ON EVERY SUBTITLE, because `.dim` is a block** and a block fills its parent whatever is inside it, so that measurement says nothing. What is real is `letter-spacing: -2.97px` at 30px, which is the **existing** treatment on every subtitle: the longest one simply reads as the most crushed. Both were cut to 55 and 47 characters, inside the existing 54–59, which is better writing anyway since each repeated its own title.

### Treemap and Waterfall — the market as area, and the parts that add up to it (2026-10-06, owner's request)

**A twentieth and twenty-first template, `treemap` and `waterfall`, fifth and sixth in the studio's picker, both defaulting to the S&P 500.** Asked as *"In Promo, What do you think about adding Tree map, One idea I have is to show individual stocks contribution to s&p index .. showing narrowness"*, then **"Can you do the size treemap and waterfall for narrowness, Focus on S&P"**.

#### THEY ARE TWO CARDS BECAUSE CONTRIBUTION IS SIGNED AND AREA IS NOT
The request was one idea and it does not fit on one card, which is the measurement that shaped both. **Over the past month 360 of the 502 members contribute NEGATIVELY**, and a rectangle has no negative size. Taking the absolute value instead makes the tiles sum to **6.8 points against an index of 1.4** — a five-fold overstatement with nothing on the card to say so.

So the signed quantity becomes the **colour** and the treemap answers *what is the market made of and what did each part do*; the waterfall is the one chart that takes signed parts and still **closes**, and answers *what actually moved it*. Contribution is then area times colour on one card and an explicit arithmetic on the other, and each says in its note what the other is for.

#### SIZED BY OUR OWN MARKET CAP, NEVER THE FUND'S PUBLISHED WEIGHT
A weighted constituent list is the issuer's dataset — which is why `/holdings` is `requireAdmin` and why the screener carries only a Yes/No boolean. **A promo card is the most public surface in this app**, so area comes from the provider's market cap, which is our own data and visually identical at the sizes a tile is drawn at. There is a check that nothing resembling a weight or a share count reaches a screener row.

#### `marketParts` IS SHARED, AND IT IS BEGIN-WEIGHTED
Two readings of one arithmetic, so one function: the treemap wants the pool and the index return, the waterfall wants the per-name contributions as well. **The weight is the one at the START of the window**, reconstructed as `cap / (1 + r/100)` — the Flow card's measurement, where today's weight times the window's return overstates the index by **24.6 points over a year**, because a winner has already grown into the weight being applied to it. Measured live, the parts then sum to the index's own return with a gap of **0.0000** at every window. **Proved by reverting**: the end-weighted version fails 9, and the waterfall's own steps then add to 16.28 under a bar labelled 0.00.

- **A `-99` floor keeps a total wipeout out of that divide** — at −100% the reconstruction is a division by zero and at −99.9 it is a thousand times the company's own value. The `MIN_VOL` lesson, where a near-zero divisor once produced a 3,227,535× position.
- **Two exclusions, and they are different rules.** A missing return is ABSENT, never zero (`Number(null)` is 0 and finite, and a fabricated flat company drags a weighted mean); a company with no market cap carries no weight at all, and `> 0` rejects null and zero in one test. **Proved by reverting**: coercing a null cap fails 1 and drops the count from the note.
- **The index funds and the eleven sector funds come out first**, the trap `/consolidated`, the Snapshot and the Flow card all record: a fund that IS a slice of the market, inside that market's own aggregate, double-counts it. They carry a real cap (a fund reports AUM), so nothing else would have excluded them. **Proved by reverting**: fails 12.

### The treemap

**Squarified (Bruls, Huizing and van Wijk), nested by sector, every member drawn.** A row is grown while the WORST aspect ratio in it keeps improving, which is what stops 500 tiles degenerating into slivers.

- **NESTING IS WHAT REMOVES THE TAIL PROBLEM.** Measured at 1080px: the top 20 names are 53% of the area, the top 40 are 63%, the top 100 are 78% — so a flat map pooling everything outside the top 40 would make *the rest* **37%** and the biggest single thing on the chart. That is the Flow card's own measurement and the reason it refuses a flat industry view. Nested, nothing is pooled.
- **Drilled into a sector, the grouping is the INDUSTRY.** A stock can carry a sector and no industry yet, since both arrive with the same profile and the taxonomy has been filled at different times, so the blank bucket is kept and named with an em-dash.
- **A HEADER STRIP IS ONLY GIVEN TO A BLOCK THAT CAN HOLD ONE** (`b.h >= HEAD * 2.4 && b.w >= 90`). Basic Materials is **1.4% of the index**, so on the square its block is barely taller than the strip — a header there would BE the sector and the tiles it is labelling would be invisible. **Proved by reverting**: a strip at 17px inside a 1px block.
- **A TINT OVER THE GROUND, never a solid colour, and that is what makes ONE label rule serve all four grounds.** A tint keeps the tile on its own ground's side of the lightness range, so `--text` reads on every one of them: near-white on a dark green over black, near-black on a light green over white. A solid fill would need a second palette and a per-tile contrast decision.
- **THE COLOUR SCALE IS FIXED PER WINDOW** (±4% for a day, ±8 week, ±15 month, ±50 YTD, ±60 year) and never taken from the day's own spread — the histogram's reason: a scale that moves with the data makes two posts a week apart incomparable, and on a coloured map the scale is most of what the card asserts. Past it the colour clamps, the note counts how many, and the key prints the number.
- **A tile under the label floor is drawn and left unlabelled** rather than labelled illegibly, and the note says how many. Live: **91 of 502 named on the 4:5, 155 on the story**.

#### A COMPANY TOO SMALL TO DRAW WAS SILENTLY DROPPED, AND THE FIXTURE IS WHAT FOUND IT
`squarify` abandons a remainder it cannot place, which is right — stacking zero-size tiles in a corner reads as a drawing fault. But the kicker counts MEMBERS and the map counts TILES, so a reader was being told *502 companies* and shown 500. It cannot be floored: a minimum size would distort the one thing the card encodes. **It is counted instead** — *"N are too small to draw at all"* — the Size card's bargain, where a thing drawn at its floor says so.

- Unreachable on the live index (all 502 drew), so the fixture grew a company worth a two-thousandth of its map. **A guard no fixture can reach needs a smaller test, not a quieter claim.**

#### THE 31-ROW FIXTURE CANNOT PROVE SQUARIFY, AND THE REVERT SAID SO
Reduced to slice-and-dice, the fixture's worst tile is **3.83:1 against squarify's 2.94** — a difference no honest threshold separates, because seven blocks of four or five tiles cannot produce a sliver. The claim is about **five hundred** tiles, so it is measured there: an off-page check builds the card over a 500-name power law with no server and no browser, and asserts **median 1.21:1, p95 1.85, worst 3.40**. **Proved by reverting**, which then fails.

### The waterfall

**Top K risers, then top K fallers, then the pooled remainder, then the index — drawn from zero.**

- **TOP K EACH SIDE, never top 2K by magnitude.** Ordered by |contribution| the two signs interleave and the chart is a jagged fence; this way it rises, falls, and closes, which is the shape the reader is meant to take off it.
- **THE TOTAL IS NOT A STEP.** It is drawn from zero, because it is the thing the steps add up TO — drawn as one more step it would read as another contributor and the chart would not close. It takes no outgoing connector for the same reason. **Proved by reverting**: fails 1, with the index bar floating where a step would be.
- **THE CONNECTOR IS THE PROOF, not decoration.** It runs at the level the running total has reached, and the one leaving the last step lands **exactly** on the top of the total bar. If the arithmetic were wrong that line would miss, visibly, and no number on the card would say so. Measured on the fixture: 183.5 against 183.5. **Proved by reverting**: fails 1 at 445.3 against 183.5.
- **The pooled remainder is NEUTRAL, not a direction** — it is the one bar that is not a company, and its sign is whatever hundreds of names net to.
- **THE NARROWNESS NUMBER IS A STAT, because it is what the card is for**: how many risers it takes before their contributions alone cover the whole net move, everything below them cancelling out.
- **The ticker and the value are sized FROM THE COLUMN**, because K moves between 3 and 10 and the column halves across that range; below 40px of column the value is dropped rather than overlapping its neighbour — the treemap's own labelling rule.

### WHAT THE LIVE INDEX ACTUALLY SAYS, which is the argument for both

| | past month | this year |
|---|---|---|
| the index | **+1.53%** | +14.44% |
| members that FELL | **360 of 502** | 212 of 500 |
| risers needed to cover the whole net move | **5** | 39 |
| the pooled remainder | +0.03pt | **+8.62pt** |

**Over a month the card is dramatic and over a year it is not, and both are honest.** On the month the REST bar is a sliver and five names carry everything; on the year REST is larger than every named step combined — the index is genuinely broad over that window, and the card says so rather than implying narrowness it has not measured. `wfallCount` is what a reader turns up when the remainder is doing the work. Weight concentration, for context: **the top ten are 42.4% of the index and seventeen names carry half its value.**

#### `POST_OPT_KEY` WANTS THREE LOWERCASE LETTERS, AND `wf` IS TWO
**The waterfall's controls were `wfSector` / `wfPeriod` / `wfCount` / `wfSp500`, and `cleanPosts` dropped every one of them on save.** `POST_OPT_KEY` is `/^[a-z]{3,6}[A-Z][A-Za-z0-9]{0,20}$/`; a two-letter prefix fails it. The post stored, the response said `ok`, nothing appeared in any log — and the phone then built the card at its **defaults**. The same silence `POST_OPT_MAX` produced when it was 40 against 63 controls and ate all seven of the Size card's.

- **THE PREFIX MOVED, NOT THE REGEX.** That guard is shared by every template and exists to stop a saved post becoming free storage; relaxing it to `{2,6}` would buy nothing, since no other control uses a two-letter prefix. `wfall*`, and nothing was stored yet so there is no migration.
- **THE CHECK IS OVER THE WHOLE PAGE, not these two cards.** The suite reads `CONTROL_IDS` out of `/promo` and tests all **124** ids against the server's own rule, so the next short prefix is caught by a suite that is not about it.
- **Proved by reverting**: fails 7, with every control inert. **The revert has to rename the fill-loop prefix too** — renaming the ids alone leaves the page looking up controls that do not exist, which throws and kills the suite at check 1: an impossible state rather than the bug, which was a *consistent* two-letter prefix.

#### Worth knowing
- **No endpoint, no query, no basket.** Every field both cards read is on the snapshot row, so neither has a `basketDays` entry and neither fetches anything; `spMember` is a read-path stamp and `/api/m/post` already applies it, so a saved post carries the cut to the phone with nothing wired — **checked rather than assumed**, because the stamps are a set and the set has been incomplete twice.
- **A FIFTEENTH AND SIXTEENTH hardcoded listener list** in promo.html. A control in the markup and in `CONTROL_IDS` but not in one of these saves with a post, is read by the builder, and **does nothing when you touch it**. Control ids **124 against `POST_OPT_MAX` 200**.
- **No scope pickers**, for `tplDay`'s and Flow's reason — these answer *what is the market made of*, so they take no list, no screen and no size band, and `INDUSTRY_PREFIXES` is left alone. `tmapSector` and `wfallSector` are DRILLS, not scopes, and like Flow's they are **not checked against a list**: a sector name is the provider's taxonomy arriving as free text, so a hardcoded set would refuse a twelfth the day one was added.
- **HTML labels over the drawing, never SVG text** — the module's standing rule, since the artboard is scaled to the window.
- Verified: **56 checks**, over a fixture whose load-bearing properties are that **the biggest faller is one of the biggest companies** (so area-as-contribution comes out at a visibly different size), that **begin and end weighting disagree by seven points**, that **the biggest company in it is NOT a member** (so a leaking S&P cut changes the index entirely rather than by a rounding margin), and that **both funds carry `spMember` true**, so only the explicit exclusion removes them. Plus the ground sweep at **253 checks over 184 combinations** and the width sweep at **121 over 138**. **Proved by reverting ten times, every one load-bearing.**
  - **Two layout faults found by LOOKING and none by assertion**: the ticker band ran straight into the figures row (12px apart, reading as one block of text) and two adjacent value labels nearly met on the 4:5. A third — the treemap's story running **17px** past its artboard — was caught by the card suite and by neither sweep, because the ground sweep measures colour and the width sweep measures the horizontal.
  - **THE FIXTURE WAS WRONG TWICE BEFORE THE CODE WAS WRONG ONCE.** All four big names were in Technology, which took that sector to **91%** of the map so no other block earned a strip and the suite reported ONE where the guard was working exactly as designed; and every small name was at or below zero, so `up` held only the three giants, the card correctly drew nine steps rather than twelve, and the suite reported the CODE wrong. The giants are in three sectors now and half the crowd rises.
  - **`note-fit-test` HAS NEVER SEEN THE FLOW CARD'S NOTE**, and would never have seen these two: its fixture carries no `ytdPct`, which is the default window for all three, so each drew `.s-empty` and dropped out of the note list in silence. One field took it from 9 templates to **12**. Corrected there rather than worked around.
  - **A COUNT HAS TO BE DERIVED, not written down.** The suite's column count is however many of each side the fixture can supply, capped at the control's value — a literal reports the code wrong the moment the fixture moves, which is exactly what it did.
  - **Three fixture traps worth keeping.** `fund_holdings` and `fund_state` are keyed **`'spy'` lowercase** (both accessors fold it), so a `'SPY'` seed matches nothing, stamps null on every row, and every assertion then passes over a card correctly reporting that no file has been imported — there is a sanity check on the stamp before anything else runs. `CONTROL_IDS` is a top-level `const`, so it is a lexical binding and **not** a property of `window`: reading it that way collected nothing and the post saved with no options at all. And an apostrophe in prose (*"the page's list"*) is a perfectly good quote to a naive matcher, which reported `s list.` as a failing control id.
  - **A heredoc ate a backslash level twice more** — once leaving a real newline inside a regex literal so the suite would not parse. Eighth and ninth instances; both repaired with the Write tool.

#### ONE COMPANY, ONE LISTING — Alphabet was two bars (2026-10-06, owner: "Google is appearing twice")
**Reported against the waterfall, where `GOOGL +3.81%` and `GOOG +3.47%` were the first two steps.** It is not a cosmetic duplicate: both carry the **whole company's** market value, so Alphabet entered the pool twice at full size, and the index the chart closes on was wrong.

##### THE PROVIDER REPEATS EVERY COMPANY-LEVEL FIGURE AGAINST EACH CLASS, and only the price is the class's own
Measured on the live screen rather than assumed, and the first reading of this in my own notes was wrong:

| | shares (M) | float (M) | cap $B | cap/share | price |
|---|---|---|---|---|---|
| GOOGL | **12,229.9** | **10,879.4** | 4,136.7 | 338.24 | 347.85 |
| GOOG | **12,229.9** | **10,879.4** | 4,162.5 | 340.35 | 344.32 |
| BRK.B | 1.4 | 1.2 | 1,071.4 | **748,362** | **506.43** |

**BRK.B is the proof**: a cap/share of 748,362 against a $506 price is BRK.A's figures wholesale. **Shares and float are identical to the digit in all seven dual-class pairs**, so a class's cap is `whole-company share count × that class's own price` — and **neither class's figure is its own value**.

- **The caps therefore need not be near-equal, and that is what corrected the first thesis.** Where the classes trade alike the two caps nearly match (GOOGL/GOOG 0.6% apart, Z/ZG 1.6%); where they do not, they differ a lot (HEI.A $31.4B against HEI $42.3B, 35%). **Both are still wrong, and the pair is still ~2x the company.**

##### THEREFORE THE MEAN, NEVER THE SUM — and a float-weighted mean is not available
`cap = W × price_now` and the begin weight is `W × price_then`, so the mean across the classes is `W × the mean class price`: the company itself, **exactly** when the classes are equally sized and **inside the bracket always**. Summing is the double count. A float-weighted mean would be better and **the float is the whole company's on every class too**, measured — so the unweighted mean is the best estimator the data permits, and the note says the classes are combined.

##### THE KEY IS THE FILER ID, WHICH THE PROJECT HAD ALREADY SETTLED ON THIS DATA
`/adjustedbacktest`'s `btOneEach` chose the CIK over the display name because **OWL and OBDC are both "Blue Owl Capital" and are two different companies** (1823945 against 1655888). The same measurement here, and two more reasons the name is worse:

- **Of the nine pairs on the live screen, TWO have different display names** — `FWONA + FWONK` and `LLYVA + LLYVK`, the Liberty Media tracking series this file already records as a near-miss for name matching. A name key misses them entirely.
- A name-plus-share-count key was measured and **gives the same answer as the CIK today**, but shares outstanding is a quarterly figure on a 7-day rotation: for about a week each quarter two classes can carry different counts, the fold silently stops, and the bug returns four times a year with nothing to say so.
- **A symbol with no CIK is NEVER folded** — an under-catch, the safe direction, and why the two dead renamed tickers (`SQ/XYZ`, `FI/FISV`, neither dead half carrying one) stay apart. That is a separate, already-reported problem: removing a ticker is the owner's call.

**`btOneEach` DROPS a class, which is right for a book you hold and wrong here**: these cards must still sum to the index, so this merges.

##### What it moves, measured against production (YTD)
| cut | rows | index | total value |
|---|---|---|---|
| S&P 500, all sectors | 500 → **497** | 14.22% → **14.49%** | $74.62T → **$70.43T** |
| **S&P 500, Communication Services** | 22 → **19** | **5.51% → 3.15% (−2.36pt)** | $11.60T → **$7.41T** |
| the whole screen | 1,239 → **1,230** | 14.05% → 14.47% | $93.58T → $88.24T |
| S&P 500, Financial Services | 70 → 70 | unchanged | unchanged — the control |

**$4.19T of phantom market value** on the index, and **36% of what the Communication Services card claimed that sector was worth**. The screenshot's own cut goes from `GOOGL 3.68pt · GOOG 3.28pt · META 1.84pt` to `GOOG 5.33pt · META 2.81pt · VZ 0.27pt`.

##### Shape
- **`foldListings` runs BEFORE anything is summed**, or the index itself still double-counts.
- **TWO OTHER CARDS HAD THE SAME DEFECT AND ARE FIXED WITH THEM, though neither was what was asked.** The **Flow** card carries its own copy of the begin-weight arithmetic, so Alphabet inflated Communication Services' share of the value *and* its cap-weighted return. The **Snapshot** card's computed fallback takes a cap-weighted MEAN rather than a sum, so the harm there is **double weight** rather than a double total — Alphabet from ~55% of its sector to ~71% — and it is **dormant** on an instance holding the eleven sector funds, which is the one we run. One module, one `ctx` field, one helper; a dormant wrong number in a function already being edited is not scope saved, it is the drift this module exists to prevent.
- **THE LINE DRAWN, since the fold could spread for ever**: a card in this module that **aggregates market value** folds. One that ranks or plots per company does not — the **histogram** would need a merged value for every one of its twelve measures, which is a larger and separate question, and on **Size** and **Bubble** a duplicate is two tiles or two dots rather than a wrong total. Everything OUTSIDE `cards.js` is reported and not touched: `/consolidated` cap-weighted, the pivot's Total market cap measure, and the group pages' composition bars all sum market value the same way.
- **THE LABEL IS THE ALPHABETICALLY FIRST CLASS THAT HAS A READING.** Largest cap is the obvious pick and is **not stable** — the caps are struck at different price vintages, so GOOG leads GOOGL on a day GOOGL is the higher-priced. A class with no reading is **consumed, not counted**, and does not get to name the bar: the ticker on the axis should be one whose own figures are drawn. Only the waterfall shows a ticker; a treemap tile carries the company name, which both classes already share.
- **`ctx.filers` is NOT a snapshot field and must not become one.** The boundary that keeps filings data off the screener is about the Advice engine and the selection logic; this is an identity handed to a renderer, used and discarded. `/api/stocks` is untouched and there is a check on the row keys. The precedent is `/backtest`, which already reads a CIK map it does not otherwise read, to dedupe.
- **`GET /api/filers` is member-only**, cached an hour, and **the phone is handed the map too** — it does not hold a post's controls and never calls that route, so without it a saved post is one bar in the studio and two on the phone, the drift `themeClass` and `basketDays` both exist to prevent. **Proved by reverting**: fails 3, and the phone's ticks come back `ALFA,ALFB`.

##### TWO FAULTS FOUND BY SCREENSHOT AND NONE BY ASSERTION
- **The note ran onto the tagline.** The fold adds a sentence and a card cannot scroll. The wording is half its first length — the WHY is the half a reader cannot guess, so that is what was kept — and **`WF_H` was re-measured, twice**: `600/392/1020` is now **`565/308/851`**. A **fixed chart height against a variable note** is the fault; the chart is the free parameter, and losing 8-17% of a plot is invisible where a note over the brand is not.
  - **THE FIT SWEEP'S FIXTURE DRAWS A SHORTER NOTE THAN PRODUCTION, so passing it is necessary and not sufficient.** At `346/934` the sweep reported no overflow and the **live portrait card still ran 15px over** — caught by measuring the deployed page, not by any suite. The heights come from a sweep over **production's own sectors** now (`wf-height.js`, 12 drills × 2 column counts × 3 artboards): the worst real cut is a 620-character note, and every artboard clears it by the 20px floor.
  - **I then compared the fixture's 392 against production's 346 and concluded the chart height was not the cause at all.** It was: two different datasets, so the numbers were never comparable, and the phantom nearly sent me looking for a `min-height` that does not exist. *Two overflow figures are only comparable if the card drew the same data.*
- **"The 1 biggest alone cover the whole net move."** The fold merges the two bars that used to lead this sector, so `need === 1` became common. The Flow card's "a industry that fell", in a second place.

##### NO FIXTURE PASSED A FILER MAP, SO NO SWEEP COULD SEE THE SENTENCE
That is why the overflow reached a screenshot, and it is the part worth keeping. `note-fit-test` now seeds **two symbols sharing a CIK** — the studio fetches `/api/filers` itself, so seeding `sec_state` is the whole change — and it immediately reported `waterfall/square +22px, waterfall/story +63px`. It names **every** overflowing combination now, rather than only the worst: one name is a lead, the list is the diagnosis.

- **`hist-seed.js` seeds the filer ids too**, for its own stated reason: like `price_extremes` and `fund_holdings` before it, nothing is stored on the row, so without it every future shot of these three cards draws the unfolded version and looks like the fix never landed.
- **`tmap-live.js` hardcoded `story: 1020`** and went stale the moment the heights were re-measured. It compares the deployed file against the working copy now, which is what that check was always for and cannot rot.

- Verified: **31 checks** off-page (the module is pure, so the whole mechanism is reachable through `Cards.build` and a regex), **12** on the server and the phone, and **8** on the roles. The fixture's load-bearing properties are that the two classes carry **different returns ten points apart** — so a merge that picked one rather than averaging lands on 20.0% or 10.0% and the suite can say which — and that the folded and unfolded indexes differ by 3.4 points. **Proved by reverting ten times, every one load-bearing**: the fold never running fails 10, a display-name key 14, **summing rather than averaging 3 (and the index comes back at exactly the unfolded number)**, the flow card not folding 3, the label by largest cap 2, a no-reading class naming the bar 2, the note dropped 5, the phone not handed the map 3, the route serving nothing 3, and the accessor emptied 6.
  - **Four of my own assertions were wrong before the code was.** The total bar is `class="wf-v tot"`, so a regex demanding exactly `class="wf-v"` read the last STEP as the index and reported three failures against a working card. And "two pairs, so two fewer rows" was wrong: `CNUL` has no reading, so it never counted unfolded either — the expectation is derived from the filer map now.
  - **A fixture trap worth keeping**: `OBLU` and `CVAL` were correctly pooled into REST, so two checks about where they appear were asking about names the card had every right not to draw. They are large enough to rank now.
  - **The session cookie is `sp_session`**, read off server.js rather than guessed — a wrong name makes four role checks fail over a server that is working.
  - **A `cat` heredoc refused to close** on the suite and wrote no file; written with the Write tool instead. The ninth instance on this project.

#### AND THEN THE DUPLICATES WERE DELETED, SO THE FOLD IS NOW INERT (2026-10-07, owner: "I think I should delete all duplicates, Keep what is most relevant")
**Ten symbols removed from the universe, 1,284 → 1,274, and there is no longer a single CIK shared by two tracked symbols.** The fold above still runs on every card and can never fire.

| dropped | kept | $vol/day |
|---|---|---|
| GOOG (Class C) | **GOOGL** | 4.31 vs **6.38B** |
| BRK.A | **BRK.B** | 0.09 vs **1.64B** |
| FOX (Class B) | **FOXA** | 0.04 vs **0.29B** |
| HEI.A | **HEI** | 0.05 vs **0.13B** |
| LBTYK (Class C) | **LBTYA** | 0.02 vs **0.04B** |
| LLYVA (Series A) | **LLYVK** | 0.02 vs **0.03B** |
| FWONA | **FWONK** | 0.02 vs **0.17B** |
| NWS (Class B) | **NWSA** | 0.03 vs **0.10B** |
| ZG (Class A) | **Z** | 0.03 vs **0.07B** |
| SQ | **XYZ** | the renamed ticker, below |

- **ONE RULE: keep the class the market actually TRADES**, never the higher reported cap — neither class's cap is its own value, which is the whole point of the section above. Where the index names a single class (Berkshire: **BRK.B only**) it agreed, which is the independent check. Note it does **not** follow the share-class letter: Zillow keeps the Class C and Liberty Live the Series C, because those are the liquid ones.
- **THE FOLD IS KEPT, AND THAT IS THE `CHAT_DAILY_LIMIT_MEMBER` RULE — keep what one guard flips back on.** `foldListings` is dead code on today's universe and is the only thing standing between a doubled sector total and the day a dual-class company enters, or a class is added back. Deleting it would make the next Alphabet a silent $4.2T phantom. Its 31 checks still pass, on a fixture rather than on production.
- **THE OWNER OVERRODE MY RECOMMENDATION KNOWINGLY, and their reading is the better one.** I argued for removing only the six the index does not hold, because the S&P holds **both** classes of Alphabet (3.036% + 2.440%), Fox and News, so dropping one loses 2.456% of index weight and makes `/holdings` report three permanently missing members. The owner's answer: *"I don't care about the index weighting ... The S&P is a field that helps me in filtering the stocks."* **`spMember` is a BOOLEAN, and GOOGL is still a member** — the filter is unaffected, and I had weighted a reconciliation page above the thing the field is actually for.
- **A THEME MEMBERSHIP MUST BE MOVED BEFORE THE REMOVAL, NOT AFTER.** `removeFromUniverse` deletes the universe row **and every membership in one batch**, so a theme silently loses the company. Two of the ten were in a theme and nothing else was: `HEI.A` in **Space** and `SQ` in **Digital Payments & Fintech Platforms**. The twin went in first (`POST /api/portfolios/:name/tickers`), so `Space` holds HEI and the payments theme holds XYZ. No member list and no alert touched any of the ten.
- **`POST /api/universe/bulk-delete` is the right tool and `DELETE /api/tickers/:symbol` is not** — the bulk route is **dry run by default** and its preview names each company, its themes and the fundamentals days it would lose, which is the guard against the documented hazard that free text splits into symbol-shaped tokens. The preview is what confirmed all nine share classes by their stored names (`Alphabet Inc. Class C`, `Fox Corporation Class B`, …) rather than by the ticker's letter.
- **Cost: 116 `fundamentals_history` days, irrecoverable**, and 43,631 rows purged across the 17 symbol tables. Everything else returns — bars at 1 credit a symbol.
- Verified: **8 checks** read off the database rather than off any route's 200 — the universe count, all ten out, all ten keeps in, **no rows left in any of the 17 symbol tables**, both theme moves, no stranded theme member, and no CIK shared by two tracked symbols.

##### IDENTICAL SHARES **AND** FLOAT IS A SECOND KEY, AND IT SCORED 9 OF 9 WITH NO FALSE POSITIVES
Worth recording because it needs no SEC data at all, which matters for the **26 symbols with no CIK stored**. The provider repeats every company-level figure against each class, so the pair is identifiable from the snapshot alone — measured, it found **exactly the nine CIK pairs and nothing else**. The caveat is the one the `peerPe` rotation already records: shares outstanding is a quarterly figure on a 7-day rotation, so for about a week each quarter two classes can carry different counts and the match silently stops. **The CIK is still the shipped key**; this is the fallback, and the agreement between two independent keys is why the nine were safe to delete.

##### A CORRECTION: A SHORT-INTEREST CLOCK IS NOT A PRICE CLOCK
I reported `SQ` and `FI` as *"dead renamed tickers — SQ's prices stopped 2026-09-28, FI's on 2025-10-31"*. **Both dates are `short_state.newest`**, from this file's own note that *"two symbols lag for ever for real reasons"* — a FINRA reporting clock, which stops when a ticker is renamed. **All four of SQ/XYZ and FI/FISV were priced to 2026-10-06.** SQ was still the right one to drop, on evidence that had nothing to do with the claim I made: no CIK, no `sec_facts`, absent from the index file, and a newest bar a session behind XYZ's.

##### `FI` / `FISV` IS LEFT ALONE, because "most relevant" has two defensible answers
| | index weight | CIK | sec_facts | theme | price |
|---|---|---|---|---|---|
| **FISV** | **0.036%** | **798354** | **322** | none | 45.48 |
| **FI** | — | none | 0 | Digital Payments | 45.47 |

Every field in the database says keep **FISV** — the issuer's own holdings file names it and it carries the filer id — while **FI is almost certainly the live ticker**. Keeping FI loses the CIK, which takes the SEC EDGAR card, the insider card and the fold with it; keeping FISV risks being left holding the dead one. **This is the `/stock` Micron lesson applied to a ticker** — *check the data before trusting a memory of what a company's symbol should be* — and with the evidence split the decision is the owner's rather than a guess.

##### `PSKY` → `SKYD` IS A LIVE RENAME, NOT A DUPLICATE, and the holdings import is what caught it
The SPY file swapped them **overnight, between 2026-10-05 and 2026-10-06, into the same 0.008% slot** — `added: SKYD, removed: PSKY`, nothing else changed. We hold `PSKY` (priced, CIK 2041610, 21 `sec_facts`); `SKYD` has **no bars, no name and no row anywhere**. So the operation is an ADD — through `POST /api/universe/check` first, since the gate is what confirms Twelve Data serves it — and then a removal of PSKY once SKYD is priced. **Not acted on**; removing or adding a ticker is the owner's call.

- **It also means `/holdings` now reports FOUR missing index members, not three**: GOOG, FOX and NWS by choice, plus SKYD by the rename, at **2.464%** of index weight. The suppression list that would stop the nagging is still not built.

##### AND `single-closes.json` WAS ALREADY STALE BY TWO BEFORE TODAY
The documented sequence after any ticker removal — `analysis-db.js --full`, then `single-data.js`, `strategy-runs.js`, `lab-grid.js` — was run, and the check worth keeping is **which derived file actually carried the dead tickers**: `single-closes.json` held nine of today's ten **plus `SOLS` and `SKF` from removals on 2026-09-28**, so `/single` had been listing two delisted names for over a week with nothing saying so. `lab-grid.json` and all fifteen `strategy-u-*.json` name none of them — they hold curves and parameter grids rather than per-symbol closes — but their RESULTS include whatever was in the universe when they were built, so they are rebuilt too. **Grep the derived files for the removed symbols rather than assuming which are affected**; only one of the three was, and it was the one nobody had noticed.

##### THE REBUILD FOUND TWO OF THE THREE BUILDERS BROKEN, AND ONE HAD BEEN FOR NINE DAYS
`single-data.js` ran clean (**78.2s**, 1,274 symbols, 33.44 MB raw / 8,771 KB gzipped). The other two did not, and **neither failure had anything to do with the removal** — the rebuild is simply the only thing that runs them.

- **`strategy-runs.js` threw `no such table: portfolio_tickers` AT MODULE LOAD, and had done since 2026-09-28.** The tables are `themes` / `theme_tickers`; that read still used the pre-rename names, and **it only ever worked because the local copy carried the old pair as RESIDUE** — `analysis-db.js --full` drops only the tables it syncs, so a rename leaves the old names sitting beside the new ones. They were dropped on 2026-09-28, and this script has been dead ever since **with nothing noticing, because it is only ever run after a ticker removal**. The column is `theme`, not `portfolio`. One line, and the fix immediately found **27 universes against the 15 files on disk** — twelve themes had been invisible to `/strategy` for nine days.
  - **The lesson is about the residue, not the rename.** Dropping a stale table from the local copy is right, and it **re-armed a nine-day-old latent break in a script nobody runs weekly**. After removing residue from the analysis copy, run every builder that reads it rather than only the one you came for.
- **`lab-grid.js` HAS OUTGROWN THIS MACHINE AND `lab-grid.json` IS THEREFORE STALE — the one part of the rebuild that was NOT completed.** It loads the whole archive, which has gone **1.85M bars (when it was last built) → 4.65M**, and on the default heap it dies at `Ineffective mark-compacts near heap limit` after 17s. `--max-old-space-size=4096` gets it past the load (4,646,238 bars, 1,274 symbols, 14.6s) and then **thrashes**: this box has **7.8 GB**, so a 4 GB heap leaves 0.7 GB free, and it managed **~2 of its 920 parameter sets a minute — about seven hours**, against the 28.1s recorded for the smaller archive. Abandoned deliberately rather than left running: the same laptop drives the intraday schedule and the nightly, and seven hours at 0.7 GB free is a cost nobody asked for.
  - **What the staleness actually costs is small, which is why abandoning it was the right trade.** The file holds **cross-sectional parameter grids, not per-symbol data** — none of the removed symbols appears in it by name — so the error is that its t-statistics were computed over a universe carrying nine duplicate share classes and two delisted names. The effect on a cross-sectional t over ~1,280 symbols is marginal, and `/lab` already says on its own face that nothing on the grid clears a bar worth trading.
  - **The durable fix is in the script, not in the flag**: it must stream the archive rather than hold it. Until then the build is an overnight job, and the flag is mandatory — **`node --max-old-space-size=4096 lab-grid.js`**, which the documented command (`node lab-grid.js`) no longer covers.
- **NINE STALE `strategy-u-*.json` FILES, 8.1 MB, tracked in git.** The script writes one file per universe and never cleans up, so every theme the owner deletes leaves its runs behind for ever: `chips energy faded fin hardware industrials software utility watchlist` — the industry-style lists dropped once Sector and Industry covered them. `strategy-index.json` does not name them, so `/strategy` cannot reach one; they are dead weight rather than a fault. Removed with the rebuild.

###### AND `| tail` HID BOTH FAILURES BEHIND `exit 0` — THE DOCUMENTED TRAP, MET FROM THE SAME SIDE AS LAST TIME
The three builders were chained with `&&` and each piped through `tail`, so **the chain's exit status was `tail`'s**: it printed `ALL THREE DONE` and exited 0 over two crashes, and `&&` never short-circuited because nothing had failed as far as the shell could see. This file already records the inverse (`shortint-load.js` succeeded and exited 1 through the same pipe). **The rule that covers both: judge a build by the artefact it wrote, never by how it exited** — the stale `Sep 28` timestamps on two of the three output files are what actually gave it away, after a reported success.


### Where the shorts moved — the fortnight's builds and covers (2026-10-06, owner's request)
**A twenty-second template, `shortmoves`, and the first card fed by the FINRA archive rather than the snapshot.** Every other short-interest surface in this app is a LEVEL — the Ownership column, `/stock`'s card and strip, the two histogram measures — and this is the CHANGE, which is the half that is news.

#### THE TWO RANKINGS SHARE NO NAMES, which is why both are offered
Measured over the live fortnight (2026-08-31 → 2026-09-15, 1,190 usable pairs), ranked by percent against ranked by dollars:

| | biggest builds |
|---|---|
| by percent, raw | LYG +121% · BURL +58% · MDA +54% · DRAM +51% |
| by dollars, raw | SPY $13.7B · IWM $5.1B · GOOGL $3.4B · META $1.6B |
| **by percent, as the card draws it** | BURL +58% · DRAM +51% · JHX +48% · SARO +45% |
| **by dollars, as the card draws it** | GOOGL +$3.4B · META +$1.6B · CRWD +$997M · ORCL +$905M |

**Zero names in common, and it holds AFTER the floor and the fund exclusion as well as before them** — which is the Value added column's lesson in a second place: a percentage says which position moved furthest, it cannot say where the money went. `smovMetric` offers both and the subtitle names which is on screen.

- **THE STUDIO'S HINT NAMES NO COMPANY, deliberately.** Its first draft named that fortnight's leaders — a claim with a two-week shelf life sitting in static markup, which is the "a claim has to leave with the feature" failure this file already records four times over. It states the measurement instead, which stays true. *(It was also wrong: it credited the dollar ranking to two companies that are nowhere near its top eight.)*

- **THE FLOOR IS ON THE POSITION, NOT ON THE MOVE, and one control serves both metrics.** A percentage change in a tiny position is enormous and says nothing; the **dollar ranking is self-flooring** — measured, its top and bottom eight all sit above $4.3B — and the percentage one is not. Default $250M, which keeps 1,072 of 1,188.
- **The index and sector funds come out**, the rule every market card here keeps, and it matters most on this one: unfiltered, the dollar ranking is led by **SPY at $13.7B and IWM at $5.1B**, which is a statement about hedging the whole market rather than about a company, and it crowds out every real name.

#### ONE WINDOW FOR EVERYBODY, never a pair per symbol
Two dead tickers still sit on 2025 settlement dates — `SQ` and `FI`, the renames this file already records — so letting each symbol use its own most recent pair compares a fortnight against a year and prints both on one card. The newest date across the screen is the window and a symbol not on it is left out: **1,190 of 1,192 are**, so the cost is exactly the two that should be. **A SPLIT IS SKIPPED** for the reason the `/stock` strip already records: FINRA does not restate, NVDA's 10:1 reads +978% in its own change field, and a share count either side of a split is two different units. 2 of 1,190 this fortnight.

#### BLUE AND ORANGE, NEVER GREEN AND RED — and the precedent is this very dataset
`/stock`'s short-interest strip is neutral because *"short interest rose is not a direction the price went"*. On a card, green would be asserting that being shorted is bad — a verdict, and only half true, since a build is a bearish bet **and** the fuel for a squeeze. The pair is the one the two-stock Chart card measured as the only divergence surviving both common dichromacies (ΔE **102** at its worst against the accent pair's **3**), and neither hue carries a meaning on this surface. **Emitted inline through `pal.ink`** rather than set in CSS, which is what makes all four grounds resolve with no override block.

#### Shape and cost
- **`readShortRecentFor` already existed** and is one bounded indexed seek per symbol, batched — **1,192 symbols in 0.7s** measured, never a `group by` over the 217,000-row table, which on this database is a quota event rather than a slow query.
- **The payload is two share counts per symbol and nothing else** (~36KB): the card joins to the snapshot it already holds for the name, the price, the sector and the S&P flag, so every cut and both metrics are the card's own work. Cached ten minutes.
- **`getShortMoves` is the fourth `ctx` channel**, and `shortMovesNeed(tpl)` is asked of the module by BOTH hosts — the reason `basketDays` and `evolutionNeed` exist, and how the spotlight once shipped drawing nothing at all. The phone loads it only when the template asks.
- **A SEVENTEENTH hardcoded listener list** in promo.html. A control in the markup and in `CONTROL_IDS` but not in one of these saves with a post, is read by the builder, and **does nothing when you touch it**. Control ids **112 against `POST_OPT_MAX` 200**.

#### THE CAPS ARE MEASURED COUNT BY COUNT, one row inside each artboard's limit
A card cannot scroll. Measured: the portrait fits 9 and leaves **9px**, which is under the 20px floor this module holds everywhere; the square fits exactly **6** (a seventh row costs 59px against 51 left); the story fits 11 and is 4px over at 12. So **8 / 6 / 10**. The control still offers up to 12 and the cap trims — honest, because these are the top N of a ranking, where dropping the seventh and eighth biggest is not the misstatement a dropped treemap tile would be.

- **THE STORY SPREADS ITS ROWS, and only the story.** Measured against the siblings, the band above the note is **77px on the portrait and 51 on the square** — in line with the waterfall's 62 and the treemap's 63 — and **354px on the story**, a fifth of the frame. That is the Movers card's own fault, recorded there as rows reading as lines floating in a frame, and spreading is the fix it already settled on. The row margin stays as a **floor** so a short list does not fly apart — the Flow card's gap bargain, measured at 53px of spread at eight rows and back to the 18px floor at twelve.

- Verified: **52 checks**. The fixture's load-bearing property is that **the two rankings disagree** — `TINY` is a small position that doubled (huge percent, small dollars) and `GIANT` a vast one that moved 3% (small percent, huge dollars) — so a card wired to the wrong metric comes out with different names rather than coincidentally the same ones. Plus one of each thing that must not appear: a fund with **the biggest dollar move of all**, a split, a symbol stranded on an older settlement, and a position under the floor. **Proved by reverting fourteen times** across all three files.
  - **A GUARD NO FIXTURE CAN REACH IS A GUARD UNPROVEN.** With six builds the per-artboard cap could never fire and the three fit checks passed over a card it had not touched. Sixteen filler rows later they read 8 / 6 / 10 — the configured caps, visibly biting.
  - **`spMember` IS A READ-PATH STAMP, not a stored field**, so an off-page build over the fixture rows filters to nothing on either cut. The cut has to be driven over the SERVED rows — the same trap that makes a `'SPY'`-cased holdings seed stamp null on everything.
  - **THE FLOOR CHECK RAN WITH THE CUT STILL ON `out`**, where the small position is not a member — so dropping the floor correctly changed nothing and the suite blamed the control.
  - **`find(x => x.tpl === 'shortmoves')` RETURNED THE PHONE FIXTURE'S OWN POST**, written three assertions earlier with three opts, and reported the page's save as dropping a control it had never been asked for. Match on the name the save used.
  - **`const N` WAS DECLARED WITH THE TYPE SIZES, which are read AFTER the slicing** — a temporal dead zone, and the page threw `Cannot access 'N' before initialization` on every render. Caught by the shot harness, not by a suite.
  - **A MULTI-LINE ANCHOR MATCHED NOTHING, twice.** `cards.js` is CRLF on disk, so an anchor carrying a `\n` is silently skipped — and the Edit tool refused the same block for the same reason. Single-line anchors only, which is what this file has said since the first time.
  - **The shot seeder needed the short-interest table**, the same class of trap as `price_extremes` and the filer ids before it: nothing is stored on the row, so without it the card sits on its placeholder and reads as a fetch that never landed. Its read is bounded to **one** scan — `short_interest` has no index on `d` alone, so any date bound reads all 217k rows whatever it returns, and nested `max()` subqueries would do that more than once.
  - **`note-fit-test` SKIPPED IT IN SILENCE, which is the Flow lesson in the same harness a second time.** With no short-interest rows seeded the card draws its placeholder rather than a note, so it simply fell out of the list and the sweep reported `12 of 12 grew` over a template it had never measured. Two settlement dates per symbol, a build and a cover, and a position over the floor took it to **13 of 13**. *A sweep that accounts for "every template" has to be read for who is MISSING from its list, not only for its failures.*
  - **`size-scope-test` CORRECTLY FAILED, and that is the check working rather than going stale.** It accounts for every template as either scoped or unscoped, and this one is unscoped — its only cut is S&P membership, which is not a scope — so it joins `flow`, `treemap` and `waterfall` in `NO_SCOPE`. **Corrected, not worked around.**
  - **`fold-server-test` carried a PRE-EXISTING stale assertion**, found while regressing this and proved against HEAD rather than assumed: it looked for *"more than one share class"*, a draft wording that never shipped, where the module has said *"Share classes are combined:"* since the fold landed. `foldNote` is byte-identical to HEAD, so this had been failing from the day it was written. Corrected to the real phrase.
- Verified across the module: the ground sweep at **265 checks over 188 ground × template × mode combinations**, the width sweep at **127 over 141**, note fit at **63 artboard combinations**, and `size-scope` accounting for all 21 templates — all clean with the template registered.


### Most shorted — the level as last reported, beside the year so far (2026-10-06, owner's request)
**A twenty-third template, `shorted`, immediately after Short moves in the picker: the companies carrying the heaviest short interest right now, each with what it has done this year.** Asked for as *"a new card showing stocks with High Short interest as of now … it will be good to show how these stocks have performed YTD"*, with the usual S&P and sector cuts.

#### IT IS THE SIBLING OF `shortmoves` AND DELIBERATELY NOT A MODE OF IT
That card is the fortnight's **change**; this is the **level**. Two questions, and the measurement says so twice over — ranked by % of float the S&P's top eight are `SWKS NCLH ECHO SMCI KMB PSKY LYV IT`, and by days to cover `TROW SNA LNT LYV TPL KMB UNP IFF`: **two names of eight in common**. Neither ranking stands for the other, which is why the metric is a control rather than a decision taken once in the builder.

- **THE FUNDAMENTALS CARD ALREADY RANKED BY SHORT INTEREST, and that is what this had to beat rather than duplicate.** `FUND_METRICS` has carried `shrt` all along, so "Biggest short interest" was already a ranked bar list. What it could not do is put the year beside it — and the year is the whole reason the owner asked.

#### WHY THE YEAR EARNS ITS PLACE, measured before it was built
A reference column whose two halves coincided would say nothing, so it was measured first:

| | median YTD, the eight most shorted | median YTD, the whole cut |
|---|---|---|
| **in the S&P 500** | **−6.1%** | +3.9% |
| the top twenty, S&P | −12.3% | +3.9% |
| **the whole screen** | **−39.9%** | +2.1% |

*(Every figure here moves with the market, and this project refreshes prices through the session. The same two cut medians rendered from the card an hour later read **+4.0%** and **+2.9%** — the second 0.8pt away from the probe's +2.1%, which is an intraday refresh rather than a disagreement. Quote one run; do not reconcile two.)*

A 10- to 42-point gap. **And it is NOT one-directional, which is the half worth seeing**: three of those eight are UP — SWKS **+30.0%** and SMCI **+48.3%**. Heavily shorted and falling is the shorts being right so far; heavily shorted and **rising** is them under water. The card draws both, counts the split in the strip, and forecasts neither — the line `/terms` draws, and the one this dataset makes easiest to cross.

##### AND THE TWO METRICS POINT IN OPPOSITE DIRECTIONS, which is the strongest argument for offering both
Rendered against the live screen, the S&P cut:

| ranked by | median year, the eight | against the cut | up / down |
|---|---|---|---|
| **% of float** | **−6.1%** | +4.0% | 3 / 5 |
| **days to cover** | **+13.0%** | +4.0% | **7 / 1** |

Days to cover selects `TROW SNA LNT LYV TPL KMB UNP IFF` — low-volume, stable names where the exit is crowded because the **volume is thin**, not because anyone is bearish. So it is not a weaker version of the same reading; it is a different one, and on this window it points the other way. A card offering only the first would have reported half of this. *(Narrowed to S&P Technology the first metric reads −1.1% against a cut of +27.6% — a 28.7-point gap, the widest of the four cuts tried.)*

#### ZERO AT THE CENTRE OF THE YEAR'S TRACK, which is what makes that split legible
A fall grows left and a rise grows right. Growing both from the left in two colours would draw a 30% fall and a 30% rise as **the same picture**, with only the hue to tell them apart — `/compare`'s own rule wherever a value can be negative. **Proved by reverting**: anchoring the fill at 0 fails the centring check.

- **TWO BARS, TWO SCALES, AND THE CARD SAYS SO IN TWO PLACES** — a column head over each, and a clause in the note. They are not comparable with one another and that is the one thing a reader could otherwise get wrong. **Proved by reverting**: dropping the clause fails 1.
- **ONLY THE YEAR TAKES COLOUR.** Green and red mean up and down on every surface here and a return is exactly that, so those sit in CSS as tokens and resolve on all four grounds by themselves. The LEVEL takes none: short interest is one sign throughout, and *a bar negative nowhere says nothing by being red* — the histogram's own rule, and `/stock`'s short-interest strip before it. That also means the card has exactly one coloured dimension and it is the one where colour means something.

#### A NULL IS NOT A ZERO, and on this field it is the load-bearing guard
The read path **nulls** a reading above `SHORT_PCT_MAX`, which is how Berkshire's 966% of float leaves the screen. Coerced, every unread company would sort to the bottom of the ranking instead of out of it — **and the one bad row would sort to the top**. The test is `v > 0`, which rejects null, zero and NaN in one expression.

- **The fixture carries Berkshire's shape exactly**: a nulled float beside a real vendor ratio, so the two metrics must **disagree** about whether it is rankable — out of the % ranking, in the days-to-cover one. **Proved by reverting**: keeping a missing reading fails 2.

#### THE FUND EXCLUSION CANNOT BITE ON PRODUCTION TODAY, AND IS STILL PROVED
Benchmarks and the eleven sector funds come out, the rule every market card here keeps. **Measured rather than assumed: 0 of the 24 funds on the screen carry EITHER reading** — the vendor reports no float and no short ratio for a fund — so on today's data the guard removes nothing.

**That is exactly why the fixture gives SPY and XLK the biggest readings of all**, so nothing but the explicit exclusion keeps them off the card: *a guard no fixture can reach is a guard unproven*. **Proved by reverting**: it fails 5 and the ranking comes back `SPY,XLK,HIPCT,…` — the index-in-its-own-market error, which is also why it stays. One upstream change (a float published for SPY) would make it the most-shorted thing on the screen by a distance.

#### NO DATA CHANNEL, NO SERVER CHANGE, NO PHONE CHANGE
Every field it reads — `shortPctFloat`, `shortRatio`, `ytdPct` — is already on the snapshot row, so unlike `shortmoves` there is no `*Need` function, no route, no fetch and nothing to wire on the phone. `/api/m/post` already passes `stocks`, `screens` and `myLists`, and already applies `stampCapDerived` (which carries the ceiling) and `stampSpMember`. Asserted rather than assumed — the stamps are a set and the set has been incomplete twice — by building a saved post through the phone's own route.

#### THE CAPS ARE MEASURED COUNT BY COUNT, with the note at its LONGEST
A card cannot scroll, and a row here is two lines (a text line and a pair of bars), so it is taller than a short-moves row. **My first guess for the square was 5 and the measurement said 6** — one name more on the tightest artboard.

| | fits | headroom | the next count up |
|---|---|---|---|
| portrait | **8** | 75px | 10 runs 26px over |
| square | **6** | 42px | 8 runs 66px over |
| story | **10** | 50px | 12 runs 46px over |

- **The worst case is a card whose note has grown its extra sentence**, which happens when a row in the top N has no year of its own. The first measurement missed it and read 42px of headroom on the square as comfortable; with the sentence present it is still 42, but that was luck rather than a measurement until the fixture forced it.
- **`SHRT_CAP` is a named const rather than an inline literal**, and not for tidiness: the inline map would be **byte-identical to `tplShortMoves`'**, so any revert anchored on it hits twice and is refused — which reads as a broken harness rather than as the one guard it is.

#### Worth knowing
- **"AS OF NOW" IS A FORTNIGHT AGO, AND THE CARD SAYS SO RATHER THAN IMPLYING CURRENCY.** The figure is the vendor's, which this project measured as FINRA's own to 0.00pt — published twice a month and reaching us about eight business days after it settles. **Our copy adds a second lag nobody should have to work out**: `shortPctFloat` rides the profile, which rotates on `FUND_ROTATION_DAYS` (7), so on a given day a row can still be carrying the previous settlement. That is inside the fortnightly cadence the note already describes, which is why the note states the cadence rather than a date — the `shortmoves` card can name its settlement exactly because it reads the FINRA archive, and this one cannot, because it reads the profile.
- **It IS scoped where its sibling is not**, and the difference is real rather than an inconsistency: *the most shorted in Technology* is a question about a slice of the screen, where *where did the shorts move* is a reading of the whole of it. So it goes through `scopeOf` and gets sector, industry, size, screen and S&P for free — and joins `INDUSTRY_PREFIXES` and `size-scope-test`'s scoped list.
- **A SCOPED TEMPLATE HAS TO JOIN SIX LISTS, NOT TWO** — its own listener list and `CONTROL_IDS` are the two this project documents, and the four that FILL the pickers (sector, size, screen, S&P) plus the scope-options copy are the ones a control can be silently missing from: present, saved with a post, read by the builder, and carrying nothing but its placeholder. **Proved by reverting three of them separately.**
- **No size FLOOR control, deliberately.** Both metrics are ratios rather than amounts, so neither is size-biased the way a dollar change is — which is exactly why `shortmoves` needs one and this does not — and the Size picker already cuts by company size.
- **The fourth stat is the OTHER metric**, so the strip always adds the reading the rows are not ranked by. Symmetric, and justified by the same evidence that makes the metric a control.
- Control ids **136 against `POST_OPT_MAX` 200**, counted rather than assumed.
- **NO BOUNDARY CHECK AND NO ROLE WALK, which is a decision rather than an omission.** The standing rule is that new data may feed a display surface and never the live Advice calculation — and this card introduces **no field at all**. It reads `shortPctFloat`, `shortRatio` and `ytdPct`, every one already on the row and already served to every member by `/api/stocks`, so there is nothing new for a verdict to read and nothing new exposed. The three-way scoring proof the `instrumentType`, S&P and Live P/E columns each had to give does not apply, and asserting it here would be theatre. *(`shortPctFloat` IS an Advice input — [action.js:360](private/action.js#L360) — and is untouched.)*
- Verified: **52 checks**. The fixture's load-bearing properties are that the two metrics rank differently, the YTD set spans zero, the group median (**−8.0%**) and the cut median (**+6.5%**) genuinely differ, Berkshire's shape is present, and the S&P cut crosses the sectors — so a card wired to the wrong field, the wrong pool or the wrong state comes out at a different answer rather than coincidentally the right one. Plus the ground sweep (**277 checks over 196 combinations**) and the width sweep (**133 over 147**) with **both metrics** swept, note fit (**14 of 14 notes grew**, up from 13), and `size-scope` accounting for all 23 templates. **Proved by reverting fifteen times.**
  Every one bites: the template unregistered fails 36, `CONTROL_IDS` 8, the metric control ignored 6, the funds left in the pool 6, no listener 5, the metric picker hardcoded 4, the S&P fill list 4, the cap 3, and the centred zero, the reference median, the null guard, the clip, the sector fill and the size fill 2 each, with the two-scales clause at 1.
  - **TWO OF THOSE REVERTS FIRST REPORTED 0 AND BOTH WERE THE TEST**, which is what the harness is for.
  - **THE CLIP CHECK WAS VACUOUS FOR TWO REASONS AT ONCE, and the second is a trap for every card measurement here.** `getClientRects().length` cannot see a wrap inside a **blockified** element, and every child of this grid row is blockified — it returns one border box however the text flows. Worse: **`getBoundingClientRect()` is POST-TRANSFORM while `scrollWidth`/`clientWidth` are CSS pixels**, and the studio scales the 1080px artboard to the window — so `scroll > w` was comparing **691 CSS px against 487 screen px** and passed in *both* states for an entirely spurious reason. Stay in one unit system. **And the fixture's 66-character name FIT the 691px track**, so the rule was inert anyway: the check now uses the live universe's longest name at **99 characters** and asserts the row is no taller than its neighbours, which is the harm the rule exists to prevent.
  - **THE NULL GUARD WAS UNREACHABLE AT THE DEFAULT COUNT.** With fourteen companies and a count of eight, a null coerced to zero sorts to the **bottom** and never reaches the card — so the guard is real and the fixture could not see it. It is checked on a **Technology** cut, which holds five readings and one null, where the reverted card draws a sixth row whose level is an em-dash. *A guard no fixture can reach is a guard unproven*, met twice in one change.
  - **`size-scope-test` CORRECTLY FAILED and was corrected, not worked around.** It accounts for every template as either scoped or unscoped and named `shorted` the moment it existed — the check doing its job rather than going stale.
  - **A `cat` heredoc refused to close on the builder and wrote no file at all** — the documented escape hazard, met for the tenth time on this project. Written with the Write tool instead. The **Write tool then resolved `—` into a real em-dash**, so a later patch anchored on the escape matched nothing: anchor on an escape-free line.
  - **A value the select does not carry leaves it UNCHANGED**, so the fit sweep's first run measured `3` and silently re-reported the previous count's numbers. `shrtCount` offers 5/6/8/10/12 and nothing else; the sweep walks those.
  - **RENAMING A SELECTOR IN THE CSSOM DOES NOT RE-LAY-OUT**, so a diagnostic that does it reads stale geometry and "proves" a rule inert. Inject a stylesheet, or patch the file and reload.

### Beating the index — a square per company, in three colours (2026-10-08, owner's request)
**A twenty-ninth template, `beat`, the third view under Market.** Asked as *"how many stocks have beaten the S&P in a given period, do we show this somewhere in promo"* — nothing did — then *"add it … use some colorful graphics"*. Measured first: about a third of the index's own members beat it over any window from a month to five years (34% this year, while 58% of them ROSE), which is the Narrow-or-broad finding read off returns.

- **The picture is a waffle grid**: one square per company, sorted into three runs, plus a stacked bar for every window (1 week to 1 year) with the chosen one marked, the share that beat the index and the index's own return beside each.
- **THE INDEX IS SPY'S OWN RETURN** off the same row fields as every stock's, so both sides are price-only. Deliberately not the cap-weighted aggregate of the companies drawn: "beat the S&P 500" is a claim about a published number.
- **GREEN ALWAYS MEANS ROSE *AND* AHEAD.** Index up: beat it / rose by less / fell. Index down: rose / fell by less / fell further. A stock that lost money is never green for losing less (the Flow card's rule). The headline "beat it" is strictly `return > index`, so in a falling window it is green plus the middle state; an equal return is not a beat.
- **A stock with no return for the window is absent, never zero**, and counted in the note. Funds are out (benchmarks, sector funds, and `instrumentType === 'ETF'`).
- **Past `BEAT_CELLS` (520) companies a square stands for several**, allotted by largest remainder so the squares add up; a state with any company in it is never drawn as nothing; the note says how many a square is.
- **Columns per artboard are measured** (`BEAT_COLS` 46 / 54 / 40): the story's first cut ran 350px over at 26 columns. The square drops the four-figure strip.
- **No five-year window**: `MOV_PERIODS` has none, and a five-year count is survivorship-flattered. The note says the longer windows flatter the count anyway.
- Controls `beatPeriod`, `beatSp500` (default this year, inside the index), both filled from the module (`Cards.beatPeriods()`, `Cards.spCuts()`); its own listener list; no scope pickers, so it is in `size-scope-test`'s `NO_SCOPE`. Every colour is a token, so all four grounds resolve with no override.
- **It adds no field**, so nothing new reaches the Advice engine.
- Verified: **26 checks** (`beat-test.js`, pure, every count planted and the two windows of opposite sign), a 63-combination fit sweep on production's rows (least free height 22px), text contrast on all four grounds (worst 5.02:1). **Proved by reverting eight times, every one load-bearing.**
  - **THE SHARED GROUND AND WIDTH SWEEPS CANNOT SEE THIS CARD**: their fixture's SPY row carries no `ytdPct`, so they sweep the empty state. The card's own shot and contrast scripts measure it on real rows.
  - **The S&P cut's "everything" value is `'All'`, capital A.** A lower-case `all` falls back to the index cut in silence, and the first sweep reported the whole screen as 499 companies.
  - **The small-state guard first reverted to nothing**: two companies in 1,300 already win a square by largest remainder. One in 1,300 does not, and is the fixture now.

#### The Nasdaq 100 as a second benchmark (2026-10-08, owner's request)
**The benchmark half only; membership is [docs/backlog.md](docs/backlog.md) entry 31.** QQQ is already tracked for its price, so this cost no data.

- **`beatBench` on the Beating the index card**: S&P 500 (SPY) or Nasdaq 100 (QQQ), from `Cards.beatBenches()`. The subtitle, the kicker, the note and every strip row follow it; an unknown value falls back to the S&P. **The S&P cut beside it is still about S&P MEMBERSHIP**, so "S&P members against the Nasdaq 100" is a combination the card draws and names in full.
- **`PAGE_BENCHMARKS` is SPY, QQQ, DIA**, so every group page draws a Nasdaq 100 line and a returns row. Orange (`#fb923c`), between the accent and the violet: the pair the two-stock chart measured as surviving both common colour-blindness types. "Difference vs" is still against the first, the S&P.
- QQQ was already in `BENCHMARKS`, so it was already undeletable and already out of every market card's pool.
- Verified: `beat-test.js` is 31 checks (the fixture's QQQ is up 25% against SPY's 10%, so nothing at +20 beats it); `group-page-test.js` corrected for three benchmark lines.

### Bars — any one measure, ranked either way (2026-10-07, owner's request)
**A twenty-fifth template, `bars`: pick a measure, an order and a count, and it draws one bar per company with its name and its figure.** The owner's words: *"one generic card called Bars wherein I can select any metric such as Price moves, 200 Day moves, 50 day moves, RSI, Revenue, Gross Profit, essentially anything with a number or % attached to it"*, sorted ascending or descending, 5 / 10 / 15, with the usual Sector, Industry, S&P, Size and theme cuts.

**IT IS THE GENERAL CASE OF THREE CARDS THAT EACH RANK ONE FAMILY.** Movers ranks eleven return windows, the Fundamentals card's rank mode ranks seventeen fundamentals, Most shorted ranks two short-interest measures — and none of them could rank by RSI, by distance from a moving average, by cushion, by Quality or by P/E against peers, and only one of them could sort ascending. **All three are left in place**: Movers keeps its verdict line, compare column and side-by-side layout, Most shorted its year-to-date track, and saved posts name all three.

- **A CURATED CATALOGUE OF 52, never "every numeric field".** `BAR_METRICS` in cards.js, in six groups (Price moves, Trend and position, Scale, Margins and growth, Valuation, Ownership), each entry stating its unit, whether its sign is a direction, its title words for each order, its one-line note and which guards travel with it. Exported as `Cards.barMetrics()`, which the studio builds its grouped picker from — a key the module does not know falls back to the one-month return in silence.
- **THE GUARDS ARE THE REASON IT IS NOT A LOOP OVER FIELDS**, and the ascending sort is where losing one does the most damage: funds are out of every company measure, a null is out rather than a zero (on *lowest RSI* a coerced null is the top of the card), a multiple off a loss is out (unguarded, *lowest forward P/E* leads with the loss-maker), lenders are out of gross margin / cash / debt / EV-EBITDA, and ties are ordered by market value (a dozen companies score 10 for Quality).
- **Theme is the `Within` picker** (`barScope`), as on every scoped card; the other five cuts come through `scopeOf` for free.
- **The title is generated**: `Furthest below` / `their 200-day average`, `Lowest` / `forward P/E`, `Biggest gains` / `over the past month`. A posted card has no picker beside it.

#### A ROW WHOSE OWN FIGURES DISAGREE — `barMixed`, and the measurement behind it
**I told the owner money measures would drop non-USD reporters, and the existing guard cannot do that**: `currency` is the TRADING currency and reads USD for every depositary receipt. Measured on the live screen instead: price to sales IS market value over revenue, and for **31 of 1,239 comparable rows the provider's ratio and those two fields are more than 1.5× apart — 29 of them depositary receipts**. The fields are mixed PER ROW: Toyota's revenue arrives in dollars ($329B) and its EBITDA in yen (7,836B); TSMC's EBITDA is in Taiwan dollars; SK hynix's is 173,888B. Unguarded, *lowest price to sales* opens TM 0.004× / SKHY 0.007× / SONY 0.011×, and *lowest EV/EBITDA* opens with EH and SONY.

- Such a row is left out of every measure built on a reported absolute (`coh`) and **counted in the card's note**. It stays in price, technical, P/E and growth rankings.
- The test reads only the row's own three fields — the `SHORT_PCT_MAX` precedent, a self-consistency check rather than a classifier. 1,178 of the 1,239 sit within ±10%, so the 1.5× line is far from the body of the distribution.
- **The Fundamentals card's rank mode does NOT have this guard** and can still lead a money ranking with a mixed row. Not changed here — it was not what was asked.

#### Two things deliberately not in the catalogue
- **Dividend yield.** Its top reads 869%, 811%, 99%, 68%, 65% — provider junk on the end a reader looks at first, and any ceiling removing them would be a threshold invented here.
- **Price to book and enterprise value.** P/B's lowest is BRK.B at 0.00097 (the dual-class units fault) and TSMC reads 100; EV is negative for several receipts.

#### The bars
- **Colour only where zero is a direction** (`sg`): green and red for returns, distance from an average, growth, margins and signed money; the accent for everything that is one sign throughout. RSI, range position and Quality are on FIXED scales (100, 100, 10), with marks at 30 and 70 on RSI.
- **Where the rows shown straddle zero, the zero moves into the track**, placed in proportion to the two sides, and bars grow away from it.
- **A RUNAWAY VALUE IS DRAWN BROKEN.** Live, *fastest revenue growth* opens +257,493% / +9,000% / +2,627%; scaled to the largest, nine of ten bars are invisible. Where a value is more than four times the next the scale is set further down (walked, at most a third of the rows), the runaway bar is drawn in two pieces, and the note says so. The printed figure is always the true one.
- **Counts are capped per artboard**: 15 on the 4:5 and the story, **10 on the square**, where fifteen needs 16px type. The rows spread through whatever the title and note leave, so 5 and 15 both fill the card.

#### Wiring
Control ids `barMetric`, `barDir`, `barCount`, `barScope`, `barSector`, `barIndustry`, `barCap`, `barScreen`, `barSp500` — **147 against `POST_OPT_MAX` 200** — in `CONTROL_IDS`, their own listener list, `INDUSTRY_PREFIXES` and all four picker fill lists. No server change and no data channel: every field is on the snapshot row and `/api/m/post` already applies the stamps.

- Verified: **69 checks** (`bars-test.js`) — a hand fixture where each row separates one guard, every one of the 52 measures built both ways on all three artboards over a saved copy of the live snapshot (312 builds, no `undefined`/`NaN`), every control redrawing the card, a **108-combination fit sweep** (3 artboards × 3 counts × 12 measures; nothing overflows, tightest row gap 22px), the longest name in the universe clipped rather than wrapped, the drawn colours, and a saved post rebuilt by the phone's own route with the same five companies. Plus the ground sweep (301 checks over 216 combinations), the width sweep (145 over 162), note fit (72 combinations) and size-scope, all clean with the template registered. **Proved by reverting eleven times, every one load-bearing**: funds kept fails 8, a null read as zero 5, the mixed row kept 5, the direction ignored 4, no zero in the track 3, the loss multiple and the break rule 2 each, and the lender, the tie-break, the square cap and the fixed RSI scale 1 each.
- **Known and not acted on**: Corteva's unadjusted split makes it the lowest RSI and the furthest below its 200-day on the screen. The standing CTVA/MLI issue, now visible on one more card.

### The dial cluster on the Advice board (2026-10-07, owner's request)
**Tonight's board (the Advice template's default view) opens with a dashboard: one large dial for the verdicts and three small ones for the readings the rules weigh.** Asked as *"Indicator dial cluster: small gauges that roll up into one Strong Sell → Strong Buy needle, like a car dashboard"*. The tally and the stacked bar stay underneath, so the dials are a summary of rows the reader can still see.

- **THE BIG NEEDLE IS THE AVERAGE PLACE OF THE VERDICTS ON THE SIX-STEP LADDER, AND NOT A SEVENTH VERDICT.** Each verdict sits at the middle of its own step and the needle is the mean, so it is exactly as bullish as the tally below it and no more. The arc is the ladder's own six colours, worst on the left, and the word under it is the step the needle lands in. **In the product's words: there is no "Strong Sell", because the engine has no such verdict** — the ladder runs Sell Immediately to Strong Buy.
- **THE SMALL DIALS DO NOT AVERAGE INTO THE BIG ONE, and the card says so.** "Roll up" is how a points model works; this engine is first-match-wins rule lists, and the first build that WAS a points model was reverted. So the three are the state columns as shares of the cut — *in an uptrend* (Above 200D or Strong uptrend), *with a clean entry*, *fundamentals OK or better* — facts a reader can check against the screener, and the note says a verdict comes from ordered rules rather than from averaging them. Guards has no dial: it is blank on ~95% of rows by design.
- **A row the rules could not read is out of a small dial's denominator**: no trend data, or fundamentals that made no case (376 of 1,274 live). Counting those as "not OK" would be the null-is-not-a-zero error drawn as a gauge.
- **The small dials take the neutral accent**, since "more stocks in an uptrend" is a count rather than a direction of price; the six ladder colours are emitted inline from the theme's own verdict ladder, so all four grounds resolve.
- **It fills the dead band the 4:5 board had** (the owner's screenshot shows ~250px of nothing above the kicker). The square gives back some of the board's own spacing to make room; the story stacks the big dial over the three small ones.
- **No new control and no data channel**: the engine's `states` are already on every scored row, so it is a second reduction over what the board had in hand. The other four Advice views draw no dial.
- First live reading: the needle in **Avoid** across 1,274 verdicts; 43% in an uptrend, 27% with a clean entry, 64% fundamentals OK or better.

#### THE BREADTH CARD'S CONTROLS WERE SHOWING UNDER EVERY TEMPLATE
**`#brdBox` had no show/hide line at all**, so "Break down" and a second "S&P 500" picker sat at the foot of the panel whatever card was chosen — visible in the owner's screenshot of the Advice card, under a control they belonged to nothing on. Present since the breadth card shipped; every other box has its line in `paintControls`. There is a check on both states.

- Verified: **16 checks** (`advdial-test.js`) over a saved copy of the live snapshot — the needle's angle read out of the drawn line and compared with an average computed independently from the engine, the three shares likewise, a cut that is all one verdict landing mid-step, the other four views drawing no dial, a 12-combination fit sweep with the dial's aspect ratio measured, and the breadth box in both states. Plus the ground sweep (313 checks over 224 combinations), the width sweep and note fit. **Proved by reverting seven times, every one load-bearing**: the needle at a step's edge and the ladder read best-first fail 2 each, and the unread rows, the other views, the note, the stretched dial and the breadth box 1 each.
- **The ground sweep flagged the needle at 1.03:1 and it was an unpainted default.** An SVG `<line>` has no interior, but its computed `fill` is still black; `fill: none` states what was already true.

#### …and ONE dial on the Stock spotlight (2026-10-07, owner: "can the same dial be applied to the single stock spotlight")
**The spotlight's "What the rules read" box carries the ladder dial to the left of the verdict word, its needle in the middle of that stock's own step.** The owner asked for it "just to make it look nicer"; it is the verdict the card already prints, drawn as a place on the ladder, so it adds no claim.

- **ONE DIAL, NOT THE CLUSTER.** The board's small dials are shares of many stocks; for one company trend, entry and fundamentals are WORDS, not amounts, and a gauge of a word is decoration pretending to be a measurement. The twelve cells above already carry that stock's numbers.
- **THE RULE THAT FIRED AND THE RULE SET'S NAME STAY BESIDE IT.** A needle pointing at Strong Buy with nothing next to it is an analyst-rating widget; the rule is what keeps it a mechanical reading, which is the reason that attribution was never a setting on this card.
- **`ladderDial(p)` and `dialPlace(action)` are shared by both cards**, lifted out of the board the moment a second card wanted them, so the two cannot come to draw the ladder differently. A test asserts the two cards' six arcs are byte-identical.
- **The chart paid for it**: 318 / 176 / 624 became **292 / 158 / 600**. The verdict box grew by the dial's height and a card cannot scroll, so the free parameter gave it back — the spotlight's own rule. The 90-combination fit sweep holds 29px at its tightest.
- A stock the rules cannot score, and a card with the verdict switched off, draw no dial.
- Verified: the dial suite went 16 to **22 checks** — every verdict on the screen built as a spotlight and its needle angle read out of the drawn line, the arcs compared with the board's, and the two no-dial cases — plus the spotlight's own 63 checks, its four-ground contrast suite, and the ground and width sweeps. **Proved by reverting five times, every one load-bearing**: the ladder read best-first fails 4, the needle at a step's edge 3, no dial 3, a dial at a fixed place 1, and the chart left at its old height 1 (4px of headroom on the 4:5 against a 20px floor).

### Earnings growth — which companies an index's earnings growth is made of (2026-10-09, owner's request)
**A promo template, `earngrow`, under Market after Beating the index.** Asked from an article saying Nvidia and Micron would supply a third of the S&P 500's earnings growth: *"I want the card … last reported is fine, it will be good to see a history as well"*. For one calendar quarter it shows the members' summed net income against the same quarter a year earlier, the companies the difference is made of, four concentration figures, and the last eight quarters as paired columns (all companies, and without each quarter's top five).

- **REPORTED, NOT FORECAST.** The article's figures were analysts' estimates for a quarter not yet filed; estimates are Ultra-plan only. The card leads with the newest quarter at least 80% of the group has filed, so it runs a quarter behind the headlines, and the note says so. A newer, half-reported quarter is named in the note with its count and is not drawn.
- **NET INCOME, NOT EPS.** An index's EPS growth is its members' summed earnings over a divisor; summed net income is the same reading without a share count per quarter. A company's contribution is its own change over the GROUP's year-ago total, in points, so the rows add up to the headline exactly. The two pooled rows ("N others that earned more", "N that earned less") are what make that visible.
- **`earngrowth.js` is the arithmetic and nothing else** (pure, the `secfacts.js` shape). `quarterOf` places a fiscal quarter in the calendar quarter its MIDDLE falls in, so Nvidia's January quarter is Q4 and a 52/53-week year ending on 3 January stays in Q4. A company counts only with BOTH the quarter and the year-ago quarter, 320 to 410 days apart; one end missing is absent from both sums, never a zero. A figure past `NI_MAX` (5e11) is not a company's. A group that lost money a year earlier has no growth rate: the card then prints dollars and says why.
- **`earnGrowthFor(cut)` / `GET /api/earnings-growth?cut=in|ndx|All`** (members; cached 30 minutes; stands aside for a refresh when cold). Members come from the fund's own holdings file, narrowed to the universe, **one company once by filer id**, then `readSecFactsSince` (an indexed seek per symbol) through `latestFilled`. Measured on production: 2.1 to 2.8s for the S&P 500, 0.4s for the Nasdaq 100, 4.5s for the whole screen.
- **An eighth data channel** (`getEarnGrowth`, `Cards.earnGrowthNeed`), wired like the others: the studio fetches per index and repaints when it lands; `/api/m/post` loads it for the phone. The Quarter picker is filled from the payload and offers only quarters with ten or more companies.
- Controls `egrSp500`, `egrQtr`, `egrCount` (5 / 8 / 10; a square names five at most, a story ten). **Blue for a contribution, red only for the pooled fall** — earnings up is not a price going up.
- **Display only**: nothing is stamped on a snapshot row, and there is a check on the row keys.
- **First live reading (S&P 500, Q2 2026, 430 of 499 reported): +63.8%, $488B to $799B.** Alphabet +17.2 points, Amazon +9.1, NVIDIA +6.8, Micron +5.4; the top two are 41% of it and the top five 65%; without the top five, +27.4%.
- **What it cannot say, stated on the card or worth knowing**: today's members throughout (no historical index membership); one-off gains and losses are included as filed, which is why Alphabet and Berkshire lead a quarter; about 14% of the index is missing from the lead quarter, mostly lenders and foreign filers with no quarterly net income on file.
- Verified: **62 checks** (`earngrow-test.js`) over planted figures — the arithmetic with no server, the card off-page, the route on an in-memory database with a second share class, an untracked member and a giant outside the index, the studio, and a saved post rebuilt by the phone's route. Plus a 252-combination fit sweep over production's own payloads (least free height 35px) and contrast on all four grounds (worst text 5.02:1). **Proved by reverting seventeen times, every one load-bearing.**
  - **A fixture figure over the module's own ceiling is silently dropped**: the "giant outside the index" was planted at $9,000B a quarter, past `NI_MAX`, and the suite blamed the route.
  - **Rounded rows drift**: ten rows each printed to 0.1 can sum 0.3 away from the headline. The check allows half a point; the exact identity is asserted on the unrounded figures.

### Lines — any measure with a history, a line per company (2026-10-09, owner's request)
**A promo template, `lines`, under Compare after Chart: the largest companies in a cut on ONE measure over time.** Asked as *"like how we have the bars - any measure, can you also create Line Chart - Any measure, there should be option to select the time frame"*, with a fallback offered (*"if this too difficult, create two separate ones for price and fundamentals"*). It is one card: the Chart card drew several companies' prices and Evolution drew one company's fundamentals, and nothing drew several companies' fundamentals.

- **"ANY MEASURE" IS ANY MEASURE WITH A HISTORY, which is fourteen, not Bars' fifty-two.** A price is in the bar archive and a figure is in the company's filings; RSI, short interest, forward P/E and the rest of the screener's columns are stored as of today only, so there is no line to draw. The catalogue is `PeerTrend.LINE_METRICS`: share price; revenue, gross profit, operating income, net income, free cash flow (trailing twelve months); gross, operating, profit and free-cash-flow margin; revenue growth; market value, P/E, P/S.
- **TWO KINDS OF WINDOW, and the Time frame picker follows the measure.** Price can be drawn DAILY over a month, three months, six months, this year or a year (the Chart card's own basket). Past a year, and for every filed figure, it is one point per QUARTER END over two, three, five or ten years. So price offers nine windows and a filed figure four; `Cards.lineWindows(metric)` is what the studio fills the picker from, and a window the measure cannot use falls back to that measure's default (six months for price, five years otherwise), so a hand-edited post can never ask for daily revenue.
- **WHICH COMPANIES: the 3, 5 or 8 largest by market value in the cut, today.** Scoped like Bars (list, sector, industry, size, screen, index), so Sector plus Industry gives direct competitors. Not "the leaders on the measure": that needs every company's series before choosing five. The Chart card's leaders view still ranks by return.
- **THE MODEL AND THE DRAWING ARE THE PEER CHART'S** (`PeerTrend.build` / `.svg`), given three options rather than copied: a catalogue to read measures from, a colour per line (inline, since the markup travels through the PNG export), and evenly spaced gridlines. So gaps break a line, a runaway multiple or growth rate is pinned and counted in the note, and the scale goes logarithmic only where every figure is positive and they span more than four times. Blue and orange lead the palette, never green: a colour here is an identity.
- **A PRICE LINE IS REBASED to its first close in the window**, so the gap between two lines is the difference in their returns. A company with no price at the window's start is LEFT OUT and named in the note, rather than drawn from a later base of its own.
- **THE GUARDS ARE BARS' OWN**: funds are never on the chart; a null market value is no place in a list ordered by it; a row whose own figures are not all in dollars (`barMixed`) is out of the money measures and the multiples; lenders are out of gross profit and gross margin. A company with nothing on the measure has no line and is named.
- **`trendSeries(syms, quarters, stocks, full)` in server.js is the peer chart's per-quarter loop, LIFTED OUT rather than copied** — the share-count rules in it took three corrections. `peerTrendFor` calls it with `full` false and returns exactly what it did (its 71 checks pass unchanged); `lineSeriesFor(symbols, quarters)` calls it with `full` true for the nine extra series. `SecFacts.ttmSeries(q, full)` carries the rest of the trailing year only when asked, so the stock page's payload is unchanged.
- **`GET /api/line-series?symbols=A,B&q=21`** (members): at most eight symbols, a depth of 9, 13, 21 or 41 quarter ends, unknown symbols dropped, cached ten minutes. Eight companies over ten years is 328 indexed seeks plus their filings.
- **Revenue growth is the trailing year against the trailing year about twelve months earlier**, and needs both positive.
- **A ninth data channel** (`getLineSeries(symbols, quarters)`). The card chooses the companies, so the studio's getter is keyed on the list it is handed, and the phone asks `Cards.linesNeed(tpl, ctx)`, which builds the card once with a getter that only records what it was asked for. `Cards.basketDays('lines', opts)` answers for the daily price path.
- Controls `linMetric`, `linWin`, `linCount`, `linScope`, `linSector`, `linIndustry`, `linCap`, `linScreen`, `linSp500` — **164 against `POST_OPT_MAX` 200** — in `CONTROL_IDS`, `INDUSTRY_PREFIXES`, `SCOPE_PREFIX`, the four picker fill lists and their own listener list. The cut carries across from the other scoped cards.
- **Display only**: nothing is stamped on a snapshot row.
- **WHAT REAL DATA LOOKS LIKE, measured on a read-only sample of 31 companies**: refiners, semiconductors and software draw cleanly on every measure. **Banks draw price and market value only** — no trailing revenue on file, the documented lender gap — and say so. Depositary receipts (TSM, SK hynix) have no filed figures and are named in the note.
- **A PRICE LINE OVER YEARS IS ONLY AS DEEP AS OUR ARCHIVE.** On the ten-year refiners card Phillips 66 was left out: its bars start 2021-07-20, and Delek Logistics holds 304 bars from 2025-07-25. Both are archive depth, not listing dates, which is why the note says *"the price history held here starts after the window does"* and not *"not listed"*. `backfill-bars.js --only` would deepen them; not done here.
- **THE RIGHT GUTTER IS AS WIDE AS THE LABELS DRAWN (owner, the same day: "increase the width of the graph, especially on the right").** It was a fixed 318px, a third of the card. Each label is now STACKED, the figure under the name (`stack` on `PeerTrend.svg`, off for the peer chart), so it needs the width of its longer line only, and the gutter is sized from the labels on the card: capitals and digits at 0.68em, other letters 0.55, the mono figure 0.62, all rounded up, never wider than the old gutter. On the refiners card the plot went from 542px to about 634. The label gap doubles, since a label is two lines tall. The fit sweep was re-run over the same 2,745 combinations with no label past the card; the suite is 69 checks.
- Verified: **67 checks** (`lines-test.js`) over planted filings and prices, one company per guard — the route's figures against hand-computed trailing years, the module off-page (every measure over every window it offers on every artboard), the studio (pickers from the module, the time frame refilled by the measure, the fetch landing and the card repainting, each control redrawing, every label and line measured on all four grounds: worst 5.02:1), and a post saved through the page's own button and rebuilt by the phone's route. Plus a **2,745-combination fit sweep over a read-only sample of production** (31 companies in five cuts; nothing overflows, least free height 39px), the ground sweep (373 checks over 252 combinations), the width sweep (181 over 189), note fit, size-scope and the grouping suite with the template registered, and the peer chart's own 71 checks unchanged. **Proved by reverting twenty-eight times, every one load-bearing.**
  - **The null-market-value guard first reverted to nothing**: a null sorts last, and with a dozen companies above it the top eight never reach it. It bites in a cut of two, where a coerced null turns "one company is not a chart" into a chart.
  - **The contrast check measured nothing on its first run and passed.** A lost backslash turned its digit pattern into the letter d, every ratio came back NaN, and `NaN < 99` is false. It now fails outright when fewer than five lines or no finite ratio was measured.
  - **`size-scope-test` loads cards.js into a sandbox where `window` and `globalThis` are two objects**, so the card could not see PeerTrend and drew its one-line shell for both cuts, which read as ignoring the control. The sandbox hands it over now.
  - `bars-test.js` fails one check with or without this change (confirmed by stashing): it asserts the retired three-value S&P cut where the Index picker now offers six.

