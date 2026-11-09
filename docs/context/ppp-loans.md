# PPP loans: a second headcount for small private firms

Backlog entry 61, E6 (2026-11-09). The owner chose it among the day's
non-SEC work: "Every employer in the viewer, PPP loans, Fix the
acquired-company figures, Company fact sheet".

## What it is

The Small Business Administration publishes every Paycheck Protection
Program loan of 2020 and 2021: about 11 million, in thirteen CSVs (one of
loans over $150,000, twelve of smaller ones; release of 2024-09-30). Each
gives the borrower's name, city, state and ZIP, the jobs it reported, its
industry code (NAICS), the loan and the forgiven amount, the business type
and age. **No EIN**, so a business is matched to the plan sponsors and the
Form D issuers by name and state only: inexact, and every page says so.

## The files

| File | What |
|---|---|
| `ppp-load.js` | The download, careful as the other loaders: thirteen bulk files (about 420MB each), one at a time a minute apart (`--gap`, never under 30s), any non-200 stops and nothing is retried, kept in `%TEMP%\tickrlab-sba` and never fetched twice (streamed to `.part`, kept only once whole and starting with the header), 20 requests a day at most (logged in `requests.json` beside the files), one run at a time |
| `pppload-read.js` | The read step (`--load`): the files on disk into `ppp_loans` in the LOCAL `formd.db`, no request; `nameKey`, the match key (capitals, `&` as AND, punctuation and legal suffixes dropped: "Continental Electrical Construction Co., LLC" and "CONTINENTAL ELECTRICAL CONSTRUCTION CO LLC" both give "CONTINENTAL ELECTRICAL CONSTRUCTION") |
| `ppp-test.js` | The row rules, the read step over a file made in the test, the download's stop, cap and gap |

## What is kept, and not

Kept: named businesses, one row a loan: number, date, first or second draw,
name and match key, city, state, 5-digit ZIP, jobs reported, industry code,
amount, forgiven, business type and age, non-profit flag.

**Not kept**: street addresses; lender details; the borrower demographics
the files carry (race, ethnicity, gender, veteran status); any loan whose
name was withheld ("Exemption 6"); and any loan to a person (sole
proprietorship, self-employed individual, independent contractor, single
member LLC), whose "business name" is a person's name.

## The first load (2026-11-09)

13 requests to data.sba.gov, every one a 200; 11,468,210 loans read;
**6,253,814 kept**, loans to named businesses. About 5.2 million were loans
to people and are left out; names withheld were a handful (the "Exemption
6" rows). The first run as a script failed at once (the read step asked
the loader for its file list before the loader had defined it, a case the
tests, which call the read step directly, did not reach); the list now comes
in `deps.files`.

FourGen Holdings (Continental Electrical Construction) took a $10.0M loan on
2020-04-09 reporting 496 jobs: against 103 people in its retirement plan
that year, the crews the plan does not cover.

## Where it shows

The fact sheet (`factsheet.js`, drawn in both side panels of the local
viewer): the loans matched by name key and state, their amounts, the most
jobs reported, and a note that a namesake in the same state can appear.

## Running it

```
node --use-system-ca ppp-load.js                       # dry run, no request
node --use-system-ca ppp-load.js --download --commit   # the files not on disk, a minute apart
node --use-system-ca ppp-load.js --load --commit       # into formd.db; no request
```
