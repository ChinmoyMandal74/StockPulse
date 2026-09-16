// Every SQL statement in db.js, checked against SQLite's own query planner.
//
//   node query-plan-test.js            # fails if anything scans a big table
//   node query-plan-test.js --all      # also prints the plan for every statement
//
// Why this exists: on 2026-09-15 three queries on the refresh path each read
// the whole `bars` table (1.08M rows) every round — Turso meters rows read and
// sent a quota warning the same evening. Every one of them was FAST (133-261ms),
// so no timing would have caught them; what they had in common is that SQLite
// planned them as `SCAN bars` rather than `SEARCH bars USING INDEX`.
//
// So this is a planner test, not a performance test. It needs no network and no
// data: the schema is read out of db.js and applied to an in-memory database.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
const VERBOSE = process.argv.includes('--all');

// Tables where a full scan is a quota event rather than a rounding error.
const BIG = ['bars', 'fundamentals_history', 'earnings_history', 'news', 'activity', 'visitors', 'snapshot'];

// Statements that scan on purpose, each with the reason it is allowed to.
// A new entry here is a decision, which is the point of naming them.
const ALLOWED = [
  // The counts ARE the product on /database, cached five minutes, and no index
  // can answer "how many rows".
  /^select count\(\*\)/i,
  /from pragma_table_info/i,
  /select distinct symbol from/i,          // the orphan sweep, run by hand
  // Whole-collection reads of small tables the app holds in memory anyway.
  /from (portfolios|portfolio_tickers|names|profiles|universe|screens|column_views|app_meta|user_portfolios|prefs|refresh_state|nasdaq_listings)\b/i,
  // Date-ranged reads of the archive: these are the product (a chart, the
  // sparklines, a refresh round's window). They read what they return.
  /select symbol, d, close from bars\s+where d >= \?/i,
  /where symbol in \(\?\) and d >= \?/i,
  // The two log tails. "SCAN" overstates these: they are ordered by the
  // integer primary key with a LIMIT, so SQLite walks the b-tree backwards and
  // stops at the limit rather than reading the table.
  /from (visitors|activity) order by id desc limit \?/i,
  // The admin rollups on /activity and /news-runs. They do read the table, but
  // both are pruned (activity to ACTIVITY_KEEP_DAYS 60, news to 21 days and 25
  // items a symbol) and both are one admin page load, not the refresh path.
  // Measured 2026-09-15: activity 1,236 rows, news 5,849.
  /from activity group by (user|kind)/i,
  /select symbol, count\(\*\) as n from news group by symbol/i,
  // The hover card's latest headline per symbol: a covering-index pass over
  // the same bounded news table, once per screener load.
  /from news n\s+join \(select symbol, max\(published_at\)/i,
];

function schemaStatements() {
  // SCHEMA and ADDED_COLUMNS are plain arrays of template literals.
  const grab = (name) => {
    const i = SRC.indexOf(`const ${name} = [`);
    if (i < 0) throw new Error(`${name} not found in db.js`);
    let j = SRC.indexOf('[', i), depth = 0, k = j;
    for (; k < SRC.length; k++) {
      if (SRC[k] === '[') depth++;
      else if (SRC[k] === ']' && --depth === 0) break;
    }
    return new Function(`return ${SRC.slice(j, k + 1)};`)();
  };
  return [...grab('SCHEMA'), ...grab('ADDED_COLUMNS')];
}

// Every SQL literal in db.js: `sql: \`...\`` / `sql: '...'` and db.execute('...').
function statements() {
  const out = [];
  const push = (raw, at) => {
    const sql = raw.trim();
    if (sql && /^(select|insert|update|delete|with)/i.test(sql)) out.push({ sql, line: at });
  };
  const lineAt = (idx) => SRC.slice(0, idx).split('\n').length;
  for (const m of SRC.matchAll(/sql:\s*`([\s\S]*?)`/g)) push(m[1], lineAt(m.index));
  for (const m of SRC.matchAll(/sql:\s*'([^']*)'/g)) push(m[1], lineAt(m.index));
  for (const m of SRC.matchAll(/db\.execute\(\s*`([\s\S]*?)`\s*\)/g)) push(m[1], lineAt(m.index));
  for (const m of SRC.matchAll(/db\.execute\(\s*'([^']*)'\s*\)/g)) push(m[1], lineAt(m.index));
  for (const m of SRC.matchAll(/db\.execute\(\s*"([^"]*)"\s*\)/g)) push(m[1], lineAt(m.index));
  return out;
}

// `${...}` inside a query is either a value list or a table/column name. Try the
// value reading first, then the ones that name a table, so both shapes prepare.
function candidates(sql) {
  const asValues = sql.replace(/\$\{[^}]*\}/g, '?');
  const asTable = sql.replace(/\$\{[^}]*table[^}]*\}/gi, 'bars').replace(/\$\{[^}]*\}/g, '?');
  const asCols = sql.replace(/\$\{[^}]*cols[^}]*\}/gi, 'symbol').replace(/\$\{[^}]*\}/g, '?');
  return [...new Set([asValues, asTable, asCols])];
}

const db = new DatabaseSync(':memory:');
for (const stmt of schemaStatements()) {
  try { db.exec(stmt); } catch (e) { if (!/already exists|duplicate column/i.test(e.message)) throw e; }
}

let checked = 0, skipped = 0;
const offenders = [];
for (const { sql, line } of statements()) {
  let plan = null;
  for (const cand of candidates(sql)) {
    try {
      plan = db.prepare('explain query plan ' + cand).all().map((r) => r.detail).join(' | ');
      break;
    } catch { /* try the next reading */ }
  }
  if (plan == null) { skipped++; if (VERBOSE) console.log(`SKIP  db.js:${line}  ${sql.slice(0, 70).replace(/\s+/g, ' ')}`); continue; }
  checked++;
  if (VERBOSE) console.log(`db.js:${line}  ${sql.slice(0, 64).replace(/\s+/g, ' ')}\n      ${plan}`);
  if (ALLOWED.some((re) => re.test(sql.replace(/\s+/g, ' ')))) continue;
  const scans = BIG.filter((t) => new RegExp(`SCAN ${t}\\b`, 'i').test(plan));
  if (scans.length) offenders.push({ line, sql: sql.replace(/\s+/g, ' ').slice(0, 100), plan, scans });
}

console.log(`\n${checked} statements planned, ${skipped} could not be prepared (dynamic SQL)`);
if (!offenders.length) {
  console.log('PASS — nothing scans a big table that is not on the allowlist.');
  process.exit(0);
}
console.log(`FAIL — ${offenders.length} statement(s) scan a big table:\n`);
for (const o of offenders) {
  console.log(`  db.js:${o.line}  scans ${o.scans.join(', ')}`);
  console.log(`    ${o.sql}`);
  console.log(`    ${o.plan}\n`);
}
console.log('Either seek per symbol (one indexed lookup each) or, if the scan is');
console.log('deliberate, add it to ALLOWED in this file with the reason.');
process.exit(1);
