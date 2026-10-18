# Article tone (2026-10-18)

A model reads each article in a semiconductor stock's Yahoo Finance feed and stores what kind of article it is, whether it is about the company, how its content leans (−1 to +1), and a summary of up to two sentences in its own words. Shown to members (never guests) as an **Article tone** card on the stock page. Display only: nothing reaches the Signal.

The owner's words: "it cannot be based just on the headline, it has to be based on the content", then "do this news work only for the semiconductor industry" with promotional API credit. Model chosen by the owner: **Claude Sonnet 5.5**. Access chosen by the owner: **members**.

## Files
- `newstone.js`: pure. The feed parser, robots.txt rules, the article-text extractor, the "names the company" filter, the prompt and JSON schema, the checks on the answer, the label bands and the seven-day summary. `newstone-test.js` (68 checks, no network).
- `news-tone-load.js`: LOCAL, from the owner's machine. Reads the 53 stocks' feeds, fetches each article once per run, asks the model, writes `news_tone`. Dry run by default (5 articles, still calls the model); `--commit` to write; `--days`, `--only`, `--limit`, `--max-usd` (default 8).
- `db.js`: `news_tone` table and `readNewsToneList` / `readNewsToneSince` / `readNewsToneKnown` / `writeNewsTone`. In `SYMBOL_TABLES` and on the query-plan test's big-table list.
- `server.js`: `GET /api/news/tone?symbol=` (`requireMember`): `{items, more, week}`. Stored rows only, so a page view never calls the model.
- `private/stock.html`: the `#tone` card, hidden until the route returns something.

## Decisions worth keeping
- **NOT THE STORED GOOGLE HEADLINES.** Their links are Google redirects, and `news.google.com/robots.txt` disallows every path but the home page to every agent and bans Anthropic's crawlers by name. Resolving them by program (it works: 51 of 51 decoded in a test) would break the robots rule the loader keeps. Yahoo's per-ticker RSS links straight to the publisher and is meant to be read by programs.
- **Measured before building, 2026-10-18:** the 53 stocks' feeds held about 390 distinct articles from the past week. On a 45-article sample robots.txt allowed 41 and 35 gave usable text. Yahoo pages need `--max-http-header-size` raised (the loader relaunches itself with it); Investing.com and Barchart refuse or challenge.
- **The feeds are loose.** NVDA's carried Motley Fool pieces on NASA, CRISPR and Virgin Galactic. `namesCompany` skips any page that never names the ticker or the first word (four letters or more) of the name, before the model is asked; the model's `about` field catches the rest. Off-topic and skipped rows are kept as bookkeeping and never shown.
- **Polite fetching:** one request at a time, 3 seconds between requests to the same site, robots.txt obeyed (our group if a site names TickrLab, else `*`), an honest user agent (`TickrLab/1.0; +https://www.tickrlab.com`). 401/403/451 and robots refusals are recorded `unreadable` and never retried; network faults and 5xx are `failed` and retried after 6 hours, at most 3 attempts.
- **THE ROBOTS `$` BUG, caught by the test:** "Allow: /$" means the home page only. Reading it as a prefix allowed every path on a site that says `Disallow: /`. Rules are regexes now (`*` anything, trailing `$` anchors).
- **What is stored:** the reading, the headline, the publisher, the address, the character count read. Never the article text.
- **Wording:** the prompt forbids buy, sell, hold, bullish, bearish, outperform, underperform, overweight, underweight and repeating ratings or price targets. `check()` refuses those words in a summary (base words only, so "buyback", "holdings" and "selling a unit" pass). A refused answer is asked once more with the reason; if the summary still fails, the tone is kept and the summary withheld.
- **Null is not zero:** an unread or off-topic article has no tone and is not counted; the seven-day line is null when nothing was read.
- **Colours:** blue for Positive, orange for Negative, plain for Neutral. Green and red mean price moves.
- **A scored row is final:** `writeNewsTone` updates only rows whose status is not `scored`.
- **Cost:** about $0.009 an article with Sonnet 5.5 at low effort (first dry runs). Roughly $3–4 a week for all 53 stocks.

## Running it
```
node news-tone-load.js --commit                # last 7 days, newest first, stops at $8
node news-tone-load.js --commit --only NVDA    # one stock
```
Scheduling is `news-tone-task.ps1` (Windows Task Scheduler, every six hours: 00:30, 06:30, 12:30, 18:30 local, each ending before the 07:30 and 19:30 nightly; owner, 2026-10-18). Yahoo's feed holds only the latest ~20 items per stock (NVDA's spanned under three hours, ACLS's six weeks), so a daily read missed most of the busy stocks. Each run reads only unseen articles.

## The promo cards (2026-10-18, owner: "Can you create a promo card")
Two templates in `private/cards.js`, sharing one data path:
- **`indtone`, Industry → Article tone.** One row per semiconductor stock: the stocks with the most articles in the window (control `itnCount`, 8/12/16, capped at 10 on a square), ordered by their average, each bar drawn left or right of a zero line on a scale rounded up to 0.25 (at least ±0.50). Four figures: articles read, average tone, positive, negative. Controls `itnGroup` (both industries, or one) and `itnWin` (7 or 30 days). Data: `GET /api/news/tone/board?group=&days=` (`requireMember`), built by `toneBoardPayload`: one seek per stock, ten at a time.
- **`tonestock`, Stock spotlight → Article tone.** One stock's seven-day figures and its latest articles (3 on 4:5, 2 square, 5 on 9:16): chip, headline, the model's summary (clamped to three lines, the headline to two), date, publisher and kind. Control `tnsSym`. Data: `toneStockPayload`, which `/api/news/tone` also uses.
- Both hosts fetch through `Cards.toneBoardNeed` / `Cards.toneStockNeed`: the studio's `getToneBoard` / `getToneStock`, and the saved-post builder.
- **A HEADLINE SAYING BUY IS PASSED OVER on the stock card.** Headlines are the publisher's words; a card is the site's marketing. NVDA's first draft carried "Should You Buy an Index Fund Now?". The card skips any article whose headline or summary uses buy, sell, hold, bullish, bearish and the rating words, and takes the next one.
- `TONE_BAND` is restated in `cards.js` (no requires; the phone does not load `newstone.js`). `newstone-test.js` asserts it equals `NewsTone.BAND`, and draws the real card at every hundredth from −1 to +1 to check the chip's label matches `label()`.
- Measured in headless Chrome with the real readings: 4:5, square and 9:16, 8/12/16 rows and three stocks each. No overflow, nothing outside the artboard, no green or red, no banned word.
