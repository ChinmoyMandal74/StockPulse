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

console.log('isEmail: the length before the pattern');
check('a normal address passes', AuthSec.isEmail('jo@example.com'), true);
check('254 characters pass', AuthSec.isEmail('a'.repeat(242) + '@example.com'), true);
check('255 characters are refused', AuthSec.isEmail('a'.repeat(243) + '@example.com'), false);
check('not a string is refused', AuthSec.isEmail(null), false);
const t0 = Date.now();
AuthSec.isEmail('a@' + '.'.repeat(100000) + '@');
check('a 100KB run of dots is refused at once (under 20ms)', Date.now() - t0 < 20, true);

console.log('crossSite');
check('cross-site is refused', AuthSec.crossSite('cross-site'), true);
check('any case', AuthSec.crossSite('Cross-Site'), true);
check('same-origin passes', AuthSec.crossSite('same-origin'), false);
check('same-site passes', AuthSec.crossSite('same-site'), false);
check('none (typed URL, bookmark) passes', AuthSec.crossSite('none'), false);
check('no header (schedulers, old browsers) passes', AuthSec.crossSite(undefined), false);

console.log('snapTo: a cache key from a fixed set');
const SET = [5, 21, 63, 90, 126, 253];
check('a listed value is kept', SET.map((d) => AuthSec.snapTo(SET, d, 90)), SET);
check('a fraction snaps to the nearest', AuthSec.snapTo(SET, 62.7, 90), 63);
check('far above snaps to the top', AuthSec.snapTo(SET, 560, 90), 253);
check('nonsense takes the fallback', [AuthSec.snapTo(SET, 'x', 90), AuthSec.snapTo(SET, -4, 90), AuthSec.snapTo(SET, 0, 90)], [90, 90, 90]);
let keys = new Set();
for (let d = 5; d <= 560; d += 0.5) keys.add(AuthSec.snapTo(SET, d, 90));
check('1,111 different requests make at most six cache keys', keys.size <= SET.length, true);

console.log('ConsoleDo: a ?do= link starts at once only after a console click');
{
  const vm = require('vm');
  const store = {};
  let asked = 0, answer = false;
  const sandbox = {
    window: { confirm: () => { asked++; return answer; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    location: { pathname: '/refreshes', href: 'https://www.tickrlab.com/refreshes', origin: 'https://www.tickrlab.com' },
    document: { addEventListener: () => {} }, URL, Date, JSON, String, Number,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'private', 'consoledo.js'), 'utf8'), sandbox);
  const CD = sandbox.window.ConsoleDo;
  const mark = (id, at) => sandbox.localStorage.setItem('consoleDo', JSON.stringify({ id, at }));
  asked = 0; answer = false;
  check('no console click: asked, and refused when declined', [CD.allowed('refreshall', 'Start?'), asked], [false, 1]);
  asked = 0; answer = true;
  check('no console click: asked, and allowed when accepted', [CD.allowed('refreshall', 'Start?'), asked], [true, 1]);
  asked = 0; mark('/refreshes|refreshall', Date.now());
  check('a fresh console click for this job: not asked', [CD.allowed('refreshall', 'Start?'), asked], [true, 0]);
  check('the mark is used up', sandbox.localStorage.getItem('consoleDo'), null);
  asked = 0; answer = false; mark('/refreshes|refresh', Date.now());
  check('a click for a different job does not count', [CD.allowed('refreshall', 'Start?'), asked], [false, 1]);
  asked = 0; mark('/refreshes|refreshall', Date.now() - 61000);
  check('a click over a minute old does not count', [CD.allowed('refreshall', 'Start?'), asked], [false, 1]);
  asked = 0; mark('/news-runs|refreshall', Date.now());
  check('a click for another page does not count', [CD.allowed('refreshall', 'Start?'), asked], [false, 1]);
}

console.log('security headers: one policy, two places (backlog 44e)');
{
  const vj = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
  const rule = (vj.headers || []).find((h) => h.source === '/(.*)');
  const got = rule ? Object.fromEntries(rule.headers.map((h) => [h.key, h.value])) : {};
  check('vercel.json carries exactly the headers the app sends', got, AuthSec.SECURITY_HEADERS);
  const csp = AuthSec.CSP;
  check('no other origin may frame the site', /frame-ancestors 'none'/.test(csp), true);
  check('no plugins', /object-src 'none'/.test(csp), true);
  check('scripts only from this site (plus its inline ones)', /script-src 'self' 'unsafe-inline'(;|$)/.test(csp), true);
  check('the promo studio may fetch Google Fonts', /connect-src[^;]*fonts\.googleapis\.com[^;]*fonts\.gstatic\.com/.test(csp), true);
  check('server.js sends them on every response', /res\.set\(AuthSec\.SECURITY_HEADERS\)/.test(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')), true);
}

console.log('server.js signs nothing with the admin password');
const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
check('no HMAC is keyed on ADMIN_PASSWORD', /createHmac\(\s*'sha256'\s*,\s*ADMIN_PASSWORD/.test(srv), false);
check('the gate uses assetRel', /const rel = AuthSec\.assetRel\(req\.path\)/.test(srv), true);

console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exitCode = failed ? 1 : 0;
