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

  console.log('session tokens are stored hashed (backlog 44d)');
  const kim = await store.createUser({ email: 'kim@example.com', passwordHash: 'h', salt: 's', role: 'member', status: 'active', name: 'Kim' });
  const kimId = Number(kim.id);
  await store.createSession('tok-new-1', kimId, Date.now() + 3600000);
  const stored = one('select token from sessions where user_id = ?', kimId).token;
  check('the table does not hold the token', stored !== 'tok-new-1' && stored.startsWith('h1:'), true);
  check('the token still signs in', (await store.getSessionUser('tok-new-1') || {}).email, 'kim@example.com');
  mem.prepare('insert into sessions (token, user_id, created_at, expires_at) values (?, ?, ?, ?)').run('legacy-raw-token', kimId, new Date().toISOString(), Date.now() + 3600000);
  check('a session from before hashing still signs in', (await store.getSessionUser('legacy-raw-token') || {}).email, 'kim@example.com');
  check('and is rewritten to its hash on that use', one("select count(*) n from sessions where token = 'legacy-raw-token'").n, 0);
  check('and still signs in afterwards', (await store.getSessionUser('legacy-raw-token') || {}).email, 'kim@example.com');
  await store.deleteSession('legacy-raw-token');
  check('logout removes it by either form', await store.getSessionUser('legacy-raw-token'), null);

  console.log('email verification at sign-up (backlog 44d)');
  const una = await store.createUser({ email: 'una@example.com', passwordHash: 'p1', salt: 's1', role: 'member', status: 'unverified', name: 'Una' });
  const unaId = Number(una.id);
  await store.createSession('una-sess', unaId, Date.now() + 3600000);
  check('an unverified account cannot use a session', await store.getSessionUser('una-sess'), null);
  await store.setVerification(unaId, 'vh-1');
  check('the link is found while waiting', (await store.readVerification('vh-1') || {}).email, 'una@example.com');
  await store.replaceUnverified(unaId, { passwordHash: 'p2', salt: 's2', name: 'Una Two' });
  check('signing up again replaces the waiting password', one('select password_hash, name from users where id = ?', unaId), { password_hash: 'p2', name: 'Una Two' });
  await store.setVerification(unaId, 'vh-2');
  check('the newer link replaces the older one', await store.readVerification('vh-1'), null);
  mem.prepare('update users set verify_sent_at = ? where id = ?').run(Date.now() - 25 * 3600000, unaId);
  check('an expired link is refused', (await store.consumeVerification('vh-2', 24 * 3600000, 'active')).expired, true);
  mem.prepare('update users set verify_sent_at = ? where id = ?').run(Date.now(), unaId);
  const v = await store.consumeVerification('vh-2', 24 * 3600000, 'active');
  check('a fresh link activates', [v.status, one('select status from users where id = ?', unaId).status], ['active', 'active']);
  check('and works only once', await store.consumeVerification('vh-2', 24 * 3600000, 'active'), null);
  check('replaceUnverified cannot touch an active account', (await store.replaceUnverified(unaId, { passwordHash: 'evil', salt: 'x', name: 'x' }), one('select password_hash from users where id = ?', unaId).password_hash), 'p2');
  const gus = await store.createUser({ email: 'gus@example.com', passwordHash: 'squatter', salt: 'sq', role: 'member', status: 'unverified', name: 'Squatter' });
  await store.claimUnverified(Number(gus.id), 'google-sub-1', 'active');
  const g = one('select status, google_sub, password_hash from users where id = ?', Number(gus.id));
  check('Google claims an unverified account and replaces its password', [g.status, g.google_sub, g.password_hash !== 'squatter'], ['active', 'google-sub-1', true]);
  const vic = await store.createUser({ email: 'vic@example.com', passwordHash: 'h', salt: 's', role: 'member', status: 'unverified', name: 'Vic' });
  await store.approveUser(Number(vic.id));
  check('approval does not activate an unverified account', one('select status from users where id = ?', Number(vic.id)).status, 'unverified');
  await store.markVerified(Number(vic.id), 'active');
  check('a password reset activates it', one('select status from users where id = ?', Number(vic.id)).status, 'active');
  await store.markVerified(Number(vic.id), 'pending');
  check('and markVerified does nothing to an account already active', one('select status from users where id = ?', Number(vic.id)).status, 'active');

  console.log('caps and claims hold when requests arrive together (backlog 45f)');
  const cap = 'cap@example.com';
  for (let i = 0; i < 3; i++) await store.createAlert({ userKey: cap, symbol: 'S' + i, kind: 'price_above', params: { price: 1 }, max: 3 });
  check('three alerts under a cap of three', one('select count(*) n from alerts where user_key = ?', cap).n, 3);
  const extra = await Promise.all([1, 2].map((i) => store.createAlert({ userKey: cap, symbol: 'X' + i, kind: 'price_above', params: { price: 1 }, max: 3 })));
  check('two more at once are both refused', [extra.every((x) => x === null), one('select count(*) n from alerts where user_key = ?', cap).n], [true, 3]);
  const pk = 'paper@example.com';
  check('a first trade against an empty ledger goes in', await store.addPaperTrade(pk, { ts: 1, kind: 'open', symbol: 'AAA', shares: 1, price: 10 }, 0), true);
  const lastId = one('select max(id) id from paper_trades where user_key = ?', pk).id;
  const both = [
    await store.addPaperTrade(pk, { ts: 2, kind: 'open', symbol: 'BBB', shares: 1, price: 10 }, lastId),
    await store.addPaperTrade(pk, { ts: 3, kind: 'open', symbol: 'CCC', shares: 1, price: 10 }, lastId),
  ];
  check('of two trades read against the same ledger, only the first lands', both, [true, false]);
  check('so the ledger holds two trades, not three', one('select count(*) n from paper_trades where user_key = ?', pk).n, 2);
  const claimA = await store.claimSends('post-1', ['a@example.com', 'b@example.com']);
  const claimB = await store.claimSends('post-1', ['b@example.com', 'c@example.com']);
  check('a broadcast batch gets back the addresses it claimed', claimA, ['a@example.com', 'b@example.com']);
  check('a second batch at the same moment does not get b again', claimB, ['c@example.com']);

  console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error('TEST HARNESS FAILED:', e.message); process.exitCode = 1; });
