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
