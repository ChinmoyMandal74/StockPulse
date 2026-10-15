## The research page — every backtest, written up for members (2026-10-15, owner's request)

**`/research`, members and admin, never guests.** Asked as: *"I want to run a lot of these kind of back tests, I want all these to be properly documented so that these can be shared with users of the system ... like a backlog page but smart enough where ideas can be reviewed and filtered ... separate column on what was done, what was the outcome, what are the recommendations".* Linked from the screener's menu (Research, under Help), hidden on the guest preview.

### The markdown file is the data
**`docs/research.md` is the register; the page is a reading of it**, the bargain `/backlog` struck: an entry is added or changed by editing the file and pushing. Each entry is:

    ## 14. The title — 2026-10-15

    *Family: Mean reversion · Verdict: One period only · Horizon: 1 month · Data: Daily prices · Sample: 658 events ...*

    ### The idea
    ### What was done
    ### Outcome
    ### What follows
    ### Caveats      (optional)
    ### Numbers      (optional; pipe tables are drawn)

- **Verdicts** are a fixed six: Weak lead · One period only · No edge · Wrong way · Used for display · Not yet tested. A seventh word shows as written, never turned into one of these.
- **The file's preamble** (everything above entry 1) is shown as "How every test is judged": against the average stock, each period on its own, events counted once, median beside mean, and the survivorship caveat. Write an entry assuming the reader has read it.
- **The template sits in an HTML comment in the file**, which the parser strips.
- **Every backtest run in a session gets an entry**, in the same commit as anything it changes. The research log (`does-any-of-this-predict-anything.md`) stays the place for method lessons aimed at the next session; this file is the record members read.

### Wording
**"What follows", not "Recommendations".** The owner asked for a recommendations column, and on a members' page that word reads as advice to trade, which the site never gives. The column says what the product does with the result (not used, shown as a reading, the next study worth running). `research-test.js` fails any entry containing buy, sell or hold, or a retired Signal word; the old tier names in the research log are translated (Strong Buy to Very Strong, Buy to Strong, Sell Immediately to Very Weak). Describe a backtest's mechanics as "entered at the next close" and "a holding period", not "bought".

### How it is read
- **`research.js`** is the parser (pure). It reuses `backlog.js`'s heading, table, summary and markdown-mark helpers, now exported, so the two registers cannot read a heading two ways. `parse(md, render)` returns `{ entries, introHtml, verdicts }`; each entry has `n`, `title`, `date`, `verdict`, `family`, `horizon`, `data`, `sample`, `filed`, the four section summaries (`idea`, `done`, `outcome`, `follows`), `missing`, `hasCaveats`, `hasNumbers` and `html`.
- **`GET /api/research`** (`requireMember`), cached ten minutes; `?fresh=1` re-reads, for admins only. **`docText(name)`** in server.js is the one reader for both registers: the bundled `docs/` file, else the public repository's main branch.
- `/research.html` redirects to `/research` (`GATED_PAGES`).

### The page
- Six verdict counts that are also the verdict filter; a search over every field and the full text, with hits marked; Family, Horizon and Data pickers built from the entries; Clear filters.
- Columns: #, The idea (title, summary, family and horizon tags), What was done, Outcome, What follows, Verdict, Date. Newest first; # and Date and Verdict sort.
- A row opens in place: Horizon, Data and Sample, then the whole entry. `/research#14` opens entry 14; "Link to this entry" copies it.
- Verdict colours avoid green and red (price direction on this site): cyan, amber, grey, orange, violet, blue.
- Narrow screens drop What was done below 1100px, and Outcome, What follows and Date below 760px; the full entry is a tap away.
- The footer says nothing here is investment advice, and counts entries not fully written up.

### Verified
- `research-test.js`: 78 checks (the parser on fixtures, then every real entry filed, known verdict, four sections, no trading word). The word guard was proved by planting "buy" in an entry.
- The page rendered in headless Chrome against the real file and the site's own markdown renderer lifted out of server.js: list, an opened entry with its numbers table, and the phone layout (page width equal to the viewport at every size tried; headless Chrome will not go below 497px).
- The routes were not exercised on a booted server (the local server writes to production). Check `/research` as a member and as a guest after the deploy.
