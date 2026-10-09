## Growth and profitability — bars and a margin line, on two axes (2026-10-08, owner's request)
**A card on `/stock` above Financial statements (so above SEC EDGAR), and a twenty-eighth promo template (`perf`): revenue and net income as bars, net margin as a line, quarter by quarter or year by year.** Asked for from a broker's screenshot, with the owner's own words *"I know you told me earlier you don't like dual axis charts"* — so the second axis is the owner's informed call, and what follows is how it is kept honest rather than whether to have it.

### WHY A SECOND AXIS IS TOLERABLE HERE AND WAS REFUSED ON THE PRICE CHART
The standing objection is that two independent scales can be slid against each other until any two series appear to track. **These two are not independent: the line IS the second bar divided by the first.** Nothing can be made to "track" that the bars do not already say. Four rules carry the rest, all in `private/perfchart.js`:

- **THE BARS ARE ZERO-BASED, always** — a bar is read as a quantity. The money axis runs from $0 to a round number above the largest bar, in ONE unit down the axis (the statements card's rule).
- **THE LINE KEEPS ITS OWN RANGE, and the note says where it starts** (*"starts at 30.0% rather than zero — so a small move in the margin looks steep"*). A line is read as a shape, the short-interest strip's reasoning. Its ticks are round numbers that land on the bars' gridlines.
- **EXCEPT WHERE A MARGIN IS NEGATIVE: then both axes share ONE zero line.** The margin scale becomes the money scale times a constant (rounded up so the labels stay round), so a loss hangs below the same line on both. Without it a loss-making quarter's dot is drawn ABOVE the zero its own bar hangs below.
- **EVERY MARGIN IS PRINTED under its period**, so the line is checked against a number rather than against an axis. On a card that is the only check there is — a posted picture has no hover.
- The margin axis is in the line's colour and the money axis is not. **Blue, cyan and orange, never green and red** — those are identities, and green and red mean up and down everywhere else.

### Shape
- **`private/perfchart.js` IS THE MODEL AND THE DRAWING**, the `peertrend.js` shape: pure, loaded by stock.html and promo.html, `require`d by server.js, read off the global by cards.js. One SVG at its true pixel size. Colours come from the host's stylesheet on the page and are emitted INLINE through `pal.ink` on a card, so all four grounds resolve.
- **`perfOf(all)` in server.js is ONE shaping function with three callers**: `/api/sec` (a `perf` field on the response the stock page already waits for — no new request there), `GET /api/perf` (the studio; members only) and `/api/m/post` (the phone). Twenty quarters and ten years, oldest first, `{d, fp, rev, ni, dv}`.
- **FROM `latestFilled`, NOT `latestPerPeriod`.** A newer filing's sparse comparative row can win a period carrying a net income and no revenue, and this chart needs both in every column. It is also the reconciled path, so a filing a thousand times out of scale is mended rather than drawn as a bar. The cost is the one `ttmSeries` already accepts: this card can have a column where the SEC card's own row shows a dash.
- **A period with no revenue is not a column; a missing net income is no bar and a break in the line, never a zero** (`Number(null)` is 0).
- **A derived quarter is drawn DASHED and the note says so** — no company files a fourth quarter. `dv` is set where the row, or its revenue or net income, was differenced here.
- **THE CARD'S Quarterly / Annual BUTTONS ARE A SECOND FACE OF THE SEC CARD'S OWN SWITCH**, not a second switch: they write the same `secMode` and call the same `sync()`, so the three filings cards cannot be set to disagree. `paintPerf` lives inside the boot scope with `secData`, deliberately.
- **A HOLE IN THE RECORD ENDS THE RUN.** Columns sit side by side and are read as consecutive, so the model walks back from the newest period and stops at the first gap (135 days quarterly, 430 annual). **Found on production, not by the fixture**: ExxonMobil has two quarters with a revenue on file, twelve months apart, and they were drawn as neighbours. It has no chart now.
- **What real filings give, measured read-only**: MSFT and TSLA draw eight clean quarters; Micron’s FY2023 loss puts its annual chart on the shared zero; **JPMorgan has NO quarterly revenue on file and eight clean years**, so its card opens on a sentence and draws on Annual — the documented lender coverage gap; a fund has no card.
- **AS MANY PERIODS AS THE WIDTH HOLDS, up to the twenty quarters sent; five on a phone, five on a card.** It shipped capped at eight, which was a readability guess and not a data limit — the owner asked *"why are you only going 8 quarters"* the same day. What binds is the margin printed under each period: about 58px a column, so a 1500px window draws all twenty and a 1000px one about fifteen. Where neither period can make a chart (a lender with no revenue tag on file) the card is REMOVED and the statements stay; where only the chosen one cannot, it says so in a sentence.
- **THE CARD HAS A COUNT CONTROL (owner, the same day: *"keep it realistic that can fit into the pane"*)**: 4, 5, 6, 8 or 10 periods, five by default, the picker built from `Cards.perfCounts()`. **A story holds eight at most** (its type is larger) and trims to the newest; a count the module does not offer falls back to five. Two things make ten fit honestly: **the type steps down where the longest label along the foot would not fit its column** (a margin of −125.0% is a character longer than 38.0%), and **the gutters are sized to their own longest axis label** — a loss puts a minus sign on both axes, and with fixed gutters that label ran 1-2px past the card’s edge, found by the fit sweep.
- Promo controls `prfSym`, `prfPeriod`, `prfCount` — **155 against `POST_OPT_MAX` 200** — a seventh data channel (`getPerf`, `Cards.perfNeed`), wired like the peer card's: the studio repaints when the fetch lands. Chart heights 720 / 470 / 1180, measured.
- **Display only**: nothing is stamped on a snapshot row.

- Verified: **85 checks** (`perf-test.js`) over seven planted filers — a grower with one derived quarter, a loss-maker, one whose newest period is won by a revenue-less filing, one with no revenue at all, one with a single quarter and three years, and the universe's 99-character name — plus a fund. Bar heights read off the drawn rects and compared with the planted figures (which is what proves the zero base), the shared zero measured as drawn, the switch moving all three cards both ways, a 48-combination fit sweep (three artboards, three counts, a profit, a loss, a −125% margin and the 99-character name), every label and series colour measured on all four grounds, and a saved post rebuilt by the phone's route. **Proved by reverting twenty-four times, every one load-bearing** (the count ignored 5, no story cap 1, no type step-down 2, fixed gutters 1, a hardcoded count picker 6, and the nineteen before them) (the old cap of eight and the server sending twelve both abort the suite part-way, at 32 and 1 of 79 — they bite, but their failure counts are floors): a hole drawn as neighbours 2, bars not from zero 3, no shared zero 6, a null net income as zero 1, a no-revenue column 3, `latestPerPeriod` 2, the derived flag 3, the phone's series 1, the switch not repainting 24, the no-revenue card 2, the fund's card left behind 1, every quarter on a phone 3, the old cap of eight 6, the server sending twelve 1, no repaint on fetch 6, the listener 2, `CONTROL_IDS` 5, the story height 1, the dark palette on every ground 1.
  - **THE SHARED COLOUR SWEEPS CANNOT SEE THIS CHART**, the peer card's own caveat: their fixture holds no filings, so they sweep the placeholder. The contrast check is in the card's own suite.
  - **A quoted heredoc refused to close on the module** (the documented hazard, again); written with the Write tool.


### Stock spotlight is ONE entry with five sub-templates (2026-10-08, owner's cleanup)
**"Anything that is related with a single stock, merge all that under one template Stock Spotlight, add them as separate sub-templates."** The Template list shows a single `Stock spotlight`; choosing it reveals a **Sub-template** picker: Overview (`spotlight`), Growth and profitability (`perf`), Against its peers (`peertrend`), Month by month (`months`), Evolution (`evolution`). 27 entries in the list became 23.

- **THE TEMPLATE IDS DID NOT CHANGE, and that is the whole design.** A saved post names its template by id and `cleanPosts` checks it against `Cards.ids`, so re-keying five templates into one with a mode would strand every stored post — the Scale rename's rule, *a label is free and a key is not*. The grouping is `promo.html`'s presentation and nothing else: `cards.js`, the server and the phone know nothing about it, and a post still saves as `perf` or `months`.
- **`#tplSelect` still holds an `<option>` per id**, which is also what keeps the hundred-odd suites that drive it by id working. Inside the group exactly ONE option is shown — **the sub-template last used** — and it reads `Stock spotlight`; the other four are `hidden`. So choosing the entry comes back to the view you left. The hidden ones are named in full (`Stock spotlight — Evolution`) for a browser that ignores `hidden` on an option and lists them anyway.
- **THE STOCK CARRIES ACROSS THE FIVE.** Each keeps its own control id (`spotSym`, `prfSym`, `ptrSym`, `monSym`, `evoSym`) because a saved post stores it under that id, but choosing a company in one sets it in the others — or switching sub-template would quietly switch company too. Stock pickers outside the group are left alone.
  - **A post saved BEFORE this carries five stocks that were never kept in step**, so `openPost` syncs the siblings from the opened template's own stock. Today's saves store all five alike, which is why that guard's first revert reported nothing: it needed an old-shaped post in the fixture to be reachable.
- **Deliberately NOT moved**: the single-stock MODES inside multi-stock templates — Chart's one-stock and two-stock views, the Advice card's five-rule-sets view, the Fundamentals card's one-company view and the Histogram's pinned stock. Each is a mode of a card whose other modes are about many stocks, selected by that card's own mode control, and several saved posts name them.
- Verified: **27 checks** (`spotgroup-test.js`) — one visible entry for the five, the picker's order, each sub-template showing its own controls and nobody else's, the entry remembering where it was left, a hidden id still selectable directly, the stock carried from any of the five, a post saving under its own id and reopening on its sub-template, an older post's disagreeing stocks reconciled, and the phone still building it. **Proved by reverting seven times, every one load-bearing.**


#### ...and Market is the second group (2026-10-08, owner: "move anything related with the broader market under one template called Market")
**Snapshot (`day`), Narrow or broad (`breadth`), Flow, Treemap and Waterfall sit under one `Market` entry, which leads the list; the Template list is 19 entries where it was 27.** The owner named three; Snapshot and Treemap joined them because they take the market as their subject in the same way, and the Treemap is the Waterfall’s own pair.

- **ONE MECHANISM FOR BOTH GROUPS**: `TPL_GROUPS` in promo.html — a name, its views, and the sub-template last used. The Sub-template picker is refilled only when the GROUP changes. Ids unchanged, as before.
- **NOTHING IS CARRIED ACROSS Market’s five**, unlike the stock in Stock spotlight: each keeps its own window and its own S&P cut, whose defaults differ by design (Flow, Treemap and Waterfall open on the index; the Snapshot on the whole screen).
- **Left where they are**: Short moves, Most shorted, Histogram, Bars and Movers — each takes a scope or ranks a list, which is a different kind of card from one whose subject is the market itself.
- Verified: the grouping suite is **38 checks** over both groups, and **proved by reverting nine times, every one load-bearing** — Market left out of the groups, the picker not refilled between groups, and the seven above.

#### ...and Rankings, Compare and Brand finish the list (2026-10-08, owner: "do what is logical")
**The Template list is six entries where it was 19: Market, Stock spotlight, Rankings, Compare, Advice, Brand.** Grouped by what a card does, through the same `TPL_GROUPS` mechanism; template ids unchanged.

| group | sub-templates |
|---|---|
| **Rankings** — a top-N list on one measure | Movers, Bars, Fundamentals, Most shorted, Short moves |
| **Compare** — many companies drawn against each other | Size, Bubble, Histogram, 52-week range, Sparklines, Chart, Lines |
| **Brand** — no data | Intro, How to, Announcement, Disclaimer, Profile picture |

- **Advice stays an entry of its own.** A group of one is a picker with one option.
- **Fundamentals is in Rankings** because its default view ranks; its quadrant view would fit Compare. A judgement call, the owner's to revisit.
- **`TPLS` was reordered so each group's members are contiguous**, or a group's single visible entry would move around the list with whichever view was last used.
- **The Sub-template picker offers only what the account may use**: Announcement is owner-only, so a member's Brand picker has four. Its rebuild key includes the visible-template list, since `/api/me` lands after the first paint.
- **The profile picture forces the square artboard from either picker.**
- **THE CUT CARRIES ACROSS EVERY SCOPED CARD** (`scopeSyncFrom`): the list, sector, industry, size band, screen and S&P cut chosen on one of the eleven scoped templates is set on the other ten, so moving from Movers to Bars is the same companies ranked another way. Each card keeps its own six control ids. A sector change refills the other cards' industry lists before an industry is copied; opening a saved post makes that post's cut the one everything follows. **This reverses an older behaviour** where each card kept an independent scope.
- **Not done**: promoting each card's own mode control (Advice, Fundamentals, Chart, Histogram, Range) into the Sub-template picker, and listing the single-stock modes of those cards under Stock spotlight.
- Verified: the grouping suite is **48 checks** (`spotgroup-test.js`).

### The Evolution card’s lower panel can be a multiple (2026-10-08, owner: "any reason why you didn’t do the evolution of P/E")
**A `Market measure` control (`evoValue`): Market value (the default), P/E, or P/S.** The card had refused a P/E line for a measured reason — the series explodes where earnings pass through nothing (CRM peaks near 8,000 against a median of 142) and does not exist for a loss-making quarter. Both halves are now HANDLED rather than used as a reason to withhold it:

- **A LOSS IS A BREAK IN THE LINE**, never a negative multiple, and the note says what a break is.
- **A RUNAWAY QUARTER IS PINNED at the top of the scale and counted in the note** — past 2.5 times the 90th percentile, the ceiling is 1.25 times it — the earnings-surprise strip’s rule. An ordinary series is not touched. **The end label always prints the TRUE latest multiple**, even when that point is itself pinned.
- **ONE MULTIPLE AT A TIME, which is the one place this differs from the owner’s sample.** P/E and P/S on two axes of one plot is the dual axis this module still refuses: unlike the bars-and-margin card, the two are INDEPENDENT, so where each scale starts decides whether they appear to track.
- **`valueChart` fills ONE CLOSED SHAPE PER RUN now.** A path with a gap in it is several subpaths, and closing the whole thing to the floor closes only the last — the others close back to their own first point and paint a wedge. No series had a gap until a multiple did.
- P/S is market value over the trailing year’s revenue, computed in the card from two fields already on each point; nothing changed on the server, and the phone needed nothing.
- With a multiple drawn the note is rewritten to the length it had, and the in-panel "too few quarters with a profit" sentence is set tight — on the square the full-size one ran 3px over, found by the fit sweep.
- Control ids **156 against `POST_OPT_MAX` 200**.
- Verified: **25 checks** (`evoval-test.js`), the series stubbed at the route so every multiple is planted: a profitable company, one with a five-quarter loss and two runaway quarters, and one never profitable. A 27-combination fit sweep. **Proved by reverting seven times, every one load-bearing** — the label guard only after the fixture was given a pinned LATEST point, since with an ordinary one the two versions print the same thing.

### The Evolution card values each quarter at the share count it was FILED with (2026-10-08, found on the owner's Apple card)
**Market value in the past was `today's share count x that day's close`, which cancels splits exactly and ignores BUYBACKS — and on a P/E history that is not a footnote.** The owner's own card read Apple's end-2016 multiple as **9.4x** where it was about 14x, so the "x4.1" expansion printed under it was really about x2.8. Apple has retired roughly 30% of its shares since. It is now the count the company filed that quarter, restated for the splits since.

**Measured on production, read-only, both bases side by side:**

| | old basis | filed basis | what it really was |
|---|---|---|---|
| AAPL market value, end 2017 | $621B | **$873B** | ~$870B |
| AAPL P/E, end 2017 | 12.3 | **17.3** | ~17-18 |
| MSFT market value, mid 2008 | $204B | **$261B** | ~$250B |
| AMZN market value, end 2017 | $631B | **$580B** | ~$565B |
| TSLA market value, Sep 2018 | $70B | **$47B** | ~$45B |
| GOOGL market value, Mar 2018 | $634B | **$731B** | ~$720B |

The error ran BOTH ways: a buyback read the past low, and dilution (Tesla, Amazon) read it high.

#### WHICH SPLITS A FILED COUNT STILL NEEDS IS NOT KNOWABLE FROM ITS DATE
The obvious rule — multiply by every split after the period end — is wrong, and it is wrong in the common case. `latestFilled` takes the NEWEST filing's version of a period, and a later 10-Q carries prior-year comparatives **already restated** for a split. NVIDIA's trail reads `2023-04: 2,490M`, `2023-07: 24,994M` with the 10-for-1 a year later: the second is restated, the first is not, and both ended before the split.

- **What IS known is the shape of the error**: a filing has been restated for every split up to its own date, so the factor it still lacks is the product of the LAST k splits, for some k. `splitAdjustedShares` in adjusted.js tries every k and keeps the candidate nearest the quarter AFTER it, walking back from today's count. Buybacks move a count a few percent a quarter and the smallest split there is moves it 25%, so it is not a close call.
- **A count no candidate can reconcile is junk and is left out** (NVIDIA's trail carries 564.5M, 0.5M, 582.6M). That quarter takes its neighbour's; `sharesMended` counts them.
- **Where no count is tagged, net income over diluted EPS stands in** — the same filing saying the same thing a second way. Alphabet tags a share count only from 2023 (three classes) and would otherwise have fallen back entirely. Only off an EPS of 20 cents or more: below that the rounding to a cent is most of the answer.
- **NEVER A MIXTURE.** Fewer than half the quarters with a usable count, or no split history, and the WHOLE series is on today's count — a line that changes basis part-way has a step in it nobody could explain. The payload carries `basis` (`filed` / `today`) and **the card's note says which it used**.
- **No anchor and a split since the period: it falls back rather than guess**, because guessing wrong is the whole factor.
- **Today's point takes the newest FILED count**, so the last segment is a move in price alone and not also a switch from diluted to basic shares. The cost: the card's market value now is on DILUTED shares and can differ from the screener's by a few percent (Tesla's by 12%, where the vendor's own share count looks high).
- A company with no current share count on its profile now gets a value panel where it had none.

#### Split history — fetched the first time a symbol needs it
**`splits` (symbol, d, f) and `split_state` (the fetch clock), both in `SYMBOL_TABLES`.** `f` is new shares per old: 4 for a 4-for-1, 0.125 for a 1-for-8. From Twelve Data's `/splits`, **20 credits a symbol**, measured off `api-credits-used`, pinned to the US listing.

- **NOT part of the profile pull.** Seven profiles a minute already sit at 560 of the 610; twenty more each would breach it. `splitsFor(symbol, prof)` in server.js asks once, on demand, and stores the answer — so **a single stock needs no backfill at all**.
- **Re-asked when**: never fetched; older than `SPLITS_TTL_DAYS` (180); or **the profile names a last split newer than any held** — which is what stops a fresh split leaving a filed count unadjusted for longer than the profile rotation.
- **It never competes with a refresh**: while a multi-round run is live it serves what it holds, or nothing, and the series falls back.
- **"Never split" and "never asked" are different answers** — an empty list is stored and is not asked about again; a refusal or an unreachable provider stores nothing.
- **`backfill-splits.js`** does the universe in one paced pass (dry run by default, `--commit`, `--only`, `--missing`, `--rate`): about 25,500 credits and about five and a half hours at the default **80 credits a minute**. That default was 200 for an hour and was WRONG: an intraday price round takes ~500 of the 610 in its own minute, so 200 more is 700 and the call the provider refuses may be the price round's. A nightly round runs at ~561 and leaves no room at all, so a run must not overlap 07:30-08:15 or 19:30-20:15 Eastern.
- **The route caches a body per (symbol, window) for ten minutes**, so a card first drawn while the provider was unreachable stays on today's count for that long.

- Verified: **19 checks** on the arithmetic with no server (`shares-test.js` — every company has a TRUE count per quarter and is filed on a mixture of bases; the adjusted series must come back as the true one), and **20** on the store and the fetch (`splits-test.js`, the provider stubbed and every call counted). **Proved by reverting ten and eight times** — the eighth server-side case (never-fetched read as never-split) stops the suite running at all rather than failing a check.
  - **The EPS floor's first revert reported nothing**: an EPS of one cent implies a count a hundred times out, which the chain rejects anyway — two guards for one fault. It is proved with a few cents of EPS rounded as a filing rounds it, which wanders 10% while staying inside what the chain accepts.
  - **The route's ten-minute cache made four checks vacuous on the first run**: a repeat request never reached the split lookup. Each call that has to reach it asks for a window not asked for before.
- **Backlog 28-30**: the S&P's own P/E beside a stock's, the peer chart's market value on this basis, and the splits table as the missing input for repairing an unadjusted archive.


### P/E in the peer chart, and an ADR’s share count corrected (2026-10-08, owner’s request)
**A fifth measure on Against its peers, on the page and the card: P/E, market value over trailing earnings.** One entry in `PeerTrend.METRICS`, so both surfaces and the card’s picker gained it at once.

- **A LOSS IS A GAP, never a negative multiple**, and that company is left out of that quarter’s ranking — the chart’s existing rule for a missing figure. **A runaway multiple is PINNED** (past 2.5 times the chart’s 90th percentile, drawn at 1.25 times it) while its rank, label and tooltip keep the true figure; the Evolution card’s rule, in the shared model.
- **TAIWAN SEMICONDUCTOR READ $11.83T ON A LIVE PAGE, found in the owner’s screenshot.** An ADR’s `sharesOutstanding` is the ORDINARY count against an ADR price — one ADR is five shares — so it led a chart it belongs fifth on. The vendor’s market cap is in dollars and is right where its share count is in another unit, so **where the count and cap-over-price disagree by more than half again, the implied count is used**. The same test rights a dual-class row. This is the documented ADR trap (CX at 2,921%), met on a shipped chart.
- **Each company is valued at the count it FILED where its split history is held** (`splitAdjustedShares`, the Evolution card’s function) and at today’s count where it is not; `capBasis` on the payload says which, and `PeerTrend.measureNote` — ONE description shared by the page and the card — says for how many. **The route reads stored splits and never fetches**: seven cold lookups is 140 credits in a request.
- **The universe backfill was started the same afternoon for that reason** (`backfill-splits.js --commit --missing`, 80 credits a minute, ~5 hours). Until it lands most peers are on today’s count.
- `model.lower` keeps an initialism’s capitals mid-sentence ("on P/E", not "on p/e"). The generic break sentence is dropped on the P/E view, where the measure’s own note already says it — with both, the card ran a line over on every artboard.
- Verified: the peer suite is **71 checks**; **proved by reverting eight more times, every one load-bearing** — the ADR count, a multiple off a loss, held history ignored, a zero share count, no ceiling, the measure left out, lower case, and the doubled sentence.

