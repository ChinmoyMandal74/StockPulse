# Filed yesterday (promo template `filed`, Market group, 2026-10-20)

The owner: "I need a card in promo showing what was filed yesterday, I should be under Market template". It came straight after the next-day filings check (`secdaily.js`, see `large-holder-filings.md`), which makes "yesterday" true: the 13D/13G and 8-K tables now hold the previous business day's filings each morning.

## What it shows
One business day's filings about companies on the screen:
- **5% holders**: each Schedule 13D or 13G with its ticker, company, holder (as filed, often in capitals), the form (13D or 13G, "amended" for a `/A`) and the stake (`Holders13.pctWord`: "no holding" for zero, a dash for none stated).
- **Company announcements**: each 8-K with its items in words (`Events8k.label`, two items and "+N"). An amber dot marks an item in `Events8k.NOTABLE` (bankruptcy, cybersecurity incident, debt accelerated, impairment, listing notice, auditor change, restatement warning, change of control). Amber means "notice this" on this site.
- Count chips (holder filings, 8-Ks, companies), "and N more" under a list that does not fit, and a note: the date, what a 13D, a 13G and "amended" mean, what the amber dot marks, and "A filing is a record, not a reading."

**Order, not rank:** 13Ds before 13Gs (the rarer form), 8-Ks with a notable item first, and within each the larger companies first, so the names a reader knows lead. Nothing is coloured good or bad.

**Controls:**
- **Day** (`fldDay`): blank is the newest day the daily check has read; the options are the recent days it read, filled from the reply.
- **Show** (`fldShow`): both lists, holders only, or 8-Ks only.
- **Index** (`fldSp500`): the usual cut.

Rows per card (`FLD_ROWS`): 13 at 4:5, 9 square, 22 at 9:16, shared between the two lists (each gets half and gives the other what it does not use). These were measured with both lists full and their "and N more" lines showing.

## Data
- `GET /api/filings/day?date=` (signed in; a guest gets their twenty only), built by `filedDayPayload` in `server.js`. The day is the asked one if it is a date in the last 45 days before today, else the newest day in `sec_daily` (`through`); `days` lists the recent days read (or the last five business days before the check has run).
- Two reads by the `filed` indexes (`readSecHoldersSince`, which now also returns the form, and `readSecEventsSince`), kept to that day. Holder lines that repeat (same company, holder, form and stake, e.g. a joint filer amending three times in a day) are one line. Labels are made on the server because `cards.js` has no requires.
- The card's channel is `getFiled(need)` (`Cards.filedNeed`), asked by both hosts: the studio (cached per day; the reply refills the Day picker) and `/api/m/post` (`getFiled: () => fld`).

## Tested
In the real studio, served from disk with the snapshot and payloads built by the server's own `filedDayPayload` (lifted from `server.js`) from the live tables for 2026-10-19 and 2026-10-15:
- **Card checks:** it is found under Market, nothing overflows at any size, the note clears the footer after the row caps were tuned (it had overlapped by 16px at 4:5 and 49px at 9:16), and holder names line up (a fixed form column; the badge's width had shifted them).
- **Controls:** the S&P 500 cut, holders only, and 8-Ks for Thursday from the Day picker ("Filed on Thursday / October 15, 2026") all work.
- **Payload:** a guest saw none of that day's companies (none were among their twenty), and a future date fell back to the newest day.
