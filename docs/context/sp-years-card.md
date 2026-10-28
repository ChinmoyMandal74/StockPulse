## Research › S&P 500 returns by year (2026-10-28)
The owner: "show to everyone the spread of average equal weighted or cap weighted return by year in a histogram .. may be one slide per year .. only for s&p stocks .. for last 20 years .. I should be able to select the year … put under a new template category called research".

**The Research category** is a new `TPL_GROUPS` entry in `promo.html`, before Brand, with one view: template `spyears`, control `spyYear` (in `CONTROL_IDS`, its own listener, the `spyBox` panel).

**The data: `sp-years.js`, an offline builder like `single-data.js`.**
- It reads the local archive (`analysis.db`: bars, `sec_facts`, splits). From Turso it reads only today's S&P 500 members (the newest stored SPY holdings file, as `fundMembers` does; `spMember` is a read-path stamp, not on stored rows) and the snapshot's prices and caps.
- It writes `private/sp-years.json`, about 146 KB, committed so Vercel serves it. `GUEST_BLOCKED_ASSET` keeps it from guests; members and admins get it.
- **Rebuild:** `node --use-system-ca sp-years.js`, after a year ends, when membership changes, or to bring the current year forward. It reads the local archive, so sync `analysis-db.js` first.

**Per year, from 2007** (the archive starts 2006-10-12) to the current year so far:
- Each member's **price** return from the year before's last close to the year's last close. Bars are split-adjusted; dividends are not included.
- The equal-weighted mean, the median, stocks up, the cap-weighted mean, and SPY's own return over the same dates.
- **Start-of-year value** is the start price times diluted shares from the **original** filing for the newest period ending in the 15 months before, times the splits filed since.
  - The latest filing restates for later splits; using it counted Amazon's 20-for-1 twice ($34 trillion).
  - A count more than 3× from today's either way is a units fault (Northern Trust: 224 trillion shares) and gives way to today's count, as does a missing filing. Most of 2007–2008 uses today's count; `capFromFilings` stores the share per year.
- **A stock counts in a year only if it traded at least 90% of SPY's sessions.** The GM ticker passed from the old company (bankrupt 2009) to the new one (listed November 2010) and showed +7,743% for 2010.

**Checked against SPY:** cap-weighted lands within about 1–2 points in nearly every year, a little above (2008 −37.2 vs −38.3; 2013 +29.8 vs +29.7; 2022 −20.2 vs −19.5; 2024 +25.3 vs +23.3). That gap is the survivorship the card discloses.

**The card (`tplSpYears` in `cards.js`):**
- Four tiles: equal-weighted, cap-weighted, S&P 500 fund, stocks up (with the median).
- A histogram in ten-point bins from −60% to +100%, with both ends open, so every year shares one axis and the slides compare. Bars are green at or above zero and red below (price up and down). Counts sit on the bars.
- Three lines: equal-weighted (dashed), cap-weighted (accent) and the fund (dotted). A key sits beside the group of lines, not a label on each line, because the three are usually within a few points of each other.
- **The note says the stocks are today's members**, that companies which left the index or failed are missing (lifting both averages), that the fund held the index as it was, and that dividends are not included.
- The year picker lists the built years newest first, the current one "so far". It opens on the latest full year. A saved post's year waits in `dataset.want` for a picker filled after it.
- The phone's saved posts get the same file through `spYearsFile()` in `server.js`.

**Tested** with scratchpad `spy-test.js`, 27 checks in the real studio:
- the category, the picker and its years, and the default year;
- for 2008, 2024 and 2026: the bars total the year's stocks, the tiles match the build, the key is clear of the lines and inside the chart, the card fits, "so far" appears only on the current year, no buy/sell/hold wording, and the members note is present;
- the late-filled saved year;
- no page errors.

Plus 2 gate checks (anonymous and guest refused the file). The guest block was proved by removing it: a guest then got 200.
