// S&P 500 RETURNS BY YEAR, for the promo studio's Research card (2026-10-28,
// the owner: "show to everyone the spread of average equal weighted or cap
// weighted return by year in a histogram .. only for s&p stocks .. for last
// 20 years .. I should be able to select the year").
//
// Offline builder, like single-data.js: reads the local research copy
// (analysis.db: bars, sec_facts, splits) and, once, today's snapshot from
// Turso for who is in the S&P 500 now. Writes private/sp-years.json.
//
//   node --use-system-ca sp-years.js
//
// WHAT IT MEASURES, per calendar year from 2007 (the bar archive starts on
// 2006-10-12, so 2007 is the first year with a closing price before it) to
// the current year so far:
//   - each stock's PRICE return, last close of the year before to last close
//     of the year (or the latest close). Bars are split-adjusted. Dividends
//     are not in it.
//   - the equal-weighted average, the median, and the cap-weighted average,
//     weighted by each company's market value at the START of the year.
//   - the S&P 500 fund's (SPY) own price return over the same dates.
//
// TODAY'S MEMBERS ONLY. The universe has no record of who was in the index in
// past years, so a year's stocks are the ones in it now that were listed then.
// That leaves out everything that fell out or failed, and lifts every year's
// averages; SPY's return is the honest benchmark beside them, because it held
// the index as it actually was. The card says both.
//
// START-OF-YEAR MARKET VALUE: the start price times the company's diluted
// share count from its latest filing for a period ending in the 15 months
// before, restated to today's share basis by the splits since. Where no such
// filing exists (most companies before 2009), today's share count instead,
// which misses the buybacks and issuance between. The share of each year's
// weights that came from filings is stored and shown.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const store = require('./db.js');

const OUT = path.join(__dirname, 'private', 'sp-years.json');
const FIRST_YEAR = 2007;
const FUND = 'SPY';
const DAY = 86400000;
const ms = (d) => Date.parse(d + 'T12:00:00Z');

(async () => {
  const db = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });
  // Members: the newest stored holdings file of the S&P 500 fund, the source
  // the screener's S&P 500 flag reads (server.js fundMembers). spMember is a
  // read-path stamp, so it is not on the stored snapshot's rows.
  const st = await store.fundNewest('spy');
  if (!st || !st.asOf) throw new Error('no S&P 500 holdings file stored');
  const { holdings } = await store.readFundHoldings('spy', st.asOf);
  const members = new Set((holdings || []).map((h) => h.symbol));
  const snap = await store.readSnapshot();
  const rows = ((snap && snap.stocks) || []).filter((r) => r && !r.error && members.has(r.symbol) && r.instrumentType !== 'ETF');
  console.log(rows.length + ' S&P 500 members (holdings as of ' + st.asOf + ', ' + members.size + ' listed)');
  const lastClose = db.prepare('select d, close from bars where symbol = ? and d <= ? order by d desc limit 1');
  // THE ORIGINAL FILING for the newest period, not the latest one to mention
  // it: a later report restates the count for any split since, and applying
  // the split again counted Amazon's 20-for-1 twice ($34 trillion). The splits
  // applied are the ones after that filing went in.
  const shareRow = db.prepare("select period_end, shares_diluted, filed from sec_facts where symbol = ? and shares_diluted > 0 and period_end <= ? and period_end >= ? and period_type in ('Q', 'FY') order by period_end desc, filed asc limit 1");
  const splitsAfter = db.prepare('select f from splits where symbol = ? and d > ?');
  const countBars = db.prepare('select count(*) n from bars where symbol = ? and d > ? and d <= ?');
  const latest = db.prepare('select max(d) d from bars where symbol = ?').get(FUND).d;
  const thisYear = Number(latest.slice(0, 4));

  // Today's share count, on today's basis: market value over price.
  const sharesNow = {};
  for (const r of rows) { const c = Number(r.marketCap), p = Number(r.price); if (c > 0 && p > 0) sharesNow[r.symbol] = c / p; }

  // A close within a week of the boundary, or nothing (not listed yet, or a gap).
  const closeAt = (sym, day) => { const x = lastClose.get(sym, day); return x && ms(day) - ms(x.d) <= 7 * DAY && x.close > 0 ? x : null; };

  const years = [];
  for (let y = FIRST_YEAR; y <= thisYear; y++) {
    const from = (y - 1) + '-12-31', to = y === thisYear ? latest : y + '-12-31';
    const fund0 = closeAt(FUND, from), fund1 = closeAt(FUND, to);
    const out = [];
    let capW = 0, capSum = 0, fromFilings = 0, rejected = 0, gapped = 0;
    // TRADED THROUGH THE YEAR: at least 90% of the fund's sessions. The GM
    // ticker was the old company's until its 2009 bankruptcy and the new one's
    // from November 2010, so its "2010 return" was +7,743% across a 17-month
    // gap. A reused ticker or a long halt is not a year's return.
    const sessions = countBars.get(FUND, from, to).n;
    for (const r of rows) {
      const a = closeAt(r.symbol, from), b = closeAt(r.symbol, to);
      if (!a || !b) continue;
      if (countBars.get(r.symbol, from, to).n < sessions * 0.9) { gapped++; continue; }
      const ret = b.close / a.close - 1;
      if (!Number.isFinite(ret)) continue;
      // Shares at the start of the year, on today's basis.
      let shares = null, filed = false;
      const s = shareRow.get(r.symbol, from, new Date(ms(from) - 456 * DAY).toISOString().slice(0, 10));
      if (s) {
        let f = 1;
        for (const sp of splitsAfter.all(r.symbol, String(s.filed).slice(0, 10))) if (sp.f > 0) f *= sp.f;
        shares = s.shares_diluted * f; filed = true;
        // A SANITY BOUND: more than three times today's count either way is a
        // units fault in the filing data (Northern Trust read 224 trillion
        // shares), so today's count stands in. Rejected ones are counted.
        const now = sharesNow[r.symbol];
        if (now && (shares > now * 3 || shares < now / 3)) { shares = now; filed = false; rejected++; }
      } else if (sharesNow[r.symbol]) shares = sharesNow[r.symbol];
      const cap = shares ? a.close * shares : null;
      if (cap > 0) { capW += cap; capSum += cap * ret; if (filed) fromFilings += cap; }
      out.push([r.symbol, Math.round(ret * 10000) / 10000]);
    }
    const rets = out.map((x) => x[1]).sort((p, q) => p - q);
    const mid = rets.length >> 1;
    const median = rets.length ? (rets.length % 2 ? rets[mid] : (rets[mid - 1] + rets[mid]) / 2) : null;
    const eq = rets.length ? rets.reduce((p, q) => p + q, 0) / rets.length : null;
    const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);
    years.push({
      y, from, to, partial: y === thisYear, n: out.length,
      eq: r4(eq), cap: r4(capW ? capSum / capW : null), median: r4(median),
      fund: fund0 && fund1 ? r4(fund1.close / fund0.close - 1) : null,
      up: out.filter((x) => x[1] > 0).length,
      capFromFilings: capW ? Math.round(fromFilings / capW * 100) : null, gapped,
      rows: out,
    });
    const p = (v) => (v == null ? '  —  ' : (v * 100).toFixed(1).padStart(6) + '%');
    console.log(`${y}${y === thisYear ? '*' : ' '} n=${String(out.length).padStart(3)}  equal ${p(eq)}  cap ${p(capW ? capSum / capW : null)}  median ${p(median)}  SPY ${p(years[years.length - 1].fund)}  weights from filings ${years[years.length - 1].capFromFilings}%, ${rejected} filing counts rejected, ${gapped} not traded through`);
  }
  const names = Object.fromEntries(rows.map((r) => [r.symbol, r.shortName || r.name || r.symbol]));
  fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), membersAsOf: st.asOf, members: rows.length, fund: FUND, years, names }));
  console.log('wrote ' + path.relative(__dirname, OUT) + ' (' + Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
