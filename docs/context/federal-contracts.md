# Federal contracts: who sells to the US government

Backlog entry 61, E7 (2026-11-09). The owner chose it among the day's
non-SEC work: "Federal contracts, Company outcomes study, Update the
Continental brief".

## What it is

USAspending.gov's Award Data Archive: every federal contract action, one
ZIP a fiscal year (1 to 2GB, several CSVs of 297 columns each). Each action
names the recipient (its registration ID, the UEI), its parent, city, state,
ZIP and **telephone**, the dollars obligated, the agency and the industry
code. Loaded for fiscal 2016 to the current year (the fiscal year starts on
October 1), about 19GB on disk.

## The files

| File | What |
|---|---|
| `contracts-load.js` | The download, careful as the other loaders: the listing service (`api.usaspending.gov .../list_monthly_files/`, one request a year) gives the dated file name, then the file; one request at a time a minute apart, any non-200 stops and nothing is retried, kept in `%TEMP%\tickrlab-usaspending` and never fetched twice (streamed to `.part`), 30 requests a day at most (24 for the twelve years) |
| `contracts-read.js` | The read step (`--load`): each ZIP into `fed_contracts` in the LOCAL `formd.db`, one row a recipient a fiscal year: UEI, name and match key, parent, city, state, ZIP, telephone (one form), dollars obligated (modifications can be negative, so a year can net below zero), actions, the largest agency, the most frequent industry code. **No street, no fax**, nothing per action |
| `contracts-test.js` | The rules and the download's stop, cap and gap |

## Where it shows

The fact sheet (`factsheet.js`): a company's federal contracts, matched by
name key and state, **or by the company's own filed telephone** (a Form D
filing gives the issuer's, a contract record the recipient's): the total,
the fiscal years and the main agency, with the recipients matched named so a
wrong match can be seen.

**A switchboard does not match.** A telephone more than three companies
have filed is a shared main line: a real estate trust filing Goldman
Sachs' or PIMCO's main number matched their contracts until this rule.

## The first load (2026-11-09)

Fiscal 2025, 2026 and the first weeks of 2027 are in: 12.3 million contract
actions, 219,720 recipient-years, 122,392 recipients. **Fiscal 2024 broke
off twice mid-transfer** ("terminated", at 700MB the first time), while the
2025 file of the same size came through; the run stopped each time,
nothing retried, and fiscal 2016 to 2024 wait for another day. A resumed
download (an HTTP range request for the rest of the file) would save
fetching the first part again; not built.
Continental Electrical / FourGen have no federal prime contracts in those
years. Form D companies matched by their own telephone (switchboards left
out): 1,117 (1,632 before the switchboard rule).

## Running it

```
node --use-system-ca contracts-load.js                       # dry run, no request
node --use-system-ca contracts-load.js --download --commit   # the years not on disk, a minute apart
node --use-system-ca contracts-load.js --load --commit       # into formd.db; no request
```
