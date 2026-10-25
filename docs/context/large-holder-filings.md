# Large-holder filings: Schedules 13D and 13G (2026-10-11)

Backlog 37a, built at the owner's request after the 8-K events. Who reported holding more than 5% of a company, how much, and on which form.

**The two forms.** A 13D is filed by a holder who may seek to influence or control the company; a 13G is the short form for a passive one (an index fund, an institution in the ordinary course). An amendment reports a change, including falling back under 5%.

## Where things live

- `holders13.js` (root): `pick(recent, since)`, `parseDoc(xml)`, `rowOf(candidate, doc, cik)`, `collect(...)` (handed its fetch), `label`, `pctWord`, `docUrl`, `pageUrl`.
- `db.js`: table `sec_holders (symbol, accn, filed, form, kind, holder, shares, pct, persons, event_d)`, in `SYMBOL_TABLES`, index on `filed`. `writeSecHolders`, `readSecHolders`, `readSecHolderAccns`, `readSecHoldersSince`.
- `server.js`: the hook in `secFetchOne`, `GET /api/holders?symbol=`, and the `hd` part of the stored readings.
- `sec-holders-load.js`: the first fill.

## Rules that must hold

- **Two steps, and the second is new SEC traffic.** The submissions list the filings refresh already downloads names each filing but not the holder or the stake. Each filing's own document (`primary_doc.xml`, about 5KB, structured since December 2024) is fetched **once** and never again: `readSecHolderAccns` is what stops a refetch.
- **A company's own list also holds the 13Gs it filed about other companies.** Palantir's carries its 13G on Surf Air Mobility. Every document names its issuer; one whose issuer is not this company is stored as `kind = 'X'`, never shown and never fetched again. Without the check Palantir is listed as a holder of itself. A 404 is also stored `'X'`; a server error or dropped connection is left unrecorded so it is retried.
- **Joint filers report one holding several times.** A fund, its manager and the manager's owner each list the same shares. The row is the largest stake stated, never a sum, with the count of persons. **The name is the first person listed at that stake**, since a filing names its principal first: sorting put "Feld Peter A" on Starboard Value's holding in Qorvo.
- **A zero stake reads "no holding"**: an amendment saying the stake is no longer reportable. A missing percentage is left out, never printed as zero; one over 100 is a typing error and is withheld.
- **At most 3 documents a company per refresh** (`HOLDER_DOCS`), sequential, with the declared `SEC_UA`. A 429 stops the call.
- **Only the structured forms** (`SCHEDULE 13D`, `SCHEDULE 13G` and their `/A`). The older free-form `SC 13D` / `SC 13G` have no fields and fall outside the 400-day window anyway.
- **Which form a holder chose is a fact; what it means for the share is not said.** A 13D is not "an activist is coming": founders file them for decades. No colour, no ranking. 13D is bold only because it is the rarer form. Display only; the signal is identical with the field absent, present and alarming.

## Surfaces

- **Stock page**: section `#hold`, "Large holders", before Company events. One line per **filing**, so a holder who amends five times is five lines; the newest line for a name is where that holder stands. `loadHolders()`.
- **Screener**: column `lastHolder`, "5% filing", last in Ownership: the newest 13D or 13G in the last 60 days as "13D · Cohen Ryan · 8.9%" and its age. A text filter (type `13D`), sorts by date. Through `stampFlows`: `flows.hd` (`FLOWS_V` 6), fields `lastHolder`, `lastHolderDate`, `lastHolderActive`.
- Constants after this column: Ownership 8 (a fund's blank run `naRun(8)`), `PAD_SPAN` 114, error row 109, empty row 111.

## The promo card: `holders`, "Large holders", in Stock spotlight (2026-10-11)

The owner: "add a page in promo for large investor data, single stock template". `tplHolders` in `private/cards.js`; one control, `lhSym`. Data through `ctx.getHolders(symbol)`, asked by `Cards.holdersNeed`; the studio fetches `/api/holders` and `/api/m/post` calls `holdersPayload`, the one function the page route also uses.

- **One row per holder, not per filing.** The stock page is a log; the card is what the log adds up to: `Cards.holdersFold(filings)` keeps each holder's newest filing (names matched ignoring case and punctuation; the filings are sorted inside the fold, not trusted to arrive in order).
- **A holder whose newest filing reports no holding has left** and is named under the rows, up to four. One with no percentage stated stays on the list, last, with a dash.
- **Not a register of shareholders, and the card says so.** It holds only those who filed in about thirteen months. Apple's card on 2026-10-11 shows Vanguard alone: other holders above 5% had nothing to amend in the window. The note states that a holder with nothing to amend is not there and nobody under 5% is.
- Bar in the accent (a size), 13D marked bold as the rarer form, no colour for either form. Caps: 10 rows, 6 on the square, 12 on the story.

Checked against the stored filings: Dell shows Michael Dell 45.7% (13G), Silver Lake 11.9% (13D), Vanguard Capital Management 7.1% (13G), and The Vanguard Group as having left.

## Sizing (the first fill, as measured)

The full run read 9,600 documents for 1,253 companies in 68 minutes: 555 13D, 6,802 13G, and 2,243 not about the company (far more than the sample suggested: banks and asset managers file about what they hold). 1,190 companies have at least one.

## Sizing

A dry run over 25 companies read 109 documents in 0.8 minutes: 6 13D, 94 13G, 9 not about the company. Scaled, the first fill is about 5,500 documents and 40 minutes. Ongoing, it is the handful of new filings each company gets between re-reads.

Tests were a scratchpad Node suite (40 checks) plus dry runs against the live SEC. Neither surface was rendered in a browser by the build.

## The holder's name links to its holder page (2026-10-16)
The owner: "Under large holder, The holder name is not clickable". A 13D/13G row stores the holder's name but no id, so `holdersPayload` matches the name against the 13F managers on file (`holder_books`, kind `M`) through `holderIdFor(name)` in server.js. Both names are reduced by `holderKey`: lower case, no leading "The", no punctuation, no SEC `/XX/` tag, and no trailing legal suffix (`HOLDER_SUFFIX`: Inc, Corp, Corporation, Ltd, Limited, LP, LLC, PLC and so on). **Exactly one** manager with the same key gives `holderId`; none, or two, gives null, and the name stays text. The lookup is one indexed prefix read per distinct name, on the first two words as written (the first alone when the second is a suffix: "NVIDIA Corporation" is filed as "NVIDIA CORP"). It is memoised for six hours per instance, and a failed lookup is a name without a link. The page links through `holderLink('M', id, name)`, the same helper as the 13F and fund tables, so guests see text.

Measured on 27 real holder names across 15 stocks: 12 linked, every one the right firm (Goldman Sachs Group, NVIDIA, BlackRock, FMR, Morgan Stanley, JPMorgan, Jane Street and others). Left as text: individuals, small vehicles with no 13F, "Orbis Investment Management Limited" (the Orbis on file is Orbis Allan Gray Ltd, another entity), and "The Vanguard Group", which no longer files a 13F of its own; its 2026 filings come from Vanguard Capital Management and Vanguard Portfolio Management. A name the SEC files reversed ("PRICE T ROWE ASSOCIATES INC") does not match, by design: no guess.

## Next-day freshness (2026-10-20, `secdaily.js`)
The owner asked when the 13D filings were last refreshed. The answer was the weekly rotation: each company's filing list is re-read once every seven days, so a new 13D, 13G or 8-K could take up to a week to appear. (That morning it was also bunched: a full re-read on 2026-10-19 had reset every company's clock together.) They chose: "focus on the next-day freshness for 13D/13G and 8-Ks".

- **The SEC's daily index.** Each business day the SEC publishes `daily-index/YYYY/QTRn/master.YYYYMMDD.idx`, one file (about 0.3MB) listing every filing that day by CIK and form. **A 13D or 13G is listed under the company it is about as well as under its filer** (checked on 2026-10-19: Pzena's 13G on Universal Health appears under 352915), which is what makes matching on our companies work.
- **The step** (`SecDaily.step`, every input handed in so it is tested with no network or database): read up to two index days since the last one read (`app_meta` `sec_daily`: `through`, the queue as `[symbol, cik]`, a 14-day log); keep the `8-K`, `8-K/A`, `SCHEDULE 13D/13G(/A)` lines (and the old `SC 13D/G`) whose CIK is a tracked company; queue those companies; then re-read up to six a call. **The re-read is `secDailyOne`**: the submissions file only, then `secListReaders`, the 8-K and 13D/13G readers now shared with the rotation (`secFetchOne` calls the same function). It does not touch the statements (companyfacts) or `sec_state`, so the weekly rotation is unchanged and still reaches every company.
- **Days:** business days only, never today (an index is published that night). A missing index more than three days back is a holiday and is stepped over; a recent one is "not published yet", and the run stops and leaves the day for the next run. A first run starts four business days back.
- **Throttling:** a 429 on the index or a company stops the call with the queue kept, and reports `done`, so the nightly does not keep calling into it. A company whose list fails leaves the queue (the rotation still reaches it).
- **Route** `POST /api/sec/daily` (cron secret or admin, needs `SEC_UA`). **Nightly:** `secDaily()` in `nightly-ping.js`, the `sec daily` phase straight after `sec`, looping up to `SEC_DAILY_MAX_CALLS` (25) with the SEC gap between calls. It logs one line ("sec daily through 2026-10-19 -- 2026-10-19 (14 co.); 14 filing list(s) re-read"). Non-fatal; a 404 is an older server. The morning run picks up the previous day's filings. The screener's "Last 8-K" and "5% filing" columns follow within the six-hour flows rebuild; the stock page reads the tables directly.
- **Writes nothing destructive:** `writeSecEvents` and `writeSecHolders` upsert, and a 13D/13G document is still fetched once only (`readSecHolderAccns`).

Tested in `secdaily-test.js` (50 checks):
- dates across weekends, the new year and New York's midnight;
- index addresses and parsing;
- matching, with two share classes on one CIK and retired symbols left out;
- the step over an excerpt of the real 2026-10-19 index: a normal morning, a queue spanning calls, the first run, not yet published, a holiday, throttling on the index and on a company, a network failure, a failed company, and a symbol with no CIK.

The not-yet rule and the stop-on-throttle rule were proven by reverting each (3 and 1 failures). One real index was read from the SEC to confirm the format (376 relevant lines that day, 198 of them 8-Ks).

## The Filings page and the /edgar card (2026-10-20)
The owner asked: "Is there a web page talking about all these filings". There was none across the market, only one company at a time on its stock page, the screener's newest-of-each columns and the Filed yesterday card. They said: "do both".

- **`/filings`** (`private/filings.html`, members: a stranger goes to sign in, a guest back to the screener, and `/api/filings` answers a guest 403). Linked as **SEC filings** in the screener's account menu (`filingsLink`, hidden for guests with Research and Paper positions) and from `/help`.
  - **What it shows:** one business day: the 5% holders table (company, holder, form with "amended", stake, sec.gov link) and the 8-K table (company, each item as a chip with its full title on hover, amber for `Events8k.NOTABLE`, sec.gov link). Every row links to `/stock/<SYM>`.
  - **Controls:** the recent days as chips, with arrows stepping a business day (back to 45 days, never today); All / 13D / 13G / 8-K; Notable 8-Ks only; S&P 500 or Nasdaq 100; sector; and a search over ticker, company and holder. The day and form stay in the address.
  - **Order:** the card's: 13D first, notable first, larger companies first.
- **One payload for card and page.** `filedDayPayload(date, guest, withCompanies)` now also returns each filing's sec.gov address (`Holders13.pageUrl` and `Events8k.url`, under the company's CIK from `filerIds`; both kinds checked to open) and each 8-K's items (`Events8k.detail`, 9.01 left out). With `withCompanies` (the page only) it names each company from the in-memory snapshot, stamped with the index flags (`stampSpMember`). `readSecHoldersSince` and `readSecEventsSince` return the filing number (and the 8-K's document); their other caller, `buildFlows`, ignores the extra fields.
- **`/edgar` card "Next-day 8-Ks and 13D/13G"**, straight after Company filings.
  - **Pill:** Current; "Behind: last read <day>" when the last day read is before the business day before today (`dailyExpect` from `/api/edgar-status`); "N companies waiting"; or "Not run yet".
  - **Facts:** last day read, the newest it could read, the last run, companies waiting, and the last seven days read (companies re-read, filings by kind).
  - **Run now** loops `/api/sec/daily` to done, the nightly's own loop (`runDaily`), with Stop and a link to the Filings page.

Tested:
- `/filings` over payloads built by the server's own `filedDayPayload` from the live tables for 2026-10-19 and 2026-10-15: 20 checks covering rows, counts, links (52 stock and 52 sec.gov, new tab), order, the four form tabs, search by holder and ticker, the S&P and sector cuts against the flags, the day chips and arrows, notable only (Oct 15: Fortune Brands' impairment), no stepping past yesterday, no sideways scroll at 390px, the light theme, and the refusal message.
- The `/edgar` card (10 checks): each pill, the facts, recent days newest first, Run now looping to done.
- The access rules lifted from `server.js` (7 checks), proven by removing the guest guard.

## One holder, from `/filings` (2026-10-21, owner: "make the holder column clickable on the filling page")
- On `/filings` each holder name is a button. It opens a panel listing every 13D/13G that holder filed about a tracked company, all days on file (`Holders13.KEEP_DAYS`, about 13 months), newest first, each row linking to the stock page and to sec.gov.
- `GET /api/filings/holder?name=` (members; guests refused, as the page is): `store.readSecHoldersBy(name)`, a seek on the new `idx_sec_holders_holder` index (`holder collate nocase`), so "PZENA INVESTMENT MANAGEMENT LLC" and "Pzena Investment Management LLC" are one holder. Spelling variants beyond case ("..., LLC" with a comma) are separate names. Joint filers' duplicates are one line per company, kind, day and stake, as on the day view.
- When the name matches exactly one 13F manager (`holderIdFor`, the stock page's matcher), the panel links that manager's book at `/holder/M/<id>`. Display only.

## The screener cell, compact (2026-10-25)

The owner: *"I don't need to see all these details right on the column, May be give an indicator there is some text and may be show the text on hover or click"*. The **5% filing** cell (`lastHolderCell`, `td.hd-c`) shows only the form (13D bold, as before) and the age, then a small `···` mark. The whole line is the tooltip; a click opens it in the screener's news panel (`openHolderPop`, reusing `#newsPop` and `placeNewsPop`): the holder, the form, the filed date, the stake, one line on what the form means, and a link to `/stock/<SYM>#hold`. A second click, a click elsewhere or Escape closes it. The server now passes the holder's name to 80 characters (`Holders13.label(..., 80)`, was 20) so the panel can show it whole; the hover card and `/stock` read the same longer label. The text filter still reads the full line.
