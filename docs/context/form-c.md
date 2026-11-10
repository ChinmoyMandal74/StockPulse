# Form C (crowdfunding) — backlog 61, E3

Small companies raising money from the public under Regulation Crowdfunding
file a Form C with the SEC, then a progress update (C-U), an annual report
every year they stay in the regime (C-AR), amendments (C/A, C-AR/A) and a
termination (C-TR). The SEC publishes the fillable part of every one as a
quarterly data set since 2016 Q2. What it gives that Form D never does: **the
company's own figures for its last two fiscal years** (employees, total assets,
cash, receivables, short- and long-term debt, revenue, cost of sales, taxes,
net income) and its **website**.

Kept in the LOCAL `formd.db` beside Form D. Never Turso, never served.

| File | What |
|---|---|
| `formc.js` | The rules, pure: table names from the ZIP's entries, the quarter from the address, the data-set links, the accession column, dates as the set writes them (`fcDate`: `20260930` and `2026-10-27`), and `summaryRow`, one filing's summary from its submission, issuer and disclosure rows |
| `formcarchive.js` | The store: every table as published in `fc_<table>` (every column as text under the file's own header names, plus `quarter`), the quarters loaded in `fc_loads`, and the summary `formc` (`summarise`) |
| `formc-load.js` | The loader, by hand |
| `formc-test.js` | The rules, the archive, the summary and the loader's care with sec.gov, no network; the gap floor, the ZIP check, the shared cap and the summary's rebuild guard each proven by reverting them |

```
node --use-system-ca formc-load.js                       # dry run: fetches the list page only if not cached
node --use-system-ca formc-load.js --commit --max all --gap 60
node --use-system-ca formc-load.js --summarise --commit  # rebuild the summary from what is stored; no requests
node --use-system-ca formc-load.js --stats
```

## Care with sec.gov

The same as Form D's (`form-d.md`), and it reuses its getter (`makeGetter`):
bulk ZIPs only, one at a time 60 seconds apart (never under 15), any answer
but a 200 stops the run with nothing retried, every file kept in
`downloads\sec` (in the project, gitignored) and never fetched twice, at most
100 sec.gov requests in 24 hours **counted together with Form D's log and the
acquired-companies loader's** (one address, one count), one run at a time.
A whole load is 43 requests (the list page and one ZIP a quarter).

## The tables (as published)

Seven a quarter, keyed on `ACCESSION_NUMBER`:

| Table | What |
|---|---|
| `fc_submission` | Form type (`SUBMISSION_TYPE`), `FILING_DATE` (`YYYYMMDD`), `CIK`, `FILE_NUMBER`, `PERIOD` (a C-AR's fiscal year end) |
| `fc_issuer_information` | Name, legal form, jurisdiction, incorporation date, street, city, state, zip, `ISSUERWEBSITE`, and the intermediary (`COMPANYNAME`, `COMMISSIONCIK`, `CRDNUMBER`): the funding portal or broker running the offering |
| `fc_disclosure` | The offering (security, price, target `OFFERINGAMOUNT`, `MAXIMUMOFFERINGAMOUNT`, deadline, oversubscription, the portal's compensation in words) and `CURRENTEMPLOYEES` with the two fiscal years' figures (`...MOSTRECENTFISCALYEAR`, `...PRIORFISCALYEAR`) |
| `fc_issuer_jurisdictions` | The states the offering is made in, a row each |
| `fc_coissuer_information` | Co-issuers, with their addresses |
| `fc_issuer_signature`, `fc_signature` | Who signed: name and title (and date). No address |

Other form types seen: `C-W`, `C/A-W`, `C-TR-W` (withdrawals).

## The summary, `formc`

One row a filing (`accn` primary key), built from the stored tables after
every load and by `--summarise --commit`; `insert or replace`, so a rebuild
refreshes rows and never removes or doubles any. Columns: the filing (quarter,
filed, form, cik, file_number, period), the company (name, legal form with
"Other" spelled out, jurisdiction, incorporated, **city and state only, no
street or zip**, website), the portal and its CIK, the offering (security,
price, target, maximum, deadline, oversubscription, compensation), employees,
and each figure for the most recent fiscal year and the one before
(`assets`, `cash`, `receivables`, `debt_short`, `debt_long`, `revenue`,
`cogs`, `tax`, `net_income`, each with `_prior`).

Values are as the company filed them: a loss stays negative, a 0 stays 0, a
blank stays blank (null). A C-AR repeats the figures every year, so a
company still in the regime has a run of years. A C-TR or withdrawal has no
offering tables and keeps only its filing columns.

Joins: `cik` to Form D's summary (`formd.cik`): both drop the leading zeros.

## Personal data

The signature tables name people with their titles; the issuer and co-issuer
tables hold company street addresses. Kept as published, on this machine only.
The summary keeps no street or zip, and no page shows the raw tables. Showing
anything here on the site is an owner decision and a `/privacy` line in the
same commit.

## Loaded (2026-11-10)

All 42 quarters, 2016 Q2 to 2026 Q3, in one run: 43 requests to sec.gov a
minute apart, every one a 200, nothing skipped (`bad` 0). 1,790,509 rows in
the raw tables; 36,478 filings (filed 2016-05-16 to 2026-09-30) by 9,166
companies: C/A 11,823, C 11,123, C-U 5,668, C-AR 5,370, C-W 1,095, C-TR
1,004, C-AR/A 294, and a few withdrawals of each. 5,657 companies report
revenue above zero; 3,013 have filed an annual report, and 2,170 have figures
for three or more years. **1,919 companies are also Form D issuers** (by CIK).
The largest by revenue: Powur, PBC ($361M, 2024), ConsumerDirect ($129M),
Angel Studios ($123M, 2022), Skybound Holdings ($112M).

A new quarter: run the load again after the SEC publishes it; it fetches only
what is not loaded, then rebuilds the summary.

## In the local viewer (2026-11-10)

The owner: "Go ahead with the local viewer for form c". The viewer
(`formd-view.js`, on 127.0.0.1 behind the admin password, the archive read
only) gained:

| File | What |
|---|---|
| `crowdfunding-view.html` | `/crowdfunding`: every company that has filed a Form C, one row each from `formc_companies`: name (tagged when it has also filed a Form D) and website, place, revenue for its newest year with figures (and which year), the change on the year before, net income, staff, annual reports and filings, last filed. Search by name or CIK; state; revenue at least $100K, $1M, $5M or $25M; profitable; files annual reports; filed since 2024; also raised money by Form D. `?open=<cik>` opens a company. Prefix `cf-` |
| `crowdquery.js` | The page's filters as SQL, pure (every value bound, the sort from a fixed list), and `fiscalYears`, a company's figures placed by fiscal year |
| `formd-view.js` | `/api/crowd`, `/api/crowd-company?cik=`, and `crowd` in `facts()` |
| `factsheet.js` | The line "Own figures (Form C)": revenue, net income and staff from the newest filing, with a link to the year by year |
| `formd-view-test.js` | The crowd checks (filters, the list, the year-by-year rule, no street or zip, the routes); the year rule proven by reverting it |

**The year by year.** Only an annual report (C-AR) names the year it covers
(`period`, the year end). Each report gives its year and the one before; a
year's own report wins over the next report's "year before" figure (they
can differ: restated), and a year no report covers as its own is filled from
the next report's year before, marked so. Staff is never carried back a year.
A company with no annual report shows each filing's two years in the filing
table instead, not placed by year.

**Change** is the newest year's revenue against the year before from the same
filing, when the year before was $50,000 or more.

The company panel draws the fact sheet (its plans, Form D raises, PPP and SBA
loans, federal contracts and website, by CIK and by name and state as on the
other pages), the revenue bars, the table by fiscal year, every filing with a
link to it on sec.gov, and a link to its Form D filings.
