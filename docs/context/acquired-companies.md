# Acquired companies: the accounts buyers file for private businesses

Backlog entry 61, phase 2 (2026-11-09). The owner: "Let's do phase 2", after
phase 1 (Form D, `form-d.md`). Same terms: "be very careful .. be slow".

## What it is

A filer that completes a significant acquisition files an 8-K with item
2.01 within four business days, and must then file the acquired business's
own financial statements under item 9.01, nearly always by amendment (an
8-K/A within 71 more days) as EX-99 exhibits: audited annual accounts,
often unaudited interim ones, and combined pro forma figures. For a private
business those are often the only accounts it ever publishes.

Not every 2.01 leads to them: 2.01 also covers disposals, and a public
target's statements are only incorporated by reference. The model says what
each exhibit is, and only "business statements" or "carve-out statements"
count.

## The files

| File | What |
|---|---|
| `acq.js` | The rules, pure: the 8-K trail (`filingsOf`, `candidates`), the index (`parseIndex`, `pickDocs`), the model's schema and instructions, `check` (every figure, name and sign against the text) |
| `acqarchive.js` | The LOCAL store, `acq.db` beside `formd.db` (gitignored). Never Turso, never served |
| `acq-load.js` | The loader, in steps: `--list`, `--index`, `--read`, `--recheck`, `--stats`, `--search` |
| `acq-test.js` | 61 checks, no network; every guard proven by breaking it |

## The steps, and what each costs the SEC

1. **`--list`: one request in all.** The SEC's bulk submissions file
   (`submissions.zip`, 1.57GB on 2026-11-09: every filer's filing list, each
   8-K with its items) is downloaded once into `downloads\sec` (in the project, gitignored) and read
   from disk. That replaces a request a company (about 3,000 for our own
   companies alone). Read in about 3 minutes: 992,106 filers; since 2009,
   10,500 filers closed an acquisition (831 of them ours), with 28,016
   closings and 12,338 amendments (1,139 by our companies). Our companies
   are matched by ticker against the local `analysis.db` names, so no Turso
   read either.
2. **`--index`: one request a filing**, the `-index-headers.html` page that
   lists its documents with their descriptions. Amendments only unless
   `--closings`; our companies first, newest first.
3. **`--read`: one request an exhibit**, at most three a filing
   (`MAX_DOCS`), the text kept in the archive so it is never fetched again.
   Exhibits described as pro forma, a press release or a consent are not
   read, and neither is a PDF.

The getter, as Form D's: one request at a time, `--gap` seconds apart (10
by default, never under 5; the SEC allows ten a second); **any answer but a
200 stops the run** with nothing retried, except a 404 on one document, which
is recorded and the run goes on; at most 1,000 requests in any 24 hours,
counted in the archive's own `requests` table; one run at a time (a lock
file); nothing schedules it.

## The model

Claude Haiku 5.5, as the release reader, at about **$0.003 an exhibit**
(the first 16 cost $0.047). `--max-usd` caps a run (1 by default). Every
answer is kept (`reads.answer`), so a change to `check` is applied again
with `--recheck`, no request and no spend.

## The checks (`check` in `acq.js`)

- **Every figure must be in the exhibit text** as a whole number (the release
  reader's `inText`); one that is not is dropped and named in `problems`.
- **The sign.** The text check ignores brackets, so a loss copied as a profit
  would pass it. A figure given as negative must appear negative somewhere
  in the text, and a positive one somewhere without brackets or a minus.
  Each occurrence is judged by what stands just before it, spaces and a
  dollar sign skipped. The first version read the note number in
  "Revenues 13 $ 194,702,004" as part of the figure and refused every
  revenue line in AMI TopCo's statements; fixed and tested.
- **The scale**: a period the model calls "units" takes the exhibit's stated
  scale when it states exactly one ("in thousands"); stated several,
  "units" stands.
- **The business's name, the auditor and the one-sentence description** must
  be in the text word for word, or they are dropped.
- **Pro forma figures are never kept as the business's.**
- A period with no end date, or with no figure left, is dropped.

## What is stored (`acq.db`)

`filers` (cik, name, tickers, ours or not), `filings` (each candidate, its
role and the closing it follows), `docs` and `indexed` (each filing's
documents), `texts` (each exhibit read, as text), `reads` (what each exhibit
is, the business, auditor, opinion, problems, tokens, dollars, the model's
answer), `periods` (a row per period: revenue, gross profit, operating
income, net income, total assets, liabilities, equity, cash, operating cash
flow, each as a number and as printed), `requests` and `runs`.

## First readings (2026-11-09)

- **AMI TopCo, Inc.** (bought by Lattice, LSCC; 8-K/A of 2026-10-13): year to
  2025-12-31 revenue $194,702,004, net loss $14,014,393, total assets
  $678,304,885, cash $37,775,933. Each checked against the exhibit text by
  hand.
- **Honeywell's Productivity Solutions and Services business** (bought by
  Brady Corporation, BRC; 8-K/A of 2026-10-16): a carve-out of a public
  company's division, revenue $1,147.0M for 2025, audited by Deloitte & Touche
  LLP. Not a private company, but accounts published nowhere else.
- Of the first 16 exhibits, six were pro forma only, which is why pro forma
  exhibits are now skipped by their description.

## Running it

```
node --use-system-ca acq-load.js --list                        # dry run
node --use-system-ca acq-load.js --list --commit               # the bulk file once, then the candidates
node --use-system-ca acq-load.js --index --commit --max all    # our amendments' indexes, 10s apart
node --use-system-ca acq-load.js --read --commit --max all --max-usd 10
node --use-system-ca acq-load.js --recheck --commit            # after a change to check()
node --use-system-ca acq-load.js --stats
node --use-system-ca acq-load.js --search "lattice"
```

`--all-filers` widens `--index` and `--read` from our companies to every
filer (12,338 amendments; about 37,000 requests and $70 of model time at
the rates above, so weeks at the daily cap). A new bulk file is needed only
for new filings; delete the old ZIP from `downloads\sec` (in the project, gitignored) to fetch one.
