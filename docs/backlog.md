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

## 9. A control plane for scheduled jobs — parked 2026-09-24

The owner asked how hard a front end for the laptop's intraday job would be,
then said they plan to move the nightly onto the laptop too and expect "more
processes like this". After the measurements below they chose to **keep running
the nightly by hand for now** and revisit. Nothing was built. This is here so
the next attempt starts from the numbers rather than re-deriving them.

### The live defect found on the way, which is independent of all of it

**No SCHEDULED nightly has been recorded since 2026-09-20.** The four nights
after it were manual rescues (#62/#63/#64 on the 21st, #80 on the 22nd, #94 on
the 23rd, #113 on the 24th). Either GitHub is not firing inside the 16:00 New
York window, or it is firing late and the timezone guard is correctly refusing
— both are the scheduler failing.

**And the watchdog cannot see it.** `nightVerdicts()` judges a night by the
newest nightly-kind run started that day, **any trigger — a workflow_dispatch
counts**. So a human noticing and re-running by hand makes a dead scheduler
report a good night. It cannot distinguish "the schedule worked" from "someone
rescued it". That blind spot matters more, not less, on a laptop.

Fixing it is small and does not need the rest of this entry: judge the SCHEDULE
separately from the DATA, so a manual run still counts the night's data as
present while the missed firing is reported on its own.

### Why the nightly is the wrong job to move first

Measured from `refresh_runs` on 2026-09-24:

| | intraday slot | nightly |
|---|---|---|
| duration | **2.5 min** | **25–72 min**, 19–22 rounds |
| a missed one | invisible, self-heals next slot | **permanent** |

`fundamentals_history` cannot be backfilled — the provider only ever returns
today's numbers — so a night not recorded is gone. The laptop would have to stay
awake, plugged in and online **ten to thirty times longer**, starting at 4:15pm,
which is when a laptop is most likely to be shut and carried somewhere. 4 of the
last 11 nightlies already ended `abandoned`.

**The proposal was not to choose.** Let GitHub and the laptop both fire and let
the run record settle it: the route already answers `{done:true}` at once for a
run that is already complete (the 2026-09-19 fix), so the loser costs one HTTP
call. Two weak hosts racing beat either alone, and neither is then a single
point of failure.

### The shape, if it is built

Not N toggles — a registry, of which the off switch is the least important part:

- a **jobs table** (id, name, enabled, expected cadence), so a new job is a row;
- **one gate** — the runner asks "should I run?" and gets yes or a reason, which
  is the shape `/api/cron/intraday` already has with four gates (weekend,
  9:38–16:00 New York, another refresh running, NYSE closed). A fifth for
  "paused" belongs there, before the NYSE check, which costs a credit;
- a **heartbeat keyed on the SCHEDULE rather than on the data** — the defect
  above;
- one page: last seen, next expected, on/off, recent outcomes. `/refreshes` is
  most of it already.

Roughly half a day for registry, gate and page. **The off switch is the easy
part; noticing silence is the hard one**, and it is the only part that pays for
itself on a laptop.

### What already works and needs nothing

Task Scheduler can disable the task today — `Disable-ScheduledTask -TaskName
"TickrLab intraday prices"`, or `.\intraday-task.ps1 -Remove`. It only works at
the machine, which is the single reason to want a server-side flag at all.

**Do NOT build** a web UI that drives the Windows task. It needs an agent on the
laptop polling the cloud for commands: more moving parts and a new security
surface, to duplicate what a server-side gate does better.

---

## 10. A separate sending domain for the newsletter — parked 2026-09-25

**The list broadcasts from `mail.tickrlab.com`, the same subdomain as password
resets, the contact form and the refresh report.** They share one sender
reputation, so a bad complaint week on the newsletter can push a password reset
into somebody's spam folder — and a reset landing in spam is somebody locked out
of their own account.

**THE CODE IS ALREADY DONE and this is the thing to know.** `MAIL_FROM_BULK` is
wired and deployed: set it to an address on a verified second domain and
broadcasts move there while every transactional message stays put. Unset — which
is how production runs today — it falls back to `MAIL_FROM` and nothing changes.
The display name comes from `BRAND` either way, so the two can never read as
different senders. Four checks cover it.

**What is left cannot be done from here.** The Resend API key is restricted to
sending (`GET /domains` answers `401 restricted_api_key`, which is worth
keeping — a leaked key cannot reshape the account), so adding a domain is
dashboard work:

1. Resend → Domains → add `news.tickrlab.com`; it generates three records.
2. Vercel DNS → add them: SPF `TXT` and the bounce `MX` on
   `send.news.tickrlab.com`, DKIM `TXT` on `resend._domainkey.news.tickrlab.com`
   (the same shape the existing domain uses).
3. Resend → Verify.
4. Vercel env → `MAIL_FROM_BULK=Tickr Lab <posts@news.tickrlab.com>`, redeploy.

**No DMARC change is needed** — `_dmarc.tickrlab.com` is `p=quarantine`, `sp=`
is unset so subdomains inherit it, and alignment is relaxed by default.

**What would make it a bad idea, stated honestly: there are zero subscribers.**
This is infrastructure for a problem the list does not have yet. Double opt-in
and a blog audience mean a very low complaint rate, and the shared domain will
be fine for a long time. The single argument for doing it early is that a
domain's reputation accrues from its first send, so starting the newsletter on
`news.` means it builds its own history rather than moving later. **Defer until
the list has real size and nothing is lost but the re-warming.**

**Two smaller things left with the owner the same day**, neither of them code:

- **The postal address on `/subscribers` is unset.** CAN-SPAM wants a real one
  in commercial bulk mail. It is a field on that page now (an `app_meta` site
  setting, not an env var, so no deploy and no dashboard), flagged amber until
  filled. Nobody but the owner can supply a real address, and a fabricated one
  is worse than none.
- **Nobody has subscribed yet**, deliberately: a fake address on production
  bounces, and bounces damage the reputation the resets share. The first
  confirm → post → unsubscribe walk should be a real one.

### What the first real broadcast measured — 2026-09-26

**The first post to a real subscriber was DELIVERED, and the owner still did
not receive it.** `An introduction to TickrLab`, 10.7 KB, to
`cmandal@investcorp.com`: the email log recorded it accepted (provider id
`01a0dd43-73bb-715c-b319-8854e5e0a28e`) and Resend's own dashboard shows a
**Delivered** event one second later. The near-identical copy to Gmail six
seconds afterwards arrived normally.

- **"Delivered" and "not in the inbox" are CONSISTENT, and that is the thing to
  remember before diagnosing the next one.** Delivered means the receiving MTA
  answered 250; where the message is filed afterwards is a second decision by a
  different system. Proofpoint, Mimecast and Defender all accept at the edge and
  quarantine internally. A gateway that distrusted the sender would have refused
  at SMTP or bounced, so this rules out SPF, DKIM, DMARC and domain reputation
  as the blocker — every one of which was the leading hypothesis beforehand.
- **It also killed the previous explanation.** The earlier `grid-post` failure
  was put down to 2 MB of images and 84 words of placeholder text. This message
  was 10.7 KB of clean prose and was filed the same way, so content weight was
  never the cause.
- **The owner deprioritised it** (2026-09-26): Gmail is delivering and a
  Proofpoint tenant's quarantine policy is not fixable from this side. Releasing
  it and allowlisting `mail.tickrlab.com` is the recipient-side fix if it ever
  matters again.
- **`MAIL_FROM` is `no-reply@mail.tickrlab.com`, which Resend's own insight
  panel flags.** A no-reply sender announces one-way bulk, which is the
  classification to avoid. Resend verifies the DOMAIN rather than the address,
  so `hello@mail.tickrlab.com` needs no DNS and works at once — **but nothing
  receives mail at `mail.tickrlab.com`** (no MX), so a reply would hard-bounce.
  The honest version is a forwarder first (ImprovMX or Forward Email, both fine
  with Vercel DNS), then the env change. Deferred with the postal address, and
  for the same reason: neither is proven causal here, and both are hygiene for
  when the list has more than one person on it.

---

## 11. Sign in with Google — scoped 2026-09-26, not built

**Asked about, costed, and deferred.** Google sign-in removes friction at the
top of a funnel this app deliberately gates at the bottom with owner approval,
and with four accounts the password form is not what is costing signups. The
Instagram push is what would produce evidence either way. **Roughly a
half-session whenever it is wanted.**

**The owner's constraint, recorded before the code exists: the `admin` account
must never NEED Google, and Google must not be a way INTO it.** The admin keeps
a password and the `ADMIN_PASSWORD` escape hatch stays. Compromising a Google
account must not compromise the instance.

**What it needs, and the part that is smaller than it looks:**

- **Console, not code**: a Google Cloud project, consent screen External,
  **scopes `openid` / `email` / `profile` and nothing more** — those are
  non-sensitive and avoid the verification review that sensitive scopes
  trigger. Publish to Production (Testing caps at 100 users and expires tokens
  after 7 days). Redirect URI `https://www.tickrlab.com/api/auth/google/callback`
  — **the `www` host**, because URIs match exactly and the bare domain 308s.
  Two env vars.
- **No dependency.** Authorization-code flow over plain `fetch`, the reasoning
  Resend already follows. **The `id_token` signature does NOT need verifying**
  — Google's own docs sanction skipping it when the token arrives directly
  from their token endpoint over TLS in a server-to-server exchange, which
  removes the only fiddly part (JWKS fetch, `kid` matching, RS256). Check
  `aud`, `iss`, `exp`, `nonce` and **`email_verified`**.
- **Match on `sub`, never email** — `sub` is stable, an email under it is not.
  Auto-linking to an existing password account on email match is safe ONLY
  while `email_verified` is true; that check is the whole thing standing
  between this and an account-takeover path.
- **`password_hash` and `salt` are `not null` and SQLite cannot relax that**
  without a table rebuild. Give a Google-only account a random unusable hash
  and salt instead — no migration, and `verifyPassword` can never accidentally
  succeed.
- **A Google signup still lands `pending`.** Otherwise it is a door beside the
  gate, and the same reasoning applies to `SIGNUP_CODE`.
- **Sessions are untouched**, which is why this is small: Google answers "who
  is this, the first time" and the callback then mints the same 32-byte
  `sessions` row. `getSessionUser`, the 30-day expiry and revocation all stand.
- **Enumeration**: a password attempt against a Google-only account must return
  the same generic 401. "This account uses Google" is a leak, and the login
  route currently has the non-leaking property — keep it.

---

## 12. Alerts — specced 2026-09-26 with the owner, not built

**"Users should be able to set up alerts on things like a price level, a moving
average crossing, and see them as soon as they log in."** Scoped in
conversation; every decision below is the owner's.

| decision | the owner's call |
|---|---|
| what can be watched | **a single stock**, never a portfolio or the whole universe |
| delivery | **in-app only — NO EMAIL** |
| how many | **5 per account** |
| who | members and admin; guests excluded (no prefs key, 5-stock preview) |
| when evaluated | every intraday slot **and** the nightly |
| how expressed | a short **fixed list of types**, not the filter grammar |

### The constraint that shapes everything: these cannot be real-time

Prices land on a schedule — the nightly at 4:15 PM ET and intraday every 30
minutes between 9:38 and 16:00 New York, driven from the owner's laptop, with a
full lap of the universe taking three rounds inside a slot. So an alert fires
**when new data arrives**: up to ~30 minutes late intraday, next morning outside
the session. Streaming prices are ruled out by the 610-credit/minute ceiling.

**This is a "what changed on my watchlist" feature, not a trading trigger, and
the UI has to say so.** A screen implying someone can act on an intraday
crossing will disappoint.

### The fixed list is a UI decision, NOT a data-layer one

The owner chose a dropdown of types over reusing the filter grammar. The cost of
that — a second implementation of the comparisons, drifting from the screener's
— **is avoidable and must be avoided**: each type compiles down to
`Filters.filterValue(row, key)` for its reading, so "price above 150" and the
screener's `>150` in the Price column ask the same function the same question.
The dropdown is what the user sees; `filters.js` is still the only place a
comparison is defined. This is the rule `rowcard.js`, `action.js`, `cards.js`
and `filters.js` all exist to enforce.

Six types for v1, all reading fields already on every snapshot row:

| type | reads | fires on |
|---|---|---|
| Price level | `price` | crossing above / below a number |
| Moving-average cross | `vs50ma`, `vs200ma`, `maCrossRank` | price crossing its 50D or 200D; 50D crossing 200D |
| Advice verdict change | `action` vs `advicePrev` | upgraded / downgraded / either |
| RSI level | `rsi` | crossing 70 / 30, or a chosen number |
| 52-week extreme | `daysSince52wHigh` / `Low` | a new 52-week high or low today |
| Big day | `todayPct` | a move beyond ±X% |

**"Earnings soon" was cut from v1 deliberately** — it is a countdown, not an
edge, so it needs different re-arm logic and would muddy the first build.

**Never "price target".** `/terms` says *"No price targets — a target is a
forecast wearing a decimal point."* The type is a **price level**.

### The hard part is the edge, not the threshold

Every one of these has bitten this codebase in another guise:

- **A level is not an event.** "Price above 150" is true every round once true.
  Fire on the TRANSITION, which means storing the previous side.
- **A null is not a zero.** A missing price coerces to 0 and would fire every
  "below $150" alert at once. The `num()` / credits-header / `activity.ms`
  lesson, and this is where it does the most damage. **Reject the empty before
  coercing.**
- **Gaps.** 140 → 160 overnight never touched 150. The test is the **sign of
  `value − threshold` changing**, never equality.
- **An alert created while its condition is already true** must arm silently and
  say so on screen. Firing "crossed!" immediately would be a false statement.
- **Flapping** around a level sends a notification every 30 minutes. Needs
  one-shot (right for price levels) or a cooldown (right for verdict changes),
  chosen per type with a user override.

### Shape

- **`alerts`** — id, user_key, symbol, kind, params JSON, active, one-shot vs
  repeating, created_at, **plus `last_side` and `last_fired_at` on the row
  itself**. A separate state table is only needed for multi-symbol scopes, and
  the owner ruled those out.
- **`alert_events`** — the in-app inbox: alert_id, user_key, symbol, at, the
  rendered sentence, read_at. **Pruned like every other log here** (90 days,
  beside `pruneActivity` / `pruneMailLog` / `pruneVisitors`).
- The symbol is **validated against the live universe server-side and silently
  dropped otherwise** — the member-portfolios invariant: a member can never add
  a stock to the system.
- `ALERTS_MAX = 5`, the `VIEWS_MAX` / `POSTS_MAX` / `FAVS_MAX` pattern. One
  constant to raise later.

### Where it runs

**NOT in the refresh tail.** Three incidents — the news top-up (2026-09-18),
`techHistorySpan` (2026-09-19), `archiveStats` (2026-09-20) — were all work
added there, and all three surfaced as "the refresh failed" over data that was
fine. Alert evaluation is exactly that shape.

A new **`/api/cron/alerts`**, bearer-authenticated like the others, called by
`intraday-ping.js` **after the FULL round of a slot** — the light rounds write
bars but do not rebuild the snapshot, so there is nothing new to evaluate until
the last round. One extra HTTP call per slot from the laptop.

### Delivery

- **Unread count rides `GET /api/prefs`**, which every page already awaits
  before its first render. A second round trip per page load is the
  six-reads-in-series lesson.
- An **`/alerts` page** for the list, and a badge in the bar.
- **No interstitial on login.** "Shown as soon as someone logs in" is satisfied
  by a badge you can ignore; a modal you must dismiss is worse.
- **Wording is a fact, never an instruction**: *"NVDA crossed above its 200-day
  — $178.40 against a 200-day of $176.10."* Never *"NVDA is a buy."* The rule
  the cards, the verdict columns and `/terms` already follow.

### What it would take, and what would make it a bad idea

Two tables, one cron route, one page, a type registry compiling to
`filterValue`, and a test suite whose real subject is the five edge cases above
— a fixture that crosses, re-crosses, gaps over, goes null, and starts already
true. **Roughly a session.**

**Against doing it now:** four accounts, one of them a test row. Nobody has
asked for it but the owner, and the intraday cadence depends on a laptop being
awake. It is also the first feature whose value depends on people logging in
regularly, which is not yet true of this site.

**One consequence to remember:** `/privacy` lists every table and its retention.
Adding `alerts` and `alert_events` means updating that page in the same commit —
the policy is written to match the software.

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
