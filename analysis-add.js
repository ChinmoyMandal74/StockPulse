// A newly added stock's whole history into the local copy (analysis.db).
//
//   node --use-system-ca --no-warnings analysis-add.js --only NSSC,FSS        # what the copy holds now
//   node --use-system-ca --no-warnings analysis-add.js --only NSSC,FSS --commit  # copy them in
//
// Why this exists: the incremental sync (analysis-db.js) brings each table from
// its local newest date less ten days, so a stock added today arrives with ten
// days of bars and nothing before; a --full rebuild fixes it but reads every
// row of every table. Two scripts that read the copy need the whole history:
// build-tech-history.js (its marks from 2007) and release-archive-load.js
// (which lists the releases to fetch from the copy's earnings_releases). Found
// on 2026-11-04 adding the four fire and safety names.
//
// Per-symbol seeks on the (symbol, ...) indexes, as analysis-db.js does. Only
// tables already in the copy are filled; run analysis-db.js --sec once if
// sec_facts or earnings_releases is absent. Each symbol's rows in a table are
// replaced in one transaction, and only when Turso returned some: a failed or
// empty read leaves the copy as it was. Nothing is written to Turso.

require('dotenv').config();
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@tursodatabase/serverless/compat');

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ONLY = argOf('--only', '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const COMMIT = process.argv.includes('--commit');
const DB_PATH = path.resolve(argOf('--path', 'analysis.db'));
const TABLES = ['bars', 'fundamentals_history', 'sec_facts', 'earnings_releases'];

(async () => {
  if (!ONLY.length) { console.error('Name the stocks: --only SYM1,SYM2'); process.exit(1); }
  const local = new DatabaseSync(DB_PATH);
  const have = (t) => !!local.prepare("select 1 x from sqlite_master where type = 'table' and name = ?").get(t);
  const count = (t, s) => local.prepare(`select count(*) n from "${t}" where symbol = ?`).get(s).n;
  const tables = TABLES.filter(have);
  const missing = TABLES.filter((t) => !have(t));
  console.log(`local copy: ${DB_PATH}`);
  if (missing.length) console.log(`  not in the copy (run analysis-db.js --sec first to include them): ${missing.join(', ')}`);
  for (const s of ONLY) console.log(`  ${s.padEnd(6)} ` + tables.map((t) => `${t} ${count(t, s)}`).join(' · '));
  if (!COMMIT) { console.log('\nDry run: nothing read from Turso. Add --commit to copy.'); return; }

  const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  for (const t of tables) {
    const cols = local.prepare(`pragma table_info("${t}")`).all().map((c) => c.name);
    const list = cols.map((c) => `"${c}"`).join(', ');
    const ins = local.prepare(`insert or replace into "${t}" (${list}) values (${cols.map(() => '?').join(', ')})`);
    for (const s of ONLY) {
      const r = await remote.execute({ sql: `select ${list} from "${t}" where symbol = ?`, args: [s] });
      if (!r.rows.length) { console.log(`  ${t.padEnd(20)} ${s.padEnd(6)} none upstream, left as it was`); continue; }
      local.exec('begin');
      try {
        local.prepare(`delete from "${t}" where symbol = ?`).run(s);
        for (const row of r.rows) ins.run(...cols.map((c) => { const v = row[c]; return v == null ? null : typeof v === 'bigint' ? Number(v) : v; }));
        local.exec('commit');
      } catch (e) { local.exec('rollback'); throw e; }
      console.log(`  ${t.padEnd(20)} ${s.padEnd(6)} ${r.rows.length} rows`);
    }
  }
  console.log('\nnow:');
  for (const s of ONLY) console.log(`  ${s.padEnd(6)} ` + tables.map((t) => `${t} ${count(t, s)}`).join(' · '));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
