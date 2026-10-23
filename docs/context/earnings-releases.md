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
