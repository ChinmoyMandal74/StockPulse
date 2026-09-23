# Things to consider later

Started 2026-09-23 at the owner's request. Not a plan and not a promise — a
place to put work that was **identified and deliberately not done**, so the next
session starts from what is already known rather than rediscovering it.

Each entry says what it is, what is already measured, what it would take, and
what would make it a bad idea. **An entry with no measurement behind it says
so.** Delete an entry when it is done or when it stops being worth doing;
either way say which in the commit.

Ordered roughly by value, not by effort.

---

## 1. The PEAD study — the best untested idea this project has

**Post-earnings announcement drift**: a company reports, the number beats or
misses what was expected, the price jumps that day — and then keeps drifting in
the same direction for weeks. One of the oldest and most durable anomalies in
the literature (Ball & Brown, 1968).

**Why it matters here specifically.** The drift plays out over one to three
months. The owner's constraint is a maximum one-to-two-month hold, which the
research log calls the hardest horizon there is — short-term reversal has faded,
trend continuation has not started, and **seven framings have come back flat**.
PEAD is the one well-documented effect that lives in exactly that window. There
is already a *Drifting after a beat* starter screen built on the idea.

**The data is ALREADY IN HAND — this is the thing to know.** CLAUDE.md said for
a long time that the study "becomes answerable a couple of quarters after
2026-09-13" because `fundamentals_history` only started recording the earnings
fields then. That is out of date: `EARNINGS_QUARTERS` was raised to 40 on
2026-09-18, five days later, and backfilled deep history for nothing, because
`/earnings` costs the same 20 credits whatever depth is asked.

| the study needs | what is stored |
|---|---|
| an event date | `earnings_history.d` — the report date |
| the surprise | `surprise_prc` — **27,421 usable events since 2017** |
| forward returns | `bars` — 1.83M rows back to 2003 |

Events with a surprise, by year: 563 (2017) · 1,300 · 1,542 · 2,151 · 3,188 ·
3,346 · 3,384 · 3,480 · 4,275 · 4,192 (2026), across 250 → 938 symbols.

So it is answerable **now, retrospectively over about nine years**, offline
against the local copy, for no credits.

### The one detail that would fake a result

**27,551 of 27,705 events are "After Hours"** (149 pre-market, 5 unknown).

A company reporting after the close does not move the price that day — the
reaction is the *next* session. A study whose window starts on the report date
captures the announcement jump inside the "drift", which is not drift at all.
That produces a large, confident, wrong answer. **The window must start at t+1
for 99.4% of events**, and at t for the pre-market handful. This is the trend
ribbon's lesson in a new place: *the word at day t earns the t→t+1 move.*

### Two more checks before trusting any number

- **Is `surprise_prc` the pre-announcement consensus, or a later revision?** If
  the provider stores a revised estimate the surprise carries hindsight. Settle
  it by comparing a few stored values against the estimate as it stood.
- **Survivorship.** Every event comes from a company still listed in 2026. The
  standing rule applies: *if a result improves after the universe shrinks,
  suspect the universe.*

And the method rules the research log already earned: rank within the day so the
market subtracts out, discount for overlapping windows, and give any hit rate
its base rate.

### If it works, what it should become

**A marker, not a rule — at least at first.** The precedent is the volume
breakout study, the only finding here whose sign survived the 2020 split. It was
real, small (+½–1% per event over 1–2 months) and not monotone, and it shipped
as a **fact on the Entry cell** with the study's own sentence as its tooltip.
*No advice rule reads volume.* PEAD belongs in the same place — beside the Entry
state, since "reported a beat three weeks ago" is a statement about timing
rather than trend or fundamentals.

Only consider a rung in the rule list if the effect survives the era split. The
advice backtest already says the tiers order downside correctly while medians
are flat: the model manages risk and does not pick winners, and a PEAD rung
would be trying to make it do the thing nothing here has managed yet.

**One real advantage over every other fundamental.** PEAD inputs are
*replayable* — earnings dates and surprises are stored back to 2017 and are not
rewritten — where `fundamentals_history` begins 2026-08-30, which is exactly why
the advice backtest is capped at two months. A PEAD finding could be backtested
over nine years rather than eight weeks.

---

## 2. A reconstructed trailing-P/E history

`fundamentals_history.trailing_pe` only starts **2026-09-15** (the day the
profile call started being kept in full), and the provider serves no historical
ratios on this plan — `/statistics` returns today's number and nothing else. So
the stored series will never be deeper than the day it started.

**But it is reconstructible.** Trailing P/E is price ÷ trailing-twelve-month
EPS, and both sides are already stored: `bars` back to 2003 and
`earnings_history` for as far as each symbol reaches (median 2020-05).

Checked rather than assumed: AAPL's last four reported quarters sum to **8.72**
against the provider's own `diluted_eps_ttm` of **8.71**. A one-cent gap — the
reconstruction is sound.

**The caveat that decides the design.** The provider's stored `trailing_pe` of
38.59 against a price of 339.75 implies an EPS of 8.80, about 1% away from
either figure above. So a reconstructed series and the stored one would show a
small step where they meet. **Compute the whole series one way** rather than
splicing.

---

## 3. Strategy and Single are describing a universe that no longer exists

Both read committed JSON built **2026-09-11**, at **93 symbols**. The universe
is now **943**.

- `strategy-index.json` — "All" is `n: 93`, and **7 of its 14 named universes no
  longer exist as themes**: Industrials, Watchlist, Fin, Energy, Utility,
  Hardware, and **Faded**, the ballast list the whole research log leans on.
  Those options are still clickable.
- `single-closes.json` — 93 symbols, 2.6MB.

The *findings* from these pages are worth keeping and live in CLAUDE.md — the
Moskowitz–Ooi–Pedersen result is the only thing on this project that survived
the 2020 split. What is wrong is offering the pages from a nav as though they
described today's screener.

**"Just rebuild them" is not obviously right.** `single-closes.json` is ~28KB a
symbol, so 943 symbols is ~27MB raw and ~7MB gzipped, shipped to a browser on
page load. `strategy-runs.js` writes a ~13MB file *per universe*, and there are
28 themes. The current design does not absorb a 10x universe; a rebuild would
produce something unservable.

Options, cheapest first: pull the two rows out of `/admin`'s Research grid and
leave the pages reachable by URL; or redesign the payload (server-side
computation, or a sampled universe) before rebuilding.

---

## 4. `lab-grid.json` is stale, and it is the lab's honesty anchor

Built **2026-09-15 on 93 symbols**. The universe is 943.

The grid is what `/lab` prints beside whatever is being tuned — "the best |t|
anywhere on the grid" — and it exists precisely to stop a promising-looking cell
being over-read. It is now describing a pool a tenth the size. The research log's
own rule: *a number that moves that far because the universe changed is a number
about the sample.*

**This is the cheap one.** 300KB, and `lab-grid.js` runs offline against the
local copy in ~28s. The rebuild sequence matters though, and skipping the first
step silently keeps dead tickers in everything:

```
node --use-system-ca analysis-db.js --full
node lab-grid.js
```

---

## 5. The cron route has no fast mode — the real fix for refresh growth

Verified 2026-09-23: `POST /api/refresh-all?mode=fast` exists, but
`/api/cron/refresh` has no fast path and the nightly workflow only ever calls
`?start=1`.

This matters because of the arithmetic CLAUDE.md already records. `?start=1`
does not merely start a run — it falls through and executes a whole round, and
round one is the live price round, measured at **257.2s at 640 symbols**. The
platform kills a function at about 300s and a **504 at 300.1s is on record**.
The workflow's curl timeout was raised to 300s, which is the ceiling worth
asking for, not a margin.

Fast refresh is the designed answer: its rounds are `/api/refresh-profiles` —
profiles only, no bars, no snapshot — taking seconds, with one heavy rebuild at
the end. At 1,000 stocks the estimate is ~2.5 hours and under 1M rows read,
against Refresh all's 5–7 hours and ~63M.

---

## 6. `TURSO_ROWS_READ_LIMIT` is unset, so the quota watchdog can never fire

Verified: not in `.env`. The daily watchdog compares rows read, rows written and
storage against `TURSO_ROWS_READ_LIMIT`, `TURSO_ROWS_WRITTEN_LIMIT` and
`TURSO_STORAGE_LIMIT_GB` and mails once the worst passes `TURSO_ALERT_AT` (0.7).
With no limit set there is nothing to compare against, so the alarm is silent by
construction — and `/database`'s percentage bars cannot draw either.

This is the alarm for the failure mode this project has already had once: a
75%-of-quota warning from Turso, and **being over quota SLOWS the database**
rather than only billing for it. Setting one number re-arms it.

---

## 7. Smaller, verified, one-line-ish

- **`/api/me` is still fetched twice on six pages** — stock, promo, activity,
  contact, users, visitors. Each loads `wmark.js`, which now shares a promise
  slot on `window.__me`; the screener and wmark are wired up, the rest are not.
  One line each.
- **MACD has no chart pane.** `macdLine`, `macdSignal` and `macdHist` are all
  computed per row and are card rows as of 2026-09-23, but the stock page draws
  no pane. CLAUDE.md has called this "the obvious next pane" for a while; the
  pane machinery takes a new entry rather than a rewrite, but note the coupling
  recorded there — **pixels per viewBox unit must stay constant**, which spans
  `rowcard.js` and `stock.html`.
- **The Indicator lab link on the stock page** is the last survivor of three
  (Signal study was deleted with momentum-over-time; the Excel model link went
  2026-09-23). One button in furniture built for three — worth either removing
  or giving company.

---

## 8. Untested research framings, carried over from the log

These are recorded in CLAUDE.md's research log and are repeated here only so
this list is the one place to look:

- **Benchmark-relative returns everywhere** — subtract the universe's
  equal-weight return that day. Turns "did it go up" into "did it beat its
  peers", the only version that survives the remaining survivorship bias.
- **Longer horizons, 6m and 12m.** Everything has been tested at one to three
  months. Two more `LEAD`s in the view.
- **A discriminating version of the trend backtest.** The current sweep
  qualifies **108 of 336** stocks — about a third of the universe — so the
  basket is nearly the benchmark and there is little room for selection to show.
  Strong Buy alone, or a top-N cut inside the tier, is untested.

---

## What is deliberately NOT on this list

- **Rebuilding the momentum score.** Removed 2026-09-23 at the owner's
  instruction. If it is ever revisited, read
  [momentum-scoring.md](momentum-scoring.md) and
  [momentum-delta.md](momentum-delta.md) FIRST — twelve framings between them,
  every one flat — and start from `git show momentum-scoring:momentum.js`, not
  from memory.
- **Analyst ratings and price targets.** The endpoints need a Twelve Data Ultra
  plan and 403 on Pro for everything but the AAPL demo. The whole path was
  deleted 2026-09-23 rather than left behind a flag that cannot usefully be
  switched on. Git has it if the plan ever changes.
