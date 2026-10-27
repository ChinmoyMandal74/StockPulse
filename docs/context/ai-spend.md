# AI spend (`/ai-spend`, admin)

The owner, 2026-10-27: "I don't need the API credits, what I need is the Anthropic API and that too only the $ amount ... Anthropic API is called from News as well as Earning release ... Link it to admin page."

- **Source:** the dollar figure each run records, nothing new stored. `news_tone_runs.spent` (written by `news-tone-load.js`) and `earnings_release_runs.spent` (written by `release-load.js`), read by `store.readAiSpendRuns(sinceMs)`. That is two seeks on the `started_at` indexes, capped at 8,000 rows each.
- **Route:** `GET /api/ai-spend` (requireAdmin) returns 400 days of runs. The page buckets them by Eastern day in the browser.
- **The page** (`private/ai-spend.html`, prefix `aw-`):
  - tiles for today, the last 7 days, this month and the last 30 days, each split by job;
  - a stacked bar a day over 30 days, 90 days or a year (Article tone in accent, Earnings releases in orange);
  - a month table with an all-on-record total;
  - the latest 60 runs, flagging a failed run or one that reached its cost cap.
- **Linked from** the admin console, below Refresh runs.
- **Not counted**, and the page says so:
  - `release-history-load.js` (the one-off backfill prints its spend but writes no run row);
  - the Company summary writer and the chatbot in `server.js`;
  - the tone job's shadow model (`shadowSpent` is not in the run row; shadow off since 2026-10-20).
- Run logging began 2026-10-20 (tone) and 2026-10-22 (releases); there is nothing earlier.
- Test: scratchpad `aispend-test.js`, 12 checks plus 3 locked-mode checks (signed out and guest are refused). It covers:
  - the tile, month and total sums from known rows;
  - the bars drawn;
  - the 90-day chip;
  - the runs table;
  - no sideways scroll at phone width;
  - the admin console door.
