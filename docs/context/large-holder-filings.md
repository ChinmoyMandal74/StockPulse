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

## Sizing

A dry run over 25 companies read 109 documents in 0.8 minutes: 6 13D, 94 13G, 9 not about the company. Scaled, the first fill is about 5,500 documents and 40 minutes. Ongoing, it is the handful of new filings each company gets between re-reads.

Tests were a scratchpad Node suite (40 checks) plus dry runs against the live SEC. Neither surface was rendered in a browser by the build.
