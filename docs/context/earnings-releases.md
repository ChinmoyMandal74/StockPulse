## Earnings releases: the results press release, read by AI (2026-10-22)

The owner showed a newsletter's earnings round-up (revenue and EPS against estimates, guidance, a few lines of story) and asked: "Is there a way to get this data". Then: "Do you think we can read these 99.1 exhibit details and store it in a separate table using AI", "go ahead with a prototype", and "We don't need to build history, But you can go like a month back".

### What it is
- **The source:** a company's results press release. It is filed with the SEC as Exhibit 99.1 of an 8-K carrying item 2.02. The daily SEC read (`secdaily.js`) already records every such 8-K in `sec_events`.
- **The reader:** `release-load.js` fetches the exhibit and has Claude Haiku 5.5 copy its figures into fixed fields (`releases.js`).
- **The table:** `earnings_releases`, one row per filing.
- **Display:** `/filings` lists the day's releases first ("Results reported"), and `/api/releases?symbol=` gives one company's.

### The prototype (20 releases, before anything was built)
- **Against the SEC's 10-Q figures:** revenue, net income and GAAP EPS matched on all 22 comparisons possible.
- **Against Twelve Data's EPS:** 9 of 10 matched. The miss was Danaher's $1.17, against $1.94 adjusted and $1.23 GAAP in the release; the 10-Q confirmed the release.
- **Non-results releases:** two 8-Ks that were not results (IREN's contract news, SMCI's preliminary update) were recognised as such.
- **The text check worked:** it caught the model working out a guidance range from "$8.60 billion +/- $400 million".
- **Cost:** $0.038 for all 20, about $0.002 a release.

### The rules
- **The model copies; it never computes.** Each figure comes back exactly as printed, with the scale the document states, and our code scales it.
- **Every printed figure must be in the release text,** as a whole number token (`inText`). One that is not is dropped and named in `problems`, and the page says how many were left out.
- **Two EPS figures, never one:**
  - GAAP diluted.
  - The company's own adjusted EPS, stored with its own name and what it leaves out. That includes an EPS given "excluding" an item, such as Meta's $7.40 against $3.83 reported in 2026 Q3, after its $9.89B litigation charge. Adjusted has no standard definition, so it never travels without its label.
- **Guidance is copied in the shape printed** (`guide_kind`): a range, a midpoint plus-or-minus, a percent growth, an EPS range, or other. The plus-or-minus is kept as printed (its scale can differ from the midpoint's), and the outlook sentence is kept verbatim.
- **Summaries:** two or three sentences of fact. One using buy, sell, hold, strong, weak and the like is dropped (`BANNED`).
- **Not a results release** (a business update, a contract announcement): recorded with `is_results` 0 and no figures, so it is not fetched again. A filing with no EX-99 exhibit is recorded the same way.
- **Written once.** `insert or ignore` on the filing number; a reading is never replaced.
- **Display only.** Nothing reaches the Signal.
- **No schema with many nullable fields.** The structured-output compiler refuses that, so every text field is a plain string where "" means absent (found on the prototype).

### The price provider beside it
`againstProvider` takes the `earnings_history` row within five days of the filing and says whether Twelve Data's reported EPS matches the adjusted figure, the GAAP one, or neither. Neither is shown in amber. The estimate is the provider's; the page says how far the matching figure is above or below it.

### Running it
- **The loader:** `node --use-system-ca release-load.js` is a dry run (it still calls the model); `--commit` writes. Options: `--days N` (default 4, at most 45), `--symbol S`, `--max-usd` (default 2), `--max-minutes` (default 40). Newest first.
- **The schedule:** `release-task.ps1` registers **TickrLab earnings releases**, weekdays at 07:00 local, `--days 5`, at most $2 or 40 minutes, logging to `release.log`. That is after the 04:00 nightly, whose `sec daily` phase records the previous business day's 8-Ks; a Friday's are read on Monday.
- **SEC:** two fetches a filing (the index headers, then the exhibit), sequential, declared user agent (the server's own `REPORT_TO`/`MAIL_FROM` address), 400ms apart. A 429 or 403 stops the run.
- **Correcting readings:**
  - `--reread` replaces only the readings that were refused or judged not results.
  - `--force --symbol S` replaces a company's readings in the window, for a fault the checks could not see.
  - Every other row is left as written.

### The first fill (2026-10-22)
- **Volume and cost:** 31 days back, 185 results 8-Ks, $0.34, 12 minutes.
- **Three reader faults** were found on it, fixed, and their rows re-read:
  1. **Tesla's quarterly "Update" and some shareholder letters were judged "not a results release".** The question now names those forms.
  2. **Figures printed with a scale word were refused by the text check.** Examples: "16.3 billion" in Capital One's prose, "$8.60 Billion" in Lam's guidance. A scale word is now split off (`split`): the digits are checked against the text, and the word is the figure's scale.
  3. **TD SYNNEX's revenue was stored as $21.6 million instead of billion.** It is printed in thousands, and the model said "units". A figure called "units" now takes the scale the release states ("in thousands"). If it states several, it takes the one stated last before the figure; if none comes before it, the figure is refused, not guessed.
- **After the fixes:** 153 results releases and 32 others.
  - All 32 "not results" calls were checked against the stored summaries and are right: preliminary updates, an acquisition, restated figures, operating data, a deliveries report. Eleven filings had no press-release exhibit.
  - Refused figures left: one company's (Lam's EPS guidance range, worked out from a midpoint). Its sentence is kept.
- **Against the 10-Q,** for the 31 releases whose 10-Q is filed:
  - GAAP EPS matches 23 of 24.
  - Net income matches 26 of 29.
  - Revenue matches 24 of 29. The differences were SNX, since fixed, plus definitions: Paychex's total against service revenue, Jefferies' net revenues, Prudential's total revenues, and Applied Digital's continuing operations, which is the figure its release headlines.
- **Against Twelve Data:** 75 of the 80 with a provider figure match (46 adjusted, 29 GAAP). The 5 that differ are definitional (Citi, Progressive, Prologis) or have no EPS in the release.

### Round two (2026-10-22): the stock page, the card, the 10-Q check, the runs log
The owner chose four of seven next steps and put the rest on the backlog (entry 48).

- **One way of writing a release out:** `private/releaseview.js` (global `ReleaseView`) formats a release for both pages:
  - money and per-share figures, and the change on a year ago;
  - the estimate, with how far the matching figure is above or below it;
  - the 10-Q line;
  - the figures left out.

  Each page styles the two classes it returns, `rv-sub` and `rv-amb`. The promo card has no DOM and formats for itself.
- **The stock page:** a **Results releases** card follows Earnings history (`#rels`, `loadReleases()`, `/api/releases?symbol=`).
  - It shows the latest four releases, each with revenue, both EPS figures (the adjusted one under its label), the estimate, the outlook sentence, the summary and the 10-Q line.
  - It stays hidden for a company with none.
- **The Results reported card** (`reported`, Market group, after Filed yesterday):
  - **Content:** one day's results releases by companies on the screen, the largest first, with revenue and its change, EPS (adjusted where given, marked "adj.", else GAAP) and where it sits against the estimate. Nothing is coloured good or bad.
  - **Controls:** `rptDay` (the newest day with releases, or one picked), `rptSp500`.
  - **Rows by size:** portrait 10, square 8, story 17, each with an "and N more" line. Measured on 2026-10-21's 49 releases, all sizes, all cuts.
  - **Data:** both hosts call `releasesDayPayload` (the studio through `/api/releases/day`, members only; the phone through `getReported`).
- **Against the 10-Q:** each committed run of the loader compares every results reading of the last 120 days not yet compared (`readReleasesToCheck`) with the company's `sec_facts` quarter (`tenQCheck`).
  - It stores the 10-Q's revenue, net income and diluted EPS and the result (`sec_check`: match, differs or none) beside the reading, never over it.
  - The pages show a quiet "Matches its 10-Q filed …", or what the 10-Q has, in amber.
  - First run: 31 compared, 4 differ. All 4 are definitions, not errors: Paychex, Jefferies, Applied Digital, Prudential.
- **The runs log:** `earnings_release_runs`, one row per committed run, kept. `/news-runs` has an **Earnings releases** section like Article tone's: the last run, 7 and 30 days, the table. It warns after three days without a run, on a failure, at the cost cap, or when filings could not be read.
- **The provider's estimate comes late.** Twelve Data's EPS history gains a quarter only when the company's profile is next pulled, often days after the report. On 2026-10-22 none of the 49 releases from the 21st had one (META's next report was estimated as the 28th). The card leaves the estimate column off when none of its rows has one and says why; the pages show a dash. Fetching `/earnings` at read time would close this; it is backlog 48(e), with its credit cost.

### Not covered
- **Foreign filers** (6-K instead of 8-K): TSM and the other ADRs.
- **Releases whose numbers are only in a slide deck** (EX-99.2) or in images: they come back with dashes.
- **The 10-Q cross-check is not run automatically yet.** The prototype ran it by hand. A later pass could compare each stored row with `sec_facts` once the 10-Q arrives.
