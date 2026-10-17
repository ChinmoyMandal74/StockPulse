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

**"Verdict" became "signal" in everything a reader sees** (2026-10-11, the owner: "verdict should be replaced with signal"). 69 places: the cards (16), the screener's tooltips and messages (14), help (14), about (7), landing (5), four error messages from the server, and single lines on the stock, login, onboarding, phone setup, compare, group, pivot and studio pages.

- **Text only.** Identifiers, comments, CSS classes (`.verdict`, `sc-verdict`, `r-verdict`) and the stored alert type id `verdict` are unchanged; a stored key is never renamed. Internal notes, including this folder, still say verdict.
- Two places where the word did not mean the Signal were reworded instead: help's "the same verdict the whole ladder gets" is now "finding", and about's "decline to give a buy, sell or hold verdict of its own" is now "decline to give a recommendation of its own", which also takes the trading words off that page.
- **Left as verdict**: the chatbot's system prompt, where it means a recommendation the assistant must not give, and the admin-only pages (refresh runs, where a "verdict" is a night's outcome; the backtests).

**Not done, and worth a decision**: the tagline "From data to decisions" on every card's masthead. It predates the rename to Signal; changing it touches every card.

Every slide was built on all three artboards in a Node suite (128 checks). None was rendered in a browser, so text fit on the changed slides is unverified; the new copy was kept to the length of the lines it sits among.

## The landing page and About, reviewed the same day

The owner: "review the main website and update it". `private/landing.html`, read against the code.

- **A new section, "Beyond the price"**, three cards for what was added that week: the filings and margins, corrections and drawdowns, and events with large holders, insiders and short interest.
- **"85 columns" was stale in two places** while the strip above it read the live count. Both now carry `class="colN"` and are filled from `/api/about-stats` (`columnCatalogue().length`) by the same script; the shipped fallback reads "100+".
- "the caution rules sit above every buy rule" became "every Strong rule".
- "Seven framings have come back flat" became eleven tried, ten flat. About said six, naming them; it now says eleven, "among them" the six it names, ten flat. The cards, the landing page and About had three different counts.
- The data FAQ now names the SEC, FINRA and the European Central Bank beside Twelve Data. The guest FAQ says an invite code can be asked for. The filings card says they are re-read about weekly.
- "a personal project" became "an independent project". The owner now operates through a company; the page claims nothing more specific than that.

Left alone: the hero, the example table (its `v-buy` / `v-hold` are class names, not text), the "4:15pm ET" strip figure, and the tagline, which is still the owner's call.

## Showcase (2026-10-17)
The owner, over an Investor's Business Daily Story ad (its site in a laptop and a phone, "What's the next game-changing AI stock?", "Try 2 months for $20!", a Get offer button): "How can I make promotional photos like this", then "Go ahead". **Brand > Showcase** (`showcase`, `tplShowcase`, owner-only with Announcement and Race chart, so hidden from members as all Brand views are). A headline (`shwHead`, default "Every stock, measured the same way after every close."), a line under it (`shwSub`, empty gives the count of US-listed companies), and a laptop and a phone drawn in CSS, **filled from the day's rows, not screenshots**: the laptop a small screener of the largest companies by market value (price, today, YTD, off high, value), the phone one stock (`shwSym`, NVDA by default) with six months of closes through the getHistory channel (`showcaseNeed`, asked by `/api/m/post` beside the bands card) and four figures. At 9:16 the phone sits under the laptop beside three facts (the data set count from `COV_DATA`, prices to 1998, the SEC sources).
What the ad did that this does not, on purpose: no picks headline (the hint says so), **no Signal words on the screens** (a verdict travels with its rule, and a thumbnail has no room for it), rows in a neutral order (market value), green and red only for price moves, **no offer and no button** (there is no price to quote; Instagram's own link sticker is the link).
**More than one picture (same day).** The owner: "Can we make different such visualizations... showing different data and may be different styles". Five controls on Showcase: **Style** (`shwStyle`: a laptop and a phone, one browser window with a `tickrlab.com` bar, or two phones), **the big screen** (`shwLap`: the screener; a heat map of the largest, tiles tinted green or red by the move; the sectors as diverging bars of the **median** company, so one giant cannot carry its sector), **measured over** (`shwWin`: today, the past month, this year; heat map and sectors only), **the phone** (`shwPh`: one stock and six months; one stock's ratios, a dash for a missing or loss-making multiple; who reports next among the 100 largest, `est.` marking our estimated dates with a line saying what that means) and **backdrop** (`shwBg`: plain, or linked dots from a fixed seed, faint and kept to the top). With two phones the second shows the big screen narrowed (fewer columns, four-wide heat map). Every screen is still drawn from the day's rows.
