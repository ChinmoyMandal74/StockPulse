// One-off, 2026-10-09: the stored words that the Advice -> Signal rename left
// behind. The code reads every old verdict word as its new one (canon() in
// private/action.js), so nothing here is needed for the app to be CORRECT --
// this is for the text a reader can still see:
//
//   screens        the two starter screens' group, name and description, and
//                  any saved definition that names an old word or a retired
//                  rule-set column
//   column_views   the starter view called "Advice", and the retired columns
//   alert_events   "X moved from Hold to Buy." in a member's alert history
//   promo_presets  DELETED (the owner's call): a saved post names a rule set
//   backtest_runs  DELETED (the owner's call): a frozen run prints the old
//                  words, and a shared link to one is public
//
// Targeted updates on raw rows -- never the PUT endpoints or writeScreens,
// which pass every screen through a cleaner (see docs/context/screens.md).
// Dry run by default.
//
//   node --use-system-ca signal-rename-data.js            # report, write nothing
//   node --use-system-ca signal-rename-data.js --commit
require('dotenv').config();
const { createClient } = require('@tursodatabase/serverless/compat');
const Action = require('./private/action.js');

const COMMIT = process.argv.includes('--commit');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const RETIRED = new Set(['av:Trend Rider', 'av:Aggressive', 'av:Max Risk', 'av:Dip Buyer']);
const PHRASES = [
  ['Strong Buys (Balanced)', 'Very Strong signals'],
  ['The Balanced rules read', 'The rules read'],
  ['The Balanced verdict', 'The signal'],
  ['Strong Buy', 'Very Strong'],
  ['Buy with Risk', 'Strong – Elevated Risk'],
  ['Sell Immediately', 'Very Weak'],
];
const words = (s) => {
  let out = String(s == null ? '' : s);
  for (const [a, b] of PHRASES) out = out.split(a).join(b);
  return out.replace(/\bAdvice\b/g, 'Signal');
};

function defNow(def) {
  if (!def || typeof def !== 'object') return def;
  if (typeof def.advice === 'string') def.advice = Action.canon(def.advice);
  if (def.filters && typeof def.filters === 'object') {
    for (const k of Object.keys(def.filters)) {
      if (RETIRED.has(k)) delete def.filters[k];
      else if (k === 'av:Balanced') def.filters[k] = Action.canon(def.filters[k]);
    }
  }
  if (Array.isArray(def.columns)) def.columns = def.columns.filter((k) => !RETIRED.has(k));
  if (def.sort && RETIRED.has(def.sort.key)) delete def.sort;
  return def;
}

(async () => {
  const stmts = [];
  const say = (what, was, now) => console.log(`  ${what}\n    - ${was}\n    + ${now}`);

  // ---- screens
  const sc = await db.execute('select id, name, grp, description, def from screens');
  let n = 0;
  for (const r of sc.rows) {
    const name = words(r.name), grp = words(r.grp), description = words(r.description);
    let def = r.def;
    try { def = JSON.stringify(defNow(JSON.parse(r.def))); } catch { /* left as stored */ }
    if (name === r.name && grp === (r.grp || '') && description === (r.description || '') && def === r.def) continue;
    n++;
    if (name !== r.name) say(`screen ${r.id} name`, r.name, name);
    if (grp !== (r.grp || '')) say(`screen ${r.id} group`, r.grp, grp);
    if (description !== (r.description || '')) say(`screen ${r.id} description`, r.description, description);
    if (def !== r.def) say(`screen ${r.id} definition`, r.def, def);
    stmts.push({ sql: 'update screens set name = ?, grp = ?, description = ?, def = ? where id = ?',
      args: [name, grp, description, def, r.id] });
  }
  console.log(`screens: ${n} of ${sc.rows.length} to update`);

  // ---- column views
  const cv = await db.execute('select id, scope, name, columns from column_views');
  n = 0;
  for (const r of cv.rows) {
    const name = words(r.name);
    let columns = r.columns;
    try {
      const list = JSON.parse(r.columns);
      if (Array.isArray(list) && list.some((k) => RETIRED.has(k))) columns = JSON.stringify(list.filter((k) => !RETIRED.has(k)));
    } catch { /* left as stored */ }
    if (name === r.name && columns === r.columns) continue;
    n++;
    say(`view ${r.id} (${r.scope === 'shared' ? 'shared' : 'personal'})`, `${r.name} · ${r.columns.length} chars`, `${name} · ${columns.length} chars`);
    stmts.push({ sql: 'update column_views set name = ?, columns = ? where id = ? and scope = ?', args: [name, columns, r.id, r.scope] });
  }
  console.log(`column views: ${n} of ${cv.rows.length} to update`);

  // ---- alert history
  const ev = await db.execute("select id, body from alert_events where body like '% moved from % to %'");
  n = 0;
  for (const r of ev.rows) {
    const body = String(r.body).replace(/ moved from (.+) to (.+)\.$/,
      (m, a, b) => ` moved from ${Action.canon(a)} to ${Action.canon(b)}.`);
    if (body === r.body) continue;
    n++;
    if (n <= 3) say(`alert event ${r.id}`, r.body, body);
    stmts.push({ sql: 'update alert_events set body = ? where id = ?', args: [body, r.id] });
  }
  console.log(`alert history: ${n} of ${ev.rows.length} verdict events to reword`);

  // ---- the two deletions
  const pp = await db.execute("select value from app_meta where key = 'promo_presets'");
  let posts = 0;
  try { const v = JSON.parse(pp.rows[0].value); posts = Array.isArray(v) ? v.length : (v && Array.isArray(v.posts) ? v.posts.length : 0); } catch { /* none */ }
  console.log(`saved promo posts: ${pp.rows.length ? posts : 0} to delete`);
  if (pp.rows.length) stmts.push({ sql: "delete from app_meta where key = 'promo_presets'", args: [] });

  const bt = await db.execute('select count(*) as n from backtest_runs');
  const runs = Number(bt.rows[0].n);
  console.log(`saved backtest runs: ${runs} to delete`);
  if (runs) stmts.push({ sql: 'delete from backtest_runs', args: [] });

  if (!COMMIT) { console.log(`\nDRY RUN: ${stmts.length} statements not sent. Re-run with --commit.`); return; }
  if (stmts.length) await db.batch(stmts, 'write');
  console.log(`\nCOMMITTED: ${stmts.length} statements.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
