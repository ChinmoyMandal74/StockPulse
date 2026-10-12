# Insider transactions, summarised (2026-10-12)

The owner: "can you summarize the insider transactions on individual stock page and promo". The stock page listed up to sixty trades under one line of totals; a company whose officers sell every week was sixty rows of the same thing, and there was no promo card at all. The underlying data, its loaders and the daily top-up are unchanged and are described in `sec-edgar.md`.

## Where things live

- `insider.js`: `digest(rows, today, cap)` and `tidyName`, beside the existing `summarise`.
- `server.js`: `insiderPayload(symbol)`, now the one function behind `GET /api/insider` and the saved-post route. It reads the newest `INSIDER_DIGEST_ROWS` (500) trades for the digest and still sends the newest sixty as `rows`. The response gained `digest`; nothing was removed.

## What the digest is

- **Three windows by FILED date**: 90, 180 and 365 days. Each has bought and sold (dollars, people, trades), net, and `plannedShare`: of the dollars sold, how much was under a 10b5-1 plan.
- **By person**, per window: bought, sold, net, trades, whether every trade was planned, the last filing date and the shares held after the newest trade. Largest net first, ten at most, with the count of everyone.
- **Twelve calendar months** ending with the current one: dollars and distinct people on each side.
- **The largest single trade** of the year.

## Rules that must hold

- **The same filter as the rest of the insider data**: open-market purchases and sales only (codes P and S). Grants, option exercises and tax withholding never reach it.
- **People are counted as well as trades**, by owner CIK, falling back to the name.
- **Net is of the trades that carry a price.** One without a price counts as a trade and adds no dollars. No priced trade: net is null. No priced sale: `plannedShare` is null, never zero.
- **A capped read can make a window partial.** Where 500 rows were returned and the oldest is newer than a window's start, that window is `partial` and both surfaces say the start of the period may be incomplete. Measured: Nvidia's 500 newest trades reach back fourteen months, so in practice no window is partial.
- **A total of sales is always shown with what qualifies it**: the share under a plan, and a sentence that people paid in stock sell regularly, for tax and to spread their savings. No surface draws a conclusion from the totals.
- **Names** as filed are in capitals, surname first. They are set in name case and the order is left alone.
- **Display only.** The screener's Insider net column is a separate, older reading and is unchanged.

## Surfaces

- **Stock page**, section `#ins`: above the list, "Added up" (a row a window), "Month by month" (two bars a month) and "By person, last 12 months". The list of every trade stays below. The digest's amounts are in the accent and orange; green and red remain only on the Bought/Sold word in the list, as before.
- **Promo**: card `insiders`, "Insider activity", in Stock spotlight. Controls `inSym` and `inWin` (12, 6 or 3 months). Four figures (bought, sold, net, sold under a plan) and a row a person with a two-part bar. A star marks someone whose every trade was planned. Through `ctx.getInsider`, asked by `Cards.insiderNeed`.

## Seen on real data

Nvidia, twelve months: nothing bought, $2.0B sold by 12 people, 24% of it under a plan; one director accounts for $1.5B. JPMorgan: $126M sold by 11 people, all of it under plans. Intel: its CEO bought $10.0M in August. A fund has no insiders and both surfaces say so or stay hidden.

Tests were a scratchpad Node suite (39 checks, including cards built from five companies' real payloads). Neither surface was rendered in a browser by the build.
