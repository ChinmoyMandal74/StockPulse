# Regulation A — backlog 61, E4

Companies raising up to $20 million (Tier 1) or $75 million (Tier 2) from the
public under an offering statement the SEC qualifies: Form 1-A (and its
amendments, 1-A/A, and post-qualification amendments, 1-A POS), then a yearly
report (1-K) and an exit report (1-Z). The SEC publishes the fillable part of
each as a quarterly data set since 2015 Q2.

What it gives that Form D does not: each 1-A carries **the company's latest
balance sheet and income figures** (cash, total assets and liabilities, equity,
revenue, costs, net income), **its auditor**, **full- and part-time staff**,
its SIC code, and the offering (tier, audited or not, size, price, fees); each
1-K and 1-Z **what was actually sold and the net proceeds**.

Kept in the LOCAL `formd.db`. Never Turso, never served.

| File | What |
|---|---|
| `formc.js` | `SETS.rega`: the page, the ZIP name (`2026q3_rega.zip`) and both folder names the SEC has used (`regulation-data-sets`, `regulation-a-data-sets` for 2022 Q3 to 2024 Q1) |
| `formcarchive.js` | Every table as published, under `ra_` (`ra_reg_a_submission`, `ra_reg_a_issuer_info`, ...), the quarters in `ra_loads` |
| `formc-load.js --set rega` | The loader, the same one as Form C's and with the same care (`form-c.md`) |
| `rega.js` | The summary: `rega`, one row a filing, and `rega_companies`, one a company (its newest filing that gives figures, and its counts); dates as the set writes them (`raDate`: `30-SEP-2026`, `18-NOV-25`) |
| `factsheet.js`, `formd-view.js` | "Own figures (Reg A)" on every side panel's fact sheet, by CIK: revenue, net income, full-time staff, when filed, the auditor and the offering's size |
| `formc-test.js`, `formd-view-test.js` | The links, the prefix, the summary (a 1-K's sales summed, no street, zip or telephone, a rebuild never doubling) and the fact sheet line; the company row's rule proven by reverting it |

```
node --use-system-ca formc-load.js --set rega                         # dry run
node --use-system-ca formc-load.js --set rega --commit --max all --gap 60
node --use-system-ca formc-load.js --set rega --summarise --commit     # rebuild the summary; no requests
```

## The tables (as published)

Fifteen a quarter (eight in 2015), keyed on `ACCESSION_NUMBER`:
`REG_A_SUBMISSION` (form, `ISSUERCIK`, `FILING_DATE`, file number),
`REG_A_EMPLOYEES_INFO` (name, CIK, SIC, full- and part-time staff, year of
incorporation), `REG_A_ISSUER_INFO` (address, industry group, the balance sheet
and income figures, auditor), `REG_A_SUMMARY_INFO` (tier, audit status, offering
size, price, the fees and who earned them), `REG_A_SUMMARY_INFO_KZ` (a 1-K's or
1-Z's securities sold, fees and net proceeds, one row an offering),
`REG_A_ITEM_KZ` and `REG_A_ITEM_INFO_K` (the report's cover), and securities,
jurisdictions, signatures and certification tables.

## Loaded (2026-11-10)

All 46 quarters, 2015 Q2 to 2026 Q3, in one run: 46 requests a minute apart
plus the page, every one a 200, nothing skipped; 825,827 rows. **13,244 filings
by 1,842 companies** (1-A/A 4,636, 1-K 2,879, 1-A POS 2,611, 1-A 2,343, 1-Z
636), 9,590 with the company's figures. 695 companies report revenue above zero;
300 have ten or more full-time staff. 2,343 offering statements: 1,758 Tier 2,
585 Tier 1, 1,811 with audited accounts, seeking $48.3 billion at their
maximums; the 1-Ks and 1-Zs report $6.1 billion of net proceeds. **629 companies
are also Form D issuers and 175 have filed a Form C** (by CIK).

**The figures are as filed and some are plainly wrong.** The largest "revenue"
includes Fisher Wallace Laboratories, $474 million with 4 full-time staff, and
QZ Global, $390 million with 2: entries in the wrong units, most likely. The
SEC does not check this part of the form. Read a figure against the filing
before quoting it.
