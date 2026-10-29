// How good are the figures read from the results releases (releases.js), and
// how much sooner do they arrive? Three comparisons, all on the local research
// copy (analysis-db.js --sec), so no Turso rows and no API calls:
//
//   1. Against the 10-Q (sec_facts): each figure of each release beside the
//      same quarter in the company's filing, first as filed.
//   2. Timing: days from the release to that 10-Q (or 10-K).
//   3. Against Twelve Data (fundamentals_history, kept since 2026-08-30): the
//      twelve months' revenue and net income summed from four releases, and
//      how many days after the release the provider's figure reached it.
//
//   node --no-warnings release-compare.js [--since 2025-07-01] [--json out.json]
//
// Written 2026-10-29, the owner: "first extract the data from the release
// fillings", then "go ahead" with the comparison. Read only; writes nothing
// but the optional JSON. One Turso read: the snapshot, for each company's sector.

require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const argOf = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SINCE = argOf('--since', '2025-07-01');
const JSON_OUT = argOf('--json', null);
const db = new DatabaseSync(argOf('--path', 'analysis.db'), { readOnly: true });

const DAY = 86400000;
const t = (d) => new Date(d + 'T12:00:00').getTime();
const days = (a, b) => Math.round((t(b) - t(a)) / DAY);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '—');
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

(async () => {
  // Sector, for banks and insurers apart: the one Turso read.
  let sector = new Map();
  try { const store = require('./db.js'); const snap = await store.readSnapshot(); sector = new Map((snap.stocks || []).map((r) => [r.symbol, r.sector || null])); } catch (e) { console.log('(no snapshot: sectors unknown)'); }
  const fin = (s) => /^financial/i.test(String(sector.get(s) || ''));

  const rel = db.prepare('select * from earnings_releases where is_results = 1 and filed >= ? and period_end is not null order by symbol, period_end').all(SINCE);
  // Each company's quarter rows, as first filed (the earliest filing that
  // carries the quarter: its own 10-Q, or the 10-K's worked-out fourth quarter).
  const secQ = new Map();
  const stmt = db.prepare("select * from sec_facts where symbol = ? and period_type = 'Q' and period_end >= ? and form in ('10-Q', '10-K', '10-Q/A', '10-K/A') order by filed");
  const syms = [...new Set(rel.map((r) => r.symbol))];
  const from = new Date(t(SINCE) - 200 * DAY).toISOString().slice(0, 10);
  for (const s of syms) secQ.set(s, stmt.all(s, from));
  const match = (r) => {
    const list = secQ.get(r.symbol) || [];
    // The first filing for a period within a week of the release's period end.
    return list.find((x) => Math.abs(days(x.period_end, r.period_end)) <= 7) || null;
  };

  // ---- 1. AGAINST THE 10-Q --------------------------------------------------
  const FIELDS = [
    ['Revenue', (r) => r.revenue, (s) => s.revenue],
    ['Operating income', (r) => r.op_income, (s) => s.operating_income],
    ['Net income', (r) => r.net_income, (s) => s.net_income],
    ['Diluted EPS', (r) => r.eps_gaap, (s) => s.eps_diluted, 'eps'],
    ['Gross profit', (r) => r.gross_profit, (s) => s.gross_profit],
    ['Cost of revenue', (r) => r.cost_rev, (s) => s.cost_of_revenue],
    ['Operating cash flow', (r) => (r.cf_months === 3 ? r.ocf : null), (s) => s.operating_cash_flow],
    ['Capital expenditures', (r) => (r.cf_months === 3 ? r.capex : null), (s) => (s.capex == null ? null : Math.abs(s.capex))],
    ['FCF worked out (ours)', (r) => r.fcf_calc, (s) => (s.operating_cash_flow == null || s.capex == null ? null : s.operating_cash_flow - Math.abs(s.capex))],
    ['FCF as the company states it', (r) => r.fcf, (s) => (s.operating_cash_flow == null || s.capex == null ? null : s.operating_cash_flow - Math.abs(s.capex))],
    ['Total assets', (r) => r.bs_assets, (s) => s.assets],
    ['Equity', (r) => r.bs_equity, (s) => s.equity],
    ['Cash', (r) => r.bs_cash, (s) => s.cash],
    ['Debt (current + long-term)', (r) => (r.bs_debt_cur == null && r.bs_debt_lt == null ? null : (r.bs_debt_cur || 0) + (r.bs_debt_lt || 0)), (s) => s.debt],
    ['Diluted shares', (r) => r.dil_shares, (s) => s.shares_diluted],
  ];
  const BANDS = [['within 0.1%', 0.001], ['within 0.5%', 0.005], ['within 2%', 0.02], ['within 10%', 0.1]];
  const matched = [], pending = [];
  for (const r of rel) { const s = match(r); if (s) matched.push([r, s]); else pending.push(r); }
  const res = {};
  for (const [name, a, b, kind] of FIELDS) {
    const o = { name, releases: 0, pairs: 0, bands: BANDS.map(() => 0), off: 0, scale: 0, diffs: [], worst: [] };
    for (const r of rel) if (a(r) != null) o.releases++;
    for (const [r, s] of matched) {
      const x = a(r), y = b(s);
      if (x == null || y == null) continue;
      o.pairs++;
      if (kind === 'eps') {
        const d = Math.abs(x - y);
        if (d <= 0.011) { o.bands = o.bands.map((v) => v + 1); continue; }
        o.off++; o.diffs.push(d); if (o.worst.length < 400) o.worst.push({ sym: r.symbol, pe: r.period_end, rel: x, sec: y });
        continue;
      }
      const rd = y === 0 ? (x === 0 ? 0 : Infinity) : Math.abs(x - y) / Math.abs(y);
      o.diffs.push(rd);
      BANDS.forEach(([, k], i) => { if (rd <= k) o.bands[i]++; });
      if (rd > 0.1) {
        o.off++;
        const ratio = y ? Math.abs(x / y) : 0;
        if (ratio > 500 && ratio < 2000 || ratio > 1 / 2000 && ratio < 1 / 500) o.scale++;
        if (o.worst.length < 400) o.worst.push({ sym: r.symbol, pe: r.period_end, rel: x, sec: y, ratio: +ratio.toFixed(4) });
      }
    }
    res[name] = o;
  }

  console.log(`\nRELEASES SINCE ${SINCE}: ${rel.length} (results); matched to a 10-Q or 10-K quarter: ${matched.length}; no filing quarter yet: ${pending.length}`);
  console.log('\n1. EACH FIGURE AGAINST THE 10-Q (the quarter as first filed)\n');
  console.log('figure'.padEnd(30), 'releases'.padStart(8), 'pairs'.padStart(7), ...BANDS.map(([l]) => l.padStart(12)), 'off >10%'.padStart(9), 'scale x1000'.padStart(12));
  for (const o of Object.values(res)) {
    console.log(o.name.padEnd(30), String(o.releases).padStart(8), String(o.pairs).padStart(7), ...o.bands.map((v) => pct(v, o.pairs).padStart(12)), String(o.off).padStart(9), String(o.scale).padStart(12));
  }

  // ---- 2. TIMING -------------------------------------------------------------
  const lag = matched.map(([r, s]) => ({ sym: r.symbol, fin: fin(r.symbol), q4: /^10-K/.test(s.form), d: days(r.filed, s.filed) })).filter((x) => x.d >= 0 && x.d <= 120);
  const show = (label, a) => {
    const d = a.map((x) => x.d);
    console.log(label.padEnd(36), String(a.length).padStart(6), pct(d.filter((v) => v === 0).length, d.length).padStart(9), pct(d.filter((v) => v >= 1 && v <= 7).length, d.length).padStart(9),
      pct(d.filter((v) => v > 7 && v <= 21).length, d.length).padStart(9), pct(d.filter((v) => v > 21).length, d.length).padStart(9), String(median(d)).padStart(7), String(q(d, 0.9)).padStart(5));
  };
  console.log('\n2. DAYS FROM THE RELEASE TO THE FILING (10-Q; 10-K for a fourth quarter)\n');
  console.log(''.padEnd(36), 'n'.padStart(6), 'same day'.padStart(9), '1-7'.padStart(9), '8-21'.padStart(9), '22+'.padStart(9), 'median'.padStart(7), 'p90'.padStart(5));
  show('All', lag);
  show('Quarters 1-3 (10-Q)', lag.filter((x) => !x.q4));
  show('Fourth quarter (10-K)', lag.filter((x) => x.q4));
  show('Financial companies', lag.filter((x) => x.fin));
  show('Everyone else', lag.filter((x) => !x.fin));

  // ---- 3. AGAINST TWELVE DATA -------------------------------------------------
  // Twelve months from four releases in a row (each period 75 to 105 days after
  // the one before), against the provider's twelve-month figure: the last value
  // before the release, and the first day it came within 1% of ours.
  const bySym = new Map();
  for (const r of db.prepare("select symbol, filed, period_end, revenue, net_income from earnings_releases where is_results = 1 and period_end is not null order by symbol, period_end").all()) {
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, []);
    bySym.get(r.symbol).push(r);
  }
  const fh = db.prepare('select d, revenue_ttm, net_income_ttm from fundamentals_history where symbol = ? order by d');
  const fhFirst = db.prepare('select min(d) a, max(d) z from fundamentals_history').get();
  const tdOut = { revenue: [], net_income: [] };
  for (const [sym, list] of bySym) {
    const recent = list.filter((r) => r.filed > fhFirst.a && days(r.filed, fhFirst.z) >= 7);
    if (!recent.length) continue;
    const hist = fh.all(sym);
    if (!hist.length) continue;
    for (const r of recent) {
      const i = list.indexOf(r);
      const four = list.slice(Math.max(0, i - 3), i + 1);
      if (four.length < 4) continue;
      let chain = true;
      for (let k = 1; k < 4; k++) { const g = days(four[k - 1].period_end, four[k].period_end); if (g < 75 || g > 105) chain = false; }
      if (!chain) continue;
      for (const [key, col] of [['revenue', 'revenue_ttm'], ['net_income', 'net_income_ttm']]) {
        if (four.some((x) => x[key] == null)) continue;
        const ttm = four.reduce((a, x) => a + x[key], 0);
        if (!ttm) continue;
        const before = [...hist].reverse().find((h) => h.d < r.filed && h[col] != null);
        const after = hist.filter((h) => h.d >= r.filed && h[col] != null);
        const near = (v) => Math.abs(v - ttm) <= Math.abs(ttm) * 0.01;
        const hit = after.find((h) => near(h[col]));
        const last = after[after.length - 1];
        tdOut[key].push({ sym, filed: r.filed, ttm, before: before ? before[col] : null, beforeNear: before ? near(before[col]) : null,
          lag: hit ? days(r.filed, hit.d) : null, last: last ? last[col] : null, lastNear: last ? near(last[col]) : null, fin: fin(sym) });
      }
    }
  }
  console.log(`\n3. TWELVE MONTHS FROM FOUR RELEASES AGAINST TWELVE DATA (its stored values ${fhFirst.a} to ${fhFirst.z}; releases filed at least a week before the end)\n`);
  for (const [key, label] of [['revenue', 'Revenue, twelve months'], ['net_income', 'Net income, twelve months']]) {
    const a = tdOut[key];
    const reached = a.filter((x) => x.lag != null), lags = reached.map((x) => x.lag);
    console.log(`${label}: ${a.length} releases`);
    console.log(`  provider already within 1% the day before the release: ${pct(a.filter((x) => x.beforeNear).length, a.length)}`);
    console.log(`  provider reached it within 1% afterwards: ${pct(reached.length, a.length)}; days after the release: same day ${pct(lags.filter((v) => v === 0).length, lags.length)}, 1-3 ${pct(lags.filter((v) => v >= 1 && v <= 3).length, lags.length)}, 4-7 ${pct(lags.filter((v) => v >= 4 && v <= 7).length, lags.length)}, 8+ ${pct(lags.filter((v) => v > 7).length, lags.length)}; median ${median(lags)}, p90 ${q(lags, 0.9)}`);
    console.log(`  never within 1% by ${fhFirst.z}: ${pct(a.filter((x) => x.lag == null).length, a.length)} (of which the latest value is off by more than 5%: ${a.filter((x) => x.lag == null && x.last != null && Math.abs(x.last - x.ttm) > Math.abs(x.ttm) * 0.05).length})`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ since: SINCE, releases: rel.length, matched: matched.length, pending: pending.length,
      fields: Object.fromEntries(Object.entries(res).map(([k, o]) => [k, { releases: o.releases, pairs: o.pairs, bands: o.bands, off: o.off, scale: o.scale, median: median(o.diffs), worst: o.worst }])),
      timing: lag, twelveData: tdOut }, null, 1));
    console.log('\nwritten ' + JSON_OUT);
  }
  process.exit(0);
})();
