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

### Growth: the peer chart for a theme (2026-10-14)

The owner, of Against its peers: "can I have this chart at the theme level, you can call it Growth." Template `thmgrowth`, second in the Theme group; controls `tgrName`, `tgrMetric`, `tgrView` (the peer chart's own measures and views: value, rank, share).

- **The same chart and the same drawing** (`peertrend.js`), with the theme's companies where a company and its peers were. No company is the subject, so none takes the accent and the heading names the theme; each company gets its own colour from the Lines card's palette instead, since eight grey lines could not be told apart (seen on the first picture). The share view colours its own bands.
- **The eight largest by market value today** when a theme holds more (the series route's limit, `LINE_MAX_SYMS`); the note says how many of how many. Five years (21 quarter ends).
- **The series come through the Lines card's channel**: `getLineSeries` in the studio, and `linesNeed` now answers for `thmgrowth` too, so the phone draws a saved one through the route it already had.
- Checked: drawn from the real snapshot with stand-in series (the companies asked for, the note for a 35-company theme, the share view, no accent line); the real `promo.html` loading it, looked at. Not looked at with real filings.

### Day by day: the last eight weeks (2026-10-22)

The owner: "create a promo similar to month by month and call it Day by Day, Only limit it to last 8 weeks hardcoded, Apply it anywhere we have the month by month sub template."

**Four templates, each placed right after Month by month in its group:**

| template | group | controls |
|---|---|---|
| `days` | Stock spotlight | `dbdSym`, `dbdView` |
| `mktdays` | Market | `gdkGroup`, `gdkView` |
| `secdays` | Sector | `gdsName`, `gdsView` |
| `thmdays` | Theme | `gdtName`, `gdtView` |

`View` is the month cards' own (`Cards.monthViews()`): the own return, or that less the S&P 500 fund's.

**The grid** (`dayDraw` in `cards.js`, styled by the month grid's `mh-*` classes plus `dd-grid`):
- A row is a week, newest at the top, labelled by its Monday. The columns are Mon to Fri, then Week.
- The Week figure is the week's sessions compounded; the running week is outlined.
- The foot counts the weeks each weekday was up.
- **Eight weeks is hardcoded** (`WEEKS` in `groupdays.js`, `DBD_WEEKS` in `cards.js`): the week of the newest session and the seven before it, on every size.

**Empty cells mean two different things:**
- A weekday the market was closed (a holiday) is a shaded empty slot. Its week still has a figure.
- A day still to come this week, or a session with no return on file, is plain empty. A missing session leaves its week without a figure, as a missing month leaves a year.

**The arithmetic is `groupdays.js`, one module for both kinds of card:**
- **The calendar is the S&P 500 fund's bar dates.** A company's day is struck against the previous session on that calendar, never against its own previous bar. A hole in a company's bars therefore costs two days (the missing one and the day after), not a two-day move filed under one day.
- **A day past ten times (`MAX_DAY`) is a break, not a return.** It is left out of the average and reported in the build's `broken` list.
- **Group days are equal weight, today's members, no funds**, the same rules as the month cards.

**Data:**
- **One stock:** `GET /api/days?symbol=` (`daysFor`: two per-symbol `readBars` of 70 rows, kept ten minutes). Same access as `/api/months`: signed in, and a guest only for the guest stocks.
- **Every group:** built by `groupDaysBuild` **inside `POST /api/group-months/rebuild`**, right after the months.
  - `nightly-ping.js`'s `months` phase already calls that route, so the days needed no new phase and no change to the scheduled task.
  - The answer carries the days' result under `days`; the months' fields stay at the top, which is what the ping prints.
  - A days failure never costs the months their answer.
- **The read** is `readBarsWindow` from the session before the window to the newest: on the real universe, 1,259 companies, about 48,000 rows in 2.2 seconds.
- **Storage:** `app_meta` `group_days`, replaced by each build. It is derived from the bars, which are the history.
- **Reading the build:** `GET /api/group-days` (members only). The studio fetches it once a visit, and the phone's `/api/m/post` reads it for a saved post (`daysNeed`, `groupDaysNeed`; `getDays`, `getGroupDays`).

**Housekeeping:** `CONTROL_IDS` grew to 383, so `POST_OPT_MAX` went from 400 to 500.

**Checked:**
- **`groupdays-test.js`, 53 checks:** the window, the holiday, the hole, a late listing, the break, the sub-cent floor, groups and funds, what the four cards draw on each size, the fallback without an index. The break, holiday-slot and to-come guards were each proved by reverting them.
- **The real studio over production's bars (read only):** all four cards on all three sizes, looked at. NVDA's newest day and SPY's matched the snapshot's own Today figures, and the market's newest day matched the snapshot's average.
- **The real server on an in-memory database:** the rebuild, the tiers (anonymous, guest, admin), and a saved post of each card drawn by the phone route.
