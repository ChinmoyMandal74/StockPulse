// Adds starter screens that an existing database has never seen.
//
//   node --use-system-ca add-screen.js            dry run: what would be added
//   node --use-system-ca add-screen.js --commit   append them
//
// seedScreensOnce() writes the starter list once, ever, so a screen added to
// STARTER_SCREENS later never reaches production on its own. This appends only
// the ids named below that are not stored yet, one targeted INSERT each at the
// end of the list -- never through PUT /api/screens or writeScreens(), which
// rebuild every screen through cleanScreens() (column-groups.md).
// Nothing stored is changed or deleted.
require('dotenv').config();
const { createClient } = require('@tursodatabase/serverless/compat');

const COMMIT = process.argv.includes('--commit');
// Kept in step with server.js's STARTER_SCREENS by hand: the definition there
// is the one a fresh database gets, this is the one production gets.
const ADD = [
  { id: 'upofhigh', group: 'Technical', name: 'Strong uptrend, still well off the high',
    description: 'More than 10% above the 200-day average (Strong uptrend on our trend rules), yet still 30% or more below the 52-week high.',
    def: { filters: { actionTrend: 'Strong uptrend', pctFromHigh: '<=-30' }, sort: { key: 'pctFromHigh', dir: 1 },
      columns: ['pctFromHigh', 'vs200ma', 'oneMonthPct', 'threeMonthPct', 'range52Pos', 'actionTrend', 'av:Balanced', 'spMember'] } },
];

(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const have = await db.execute('select id, name, position from screens');
  const ids = new Set(have.rows.map((r) => r.id));
  const names = new Set(have.rows.map((r) => String(r.name).toLowerCase()));
  let pos = Math.max(-1, ...have.rows.map((r) => Number(r.position) || 0));
  for (const s of ADD) {
    if (!/^[a-z0-9]{8}$/.test(s.id)) { console.log('bad id', s.id); continue; }
    if (ids.has(s.id) || names.has(s.name.toLowerCase())) { console.log('already stored:', s.id, s.name); continue; }
    pos += 1;
    console.log((COMMIT ? 'adding ' : 'would add ') + s.id + ' "' + s.name + '" at position ' + pos);
    if (COMMIT) {
      await db.execute({
        sql: 'insert into screens (id, name, grp, position, description, def, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
        args: [s.id, s.name, s.group, pos, s.description, JSON.stringify(s.def), Date.now()],
      });
    }
  }
  if (!COMMIT) console.log('dry run; --commit to write');
})().catch((e) => { console.error(e.message); process.exit(1); });
