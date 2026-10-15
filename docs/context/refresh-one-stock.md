# Refresh one stock, now (2026-10-12)

The owner: "an option for admin to refresh both price and fundamental" for one stock, with "no need of giving options". Every other refresh works through the universe, so a company that reported an hour ago waited for its turn in the rotation.

## What it is

- `POST /api/admin/refresh-stock?symbol=<SYM>` (`requireAdmin`), and a **Refresh** button in the stock page's masthead beside the price (moved off the chart toolbar on 2026-10-15, owner's request), shown only to the admin.
- One action, three steps, each the path a full refresh already takes:
  1. **Fundamentals**: `ensureProfiles([symbol], 1, true)`. The third argument forces a pull past the one-day age. About 80 credits.
  2. **Price**: a shallow pull, and a deep one if the shallow window does not reach back to what the archive holds (the price sweep's own guard, so twelve bars can never replace years). 1 credit.
  3. **The screen**: `computeStocks(null, { archivePrices: true, noProfiles: true })`, then `finishLiveRefresh`, which is how a plain Refresh saves the snapshot.
- It answers with what came back for each half (`fundamentals`, `price`: `refreshed` or `refused`) and `ok` only when both did. The button says the same and reloads the page.

## Rules that must hold

- **Step 3 reads the whole archive window.** A row is scored against the others (ranks, peers, relative strength), so one row cannot honestly be rebuilt alone. That is one ordinary round's worth of rows read, per click: fine by hand, not something to loop.
- **It stands aside for a running refresh** (`standAside`), before anything is spent. It sets no flag of its own, so a scheduled job starting in the same minute is not told to wait for it; the last snapshot written wins, and both are built from the same archive.
- **A refused pull changes nothing.** `ensureProfiles` keeps the cached values and leaves the stamp stale; no bar is written from a refused price. The response says which half was refused.
- **The shared engine is unchanged for every other caller.** Forcing is opt-in (the third argument). A cap of 0 still means the default batch, as the rounds rely on: the first draft changed that and was corrected before it shipped, because `liveRefreshOpts` computes a cap that can come out 0. Pulling no profiles is `computeStocks`' own `noProfiles` option.
- **No fundamentals history row is written**: `finishLiveRefresh` records the day's fundamentals only during a Refresh all, and that gate was left alone.
- **Not the SEC filings.** The owner set those aside; they keep their own rotation (and `sec-reread.js`).
- The provider's per-minute limit still applies whatever the plan: one stock is about 82 credits, far under it, but pressing it for many stocks in a minute would be refused, and says so.

## Not run end to end by the build

The route needs an admin session and spends credits against production, so it was not pressed. What was checked: the wiring and guards (a scratchpad suite, 19 checks, including the stale filter with and without forcing), that the server boots, and that a signed-out caller is refused. The first real press is the owner's.
