# Form D: private companies raising money

Backlog entry 61, phase 1 (2026-11-08). The owner asked how to get private
company data, then: "work on first phase .. make sure I am not banned from
reading sec data .. be very careful .. be slow .. I don't need anything
urgently".

## What it is

Every company or fund raising money privately under Regulation D files a
Form D within 15 days of the first sale: who the issuer is, its industry
group, its revenue range (usually withheld), how much it is offering and
has sold, how many investors, its executives, directors and promoters, and
the brokers paid to sell. The SEC publishes all of them as quarterly data
sets: one ZIP a quarter since 2008, six tab-separated tables keyed on the
accession number.

Measured on 2026 Q3: 15,952 filings, two thirds pooled investment funds, a
third amendments (D/A); revenue range "Decline to Disclose" or blank on 89%.
So Form D says **who raised how much and when**; it almost never says how
big the business is.

## The files

| File | What |
|---|---|
| `formd.js` | The rules, pure: TSV parsing, dates, amounts, the summary row, `verdict(status)` (only a 200 carries on) |
| `formdarchive.js` | The LOCAL store, `formd.db` beside `analysis.db` (gitignored). Never Turso, never served |
| `formd-load.js` | The loader. Local, by hand, slow |
| `formd-test.js` | 65 checks, no network; the guards proven by reverting each |

## Care with sec.gov

This address has had a 429 and then a 403 (`sec-edgar.md`). The loader:

- reads **bulk files only**, one ZIP a quarter (1 to 4MB), never a request
  per filing;
- makes **one request at a time**, `--gap` seconds apart (30 by default,
  **never under 15**; the first full load ran at 60);
- **stops at any answer but a 200**, a 429, a 403, a 5xx or a dropped
  connection alike, and retries nothing; a quarter refused is not marked
  done, so the next run picks it up;
- **never fetches a file twice**: ZIPs are kept in `%TEMP%\tickrlab-sec`,
  the data-set page for a week;
- keeps **at most 100 sec.gov requests in any 24 hours**, counted in the
  archive's own `requests` table (every request logged with its status);
- runs **one at a time** (a lock file naming the process);
- sends the declared User-Agent of the other SEC loaders (`SEC_UA`, else
  `Tickr Lab (REPORT_TO)`), and refuses to run without a contact address;
- is scheduled by nothing.

A dry run (no `--commit`) downloads no ZIP; it fetches the page only if the
week-old copy is missing.

## What is stored

- The six tables **verbatim**: `fd_submissions`, `fd_issuers`,
  `fd_offering`, `fd_persons`, `fd_recipients`, `fd_signatures`, every
  column as text under the file's own header names, plus `quarter`. A
  column an older or newer quarter adds is added; nothing is dropped.
  Insert-or-ignore on the SEC's own keys, so history only grows.
- `formd`: one row a filing, from `summarise`: issuer (the primary one,
  which is not always listed first), CIK, filed date, D or D/A, industry,
  fund type, revenue range, offered (null when "Indefinite", with
  `offered_indefinite` set), sold, remaining, investors, first sale.
- `loads`: each quarter loaded, in one transaction with its rows; a quarter
  in `loads` is never loaded again.
- `requests`: every request to sec.gov.

## The traps

- A field holding a quote is **CSV-quoted inside the TSV**
  (`"""Total amount sold"" includes ..."`); `unquote` undoes it. No tabs or
  line breaks inside fields (field counts checked on every table).
- Dates are `DD-MON-YYYY` on the submission and `YYYY-MM-DD` on the sale.
- **"Indefinite" is an answer, not a number and not zero**: funds open with
  no cap. Sold is a number on every row, and 0 is a real 0.
- The metadata JSON's column names differ from the file header
  (`YEAROFINCALUE_ENTERED` against `YEAROFINC_VALUE_ENTERED`); the header
  wins. The metadata JSON is not even valid JSON (raw control characters,
  a trailing comma), so nothing reads it.
- **The archive held a stale belief after a rollback**: SQLite rolls back
  the `create table` too, and the module's cache of known tables still
  said it existed, so the next quarter in the same run would have failed.
  The cache is cleared on rollback (tested).

## The first full load (2026-11-08)

All 75 quarters, 2008 Q1 to 2026 Q3, in 74 minutes at one request a minute:
**75 requests to sec.gov, every one a 200**, nothing refused, no unreadable
rows. 778,966 filings; 790,868 issuer rows; 2,987,521 related persons;
432,158 recipients; 786,564 signatures. `formd.db` is 1.65GB, the ZIPs
0.19GB. 2008 is nearly empty (442 filings): electronic Form D began in
2009. Filings a year rise from 20,843 (2009) to a peak of 62,440 (2022);
pooled funds are about 40% early on and 60% from 2021.

## Checked against the source

Crusoe Inc.'s filing 0001924674-26-000002 in the archive (offered
$3,901,017,922, sold $3,108,543,889, 108 investors, first sale 2026-08-31)
matches the filing on sec.gov exactly.

## Personal data

`fd_persons` and `fd_signatures` name people, with street addresses. Public
SEC records, but kept on this machine only. Showing any of it on a page is
an owner decision and a `/privacy` line in the same commit.

## The viewer (2026-11-09)

The owner: "create a front end to show the private company data .. form D
.. give it access only to admin", and chose the laptop over the site (the
archive is not in Turso before phase 6, so tickrlab.com cannot read it).

```
node --use-system-ca formd-view.js        # then http://localhost:4100
```

| File | What |
|---|---|
| `formd-view.js` | The server: `node:http` on **127.0.0.1 only** (`FORMD_VIEW_PORT`, 4100), Basic auth against `ADMIN_PASSWORD` (any user name; it will not start without one), `formd.db` opened **read only**, no request to anywhere. Serves the page, `app.css`, `theme.js`, the icon, and three JSON routes (`/api/options`, `/api/list`, `/api/filing`) |
| `formdquery.js` | The filters as SQL, pure: every value bound, the sort column from a fixed list |
| `formd-view.html` | The page: search by company, CIK, accession or a person named on the filing; companies, funds or both; industry, fund type, state, revenue range, years, amount sold; totals, amount sold by year and by industry, the list, and one filing in a side panel with its offering, issuers, people, brokers, signers and every Form D by the same issuer, linked to sec.gov |
| `formd-view-test.js` | 71 checks, an archive in memory; the address, password and sort-list guards each proven by reverting them |

What it decides:

- **People by name and role only.** The persons, recipients and issuers
  tables hold streets, zip codes and telephone numbers; none is selected
  for the page (the owner, 2026-11-09: "people data is also important but
  not their addresses"). A company's city and state are shown.
- **Each offering counted once.** A D/A restates the offering's running
  totals, so summing every filing counts the same money again. The
  archive marks a filing a later amendment names as its previous one
  (`formd.superseded`, set after each quarter loads; 274,736 of 778,966);
  the viewer leaves those out unless "Every filing" is ticked.
- **Filing errors are kept and marked, not summed.** $1 billion or more
  sold to one or two investors is marked "check" (amber) and left out of
  the amounts, which say how many were left out: 57 among the companies,
  $1.27T between them, led by LOWE INTERNATIONAL HOLDING CO's
  $999,999,750,000 from one investor (2024). The investor counts hold the
  same kind of error (a sum of 100 billion), so the page shows the median
  amount sold instead.
- The totals take 2 to 4 seconds over the whole archive and are kept per
  set of filters while the viewer runs; a person search scans the three
  million related persons (about 11 seconds).

## The SEC's profile of each issuer (E1, 2026-11-09)

The owner, on the viewer: "I don't see much details about the entity itself,
can we get that from somewhere", then "add all this to backlog first and
start with 1" (backlog 61, E1 to E6).

`formd-load.js --profiles [--commit]` reads the SEC's bulk submissions file
already on disk (`submissions-YYYY-MM-DD.zip` in `%TEMP%	ickrlab-sec`,
fetched once by `acq-load.js --list`) and **makes no request**: a missing
file is an error, never a download. `formd.js filerProfile` turns each
issuer's JSON (and its older pages) into one row of `fd_profiles`, keyed
by CIK and the file's date, so a newer file adds rows beside the old.

What it gives, of 365,341 issuers found (365,344 in the archive; funds
included): an **EIN** on 231,399 (the join to Form 5500, E2), state of
incorporation, fiscal year end, **former names** on 16,967 (the SEC also
lists the present name when only its spelling changed; left out),
an industry code on only 7,992, a **ticker** on 2,959 (linked to our stock
page where we track it), and every other form filed, grouped: annual,
quarterly, registration, current, crowdfunding, Regulation A, insider,
13F, Form D, each with a count and first and last date. No website or
description: the SEC holds none for these companies. The street and
telephone are not kept; the business city and state are.

The viewer shows it as "Company profile" and "Everything it has filed with
the SEC" in the side panel, a ticker tag in the list, and a filter, "The SEC
also has" (now listed, financial statements, 10-K, Form C, Reg A,
registration, a former name). About 30 seconds to read the file.

## The fact sheet (2026-11-09, backlog 61 phase 5)

"Known facts" at the top of both side panels (Form D and Employers), from
`facts()` in `formd-view.js`, drawn by `factsheet.js` (one script for
both pages): names on file, tax ID, incorporation, place, business (from
the plans, else the PPP loan), staff now and since 2019, money raised (each
offering once, at its latest filing, the "check" rows left out), PPP loans
(by name and state, marked as such), and a ticker if it trades. Joined by
tax ID where there is one, else the Form D CIK, else name and state.

## Contacts (2026-11-09)

The owner: "We have the buyer names in Form D. Can you a separate list, this
can be a CRM type of data, like a contact database". Form D names no
investors; it names each company's executives, directors and promoters, and
the brokers paid to sell. The owner's choices: companies with telephone,
city and state, **no street address**; people with no address at all; and
the same name is one person only within one state.

`contactsdb.js --build` derives four tables in `formd.db` from the raw Form D
tables (rebuilt whole, about four minutes; the raw tables are never
touched): `ct_people` (a name within a state, or a firm), `ct_roles` (a
person at a company: roles over every filing, newest title, years),
`ct_companies` (newest name and place, the primary issuer's newest
telephone, money raised each offering once, people named) and `ct_brokers`
(by regulatory CRD number, else name; each deal once). The viewer's
**Contacts** page (`/contacts`, `contacts-view.html`, `contactquery.js`) has
a tab each, filters, a side panel that moves between a person and their
companies, and **Download CSV** of whatever is filtered (up to 50,000 rows;
a byte-order mark so a spreadsheet reads names as UTF-8; a leading = + - @
quoted so a spreadsheet never runs it).

The clean-up the first build needed: firms written across the person
fields ("llc" / "Fund GP,") and company words as middle names; a name with
a company word as a whole word (LLC, Inc, LP, Fund, Partners, Capital,
Holdings, Trust and so on) is a firm; junk middle names (placeholders,
punctuation, a repeat of a name, a roman numeral) are dropped; each person
shows the newest mixed-case spelling; US telephones in one form
(312-555-0100), placeholders blank. First build: **552,885 people and 89,462
firms** (642,347), 1,438,302 company roles, 365,344 companies (364,764 with
a telephone), 25,875 brokers and finders.

**One person, the owner's rule (2026-11-09).** Asked "shouldn't the name and
phone number be considered unique": Form D gives no telephone for a person,
only the company's, so a name and telephone key would split everyone with
more than one company (Chase Lochmiller's two Crusoe companies file
different numbers). Instead the telephone joins: one person is a name
within a state, joined with the same name in another state when the two
share a company or a telephone any of their companies has filed
(`mergeAcrossStates`, union-find per name; the joined person takes the
state where they have the most filings, and `ct_people.states` lists them
all). Measured first: 74,084 names in more than one state, 23,029 of them
sharing a company or telephone across states. The rebuild joined 27,027
name-and-state entries into 24,139 people: **525,858 people** and 89,462
firms, 1,413,144 company roles.

## What happens after a first Form D (2026-11-09)

`formd-outcomes.js` (read only, no request): every operating company by the
year of its first Form D, and what followed by the newest data: raised
again (a new offering in a later year), a retirement or health plan under
its tax ID and its staff over time, a registration to sell shares publicly,
a ticker now, and any filing from 2023 on. Descriptive; it rates no
company. First run: 185,666 companies. Of the 96,966 whose first Form D
came in 2010 to 2019: 24% raised again, 14.3% have a plan (their median
staff now 40; of those with five or more at first, 37% at least doubled),
3.3% filed to sell shares publicly, 1.6% trade now, and 12.1% filed
anything from 2023 on (silence is not closure: most need not file again).
By group (2010 to 2019): health care has the most registrations (9.6%) and
listings (4.8%); technology and health care raise again most (42%, 44%);
real estate least (4%: one-off property vehicles).

## The filed date before 2020 Q3 (fixed 2026-11-09)

Quarters up to 2020 Q2 stamp the submission with a time
(`2019-12-31 17:25:33`), which `isoDate` did not read, so 419,367 filings
(every one before 2020 Q3) had no filed date. Found building the viewer;
`isoDate` now keeps the date part (tested both ways), and the stored rows
were filled from `fd_submissions` on this machine, no request: 419,367
filled, none unreadable. The counts a year above were taken from the
quarters and stand.

## Running it

```
node --use-system-ca formd-load.js                    # dry run
node --use-system-ca formd-load.js --commit           # up to 4 quarters, newest first
node --use-system-ca formd-load.js --commit --max all --gap 60
node --use-system-ca formd-load.js --search "crusoe"  # read the archive, no requests
node --use-system-ca formd-load.js --stats
node --use-system-ca formd-load.js --profiles --commit   # E1, from the bulk file on disk, no request
```

Once the history is in, one run a quarter, by hand, after the SEC posts the
new quarter (it lists 2026 Q3 on 2026-11-08).
