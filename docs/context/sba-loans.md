# SBA 7(a) and 504 loans: thirty-five years of small-business loans

Backlog entry 61, E13 (2026-11-09). The owner, after the list of further
free sources: "Can you do the 2 now" (SBA loans, after the federal
contracts).

## What it is

The Small Business Administration publishes every 7(a) and 504 loan it has
guaranteed since fiscal 1991 in six CSVs (four 7(a), two 504), refreshed
each quarter; the files name their release (`_asof_260930` is September 30,
2026). Each loan gives the borrower's name, city, state and ZIP, the amount
(and SBA's guaranteed part, or for a 504 the bank's part), the approval
date, term, industry code (NAICS), franchise, business type and age, the
**jobs supported** (created plus retained, the lender's own estimate on the
application, which the SBA does not check), the lender, and how the loan
stands: paid in full, charged off (with the date and amount), cancelled,
or running. The data dictionary is
`7a_504_foia_data_dictionary.xlsx`, kept beside the files.

Like the PPP files, but every year: a size signal for small private firms
long before and after 2020, and a **charge-off is a sign the business
failed**. **No EIN and no loan number**, so a business is matched to the
plan sponsors and the Form D issuers by name and state (the PPP match key,
`nameKey`): inexact, and the fact sheet says so.

## The files

| File | What |
|---|---|
| `sba-load.js` | The six files' names and address, and the command. The download is the PPP loader's (`ppp-load.js` `download` and `fileDeps`, given `files`, `base` and the header to expect): same folder `%TEMP%\tickrlab-sba`, same request log and **20-a-day cap shared with PPP** (one host), same lock, one request a minute, any non-200 stops, nothing retried, never fetched twice |
| `sbaload-read.js` | The read step (`--load`): the files on disk into `sba_loans` in the LOCAL `formd.db`, no request. A loan's key is a hash of its own fields (program, name, city, state, ZIP, approval date, amount, lender, term), so a status change keeps the key. A later quarterly release adds the loans it does not hold; the status of a loan already kept stays as first read |
| `sba-test.js` | The row rules, the read step over files made in the test, and the shared download pointed at these files |

## What is kept, and not

Kept: loans to businesses, one row a loan, the fields above.
**Not kept**: street addresses (the borrower's and the lender's), and any
loan whose business type is "Individual" (a person's name as the business).

## Where it shows

The fact sheet (`factsheet.js`, both side panels of the local viewer): the
loans matched by name and state, total amount, years, most jobs supported,
how many were charged off, and each loan with its lender and status.

## Running it

```
node --use-system-ca sba-load.js                       # dry run, no request
node --use-system-ca sba-load.js --download --commit   # the files not on disk, a minute apart
node --use-system-ca sba-load.js --load --commit       # into formd.db; no request
```

For a new quarterly release, change `ASOF` in `sba-load.js` (the file names
change with it) and run both steps.
