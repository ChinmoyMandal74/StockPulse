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

## Running it

```
node --use-system-ca formd-load.js                    # dry run
node --use-system-ca formd-load.js --commit           # up to 4 quarters, newest first
node --use-system-ca formd-load.js --commit --max all --gap 60
node --use-system-ca formd-load.js --search "crusoe"  # read the archive, no requests
node --use-system-ca formd-load.js --stats
```

Once the history is in, one run a quarter, by hand, after the SEC posts the
new quarter (it lists 2026 Q3 on 2026-11-08).
