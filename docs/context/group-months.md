## Month by month for a group: the market, a sector, a theme (2026-10-13)

The owner, of the single-stock month-by-month card: "I love this month by month visual, can this be expanded for Market, Sector ... for Theme as well. Do you think we can add a new template for Theme." Asked the three things that change the numbers, the owner chose: **equal weight**; the extra reads are fine ("can change the logic if too slow"); **"make it 10 for everyone"**.

**Three cards, one builder** (`groupMonthsCard` in `cards.js`), each in its own group of the picker:

| template | group | controls |
|---|---|---|
| `mktmonths` | Market | `gmkGroup` (every company, S&P 500 members, Nasdaq 100 members), `gmkView` |
| `secmonths` | Sector | `gscName`, `gscView` |
| `thmmonths` | **Theme** (a new group, after Industry) | `gthName`, `gthView` |

`View` is the stock card's own: the group's return, or that less the S&P 500 fund's.

- **A cell** is the plain average of each member's price return that calendar month (`groupmonths.js`). Equal weight: what the typical member did, not what an index fund did.
- **The year** is its months compounded; a year with a month missing has no figure.
- **The members are today's, applied to every past month.** The only list there is. Every card says so in its note, with how many members stand behind the earliest year drawn (Technology: 243 today, 151 in January 2017). It flatters the past and is a record of today's members, not of the group at the time.
- **Funds are not members**: an ETF in a theme holds the theme's own companies.
- **Ten years for everyone**: `MON_YEARS` is 10 on the portrait and story, and the stock card went from eleven to ten with it.
- **One drawing function.** `tplMonths` was split: `monDraw(G)` draws the grid from monthly and yearly returns keyed by month and year, and the stock card and the group card both hand it theirs. The stock card's output is unchanged apart from the year count.

**Built once a day, for every group at once** (`groupMonthsBuild`, `POST /api/group-months/rebuild`, the cron secret or an admin). The last close before each of 119 month boundaries for every company: 149,464 single-row seeks, twelve boundaries a batch, **41 seconds** on the server. Stored as `app_meta` `group_months` (42 KB: 37 groups, 118 months, each with its returns and how many members had one). `GET /api/group-months` (members) reads that; the studio fetches it once a visit and the phone route reads it for a saved post. `nightly-ping.js` asks for the build as its last phase (`months`).

- **Both ends of a month must belong**: the earlier close to the month before and the later one to the month itself, or a company not yet listed would borrow a price from months earlier.
- **A break in a price series is not a return.** The first real build read Energy's 2020 as +554% and the whole market's November 2020 as +49%. One company: Chord Energy's bars run from 0.11 to 34.20 across that month, the old shares cancelled in its reorganisation and new ones issued, which as a return is +30,991%. A month past 25 times (`MAX_MONTH`) is left out of the average and named in the build's answer (`broken`). The largest real month in ten years of this universe is GameStop's +1,625% in January 2021, which is kept. After: Energy 2020 is -5.6%, the market's 2020 +29.4%, its November +17.7%. **The bars themselves are not corrected**: the stock's own card still shows that month.
- **First reading**: every company 2017 +27.1%, 2022 -15.5%, 2023 +27.1%; S&P 500 members equal weight 2022 -12.3% against the fund's -19.5%; worst market month March 2020, -19.7%.
- Checked: the arithmetic on fixtures (late listing, a stale close, a fund, three-state index membership), eleven checks on the cards, the real `promo.html` in a headless browser as admin and as a member, and the real build in production read back and compared with the index fund.

### The other five sector views, under Theme (2026-10-13)

The owner: "add all the other sub-templates under Sector ... under Theme, namely Ranking, Snapshot, Spotlight, Margins and Options." Theme now holds six views: Ranking (`thmrank`), Snapshot (`thmsnap`), Spotlight (`thmspot`), Margins (`thmmargin`), Options (`optthm`) and Month by month.

- **Built on the sector cards, not beside them.** `GROUPING.theme` (`field: 'portfolios'`, `multi: true`) joins `sector` and `industry`, and `groupKeys(row, field)` / `inGroup(row, field, name)` are the one membership test. The ranking, the picker lists (`groupList`), the spotlight, the snapshot (`tplSecSnap(G, P)`, the sector card by default), the options card (`dim: 'portfolios'`) and the margins card (`dim: 'theme'`, filtered server-side in `marginsFor` from `readPortfolios()`) all read through it. **The sector and industry cards draw byte-for-byte what they drew before**, checked against the previous `cards.js` on the real snapshot for Ranking, Snapshot, Spotlight, Options and the industry ranking.
- **A company can be in several themes** and counts in each. The ranking says so, and does not list "companies with no theme" as left out: most companies are in none, which is not a gap.
- **What a theme lacks**: a fund, so the snapshot has no fund chip (its hint says so); a dominant sector, so the spotlight's kicker carries none. Themes under three companies are not offered, as for industries and sectors.
- **Controls** (all new prefixes, checked free): `trk*` ranking, `tsn*` snapshot, `tsp*` spotlight, `tmg*` margins, `oth*` options. The boxes are copies of the sector boxes with ids and wording changed. `CONTROL_IDS` is 274 long, so `POST_OPT_MAX` went from 300 to 400.
- Checked: each theme card drawn from the real snapshot; the real `promo.html` loading all six views (Snapshot looked at); no duplicate id or control. Margins and Options need the server's figures, which the test harness does not have; not looked at with real data.
