# Acquisition targets — the Targets page in the local viewer

The owner, 2026-11-10, after the CITCO Water brief: find companies like it, as
acquisition targets, "mainly for a private equity owned company operating in
the same space looking to buy smaller privately owned companies or a private
equity GP looking for new portfolio company on a certain characteristics".
Region left open, "but it will be good to define region".

LOCAL only: the viewer (`formd-view.js`, 127.0.0.1:4100, the admin password,
`formd.db` and `web-archive.db` read only). Never the site. A fit is a
description against a stated profile, not advice.

| File | What |
|---|---|
| `targets.js` | Pure: the regions (census regions and divisions, a state and its neighbours, two steps out, a list), the presets, the filters, the staff-history `pattern`, `keywordHits` (whole words, a plural allowed), `fit` (points with reasons and flags), `toCsv` |
| `formd-view.js` | `targets()`: the candidates, their histories, loans and websites, scored; `/api/targets`, `/api/targets.csv`, `/api/targets.txt` (the website reader's list) |
| `targets-view.html` | `/targets`: the profile, five tiles, the list with each reason, a staff line a company; a row opens its fact sheet on the Employers page (`?open=<ein>`). Prefix `tg-` |
| `website-load.js --eins <file>` | Reads the websites of a shortlist, in the file's order, up to `--max` |
| `targets-test.js`, `formd-view-test.js` | The rules (38 checks); the archive side: listed companies left out and a loan to a company with a plan elsewhere not listed as "loan only", each proven by reverting it |

## Why codes alone do not find CITCO

- Its plan files it as a plumbing and heating wholesaler (423700), its payroll
  loan as water and sewer line construction (237110), and neither says water
  wells, pumps and treatment, which its website does.
- It files as The C. I. Thornburg Co.: no "water" in the name.
- The plan forms mostly stop at five digits (237100 holds water, sewer, oil
  and gas pipe and power-line builders alike).

So the search is a funnel: codes and size cast the net, the payroll loan's
exact code sharpens it, and **the company's own website decides**.

## The candidates

1. **With a plan** (`f5500_latest`): the business code starts with one of the
   profile's plan codes (a range on `idx_f5500_latest_code`, forced with
   `indexed by`: the planner otherwise took the staff index, 2.6s), staff in
   the band, filing in 2022 or later, years of filings at least the minimum,
   in the region. A company with a ticker on its SEC profile is left out.
   Its loans are matched by name key and state; its staff history comes from
   `f5500_employers`.
2. **Known only from a payroll loan** (`ppp_loans`, on `idx_ppp_naics`,
   added 2026-11-10): the loan's code in the profile's loan codes, jobs in the
   band, in the region, and no plan employer of the same name key in that
   state (a map built a state at a time and kept; the first nationwide search
   after a start takes about 15 seconds for it). No tax ID, so no website
   lookup.

## The fit

+15 plan code, +20 the exact loan code, +30 its site names two or more of the
words (+15 one, −20 none: "site: other business"), +10 size in range, +10 ten
years of plan filings (+5 five), +10 steady staff, +5 in the chosen state, and
for a platform +5 staff up 10% since 2019. −5 Form D (outside money), −5 a
holding-company name. The **pattern** "jump" (the newest year a third above
the typical year three to eight years before, and 15 people more) is how a
buy-and-build shows: CITCO sat near 100 for a decade, then 138 and 180 once
its owner began buying. It is a flag for an add-on buyer and −10 for a new
platform. "Look already bought or backed": a jump, Form D, or a holding name.

The **water preset** (CITCO): plan codes 2371 and 4237, loan codes 237110,
423720 and 221310, add-on 15 to 150 staff, platform 60 to 400, and words that
plumbing supply houses do not use ("water well", "well drilling", "well pump",
"pump service", "water treatment", "water system", "water softener", "water
filtration", "geothermal", "irrigation", "wastewater"; a plain "pump" matched
every supply house). A new preset is an entry in `PRESETS`.

## The website step

The tiles count how many candidates have been read. "Tax IDs for the website
reader" downloads the best-fitting plan companies not yet tried (150), and

```
node --use-system-ca website-load.js --commit --eins targets-eins-<date>.txt --max 150 --max-usd 2
```

reads them (robots.txt obeyed, 3s between requests, Haiku at about a third of
a cent a company; see `company-websites.md`). The page then scores them with
what their own pages say.

## First run (2026-11-10)

Water preset around West Virginia (a state and its neighbours): 429
candidates for an add-on (247 with plans, 182 loan only), 131 for a platform.
CITCO first as a platform at 80, with its jump flagged. Nationwide: 3,525 for
an add-on, 912 for a platform.
