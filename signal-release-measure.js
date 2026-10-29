// What would the Signal do if its fundamental inputs came from the results
// releases instead of Twelve Data? A MEASUREMENT ONLY (2026-10-29, the owner
// took "measure first"): every stock is scored twice with the live rules
// (Balanced), once as it stands and once with the release-based inputs laid
// over, and the verdicts are compared. Nothing is written and action.js is
// untouched.
//
//   node --use-system-ca --no-warnings signal-release-measure.js [--json out.json]
//
// THE INPUTS LAID OVER, where the releases give them (otherwise Twelve Data's stay):
//   revenueGrowthYoY, earningsGrowthYoY  the newest release's quarter on the
//       same quarter a year earlier (revenue; net income), as /recon compares
//   netIncomeTtm, profitMargin, grossMargin, fcfTtm, fcfMargin  twelve months
//       summed from the four newest releases in a row (each period 75 to 105
//       days after the one before); gross profit as printed or revenue less
//       cost of revenue; free cash flow the company's or ours
// Two scenarios:
//   NEWEST WINS   only where the newest release is newer than Twelve Data's
//                 report (lastEarningsDate more than 5 days before it)
//   ALWAYS        wherever the releases give a figure
// The newest release must be from the last 130 days, as the screener's group.
//
// One Turso read (the snapshot); the releases come from the local copy
// (analysis-db.js --sec).

require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const A = require('./private/action.js');
const store = require('./db.js');

const argOf = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const JSON_OUT = argOf('--json', null);
// --no-fcf: leave Twelve Data's free cash flow in place (its fcfTtm is levered
// free cash flow, a different measure), to see what the rest changes alone.
const NO_FCF = process.argv.includes('--no-fcf');
const db = new DatabaseSync(argOf('--path', 'analysis.db'), { readOnly: true });
const DAY = 86400000;
const t = (d) => Date.parse(String(d).slice(0, 10) + 'T12:00:00Z');
const yoy = (a, b) => (a == null || b == null || !(b > 0) ? null : (a / b - 1) * 100);

function overlayFor(list) {
  // list: the company's results releases, oldest first by period end.
  if (!list.length) return null;
  const last = list[list.length - 1];
  if ((Date.now() - t(last.filed)) / DAY > 130) return null;
  const o = { filed: last.filed, fields: {} };
  const rg = yoy(last.revenue, last.revenue_prior), ng = yoy(last.net_income, last.net_income_prior);
  if (rg != null) o.fields.revenueGrowthYoY = rg;
  if (ng != null) o.fields.earningsGrowthYoY = ng;
  const four = list.slice(-4);
  let chain = four.length === 4;
  for (let k = 1; chain && k < 4; k++) { const g = (t(four[k].period_end) - t(four[k - 1].period_end)) / DAY; if (g < 75 || g > 105) chain = false; }
  if (chain) {
    const sum = (f) => (four.every((x) => f(x) != null) ? four.reduce((a, x) => a + f(x), 0) : null);
    const rev = sum((x) => x.revenue), ni = sum((x) => x.net_income);
    const gp = sum((x) => (x.gross_profit != null ? x.gross_profit : x.cost_rev != null && x.revenue != null ? x.revenue - Math.abs(x.cost_rev) : null));
    const fcf = sum((x) => (x.fcf != null ? x.fcf : x.fcf_calc));
    if (ni != null) o.fields.netIncomeTtm = ni;
    if (rev > 0 && ni != null) o.fields.profitMargin = ni / rev * 100;
    if (rev > 0 && gp != null) o.fields.grossMargin = gp / rev * 100;
    if (fcf != null) o.fields.fcfTtm = fcf;
    if (rev > 0 && fcf != null) o.fields.fcfMargin = fcf / rev * 100;
  }
  if (NO_FCF) { delete o.fields.fcfTtm; delete o.fields.fcfMargin; }
  return Object.keys(o.fields).length ? o : null;
}

(async () => {
  const snap = await store.readSnapshot();
  const rows = (snap.stocks || []).filter((s) => s && !s.error && s.symbol);
  const cfg = A.resolve({}, 'Balanced').cfg;
  const rel = new Map();
  for (const r of db.prepare('select symbol, filed, period_end, revenue, revenue_prior, net_income, net_income_prior, gross_profit, cost_rev, fcf, fcf_calc from earnings_releases where is_results = 1 and period_end is not null order by symbol, period_end, filed').all()) {
    if (!rel.has(r.symbol)) rel.set(r.symbol, []);
    const l = rel.get(r.symbol);
    // One reading a period: the latest filed (an amended release replaces).
    if (l.length && l[l.length - 1].period_end === r.period_end) l[l.length - 1] = r; else l.push(r);
  }
  const ev = (s) => { const r = A.evaluate(s, cfg); return { v: r.action, why: r.flag || '' }; };
  const SCEN = { newest: [], always: [] };
  const fieldDiff = {};
  let overlaid = { newest: 0, always: 0 }, considered = 0;
  for (const s of rows) {
    if (s.instrumentType === 'ETF') continue;
    const ov = overlayFor(rel.get(s.symbol) || []);
    considered++;
    if (!ov) continue;
    const tdReport = s.lastEarningsDate ? String(s.lastEarningsDate).slice(0, 10) : null;
    const behind = !tdReport || t(ov.filed) - t(tdReport) > 5 * DAY;
    for (const [k, v] of Object.entries(ov.fields)) {
      const a = Number(s[k]);
      if (s[k] == null || !Number.isFinite(a)) continue;
      (fieldDiff[k] = fieldDiff[k] || []).push({ sym: s.symbol, td: a, rel: v, behind });
    }
    const base = ev(s);
    for (const scen of ['newest', 'always']) {
      if (scen === 'newest' && !behind) continue;
      overlaid[scen]++;
      const alt = ev(Object.assign({}, s, ov.fields));
      if (alt.v !== base.v || alt.why !== base.why) SCEN[scen].push({ sym: s.symbol, from: base.v, to: alt.v, whyFrom: base.why, whyTo: alt.why, fields: ov.fields, td: Object.fromEntries(Object.keys(ov.fields).map((k) => [k, s[k]])) });
    }
  }
  const total = rows.filter((s) => s.instrumentType !== 'ETF').length;
  console.log(`\nCompanies scored: ${total} (funds left out); with release inputs to lay over: newest-wins ${overlaid.newest}, always ${overlaid.always}\n`);
  for (const scen of ['newest', 'always']) {
    const ch = SCEN[scen];
    const verdict = ch.filter((x) => x.from !== x.to);
    console.log(`${scen === 'newest' ? 'NEWEST WINS' : 'ALWAYS'}: verdict changes ${verdict.length} of ${total} (${(100 * verdict.length / total).toFixed(1)}%); the rule that fired changed, verdict the same: ${ch.length - verdict.length}`);
    const tr = {};
    for (const x of verdict) { const k = x.from + ' -> ' + x.to; tr[k] = (tr[k] || 0) + 1; }
    for (const [k, n] of Object.entries(tr).sort((a, b) => b[1] - a[1])) console.log('   ' + String(n).padStart(4) + '  ' + k);
    console.log('   e.g. ' + verdict.slice(0, 8).map((x) => `${x.sym} ${x.from} -> ${x.to} (${x.whyTo || x.whyFrom})`).join('; '));
  }
  console.log('\nTHE INPUTS THEMSELVES: release-based against Twelve Data, where both exist (median absolute gap; share within 1 point or 2%)');
  for (const [k, a] of Object.entries(fieldDiff)) {
    const pct = /Ttm$/.test(k);
    const gaps = a.map((x) => (pct ? Math.abs(x.rel - x.td) / Math.max(1, Math.abs(x.td)) * 100 : Math.abs(x.rel - x.td))).sort((x, y) => x - y);
    const close = gaps.filter((g) => g <= (pct ? 2 : 1)).length;
    const cur = a.filter((x) => !x.behind), cg = cur.map((x) => (pct ? Math.abs(x.rel - x.td) / Math.max(1, Math.abs(x.td)) * 100 : Math.abs(x.rel - x.td))).sort((x, y) => x - y);
    console.log(`   ${k.padEnd(18)} n ${String(a.length).padStart(5)}  median gap ${gaps[gaps.length >> 1].toFixed(1)}${pct ? '%' : ' pts'}  close ${(100 * close / a.length).toFixed(0)}%   | Twelve Data on the same report: n ${cg.length}, close ${cg.length ? (100 * cg.filter((g) => g <= (pct ? 2 : 1)).length / cg.length).toFixed(0) : '-'}%`);
  }
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ total, overlaid, changes: SCEN, fieldDiff }, null, 1)); console.log('\nwritten ' + JSON_OUT); }
  process.exit(0);
})();
