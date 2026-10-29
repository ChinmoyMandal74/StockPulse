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
- **The schedule:** `release-task.ps1` registers **TickrLab earnings releases**, weekdays at 09:15 and 18:15 local (07:00 until the owner moved it on 2026-10-22), `--days 5`, at most $2 or 40 minutes, logging to `release.log`. That is after the 04:00 nightly, whose `sec daily` phase records the previous business day's 8-Ks; a Friday's are read on Monday.
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

### On the screener: the group "Last Earning AI Extracted" (2026-10-22)
The owner: "Why only 3 columns, Why not include all the columns ... Just call it 'Last Earning AI Extracted'". So all of it went in, as one group (id `aier`, colour azure `#93c5fd`, light `#1d4ed8`, token `--azure`).

**The 18 columns:**
- **Dates:** Reported (a link to the release, with the days since) and Quarter end.
- **Money:** Revenue, Operating income and Net income, each with its change on a year ago.
- **EPS:** GAAP and adjusted (hover for the company's label and what it leaves out), each with its change on a year ago.
- **Against the estimate:** the EPS estimate, and the gap per share.
- **Outlook:** Guide vs Q, the outlook sentence, the 10-Q state, and the summary.

**How the cells behave:**
- Money is in the reporting currency.
- Growth is uncoloured: it is not a price move.
- A change off a loss is blank.
- Text is cut to one line and read in full on hover.
- 10-Q Differs is amber.

**Where the data comes from:**
- **One stored figure** (`fig:releaseColumn`) holds each company's newest results release of the last 130 days (`Rel.columnRows`, joined with the provider's estimate). The loader writes it after every committed run; `--column-only` rebuilds just that.
- **`/api/releases/column`** (members) serves it. The screener fetches it after it paints and merges it into its rows with `ReleaseView.fields`, the one mapping, which the stock page's All fields uses too. Like Tone 7D it is never stamped on a snapshot row.
- **The Signal boundary was proved behaviourally** on the 1,283 real rows: the group absent, present and lying, identical verdicts. The same method, lying about `vs200ma`, changes every verdict.

**Guide vs Q only compares a quarter's outlook.** The comparison is the range's middle, or the printed midpoint, against this quarter's revenue, and only when the outlook's period names a quarter and not a year. On the first draw Medpace's full-year guidance read +297% against one quarter.

**The column bookkeeping:** `PAD_SPAN` 139 to 157, the error row 114 to 132, the empty row 116 to 134, and the fund `naRun(18)`.

**The other places a group is named:** `GROUPS`, the colours and light tint, and the labels in `index.html`; `GROUP_ORDER`, the colours, the labels and `FUND_NA_GROUPS` in `rowcard.js`; `mobile.html`, `mobile-setup.html`, `columns.html`, `app.css`, and `TILE_FIELD_RE` in `server.js`.

**`filters.js`:** Reported and Quarter end filter as days since; Outlook and Summary as text; 10-Q as a category.

**Two `FIELD_SPEC` labels were renamed to stay unique** (the stock page refills by label): "Release filed" and "Net income, quarter".

**The stock page's All fields:** the group's section is absent when the page first draws (every field empty then), so `loadReleases` builds that section alone and appends it.

**Coverage builds through the season:** 153 companies on 2026-10-22, most of the universe by mid-November.

### The Results summary card (2026-10-22)
The owner: "If I have a summarize the data at the entire s&p level on earning and which company did better than estimates, what should be referred, and can you add a visual, you can call it Results Summary."

- **The reference** is the shape of the earnings round-ups, FactSet's weekly Earnings Insight being the usual one:
  - how many of the index have reported this season;
  - how many came in above, in line with or below the EPS estimate;
  - growth for the reported companies combined;
  - the same by sector.
- **The template** is `ressum`, in the Market group after Results reported. Its control is `rsmSp500`, defaulting to the S&P 500.
- **The data** is the screener's stored release column (`getReleaseColumn`; the studio through `/api/releases/column`, the phone through the figure), over the host's rows for the index cut and the sector. No new read.
- **The season** is the calendar quarter nearest each release's period end, so a fiscal quarter ending in August or October counts with September's. The card uses the quarter most of the cut's releases from the last 75 days fall in.
- **Above, in line, below:** the figure the provider reports (the adjusted one, or GAAP where that is what it matches) against its estimate, to the cent. A company with no estimate yet is counted as "estimate not yet on file", never guessed.
- **Growth combined:** the sum of the reported quarters against the same quarters a year earlier, US-dollar reporters only, both quarters printed. It covers reported companies only, with no blend of estimates for the rest.
  - **Net income growth is shown for the index only.** By sector it swung on a few companies with tiny or loss-making prior quarters (Financial Services +1,281%, Industrials −98% on the first draw), so the sector table shows Below est. in its place.
- **No ranking:** no list of the biggest beats or misses. Above is blue and below is orange, as on the tone cards, never green and red.
- **First draw** (S&P 500, Q3 2026, 2026-10-22): 87 of 500 reported; 44 of 53 with an estimate came in above, 4 in line, 5 below; revenue +12.2% over 83 companies; net income +29.3% over 85. Every headline figure matched an independent count made in the test harness. All 11 sectors fit on every size.

### Results summary for a sector, an industry and a theme (2026-10-22)
The owner: "Can you now create the same card for sector industry and theme." It is one builder (`tplResultsSummary(tpl)`, `RS_TPLS`) with four templates.

| template | group | table | controls |
|---|---|---|---|
| `ressum` | Market | a row a sector | `rsmSp500` (S&P 500 by default) |
| `secressum` | Sector | a row an industry | `rssName` (Technology first), `rssSp500` (every stock) |
| `indressum` | Industry | a row a company | `rsiName` (Semiconductors first), `rsiSp500` |
| `thmressum` | Theme | a row a company | `rstName` (blank: the theme with the most reported), `rstSp500` |

- **A company row** shows the ticker and name, the day it reported, where it came in against the estimate ("$1.60 above" in blue, "below" in orange, "in line", "no estimate yet") and its revenue growth. Reported companies come first, the largest first, then those not yet reported, in grey. The rows are not ranked by the size of a beat.
- **The season is always the whole cut's,** not the group's: a group of six left to itself could settle on another quarter than the market's.
- **The theme default:** blank means the theme with the most companies reporting in the last 75 days. The first theme alphabetically had none on the first draw.
- **Checked** in the real studio over production's data, every size: every headline count matched an independent recount, and the company tables keep reported first. Micron's +379% revenue growth looked like a misread and is not: Twelve Data's own figures agree (+379.3%, $133B over twelve months).

### The Signal-input recon: `/recon` (2026-10-22)
The owner: "Build me a recon page only for s&p 500 only for these important that we need for signal calculation showing Twelve data and our AI-extracted release, This should be at the quarterly level starting this current quarter, Also show the release date."

- **Admin only** (`/recon`, `/api/recon`), linked from the admin console. S&P 500 members (today's list), a reporting season at a time, from 2026 Q3 on.
- **The Signal's fundamentals inputs** (Established, Balanced), side by side:
  - Revenue growth and earnings growth: the quarter on the year earlier on both sides (Twelve Data's earnings growth is net income's; Micron matched to the decimal). These carry a gap in points and are amber past 0.5.
  - Profit margin and net income positive: twelve months at Twelve Data, one quarter in the release. Shown side by side, never called a match.
  - FCF margin: not extracted from releases.
- **The dates:** the release's filing date, the quarter end, and Twelve Data's last report date.
- **Status:** Agrees, Differs, Provider behind (Twelve Data's report date not within five days of the release, its figures shown grey), Incomplete, No release yet.
- **History:** `signal_recon`, one row per company per season, written by the loader after every committed run and with `--column-only` (`writeRecon`).
  - The release's side takes the newest reading.
  - Twelve Data's side is refreshed while it is behind and **frozen** (`td_frozen_at`) the first time it is on the same report, so each season keeps the figures that described it.
  - Never pruned; on the per-symbol list. `releases.js`: `seasonOf`, `reconRow`, `reconStatus`.
  - The freeze was tested on an in-memory database and proved by reverting it.
- **First reading** (2026 Q3, 2026-10-22): 87 of 500 released; Twelve Data on the same report for 56, behind for 31. Revenue growth agrees 32 of 54, earnings growth 39 of 55.
  - Most differences are definitions (banks' revenue lines, and Twelve Data's earnings growth not being plain net income for some companies: Halliburton, Southwest and GM, where the release's EPS moved with its net income).

**What the recon found: a scale the text check cannot see.** Synchrony's net income was stored as $892 billion and CSX's year-earlier net income as $694 billion. The digits were in the release, so the text check passed them.
- **The new guard (`toRow`, with `meta.ref` from the loader):**
  - A net income whose implied share count (net income ÷ EPS) is not within a fifth to five times the company's shares is refused and named.
  - So is a quarter's revenue not within a tenth to ten times a quarter of the provider's twelve-month revenue.
- **The share count is market value ÷ price,** not the provider's share count: that one can be wrong (CME's reads 359,275).
- **Each figure is checked on its own:** two quarters agreeing with each other prove nothing, since a slip applied to both still agrees.
- **A scan of every stored release found exactly those two.** Both were re-read: Synchrony's net income is now $892 million (its year-earlier figure was refused as not in the release), and CSX's year-earlier figure is $694 million.

**"Provider behind" is not always a few days.** Measured on 2026-10-22: 29 of the 31 were one or two days behind, and the nightly would have caught them. Costco (28 days) and Fastenal (8) had been re-pulled after their releases and Twelve Data still gave the previous quarter.

**Refreshing only the behind (2026-10-22).** The owner: "Can you do something wherein I can do a refresh only for these provider behind cases."
- **The button** on `/recon`: "Refresh Twelve Data for the N behind", with the cost beside it (N × 80 credits, six companies a minute). It asks before spending.
- **The routes** (admin):
  - `GET /api/recon/behind` lists the newest season's companies not on the same report.
  - `POST /api/recon/refresh-behind?symbols=` force-pulls up to six profiles (`RECON_BATCH`) through `ensureProfiles`. It refuses a company that is not behind. It says per company whether it was pulled and whether it caught up.
  - `POST /api/recon/refresh-finish` rebuilds the snapshot once without profiles (`computeStocks` with `noProfiles`), as refresh-one-stock does. It then rewrites the recon rows of the behind companies, which freezes Twelve Data's side for those that caught up.
- **The page drives the loop:** one batch a request, the next 61 seconds after the previous one started, so it stays under 610 a minute. It stops between batches on Stop.
- **Credit windows:** a batch is refused with a 409 in the nightly windows (03:55–04:50 and 15:55–16:50 Eastern, weekdays) and the intraday slots (:13–:20 and :43–:50, 9:10–16:20). The page waits a minute and tries again. Each batch also stands aside for a running refresh.
- **The end** stays on screen with three counts: caught up; **not updated at the provider** (pulled, and Twelve Data still gives the old quarter, as with Costco); and refused by the provider.
- **Testing:** on an in-memory database with a dummy key, so nothing was spent. Checked: anonymous and guest refused; a company not behind refused; six per batch; a refused pull never counted as caught up; two batches 62 s apart; then one finish; the result surviving the reload. The test caught the reload painting over the result. The window clock was checked at eight times on both sides of each window.

### Not covered
- **Foreign filers** (6-K instead of 8-K): TSM and the other ADRs.
- **Releases whose numbers are only in a slide deck** (EX-99.2) or in images: they come back with dashes.
- **The 10-Q cross-check is not run automatically yet.** The prototype ran it by hand. A later pass could compare each stored row with `sec_facts` once the 10-Q arrives.

### The public page: `/results` (2026-10-22)
The owner: "Can you create a page linking the site page .. talking about all the recent results that we extracted from AI … I want make it public."
- **Public, no sign-in**, server-rendered like the blog (`private/results.html`, filled by `resultsPage` in `server.js`), so it reads without JavaScript and can be indexed. In the sitemap; linked from the landing page's nav and footer and from the blog's footer.
- **Content:** every results release filed in the last 21 days (`RESULTS_DAYS`), a day at a time with the newest three days open.
  - Each row: company, quarter, revenue, net income, GAAP EPS and the company's adjusted EPS under its own label, each with the change on a year earlier. Then the two-sentence summary, the guidance sentence, and a link to the release on sec.gov.
  - Four figures at the top: companies reported, revenue up on a year earlier (of those with both quarters), net income up, guidance given.
  - A note on how the figures are read (every figure found in the text, refused figures shown as dashes, adjusted EPS is the company's own definition, check the release, not advice).
- **Deliberately left off:** the price provider's estimate (Twelve Data's data, not ours to publish), the Signal, and any beat/miss wording.
- **Navy, fixed** (`data-theme="navy"`, no theme.js), like the landing page; it was first copied from the blog and came out on the dark theme.
- **Cost:** two small reads (`readEarningsReleasesSince`, `readNames`), held for ten minutes per instance; `Cache-Control: public, max-age=300`.
- Tested on an in-memory database seeded with a read-only copy of production's 143 releases: 13 checks, at 1440px and 400px (no sideways scroll, rows drawn, no placeholder left, no Signal words or estimates, no page errors, sitemap and landing link present). The first look caught the figure cards' padding on the bezel's outer element, which clipped their text.
- **Linked from the screener** (2026-10-22): the More menu (the top-right "More actions" button), under SEC filings, as "Earnings results". Shown to everyone signed in, guests included, since the page is public. Checked drawn in the open menu as guest and as admin.

### The results email (2026-10-22)
The owner: "Can you send me an email after every earning results refresh … I want to see the AI generated summary in a nice email format .. use your imagination to make it look professional."
- **When:** after each scheduled run (`release-task.ps1` passes `--mail`) that wrote at least one new results release. A run with nothing new sends nothing; `--reread` and `--force` never mail.
- **How:** the loader posts the run's new filing numbers to `POST /api/cron/release-digest` (with `CRON_SECRET`). The app reads them (`readEarningsReleasesByAccn`, a primary-key seek), builds the message (`releaseDigestEmail` in server.js) and sends it to the operator address (`REPORT_TO`) through `sendMail`, kind `release-digest`, so it is in the mail log at `/emails`. The laptop needs no mail settings.
- **The message**, on `emailShell` (house header, footer, dark mode):
  - four figures across the top (reported, revenue up on a year ago, net income up, gave guidance);
  - a card a company: symbol and name, the quarter, revenue, net income, GAAP EPS and adjusted EPS (under the company's label) each with the change on a year ago, the AI's summary, the guidance sentence in a shaded panel, links to the release on sec.gov and the stock page;
  - a button to `/results`, and a note on how the figures are read (not advice).
  - A plain-text half with the same content.
- **Gmail clips past about 102 KB.** The first build was 149 KB on a 49-company day; the inline font lists were half of it. Now the cards inherit the body's font, and the email carries 15 full cards, one line each for the next 45, and "And N more on the results page" beyond. Measured: 81 KB for 49 companies, 83 KB for 143.
- **Dark mode:** the house dark rules recolour cells, paragraphs and spans, not `div`s, so the first render had near-black figures on the dark card. `MAIL_DARK_RULES` gained `.em-card div`, `.em-ink` (the figures), `.em-panel` (shaded panels) and `.em-box`/`.em-row` (borders).
- **Tested** through the real route on an in-memory database seeded with production's releases, Resend answered in-process: 15 checks (secret refused, nothing named refused, non-results send nothing, recipient and subject, the META card's figures, summary and guidance, the text half, a busy day, the size at 49 and 143 companies, no buy/sell/beat/miss or Signal words, the mail log row), rendered light, dark and at 390px.

### Guidance, three ways (2026-10-23)
The owner: "Guide vs quarter focuses on revenue, We should rename the field, Also may be AI can create another column called Guide vs quarter for EPS and may be another column that gives a rating on the guidance" ... then, after the measurement below, "do all".
- **What the releases hold** (143 results, 2026-10-01 to 10-21): 73 gave no guidance; quarterly revenue guidance 6, quarterly EPS guidance 4, full-year EPS guidance 37. The reader kept ONE guidance item a release. So an EPS-versus-quarter column would be nearly all dashes, and an AI "rating" of guidance would be a judgement nobody can check and a rating the site does not give. What was built instead:
- **The reader** (`releases.js`) now also returns `guidance_items` (every outlook figure: metric revenue / eps_gaap / eps_adjusted / other, quarter or full year, the figures as printed, and the previous full year's figure when the release prints it beside the outlook) and `guidance_change` (raised, lowered, reaffirmed, initiated, withdrawn, mixed, none, with the words that say it). `guideItems` checks every figure against the text like the rest; `guideChange` keeps a change only when its quote is in the release word for word, carries a word that says that change, and is about revenue or earnings rather than costs.
  - Found on the first dry runs: the model called CACI's "raising ... revenue and EPS; reaffirming the rest" *mixed*, and Meta's "raising our expense outlook" *mixed*; the instruction now judges only revenue and earnings guidance (raised plus reaffirmed is raised), and a quote about costs alone is refused. Crown's "We expect full year ... EPS" came back *initiated*: "expect" and "provide" no longer count as the word for initiated. Alaska's "we now expect a loss of ..." and Genuine Parts' old-and-new range table say a change without a word for it, and are left blank: the column only says what the release says.
  - The structured-output API refuses `maxItems` on an array; the code caps the list at eight.
- **Storage:** four columns beside the reading, `guides` (JSON; `[]` for a results release with none), `guide_change`, `guide_change_quote`, `eps_guide_prior` (the previous full year's GAAP diluted EPS from the 10-K, for GAAP full-year guidance that prints no prior; `priorFyEps`: the annual 10-K figure for the fiscal year ending in the year before the one guided).
- **The readings** (`guideReadings`, worked out on the server in `forReader`, handed to pages as `guideRead`; ReleaseView only lays them out):
  - **Rev guide vs Q** (was *Guide vs quarter*; `FIELD_KEY_MOVED` reads the old key): the coming quarter's revenue guidance, middle of the range, against this quarter's revenue. Old readings fall back to the headline item.
  - **EPS guide vs FY**: full-year EPS guidance (middle) against the previous full year's EPS on the same basis: the figure the release prints, else for GAAP guidance the 10-K's. Adjusted guidance with no printed prior is blank (no filing carries adjusted EPS). Adjusted is preferred when both work. The note gives both figures and where the prior came from. A GAAP prior can be small after charges (Genuine Parts' 2025 GAAP EPS was $0.47), and the percentage is then large; the note shows why.
  - **Guidance change**: Raised, Lowered, Reaffirmed, Initiated, Withdrawn or Mixed, with the quote on hover. Not a rating.
- **Screener:** the group is 20 columns (`PAD_SPAN` 159, error row 134, empty row 136, `naRun(20)` twice). The column figure carries `guideRead`, never the items, since every screener load fetches it.
- **Also shown:** the results email ("Guidance raised" beside the word, and the EPS reading under the sentence) and the public `/results` page (the change as a tag).
- **The re-read:** `release-load.js --guidance --commit` reads again the stored results releases whose guidance items were never read and writes ONLY the four guidance columns (`writeReleaseGuidance`); every other field of the reading stays as first stored. New readings carry them from the start.
- **Tested:** 24 new checks in `releases-test.js` (112 in all), three of them proved by reverting their guard (the costs refusal, the initiated words, adjusted-without-prior blank); and 13 drawn checks on the screener over an in-memory database (headers renamed and in order, every value under its own header by position, the notes, an old reading, the guidance-only write, row width), proved by dropping one cell (5 fail). The email and public page suites still pass.
- **The re-read, 2026-10-23 05:46 ET:** 153 results releases since 2026-09-08, $0.37, 11 minutes, none failed. 71 carry guidance; 38 a stated change (raised 23, reaffirmed 10, initiated 3, lowered 1, withdrawn 1), 33 changes refused by the checks. Coverage: Rev guide vs Q 11, EPS guide vs FY 17 (5 adjusted against a printed prior, 12 GAAP against the 10-K), Guidance change 38. EPS guide vs FY is lower than the 37 full-year EPS guiders suggested: most guide adjusted EPS and print no prior figure, and those stay blank by design.
- **The email, updated the same day:** the stated change as an outlined label beside "Guidance", the company's words under it in italics, then the sentence, then a quiet line each for next quarter's revenue guidance against this quarter and full-year EPS guidance against the year before. The fourth summary box counts raised and lowered. 85 KB for a 49-company day.
- **The label in colour** (2026-10-23, the owner: "raised should be dark green .. across the website and email and screener"): a filled label with white ink, Raised dark green #15803d, Lowered and Withdrawn dark red #b91c1c, Mixed orange #c2410c, Initiated blue #1d4ed8, Reaffirmed slate #475569. The one exception to green-and-red-mean-price, recorded in CLAUDE.md. Defined once: tokens `--gch-*` and the `.gch` label in `app.css`, `ReleaseView.changeTag` for pages (screener cell, public `/results`), `ReleaseView.CHANGE_HEX` for the email (which cannot read CSS); `releases-test.js` checks the hex and the tokens agree. The row card (stock page All fields, tiles, phone) colours the word with its up/down classes. The landing screenshot was retaken. Drawn checks: dark green with white ink on Dark, Navy and Light; slate for Reaffirmed; the email dark mode keeps the white ink (`.em-pill`).

### What helped and what weighed (2026-10-23)
The owner asked whether the release could be summed up as "opportunities and risks in two different columns as bullet points"; agreed instead on the company's own explanation of the quarter, since "opportunity" reads as a reason to buy, the AI's view cannot be checked, and every release's risk boilerplate would fill the risks column.
- **The reader** returns `drivers: { helped, weighed }`: up to three points a side, each `{ text, evidence }`, the evidence a phrase of 4 to 20 words copied from the release. `driverLists` keeps a point only when its evidence is in the release word for word, neither part is the legal boilerplate (`BOILER`: forward-looking, risks and uncertainties, safe harbor, risk factors), and its text uses none of the banned words (the model sometimes writes "Strong revenue growth"; that point is dropped, as a summary would be). None stated is two empty lists, stored, so a re-read knows the release was read.
- **Storage:** `drivers` (JSON) beside the reading; `writeReleaseDrivers` writes that column only, for `release-load.js --drivers --commit`. Kept off the screener's column figure.
- **Shown:** `ReleaseView.driversHtml` (two columns, each point's backing words on hover; styled once in app.css `.rv-drv`, one column under 560px) on the stock page's Results releases card and under the summary on the public `/results` page; the results email lays out its own two columns under each company's summary (`.em-col`, stacked on a phone), and its caveat says these are the company's own reasons. Not on the screener: too much text for a column.
- **Tested:** 7 checks in `releases-test.js` (121 in all), the evidence check proved by reverting it.
- **The backfill, 2026-10-23:** 200 of 202 results releases since 2026-09-08 re-read for the drivers column, $0.54, 19 minutes; 195 with reasons; 40 points refused by the checks; 2 failed to load and are retried by the next run.
- **Size:** the email with drivers came to 108 KB on a 49-company day, past Gmail's clip. One styled block a column (points split by line breaks, not a style each) took it to 103 KB, and 12 full cards instead of 15 (`RD_CARDS`) to 89 KB, 94 KB with every release on file.

### The Quarterly results card (2026-10-23)
The owner: "Can you create a promo on individual stock with all this results data". Template `stkresults` ("Quarterly results"), in the Stock spotlight group beside At a glance, control `srsSym`.
- **Content:** the company's newest results release: four figure tiles (revenue, net income, GAAP and adjusted EPS, each with the change on a year earlier, written, not painted); the guidance with the stated change as the coloured label (`ReleaseView.CHANGE_HEX`, so server.js now loads releaseview.js before cards.js) and its sentence cut to the size, with the readings (next quarter's revenue guide on this quarter, full-year EPS guide on last year); what helped and what weighed (two a side on a square, three otherwise; one column on a story); the AI summary on a portrait and a story; the dated not-advice note. A company with no release on file says so.
- **Data:** `getRelease` (`stockResultsNeed`): the studio fetches `/api/releases?symbol=` (cached per symbol, re-renders on arrival); the phone route reads `readEarningsReleases(sym, 2)` through `Releases.forReader`, the same rows.
- **Found on the way:** the control was first called `srSym`, which `POST_OPT_KEY` (3 to 6 lowercase letters, then a capital) rejects, so a saved post silently lost its stock and drew the first one on the screen. Renamed `srsSym`; the rule is now in CLAUDE.md's promo-card line.
- **Tested:** 15 checks in the real studio over production's snapshot and releases (GE, Meta, American Airlines, and Exxon with none; every size; four figures; nothing cut; the note clear of the last block and on the card; GE's Raised drawn dark green) and 5 on the phone route (the saved post draws JPMorgan with what helped; one with none says so).
- **The empty space** (the owner, on Netflix and Lockheed Martin portraits: "lot of empty space"): the blocks stacked at the top left a band above the note. They now sit in `.sr-mid`, which takes the card's free height and spaces them evenly (`justify-content: space-evenly`), and the portrait type is larger (figures 40px, text 21px). Measured: the gaps between blocks are equal on every card, 47 to 78px on a portrait (GE to Lockheed Martin), the note clear; 21 studio checks over six companies and three sizes.
- **In colour** (the owner: "Looks very one color"): a colour names a part, as on the At a glance card, never good or bad, and no green or red but the guidance label. Figure tiles revenue blue, net income cyan, GAAP EPS violet, adjusted EPS gold (label, top edge, faint tint); the guidance box takes its label's colour (edge and tint); what helped sky, what weighed orange (heading and side line); the summary an indigo side line. Through `pal.ink`, so the card themes adapt. 21 studio checks.

### The Guidance summary cards (2026-10-23)
The owner, on the Results summary: "One thing we are not showing on this is the guidance fields, should we create a new page for guidance or it can be added to the result summary page itself" ... "yes build all the options". A card of its own, since the Results summary is full: `gdsum` (Market, beside Results summary), `secgdsum`, `indgdsum`, `thmgdsum` (Sector, Industry, Theme). Controls `gsmSp500`, `gssName`/`gssSp500`, `gsiName`/`gsiSp500`, `gstName`/`gstSp500`.
- **One scope:** `rsScope` (the index cut, the group asked for, the season) was taken out of the Results summary so both cards count the same companies and quarter; the Results summary draws through `rsDraw`, unchanged (its 36 studio checks, including the independent count, pass after the move).
- **Content:** tiles (gave guidance of the reported; raised, reaffirmed, lowered or withdrawn, each a share of those that gave guidance), a bar of every stated change in the label colours plus "no change stated", then a row a sector (market) or an industry (sector) with gave guidance and chip counts, and who raised and who lowered (symbols, largest by market value first, never by how much); an industry or theme is a row a company with its chip and "Vs. prior" (full-year EPS guide on the year before, else next quarter's revenue guide on this quarter). Data: the release column (`resultsSummaryNeed` now answers for these too, so the studio and the phone route fetch it as for the Results summary).
- **Tested:** 17 studio checks over production's column (every card, every size, nothing cut, the note clear; the market card's 63 of 116 gave guidance, 21 raised, 1 lowered matching an independent count). Found: the company table's last heading ran past the card edge ("Guide vs. before", then "Vs. before" on a square); now "Vs. prior".
- **The stock page's card, improved and in colour** (2026-10-23, the owner: "The results section needs to be improved and made colorful"): five figure tiles, each its own token colour (revenue azure, net income cyan, which the card did not show before, GAAP EPS violet, adjusted EPS sand, the estimate slate; label, top edge, faint tint); the guidance as a box edged and tinted in its stated change's colour (`--gch-*`) with the label, the company's quoted words, the sentence and the two readings; the summary with an indigo edge; and, in app.css for this card and `/results` alike, what helped sky and what weighed orange (heading, side line, bullets). Theme tokens throughout. Checked drawn in Dark and Light (11 checks).

### At a glance: Earnings and guidance (2026-10-23)
The owner: "At a glance needs to show the result release section, call it earning and guidance instead of the existing earning". `/api/stock` reads the newest results release (one indexed read) and hands `Glance.build` a copy of the row with its `ReleaseView.fields` (the er- fields); the stock row itself is untouched. The card (`glance.js`, id `earn`, title "Earnings and guidance") then says when it reported with revenue and EPS on a year ago, the guidance change the company states in its words (else "guidance given, no change stated"), the full-year EPS guide on the year before or next quarter's revenue guide on this quarter, and the next date only when it is after that report (the provider's estimate can be a date already past: Lockheed Martin's read Oct 20 after its Oct 22 report). Headline: the stated change ("Raised", "guidance, Oct 22"), else the report day. Arrow: raised up, lowered or withdrawn down, reaffirmed level, none otherwise. The card opens Results releases (`#rels`). Without a release (and on the At a glance promo card, which has none), the old next-date and surprise wording. `glance-test.js` 38 checks (9 new; the past-date guard proved by reverting); the route checked end to end.
- **On the At a glance promo card and the landing page** (2026-10-23, the owner: "apply these at a glance change to promo and the home page"): the studio's `getGlance` adds the stock's newest release (the Quarterly results card's `getRelease` fetch and cache, redrawing on arrival) and the phone route reads it for the post's `glcSym`, so the card's Earnings and guidance topic matches the stock page; the topic chooser calls it "Earnings and guidance". The card's headline type is left at its social size. The landing page's At a glance picture (`glance-navy.jpg`) was retaken from GE's page in Navy over a read-only copy of production's snapshot (1361x725), Earnings and guidance reading Raised; alt text and caption say GE, October 23.

### The history backfill: `release-history-load.js` (2026-10-23)
The owner, on making forward guidance a case for the Signal: "Let's backfill first ... we will have the earning and guidance data along with price movement". Every results 8-K each tracked company has filed since 2017, read by the same reader into the same table, for research against price. **It never feeds the Signal**; any use there is an owner decision on evidence (`does-any-of-this-predict-anything.md`, `docs/research.md`).

- **The list is the SEC's, not `sec_events`.** That table keeps about 400 days a company. The script reads each company's submissions feed (`filings.recent` plus the older pages in `filings.files` that reach back past `--since`) and keeps the 8-Ks (not 8-K/A) with item 2.02. One to three fetches a company.
- **The reading is the daily loader's.** The same exhibit pick, model call and checks (`toRow`), the same `insert or ignore`, so it is resumable: a filing in the table is never fetched again. Largest companies first, each finished before the next. The model calls run four at once (`--conc`) while the SEC side stays one request at a time, 400 ms apart; a 429 or 403 stops the run.
- **Checks against the quarter as first filed.** `sec_facts` keeps every filing's version of a quarter, and later ones are restated: NVIDIA's 2024 first quarter is EPS 5.98 in that 10-Q and 0.60 a year later (the split), GE's 2017 third quarter $33.5B first and $28.8B once units moved to discontinued. A release printed the first version, so `asFiled` takes each quarter's figures from the earliest filing that has them, for both the scale guard and the 10-Q check (run here on every reading and stored, as the daily loader's).
- **The scale guard at the time.** The daily loader's reference is the company's size today; years back that is off by every split since. Here it is the filed quarter nearest before the release (shares from its net income over diluted EPS, a quarter's revenue). No quarter on file, no guard.
- **Nothing else moves.** The mailings pick by filing date (the last four days), the screener column and the recon by the newest in 130 days, the stock page by the newest few; an old release reaches only `/filings` for its own day and the research.
- **Measured on NVIDIA and GE (dry run, 82 filings):** $0.0024 a release. NVIDIA matched its 10-Q on every quarter once the checks used the first-filed version. GE, the hardest case in the universe (a reverse split, three spin-offs), differs on many quarters, mostly on net income (continuing operations against attributable) and is flagged per reading, not refused; the analysis can keep only `sec_check = 'match'`.

Run: `node --use-system-ca release-history-load.js` is a dry run (it calls the model); `--commit` writes; `--list-only` counts without the model; `--symbols A,B`, `--limit N`, `--since YYYY-MM-DD`, `--max-usd` (default 2), `--max-minutes` (default 600).
- **A reader fix found on the first minutes of the run:** NVIDIA's quarterly guide came back as "108.0 billion, plus or minus 2%" and the whole-number text check refused it, so the item was lost. `bareFigure` now cuts a trailing plus-or-minus clause off a guidance figure before the check (the sentence keeps it), and the schema asks for the figure alone. Two figures in one string ("74.9% GAAP and 75.0% non-GAAP") are still refused. The nine NVIDIA readings written before the fix were read again with `--force --symbols NVDA` (replaces those companies' readings; for after a reader fix).
- **The size of it (2026-10-23 count):** 41,598 results 8-Ks since 2017 across 1,255 companies, 41,361 not yet read: about $99 at $0.0024 and 15 to 20 hours. The first run was capped at $50, largest companies first.

### The stock page's results history (2026-10-23)
The owner, over CrowdStrike's page once the backfill reached it: "Do we need to show the history of results like this" (full cards, quarter after quarter), then the recommendation, "including the strip".

- **The newest release in full,** as before (it was the newest four). Under it, **Every quarter on file**:
  - **The strip:** one mark per results release, oldest to newest, coloured as its guidance label is (`--gch-*`), plain where the release stated no change; a year under the first mark of each year, and a legend with counts. A mark opens its quarter's row (the newest scrolls to the card above).
  - **The table:** a line a quarter, newest first: quarter, filed, revenue and its change on a year ago, EPS as reported and adjusted, against the estimate, the guidance label, the 10-Q check. Revenue and EPS changes are not coloured (green and red mean price). Clicking a row (or Enter) opens that release's full card under it; clicking again closes it.
- **The guidance as a grid** (`ReleaseView.guideTable`): the stored guidance items laid out as the release's own table, a row a measure and a column a period, instead of the sentence with its pipes ("Total revenue | $1,523.2 - $1,529.2 million | $5,991.1 - $6,011.1 million"). Money items are stored scaled; an "other" item keeps its printed number and unit word, its label taken from its sentence up to the first pipe or colon. A reading made before the items were read shows the sentence, as before.
- **Light on the wire:** `GET /api/releases/history?symbol=` sends a line a quarter (`ReleaseView.historyRow`: no summaries, guidance items or reasons, about 300 bytes a quarter); `GET /api/releases?symbol=&accn=` sends one filing in full when a row is opened, only under its own company's symbol. Both refuse a guest outside the preview, as `/api/releases` does.
- Tested (scratchpad `hist-test.js`, 27 checks, real server on an in-memory copy with CRWD's and NVDA's stored releases, as a member, wide and at 400px): the routes, the light rows, the one-filing lookup and its refusals; what is drawn: one full card, a mark per release and a row per older release, raised drawn in the label's dark green on the strip and legend, the legend summing to the releases, the grid with no pipes, no sideways page scroll, a row opening and closing, the oldest mark opening the oldest row.

### The Earnings track record card and video (2026-10-23)
The owner: "Think of a good promo for earning / guidance history based on the new data from AI at individual stock level", then "Build card with 1 included" (1: the video).

- **`Releases.trackRecord(rows)`** (pure, `releases-test.js`): one company's results releases read together. The strip (each release's stated change, oldest to newest), the counts, how many gave an outlook at all (`guided`), **revenue against its own guide** (each quarter's revenue against the middle of the quarterly revenue guide the release before gave; compared only for the next quarter, period ends 50 to 130 days apart, one currency, and within a factor of two so a guide for another line is left out), the current run, the last cut (lowered or withdrawn), and up to 20 quarters of revenue with the newest on a year ago. Measured: CrowdStrike above its own guide 28 of 29, raised 16 of 30; NVIDIA above 35 of 38, its one cut Feb 2020 (the early COVID warning).
- **`GET /api/releases/track?symbol=`** serves it (guest rule as `/api/releases`); the phone's saved-post route reads the same rows through the same function (`Cards.trackNeed`, the `getTrack` channel).
- **The card** (`stktrack`, "Earnings track record", in the Stock spotlight group, control `trkSym`): the headline is revenue against its own guide (or the raised count when fewer than four quarters compare); the strip in the guidance label colours with years and a legend; three lines (raised N of M, or "Gave an outlook" for a company that never says raised; the run; the last cut or "not once since"); revenue bars; the note. Fewer than four releases on file: "not enough history yet". Descriptive wording only: no beat, no buy/sell/hold.
- **The video** (`private/trackreel.js`, `TrackReel.paint`, 9:16, 27.4 s, admin only in the studio's box): open (the company, "What it said. And what it did."), the strip filling a release at a time with the year and running counts, the headline counting up, the three lines, the revenue bars, the end card. The model is the card's own (`Cards.trackFrame`), so the two cannot disagree; recorder and music are the Reel's.
- Tested (scratchpad `tk-studio.js`, 36 checks, the real studio over a copy of production's snapshot and CRWD's and NVDA's releases): in the group, the owner's video controls, every size for two companies (a mark per release, a bar per quarter, nothing past the note or overlapping, the headline, raised in the label green, no trading words), a company with no releases, the video model, all frames painted.

### The guidance change, read better (2026-10-24)
The owner: "Can you review all outlook data where the guidance change is not filled and see if the logic can be improved", then "Do all … b is my choice on 3".

**What was wrong.** Of 17,995 results releases with an outlook, 10,254 (57%, the same every year since 2017) had no change. In 7,957 the model had named one and the check refused it: the quote had to carry a word for that direction, and companies mostly write "updating … to $X from $Y", "now expects … up from the prior guidance", "continues to expect", "consistent with the prior outlook". A re-read of 260 (`gc-sample.js`, $0.71) showed most refused raises and cuts were real.

**What changed** (`releases.js`, `releases-test.js` 153 checks):
1. **The figures decide.** The schema's `guidance_change.compared` lists every outlook figure printed beside its earlier guidance (`measure`, `from_printed`, `to_printed`). `comparedDirection` keeps a pair only when both are in the text (every number, `inText`), in the same kind of unit, and a revenue or earnings measure (`OUTLOOK_MEASURE`, not `NOT_OUTLOOK`: a currency impact, tax, cost, capex line is left out; Philip Morris's "currency impact on EPS: 0.18 (was 0.24)"). Middles of ranges are compared (`printedMid`: dashes as ranges, brackets as losses, scale words): higher raised, lower lowered, within 0.1% reaffirmed, both mixed. A direction the company states in the quoted words and the model named joins the figures' (one pair down plus "and raises" is mixed). Where the model's word disagrees, the result stands and the note says so.
2. **More wordings** where there are no figures: "up from / down from / above or below the prior", "continues to expect", "consistent with / in line with the prior or initial", "reconfirms", "on track", "no longer expect".
3. **Initiated from the history (option b).** The model's "initiated" is never taken. `initiatedFrom(row, earlier)`: a release with no stated change that gives full-year guidance for a year no earlier release on file gave full-year guidance for, decided only with an earlier release at least 330 days before and every earlier one in 450 days read for its items. The daily loader does it as each release is read (and on `--guidance`); the history loader after each company (`initiatedPass`), writing only `guide_change` and its quote (`writeReleaseChange`), the quote being the initiating item's own sentence.
4. **A refused claim keeps its quote** in the reading's notes (`("…")` after the reason).

**Applied to the history:** `release-history-load.js --rechange` re-reads the stored releases whose claimed change was refused (about 8,000, about $22), writing only the guidance columns, then runs the Initiated pass over every company. Measured on a dry run over seven companies (142 refused): 63 got a change (30 raised, 19 lowered, 9 mixed, 5 reaffirmed) and 46 were initiated from the history.
- **Stored "initiated" brought in line (2026-10-24, the owner's OK):** `release-history-load.js --initiated` runs the history rule over every company with no model and no SEC fetch. `initiatedVerdict` answers yes, no or unknown; a stored "initiated" (the model's word, from before the rule) is kept on yes, kept on unknown (the history cannot say: under a year of it, or an earlier release unread), and kept where the quote says in words that full-year guidance is being initiated, re-established or reinstated (`saysFullYearStart`: 3M's "Initiates Full-Year 2024 Guidance" after a spin-off, UnitedHealth's "Re-Establishes Full Year Outlook" after withdrawing; not a quarterly "initiates second-quarter guidance"); it is cleared only when the history says otherwise. Blanks the history marks are filled. The same exception applies to new readings. Dry run: 1,292 kept on the history, 141 on the company's words, 536 cleared (424 of them quarterly-only guidance), 2,792 newly marked.

## Saturday 05:00 run (2026-10-25)

The owner: *"Yes but can we run the Saturday earlier .. may be 5am"*. The earnings reader also runs **Saturday 05:00**, after the Saturday 04:00 nightly (done by 04:50) has recorded Friday's 8-Ks; before, Friday's results waited for Monday 09:15. `release-task.ps1` adds the trigger, `schedule.js` declares it as `extra`, `schedule-test.js` checks both. **The subscriber mailing stays weekday mornings**: `mailList()` in `release-load.js` returns on a Saturday or Sunday, so Saturday's finds go out in Monday's mailing as before; the owner's digest is sent on Saturday. No Twelve Data credits; AI credit as any run, capped at $2.

## The change against the previous release (2026-10-25)

The owner, on Robinhood: *"It is very clear but the Guidance change is empty"*. Robinhood's only guidance is **Adjusted Operating Expenses and SBC**, and the owner chose to **keep cost-only outlooks blank** (the Meta rule stands). The second question, *compare each outlook with the same item in the previous release*, the owner accepted.

- **`Releases.changeFromPrevious(row, earlier)`**: for a results release with no stated change, each full-year **revenue, GAAP EPS or adjusted EPS** item (never `other`) is set beside the same item (metric, year by `guideYear`, unit) in the newest earlier results release that gave it, within 200 days. Directions combine as the figures rule does: raised, lowered, mixed, or reaffirmed when the range is identical. The quote is written, not the company's: `Against the previous release: Revenue 2027: 45.9B-46.2B (was 45.8B-46.2B on 2026-02-25)`.
- **Skipped**, from a sample of twenty large companies read against their release wording: a range against a single figure; a gap over a factor of 2 (a scale fault); a measure with **two items in either release** (Coca-Cola's comparable and currency-neutral EPS growth, Philip Morris's "excluding currency"), since the pairing is a guess; a **growth percentage whose signs differ** (Home Depot 2023-11-14, "decline between 3% and 4%" read as +3 to +4 beside an earlier -5 to -2).
- **`changeFromHistory`**: initiated (a year never guided before) first, else the comparison. It replaces `initiatedFrom` in `release-load.js` (both paths) and in `release-history-load.js`'s history pass (`--initiated`, and after each company in a backfill).
- **First pass, 2026-10-25**: 2,906 releases filled (1,289 raised, 826 lowered, 488 reaffirmed, 303 mixed); no model calls. Known limit: a model that filed a figure under the wrong metric (Deere 2019's net income as GAAP EPS) is compared under that label.

## Result vs est. (2026-10-25)

The owner: *"On screener don't see a column that summarized the earning, saying above, in line or below"*. A 21st column in **Last Earning AI Extracted**, before vs est.: `erVsEstWord`, from `ReleaseView.vsEstWord(actual, estimate)` inside `ReleaseView.fields`, so the page works it out from the release column it already loads (no rebuild). The figure is the one vs est. differences (adjusted where the provider reports adjusted, else GAAP). **In line**: the gap, rounded to the cent as vs est. shows it, within 2% of the estimate or one cent, whichever is wider (`VS_EST_BAND`), so $0.06 against $0.05 is In line, not a 20% beat. Otherwise Above or Below. Uncoloured (green and red are price only). A dropdown filter (`CAT_KEYS`), sorted Above, In line, Below; the hover card, tiles and `/stock` show it as `aier|Result vs est.`. Spans: group 21, `PAD_SPAN` 161, error row 136, empty row 138, the fund and no-release `naRun(21)`. On the first day: 623 Above, 162 In line, 108 Below, 235 without an estimate yet, of 1,128.

- **The tag (same day, the owner: "You don't have to add any color but can you make it a bit more visually appealing")**: `ReleaseView.vsEstTag(word)`, styled `.vst` in `app.css`: the guidance tag's pill shape in the text colour only. Above is filled with an up triangle, In line a dashed outline with an approximately-equal sign, Below a plain outline with a down triangle. The group's NA run (`aierNa()` in `index.html`, for funds and companies with no release) now sets the six text columns' NA to the left, under their left-set headers.

## Same-day results 8-Ks (2026-10-27)

The owner, after SoFi filed its results 8-K at 07:03 ET and the 09:15 run did not read it: "Why next morning, we run a earning release job at 9:15". The release run only reads 8-Ks already in `sec_events`, and the daily SEC read (`secdaily.js`) fills that table from the SEC's daily index, which is published the night of the day it lists. So a results 8-K reached the release run the next morning.

- **`POST /api/sec/today`** (cron secret or admin). It reads the SEC's live 8-K feed (EDGAR "current events", Atom, 100 a page, about five days deep; `SecDaily.currentUrl` / `parseCurrent`) back to the previous business day, at most `SEC_TODAY_PAGES` (8) pages. It keeps the item 2.02 filings of tracked companies (`resultsFiled`) and drops any company whose filings are already stored (a seek per company on `sec_events`). It then re-reads up to `SEC_TODAY_N` (8) of them through `secDailyOne`, the daily check's own reader, which also sets `last_results` for the report-triggered refresh. The rest come back as `pending`; the caller hands them back, so the feed is read once a run. A pending pair is honoured only if the symbol is tracked and the CIK is its own. A 429 stops with the rest pending, and the daily read still reaches them the next morning.
- **`release-load.js`** calls it (`secToday()`) before it looks for filings, on committed runs only, since it writes `sec_events`. It never fails the run.
- Timing now: filed before 09:15, read at 09:15; filed by 18:15, read at 18:15; later, the next morning, as before. The subscriber mailing is unchanged (weekday mornings), so an evening find still goes out the next morning. `/home` and `/help` say so.
- Tests: `secdaily-test.js` (feed parsing from the real format, the 2.02 filter proven by reverting it, previous business day). A scratchpad run of the route against the live feed on the in-memory database found SoFi's 8-K, stored it, skipped it on a second call, and dropped a forged pending pair.

## Reporting today: the owner's morning email (2026-10-28)
The owner: "create a new email talking about upcoming earning today .. and schedule it right after the earning results email and send it to admin".

**What is in it:**
- The tracked companies the earnings calendar (`earnings_calendar`, see `which-dates-the-fundamentals-actually-describe.md`) lists for today, in three groups: Before the open, After the close, Time not given. Alpha Vantage's `timeOfTheDay`, or Nasdaq's `time`.
- Largest first. Each row shows the name (linked to `/stock/<SYM>`), ticker, sector, market value and last surprise, the last quarter's EPS against consensus.
- No Signal and no expectation in it.

**How it is sent:**
- `earningsTodayEmail(day, list, rows)` builds it in `emailShell`. `POST /api/cron/earnings-today` (cron or admin) sends it to `operatorEmail()` through `sendMail`, kind `earnings-today`, so it appears in the mail log at `/emails`.
- Listings must have been read in the last two days; the 04:00 nightly reads the calendar.
- Once a day: `app_meta` `earnings_today_mark` holds the day it went out. `{ force: true }` sends it again.
- Nobody listed (weekends) sends nothing.

**When:** `release-load.js` `mailToday()` runs straight after `mailList()` (the Earnings results mailing). It uses the same `weekdayMorning()` guard, now shared, so it goes out only from the weekday 09:15 run. It never fails the run.

## Free cash flow on the Results releases card (2026-10-29)
The owner, over Alphabet's card: "How difficult is to add Free cash Flow to the Results release section", then "yes build the first version".

**First version: the company's own figure only.**
- The schema (`releases.js` `SCHEMA.free_cash_flow`) asks for a quarter's free cash flow ONLY where the release prints a figure it calls that (or its own close name), with the year-earlier quarter, the scale and the company's label. Never worked out from operating cash flow less capital spending; a year-to-date or twelve-month figure alone is not given.
- `toRow` runs it through the same `money()` as the other figures, so each must be found in the release text and carry a scale. A figure more than five times the same quarter's revenue is refused as a scale slip ("does not fit the quarter's revenue"), each quarter on its own.
- Stored as `fcf`, `fcf_prior`, `fcf_label` (three `alter table` columns, in `ER_COLS`). `fcf_label` is three-state: the company's name; `''` when the release was read for it and gives none; null for a reading made before 2026-10-29. Readings are written once, so older releases stay null until re-read.
- The stock page draws a sixth card, Free cash flow (teal), between Net income and EPS, through `ReleaseView.fcfSub`: the change on a year ago (none off a negative or zero year, the prior figure instead), the label as the hover, "none given", or "not read for this release". Grid of six, three at 1000px, two at 700px.
- Display only: not on the screener group, `/filings`, the card or the mailing, and never the Signal.

**Worked out, the same day** (the owner: "why don't you also work on the derived logic and then populate at once"): see the next section.

Tests: `releases-test.js` (kept, scaled, a negative prior; none given; a figure not in the text; a scale slip; no label; not a results release; the four `fcfSub` lines; the scale guard proven by reverting it). A scratchpad harness on the in-memory database drew the card for a stated figure, none given and an older reading, at 1600px (one row of six) and 390px (three rows of two, no sideways scroll).

## Free cash flow worked out, and the cash flow reading (2026-10-29)
**A second, small request.** Adding the cash flow lines to `SCHEMA` made the API refuse every reading: "The compiled grammar is too large, which would cause performance issues". The main schema was already near that limit. So `free_cash_flow` and the new `cash_flow` moved out of `SCHEMA` into `CF_SCHEMA` (with the quarter's revenue again, for the scale guards), asked by `cfRequest` with its own `CF_SYSTEM`. The main reading is byte for byte the schema it was before 2026-10-29. **Do not add fields to `SCHEMA` without a live call: the limit is not visible in tests.**
- `release-load.js`: after a results reading, a second call (`ask(text, Rel.cfRequest)`), its answer merged into the first before `toRow`. About $0.001 more a release ($0.0027 for both on Microsoft). Its failure never fails the reading; free cash flow is then left null ("not read") for the `--cashflow` pass.
- `cash_flow` copies net cash from operating activities and the capital expenditures line (purchases of property and equipment), this period and a year earlier, with `months` (3, 6, 9 or 12): the three months when given, else the year to date given. Each figure must be in the text; capex is stored positive; both lines are refused against revenue scaled to the months. Stored `cf_months`, `ocf`, `ocf_prior`, `capex`, `capex_prior`, `capex_label`.
- **`deriveFcf(row, prev, { financial })`**: operating cash flow less capex. A three-month statement gives it directly ('quarter'). A year to date gives the quarter only less the previous release's year to date three months shorter, whose period ended 75 to 105 days before ('ytd'); the year-earlier quarter likewise from both prior columns. A missing line withholds that side, never a zero. Withheld for `Financial*` sectors (a bank's operating cash flow carries lending and trading). `prevRelease` picks the company's reading with the latest earlier period end. Stored `fcf_calc`, `fcf_calc_prior`, `fcf_calc_from`.
- The stock page card (`ReleaseView.fcfValue`, `fcfSub`): the company's figure wins; otherwise ours, the line under it starting "worked out", the hover saying how (the capex line's name; for the quarter, or the N months less the previous release's). Neither: "none given"; banks say why on hover.
- **`release-load.js --cashflow [--since 2026-04-01] [--parallel 8] [--commit]`**: re-reads (the small request only) every results release in the window whose `fcf_label` is null, writing only the nine cash flow columns (`writeReleaseCashFlow`), then works out free cash flow for every release in the window, oldest first per company, reading earlier readings from the table where a year to date needs them (`writeReleaseFcfCalc`). `--derive-only` runs the second step alone. SEC fetches stay one at a time; model calls run in parallel.
- Live dry run: Apple's 9 months less 6 months; Alphabet's stated figures; Microsoft worked out from its quarter statement ($58.000B less $39.367B = $18.63B); JPMorgan nothing.
- Tests: `releases-test.js` (200: lines kept and refused, scale against nine months, none is null, prevRelease, quarter and year-to-date subtraction, a missing release before, a period gap, one missing line, financial, the card's three lines; the gap and financial guards proven by reverting them). The scratchpad page harness adds Apple's worked-out card.

## The rest of the statements, for measuring (2026-10-29)
The owner, exploring whether the screener's fundamentals columns could come from the releases: "first extract the data from the release fillings", then "go ahead but does it for all companies not just s&p". The table already covers every company on the screener (1,143 since July 2025; only `/recon` is S&P 500), less funds and foreign filers, which file no results 8-K.

- The second request (`CF_SCHEMA`, `cfRequest`) now also asks `income_more` (gross profit, total cost of revenue, EBITDA as printed with its label, weighted diluted shares, each with the year-earlier quarter) and `balance_sheet` (at the quarter's end: cash, short-term investments, current debt, long-term debt, current assets and liabilities, total assets, equity, and the date). It compiled (one request, about $0.0014); the main `SCHEMA` is untouched.
- Checks in `toRow`: every figure in the text with a scale; gross profit no more than revenue, cost of revenue and EBITDA within five quarters' revenue; diluted shares within a fifth to five times the company's share count (`meta.ref.shares`); the balance sheet withheld whole when a line is larger than total assets or cash larger than current assets, or when total assets are outside a tenth to two thousand times the quarter's revenue (a bank is about 90, a distributor about 1, a scale slip a thousandfold).
- Stored in nineteen columns (`ER_STMT` in `db.js`: `stmt_read`, `gross_profit`, `gross_profit_prior`, `cost_rev`, `cost_rev_prior`, `ebitda`, `ebitda_prior`, `ebitda_label`, `dil_shares`, `dil_shares_prior`, `bs_as_of`, `bs_cash`, `bs_sti`, `bs_debt_cur`, `bs_debt_lt`, `bs_cur_assets`, `bs_cur_liab`, `bs_assets`, `bs_equity`). `stmt_read` is 1 once read. **Nothing displays them and nothing feeds the Signal**: they exist to measure the releases against the 10-Q and the price provider, which comes next.
- New readings get them through the existing second call. `release-load.js --statements [--since 2025-07-01] [--commit]` reads every release in the window with `stmt_read` null, writes `writeReleaseStatements`, writes the cash flow columns only where never read, then works out free cash flow as `--cashflow` does.
- Why since July 2025 (five quarters, 5,942 releases): four quarters make a twelve-month figure and a fifth checks the stitching; it includes a fourth-quarter season (full-year layouts); the 10-Q is the exact reference for any quarter, while the price provider's past values exist only as the days `fundamentals_history` recorded this year.
- Tests: `releases-test.js` (206; the add-up guard proven by reverting it). Live: Microsoft's gross profit equals revenue less cost of revenue; JPMorgan has neither statement and gets none.
