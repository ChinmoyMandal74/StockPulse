// Account data that must not pass between people (backlog 45, 2026-10-18).
//
//   node account-data-test.js
//
// Runs db.js's own functions against Node's in-memory SQLite: db.js reaches
// its database only through `store.db.execute` / `store.db.batch`, and both
// are replaced before the first call, so nothing here can touch Turso.
'use strict';
process.env.TURSO_DATABASE_URL = 'libsql://in-memory-test.invalid';
process.env.TURSO_AUTH_TOKEN = 'none';
const { DatabaseSync } = require('node:sqlite');
const store = require('./db.js');

const mem = new DatabaseSync(':memory:');
const run = (stmt) => {
  const sql = typeof stmt === 'string' ? stmt : stmt.sql;
  const args = (typeof stmt === 'string' ? [] : stmt.args || []).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const p = mem.prepare(sql);
  if (/^\s*(select|pragma|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return { rows: p.all(...args), rowsAffected: 0 };
  const r = p.run(...args);
  return { rows: [], rowsAffected: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
};
store.db.execute = async (stmt) => run(stmt);
store.db.batch = async (stmts) => {
  mem.exec('begin');
  try { const out = (stmts || []).map(run); mem.exec('commit'); return out; } catch (e) { mem.exec('rollback'); throw e; }
};

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}
const one = (sql, ...a) => mem.prepare(sql).get(...a);
// The per-address gap between confirmation mails is a minute; tests step past it.
const age = (email) => mem.prepare('update subscribers set confirm_sent_at = confirm_sent_at - 3600000 where email = ?').run(email);

(async () => {
  await store.init();

  console.log('a subscription request cannot rewrite someone else\'s row');
  const jo = 'jo@example.com';
  const first = await store.startSubscribe({ email: jo, topics: ['blog'], source: 'blog', ip: '1.1.1.1' });
  await store.confirmSubscribe(first.token);
  const before = one('select status, topics, source, ip, unsub_token from subscribers where email = ?', jo);
  check('Jo is active', before.status, 'active');
  mem.prepare("update subscribers set status = 'unsubscribed', unsubscribed_at = ? where email = ?").run(Date.now(), jo);
  age(jo);
  const stranger = await store.startSubscribe({ email: jo, topics: ['blog', 'digest'], source: 'forged', ip: '6.6.6.6' });
  const after = one('select status, topics, source, ip, unsub_token from subscribers where email = ?', jo);
  check('a token was issued (the mail goes to Jo, who may click it)', !!stranger.token, true);
  check('status untouched until the link is clicked', after.status, 'unsubscribed');
  check('topics untouched', after.topics, before.topics);
  check('consent record (source, address) untouched', [after.source, after.ip], [before.source, before.ip]);
  check('unsubscribe token untouched', after.unsub_token, before.unsub_token);
  const done = await store.confirmSubscribe(stranger.token);
  const confirmed = one('select status, topics, source, ip, unsub_token, pending from subscribers where email = ?', jo);
  check('clicking the link applies the request', [confirmed.status, JSON.parse(confirmed.topics)], ['active', ['blog', 'digest']]);
  check('and records its consent', [confirmed.source, confirmed.ip], ['forged', '6.6.6.6']);
  check('and reissues the unsubscribe token', confirmed.unsub_token !== before.unsub_token && done.unsubToken === confirmed.unsub_token, true);
  check('and clears the waiting request', confirmed.pending, null);
  const fresh = await store.startSubscribe({ email: 'new@example.com', topics: ['blog'], source: 'blog', ip: '2.2.2.2' });
  check('a first subscription still starts pending with its topics', one('select status, topics from subscribers where email = ?', 'new@example.com'), { status: 'pending', topics: '["blog"]' });
  check('an active subscriber is told "already"', (await store.startSubscribe({ email: jo, topics: ['blog'] })).already, true);
  check('the link cannot be used twice', await store.confirmSubscribe(stranger.token), null);
  void fresh;

  console.log('a deleted account\'s alerts are archived, not inherited');
  const sam = 'sam@example.com';
  const u = await store.createUser({ email: sam, passwordHash: 'h', salt: 's', role: 'member', status: 'active', name: 'Sam' });
  const uid = Number(u && u.id != null ? u.id : one('select id from users where email = ?', sam).id);
  const a1 = await store.createAlert({ userKey: sam, symbol: 'NVDA', kind: 'price_above', params: { price: 200 } });
  await store.createAlert({ userKey: sam, symbol: 'MU', kind: 'price_below', params: { price: 90 } });
  const alertId = Number((a1 && a1.id) || one('select id from alerts where user_key = ? and symbol = ?', sam, 'NVDA').id);
  mem.prepare('insert into alert_events (alert_id, user_key, symbol, at, body) values (?, ?, ?, ?, ?)').run(alertId, sam, 'NVDA', Date.now(), 'NVDA closed above 200');
  await store.createAlert({ userKey: 'other@example.com', symbol: 'AAPL', kind: 'price_above', params: { price: 1 } });
  await store.deleteUser(uid);
  check('no live alert is left under the address', one('select count(*) n from alerts where user_key = ?', sam).n, 0);
  check('no live notification is left under the address', one('select count(*) n from alert_events where user_key = ?', sam).n, 0);
  check('both alerts are in the archive under the account id', one('select count(*) n from alerts_archive where user_id = ?', uid).n, 2);
  check('the notification is in the archive', one('select count(*) n from alert_events_archive where user_id = ?', uid).n, 1);
  check('the archive keeps the alert itself', one('select symbol, kind from alerts_archive where id = ?', alertId), { symbol: 'NVDA', kind: 'price_above' });
  const cols = mem.prepare('pragma table_info(alerts_archive)').all().map((c) => c.name).concat(mem.prepare('pragma table_info(alert_events_archive)').all().map((c) => c.name));
  check('the archive carries no email column', cols.some((c) => /user_key|email/.test(c)), false);
  check('another member\'s alert is untouched', one('select count(*) n from alerts where user_key = ?', 'other@example.com').n, 1);
  await store.createUser({ email: sam, passwordHash: 'h2', salt: 's2', role: 'member', status: 'active', name: 'New Sam' });
  check('whoever registers the address next starts with no alerts', (await store.readAlerts(sam)).length, 0);

  console.log('the refresh flag does not carry who started it');
  mem.prepare("insert or replace into refresh_state (id, started_at, updated_at, loaded, total, actor, mode) values (1, ?, ?, 0, 10, 'owner@example.com', 'full')").run(Date.now(), Date.now());
  const st = await store.readRefreshState();
  check('a running refresh is still reported', !!st && st.total, 10);
  check('without the starter\'s email', JSON.stringify(st).includes('owner@example.com') || 'actor' in st, false);

  console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error('TEST HARNESS FAILED:', e.message); process.exitCode = 1; });
