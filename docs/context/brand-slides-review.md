# The Brand slides, reviewed (2026-10-11)

The owner: "revisit all the slides under brand and update anything if necessary, we have added a lot of new features". Every Intro and How-to slide, the Announcement, the Disclaimer and the Profile picture were read against the code. What changed, and why:

**Intro**

- *What Tickr Lab is*: the third of the five things read "Twenty years of receipts: trend ribbons, backtests and an indicator lab". `/backtest` is admin only, so the card promised members a page they cannot open. It is now "The filings and the drawdowns", which every member has on each stock's page.
- *How the Signal works*, the flow slide: the four questions read "May I own this at all? / Is now a sane moment? / How much conviction? / Any reason to wait?". That is advice phrasing on a card whose point is that this is not advice. Now "Is the trend intact? / Is the price stretched? / How sound is the business? / Any flag raised?".
- *What we don't do*: "No 'stocks to buy'" became "No stock picks" (the trading word, even in a refusal). "Eight research framings ... seven came back flat" became eleven and ten, the project's own count.
- *The close* (ends all four decks): now also says an invite code can be asked for on the sign-up form.

**How to**

- *Views*: "ninety-odd columns in twelve groups" became "more than a hundred columns in thirteen groups" (108 header cells, 13 banners on 2026-10-11). Deliberately not an exact count.
- *Reading the Signal*, step two: "May you · now · how much conviction · anything to wait for" reworded to match the flow slide.
- **Two new decks**, pushed onto `HOWTOS` after the literal: `drawdown` ("Corrections and drawdowns") and `margins` ("Margins, from the filings"), three slides each, audience `everyone`. They quote the screener's own headings (Drawdown, Corr. 5Y, Median recov., Profit margin, Margin chg); a test asserts those headings exist.

**Left alone, on purpose**

- **The Disclaimer.** Its words are `/terms`'s own, distilled, and the two must agree. Its "offer to buy or sell any security" is the legal sentence, not signal wording. Its data line still matches the terms page.
- **Announcement** (free text) and **Profile picture** (the mark).
- *Build your own lists*, *Themes*, *Screens* and *Alerts*: checked against the limits in code (ten views, five alerts) and still true.

**Not done, and worth a decision**: the tagline "From data to decisions" on every card's masthead, and "verdict" in several slides ("every verdict", "the whole table and every verdict"). Both predate the rename to Signal and were raised before; changing either touches every card.

Every slide was built on all three artboards in a Node suite (128 checks). None was rendered in a browser, so text fit on the changed slides is unverified; the new copy was kept to the length of the lines it sits among.
