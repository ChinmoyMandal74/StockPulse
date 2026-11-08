// Every `store.name` server.js and barsplit.js use must be something db.js exports.
//
//   node store-calls-test.js
//
// `node --check` cannot see it and a deploy builds fine: the call throws only
// when its route runs. On 2026-11-08 the splits step and the data check called
// store.readMetaJson, which db.js keeps private; the splits step would have
// failed every night. Reads the source; needs no database.
'use strict';
process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'libsql://in-memory-test.invalid';
process.env.TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'none';
const fs = require('fs');
const store = require('./db.js');

let failed = 0, n = 0;
for (const file of ['server.js', 'barsplit.js']) {
  const src = fs.readFileSync(file, 'utf8');
  const used = new Set([...src.matchAll(/\bstore\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const name of [...used].sort()) {
    n++;
    if (!(name in store)) { failed++; console.log(`  FAIL  ${file} uses store.${name}, which db.js does not export`); }
  }
  console.log(`  ${file}: ${used.size} store names used`);
}
console.log(`\n${n - failed} of ${n} store names exported${failed ? `, ${failed} MISSING` : ''}`);
process.exit(failed ? 1 : 0);
