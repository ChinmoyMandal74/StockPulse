# Private-company briefs: how one is made

The owner asks for a brief on a private company by name ("Can you do
similar HTML for another private held company called ..."). Three were
made on 2026-11-08 to 10: Continental Electrical Construction, CITCO Water
and Bremer Whyte Brown & O'Meara. This is the recipe they settled into. The
builders are one-off scripts in the session scratchpad, not in the repo; the
data steps they call are.

## Rules for every brief

- **Dark navy** (the social-chart palette), whatever the system theme.
- **Private: not for distribution**, said at the top.
- **No source named.** Say "its filings", "its retirement plan", "its
  payroll loan", "its own website", "the latest news". No form names, data
  providers, news services, AI models or URLs in the brief itself. The URLs
  go to the owner in the reply, not into the page.
- **No buy or sell wording, no price target.** A range is a range, built
  from stated inputs, with its assumptions beside it.
- **Every claim checkable.** A figure from a filing names the year; a quote
  is word for word; an estimate says how it was made.
- **Charts pre-rendered** before sending (see Delivery). The iPhone
  attachment preview runs no JavaScript, so a script-drawn chart shows as an
  empty box.

## Finding the company

- The local viewer (`formd-view.js`, Employers page) or a query on
  `f5500_latest` / `f5500_names` in the LOCAL `formd.db`, by name.
- **Check the tax ID across years.** A holding company may have taken over
  the plan, as FourGen Holdings did from Continental in 2019. The legal name
  may not be the brand: CITCO Water files as The C. I. Thornburg Co. If no
  match, ask the owner for the city or another name rather than guess (DM
  Law found nothing).

## The sections, in order

1. **What its own filings show.** Retirement-plan participants and active
   members by year, plan assets; the PPP loan (jobs, amount, implied payroll
   = loan ÷ 2.5 × 12); SBA loans and federal contracts if any (the fact
   sheet, `factsheet.js`, shows them all).
   - **A headcount-based revenue range:** people × listed peers' revenue per
     employee (lower quarter, median, upper quarter), with the caveat
     beside it.
   - **A plan count is a floor.** Union crews sit in their union's funds,
     and an acquired company's staff can stay in their own plan for a time.
2. **In its own words: what its website says** (since 2026-11-10).
   - `website-load.js --commit --ein <tax ID>` finds and reads the site.
     When the guess misses, the owner gives the address:
     `--ein <tax ID> --url <domain>`. That is how CITCO (`citcowater.com`)
     and Continental (`cecco.com`) were read.
   - The read is in `web_reads`; every phrase was checked against the
     pages (see `company-websites.md`).
   - Show what it does, founding, size as stated, history, services,
     markets, places, people named, customers named and hiring.
   - Then a short **"What it adds to this brief"**: where the site agrees
     or disagrees with section 01. Continental's own "300 field electricians
     and 80 office employees" halved the brief's 2024 headcount estimate.
3. **The latest news** (since 2026-11-10; the method is below).
4. **The private field.** Every employer with the same industry code from
   the plan filings: count, size buckets, growth, the largest in its states,
   its rank.
5. **The listed peers today,** from the app's snapshot. Then the range from
   the buyer's own figures (a calculator), the multiples against their own
   history, margins through a cycle, the last downturn, demand from the
   peers' results releases, who is buying and what was disclosed, the ways
   out, what Tickr Lab can do next, and **what it cannot tell you**.

6. **The industry in Tickr Lab's data** (since 2026-11-10, owner: "like
   the fire and safety work ... only use data from my app"). Placed before
   "Ways out". It treats the listed peer group as one: Fire & Safety's deep
   dive, as a section. **App data only:**
   - **Prices:** the local research copy's daily bars (`analysis.db`). One
     equal-weight line since the end of 2015, chain-linked so a member
     counts from its first close. The 1, 3, 5 and 10-year returns against
     SPY, the worst fall from a high, and year by year (members that
     traded the whole year).
   - **How they move together:** the correlation of daily returns over the
     year, as the average pair, the closest pair, the member least like the
     rest, and the typical member against SPY.
   - **Per company** (per-symbol reads of the app's database):
     - the session after each results release since July 2024, from the
       stored release dates;
     - days to cover and the change in shorted shares over a year;
     - open-market insider buys and sells in twelve months;
     - article tone;
     - institutions holding, with the quarter's change.
   - **What it says for this brief,** in plain words, tying it to the
     other sections.
   - **Checks learned on the first three:**
     - A company buying a stake is not insider buying: Mitsui Sumitomo's
       $705M of W. R. Berkley is shown apart, as a 10% owner.
     - A split must not show as a crash: the stored bars are
       split-adjusted (IES split two-for-one in August 2026).
     - Section 01's form names stay out: "institutions holding", not the
       form.
     - Charts are SVG written by the builder (no script needed), with a
       minimum width and a sideways scroll inside their box on a phone.

Section numbers are referred to in the text ("section 01"). When a section
is added, renumber the headings **and every reference**, and update the date
line ("prepared ..., sections 02 and 03 added ...").

## The latest news: how it is gathered

This is done by hand in a Claude session with web search. The app's own
news feed covers listed companies only.

1. **Search,** once or twice a company: `"<brand name>" news <year>`,
   and the legal or holding-company name when it differs ("FourGen
   Holdings"). Also the owner or parent if one appears (a private-equity
   firm).
2. **Open the primary source behind every item before using it.** The
   search summary is not a source. In order of preference:
   - the company's own release (its website or a PDF on it; a PDF the
     fetch tool cannot read can be inflated and its text pulled out
     locally);
   - the counterparty's announcement (the buyer, the seller, the adviser);
   - the company's own news page, already saved by the website loader
     (`web-archive.db`, `kind = 'news'`).
3. **Leave out** the estimate and profile sites (PitchBook, ZoomInfo,
   Tracxn, LeadIQ and the like). Their headcounts, revenue estimates and
   deal dates cannot be checked and conflicted with the companies' own
   words for CITCO.
4. **Mark what could not be opened.** A site that refuses automated reading
   (the newswires answer 403) is used only for what its address shows, and
   the item says "as reported". An undated page is dated by month, and the
   reply says how.
5. **Write each item** as date, what happened, with the company's own words
   in quotation marks. Newest first. Then **"What it changes in this
   brief"**: confirm or correct the earlier sections in so many words.
   - Do not present as new what the filings already showed: the CITCO brief
     already had Trivest from its filings.
   - Say when nothing was found ("no outside coverage this year").
6. **In the reply to the owner,** list every URL used, and say what was
   left out and why.

What the news has changed so far:
- **CITCO:** a fifth acquisition and a private-equity owner, so a sale
  involves an investor as well as the family.
- **Continental:** FourGen holds three businesses, so its plan and loan
  overstate Continental alone.

## Delivery

1. **Bake the charts in.** Run each page once in headless Chrome and keep
   what it renders:
   `chrome --headless=new --virtual-time-budget=5000 --dump-dom file:///<page>`.
   The output already starts with its doctype. Keep the script when the
   page has a calculator, after checking that a second render gives the
   same output (no doubled charts).
2. **Look at it** at desktop width and at 390px. Headless Chrome will not
   go below about 500px, so render the page inside a 390px iframe for the
   phone view. Also check a copy with the scripts stripped (the iPhone's
   view).
3. **Email the owner's admin address** through Resend with `logMail` kind
   `note`: a one-off script, a summary in the body, the briefs attached.
   Also send the files to the owner's device when the session can.
4. **A corrected copy says it replaces the earlier one,** and what changed.
