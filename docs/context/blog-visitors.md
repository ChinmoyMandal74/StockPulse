# Blog visitors (`/blog-visitors`, admin)

Built 2026-11-03 at the owner's request: "Create a page to understand blog visitors, Ignore admin and Meta crawlers".

## Where the numbers come from
- **Source:** the `activity` table's blog rows: kind `page`, with detail `blog` (the index) or `post:<slug>`. Written by the `/blog` and `/blog/:slug` routes through `logAct`.
- **Rate cap:** anonymous rows are capped by `anonLogOk` at 60 per address per 10 minutes.
- **Retention:** the table is pruned to about 60 days, so the page covers that window. Nothing new is stored, so `/privacy` needs no change.
- **What a row holds:** time, account key, IP address. No user agent, no referrer.

## Code
- **`db.js` `readBlogVisitLog()`:** returns the blog rows, the admin accounts' emails, and every distinct IP those accounts (and the `admin`/`open` password-cookie keys) have used anywhere in the log.
  - It is a whole-table read of a bounded table, allowed in `query-plan-test.js` alongside the `/activity` rollups.
- **`blogvisits.js` `summarize()`:** pure. Tested in `blogvisits-test.js`.
- **Routes:**
  - `/blog-visitors`: the page. Admins only; everyone else is redirected to `/`.
  - `/api/blog-visitors`: the data. Uses `requireAdmin`.
  - `/blog-visitors.html` is in `GATED_PAGES`.
- **Page:** `private/blog-visitors.html`. It is linked from the admin console under the activity log.

## What is left out
Views are removed in this order, and each count is shown in the "Left out" tile:
1. **Admin account:** any view by an admin account, including the `admin` and `open` keys.
2. **Admin address:** any view from an address an admin account has used.
   - On the first count, 164 of the owner's views were signed out but came from the owner's own addresses (21 of them).
3. **Meta:** any view from Meta's network, checked against `META_V4` (AS32934 IPv4 ranges) and `META_V6` prefixes.
   - These are Instagram and Facebook fetching a post when its link is shared. There were 118 on the first count, mostly on Oct 31.
4. **Sweeps:** any address that opened `SWEEP_POSTS` (5) or more *different posts* within `SWEEP_MS` (10 minutes). All of that address's views are dropped.
   - **Why this was added:** the deleted test posts each showed about 30 "visitors", in nearly equal counts. The addresses were crawlers opening every post within a minute: Google 66.249.x, Anthropic 216.73.216.x, OpenAI 74.7.x, plus AWS, Tencent, OVH and Hetzner hosts.
   - The first count dropped 12 addresses and 125 views.

**Slower crawlers are still counted.** Googlebot crawling over weeks, or 216.73.216.x crawling over a day, cannot be told apart without a user agent, and the page says so.

## A visitor
A visitor is an IP address.
- **Came back:** the address was seen on two or more Eastern days.
- **New on a day:** the day is the address's first kept view.

## Pages table
- **Order:** the index first, then published posts, then unpublished posts, then deleted ones (`status` `gone`: a slug with views but no row in `posts`).
- **Each page shows:** visitors, views, visitors in the last 7 days, first read, last read.
- **Titles:** come from every post, published or not.

## Ideas not done
- Store a bot flag and the referring host on blog views. That would show where readers come from and drop other crawlers. It would need a `/privacy` line.
