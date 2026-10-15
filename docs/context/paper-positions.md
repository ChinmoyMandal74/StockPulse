## Paper positions — a pretend account per member (2026-10-15, owner's request)

The owner: *"Can we add mock trade feature"*, then *"go ahead"* on the proposal with its defaults: open and close (never buy and sell), $100,000 to start with a reset, dollar amounts allowed, members and admin only, the owner able to review.

### What it is
- **`/paper`**, members and admin (guests redirected; `/paper.html` redirects too). Reached from the screener menu (Paper positions) and a **Paper position** pill on each stock page (`/paper?open=SYM`, shown once `/api/me` says not a guest).
- Four totals (account value, return so far, the S&P 500 over the same days, cash), a form to open a position by dollars or shares, a chart of the account at each close against SPY bought with the same $100,000 on the start day, open positions with a Close row (part or all), closed trades, and **Start again** (confirmed; deletes the ledger, restarts today).
- **The wording rule holds**: a position is opened and closed; nothing says buy or sell. The page and the footer say it is a simulation with pretend money and not advice. The Signal on the day a position was opened is kept and shown, canonical words via `Action.canon`; the Signal reads nothing from here.

### How it works
- **A fill is the snapshot's price** with its `pricedAt` (the half-hourly intraday refresh, or the last close outside market hours). Nothing can be entered at a past price.
- **The ledger is the truth.** `paper_trades` is append-only, one row per open or close (`ts`, `kind`, `symbol`, `shares`, `price`, `priced_at`, `signal`, `note`), indexed `(user_key, id)`. `paper_accounts` holds `start_cash` and `started_at`. Everything else is worked out by **`paper.js`** (pure): `summarise` replays the ledger at **average cost** (a part-close takes its share of the cost; reopening after a full close starts a fresh average and open date), `sizeOpen` / `sizeClose` validate, `history` values the account at each SPY close from the start day, carrying a stock at its last close, trading days in New York time (`nyDay`).
- **Routes** (`requireMember`, keyed by `prefsKey`): `GET /api/paper` (summary, history, the picker list), `POST /api/paper/open` `{symbol, dollars | shares}`, `POST /api/paper/close` `{symbol, shares | all}`, `POST /api/paper/reset` `{confirm: true}`. Each write is one insert, never retried; reset is one batch. Activity log records `open:SYM`, `close:SYM`, `reset`, never amounts. Cap: 5,000 trades per account.
- **History reads** are one indexed seek per symbol ever held plus SPY, bounded to the days since the start (`readBars`, limit about three quarters of the calendar days); none past 1,500 days.
- **A stock that leaves the universe** stays in the account, valued at its last traded price and marked "no longer tracked"; closing it fills there and the closed row says why. `paper_trades` is deliberately **not** in `SYMBOL_TABLES`: removing a stock must not erase a member's history.
- **Account deletion** removes both tables' rows (`deleteUser`). `/privacy` lists paper positions under What you create, deletion, and what the owner can see.
- **Owner's review**: `/api/users` attaches a `paper` summary per account (value, return, cash, open symbols, closed count), shown as the **Paper** column on `/users` with the detail in the tooltip.

### Known limits (said on the page where it matters)
- Price only: no dividends, fees or tax. No short positions, options or margin.
- Two opens sent at the same instant could each pass the cash check; the button is disabled while a request is in flight, and it can only overspend the member's own pretend cash.
- The chart's last point is the latest stored close; the totals above it use the latest price, so they can differ intraday.

### Verified
- `paper-test.js`: 23 checks on the arithmetic (average cost, part-close, reopen, untracked, over-close, sizing refusals, null-is-not-zero, history rebasing, New York day).
- 25 checks against the **real server on an in-memory database** (`uni-boot.js` and `paper-e2e.js` in the session scratchpad): every route, the refusals (over cash, untracked symbol, under $1, no amount, over-close, closing nothing, reset unconfirmed), the old verdict word canonicalised at open, a stock leaving the universe, history, reset, the admin review, the page served.
- Drawn in headless Chrome from that server with the real snapshot rows: desktop and phone; zero returns print uncoloured.
