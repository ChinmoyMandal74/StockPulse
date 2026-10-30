// THE BIGGEST ONE-DAY MOVES IN MARKET VALUE, for the promo studio's Research
// card (2026-10-29, the owner: "make a card showing worst market cap loss or
// gain for one stock in one day .. give the user the ability to choose the
// time 1 year to 10 years").
//
// Offline builder, like sp-years.js: reads the local research copy
// (analysis.db: bars, sec_facts, splits) and, once, today's snapshot from
// Turso for the companies on the screener and today's share counts. Writes
// private/day-moves.json.
//
//   node --use-system-ca day-moves.js
//
// WHAT IT MEASURES: for every company on the screener (funds left out) and
// every session in the last ten years, the change in its market value that
// day, in dollars: the value at the close before times the day's price move.
// A move in value, not a profit or a loss to anyone.
//
// THE VALUE AT THE CLOSE BEFORE is that close times the company's diluted
// share count from the ORIGINAL filing for the newest period ending in the 15
// months before, restated to today's basis by the splits filed since (bars are
// split-adjusted), exactly as sp-years.js does it. Where there is no such
// filing, or the filed count is more than three times today's either way (a
// units fault), or the company files in another currency or is a depositary
// receipt (its filed count is of ordinary shares, not the receipts that
// trade), today's share count stands in: market value over price.
//
// A BAD BAR IS NOT A MOVE. A session more than a week after the one before (a
// halt, a reused ticker, a gap in the archive) is skipped, and so is a jump of
// more than 35% that the next session undoes to within 15%: a price that
// spiked for one day and came straight back is a fault in the data far more
// often than a real day.
//
// FOR EACH WINDOW, one to ten years to the latest close: the ten biggest
// one-day falls and the ten biggest one-day rises, ONE ROW A COMPANY (its
// biggest day in the window), so a single stock that moved hugely on many days
// does not fill the list.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const store = require('./db.js');

const OUT = path.join(__dirname, 'private', 'day-moves.json');
const YEARS = 10, TOP = 10, BENCH = 'SPY';
const DAY = 86400000;
const ms = (d) => Date.parse(d + 'T12:00:00Z');
const iso = (t) => new Date(t).toISOString().slice(0, 10);

(async () => {
  const db = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });
  const snap = await store.readSnapshot();
  const rows = ((snap && snap.stocks) || []).filter((r) => r && !r.error && r.symbol && r.instrumentType !== 'ETF'
    && !/fund|etf|etn|trust/i.test(String(r.companyType || '')) && Number(r.marketCap) > 0 && Number(r.price) > 0);
  const latest = db.prepare('select max(d) d from bars where symbol = ?').get(BENCH).d;
  const since = iso(ms(latest) - (YEARS * 365.25 + 10) * DAY);
  console.log(rows.length + ' companies; sessions from ' + since + ' to ' + latest);
  const barsOf = db.prepare('select d, close from bars where symbol = ? and d >= ? order by d');
  const filingsOf = db.prepare("select period_end, shares_diluted, filed from sec_facts where symbol = ? and shares_diluted > 0 and period_type in ('Q', 'FY') and period_end >= ? order by period_end, filed");
  const splitsOf = db.prepare('select d, f from splits where symbol = ?');

  // Every company's days: [date, change in dollars, price move, value before].
  const moves = [];
  let skippedGap = 0, skippedSpike = 0, fromFilings = 0, fromToday = 0;
  for (const r of rows) {
    const bars = barsOf.all(r.symbol, since).filter((b) => b.close > 0);
    if (bars.length < 2) continue;
    const sharesNow = Number(r.marketCap) / Number(r.price);
    const foreign = (r.currency && r.currency !== 'USD') || /depositary/i.test(String(r.instrumentType || ''));
    // The original filing for each period, on today's basis.
    const splits = splitsOf.all(r.symbol).filter((s) => s.f > 0);
    const filed = [];
    if (!foreign) {
      const seen = new Set();
      for (const f of filingsOf.all(r.symbol, iso(ms(since) - 460 * DAY))) {
        if (seen.has(f.period_end)) continue;          // the first filed is the original
        seen.add(f.period_end);
        let k = 1;
        for (const s of splits) if (s.d > String(f.filed).slice(0, 10)) k *= s.f;
        const sh = f.shares_diluted * k;
        if (sh > sharesNow * 3 || sh < sharesNow / 3) continue;   // a units fault
        filed.push([f.period_end, sh]);
      }
    }
    let fi = -1;
    for (let i = 1; i < bars.length; i++) {
      const a = bars[i - 1], b = bars[i];
      if (ms(b.d) - ms(a.d) > 7 * DAY) { skippedGap++; continue; }
      const ret = b.close / a.close - 1;
      if (!Number.isFinite(ret)) continue;
      const c = bars[i + 1];
      if (Math.abs(ret) > 0.35 && c && Math.abs((c.close / a.close) - 1) < 0.15) { skippedSpike++; continue; }
      // The newest filed count for a period ending by the close before, within 15 months.
      while (fi + 1 < filed.length && filed[fi + 1][0] <= a.d) fi++;
      const useFiled = fi >= 0 && ms(a.d) - ms(filed[fi][0]) <= 456 * DAY;
      const shares = useFiled ? filed[fi][1] : sharesNow;
      if (useFiled) fromFilings++; else fromToday++;
      const cap = a.close * shares;
      moves.push([r.symbol, b.d, cap * ret, ret, cap]);
    }
  }
  console.log(moves.length.toLocaleString() + ' company-days; ' + skippedGap + ' after a gap and ' + skippedSpike + ' one-day spikes skipped; share counts from filings ' + Math.round(fromFilings / (fromFilings + fromToday) * 100) + '%');

  const names = Object.fromEntries(rows.map((r) => [r.symbol, r.shortName || r.name || r.symbol]));
  const sectors = Object.fromEntries(rows.map((r) => [r.symbol, r.sector || null]));
  const windows = [];
  for (let y = 1; y <= YEARS; y++) {
    const from = iso(ms(latest) - y * 365.25 * DAY);
    const worst = new Map(), best = new Map();
    let n = 0;
    for (const m of moves) {
      if (m[1] <= from) continue;
      n++;
      const w = worst.get(m[0]); if (!w || m[2] < w[2]) worst.set(m[0], m);
      const b = best.get(m[0]); if (!b || m[2] > b[2]) best.set(m[0], m);
    }
    const pack = (m) => ({ s: m[0], d: m[1], chg: Math.round(m[2]), pct: Math.round(m[3] * 10000) / 100, cap: Math.round(m[4]) });
    const loss = [...worst.values()].filter((m) => m[2] < 0).sort((p, q) => p[2] - q[2]).slice(0, TOP).map(pack);
    const gain = [...best.values()].filter((m) => m[2] > 0).sort((p, q) => q[2] - p[2]).slice(0, TOP).map(pack);
    windows.push({ y, from, to: latest, companies: worst.size, days: n, loss, gain });
    const b = (v) => (v / 1e9).toFixed(0) + 'B';
    console.log(y + 'y  loss ' + loss.slice(0, 3).map((x) => x.s + ' ' + x.d + ' ' + b(x.chg)).join(', ') + '  |  gain ' + gain.slice(0, 3).map((x) => x.s + ' ' + x.d + ' +' + b(x.chg)).join(', '));
  }
  const used = new Set(windows.flatMap((w) => [...w.loss, ...w.gain].map((x) => x.s)));
  fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), latest, companies: rows.length,
    sharesFromFilings: Math.round(fromFilings / (fromFilings + fromToday) * 100),
    windows, names: Object.fromEntries([...used].map((s) => [s, names[s]])), sectors: Object.fromEntries([...used].map((s) => [s, sectors[s]])) }));
  console.log('wrote ' + path.relative(__dirname, OUT) + ' (' + Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
