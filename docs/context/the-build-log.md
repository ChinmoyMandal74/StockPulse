## The build log — every change ever made, with the reason recorded at the time (2026-10-04, owner's request)
**`/buildlog` (admin, a `Build log` row in the console's Reference section): the project's own version-control history, read for a general audience.** Asked as *"is it possible to extract a list of all changes made to app, maybe we get it from Git"*, then scoped by the owner — **audience everyone, admin-gated, with a Refresh**, and *"fine with doing 2 and 3"*, which was both shapes offered: the mechanical dated record AND a feature-level narrative over it.

### `.git` IS NOT SHIPPED WITH THE FUNCTION, which is what decided the source
Vercel bundles the repo's *files*, not its history, so `git log` at request time is impossible — and that is not a limitation here, it is the thing that makes a live Refresh possible at all. The source is the **GitHub REST commits API** (`/repos/<owner>/<repo>/commits?per_page=100&page=N`), which a deployed function can read on demand.

- **THE REPOSITORY IS PUBLIC**, which the owner may not have had in mind and which three things follow from: no token is needed (60 requests/hour/IP unauthenticated is ample against 7 a full walk; `GITHUB_TOKEN` raises it to 5,000 if that ever changes), the full commit messages come back, and every entry can link to its own record on github.com. **So admin-gating this page is a presentation choice, not a confidentiality one** — the same text is already readable by anyone who finds the repo, CLAUDE.md included. A comment on the route says so, and opening it to members is one line. `.env` is correctly untracked.
- **The payload is lead paragraphs, not bodies.** Measured: the full messages are **884KB**; the first paragraph of each is **180KB**, median 288 characters. The whole text is one link away, so the page ships the opening and nothing else — live, **280KB over the wire** under brotli.
- `BUILDLOG_MAX_PAGES` (15) is a stop against a runaway walk, not a budget: 619 commits is 7 pages.

### GITHUB Z-NORMALISES THE AUTHOR DATE, AND IT REPORTED A DAY THAT NEVER HAPPENED
`commit.author.date` comes back as `2026-10-04T21:48:23Z` for a commit made at `17:48 -04:00` — **the offset is discarded**, so evening work files on the next calendar day in UTC. Measured on the real history: the busiest day read **50 against a true 49**, and six commits sat in the wrong week.

- The fix is `nyDay(ms)`, **the app's existing answer to "which day did this belong to"**, shared with the nightly job — not a second date rule. After it: 49, and the weekly buckets match `git log` exactly (124/160/153/130/24/24/2).
- **Proved by reverting**: the UTC slice fails 3, including the active-day count and the faint-bar count.
- The page says which clock it groups in, because a reader comparing it with GitHub's own UI will see different days.

### THE INCREMENTAL STOP RULE COULD NOT HEAL A HOLE — found before a line of it ran
*"Stop at the first page with nothing new"* is the obvious shape and it is wrong: if a first seed dies after page 2, pages 3-7 are missing **for ever**, because every later refresh stops at page 1. My own comment on that line claimed otherwise.

- `buildlog_meta` in `app_meta` carries a stored **`complete`** flag: every refresh is a full walk until one walk runs off the end of the history, and only then does it go incremental. The `noteTechMark` principle — self-pacing work that heals after any number of failures.
- **Proved by reverting**: 7 checks fail, `added 0` against 150 missing, `1 asked`.
- **A throttle is HTTP 200 with `throttled: true`**, worded as a wait with the minutes from `x-ratelimit-reset` — not an error, because the page is not broken. **The words are OURS**: there is a check that GitHub's own body never reaches the client, since an upstream error can restate the request.
- Reads are **indexed `where sha in (...)`** 100 at a time, never a scan of the table's text to learn what it holds; writes are multi-row inserts chunked at 100 (the `tech_history` measurement, where the cost is per STATEMENT and batching was 23x). `idx_buildlog_at (at, sha)` — `(at)` alone planned as `USE TEMP B-TREE FOR LAST TERM OF ORDER BY`.

### A `<summary>` INSIDE THE CORE IS NOT A CONTROL, and only the deployed page said so
The double-bezel pattern is `<div class="bezel"><div class="core">`, and wrapping a `<details>` that way puts `<summary>` one level too deep. **A `<summary>` is the disclosure control only as the details' OWN first child** — otherwise the browser draws its default **"Details"** label, the real header becomes ordinary content, and clicking it does nothing. Every week on the page shipped that way.

- **`<details>` is the `.core` element itself now**; the bezel shell stays outside it, so the card looks identical and the semantics are right. `[open]` moved with it (`.bl-week > .core[open]`).
- **A RECT IS THE WRONG MEASURE INSIDE A SHUT `<details>`, which is the one place in this project where measuring the drawn box lies.** Chrome hides the content with `content-visibility`, so a descendant **keeps a laid-out rect and a non-null `offsetParent` while being invisible** — probed at 44px, and the first version of the check read 71.8px before AND after the click. **`checkVisibility()` is the honest answer**, with the details' own height as a second witness.
- **Nor can the default label be searched for**: it is generated content and never reaches `innerText`, so that check was vacuous. The check clicks **every** week, asserts `open` and visibility both flip, and finds the `<details>` whatever shape it is in — so it cannot pass by rearrangement. **Proved by reverting**: fails 3, with `was.open true → now.open true`, the production symptom exactly.
- **Four figures in the summary row, not five.** Five divides cleanly into no row a screen can hold, so one always sat alone at the end — measured 4+1 at 1500px against a 1,056px container. The typical length moved into the Explained card's own sentence, where it belongs. The check groups the cards by the top of their **drawn box** and fails on a row of one, which is the claim rather than the count; **proved by reverting**, which names the `[4,1]` row.

### The two halves, and how the written one is kept honest
- **The record**: every change, newest first, a week at a time, each with its one-line summary, the opening of its explanation and a link to the full text. Every figure above it — changes, days of work, busiest day, share explained, typical length — is **counted from the record**, so Refresh keeps all of them true and nothing is typed in by hand.
- **The narrative**: eleven hand-written chapters, dated *"Written on 4 October 2026"* because that is the half that can rot. **Each chapter's count is computed from the live log**, and the coverage line reports in amber if any change falls outside every chapter — so the writing going stale is visible rather than silent. **The last chapter is open-ended (`to: null`)**, so new work always lands inside one; **proved by reverting**, which puts 2 of 10 outside and turns the line amber.
- The limitations panel is unconditional and names what the page cannot say: that a count of changes is not a measure of value, that the nine research framings that came back flat are in here as changes too, and which clock the days are grouped in.
- **First live reading**: 619 changes over 45 days, **39 with work**, busiest **49 on 13 September**, **97% explained** (597 of 618) at a median of **1,503 characters** — roughly 250 words of reasoning per change.

- Verified: **92 checks** (the routes and the page, GitHub stubbed, over a 10-commit fixture plus a 250-commit bulk walk) and **28** on the roles (admin / stranger / guest / member, each refusal body searched for a marker commit subject). **Thirteen reverts, every one load-bearing.**
  - **A FIXTURE OF ONE CALENDAR WEEK CANNOT TEST WEEKLY GROUPING.** All nine dates fell inside one Monday-to-Sunday week, so "the log is grouped into weeks" asserted over a single bucket. A tenth commit in the previous week fixed it, and eleven dependent expectations moved with it.
  - **`requireAdmin` ANSWERS 403 WHERE THE SESSION GATE ANSWERS 401**, so a suite asserting one number reports a failure over a working refusal. Assert *refused*, and assert separately that nothing changed.
  - **A MEMBER FIXTURE IS THREE STEPS**: the first account registered becomes the admin, and the `ADMIN_PASSWORD` hatch creates **no user row** — so the users table was still empty and the first run of that suite tested an admin while calling it a member.
  - **A patch script ended its own template literal** three times over — the replacement text carried backticks and nested quotes. The project's own rule applies to patch scripts as well as to prose: put the block in a plain text file and splice it, or use Write/Edit.

