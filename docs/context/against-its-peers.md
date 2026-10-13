## Against its peers — one measure, quarter by quarter (2026-10-08, owner's request)
**A card on `/stock` after Similar stocks, and a twenty-seventh promo template (`peertrend`): one company and its peers on revenue, net income, profit margin or market value over twenty quarters.** Asked as *"Bump chart: the company's rank/data versus peers on a metric over time"*. Two views of one series, and **VALUE IS THE DEFAULT on both surfaces — the owner's call** (*"the peers are similar size, so let's do both and default to value"*): the figures themselves as lines, with **Rank** — the bump chart, 1st at the top — as the switch.

- **THE PEERS ARE THE SIMILAR-STOCKS TABLE'S OWN**, from the same `peersFor()`, so the chart and the table beside it cannot name different companies. Seven lines is about what a chart of this kind carries.
- **`private/peertrend.js` IS THE MODEL AND THE DRAWING, defined once** — loaded by stock.html and promo.html, `require`d by server.js, and read off the global by cards.js the way `ActionRules` is. The page and the card cannot come to rank or scale differently. It draws one SVG at its TRUE pixel size (the page measures its container and repaints on resize), which is the one case where text inside an svg is safe here.
- **What can be ranked over time is what has a history**: the filings (revenue, net income, margin) and the bar archive (market value). P/E, short interest and the other screener columns are stored only since late August and are not offered.

### The data — `peerTrendFor(symbol)`, `GET /api/peer-trend`
- **A QUARTER'S FIGURE is the trailing twelve months to the latest period that company had ENDED by that calendar quarter end**, carried at most `PEER_TREND_CARRY` (200) days. Fiscal calendars differ — Micron's year ends in August — so without a carry no two companies share a column, and with an unbounded one a company that stopped filing draws a flat line to today. **It is the period END, not the filing date**: this is a description, and `/adjustedbacktest` is where publication timing is tested.
- **Market value is TODAY'S share count times that quarter's close**, the Evolution card's formulation — an adjusted close is already in today's share units, so a split cancels exactly, and a buyback makes an earlier quarter read a little low. The note says so.
- **IT IS NOT SEVEN CALLS TO `evolutionFor`**, which reads 5,200 bars a symbol. This needs one close per company per quarter, so it asks `closesBefore` for exactly those (~140 indexed seeks) plus each company's filings. Cached ten minutes; fetched after the chart on the stock page.
- Members only, like the peer table: `payload.peers` is null for a guest, so the card is never rendered, and the route answers 403.
- **Display only**: nothing is stamped on a snapshot row.

### The rules that keep it honest
- **A company with no figure that quarter is ABSENT from that quarter's ranking, never last in it**, and its line breaks rather than joining across the gap. *Did not report* and *smallest* are different facts.
- **A company with no figure in any quarter has no line at all** — a share count nobody holds must not hold a rank open at the bottom of the market-value chart.
- **Log scale only where every figure is positive and the range passes 4×**, the price chart's own rule; net income and margin cross zero, so those are linear with the zero line drawn.
- **Names are spread so no two overprint**, sorted by height and pushed to a minimum gap — two peers finishing a quarter at nearly the same figure is the ordinary case.
- **It does not say which company is better.** No winner is marked, the company's own line is the accent rather than green, and the note ends *"a record of what was reported"* — the line the peer table already draws.
- The page opens on the first measure the company itself has, so a company with no filed revenue still gets its market-value chart; where fewer than three companies can be drawn on any measure there is **no card**.

### WHAT REAL FILINGS LOOK LIKE HERE — measured, and it decides who gets a chart
Run read-only over production: **semiconductors are the good case** (MU / NVDA / AMD / AVGO / INTC / QCOM / TXN: seven lines, one gap; NVIDIA goes 5th to 1st on revenue and Intel 1st to 4th). **Banks are the bad one**: of JPM / BAC / WFC / C / GS / MS / USB only three have a trailing revenue on file, the documented coverage gap for lenders, so a bank's chart opens on market value. **ExxonMobil has no revenue line** — the majors' revenue tag is unmapped — and gets the same fallback.

### The promo card
Controls `ptrSym`, `ptrMetric`, `ptrView` — **152 against `POST_OPT_MAX` 200** — with both pickers filled from the module that draws the chart. A sixth data channel (`getPeerTrend`, `Cards.peerTrendNeed`), wired like Evolution's and Month by month's: the studio fetches and **repaints when it lands**, and `/api/m/post` loads it for the phone.

- **THE SHARED COLOUR SWEEP CANNOT SEE THIS CHART.** Its fixture holds no filings, so it sweeps the card's placeholder and passes over nothing. The card's own suite measures every label and line against the drawn background on every ground the picker offers — and found two: a 60% grey peer line at **2.47:1** on light, and the accent figure at **4.38:1** on sky. Both fixed for the light grounds only.
- The chart heights (810 / 565 / 1320) are measured: the first guess left a 239px dead band above the note.

- Verified: **59 checks** (`peertrend-test.js`) over seven planted semiconductor companies — one that overtakes from third to first, one with only ten quarters on file, a loss-maker, and one with no share count — plus a sector of one and a fund. The route's figures against hand-computed trailing years, the model's ranks and scales, the page (both views, all four measures, a phone), the promo card (24-combination fit sweep, four grounds, a saved post rebuilt by the phone's route). Plus the ground, width, note-fit and size-scope sweeps and the jump-bar suite with the card registered.
  - **59 checks after the reverts added one**, and **proved by reverting fourteen times, every one load-bearing**: smallest ranked first, no log scale, names left to overprint, rank as the fallback view, a figureless company kept on the chart, the page opening on rank, no repaint when the fetch lands, the view picker unwired, the controls out of `CONTROL_IDS`, the phone not handed the series, the newest figure drawn in every quarter (7), a zero share count as a market value (4), the grey line left faint on light, and the no-lines guard.
  - **THE NO-LINES GUARD FIRST REPORTED 0, AND IT WAS UNREACHABLE RATHER THAN UNIMPORTANT.** A sector of one and a fund both have `payload.peers` null, so the section is never rendered and `if (!usable) card.remove()` never runs. The fixture gained four real peers of each other with nothing on file and no share count — the table has rows, the chart has no lines — and the revert then fails 1. They sit in a sector of their own: put in Industrials they became the lone shipper's sector-fallback peers and broke a different check.
  - **Not exercised**: the 200-day carry bound (no fixture company stops filing mid-trail) and the guest 403 on the route.

## A third view: Share of the group (2026-10-13)

The owner, of the peer card: "what do you think of making this in a stacked area chart", then "yes build the third option". A 100% stacked area beside Value and Rank, in `peertrend.js`, so the stock page and the promo card both have it.

- **A third view, not a replacement.** A stack hides what the lines show: only the bottom band has a flat baseline, so no other company's own path can be read, and crossings vanish. It answers a different question, who is taking share from whom.
- **Revenue and market value only** (`SHARE_METRICS`). Net income can be negative; a margin, a multiple or a rank does not add up. Asked for on another measure, `build()` returns the value view with `shareRefused` and `shareNote()` says why. `viewsFor(metric)` is what the stock page offers, so it shows no button that would do nothing.
- **Only quarters where every company has a positive figure**, and only the unbroken run of them ending at the newest; at least four. A company missing from a quarter would read as a share of nothing and hand its slice to the others. `dropped` counts the earlier quarters left off, and the note says the chart starts where all have a figure.
- **The company itself is the bottom band**, where the baseline is flat; peers above, largest today first. The accent for the company and other inks for the peers, never green or red. Colours are inline because the markup also goes through the PNG export.
- **The group is these companies, not the industry**, and both surfaces say so, with "a band can narrow while the company grows, if the others grew faster".
- Seen on real data: Micron against Broadcom, Intel, AMD and Arm over fourteen quarters, Micron 13% to 41% of the five's combined revenue while Intel went 42% to 18%. Six earlier quarters are left off because Arm has no figure before then.
- Scratchpad suite, 33 checks including Micron's real payload. Not rendered in a browser by the build.

### The share view was refused where it should not have been (2026-10-13, the same day)

The owner: "The stacked area chart is only working for Revenue and not the other measures". Two different things were behind that.

- **Market value was a fault.** The first rule wanted every company to have a figure in every quarter drawn. One of Micron's peers was newly listed and had a single quarter of market value, so no run of complete quarters existed and the view was refused for all seven. It had been tested on revenue only, where that peer has no figures at all and so was never on the chart. **The window is now anchored on the company itself**: its unbroken run of positive figures back from its newest. A peer that cannot cover the window (eight quarters where the company has them, else four) is left out and named in the note, and the window is as long as the peers kept allow. Fewer than three companies kept is not a group.
- **Net income is now offered**, as a share of the group's profit. A company with a loss in the window has no share of a profit and is left out by name ("Intel is left out: a loss in the period is no share of a profit").
- **Profit margin and P/E are still refused, on purpose**: a margin or a multiple is not an amount, and five of them added together are not anything. The note now says that in words, and the card says "(no share view for this measure)" in its heading, where the first version said it only in the note and read as a card that had not worked.
- Measured on Micron after the change: revenue 14 quarters, 5 companies; net income 9 quarters, 4 companies (Intel left out); market value 13 quarters, 6 companies (the new listing left out).
- A view that depends on how complete the data is has to be tried on every measure it offers, on a real company, before it ships.
