# Company websites: what private companies say about themselves

Backlog entry 61, E17 (2026-11-10). The owner: "Is it possible to figure out
the public website for some of these private business and scrape data from
their own website", then "Go ahead" to a 200-company pilot.

## Why it is guessed

None of the private-company sources (Form D, the plan filings, PPP, SBA,
federal contracts) carries a website. So `websites.js candidates()` guesses
up to ten addresses from the trading name and the legal name: the
distinctive words joined, the first two, the first alone when six letters or
more, the whole name joined, the first two hyphenated; `.com`, then `.net`
(`.org` first for a charity-shaped name or industry).

Each guess is looked up in DNS first (no request to anyone's site), the bare
name and then `www.` (Alyce's name answers only there). An address that
resolves is visited, at most four a company: `robots.txt`, then the home
page. Both go over HTTPS, or over plain HTTP when HTTPS gets no answer at all
(Flack Steel's server refuses HTTPS).

`--retry` tries again the companies marked "none found", after a change to
how sites are found.

**It is the company's site** only when its pages carry its name and its city or
the telephone on file (its Form D). That makes it "confirmed". The name
alone is "name only": kept, not read. Parked and for-sale domains are
recognised and passed over.

## What is read

On a confirmed site, `pickPages` chooses at most six pages from the home
page's own links: about, contact, services, careers, team and news, one of
each. Each is read only where `robots.txt` allows.

Claude Haiku reads them (`websites.js request`). It returns what the company
does (a quote), the founding year with its quote, a staff statement, its
services, the markets it serves, locations, the people named and their
titles, the customers named, dated history and open jobs.

**Every phrase must be on the pages** (`check`):
- A year must stand in its own quote.
- A phrase holding an email address or telephone number is dropped.
- A "person" of one word is dropped.
- What is dropped is named in `problems`.

The model is never asked for contact details.

## Care

- One request at a time, 3 seconds apart by default (never under 2).
- A plain User-Agent naming `TickrLabResearch` and the owner's contact.
- `robots.txt` is obeyed. A group naming us wins over `*`. A missing file
  (404) allows everything; one that fails to load keeps us out.
- HTML only, 2MB a page at most, no logins, no forms.
- A site that refuses or fails is that company's answer, recorded, and the
  run goes on. Ten companies in a row with no answer from any address stops
  the run, since the connection is the likelier fault.
- Every request is logged in `web_requests`.
- **Common Crawl** (the free public copy of the web) was the first choice,
  since it never touches the company's server. Its index answered 504 three
  times on 2026-11-10, so the loader reads sites directly. It could be added
  later as a first step.

## Where it is kept

| What | Where |
|---|---|
| The site found, how it matched, what was tried | `web_sites` in the LOCAL `formd.db` |
| The checked facts, tokens and cost | `web_reads` |
| Each request | `web_requests` |
| The page text | the LOCAL `web-archive.db` (gitignored), table `pages` |
| A page's earlier text, when it changed | `pages_history` (web-archive.db) |
| Each deep crawl | `crawls` (web-archive.db) |
| The full-text index of every page | `pages_fts` (web-archive.db; FTS5, word forms matched) |

Never Turso, never served.

The fact sheet (`factsheet.js`, both side panels of the local viewer) shows
the website, how it matched, the founding year and open jobs. A "From its own
website" block gives the quotes and lists. A name-only site is marked so.

## Files

| File | What |
|---|---|
| `websites.js` | The rules, pure: guesses, robots.txt, pages picked, the match, the schema and the checks |
| `website-load.js` | The pilot list, the careful getter, finding and reading, the archive |
| `website-test.js` | The rules, and the loader over a made-up web (the deep crawl too; the history and robots.txt guards proven by reverting them) |
| `web-search.js` | Search the kept text: companies, their best pages, a snippet each |

## Running it

```
node --use-system-ca website-load.js                                  # dry run
node --use-system-ca website-load.js --commit --max 200 --max-usd 2   # the pilot
node --use-system-ca website-load.js --commit --ein 330747275          # one company
node --use-system-ca website-load.js --commit --ein 550421240 --url citcowater.com   # its address given by hand
node --use-system-ca website-load.js --stats
node --use-system-ca website-load.js --commit --eins <file>            # a shortlist (the viewer's Targets page)
node --use-system-ca website-load.js --deep                             # dry run: the confirmed sites not yet crawled
node --use-system-ca website-load.js --commit --deep [--pages 40] [--eins <file>] [--retry]
node web-search.js "water well" [--state WV,OH] [--limit 30]
node web-search.js --stats
```

The pilot draws employers of 100 to 2,000 people (filed 2023 or later), half
with a telephone on file and half without, in a fixed hash order, so a rerun
continues it. A company already tried is skipped.

## The pilot (2026-11-10)

198 employers of 100 to 2,000 people, half with a telephone on file:

| Verdict | All | With a telephone | Without |
|---|---|---|---|
| Confirmed and read | 73 (37%) | 39 | 36 |
| Name only | 60 (30%) | 31 | 29 |
| None found | 65 (33%) | 30 | 35 |

- **Cost:** reading cost $0.0016 a company ($0.12 for 73). The model said
  "not the company's site" for 3 of them. 71 phrases were dropped by the
  checks.
- **What a confirmed site gave:**
  - what it does: 68 of 76
  - services: 73
  - locations: 72
  - a hiring line: 55
  - dated history: 50
  - people named: 46
  - founding year: 41
  - customers named: 23
  - a staff statement: 14
  - an open-jobs count: 3
- **Name only is mixed.** In a sample of 15, about two-thirds were the right
  company, the site simply not naming the city on file. Most often that city
  is a registered office (QA Wolf in Dover, Delaware). The rest were a
  different company with the same name (`horizon.com` for Horizon
  Industries).

The three companies briefed:
- **Bremer Whyte:** confirmed (`bremerwhyte.com`).
- **Continental Electrical:** its plan is now filed by FourGen Holdings.
  Since this change every earlier name on file is guessed too, which found
  `continentalelectrical.com`. That site answers **403** to automated
  visitors, so it is left alone.
- **CITCO Water:** files as The C. I. Thornburg Co. "CITCO" appears in no
  file we hold, so `thornburg.com` (an unrelated investment firm) came out
  name only and was not read. A brand that is not in any filing cannot be
  guessed. So the address can be **given by hand** (`--ein` with `--url`,
  verdict "given"; owner, 2026-11-10). That is read whatever the match, and
  the fact sheet says the address was given and what matched.
  `--url citcowater.com` gave five pages: name and city matched on the
  history page ("Charles Irving Thornburg created the C.I. Thornburg
  Company ... in Huntington"), the 2020 rename to CITCO Water, founded
  1931, "over 100 employees and seven full-service branches", eleven
  locations, nine executives, twelve services. Nothing was dropped by the
  checks; $0.0026.

How a brief uses this, and the news step beside it:
`private-company-briefs.md`.

## The first trial

Bremer Whyte Brown & O'Meara: found at the second guess (`bremerwhyte.com`)
and confirmed by name and city. Seven requests, six pages, $0.0023. It
returned seven practice areas, nine office locations, its CEO and founding
partner, and a hiring line. The check dropped one office the model added
that was not on the pages.

## The deep crawl (2026-11-10)

The owner: "bring the entire website content that might be useful and store
it so that any query can be run using AI later". `--deep` takes each site
already confirmed (or given) and keeps the rest of it, **no model**:

- robots.txt first (a site that will not serve it is left alone), then the
  sitemap it names or `/sitemap.xml` (an index: two child sitemaps, pages
  before posts), then the pages, **the most telling first**
  (`websites.js` `DEEP_KINDS`: about and history, services and
  equipment, locations, team and owners, projects and customers, careers,
  certifications and safety, news, contact), following links found on the
  way, to `--pages` (40 by default, 100 at most).
- Same site only, HTML only, three path levels at most, no files, no login,
  cart, search, privacy, terms, tag or date-archive pages, at most one query
  parameter; tracking parameters dropped.
- A page's own text without its menu, header and footer (the home page keeps
  them: the city and telephone are often only there). The same text at two
  addresses is kept once.
- The same 3 seconds between requests; about two minutes a site at 40 pages.
- A site crawled is not crawled again unless `--retry`. A page fetched again
  with different text keeps the earlier text in `pages_history`.
- `pages_fts` (built over the pages already kept when first created) is kept
  in step by triggers; pages are written by insert and update, never "insert
  or replace", whose delete fires no trigger.

PDFs (brochures, line cards) are not fetched.

**Using it later with AI:** `web-search.js` finds the companies and pages
for a question; those pages are what a model is given to answer it, with
every quote checked against the text, as the reader does.

## Nationwide, every night (2026-11-10)

The owner: "Lets do the nationwide , 12GB is fine". Every employer with its own
retirement plan, **100 or more staff**, filing 2023 or later (about 117,000),
found, read and kept whole, a night at a time, by the laptop task
**TickrLab websites** (`website-task.ps1`, 01:00 every night; `schedule.js`
id `websites`):

```
website-load.js --commit --min-staff 100 --max-staff 0 --max 200000 --workers 4 --then-deep --minutes 345 --max-usd 2 --max-gb 12
```

- `--workers 4`: four companies at once, each worker with its own getter,
  so each site still sees one request every 3 seconds.
- `--then-deep`: a confirmed site is kept whole by the same worker straight
  after it is read.
- `--minutes`, `--max-usd`, `--max-gb`: no new company is started past
  any of them; the next night carries on (companies tried are skipped).
- The log is `website-load.log` (gitignored).

Expected: about 240 companies an hour, about 1,400 a night, so roughly 80
nights for the list; about $0.65 a night of reading (some $60 in all); about
0.3 MB a site kept, 12 GB at most. A night the laptop sleeps is skipped.

## The tracker and the morning email (2026-11-10)

The owner: "Create a small crwal tracker page that tracks progress and send me
a daily email in the morning on the crwal previous night".

| File | What |
|---|---|
| `crawlstats.js` | The figures, one set for both: the list (100+ staff, filing 2023 on; its size counted once a viewer start), how much of it is tried, the verdicts, sites kept whole, pages, text, earlier versions, reading cost, night by night (a night named by the evening it starts: 01:00 to 06:45 on the 11th is the night of the 10th), the pace over the last three nights that worked and the finish at that pace, and the run's own last `done:` and stop lines from `website-load.log` |
| `crawl-view.html` | `/crawl` in the local viewer: progress and archive-size bars, six tiles, night by night, the latest 40 companies tried with what was kept; refreshes every minute. Prefix `cr-` |
| `crawl-report.js` | Counts the night on the laptop and posts it to `/api/cron/crawl-report` (CRON_SECRET), which mails the operator, kind `crawl-report`: last night, the whole list, and anything to look at (nothing tried, a run that ended other than by its minutes, under 15% confirmed, the archive past 80% of 12 GB). Counts only; no company or page reaches the server. `--dry` prints the body |
| `website-task.ps1` | Runs it straight after the crawl in the same task, so the email comes about 06:45 |
| `crawlstats-test.js` | The figures, the nights, the log lines, the body (no company in it) and the page's route; the list filter proven by reverting it |

**Changed the same evening** (owner: "why don't you start at 11pm tonight and go
on till 7am .. I am trying to get this data faster into the app"): **23:00 for
465 minutes (to about 06:45), six workers, $3 a night**; the morning email
follows the run. About 2,800 companies a night, so roughly 40 nights for the
list. Re-registered with `website-task.ps1` (it replaces the task).
