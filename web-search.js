// Search the companies' own website text kept in the LOCAL web-archive.db
// (website-load.js; docs/context/company-websites.md). Full-text, word forms
// matched ("well" finds "wells"), best match first, grouped by company. No
// request to anywhere. The pages it finds are what a question to a model
// would be given.
//
//   node web-search.js "water well"                      # a phrase
//   node web-search.js "pump AND (repair OR service)"     # the index's own syntax
//   node web-search.js "family owned" --state WV,OH --limit 30
//   node web-search.js --stats
'use strict';
const path = require('path');

// A plain phrase is searched as a phrase; anything with the index's own
// operators or quotes is passed as written.
function toMatch(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  if (/["()*]|\b(AND|OR|NOT|NEAR)\b/.test(s)) return s;
  return '"' + s.replace(/"/g, '') + '"';
}

// Companies whose pages match, each with its best pages and a snippet.
function search(web, db, q, opts = {}) {
  const m = toMatch(q);
  if (!m) return [];
  const rows = web.prepare(`select p.ein, p.url, p.kind, bm25(pages_fts) rank, snippet(pages_fts, 0, '[', ']', ' … ', 14) snip
    from pages_fts join pages p on p.rowid = pages_fts.rowid where pages_fts match ? order by rank limit 2000`).all(m);
  const site = db ? db.prepare('select name, city, state, domain from web_sites where ein = ?') : null;
  const staff = db ? db.prepare('select staff, year, business_code from f5500_latest where ein = ?') : null;
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.ein)) {
      const s = site ? site.get(r.ein) || {} : {};
      const f = staff ? staff.get(r.ein) || {} : {};
      by.set(r.ein, { ein: r.ein, name: s.name || null, city: s.city || null, state: s.state || null, domain: s.domain || null, staff: f.staff ?? null, staffYear: f.year ?? null, code: f.business_code ?? null, best: r.rank, pages: [] });
    }
    const c = by.get(r.ein);
    if (c.pages.length < (opts.perCompany || 3)) c.pages.push({ url: r.url, kind: r.kind, snippet: r.snip.replace(/\s+/g, ' ') });
    c.hits = (c.hits || 0) + 1;
  }
  let out = [...by.values()];
  if (opts.states) out = out.filter((c) => opts.states.includes(c.state));
  return out.sort((a, b) => a.best - b.best).slice(0, opts.limit || 20);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const { DatabaseSync } = require('node:sqlite');
  const web = new DatabaseSync(path.join(__dirname, 'web-archive.db'), { readOnly: true });
  const db = new DatabaseSync(path.join(__dirname, 'formd.db'), { readOnly: true });
  if (argv.includes('--stats')) {
    console.log(web.prepare('select count(*) pages, count(distinct ein) companies, round(sum(length(text)) / 1e6, 1) million_chars from pages').get());
    console.log(web.prepare('select count(*) crawls, count(distinct ein) sites, sum(pages) pages from crawls').get());
    console.log(web.prepare('select count(*) earlier_versions from pages_history').get());
    process.exit(0);
  }
  const q = argv.find((a, i) => !a.startsWith('--') && !['--state', '--limit'].includes(argv[i - 1]));
  if (!q) { console.error('give a phrase, e.g.  node web-search.js "water well"'); process.exit(1); }
  const states = arg('--state') ? arg('--state').toUpperCase().split(',') : null;
  const res = search(web, db, q, { limit: Number(arg('--limit')) || 20, states });
  if (!res.length) console.log('Nothing found for ' + toMatch(q));
  for (const c of res) {
    console.log(`\n${c.name || c.ein} — ${[c.city, c.state].filter(Boolean).join(', ')}${c.staff != null ? ` · ${c.staff} staff (${c.staffYear})` : ''} · ${c.domain || ''} · ${c.hits} page${c.hits === 1 ? '' : 's'}`);
    for (const p of c.pages) console.log(`   ${p.kind.padEnd(11)} ${p.url}\n               ${p.snippet}`);
  }
}

module.exports = { toMatch, search };
