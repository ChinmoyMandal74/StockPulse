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

> **REBUILT 2026-09-28 — the data half is done, the payload half became entry
> 15.** Both files now carry the real **1,182** symbols against a 4.58M-bar
> archive. **This entry's size estimate was right**: it predicted ~27MB raw and
> ~7MB gzipped for `single-closes.json` and the rebuild measured **32.94MB raw,
> 8.6MB gzipped**. Its warning that "a rebuild would produce something
> unservable" was half right — the bundle is fine (`private/` is 49MB against
> Vercel's 250MB) and the page loads, but 8.6MB on a page load is not something
> to leave alone. Shipped anyway, because the alternative — capping the depth —
> changes what the page's numbers mean. The delivery fix is entry 15.

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

> **REBUILDING 2026-09-28, and it is NOT "the cheap one" any more.** This entry
> called it 300KB and a quick offline run. Measured on the deepened archive:
> `lab-grid.js` **aborted out of memory** (exit 134) because it loads every bar
> into JS in one statement — `select symbol, d, close from bars order by
> symbol, d`, which went from 852k rows to **4.58M**. It needs
> `--max-old-space-size=5120`, and the grid is now **920 parameter sets over
> 1,182 symbols** rather than 192 over 93: **~2¼ hours**, against the 28.1s
> recorded below. Re-measure before believing any timing here.

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

> **The direction has since reversed — see entry 14 (2026-09-28).** The owner
> now wants the laptop dependency *removed* rather than the nightly moved onto
> it. The measurements below still stand and are the reason: a nightly wants a
> host that stays awake for 25–72 minutes, which a laptop at 4:15pm is not. The
> defect named next — that the watchdog cannot tell a working schedule from a
> human rescue — matters more, not less, once the host changes.

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
- **THE CALLBACK MUST ENFORCE `SIGNUP_CODE` ITSELF — corrected 2026-09-26,
  later the same day.** This entry originally said only "a Google signup still
  lands `pending`", which was true when the approval queue was the gate. It
  is not any more: `REQUIRE_APPROVAL=false` makes every new account `active`
  immediately (server.js line ~1751), so "lands pending" becomes a no-op and
  the invite code is the ONLY door. And `SIGNUP_CODE` is checked in exactly
  one place — inside `POST /api/register` (line ~1725) — which a Google
  callback would never pass through. Shipped as first scoped, **Google sign-in
  would be an unlocked side door past the gate the invite code exists to be**.
  So the flow has to carry the code (ask for it before the redirect and keep
  it in the `state`, or collect it on a first-time-here step in the callback)
  and refuse without it, exactly as the register route does — the same
  tolerant compare, since it will be typed on a phone.
- **Sessions are untouched**, which is why this is small: Google answers "who
  is this, the first time" and the callback then mints the same 32-byte
  `sessions` row. `getSessionUser`, the 30-day expiry and revocation all stand.
- **Enumeration**: a password attempt against a Google-only account must return
  the same generic 401. "This account uses Google" is a leak, and the login
  route currently has the non-leaking property — keep it.

---

## 12. The insider table is 89 days behind, and waiting is the cheap fix — 2026-09-27

**Measured on production the day the daily walk shipped**: 8 quarters, **224,367
transactions, through 2026-07-01, 89 days behind** the calendar. The quarterly
Form 345 data sets are published after a quarter ends, so the table was born
stale; the daily walk exists to close the recent end and has so far advanced
**one day** before the SEC began refusing this address.

**It is not currently wrong, only old, and every surface says so.** The card
prints a filing date on every row, and this staleness is exactly why an insider
column was refused on the screener. What it costs today: "who bought in the last
90 days" answers **3 names when the truth is 188** — fine under a dated card,
fatal anywhere presenting itself as current.

**Two ways to close it, and the second is nearly free:**

- **Walk it locally** — `node --use-system-ca insider-load.js --commit --daily`.
  Paced at 130ms, filtered before anything is fetched. **Measured**: one real
  day (2026-07-02, the day after a quarter closed, so a peak) held **819
  filings for our universe**. **Estimated, not measured**: ~62 trading days at a
  few hundred filings each is on the order of 15,000–20,000 document fetches —
  roughly three quarters of an hour of pure pacing, plus the SEC's own response
  time, so budget hours rather than minutes. The earlier "~5 hours" figure
  quoted in conversation is a guess with nothing behind it.
- **Wait for the Q3 bulk file.** Q3 ends 2026-09-30 and the data set is
  published some weeks after — **the exact lag is not measured**; check
  `https://www.sec.gov/files/datastandardsinnovation/data/insider-transactions-data-sets/2026q3_form345.zip`.
  One quarter loads in about **45 seconds** (measured: 8 quarters in 5.9
  minutes), and it closes everything through 2026-09-30 at once, leaving only
  the days since to walk. **This is almost certainly the right answer** — it
  trades a few weeks of staleness against hours of SEC traffic for data nothing
  yet depends on.

**There is no front end for the quarterly load, deliberately** — an 11MB zip
unpacking to ~60MB of TSV has no business in a serverless request, the same
reason `backfill-bars.js` is local. `/admin`'s insider panel drives only the
one-day walk. Since 2026-09-27 a quarterly load **advances the day cursor to the
quarter's last day**, so the walk resumes after the quarter rather than
re-crawling it; before that fix, loading Q3 would have sent it back over ninety
days of filings the file had just delivered.

**What would make the first option a bad idea.** It already went wrong once:
driving the browser loop at the gap made 130 calls, advanced one day and earned
an HTTP 429 and then a 403. The route now reports a throttle as a wait rather
than a failure and the console backs off, but **the address is the thing being
rate-limited** — a long catch-up belongs on one paced machine, not in a
serverless loop, and not twice in a day. See CLAUDE.md, *Then the first real
catch-up earned an HTTP 429*.

**Do not treat a nonzero `behind` as work to do without checking which.** The
number is on `/api/insider/coverage` and on `/admin`, amber past a week.

---

## 13. Onboarding a new ticker is a manual sequence, and one dataset has a hole — 2026-09-27

The owner's note: **stocks keep being added, and there must be a way to backfill
everything for them — EDGAR and insider trades included.** What follows is what
actually happens today, checked rather than recalled.

| dataset | what fills it for a new ticker | state |
|---|---|---|
| name | the stored NASDAQ listing, at add time, no credits | automatic |
| bars | `backfill-bars.js --commit --only …`, **local** | manual, and **ordered** |
| profile, fundamentals, earnings | `Fill missing` on `/admin`, or the nightly gap fill | covered |
| SEC EDGAR facts | `Fetch missing` on `/admin` — `secPlan()` treats a symbol with no `sec_state` row as stale | covered |
| insider transactions | **nothing** | see below |

**Bars are ordered, not merely manual.** Run `backfill-bars.js` BEFORE the next
price refresh or that refresh tries to build every new archive inside one
serverless request: measured 2026-09-22, **HTTP 504 at 300.128s** with 47 thin
symbols. `/quality` prints the ready `--only` command.

**Insider is the interesting one, and it is half-covered by accident.**
`Insider.build()` is pure and **has no universe filter** — the quarterly loader
stores every filer's open-market rows, ~28,000 a quarter. So a newly added
ticker's insider history *for the loaded quarters is already in the table*. It
does not appear on the card only because `readInsider(cik)` needs the issuer
CIK, and the one thing that resolves a CIK is the filings loader. **So the order
is: `Fetch missing` first, and the insider card then lights up for free.** That
dependency is invisible and worth knowing.

**The actual hole is the daily walk.** It filters against `readUniverseCiks()`
*before fetching*, which is what makes it affordable — but it means **every day
already walked was filtered to the universe as it stood then**, so a ticker
added afterwards has a permanent gap over exactly those days, and nothing in the
app will ever fill it. Today that is one day and worthless; the cost grows with
the walked window, so this is worth fixing before the walk has covered months.

**What it would take, and it is small:**

- **For days inside a published quarter** — re-load that quarter with
  `insider-load.js --commit --force --from … --to …`. The bulk file is not
  universe-filtered, so it picks the new company up with no targeting at all.
  Measured: **~45 seconds a quarter**.
- **For days walked past the last published quarter** — a targeted re-walk. A
  day's index is **one fetch** and the documents are filtered by CIK, so
  re-walking ninety days for a handful of new tickers is ~90 index reads plus a
  few dozen documents: minutes, not the hours a full re-walk would cost.
  `insider-load.js --daily` already has the loop; it needs a from-date and a CIK
  restriction rather than the cursor.
- **Do NOT fix it by rewinding the cursor.** That re-fetches every filing for
  every company over the window — thousands of documents against an address the
  SEC has already throttled once.

**And make it visible, which is the cheaper half.** `/quality` is the page whose
job is saying what is held per stock, and it **does not mention `sec_facts` or
`insider_trans` at all** (checked: zero references). Its per-dataset chart
already draws seven clickable tracks; two more entries would turn "did I
remember to run Fetch missing after that bulk add" into something you can see.
That is the change to make first — a gap you can see gets filled, and one you
cannot does not.

---

## 14. Getting the scheduled jobs off the laptop — 2026-09-28

The owner's question: **as the number of refresh jobs grows, how is the laptop
dependency removed — is a cloud machine the answer?** Recommendation below;
nothing built.

**What is actually on the laptop, checked rather than recalled**: two Windows
tasks, `TickrLab intraday prices` and `TickrLab news`, both **pings** — they
read `CRON_SECRET` and `APP_URL` from `.env` and ask the deployed app to do the
work. The nightly is still GitHub Actions; the watchdog is a Vercel cron.

### Sort the jobs by whether they need a COMPUTER or a CLOCK — that decides it

| | jobs | what it needs |
|---|---|---|
| **A. clocks** | intraday ping, news ping, the nightly loop | something that stays alive 2–70 min and loops |
| **B. computers** | `backfill-bars`, `insider-load`, `analysis-db`, the research builders | real disk, RAM, unzip — but **run by hand when something changes, never on a schedule** |

**A VM solves the wrong half.** Type B is the only work that wants a machine,
and it is manual and occasional — a server does not remove the human, it moves
where they type. Type A is the actual laptop dependency and needs no machine.

### The awkward detail that rules out the cheap answers

**The pings LOOP, and the server plans the slot.** An intraday slot is 3 rounds
over **2m34s, of which 130s is two mandatory 62s gaps** (measured), and the
round count comes from the server (`?dry=1` returns `rounds`) so it stays
correct as the universe grows. **Vercel cron and cron-job.org each fire one
request and walk away.** Either could drive it only by re-expressing the slot as
three fixed cron entries at minute offsets — which works today and **gives up
the server-side planning**, so the schedule silently under-covers the first time
`PRICE_SLICE` no longer divides the universe into three.

### The recommendation: a scheduled-container runner, not a VM

Something that runs `node intraday-ping.js` **unchanged**, on a schedule, with
no OS to maintain: **Render Cron Jobs, Fly.io scheduled machines, or Railway
cron**. Deploys from this repo, secrets in the platform's env. **Price not
verified — on the order of $1–7/month**, and which of the three behaves best is
untested.

- **A VM** (Hetzner, Lightsail, Oracle free tier) also works and suits Type B
  better, at a real cost beyond money: a **second copy of `.env` carrying
  production Turso, Twelve Data and `CRON_SECRET`**, OS and Node upkeep, and
  `insider-load.js` is **Windows-only today** (PowerShell `Expand-Archive`), so
  it needs an unzip change before it runs on Linux at all.
- **Not more GitHub Actions.** It is already the nightly's host and already
  failing — see entry 9: no scheduled nightly since 2026-09-20.
- **For Type B specifically**, a `workflow_dispatch` job is a better shape than
  a VM when you do want it off the laptop: a clean Linux box on demand, secrets
  already in the repo settings, nothing running when it is not needed. Same
  unzip caveat.

### Two things to do before or alongside the move

1. **Fix the heartbeat blind spot first** (entry 9). `nightVerdicts()` judges a
   night by its DATA and counts a `workflow_dispatch` rescue as a good night, so
   a dead scheduler reports green. Moving a job you cannot tell is failing
   relocates the blind spot rather than closing it.
2. **Do not move the nightly — race it.** 25–72 minutes and 19–22 rounds is why
   it needs a live runner. The route already answers `{done:true}` at once for a
   completed run (the 2026-09-19 fix), so letting GitHub and a new runner both
   fire costs the loser one HTTP call and leaves neither a single point of
   failure. The real fix is **entry 5**: give the cron route a fast mode, whose
   rounds are seconds rather than minutes.

**What makes any of this safe is already built**: the server decides whether to
act — weekday, 9:38–16:00 New York, nothing else running, NYSE open. A broad,
dumb schedule from anywhere is fine, which was the design.

---

## 15. `/single` now downloads 8.6 MB, and the fix is a page change — 2026-09-28

**Measured after the deep backfill**: `private/single-closes.json` went from
**2.52 MB to 32.94 MB raw, 8.6 MB gzipped** — the file `/single` downloads in
full so it can simulate in the browser. This file's own note recorded "~700 KB
gzipped at 93 symbols (888 KB at 116)"; it is now 1,182 symbols with up to
twenty years each, and the page weight grew with it.

**Shipped as-is deliberately, and the alternative was rejected on purpose.**
Capping the depth in `single-data.js` would halve the file and **silently
change what the page's numbers mean** — its whole argument is a rule swept over
eighteen years, and a ten-year version reporting the same labels is the quiet
redefinition this project otherwise refuses. Bandwidth is not a good enough
reason. It is a members-only research page, not the screener, and the bundle is
fine: `private/` totals **49 MB** against Vercel's 250 MB.

**The real fix is a page change, not a build flag.** `/single` needs two
different things and currently gets both from one file:

- **the chosen stock's own history**, at full depth — which
  `GET /api/history?symbol=&days=` already serves at **~1.9 KB a year**, reads
  the archive only, and costs no credits. Fetch it on demand.
- **the universe sweep**, which needs every symbol but is a summary statistic
  per stock rather than a chart. It could ship far less per symbol, or move
  server-side the way `/api/m/screen` did when the phone page faced exactly
  this "do not send the browser 1.3 MB" problem.

Split that way the page loads in kilobytes and keeps every number it reports.

**What it would take**: the fetch-on-demand half is small — the endpoint,
cache and range handling all exist and `/stock` already uses them. The sweep
half needs a decision about where it runs, and that is the part to think about
rather than type.

**Do not "fix" this by trimming the universe or the depth.** Both change the
answer; only the delivery should change.

---

## 16. The offline builders have no sub-cent floor, and the lab grid is wrong without one — 2026-09-28

**`lab-grid.js` rebuilt on the deepened archive and printed decile returns of
`-179.87%` and `-504.12%` for a one-month forward horizon.** A long position
floors at −100%, so those are not returns; they are what a sub-cent anchor does
to an average. The rebuilt file was **reverted rather than committed** — `/lab`
prints "the best |t| anywhere on the grid" as its honesty anchor, and an anchor
reading −504% is worse than a stale one.

**The cause is understood and is not a bug in the grid.** `MIN_CLOSE` (a cent)
was added to `server.js` on the same day and guards `pctChange` and the 5Y
anchor, so the screener, the cards, the phone and `/consolidated` are covered.
**The offline builders read the archive directly and have no equivalent**, so
`lab-grid.js`, `single-data.js` and `strategy-runs.js` still divide by prices
that are not prices.

**Two symbols do it, and only one was bad data:**

- **SOLS** — stored *and served by the provider* at `$0.000099999997` from 2024
  to 2025-04-10, then $56. Genuinely corrupt; **removed from the universe**
  2026-09-28 and purged from production. It survives in the LOCAL
  `analysis.db`, which predates the removal, so a `--full` rebuild drops it.
- **APLD** — **1,304 sub-cent bars and they are REAL.** Applied Digital traded
  as a sub-penny shell ($0.0085 in October 2020) before its 2021 pivot, and is
  $49.65 now. Nothing to repair: the history is true. But a five-year return of
  **+291,000%** off a shell price is arithmetically correct and analytically
  meaningless, and it will dominate any average it enters. **This is the case
  that matters**, because removing a ticker cannot fix it and the next
  reverse-merger shell will do the same.

**`techrow.js` HAS THE FLOOR NOW (2026-09-28), which leaves three.** It was not
on the list above and should have been: it stores `m1`, `m3`, `vs200`, `vs50`
and `from_high` into `tech_history`, every one of them a division by a close.
Measured on the rebuilt archive before the change — **APLD is the only symbol
left, 1,304 sub-cent bars spanning 2008-12-11 to 2020-10-22**, and **548 of its
950 weekly marks** have a 52-week window touching them.

**The floor propagates to the verdict, which is why no second guard was
needed.** With null trend inputs the engine lands on `No trend data`, so a
poisoned row cannot qualify for a tier and never enters a `/trend-backtest`
basket: all 262 shell-era marks read `Hold (No trend data)` and **0** qualify.
**Proved by reverting**: without it, 11 of them become **`Buy` at $0.0028,
$0.0029 and $0.0025** — positions that later become $50 and dominate whatever
window they land in. APLD's ordinary marks are untouched (Buy 55 against 58).

Still outstanding: `lab-grid.js`, `single-data.js` and `strategy-runs.js`.

**What it would take.** The floor already exists and is already reasoned about
in `server.js` and now in `techrow.js`; the rest need the same test where they
compute a return —
refuse a window whose anchor is under a cent, and count what was refused rather
than dropping it silently. That is a few lines each, and the honest version
reports the count so a rising number is visible.

**What would make it a bad idea**: applying the floor to the PRICES rather than
to the RETURNS. The bars are not wrong for APLD and must keep drawing its
chart; only the arithmetic that divides by them needs the guard.

**Also outstanding from the same day**: `analysis.db`, `single-closes.json` and
the fourteen `strategy-*.json` were rebuilt BEFORE SOLS was removed, so they
still carry a dead ticker. The documented sequence — `analysis-db.js --full`,
then `single-data.js`, `strategy-runs.js`, `lab-grid.js` — has to be re-run
anyway, and the floor should land before the rebuild rather than after it.

---

## 17. Backtesting Adjusted Advice — PARTLY BUILT 2026-09-29

> **`/adjustedbacktest` now exists** and does the single-window half: pick a
> date from 2018, the rules are replayed on filings public then, and the
> equal-weight basket is drawn against the universe and the S&P — with the
> same controls `/backtest` carries (how many to hold, rank by, rebalance,
> what to do on each rebalance, cost), through the **shared** `btRebalance`
> loop rather than a second copy of it. Read the
> CLAUDE.md section before this entry — several traps listed below are
> **solved** there, and one of them (the derived quarter dated by a filing
> two years later) was not anticipated here at all.
>
> **What is still open, in the order it matters:**
>
> 1. **A ROLLING SWEEP. This is the one that turns it from an anecdote into
>    evidence** — one window is one observation, and four spot readings came
>    back positive, which the research log says to distrust. Blocked on cost:
>    a single window is ~35s on production and 65-80s from a laptop, and
>    **the bars are nearly all of it** — measured in isolation, 56.0s against
>    1.6s for the filings and 1.2s for short interest, while the controls add
>    almost nothing (a top-N cut 0s, a fortnightly rebalance 1.2s). So a
>    200-window sweep is hours and optimising anything but the bar read is
>    spent in the wrong place. The lever is precomputing an `adjusted_history`
>    table the way `tech_history` was precomputed for `/trend-backtest` —
>    filings change only when one is filed, so a per-symbol point-in-time
>    overlay per month is a small table and would make a sweep instant.
> 2. **Survivorship**, unchanged and still the ceiling. See below.
> 3. **Pin FINRA's dissemination lag.** `SHORT_LAG_DAYS` is a conservative 15
>    calendar days against a schedule that implies ~10-12; the table stores
>    settlement dates and nothing else, so it cannot be measured from what is
>    held. FINRA publishes its own calendar.
> 4. **As-first-reported.** `visibleAsOf` takes the newest filing public on
>    the date, which is right — that is what a reader had. Taking the EARLIEST
>    `filed` per period would answer a different and also interesting
>    question (what was said before any restatement) and is not built.
> 5. ~~Rebalancing, a top-N cut and the trade log, which `/backtest` has.~~
>    **Built 2026-09-29**, at the owner's request the same day
>    ("you are not giving the option to select How many to hold and
>    rebalancing options in this adjusted version"). The extraction was
>    proved inert by diffing `/api/backtest`'s own response over five
>    parameter sets — 6,171 structural fields, 0 differences, against a
>    same-code-twice control that isolates the market moving underneath.

`/adjusted` exists and shows the fields. The owner asked to see those first
("I do not want to run the back test now, I want to see the advice data
first") and then asked for the backtest the same day; both are built, and
what remains open is the list above.

**Why it is the strongest case this data has.** `/backtest` is capped at two
months because `fundamentals_history` began 2026-08-30 and everything before
that imputes *today's* fundamentals — a look-ahead. `/trend-backtest` reaches
twenty years but reads bars alone. So today you can have an honest verdict or
a long history, never both. Filings carry a `filed` date, which is the day a
figure became public, so they are the one fundamental source here that can be
made genuinely point-in-time.

**What is already in place.** `adjusted.js` assembles the engine row and
`action.js` scores it unchanged; `sec_facts` carries `filed`/`form`/`accn` per
observation; FINRA closes the `shortPctFloat` hole back to 2017-12-29 (this
file and CLAUDE.md both used to say that input was unreconstructible — that is
stale); `tech_history` already stores every bar-derived input the rules read,
891,537 rows back to 2001, with the sub-cent floor applied.

**What a backtest must do that the page does not.**

- **Use `filed`, never `periodEnd`.** MU's quarter ended 2026-05-28 and was
  filed 2026-06-25 — using the period end buys four weeks of look-ahead. The
  same lesson the insider `filed`/`transDate` split already records.
- **Take as-first-reported, not the latest restatement.** The page correctly
  shows the newest version of each period; a backtest must take the EARLIEST
  `filed`. The trail is stored, so this is recoverable — but only deliberately.
  Note `latestFilled` fills blanks from *older* filings, which is right for a
  current view and needs re-thinking under a point-in-time one.
- **Pin FINRA's dissemination lag** (roughly eight business days after
  settlement) against their calendar before trusting it.
- **Expect the company TYPE to vary over time.** It is decided by
  fundamentals, so a company can move between rulebooks mid-backtest. Correct,
  and a behaviour nobody has seen yet.
- **State that our FCF is not the vendor's.** A 20.5pt definitional gap was
  measured on MU. A backtest on our FCF tests *our* definition and will not
  reconcile with the live screener.

**The binding constraints, in order.**

1. **Survivorship, which dwarfs everything else.** The universe is today's
   1,181 names; companies that died are absent. Perfect point-in-time
   fundamentals on a survivor-only pool is a better-measured biased answer.
   The SEC `submissions` API (delisted filers) is the lever.
2. **Coverage, measured 2026-09-29 and worse than the verdict column suggests.**
   A full trailing year reaches 90% of filers, but FCF margin reaches 54% and
   gross margin 58%. Establishment points lost against the live engine: free
   cash flow 151, priced on earnings 80, ROE 42. A backtest would be measuring
   a rulebook that is systematically short of points, not a different view.
3. **FINRA floors the honest window at ~2018**, so about 8 years. Earlier is
   runnable with `shortPctFloat` absent, but it only fires a *weak* clause, so
   the replay is silently **less strict** and must be labelled.

**The one thing to measure before writing any of it**: for how many
(symbol, date) pairs a complete point-in-time row can actually be assembled.
If coverage at a date is what it is today, the answer is thin and worth
knowing for a few hundred lines of effort rather than a few thousand.

---

## 18. The EDGAR rotation cannot sustain its own cutoff, and a bulk refresh synchronises it — 2026-10-01

**Asked for by the owner as "fixing the EDGAR refresh", straight after the Item
2.02 announcement date was folded into it.** The refresh works; what does not
work is its *cadence*, and the arithmetic is against it in two separate ways.

**Capacity, measured from the constants rather than guessed.** `nightly-ping.js`
runs `SEC_BATCH` 5 × `SEC_MAX_BATCHES` 20 = **100 symbols per run**, twice a
weekday (07:30 and 19:30), so **1,000 a week**. The universe is 1,192, of which
**1,167 have a CIK** and therefore need fetching. So steady-state capacity is
**86% of what one `SEC_ROTATE_DAYS` (7) cycle requires** — it cannot complete a
pass inside its own cutoff, and the shortfall grows with every ticker added.

**And the clocks are synchronised, which is worse than the shortfall.**
Measured on production 2026-10-01:

```
age of the last EDGAR fetch, in days
  0..1       3     <- two rotate batches driven by hand
  3..5    1164     <- every other symbol, one bulk `mode=all` run
  5..7       0
  7+         0
statuses: ok 1100, empty 63, nofacts 4
```

**1,164 of 1,167 share one timestamp.** A `mode=all` refresh sets every symbol's
clock to the same moment, so nothing is overdue until day 7 and then *everything*
is overdue on the same day. The rotation then drains 200 a weekday, taking
**~6 weekdays** to clear — during which the symbols it fetched first are already
going stale again. **Effective worst-case staleness is therefore ~13 days, not
7**: seven to become due plus six to drain. An announcement like MU's (filed
2026-09-30, found by the backfill the same day) could in principle sit
uncollected for a fortnight.

**Three fixes, cheapest first. They are not alternatives — the first two
compose.**

- **Raise `SEC_MAX_BATCHES`.** It is already an env var (`SEC_MAX_BATCHES`,
  default 20) and nothing else has to change: 30 gives 150 a run, 1,500 a week,
  which clears 1,167 with headroom. **The cost is SEC traffic and run length,
  and both are now doubled per symbol** — since 2026-10-01 each symbol makes
  **two** requests (companyfacts 1–5MB plus submissions ~0.15MB), so 150 symbols
  is 300 requests. At `SEC_GAP_MS` 1500 between batches that is 45s of pacing
  plus fetch time, inside the task's 2-hour `ExecutionTimeLimit` but worth
  measuring before raising it twice. **Not measured**: what a 30-batch run
  actually costs in wall clock.
- **Stagger the clocks once**, so the herd stops arriving together. A bulk
  `mode=all` is what creates the problem, and the repair is a one-off local
  script spreading `sec_state.fetched_at` across the cutoff window — 1,167
  single-column updates, the `backfill-sec-filed.js` shape. Then ~166 symbols
  come due a day and the rotation's own 200/weekday is comfortably enough.
  **Do this before raising the batch size**, or the batch size is sized against
  a backlog rather than against the steady state.
- **Walk the daily index for the recent end.** The sharper fix for
  announcements specifically, and **nearly free, because the fetch already
  happens**: `POST /api/insider/daily` reads EDGAR's daily index for the insider
  walk, and the same index lists 8-K filings with their CIK. Recording which of
  our CIKs filed an 8-K that day would let the refresh re-read **only those
  companies'** submissions files — a handful a day instead of 1,167 a week — so
  an announcement is picked up the next morning rather than within a fortnight.
  **The daily index carries no item numbers**, so the 2.02 test still needs the
  submissions file; the index only says who to ask.

**What would make the third option a bad idea, and it is already documented.**
The insider walk's universe filter **leaves a permanent hole for a ticker added
later** — every day already walked was filtered to the universe as it stood
then — so an 8-K ledger built from it inherits that gap (see entry 13). And the
walk is itself behind (entry 12), so it cannot close the recent end until it is
current.

**What is NOT wrong, and should not be "fixed" by accident.** The 7-day cutoff
itself is the right order of magnitude — filings land quarterly, and this file
has always said coverage rather than freshness is what the SEC path is for. The
`rotate` mode, its oldest-first ordering and the recorded-miss rule that lets
the loop terminate are all measured and tested; the problem is the *size* of
the window's throughput, not its design.

**Two related EDGAR items, carried here so they are not rediscovered separately:**

- **`/stock`'s SEC card still uses `latestPerPeriod`**, so it shows the dashes
  `latestFilled` fills — correct for a card whose claim is *one row, one
  filing*, and noted twice in CLAUDE.md as worth revisiting as its own
  decision.
- **Three faults `latestFilled`'s reconciliation is blind to**, each with a
  trail of one and nothing to cross-check against: a tiny revenue on a single
  filing (REXR files $0.0–0.2M for quarters that are really ~$250M), a
  **negative** derived revenue (FRHC Q4 to 2023-03-31 differences out at
  −$566.6M, which revenue cannot be), and a whole run restated together. The
  first is the one that matters — it lands on REITs and financials, already the
  sectors with the worst coverage.

---

## 19. Rebuilding the phone page — 2026-10-01

**The owner's instruction, given while regrouping the screener's columns:
"Ignore Mobile app, Lets rebuild it later, Add this to backlog."** So `/m` and
`/mobile-setup` were deliberately left out of that change, and this entry is
what a rebuild needs to know before it starts.

### The one real defect, measured rather than inferred
**A field key the catalogue no longer knows draws a LABELLED ROW WITH AN
EM-DASH, which reads as missing DATA rather than as a missing field** — the
more expensive of the two failures, because the reader concludes the figure is
unavailable for that company.

Measured through the real route on 2026-10-01, not read off the constant:

```
views offered: move(4) verdict(4) value(4)
  Move:    names 4 -> draws 4  [Today=+1.2% | 1W=+2.0% | 1M=+3.0% | 1Y=+20.0%]
  Verdict: names 4 -> draws 4  [Advice=Hold | Trend=No data | Entry=None | Overall=—]
  Value:   names 4 -> draws 4  [Fwd P/E=22.0 | ROE=+21.0% | Profit margin=+16.0% | Market Cap=$50.0B]
```

- **`rank|Overall` has been dead since 2026-09-23**, when the composite was
  removed. It is in `MOBILE_DEFAULT.views`, and **`cleanMobileConfig` filters
  unknown keys out of a SAVED config and then returns `MOBILE_DEFAULT.views`
  VERBATIM when nothing is stored** (`views.length ? views : MOBILE_DEFAULT.views`)
  — so the default is the one list nothing cleans, and it is the list in force.
- **An earlier note of mine said the view "silently serves 3 of 4 fields". That
  was wrong and this is the correction**: it serves four, one of them
  permanently blank. A row that is absent would at least look deliberate.
- Two candidate fixes, and they are different decisions: run the default
  through `cleanMobileConfig` like everything else (so the view loses the row),
  or make `mobileRow` omit a row whose key the catalogue cannot answer (so no
  stale key anywhere can ever print an em-dash). The second is the one that
  covers the hazard rather than this instance of it.

### The key scheme is what makes a regrouping a migration
A stored field key is **`groupId|columnLabel`** (`fieldCatalogue()`:
`key: g + '|' + label`). So **moving a column between groups, or relabelling
one, invalidates every saved tile and mobile key that names it** — while a
*group's* display label is free to change, because `GROUP_LABELS` maps id to
label separately. That asymmetry is why Size could become Scale for nothing
and why the other two fixes needed thought.

**What today's regrouping actually cost, measured against production before
shipping:**

| | |
|---|---|
| `mobile_config` | **not set** — the live phone runs `MOBILE_DEFAULT` |
| `tile_config` | set, 6 keys: `short|1W`, `short|1M`, `rel|% from 52W hi`, `trend|vs 50D MA`, `trend|vs 200D MA`, `fund|Earn grth Q YoY` |
| keys the change moved | `fund|Short % float` → `own|Short % float`; `vol|Vol trend` / `vol|Rel. volume` / `vol|$ volume` → `rel|…`; `vol|Value added` → `short|Value added` |
| stored keys broken | **0 of 6 tile keys, 0 mobile keys** |
| catalogue | 102 fields across 11 groups |

**The column VIEWS, the screens and `/columns` were untouched by the same move,
because all three key on column IDs** — which survive regrouping by
construction. That is the argument for a rebuild keying tile and mobile fields
on something stable too, rather than on a pair of display strings.

### What a rebuild should keep
Every one of these is load-bearing and was expensive to get right:

- **The rows are formatted SERVER-SIDE through `RowCard.fieldValues()`**, so a
  number cannot read one way on a phone and another on the screener. `/api/stocks`
  is ~1.3MB; a trimmed row payload is a few KB.
- **Screens are evaluated by `private/filters.js`**, the module the server
  `require`s and the pages load — one definition of the grammar.
- **`stockCard()` is shared with the desktop's Tiles view.** One renderer, two
  surfaces.
- **Guests are narrowed server-side on every route** (`mobileRows()` before any
  screen is evaluated), which is the CDN incident's lesson.
- **No poller and no service worker, deliberately**: a reload is how you get new
  data and it must actually get it. Only three display choices live in
  `localStorage` (`m.view`, `m.chart`, `m.range`) — per-device conveniences, and
  a guest has no prefs key at all.
- **Tile and mobile setup are SITE-WIDE and admin-only** (the owner's call: the
  tiles are what gets shared, so a per-member choice would make the same
  screenshot mean different things).

### What is not known
No scope, no size and no measured cost — the owner said rebuild, not what to
rebuild. The questions worth putting to them first: whether the phone should
keep views at all (three of six slots are used and one has been broken for a
week), and whether it is a page or a shell for the cards, which `stockCard()`
already draws at 1080px.

---

## 20. Chart patterns — measured 2026-10-02, flat, and worth drawing anyway

**Asked for from a table of classical patterns (head and shoulders, double and
triple tops, rounding bottoms) with "do you think we can do some of these on
the individual stock chart".** The fire rate was measured before anything was
drawn, which is the gate this list exists to impose, and the answer split: the
patterns **occur often enough to be worth marking and predict nothing**.

### What was measured, against the LOCAL copy
`analysis.db`, 4.37M bars from 2008, **1,147 symbols after exclusions**, 18.7
years. A percentage ZigZag over closes gives the pivots; a double top is two
same-side pivots within `tol` of each other, separated by `minBars`, with a
retracement of at least `minRetrace` between them and a rise into the first.
**Dated at the CONFIRMATION close** — the first close through the neckline —
never at the second peak, which would buy hindsight.

| at 8% zigzag / 3% tolerance / 15% retracement | events | symbols | per symbol per year |
|---|---|---|---|
| double top | 565 | 402 (35%) | 0.03 |
| double bottom | 988 | 610 (53%) | 0.05 |

Tunable from 42 events (a dead box) to 3,083 across 83% of symbols (noise), so
the middle band is a real answer rather than a tuned one. **The events are not
clustered into a few crises** — 158 and 185 distinct months, busiest month 3%,
busiest year 13%, every year from 2008 represented.

### Why it is flat, and the test that settled it
**TOP MINUS BOTTOM includes zero at every horizon** (−0.31pt at 1M, −1.23pt at
3M, **+4.20pt at 6M — the sign flips**), 95% intervals from a monthly block
bootstrap. Two patterns that predict opposite things cannot be told apart.
And the **bullish** one is reliably bad: the double bottom's 6M interval
`[−15.34%, −7.62%]` sits wholly below the base rate's `[−6.17%, −3.39%]`.

The reading: **a neckline break selects stocks that just moved sharply in
EITHER direction, and those lag.** Both patterns inherit it. Full numbers in
CLAUDE.md's research log, which this is the tenth entry of and the ninth flat.

### What should still be built, and what must not be
**Build**: swing pivots and double top/bottom as a chart layer on `/stock` —
a toggle beside FUND / EARN / SHORT, **default off** like all three, confirmed
patterns only, drawn ON the price plot rather than in a strip (these are price
geometry; they have no separate scale to need one). It costs **no endpoint and
no read** — `/api/history` already serves the window and detection is a pure
function, the earnings rug's bargain.

**Do not build**: any directional wording, a screener column, a filter key, or
anything `scoreActionInto` can see. The measurement above is the reason rather
than the usual caution — the label is the volume-breakout dot's, a fact about
the shape and silent about what follows. **Head and shoulders is dropped**: it
has strictly more free parameters than the pattern that just failed.

### Three traps, each already paid for once
- **The detector returned ZERO at all 18 settings on the first run and nearly
  went in the log as "this never happens".** One extreme tracker in the ZigZag,
  both update branches live at `dir = 0`, so it followed price both ways and
  emitted **no pivots at all on 4,714 bars of MU**. Two trackers. Prove the
  primitive on a synthetic saw, a ramp and real symbols *before* the sweep is
  allowed to print — `pattern-fire.js` refuses to run until it has.
- **A monotone ramp HAS a low (its first bar); what it cannot have is a high.**
  The self-check's first assertion demanded zero pivots and failed over correct
  code.
- **Sub-cent closes are not prices** (entry 16). The local copy predates the
  SOLS purge and APLD carries 1,304 real sub-cent bars, where "two peaks within
  3%" is trivially true. Each series is truncated past its last sub-cent close.

### What is still owed before drawing it
- **Intraday highs and lows, not just closes.** Everything above used closes
  alone; real peaks may define cleaner pivots and could move the fire rate.
- **Survivorship.** The pool is today's 1,181 tickers, so bankruptcies and
  acquisitions are absent from both the patterns and the benchmark — and a
  pattern literature built on failed companies is exactly where that bites.
- Scripts are in the scratchpad: `pattern-fire.js` (sweep + self-check),
  `pattern-cluster.js` (clustering), `pattern-sig.js` (block bootstrap).

---

## 21. A split leaves every per-share profile field wrong for up to a week — 2026-10-04

**Found while verifying the Live P/E column against production, and it is
wider than that column.** `persistBars` detects a split and rewrites the
symbol's whole bar history, so the archive is adjusted within one refresh.
**The stored PROFILE is not**, and it only rotates on `FUND_ROTATION_DAYS`
(7) — so for up to a week after a split every per-share figure in it is
quoted in pre-split shares against a post-split price.

**Measured on the live screen the day the Live P/E shipped**: `CTVA` split
**6.18x on 2026-10-01** (archive: 77.65 to 12.57 in one session, a clean
round ratio and no gap). Its stored `dilutedEpsTtm` is 1.65, pre-split, so
the Live P/E column reads **7.2 where the truth is about 44** — and the
vendor's own `trailingPe` of 47.1 is right, because both halves of its
ratio are pre-split and a split does not move a ratio. **One symbol of
1,278 on the day it was looked at**, and it self-heals at the next rotation.

- **The column did not create this and is not the only victim.**
  `bookValuePerShare` and `dilutedEpsTtm` are both per-share and both wrong
  over the same window; the Live P/E is simply the first surface that
  divides one of them by a price and so makes it visible.
- **THE FIX IS ONE CALL ON THE PATH THAT ALREADY KNOWS.** `persistBars`
  is the one place a split is detected; expiring that symbol's profile
  there (`fetched_at = 0`, the existing "pull was refused, retry me"
  sentinel) puts it at the head of the next round instead of at the back
  of a seven-day queue. It costs one cold profile (80 credits) per split,
  which is a handful a year.
- **NOT DONE, deliberately**, on two grounds. It touches the refresh path,
  which is the riskiest path in this app and the one whose failures read
  as "the refresh is broken" over data that is fine — three times on
  record. And the ask it came out of was a display change. Worth doing as
  its own commit, with a revert proof that a split really does expire the
  profile and that an ordinary round does not.
- **The cheap wrong fix is withholding the Live P/E when it disagrees
  with the vendor's by more than some factor.** That is exactly the
  disagreement the column exists to show — SOI and TRIP sit at 460% and
  78% apart for honest reasons — so it would hide the feature to hide
  one row.

---

## 22. Correlation — is a theme one bet or many? — raised 2026-10-04

**From a list of fifteen quant concepts the owner asked about.** Six of them
are already in this app under other names (Sharpe in `strategy.js`, VaR as
the per-tier p10, Monte Carlo as the chart-pattern study's block bootstrap,
Kelly's practical cousin as the volatility targeting on `/strategy`, mean
reversion as three flat framings in the research log, beta as a thing
deliberately not stored because the bars reproduce it). Four are impossible
here for want of data — Black-Scholes, the Greeks and market making need an
options chain or an order book, and this app has neither. **Three were worth
building, and this is the first of them.**

**The gap it fills.** The app has themes, sectors, size bands and personal
lists, and nothing anywhere says how much the members of one move together.
A seven-stock theme whose members correlate at 0.9 is one bet wearing seven
tickers, and the equal-weight curve on `/theme/<name>` cannot say so.

**It costs nothing to compute.** `basketPayload` already returns
`series` — every member rebased on one shared date axis — so the card is a
loop in the browser over data the page is already holding. No endpoint, no
query, no extra bytes.

**MEASURED BEFORE BUILDING, and both numbers decided the design:**

- **Returns, never levels.** Correlating the rebased price LEVELS is the
  classic error and it is not an approximation, it is noise: over 72 real
  pairs the levels figure sits between **−0.96 and +0.90** away from the
  returns figure, and flips sign — AAPL/MSFT reads **+0.12 on returns and
  −0.27 on levels**.
- **The 3dp rounding in `symbolSeries` is immaterial.** Worst error across
  those same 72 pairs: **0.0039**. That is what makes computing in the
  browser, off the rounded payload, the right call rather than a compromise.
- **The window moves the answer more than anything else.** AAPL/MSFT is
  **0.12 over 120 sessions and 0.44 over 1,000**. So the card has to follow
  the page's own range buttons and say which window produced the number.

*(Built 2026-10-04 — this entry is deleted in the commit that ships it.)*

---

## 23. GARCH, but only to make Cushion honest — raised 2026-10-04

**Cushion is distance-to-exit measured in the stock's own TRAILING
volatility** (`actionRisk.drop ÷ (realisedVol ÷ √12)`). The one thing a
volatility model adds over a trailing average is the thing the trailing
average cannot know: **volatility clusters.** A stock that had a shock last
week is riskier than its 126-day average says, and a stock that has been
quiet for six months is less risky than a window still carrying one old
shock.

**Why it is the second of the three.** It needs no new data, no credits and
no endpoint — `barmath.js` already computes realised volatility from bars —
and it improves a column that already exists rather than adding one. It is
also squarely on the display side: Cushion is a reading and a sort tiebreak,
never an input to a verdict.

**What it would take.** A GARCH(1,1) fitted per symbol is a maximum-likelihood
optimisation and is more machinery than this is worth. **The cheap 90% is an
EWMA variance** (RiskMetrics λ = 0.94), which is one line, has no fitting
step, and captures the clustering that matters. Start there and measure
whether the full model adds anything before writing one.

**What is already known.** Nothing has been measured. The claim that
volatility clusters is textbook and is not in doubt; what is NOT measured is
whether a clustering-aware Cushion orders the realised downside any better
than the trailing one does. **That is the test**, and `action-backtest.js`
already has the shape of it — it reports per-verdict p10 over eighteen years,
and the question is whether splitting a tier by EWMA-Cushion separates the
tails further than splitting it by today's Cushion.

**What would make it a bad idea.** Shipping it without that measurement. The
research log is ten framings tested and nine flat; a volatility model is a
model, and this project's standing rule is that a number goes on screen as a
FACT or it goes through the backtest first. If the measurement comes back
flat, the honest outcome is to leave Cushion alone and record it.

---

## 24. Empirical VaR as a column — raised 2026-10-04

**The worst 5% daily move a stock has actually had over the last year**, read
straight off the bar archive. Not a model, not a distributional assumption,
not a forecast: the 5th percentile of 253 observations that happened.

**Why it earns a place.** It is the most literal possible answer to "how bad
is a bad day in this stock", it is one sort away from being useful, and it
pairs with Cushion — Cushion says how far the exit is in units of
volatility, this says what a bad day costs in percent.

**What it would take.** One pass over the archive at the same point
`stampCapDerived` runs, or as part of the refresh's existing 470-day window
read. The column, a `FIELD_SPEC` row, and the usual four span constants.

**What is already known.** Nothing measured on this universe. The one thing
worth checking first is whether it says anything the existing `realisedVol`
does not: for a roughly normal return distribution the 5% quantile is about
1.65 standard deviations, so **if the two rank the universe identically the
column is realised volatility with a different label and should not be
built.** The interesting case is the stock whose bad days are much worse than
its everyday volatility implies — fat tails — and whether there are enough of
those to be worth a column is a measurement, not an opinion.

**What would make it a bad idea.** Calling it "Value at Risk". The name
carries a promise about tomorrow that a percentile of last year does not
make, and `/terms` already refuses forecasts. **Worst day (5%)** or similar
says exactly what it is.

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
