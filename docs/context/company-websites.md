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

Never Turso, never served.

The fact sheet (`factsheet.js`, both side panels of the local viewer) shows
the website, how it matched, the founding year and open jobs. A "From its own
website" block gives the quotes and lists. A name-only site is marked so.

## Files

| File | What |
|---|---|
| `websites.js` | The rules, pure: guesses, robots.txt, pages picked, the match, the schema and the checks |
| `website-load.js` | The pilot list, the careful getter, finding and reading, the archive |
| `website-test.js` | The rules, and the loader over a made-up web |

## Running it

```
node --use-system-ca website-load.js                                  # dry run
node --use-system-ca website-load.js --commit --max 200 --max-usd 2   # the pilot
node --use-system-ca website-load.js --commit --ein 330747275          # one company
node --use-system-ca website-load.js --commit --ein 550421240 --url citcowater.com   # its address given by hand
node --use-system-ca website-load.js --stats
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
