// One-off migration: flat JSON files -> Turso.
//
//   node --use-system-ca migrate-to-turso.js          # dry run, reports what it would do
//   node --use-system-ca migrate-to-turso.js --commit # actually writes
//
// Idempotent: every write is a whole-collection replace, so re-running it just
// re-seeds from the files. Safe to run again if something looks wrong.
//
// The JSON files are left untouched — keep them as a backup until you are happy
// the migration took.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const store = require('./db');

const COMMIT = process.argv.includes('--commit');
const f = (n) => path.join(__dirname, n);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(f(file), 'utf8'));
  } catch {
    return fallback;
  }
}

function readLog(file) {
  try {
    return fs
      .readFileSync(f(file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

(async () => {
  const portfolios = readJson('portfolios.json', {});
  const names = readJson('names.json', {});
  const profiles = readJson('profiles.json', {});
  const snapshot = readJson('snapshot.json', null);
  const visitors = readLog('visitors.log');

  const tickerCount = Object.values(portfolios).reduce((n, a) => n + (a || []).length, 0);
  const universe = new Set(Object.values(portfolios).flat());

  console.log('Source files:');
  console.log('  portfolios.json : %d portfolios, %d memberships, %d unique symbols',
    Object.keys(portfolios).length, tickerCount, universe.size);
  console.log('  names.json      : %d names', Object.keys(names).length);
  console.log('  profiles.json   : %d profiles', Object.keys(profiles).length);
  console.log('  snapshot.json   : %s', snapshot
    ? `${(snapshot.stocks || []).length} stocks, updatedAt ${snapshot.updatedAt}`
    : '(none)');
  console.log('  visitors.log    : %d entries', visitors.length);

  if (!COMMIT) {
    console.log('\nDry run — nothing written. Re-run with --commit to migrate.');
    return;
  }

  console.log('\nWriting to Turso...');
  await store.init();

  await store.writePortfolios(portfolios);
  console.log('  portfolios      : written');

  await store.writeNames(names);
  console.log('  names           : written');

  await store.writeProfiles(profiles);
  console.log('  profiles        : written');

  if (snapshot) {
    await store.writeSnapshot(snapshot);
    console.log('  snapshot        : written');
  }

  // Visitors are append-only history, so this inserts rather than replaces.
  // Skipped if the table already holds rows, to avoid duplicating on a re-run.
  const existing = await store.db.execute('select count(*) as c from visitors');
  if (Number(existing.rows[0].c) > 0) {
    console.log('  visitors        : skipped (%d rows already present)', existing.rows[0].c);
  } else if (visitors.length) {
    const CHUNK = 200;
    for (let i = 0; i < visitors.length; i += CHUNK) {
      await store.db.batch(
        visitors.slice(i, i + CHUNK).map((e) => ({
          sql: 'insert into visitors (ts, ip, ua, ref) values (?, ?, ?, ?)',
          args: [e.ts, e.ip ?? null, e.ua ?? null, e.ref ?? null],
        })),
        'write'
      );
    }
    console.log('  visitors        : %d entries written', visitors.length);
  }

  // ---- verify by reading everything back through the same accessors --------
  console.log('\nVerifying round trip:');
  const backP = await store.readPortfolios();
  const backN = await store.readNames();
  const backPr = await store.readProfiles();
  const backS = await store.readSnapshot();
  const backV = await store.readVisitorStats(5);

  const check = (label, got, want) =>
    console.log('  ' + label.padEnd(16) + (got === want ? 'OK' : 'MISMATCH') + '  (' + got + ' vs ' + want + ')');

  check('portfolios', Object.keys(backP).length, Object.keys(portfolios).length);
  check('memberships', Object.values(backP).reduce((n, a) => n + a.length, 0), tickerCount);
  check('names', Object.keys(backN).length, Object.keys(names).length);
  check('profiles', Object.keys(backPr).length, Object.keys(profiles).length);
  check('snapshot stocks', (backS?.stocks || []).length, (snapshot?.stocks || []).length);
  check('visitors', backV.total, visitors.length);

  // Order matters: the UI colours portfolios by their index.
  const orderOk = JSON.stringify(Object.keys(backP)) === JSON.stringify(Object.keys(portfolios));
  console.log('  ' + 'portfolio order'.padEnd(16) + (orderOk ? 'OK' : 'MISMATCH'));

  // Spot-check that a large integer and a nested object survived the JSON blob.
  const sym = Object.keys(backPr)[0];
  if (sym) {
    const p = backPr[sym];
    console.log('  ' + 'profile sample'.padEnd(16) + sym + ' revenueTtm=' + p.revenueTtm + ' fetchedAt=' + p.fetchedAt);
  }
})().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
