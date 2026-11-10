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
node --use-system-ca website-load.js --stats
```

The pilot draws employers of 100 to 2,000 people (filed 2023 or later), half
with a telephone on file and half without, in a fixed hash order, so a rerun
continues it. A company already tried is skipped.

## The first trial

Bremer Whyte Brown & O'Meara: found at the second guess (`bremerwhyte.com`)
and confirmed by name and city. Seven requests, six pages, $0.0023. It
returned seven practice areas, nine office locations, its CEO and founding
partner, and a hiring line. The check dropped one office the model added
that was not on the pages.
