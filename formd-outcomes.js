// What happens to companies after their first Form D (backlog 61, the
// owner's choice of 2026-11-09: "Company outcomes study"). Read only, over
// the LOCAL formd.db: the Form D summaries, the SEC profiles (fd_profiles)
// and the plan employers (f5500_employers). No request; writes JSON.
//
// Operating companies only (pooled funds left out). A company's cohort is
// the year of its first Form D on file. Outcomes, each as of the newest data:
//   raised again   a new offering (form D, not an amendment) filed in a later year
//   has a plan     a retirement or health plan filing under its tax ID
//   staff          its plans' headcount: first year on file and newest
//   filed to list  a registration to sell shares publicly (S-1, F-1, S-4)
//   trades now     a ticker in its profile
//   active         any Form D or plan filing for 2023 or later
// Descriptive: what happened, by cohort and industry group; nothing here
// predicts or rates a company.
//
//   node formd-outcomes.js > outcomes.json
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { GROUP_OF } = require('./formdquery.js');

function study(db) {
  const latest = db.prepare('select max(as_of) d from fd_profiles').get().d;
  const prof = new Map();
  for (const r of db.prepare('select cik, ein, tickers, forms from fd_profiles where as_of = ?').iterate(latest)) {
    let forms = {};
    try { forms = JSON.parse(r.forms || '{}'); } catch (_) { /* none */ }
    prof.set(r.cik, { ein: r.ein, tickers: r.tickers, registration: forms.registration || null });
  }
  const plans = new Map();   // ein -> [{year, staff}]
  // Only the Form D companies' tax IDs: all employers would not fit in memory.
  for (const r of db.prepare('select ein, year, staff from f5500_employers where ein in (select ein from fd_profiles where as_of = ? and ein is not null)').iterate(latest)) {
    if (!plans.has(r.ein)) plans.set(r.ein, []);
    plans.get(r.ein).push(r);
  }
  const cos = new Map();     // cik -> { first, group, newOfferingYears:Set, lastFiled, firstSold }
  for (const r of db.prepare(`select cik, filed, form, amendment, industry, sold from formd
      where cik is not null and filed is not null and coalesce(industry, '') <> 'Pooled Investment Fund' order by filed`).iterate()) {
    let c = cos.get(r.cik);
    if (!c) { c = { first: r.filed, group: GROUP_OF[r.industry] || 'Other', industry: r.industry, newYears: new Set(), last: r.filed, firstSold: r.sold }; cos.set(r.cik, c); }
    if (r.form === 'D' && !r.amendment) c.newYears.add(r.filed.slice(0, 4));
    if (r.filed > c.last) c.last = r.filed;
  }
  const rows = [];
  for (const [cik, c] of cos) {
    const y = Number(c.first.slice(0, 4));
    const p = prof.get(cik) || {};
    const pl = p.ein ? (plans.get(p.ein) || []).sort((a, b) => a.year - b.year) : [];
    const staffed = pl.filter((x) => x.staff != null);
    const reg = p.registration && p.registration.last && p.registration.last >= c.first ? true : false;
    rows.push({
      cik, cohort: y, group: c.group,
      raisedAgain: [...c.newYears].some((yy) => Number(yy) > y),
      hasPlan: pl.length > 0,
      staffFirst: staffed.length ? staffed[0].staff : null,
      staffLast: staffed.length ? staffed[staffed.length - 1].staff : null,
      filedToList: reg,
      tradesNow: !!p.tickers,
      active: c.last >= '2023-01-01' || pl.some((x) => x.year >= 2023),
    });
  }
  const pct = (a, n) => (n ? Math.round((a / n) * 1000) / 10 : null);
  const median = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  function summarise(list) {
    const n = list.length;
    const withPlan = list.filter((r) => r.hasPlan);
    const grew = withPlan.filter((r) => r.staffFirst >= 5 && r.staffLast != null);
    return {
      companies: n,
      raisedAgain: pct(list.filter((r) => r.raisedAgain).length, n),
      hasPlan: pct(withPlan.length, n),
      filedToList: pct(list.filter((r) => r.filedToList).length, n),
      tradesNow: pct(list.filter((r) => r.tradesNow).length, n),
      active: pct(list.filter((r) => r.active).length, n),
      medianStaffNow: median(withPlan.map((r) => r.staffLast)),
      staffGrowthMedian: median(grew.map((r) => r.staffLast / r.staffFirst - 1)),
      staffDoubled: pct(grew.filter((r) => r.staffLast >= 2 * r.staffFirst).length, grew.length),
    };
  }
  const byCohort = {};
  for (let y = 2009; y <= 2025; y++) byCohort[y] = summarise(rows.filter((r) => r.cohort === y));
  const groups = [...new Set(rows.map((r) => r.group))];
  const byGroup = {};
  for (const g of groups) byGroup[g] = summarise(rows.filter((r) => r.group === g && r.cohort >= 2010 && r.cohort <= 2019));
  return { asOf: latest, companies: rows.length, all2010to2019: summarise(rows.filter((r) => r.cohort >= 2010 && r.cohort <= 2019)), byCohort, byGroup };
}

if (require.main === module) {
  const db = new DatabaseSync(process.env.FORMD_DB || path.join(__dirname, 'formd.db'), { readOnly: true });
  console.log(JSON.stringify(study(db), null, 1));
}

module.exports = { study };
