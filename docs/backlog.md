# Things to consider later

Started 2026-09-23 at the owner's request. Not a plan and not a promise — a
place to put work that was **identified and deliberately not done**, so the next
session starts from what is already known rather than rediscovering it.

Each entry says what it is, what is already measured, what it would take, and
what would make it a bad idea. **An entry with no measurement behind it says
so.** Delete an entry when it is done or when it stops being worth doing;
either way say which in the commit.

Ordered roughly by value, not by effort.

**Every entry carries one line of filing data under its heading**, which is what
the admin page at `/backlog` reads to build its table:

    *Area: Promo · Status: Open · Note: optional, one sentence*

Status is one of **Open**, **Partly done**, **Parked** or **Done**. Keep the line
when adding an entry, and change the status rather than deleting a finished
entry whose reasoning is still worth having. An entry without the line still
shows, as Open and unfiled.

---

## 1. The PEAD study — the best untested idea this project has

*Area: Research · Status: Done*

**Run 2026-10-25, with the guidance study: no drift.** Beat minus miss over 21 sessions -0.03pt before 2020 and -0.19pt from 2020, over 42 sessions -0.14 and -0.43, every interval through zero (27,196 reports matched to a surprise; window from the close after the filing day, so the announcement jump is outside it). research.md entries 15 and 18. The two checks below were not needed to reach a null and remain unchecked.

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

*Area: Data · Status: Open*

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

*Area: Research · Status: Done · Note: the data half was rebuilt on 2026-09-28; the payload half became entry 15*

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

*Area: Research · Status: Partly done · Note: the rebuild was attempted and is blocked on entry 16*

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

*Area: Refresh and jobs · Status: Open*

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

*Area: Infrastructure · Status: Open*

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

*Area: Housekeeping · Status: Open*

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

*Area: Research · Status: Open*

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

*Area: Refresh and jobs · Status: Parked · Note: the direction reversed in entry 14*

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

*Area: Accounts and mail · Status: Parked*

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

*Area: Accounts and mail · Status: Done · Note: Google sign-in has shipped since this was written; what follows is the original scoping*

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

*Area: Data · Status: Done · Note: on 2026-10-10 the newest filing on file was three days old*

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

*Area: Data · Status: Partly done · Note: onboard.js now covers bars, the record close, short interest and splits; insider trades are still a separate step*

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

*Area: Refresh and jobs · Status: Open*

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

*Area: Research · Status: Open*

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

*Area: Research · Status: Open*

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

*Area: Research · Status: Partly done*

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

*Area: Data · Status: Open*

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

*Area: Pages · Status: Open*

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

*Area: Research · Status: Open*

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

*Area: Data · Status: Open*

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

---

## 25. A trend-state board — the engine's own word, counted — 2026-10-07

*Area: Promo · Status: Open*

**Offered when the owner asked for "analysis of stocks above the 200 Day
average especially within s&p", and deferred in favour of the breadth card
that shipped instead.** This is the same question asked in the product's own
vocabulary rather than as a percentage: `actionTrend` is already on every row
and already collapses the trend rules to one word.

Measured on the live index the day it was offered:

| | S&P 500 |
|---|---|
| Downtrend | 31.7% |
| Above 200D | 24.8% |
| Strong uptrend | 20.0% |
| Breakdown | 19.6% |
| Below 200D | 3.2% |

**IT IS A MODE ON `advboard`, NOT A NEW CARD.** That template already has an
`advMode` and already counts the engine's words across a scope, so a trend
board is a sibling of what it does rather than a second implementation.
`actionTrend` appears three times in `cards.js` today — the Intro mock, the
advice board's own pick and the Spotlight's field list — and **nothing
aggregates it**, so nothing is duplicated by building this.

**What makes it weaker than the card that shipped**: the group pages already
draw a trend-state stacked bar in their Stance card, so this adds a surface
rather than a reading. Worth doing when the promo studio wants the engine's
vocabulary rather than a raw percentage, and not before.

---

## 26. Flow, with the bands keyed on the 200-day — 2026-10-07

*Area: Promo · Status: Open*

**`tplFlow`'s `bandOf(r)` keys on a return against the index** — `r < 0 ?
down : r > index ? ahead : behind`. A second rule keying on `vs200ma` would
make that card draw value-weighted breadth as ribbons, by sector, with no new
template and no new data: the ribbons are already sized by market
capitalisation.

**It shows the VALUE half only, which is why it was not built instead of the
breadth card.** The whole finding there is the gap between a headcount and a
cap-weighted count — 45.2% against 75.6% on the index — and a flow diagram
has no way to draw the headcount at all. This is the picture, not the
measurement.

**Cost**: one control and one band rule, plus the band labels, which the card
already parameterises (`refWord`). The three-band shape fits: above / below,
or above / near / below with a neutral band around the line, which the engine
itself has as `whipsaw.neutral_band_pct`.

---

## 27. The index against its own breadth — 2026-10-07

*Area: Promo · Status: Open*

**The divergence picture: the index making highs while fewer of its members
participate.** The most interesting of the seven ideas put to the owner and
the one closest to a claim this product does not make, which is why it is
last rather than first.

**It needs the same data path as the breadth time series** (the other
deferred half of that conversation): nothing computes a breadth series today.
Measured as possible from the local archive — 6,073 sessions, usable from
2008 — and carrying the two caveats recorded with it: only **736 of today's
1,274 symbols were priceable in 2008** (58%, rising to 97% now), and
`fund_holdings` holds **four days**, so there is no historical index
membership and any line is the whole screen rather than the S&P.

**THE HONESTY PROBLEM IS THE WHOLE ENTRY.** A chart of the index rising while
breadth falls is read as a prediction whatever the caption says, and this
project's own research log records nine framings measured flat. Before it is
drawn, the divergence has to be MEASURED the way everything else here is: do
breadth troughs while the index is at a high actually precede anything, over
the eighteen years the archive supports? If the answer is flat — and the
prior from this log is that it will be — the card should not be built at all,
or should be built stating that measurement on its own face the way the chip
screen states the cost of its hedge.

## 28. The S&P 500's own P/E history, beside a stock's — 2026-10-08

*Area: Promo · Status: Open*

**Asked for by the owner on the Evolution card: "one thing important when you
see PE history is the PE history of the stock against S&P PE history."**
Deferred at their instruction until the single-stock P/E was right, which it
now is (the filed-share basis, see CLAUDE.md).

**No source we hold sells it**, so it would be BUILT: for the index's members,
total market value over total trailing earnings at each quarter end, each
company valued by `splitAdjustedShares` exactly as its own card is.

**What it needs, in order:**
- **Split history for every member.** `backfill-splits.js --commit` does the
  universe: 20 credits a symbol, about 25,500 credits and about five and a half hours at the default 80 credits a minute (see the script for why not faster). Index members only is ~10,000.
- **A stored series, rebuilt nightly as its own phase** (beside `secRotate`,
  never in the refresh tail). Computing it per request means reading ~500
  companies' filings — about 175,000 `sec_facts` rows — which on this database
  is a quota event, not a slow query.

**Three things the card would have to say on its own face:**
- It is TODAY'S members traced back, not the index as it was constituted then
  — `fund_holdings` begins 2026-10-01, so there is no historical membership.
  Survivorship flatters it: a company that left the index by failing is absent.
- About 10% of filers have no full trailing year in our copy of the filings,
  lenders especially, so it covers most of the index's value and not all.
- It will not match S&P's published figure, which is on operating or
  as-reported earnings by their own method.

**Before drawing it, check it against a known reading** — the index's
published trailing P/E at two or three past dates. If the built series is not
within a few points of those, it is not the S&P's P/E under another name and
should be labelled as what it is ("today's 500, aggregated") or not built.

**One multiple at a time still holds**: the index line shares the stock's
panel because both are the SAME quantity on the same scale, which is what
makes one axis honest for them.

## 29. The peer chart's market value is still on today's share count — 2026-10-08

*Area: Data · Status: Open*

`peerTrendFor` computes each peer's market value as today's share count times
that quarter's close, the formulation the Evolution card has just left. It
reads a buyback-heavy peer's past value low — Apple's by about a third over
ten years — and on a chart that RANKS companies by market value that can
change a place.

**It was not changed with the Evolution card because it is seven companies a
request**, so it needs seven split histories (140 credits cold) where that
card needs one. Once `backfill-splits.js` has run for the universe it costs
nothing: `splitAdjustedShares` is pure and already takes what that route
reads. Until then the peer card's note still says today's share count, which
is true of it.

## 30. The splits table can repair an unadjusted archive — 2026-10-08

*Area: Data · Status: Open*

Three symbols carry a split the provider serves UNADJUSTED in `time_series`
(MLI 2-for-1 on 2026-06-25, CTVA 6.18-for-1 on 2026-10-01, CORT about
2-for-1), and `persistBars` cannot see them: it detects a split by disagreeing
with a re-fetch, and the provider's history never changes.

**The new `splits` table is the independent source that was missing.** A
check of each symbol's largest one-day step against its own split list would
say which archives are unadjusted, and the factor to divide by — the manual
adjustment path entry 21 describes, with its input now on hand. Worth
confirming first that `/splits` actually lists the three (MLI's is reported by
`/statistics`; CORT's was not reported there at all).


## 31. Nasdaq 100 membership — 2026-10-08

*Area: Data · Status: Done*

> **THE IMPORT HALF IS DONE (2026-10-08, the same evening).** The source is
> Invesco's own JSON feed for QQQ; it is imported nightly under fund `qqq` and
> shown on `/holdings`. See CLAUDE.md, "The Nasdaq 100 is imported too". **What
> is left is everything below about USING it**: the screener column, the bar
> filter and the promo cut, and the one-picker-or-two question.
>
> **AND THE USING HALF IS DONE TOO (later the same evening).** One Index picker
> on the screener, the pivot and every promo card; see CLAUDE.md, "ONE Index
> picker over both indexes". Nothing in this entry is outstanding. Kept for
> the reasoning.

**Asked by the owner** ("similar to the S&P index, I think Nasdaq 100 is also a
very important benchmark"). The benchmark half shipped the same day: the
Beating the index card can measure against QQQ, and the group pages draw a
Nasdaq 100 line beside the S&P 500 and the Dow. **This entry is the other
half: knowing which stocks are IN the index**, so it can be a screener column,
a bar filter and a cut on the promo cards, the way S&P membership is.

**What is already in place.** `fund_holdings` / `fund_state` are keyed on
`fund`, and `Holdings.FUNDS` is a config map, so a second index is an entry
rather than a migration. The nightly `holdingsRotate` step, the `/holdings`
page and its missing-member sorting (new / renamed / second share class) all
take a fund key.

**What has NOT been checked, and decides whether this is an afternoon or not.**
The S&P list comes from SSGA's daily xlsx for SPY. QQQ is Invesco's, a
different issuer with a different file; nobody has fetched it, confirmed it is
served to an honest User-Agent, or looked at its layout. iShares answered 200
with a csv content type and 2MB of HTML when it was tried for the S&P, so
"there is a download link" proves nothing. Nasdaq's own list endpoint is the
other candidate. **Measure the source first; `Holdings.parse` validates what
it read rather than the status code for exactly this reason.**

**Design questions to settle with the owner before building.**
- The screener column is `spMember`, the filter is `spFilter`, the promo cut is
  `xxSp500`. A second index wants either a second set of each or one "Index"
  picker with three values. One picker is the better shape, and it is a change
  to saved screens and saved posts.
- About 85 to 90 of the 100 are also S&P members, so the cut is mostly
  "large-cap growth" rather than a new population. The handful outside the S&P
  are the interesting part and should be easy to isolate.
- Some members are foreign-domiciled companies listed on Nasdaq. Those are US
  listings and pass the standing rule; a few may not be on the screener, and
  the dual share classes (GOOG/GOOGL) will show up as "second share class"
  exactly as they do for the S&P.
- **Membership only, never the weight**, for the reason `/holdings` is
  admin-only.

**What would make it a bad idea.** No reliable daily file from the issuer. A
maintained list from a mirror was refused for the S&P because it was eleven
days stale and missing a real member; the same test applies here.

## 32. Earnings narrowness — three more views on the Earnings growth card — 2026-10-09

*Area: Promo · Status: Open*

**Asked by the owner** ("show which stocks are major contributors to the entire
S&P or Nasdaq 100 earning growth … this also shows narrowness"). The card that
answers the first half already exists and shipped the same day: `earngrow`,
under Market — the quarter against a year earlier, the top contributors in
points that add up to the headline, four concentration figures, and eight
quarters of history with and without each quarter's top five. See
[context/the-promo-studio-cards-2.md](context/the-promo-studio-cards-2.md),
"Earnings growth". **These are the three ideas for making the narrowness
reading land harder. None is built, and NOTHING BELOW HAS BEEN MEASURED** —
whether any of them shows a striking picture on today's data is unknown until
someone runs the numbers.

In the order they would be built:

1. **Earnings share against size share — a new card.** Three bars for the top
   ten companies of an index: their share of its market cap, of its earnings,
   and of its earnings growth. It is the one picture the existing cards cannot
   make, because it puts earnings narrowness beside the PRICE narrowness the
   treemap and the waterfall already show. The recommended place to start
   (Claude's suggestion; the owner has not chosen).
2. **Concentration over time — an addition to `earngrow`.** One line across the
   eight quarters: the share of the growth supplied by the top five. The card
   shows "with and without the top five" for each quarter, which is the same
   information as two columns; it does not say at a glance whether narrowness
   is rising or falling.
3. **A waffle of who grew — a new view.** One square per company, the
   `beat` card's grid: earned more, earned less, swung to a loss. It answers
   "how many companies are actually growing earnings", the breadth side of the
   same story.

**What is already in place.** `earngrowth.js` is the arithmetic (pure, no
network); `earnGrowthFor(cut)` / `GET /api/earnings-growth?cut=in|ndx|All` is
the data, cached thirty minutes; `getEarnGrowth` / `Cards.earnGrowthNeed` is
the channel both hosts already ask. Ideas 2 and 3 need nothing the payload
does not already carry, or very nearly. Idea 1 needs each member's market cap
beside its net income, which the snapshot has — sized by OUR market cap, never
the fund's published weights, the treemap's rule.

**What would make it a bad idea, or a wrong picture.**

- **A "share of growth" blows up or flips sign when the group's net growth is
  small or negative.** The existing card falls back to points and dollars and
  says why. Every one of these three needs the same fallback, and idea 2 is a
  line that will have a hole or a spike in exactly the quarter a reader looks
  at first. Decide what it draws there before drawing anything.
- **Reported, not forecast**, so all three run a quarter behind the headlines
  that prompt the question. The note has to say so, as the card's does.
- **Idea 1 mixes a date-of-today quantity (market cap) with a quarter that
  ended months ago.** Either say so on the card or size by the cap at the
  quarter's end, which is the split-safe arithmetic the Evolution card already
  paid for (`sharesToday × adjusted close(t)`).
- **One company once**, by filer id, and benchmarks and sector funds out of the
  pool first — the rules every market-aggregate card already follows.
- **Colour:** earnings up is not a price going up. The card uses blue for a
  contribution and red only for the pooled fall; the waffle should not turn
  into green and red.
- A new control joins `CONTROL_IDS`, its template's listener list and the
  scoped-picker lists, under `POST_OPT_MAX`.

---

## 33. More columns in the Chip selloff family — 2026-10-10

*Area: Screener · Status: Open*

**Asked by the owner** ("similar to chips sell off, do you have any other unique
ideas that I can add as column"). Nine were offered. Four were built the same
day as the Reactions group (Market selloff, Market rally, Short build, Insider
net; see [context/reactions-group.md](context/reactions-group.md)). **These are
the other five, plus two things that came out of building the four.**

**NONE OF THE FIVE HAS BEEN MEASURED.** Chip selloff was added only after it
ranked stocks the same way from one year to the next (Spearman 0.53), and two
alternatives were refused for failing that. Each of these owes the same test
before it is a column, on the local archive copy; `mkt-study.js` in the
2026-10-10 session scratchpad is the shape of it and takes a minute to run.

In the order they would be worth trying:

1. **Earnings-day swing.** The typical size of a stock's move on the session
   after each of its last eight reports. Useful just before earnings, which is
   when a reader looks. `earnings_history` holds the dates and the bars hold
   the moves. *The trap:* nearly every report is After Hours, so the reaction
   is the NEXT session (the PEAD entry above records this). A median of
   absolute moves, never a mean: one buyout day would be the whole reading.
2. **Versus its industry.** Its return less the middle company of its own
   industry, over a month or a quarter. There is relative strength against
   the S&P and nothing against peers, and it pairs with the Industry cards.
   Cross-sectional, so it is a read-path stamp fed the WHOLE universe before
   any guest filter (`stampPeerValue`'s rule), with `PEER_MIN_INDUSTRY`'s
   floor and its sector fallback said on the cell.
3. **Own-sector selloff.** Its move on its own sector's worst days, after the
   market's move is taken out: does it lead its sector down or hold up inside
   it. The eleven sector funds are already rows, so the trigger exists. It is
   Chip selloff's exact method with a different basket, and should be built
   by generalising `chipSelloffCtx`, not copying it.
4. **Overnight share.** How much of the past year's return came between one
   close and the next open, against during the session. The most unusual of
   the nine. *Check first:* that the archive's opens are split-adjusted on the
   same basis as its closes; an unadjusted open across a split is a
   several-hundred-percent overnight "move" (backlog 21 and 30).
5. **The market's share of its moves.** How much of a stock's daily movement
   the S&P 500 explains, as a percentage. A low figure is a stock trading on
   its own story. *Likely to pass:* a plain beta carried over at 0.60 to 0.83
   in the Market selloff study. *Likely to be redundant with* Market selloff,
   which correlates with beta at about 0.9; measure that before adding a
   third column that says the same thing.

**What building the four showed, so it is not rediscovered:**

- **Do NOT build an "asymmetry" column** (rally plus selloff, "catches the
  upside and dodges the downside"). It was measured and it is not a trait: it
  carries over year to year at 0.20, 0.04, 0.10, 0.10, 0.09 and -0.01.
- **Insider net could be shown in dollars instead.** As a percentage of market
  value its median is -0.005% and half the column rounds to nothing; the
  owner was offered dollars and has not chosen. Dollars read better per cell
  and stop being comparable across company sizes. The junk guard has to stay
  either way (one filing shows $1.6 quadrillion bought).

**A related card, also not built:** a dedicated Chip selloff promo card. The
measure is on the Bars card and behind the "Held up when chips fell" screen,
and nothing explains it. A card of its own would show both ends at once
(Bars cannot), which sectors moved against chips, and the explanation on the
card. It must keep the column's own line: the measure is the semiconductor
industries, and "the AI trade" is an interpretation of them.

**What would make any of these a bad idea.** A column that fails the
year-to-year test is a description of noise, and the table already has 104.
Every one of them is display only and must stay out of `action.js`, proved
the way the Reactions four were: one row scored with the field absent,
present and lying.

---

## 34. Corrections, for the market and for each stock — 2026-10-10

*Area: Screener · Status: Partly done · Note: a, b, c and most of d built 2026-10-10 (docs/context/corrections.md); e remains*

**The gap, in the owner's words:** "There is nothing in my app about market
and individual stock corrections." That is true of the vocabulary and the
history, though not of the raw material. The screener already has
`% from 52W hi` (`pctFromHigh`), `% from record` (`pctFromAth`), the Ulcer
index (the root-mean-square drawdown) and the Market selloff and Market
rally columns in Reactions. Nothing names a correction, nothing shows one
over time, and no card is about one.

Five pieces, proposed by the assistant on 2026-10-10 and filed at the
owner's request. None is built.

**a. A correction status, for each index and each stock.** A label from the
distance below the high, on the usual thresholds: within 5% is near the
high, 5 to 10% a pullback, 10 to 20% a correction, 20% or more a bear
market. On the market Snapshot for the indexes; a filterable screener
column for stocks, so "everything in a correction" is one filter. A small
build on `pctFromHigh`. To decide first: measured from the 52-week high or
from the record, since the two disagree for a stock two years off its peak.

**b. A breadth-of-corrections card.** "The S&P 500 is 3% from its high, but
41% of its companies are in a correction and 18% in a bear market." Counts
of (a) across a cut, beside the index's own distance. No new data. Close
kin to entry 27 (the index against its own breadth) and to the Signal
card's pyramid; check it says something those two do not.

**c. A drawdown history for one stock or index.** An underwater chart: how
far below its running high the price sat on each day, with every drawdown
of 10% or more marked with its depth, the days to the bottom and the days
to recover. On the stock page and as a promo card. The bar archive holds
the closes; the cost is a per-symbol read of the whole series, so it is
computed on request for one symbol, never across the table.

**d. Correction columns per stock.** Days since the high, the deepest
drawdown in the past year, and the number of 10% drawdowns in three years.
They belong in Reactions beside Market selloff. Computed from bars in the
nightly pass like the other bar-derived readings, not on the read path.

**e. The market's own correction history.** A table and a card of every
S&P 500 correction the archive covers: start, bottom, depth, days down,
days to recover. Its use is context while one is happening ("this one is
12% deep and 30 days old; the median was 14% and 45 days"). Limited by how
far back the index fund's bars go, which is the first thing to measure.

**Suggested order:** (a) and (b) together, since they give a column, a
filter and a card in one pass; then (c), the richest for content and the
largest build.

**What must hold for all five.** Display only: none of it is read by
`action.js`, proved by scoring a row with the field absent, present and
lying. Descriptive, never predictive: a card may say what past drawdowns
of this depth did and must not say what this one will do. A status word is
a label for a distance, so it takes amber or neutral ink, and green and red
stay with the price move itself. A stock with too little history to have a
52-week high has no status, rather than "near high".

---

## 35. Corporate margins — the views not yet built — 2026-10-10

*Area: Promo · Status: Open · Note: the index and sector history card and the Margin chg column were built 2026-10-10 (docs/context/margins.md)*

**Built already:** the Margins card (a group's combined margin over four
years, and each sector now against a year ago) and the screener's Margin
chg column. Both read `margins.js`. What follows was proposed by the
assistant in the same conversation and filed at the owner's request.

**a. Margin breadth.** How many companies' margins are wider than a year
ago, how many narrower, and by how much at the median: the margin
counterpart of the Corrections card. The figures are already stored for
the column (`app_meta` `margin_chg`, 978 companies), so this is a card over
data that exists. By sector as well. Worth checking first whether the count
says anything the index line does not: on 2026-10-10 the median company's
change was +0.4 points while the S&P 500's was +2.8, which suggests it
does.

**b. Concentration: whose margin is it.** How much of an index's margin
gain comes from a handful of companies, in the spirit of the Earnings
growth card: the index line with and without its five largest
contributors. A company's contribution to a change in an aggregate margin
is not its own margin change; it is its change in profit and in revenue
against the group's totals, and the decomposition has a mix term (a
high-margin company growing faster lifts the total with no company's
margin moving). Get the arithmetic right before drawing it, and show the
mix term rather than folding it away.

**c. A sector's margin over time.** (Partly met 2026-10-10: the Sector
margins and Industry margins cards draw one sector's or one industry's line.
What remains is several sectors on one chart.) The card draws the index's line and
each sector as two numbers. A view with one line per sector, or a Sector
spotlight figure, would show which sectors are being squeezed and since
when. `Margins.build` already has each sector's panel; it returns only
now and a year ago.

**d. More margin columns.** Operating and gross margin change, the way
net is done. Cheap, since `Margins.change` reads the same quarters; the
cost is two more columns in a table that has over a hundred.

**e. Coverage of the financials.** Banks whose filings carry no revenue
line here (JPMorgan among them) have no margin on any of these. The fix
is in the tag mapping in `secfacts.js`, not in the margin code, and it
would lift the net panel from 377 of 499 S&P 500 companies.

**f. A benchmark check.** FactSet's Earnings Insight publishes the S&P
500's net margin by quarter. Our 14.8% is a trailing year on a fixed
panel of 377, theirs is a single quarter on the whole index, so they
should differ; putting the two side by side once would show whether they
differ for those reasons only.

**What must hold.** A total over a total, a trailing year at each point,
and one panel throughout: the three rules `margins.js` argues. No green
or red for a margin. Reported figures only, never a forecast.

---

## 36. More public SEC data: 13F holdings, and what 8-K events could still feed — 2026-10-11

*Area: Data · Status: Partly done · Note: 8-K events and 13F holdings built 2026-10-11 (docs/context/8k-events.md, institutional-holdings-13f.md); b to e remain*

**Where this came from.** The owner found FilingRail, a third-party API on
RapidAPI (a small publisher; about 8,200 SEC filers, refreshed daily), and
asked what other public data could be read. Its seven endpoints were
compared with what the app holds. Five were already here from the SEC
directly (company search, financials, financial history, insider trades,
filing dates). Two were new: **8-K events** and **13F holdings**.

**The decision on the API itself: not subscribed.** Everything it serves
is the SEC's own public data. Its free tier is 50 calls a day and the
universe is about 1,280 symbols, so one daily pass of one endpoint needs
its $49 tier. Reading the SEC directly costs nothing, has no call limit
and no dependence on a small publisher, and the source said nothing about
redistribution. The one thing a middleman offers is distance from the
SEC's own throttling, which this address has met before; the existing
slow sequential reader already handles it.

**Built: 8-K events**, from the feed the filings refresh already
downloads. A stock-page list, a screener column, a text filter.

**a. 13F institutional holdings. Built 2026-10-11** (see docs/context/institutional-holdings-13f.md; the CUSIP map came from the fails-to-deliver files). What large institutions held
at each quarter end and how it changed. The SEC publishes it as free
quarterly bulk files (one row per manager per security). Things to settle
before building:
- It is **45 days stale by design** and covers long positions in listed
  equities only, so it is context, never a live reading.
- Positions are keyed by **CUSIP, not ticker**, and the app has no CUSIP
  map. That mapping is most of the work.
- The files are large (millions of rows a quarter). This is a local
  loader writing per-symbol summaries, never a request-path read: count
  of holders, shares held, change on the quarter, the largest holders.
- The profile already carries `institutionPct` from the vendor. Check
  what 13F adds beyond that one number before spending the effort; the
  honest answer may be "the change, and the names".

**b. An alert type for 8-K events.** "Tell me when this company files an
8-K", or one of a kind (results, officer change, restatement warning).
The alerts feature fires on new data arriving; events arrive with the
filings refresh, so the lag is that rotation's, and the alert must say so.

**c. A promo card of the week's 8-Ks.** Which companies filed what, by
kind: the officer changes, the restatement warnings. Must stay a list of
categories; an item number never says whether the news was good.

**d. Results 8-Ks beside the earnings calendar.** Item 2.02 is the
release itself. The Earnings ahead card shows who is due; a companion
could show who reported this week, from the events table.

**e. The filing's text.** An 8-K's exhibit 99.1 is the press release.
Reading it would say what happened, which the item number cannot. That is
a different order of work (fetching documents, not a feed) and would need
the chatbot's care about attributing rather than summarising as fact.

---

## 37. Other public data that could be read, by how much work each is — 2026-10-11

*Area: Data · Status: Open · Note: large-holder filings (13D and 13G) being built 2026-10-11; the rest filed at the owner's request*

The owner, after the 8-K events went in: "what was the other data that we
can download", then "add all this to backlog first and then work on
large-holder filings". Everything here is free from its source. Entry 36
holds 13F and the 8-K follow-ons in more detail.

**Already in the feed the filings refresh downloads** (the SEC's
per-company submissions list, which names every form a company files, so
none of these needs a new download to detect):

- **a. Large-holder filings, Schedules 13D and 13G. Being built.** Someone
  crossing 5% of a company. A 13D is a holder who may seek to influence
  it; a 13G is a passive one. The list names the form but not the holder
  or the stake, so each filing's own small document is fetched once.
- **b. Late-filing notices, NT 10-K and NT 10-Q.** A company telling the
  SEC it cannot file its accounts on time. Rare, and a fact a reader
  would want pointed out. No second fetch needed: the form name is the
  whole event. Would sit in the Company events list.
- **c. Share offerings, S-3 and the 424B prospectuses.** A company
  registering or selling new shares. Careful with the reading: an S-3ASR
  is a shelf that a large company keeps on file as routine, and many 424B2
  filings are debt, not shares (Apple files dozens). Telling an equity
  offering from a note issue needs the document, so the cheap version is
  only "filed a prospectus" and may mislead more than it informs.
- **d. Planned insider sales, Form 144.** Notice that an insider intends
  to sell. The app holds completed insider trades (Forms 3, 4, 5); this
  is the advance notice. Structured since 2023. High volume at some
  companies (Palantir: 234 in its recent list), so it wants a count or a
  total rather than a row each.
- **e. Proxy statements, DEF 14A.** The annual meeting document: pay, and
  what is up for a vote. The form name gives only "a proxy was filed";
  anything more is reading the document.

**A separate download:**

- **f. 13F institutional holdings.** See entry 36a. Quarterly, 45 days
  stale by design, keyed by CUSIP, which the app does not map.
- **g. Failures to deliver.** Shares sold and not delivered on time; the
  SEC publishes it twice a month as one file for the whole market. Pairs
  with the short-interest data already held. Also keyed by CUSIP.
- **h. Daily short-sale volume.** FINRA publishes it every day, where the
  short interest held now is twice a month. A different measure and
  easily misread: it is the share of a day's volume that was sold short,
  much of it market-making, not the open short position.

**Outside the SEC:**

- **i. Treasury yields and economic series** from the Federal Reserve's
  free data service (FRED): rates, inflation, employment. Market context
  for promo cards rather than anything per stock. The FRED address was
  unreachable from this machine on 2026-10-10 (the Taiwan-dollar rate had
  to come from elsewhere), so check access first.

**What must hold for all of it.** Display only, never an input to the
signal. A form name says what kind of filing it was and never whether it
was good news. Sequential, declared requests to the SEC, and a 429 is a
stop, not a retry.

---

## 38. Accepting donations — 2026-10-11

*Area: Pages · Status: Open · Note: waiting on the owner to choose a provider and create the link*

The owner: "How to integrate payment, I want to keep the site at the moment
but I am willing to accept donations." The site stays as it is; this is a
way to accept support, not a paywall.

**The approach: a hosted donation link.** The payment provider runs the
checkout page and the site only links to it. No card data touches the app,
nothing new is stored, no webhook, no new dependency.

**Providers considered**

- **Stripe Payment Link** (recommended): a "customer chooses what to pay"
  link made in the Stripe dashboard, one-off or monthly. Lowest fees of the
  three, pays into a bank account, and the same account would serve a paid
  membership if that were ever wanted.
- **Ko-fi or Buy Me a Coffee**: set up in minutes with no business details
  and familiar to donors. Both pay out through Stripe or PayPal.
- **GitHub Sponsors**: no platform fee and the repository is public, but a
  donor needs a GitHub account, which most visitors will not have.

Check each provider's current fees before choosing; they change.

**What the build is, once there is a link**

- a. A quiet "Support Tickr Lab" link in the footer of the landing and
  About pages and in the screener's menu. The address comes from an
  environment setting, so no link is drawn where none is set.
- b. One line on About: the site is free and independent, and support goes
  toward data and hosting.
- c. One sentence on `/privacy`: payments are handled by the provider and
  Tickr Lab never sees card details. In the same commit as the link.

**What must hold**

- **A donation buys nothing.** No feature, no faster approval, no access.
  Once a payment unlocks something it is a sale, with refund, tax and
  terms obligations, and it sits badly beside "not investment advice".
- **It is income, not charity.** The wording says "support" and never
  implies a charitable donation or a tax receipt. How it is taxed is a
  question for an accountant where the owner lives.
- The provider shows a business or personal name on a donor's receipt and
  statement: the owner should choose that name knowingly.
- No donor list, total or "top supporters" on the site.

**Open with the owner:** which provider; one-off only or monthly as well
(a setting on the link, not code).

---

## 39. Public data beyond the SEC filings list — 2026-10-11

*Area: Data · Status: Partly done · Note: capital returns (a) and options open interest (b) built 2026-10-11 (docs/context/capital-returns.md, options-open-interest.md); the rest remain, none of their addresses tested yet*

The owner, after analyst ratings and price targets turned out to be
licensed data with no public source: "any other public source I can
explore to collect any other stock related data". Entry 37 holds the
remaining SEC items and the Federal Reserve series; this is what lies
beyond them. Listed from knowledge on the day: **check access and terms
for each before building**, as entry 37 found the Federal Reserve address
unreachable from this machine.

**Already in data the refresh downloads**

- **a. Capital returns. Built 2026-10-11.** Share buybacks, dividends paid,
  stock-based pay and the change in share count, from the SEC company
  facts already stored. What a company did with its cash, for the whole
  universe, with no new source.

**Market activity, per stock**

- **b. Options open interest and volume. Open interest built 2026-10-11; volume not.** The Options Clearing
  Corporation publishes daily put and call volume and open interest by
  symbol: a put/call reading per stock. One download a day.
- **c. Off-exchange volume.** FINRA publishes weekly dark-pool and
  over-the-counter volume by symbol.
- **d. Threshold list and trading halts.** The exchanges' daily lists of
  stocks with persistent delivery failures, and of halts with their
  reason codes. Sits beside fails to deliver (37g).

**Attention**

- **e. Wikipedia page views.** A free official API, daily views per
  company page. A measure of public attention; needs a symbol-to-page
  map, and suits a promo card.

**Government records, per company**

- **f. Federal contracts.** USAspending.gov, every award by recipient.
  Meaningful for defence, IT services and healthcare names; needs a
  recipient-to-symbol map.
- **g. Congress members' trades.** The House and Senate publish members'
  transactions. Popular; the filings are messy documents, and the wording
  needs care: a record of what was disclosed, never a tip to follow.
- **h. Lobbying spend.** Quarterly Senate disclosures by company.
- **i. Patents.** Grants by company from the patent office's open data.

**Sector-specific** (part of the universe only, so cards rather than
screener columns)

- **j. Drug and trial data.** FDA approvals and recalls, and
  ClinicalTrials.gov trial status by sponsor, for biotech and pharma.
- **k. Energy.** The Energy Information Administration's weekly oil and
  gas inventories and power data, for the energy and utility groups.
- **l. Banks.** The consumer complaints database, by institution.
- **m. Autos.** Safety recalls by manufacturer.

**Not available publicly, so not on the list:** analyst ratings, price
targets and earnings-call transcripts are licensed (brokers to an
aggregator to a site such as Yahoo), and scraping a site that licenses
them republishes someone else's data. Showing a price target would also
need the owner to lift the standing rule against them. The press release
attached to a results 8-K is public and is entry 36e.

**Suggested order after (a):** b, then e. Each is one clean download.

**What must hold for all of it.** Display only, never an input to the
signal. Null where a source has nothing for a company, never zero.

---

## 40. A security test of the app with Strix — 2026-10-12

*Area: Infrastructure · Status: Open · Note: nothing run yet; the commands are the tool's README as read on the day, not tried*

The owner found Strix (github.com/usestrix/strix), an open-source AI
penetration tester: it reads code or probes a running app, looks for
security flaws and tries to prove each with a working exploit. Apache 2.0.
Worth doing before the promo studio and the holder pages are opened to
every member.

**What it needs**

- Docker running (its work happens in a sandbox container).
- An API key for a model provider; the tokens are the cost. `server.js`
  alone is about 13,000 lines, so a full scan is not small. The README
  names a `--scan-mode quick` for a cheaper first pass.
- This machine is Windows and the installer is a bash script: run it in
  WSL with Docker Desktop.

**The steps, in order**

- a. **Scan the public GitHub repository**, not the local folder:
  `strix --target https://github.com/<owner>/StockPulse`. The local folder
  holds `.env` (database token, API keys, the Instagram token), and a
  local-folder scan would hand those to the tool and its model provider.
- b. **Give it a focus** with `--instruction`: the four access tiers
  (anonymous, guest, member, admin), the routes the cron secret opens,
  sign-up, password reset and the request-access flow.
- c. **Verify every finding against the code before acting on it.** Expect
  false positives; fix the real ones, each with a test that fails first.
- d. **A live test only against a copy.** Against a running site the tool
  attacks: it tries to sign in, inject and write. Production has no
  staging copy, and the local server talks to the production database
  too, so neither is a safe target. A live test needs a Vercel preview
  deployment pointed at a throwaway database first. That setup is its own
  piece of work.

**What must hold**

- Never the production address and never a local server, until (d) exists.
- Never a target that contains secrets.
- The tool's own rule, which is also the law: only systems the owner owns.

---

## 41. Knowing where visitors come from: Search Console, and whether to add analytics — 2026-10-12

*Area: Pages · Status: Open · Note: the Google account steps are the owner's; nothing built*

The owner asked whether the site needs Google Analytics, then what Google
Search Console is. The answer given: not Analytics yet; Search Console
first.

**What the site already knows.** The visitor log (every anonymous hit:
time, referrer, browser) and the activity log (what each signed-in account
opens), both on admin pages. Its own data, no third party.

**a. Google Search Console. Recommended.** A free Google tool showing how
the site appears in Google Search: the words people typed, how often a
page was shown and clicked, which pages are indexed and why others are
not, and who links here. No script on the site, no cookies, no consent
banner. It sees only the public pages (landing, about, blog, terms,
privacy), which is all it should. It is the one gap the site's own logs
cannot fill.

- The owner: sign in at search.google.com/search-console, add the domain,
  and prove ownership (a DNS record at the registrar, or a file or tag on
  the site).
- The build: serve the verification file or tag if that route is chosen,
  and a `sitemap.xml` listing the public pages and the published blog
  posts, generated from the same table the blog reads.

**b. A "by source" summary on the visitors page.** Links posted to
Instagram and elsewhere can carry a tag (`?src=ig-oct12`); the visitor log
already records the address asked for. A small table of visits by tag
would say which post brought whom, with nothing new collected.

**c. Vercel Web Analytics**, if traffic charts for the public pages are
wanted. Cookieless, so no banner. What the current Vercel plan includes
was not checked.

**d. Google Analytics. Not now.** It sets cookies and sends visitor data
to Google: the privacy page would need rewriting and visitors from the EU,
the UK and some US states a consent banner. It is weakest behind a login,
which is most of this site, and a member's browsing of particular stocks
would be visible to Google unless it were confined to the public pages.
Worth revisiting only if paid advertising starts and conversions need
measuring.

**What must hold.** Anything that sets a cookie or sends visitor data to a
third party changes `/privacy` in the same commit. Nothing third-party on
the gated pages.

---

## 42. An AI pass for the news headlines the rules cannot place — 2026-10-16

*Area: Data · Status: Open · Note: rules only shipped first by the owner's choice ("rules only for the time being, AI later")*

The headlines are sorted by type with rules on their words
(`private/newstype.js`: Earnings, Analyst ratings, Guidance, Dividends and
buybacks, Deals, Leadership and jobs, Legal and regulatory, Products and
partnerships, Ownership, Commentary, Market moves, Other). On 375 real
headlines across fifteen stocks on 2026-10-16 the rules placed 78%; **84
(22%) were left as Other**, mostly unusual wording ("Mapping the Market:
Micron shares appear set for further losses") and headlines about a CEO's
remarks that are not a change of people.

**The idea.** Send only what the rules leave as Other to a small model
(Claude Haiku), headline only, with the fixed list of types and "Other" as
an allowed answer; store the answer with the headline so it is asked once.

**What it would cost.** A few hundred short calls a day across the
universe at most, since the rules take the rest: likely cents a day.

**What must hold.**
- The fixed list, never a type the model invents; "Other" when unsure.
- Asked once per headline and stored (a column on `news`, with a backfill
  through a targeted write, not `writeNews`), not on every page view.
- Display only, never read by the Signal; the rules still decide first, so
  the same headline cannot change type from one page view to the next.
- The model's choice is labelled as such where it is shown, so a reader can
  tell a rule's answer from a model's.

---

## 43. Does institutional buying come before better returns? — 2026-10-17

*Area: Research · Status: Open · Note: the owner asked for it on the backlog; the data was loaded the same day*

Since 2026-10-17 the archive holds nine quarters of Form 13F (Q2 2024 to
Q2 2026) for every tracked stock: shares held by institutional managers,
managers holding, each quarter's change (split-adjusted), and the largest
buyers and sellers, plus each manager's net bought or sold in tracked stocks
(`inst_history`, `holder_history`, `flow13f:M:<period>`). That is enough to
ask whether stocks that institutions added to most did better than the
average stock over the following one to two months.

**How it would be framed, to the research page's standard.** Event: the
quarter's 13F data becoming public (about 45 days after quarter end, and
the data set's own publication date, not the quarter end, since nobody
could act before then). Signal: the quarter's change in shares held, the
change in managers holding, or the net flow from managers with low turnover
(a high-turnover book is often a trading desk or a filing change). Compare
the top and bottom fifths with the average stock over 21 and 42 sessions
from the next close after publication, per quarter.

**What to expect, so a flat result is not a surprise.** The published
literature finds the effect weak and mostly gone by the time 13F data is
public; the 45-day lag is the reason. Nine quarters is also only nine
cross-sections, too few to split before and after 2020 as the research page
usually does; the backfill would need to go further back first (the SEC's
data sets run to 2013, at about 100MB and a minute each).

**Biases to name in the write-up.** Only today's universe is in the archive
(companies that fell away are missing); only today's CUSIP map is used, so
older quarters miss a company whose security code changed; firms that
changed their SEC filer id (BlackRock in 2024) break a holder's continuity.

## 44. Security hardening from the code review — 2026-10-17

*Area: Infrastructure · Status: Partly done · Note: everything done 2026-10-18 except the research files tracked in git (c, first item), which waits for the owner; a read-only review of the code, no live probing; the owner asked for the findings on the backlog. The full write-up, with file and line references, is kept off the public repository (docs/security-review-2026-10-17.md, gitignored)*

The owner asked for a review "from a penetration-testing perspective". Four
passes over the code: sign-in and sessions, who can reach what, injection
and output, and outbound calls, secrets and cost. No route was found that
lets a stranger in today without a secret, and no SQL injection, script
injection a member can plant, open redirect, request forgery to other hosts,
or secret leaking into a response. What was found is listed below as work,
most important first. This repository is public, so the entries say what
to change, not how each could be abused; the local write-up has that.

**a. The admin sign-in (first).**
- Sign the admin, guest and Google sign-in cookies with a separate random
  secret (a new environment variable), never with the admin password, then
  change the admin password. Changing it signs every admin device out.
- Give the password-only admin login an attempt limit, as member accounts
  have.
- Make the admin login a server-side session with an expiry that logout
  ends, instead of a fixed cookie.
- Refuse to start in production when the admin password is missing, rather
  than opening the site to everyone.

**b. Cost and load limits.**
- Per-stock routes that can call a paid or rate-limited source (filings
  series, headlines) accept only symbols in the universe.
- A length limit on email addresses before they are checked, on every form
  that takes one.
- Uncached whole-universe reads: only an admin may bypass a cache; card
  windows are rounded to the ones the cards use; the basket read is cached.
- A site-wide and per-address cap on subscription confirmation mail.
- Admin routes that do paid work run only on POST.
- A per-visitor cap on activity logging; parse large admin upload bodies
  only after the admin check.

**c. The private files.**
- The research builders' output in `private/` (single-closes, the lab grid,
  the strategy files) is tracked in git and so is public whatever the site's
  gate says. Stop tracking it and serve it from the database. Removing it
  from the repository's history is a separate, destructive step and the
  owner's decision. The data is derived from Twelve Data prices; check the
  licence.
- The private-file gate normalises the path the way the file server does
  before matching, and refuses anything it does not recognise.

**d. Accounts.**
- The same answer whether or not an email has an account, at sign-up, at a
  locked login and in response time.
- The lockout counts in one database statement and lapses on its own, so it
  cannot be raced or held on someone else's account.
- Password change counts failures like login; session tokens are stored
  hashed (the auth notes say they are; they are not); Google sign-in never
  links to an admin account; cookies are Secure on Vercel whatever NODE_ENV
  says.

**e. Smaller.**
- The company website link accepts http and https only.
- The spreadsheet export neutralises cells that begin with a formula sign.
- The blog fills its template with a replacer function (a `$` in a post
  currently garbles the page); internal links refuse `//`.
- Bounded in-memory caches; security headers (content security policy,
  nosniff, frame options); the cron secret's comment says how many routes it
  opens (about twenty, not one).

Each fix ships with a test that fails before it, per the house rule. Entry
40 (Strix) stays open for a test of a running copy once one exists.

## 45. Security findings from the VulnHunter scan — 2026-10-18

*Area: Infrastructure · Status: Partly done · Note: all done 2026-10-18 except the refresh rounds' lock (f), left by the owner's choice (see below); a read-only automated scan of the code, nothing executed and no live probing; 56 findings (3 High, 19 Medium, 34 Low). The full report is kept off the public repository (docs/security-review-vulnhunt-2026-10-18.md, gitignored)*

The owner asked for a scan with Capital One's VulnHunter, an open-source
tool that traces every input an outsider can send through to where it is
used, then tries to disprove each candidate before keeping it. It ran on a
clean export of the committed code with no secrets in it, about fifty
agents over 351 inputs. This repository is public, so, as in entry 44, the
items say what to change, not how each could be abused.

**It confirms entry 44, and that work comes first.** The three findings
rated High are all already in 44: the admin and guest cookies (44a: a
separate secret, then change the admin password), the admin password login
(44a: an attempt limit) and the private-file gate (44c: normalise the path
before matching). Its cost and account findings overlap 44b and 44d as well: the
email length limit, admin-only cache bypass, card window rounding, the
subscription mail cap, paid admin routes on POST only, the activity-log
cap, the lockout, timing, bounded caches and Google sign-in never linking
to an admin account.

**New beyond entry 44:**

**a. Admin actions started by a link.**
- The screener's, the refresh page's and the news-runs page's `?do=` links
  ask for a click before they start a refresh, rather than starting on
  load.
- Every admin route that changes state or reads whole tables refuses GET,
  including the `fresh=1` diagnostics and the cron-or-admin routes when
  called with the admin cookie rather than the cron secret.
- Logout is a POST that checks where the request came from.

**b. Sign-up and the mailing list.**
- Check the invite code only after the sign-up throttle, on both the email
  form and the Google finish step.
- Registration verifies the email address before the account can be used,
  so a Google sign-in never links to an account someone else created with
  that address.
- A subscription for an address that is already pending or unsubscribed
  cannot be rewritten by anyone who names it; only the confirmation link
  changes it.
- The subscribe, access-request and forgot-password limits count in one
  database statement, so concurrent requests cannot slip past them.

**c. What a response gives away.**
- The status, screener and "a refresh is running" responses say that a
  refresh is running, never who started it.

**d. Data left behind and data written by others.**
- Deleting an account deletes or archives its alerts and alert history,
  so whoever registers the same address later does not inherit them.
- Anonymous page views of the blog and the landing page write visitor and
  activity rows only within a per-visitor cap, with long headers clipped.

**e. Escaping on output.**
- Escape portfolio, theme and screen names (sector, industry, signal) where
  the screener draws them, and the saved backtest on its shared run page.
  Only an admin writes these today, so it is defence in depth.
- The blog's markdown renderer must not run its link rule over the
  attributes its image rule has just written.

**f. Concurrency and credits.**
- One statement each for the alert cap and paper-position cash, so
  simultaneous requests cannot exceed them.
- The subscriber broadcast checks that it won the claim before sending, so
  a post cannot go out twice.
- Refresh rounds take their lock and cursor in one statement, and the
  universe check stands aside for a running refresh and keeps under the
  per-minute credit cap.
  **Left open by the owner (2026-10-18):** the refresh rounds' lock and
  cursor. Only the admin starts a round and the cross-site way in is closed,
  so what remains is two rounds overlapping (a double click, a manual refresh
  during the nightly run). Not worth changing the machinery every nightly
  refresh runs through. The universe check part is done.

**g. Robustness.**
- The headline feed's entity decoder ignores an out-of-range character
  code instead of throwing, which stalls that stock's news.

**Not finished by the tool:** a safety filter stopped its proof-writing
step twice, so each finding's proof is a written trace and its regression
test is described rather than written as code. The tests are still owed,
one per fix, failing before it. Whether the private-file gate can be
bypassed through Vercel's edge, and not only in Express, was not tested on
the live site; that waits for a running copy (entry 40).

## 46. Gaps found while filling the Long run group — 2026-10-19

*Area: Data · Status: Open · Note: found on the first fill of the Long run group (docs/context/long-run.md); the owner asked for them on the backlog; nothing was changed*

The first fill of the Long run columns (growth over years, P/E against its
ten-year median, the dividend record, interest coverage, the Piotroski
F-score) left blanks and odd readings that trace back to the stored data,
not to the new arithmetic. Each is a company's own filings or the way they
are mapped, which is why none was patched from the Long run side.

- **a. Exxon has no filings history.** Its `sec_state` row carries CIK
  2115436 with 4 rows of filings; Exxon's long-standing CIK is 34088. Either
  the company re-registered under a new holding company (and the history
  sits under the old CIK) or the mapping is wrong. Every filings-fed column
  is blank for XOM, not only the Long run ones. First step: look up both
  CIKs at the SEC and see which one carries the 10-K history; if it is a
  re-registration, the reader would need to stitch the two. Worth a sweep of
  `sec_state` for other companies with a very low row count.
- **b. One odd filed figure breaks a dividend streak.** Procter & Gamble's
  filings state dividends per share of 3.00 for fiscal 2017, between 2.66
  (2016) and 2.79 (2018), so its run of raises reads from 2018 where its real
  record is decades. Shown as filed for now. A neighbour check like
  `reconcile`'s scale check (a value out of line with the years either side,
  and with the trail of filings for that year) could catch this kind, but it
  must not "correct" a real special dividend; measure how many companies it
  would touch before deciding.
- **c. Gaps in quarterly data leave too few trailing years.** Applied
  Materials has 12 complete trailing years in 17 years of quarters, short of
  the 20 profitable quarters the P/E median needs; the Lines card's P/E has
  the same holes. Measure how many companies are short for this reason
  rather than for losses, and trace one: is it a missing fourth quarter (a
  52/53-week year outside `TTM_MIN_DAYS`/`TTM_MAX_DAYS`), or a quarter with
  no revenue in any filing?
- **d. Banks have no P/E history.** `SecFacts.ttm` needs a revenue line for
  a trailing year and a bank files none (the known lender gap), so there is
  no P/E vs median for any bank, and no P/E line on the Lines card either. A
  net-income-only trailing year for P/E would fill it; it would have to stay
  out of everything that divides by revenue.
- **e. No interest expense tag for some large companies.** Apple, Johnson &
  Johnson, KLA and others have no interest coverage because their recent
  filings carry none of the four tags read (Apple reports interest inside
  other income). Check which tags they do use before adding any, and whether
  the figure is really interest expense.
- **f. Visa and Mastercard lose interest coverage and the F-score.** They
  sit in Credit Services with the card lenders, and lenders are excluded as
  a group (`LENDER_INDUSTRY`). Telling a payment network from a lender would
  need a rule that is not the industry name (for example interest expense
  as a share of revenue), measured on the whole sector first.

## 47. Make the GitHub repository private — 2026-10-21

*Area: Infrastructure · Status: Open · Note: the owner asked whether it could be done, then for it on the backlog; nothing changed. Checked against production on the day*

The repository (`ChinmoyMandal74/StockPulse`, a personal account) is public:
the code, CLAUDE.md, everything in `docs/` and every commit message are
readable by anyone. No secret is in it (`.env` was never committed), but
those files describe how the site works in detail. Making it private is one
setting on GitHub (repo Settings, General, Danger Zone, Change visibility);
it is the owner's to flip, not something done from this machine.

What depends on it being public, checked 2026-10-21:

- **Deploys: unaffected.** Vercel deploys a private repo from a personal
  account on every plan; a push to `main` keeps deploying.
- **`/backlog` and `/research`: unaffected as things stand.** `docText()`
  reads the bundled file first and falls back to `raw.githubusercontent.com`
  only when `docs/` is not in the function; production answered
  `source: file` for both. If a build ever stopped bundling `docs/`, the
  fallback would fail on a private repo (members read `/research`), so the
  fallback would want a token too, or the docs copied into `private/`.
- **`/buildlog` will break.** It reads the commit history from the GitHub
  API, unauthenticated; a private repo needs a token, and production has no
  `GITHUB_TOKEN`. Before flipping: a fine-grained personal access token
  limited to this repository with read-only Contents, added to Vercel as
  `GITHUB_TOKEN` (the route already sends it when set); it takes effect on
  the next push.
- **GitHub Actions:** `nightly-refresh.yml` is manual-only now, so private
  Actions minutes (2,000 free a month) do not matter.

After flipping: confirm `/buildlog` loads, and update every note that
assumes the repository is public: CLAUDE.md's "The repository is public"
line, `docs/context/the-build-log.md` (which says no token is needed),
`docs/context/the-backlog-page.md` and the `docText` comment in server.js.
Entry 44(c), the research files tracked in git, is the same question for a
smaller set of files and would be settled by this.

## 48. Earnings releases: what is left after the first round — 2026-10-22

*Area: Data · Status: Open · Note: the owner chose the stock page, the Results reported card, the 10-Q check and the runs log (built 2026-10-22, docs/context/earnings-releases.md) and asked for the rest on the backlog, the 6-K filers included*

Earnings releases (`releases.js`, `earnings_releases`) read each results
8-K's press release into fixed fields. Four pieces were weighed and left:

- **(a) A revenue estimate, so revenue can be set against one.** EPS has
  the price provider's estimate; revenue has none. Twelve Data's revenue
  estimates are Ultra-plan only (they 403 on the Pro key, see
  `fundamentals-data.md`). Finnhub's earnings calendar lists a revenue
  estimate and actual beside EPS; the free tier's coverage and accuracy are
  untested. The step before paying for anything: read it for 20 companies
  that reported this month and compare with the releases, as the release
  reader itself was tested. An owner decision on cost.
- **(b) Guidance against what happened.** Each release stores the
  company's outlook as printed (`guide_kind`, `guide_low/high/mid`, the
  sentence). When the next quarter's release arrives, the reader could say
  plainly whether revenue came in above, within or below the company's own
  range: a fact, not a forecast. Needs a quarter of stored guidance first,
  so it becomes useful from January 2027. Only ranges and midpoints in
  money compare; growth percentages and "other" outlooks are left out.
- **(c) Same-evening results.** Most companies report after the 4 PM close,
  and the release is read the next morning, when the daily SEC index lists
  it. Polling the SEC's live list of new 8-Ks (the "current events" feed)
  every half hour in the evening during earnings season would put a release
  up the same night. Costs SEC requests from the laptop, which has had a
  429 and a 403 before: paced, sequential, and only for item 2.02.
- **(d) Foreign filers (Form 6-K).** Companies that file a 6-K instead of
  an 8-K (TSM and the other foreign private issuers in the universe) are not read: a 6-K has no item 2.02 to find it by, and its
  exhibits vary far more (a press release, a full interim report, slides).
  It would need its own way of telling a results 6-K from the rest, likely
  the model's own "is this a results release" answer over every 6-K, which
  costs more for fewer companies. Count the 6-K filers in the universe
  before deciding.
- **(e) The estimate on the morning after a report.** Found building the
  Results reported card: Twelve Data's EPS history (`earnings_history`,
  where the estimate comes from) gains a quarter only when the company's
  profile is next pulled, often days after the report, so on 2026-10-22 none
  of the previous day's 49 releases had an estimate beside it. The reader
  could fetch `/earnings` for each company it reads (20 credits each, up to
  ~3,000 on a busy day, paced inside the 610-a-minute limit and clear of the
  price windows) and write the quarter through the existing earnings-history
  path. Note the profile's `nextEarningsDate` feeds the Signal's Earnings soon
  rule and must not be touched by this; only the history rows would be.
  An owner decision on credits.

## 49. Twelve Data financial statements, only where the SEC has no quarters — 2026-10-25

*Area: Data · Status: Open · Note: the owner asked for these on the backlog after the per-share history was restated to today's share basis (docs/context/charts-and-the-stock-page.md)*

Question asked: now that revenue and EPS per share are worked out from the
SEC filings, is storing Twelve Data's financial statements worth it? **Not
across the universe.** On the Pro plan `/income_statement`, `/balance_sheet`
and `/cash_flow` return **6 quarters** and refuse more ("Full access to
historical data is available only in the Enterprise plan"), at **100
credits per statement per company**: about 128,000 credits for one pass of
the income statement, ~3.5 hours at 610 a minute, ~385,000 for all three,
repeated each quarter to build history forward a quarter at a time. The SEC
filings already give 10 to 17 years of quarterly revenue, net income and
diluted counts for US filers, and the restated EPS TTM matches the
provider's (NVDA 7.94 against 7.91, MSFT exact). Three narrow gaps remain:

- **(a) Companies with no quarterly SEC figures.** A foreign filer on an
  annual 20-F (and many ADRs) has no 10-Q, so its per-share history on the
  stock chart is annual or empty. Twelve Data covers them, six quarters at a
  time. **First step, no credits: count them** (companies with a profile but
  no `sec_facts` quarter in the last two years); the guess is a few dozen.
  Then a once-a-quarter `/income_statement` pull for that list only, a few
  thousand credits, kept by quarter rather than replaced.
- **(b) The reporting currency.** For an ADR the money figures are in the
  reporting currency (ERIC: SEK) and the only place Twelve Data names it is
  `/income_statement` meta (docs/context/column-groups.md). The same pull
  as (a) would give it for those companies; a display decision of its own.
- **(c) An explicit fourth quarter.** The filings leave Q4 to be worked out
  as the year less three quarters. Already done for revenue and net income;
  only a single quarter's per-share figure is affected, and the trailing
  year avoids it. Lowest value of the three.

An owner decision on credits; nothing here touches the Signal.

## 50. How stocks trade around major events (elections, Fed decisions) — 2026-10-25

*Area: Pages · Status: Open · Note: the owner asked "How stocks trade around major events like elections …. What is the best way to show these", and for the answer on the backlog*

**An event study, shown three ways.** Every past instance of an event lined
up on the same day 0, and what followed:

- **(a) Aligned paths, the main view.** Trading days from about -20 to +60
  across, return against the equal-weight average stock (the research page's
  benchmark) up the side; one thin line per past instance (presidential
  elections 2008, 2012, 2016, 2020, 2024) and a bold average. The spread of
  the thin lines is the reading as much as the average: with five instances
  it shows at once whether there is a pattern or five different stories.
- **(b) Who moved: a sector (or theme, or index) table.** Rows the groups,
  columns each instance and the average, each cell day 0 to +20 against the
  market. Elections show here more than in the market's own path (banks and
  small caps after 2016, clean energy around 2020 and 2024).
- **(c) One stock's record**, a panel on the stock page: its own path against
  its sector's around each past instance.

**Calendars**: one small hand-kept table of dated events (US presidential and
midterm elections, Fed rate decisions, CPI release days, quarter-ends, index
rebalances). Earnings already have their own history on the stock page.
Prices from the bar archive (back to 1998 for older names), built nightly and
stored like `groupmonths.js`, so no Twelve Data credits and nothing computed
per request.

**Where**: a members' page `/events` (an event picker and a group picker),
then a promo card ("Around the last five elections") from the same stored
figures. First calendars: elections and Fed decisions.

**Said on the view itself, not only here**: the number of instances on every
chart ("5 elections") with every line drawn, never just an average; the list
of stocks is today's, so the early paths leave out companies that failed
since; a record of what happened, not a forecast, and no buy, sell or hold
wording. Nothing here reaches the Signal.

## 51. Relative performance against the S&P 500: two tests not yet run — 2026-10-26

*Area: Research · Status: Open · Note: the owner: "a stocks own performance in future cannot be predicted but its relative performance compared to s&p 500 somewhat predicted .. what do you think", then "Add to backlog and then run the first one"*

Every backtest on `/research` already measures against the average stock, so
the eleven framings tried were tests of relative performance, and ten were
flat. Two framings with the best case in the literature have not been run
cleanly here:

- **(a) A long, intact compounding record.** Comp. record 4 or 5 with Now
  "Still growing" (entry built 2026-10-25/26), POINT IN TIME: each company's
  record and Now as its filings stood on each past month's first session
  (`SecFacts.visibleAsOf`, filed dates; splits known by then), never today's
  values carried back. Forward one and two months against SPY and against
  the equal-weight average, before and from 2020, monthly block bootstrap.
- **(b) Classic 12-1 momentum**: the return over the past twelve months
  skipping the latest one, deciles each month, the top against the bottom
  and each against SPY, at one and two months. The retired price-strength
  score blended eight factors, so this one alone has not been tested.

Both offline against the local copy, written up on `/research` as relative
tendencies, never as buy or sell calls. Survivorship applies to both (the
list is today's).

## What is deliberately NOT on this list

- **Rebuilding the momentum score.** Removed 2026-09-23 at the owner's
  instruction. If it is ever revisited, read
  [momentum-scoring.md](momentum-scoring.md) and
  [momentum-delta.md](momentum-delta.md) FIRST — twelve framings between them,
  every one flat — and start from `git show momentum-scoring:momentum.js`, not
  from memory.
- **Storing Twelve Data's financial statements for every stock.** Six
  quarters on the Pro plan at 100 credits a statement per company, against
  10 to 17 years free from the SEC filings. Decided 2026-10-25; the narrow
  exceptions are entry 49.
- **Analyst ratings and price targets.** The endpoints need a Twelve Data Ultra
  plan and 403 on Pro for everything but the AAPL demo. The whole path was
  deleted 2026-09-23 rather than left behind a flag that cannot usefully be
  switched on. Git has it if the plan ever changes.
