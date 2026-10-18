// The sign-in hardening (backlog 44a/44c), held to its brief.
//
//   node authsec-test.js
//
// No server is booted and nothing touches the production database: the
// path helper and the attempt-limit rule are pure, and the attempt counter's
// SQL is read out of db.js and run on Node's in-memory SQLite.
'use strict';
const fs = require('fs');
const path = require('path');
const AuthSec = require('./authsec.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}

console.log('assetRel: the gate sees the name the file server would open');
check('plain name', AuthSec.assetRel('/lab.html'), 'lab.html');
check('root is index.html', AuthSec.assetRel('/'), 'index.html');
check('encoded spellings resolve to the same name', [AuthSec.assetRel('/lab%2Ehtml'), AuthSec.assetRel('/%6Cab.html')], ['lab.html', 'lab.html']);
check('dot and double-slash segments normalised', [AuthSec.assetRel('/./lab.html'), AuthSec.assetRel('//lab.html')], ['lab.html', 'lab.html']);
check('decoded once only', AuthSec.assetRel('/lab%252Ehtml'), 'lab%2Ehtml');
check('an undecodable path is refused', AuthSec.assetRel('/a%E0%A4%A.html'), null);
check('a backslash is refused', AuthSec.assetRel('/x%5Clab.html'), null);
check('a NUL is refused', AuthSec.assetRel('/lab.html%00'), null);

console.log('overLimit: the attempt rule');
const W = 15 * 60 * 1000, now = 1_000_000_000;
check('no row is not limited', AuthSec.overLimit(null, now, 5, W), false);
check('4 of 5 in the window is not limited', AuthSec.overLimit({ count: 4, windowStart: now - 1000 }, now, 5, W), false);
check('5 of 5 in the window is limited', AuthSec.overLimit({ count: 5, windowStart: now - 1000 }, now, 5, W), true);
check('a passed window counts as empty', AuthSec.overLimit({ count: 50, windowStart: now - W }, now, 5, W), false);
check('one millisecond inside the window still limits', AuthSec.overLimit({ count: 5, windowStart: now - W + 1 }, now, 5, W), true);

console.log('tokens');
const t1 = AuthSec.newToken(), t2 = AuthSec.newToken();
check('tokens differ per sign-in', t1 !== t2, true);
check('the stored hash is not the token', AuthSec.tokenHash(t1) !== t1 && AuthSec.tokenHash(t1).length === 64, true);

console.log('the counter statement in db.js, run on SQLite');
const src = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
const ddl = src.match(/create table if not exists auth_throttle \([\s\S]*?\)`/)[0].slice(0, -1);
const fn = src.slice(src.indexOf('async function noteAuthFailure'));
const sql = fn.match(/sql: `([\s\S]*?)`/)[1];
const { DatabaseSync } = require('node:sqlite');
const mem = new DatabaseSync(':memory:');
mem.exec(ddl);
const note = (key, at) => mem.prepare(sql).run(key, at, at - W, at - W);
const row = (key) => mem.prepare('select count, window_start from auth_throttle where key = ?').get(key);
note('k', now); note('k', now + 1000); note('k', now + 2000);
check('three failures in the window count 3', row('k').count, 3);
check('the window keeps its first start', row('k').window_start, now);
note('k', now + W + 5);
check('a failure after the window starts again at 1', [row('k').count, row('k').window_start], [1, now + W + 5]);

console.log('server.js signs nothing with the admin password');
const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
check('no HMAC is keyed on ADMIN_PASSWORD', /createHmac\(\s*'sha256'\s*,\s*ADMIN_PASSWORD/.test(srv), false);
check('the gate uses assetRel', /const rel = AuthSec\.assetRel\(req\.path\)/.test(srv), true);

console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exitCode = failed ? 1 : 0;
