## Evolution Two Stocks — the Evolution card for a chosen pair (2026-10-10, owner's request)

**A promo template, `evo2`, last in the Compare group.** Asked from the Evolution card (*"I like Stock Spotlight → Evolution, it will be good to create another version wherein two stocks can be compared this way"*), with the name, the group and the defaults (revenue above, P/E below) chosen by the owner. What Evolution does for one company — what the business did above, what the market paid for it below — drawn for two, one line each.

**Blue and orange, never green and red.** A colour here is an identity. **No winner**: nothing is ranked or worded as better, and a multiple's change takes no colour, as on the one-company card (a check asserts the absence of winner words).

### Two companies are rarely one size
A shared dollar axis draws the smaller as a line along the floor. Three cases, by measure:

- **A ratio** (margin, P/E, P/S) is already comparable: one plain axis.
- **A dollar measure goes LOGARITHMIC** where every figure of both companies is positive and they span more than `EVT_LOG_SPAN` (4) times, the peer chart's own rule. Equal slopes are then equal growth rates. The panel heading says "log scale" and the note explains it.
- **A dollar measure that reaches zero or below cannot go logarithmic and is NOT rebased.** That is earnings with a loss anywhere in the window, which is common (the Evolution notes record TSLA loss-making in 38 of 63 filed quarters). Rebasing a series that starts negative or crosses zero gives a number that means nothing. It stays on a plain dollar axis with a zero line, and the note says the smaller company reads flat and that profit margin is the like-for-like view.

### Lined up by calendar quarter
Two companies' filed quarters almost never share a date (Apple's year ends in September, Microsoft's in June). A quarter is placed in the calendar quarter its MIDDLE falls in (`evtQ`, the Earnings growth card's `quarterOf` restated, since this module has no requires). The axis is quarter indexes; its labels read `Q4 2024`.

- **The window starts at the first quarter BOTH had filed.** Before that there is one line, which is the other card. Fewer than three shared quarters says so.
- **One "then" for all four figures**: that first shared quarter. A company with no figure in it prints a dash, never a later quarter passed off as the start. "Now" is each company's own last filed quarter for the business measure, and the live close for the market one; the as-of line names both companies' dates.
- **The market panel runs to today** where a price does, one extra point at the later of the two live dates. End tags print the true latest figure even where a runaway is pinned.

### What is refused, with the reason on the card
- **A company reporting in another currency** (`barMixed`, the Bars card's test on the row's own three fields): its revenue and earnings cannot share a dollar axis, and a multiple divides a dollar value by another currency. Those panels print the reason and name the measure that does compare. Margin and market value still draw. No figures are printed for a refused panel.
- **A loss** breaks a P/E line; a lone profitable quarter between two losses is drawn as a dot, since a path of one point draws nothing.
- **A runaway multiple** is pinned at the top of the scale and counted, on the two companies' combined values (`EVO_RUNAWAY`).
- The same stock twice is replaced by another; a symbol not on the screen, too little filed history, and a fetch still in flight each have their own card.

### Wiring
- **`evolutionNeed('evo2', opts)` answers `{ symbol, symbols: [a, b], years }`.** `symbol` stays the first so a host that only knows one still fetches it. The studio's `getEvolution` was already keyed per symbol and repaints on `evolutionNeed` being truthy, so it needed no change. **The phone route did**: `/api/m/post` read one company; it now reads `symbols` together into a map and hands the card a `getEvolution(sym)`.
- Controls `evtSymA`, `evtSymB`, `evtMeasure`, `evtValue`, `evtWin`. `evtValue` is filled from `Cards.evoValues()` and opens on `pe`. The second stock picker opens on the second company.
- **`POST_OPT_MAX` went 200 → 300.** This card took `CONTROL_IDS` to 199; the cap silently drops every control past it from a saved post, which is how it was raised from 40 and from 100.
- `pairChart(labels, lines, o)` is a sibling of `valueChart`, not a flag on it: that one fills under a single series, and a fill under each of two is mud.
- **The layout is Evolution's own** — the same `evo-*` classes, the same two measured panel heights, four figures in the same one row — so the fit is inherited rather than measured. What is new and unseen: a title of two names (tickers past 40 characters combined), a legend in the line under it, two end tags per panel, and four figure labels that carry a ticker.
- Verified: 35 checks in Node (`evt-test.js` in the session scratchpad), on fixtures with offset fiscal years, a hundredfold size gap, a loss-then-profit company with a 9,000× quarter, and a foreign reporter. The one-company Evolution card is identical before and after. **Nothing was rendered.**

### Both figures of a pair in the same unit (2026-10-10, the owner on the first card drawn: "why is that number in %")
`evoChange` words growth as a multiple from three times up and as a percentage below it. That is right for one company and wrong for two side by side: Apple against NVIDIA read **"+185%" beside "×116"**, and a reader has to convert one to compare them. So where EITHER of a pair is a multiple, the other is printed as one too, to one decimal (`×2.9`).

- **Only growth is.** A fall stays a percentage (`×0.8` is not how anyone says it) and a sign change stays words ("to profit").
- A margin is a level in points and is never a multiple of itself, so the rule applies to the dollar measures and to the market measure.
- Where neither of a pair tripled, both stay percentages, as before.
