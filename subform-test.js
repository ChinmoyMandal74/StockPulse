// The subscribe box's checks against bots (subform.js). Pure: no server, no mail.
//   node subform-test.js
'use strict';
const crypto = require('crypto');
const F = require('./subform.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const KEY = 'k'.repeat(40);
const mac = (l) => crypto.createHmac('sha256', KEY).update(l).digest('hex');
const other = (l) => crypto.createHmac('sha256', 'x'.repeat(40)).update(l).digest('hex');
const none = () => null;
const T0 = 1794350000000;
const tok = F.token(T0, mac);

ok(/^\d{13}\.[0-9a-f]{32}$/.test(tok), 'a token: the time and its signature');
eq(F.check({ email: 'a@b.com', ft: tok }, T0 + 8000, mac), null, 'a person, eight seconds after the page: through');
eq(F.check({ email: 'a@b.com', ft: tok, website: 'http://spam' }, T0 + 8000, mac), 'honeypot', 'the hidden field filled: refused');
eq(F.check({ email: 'a@b.com' }, T0 + 8000, mac), 'no form token', 'a post that never loaded the page: refused');
eq(F.check({ email: 'a@b.com', ft: tok }, T0 + 1000, mac), 'too fast', 'one second after the page: refused');
eq(F.check({ email: 'a@b.com', ft: tok }, T0 + F.MAX_MS + 1, mac), 'stale form', 'a page a day old: refused');
eq(F.check({ email: 'a@b.com', ft: F.token(T0, other) }, T0 + 8000, mac), 'bad form token', 'a token signed with another key: refused');
eq(F.check({ email: 'a@b.com', ft: (T0 - 60000) + '.' + tok.split('.')[1] }, T0 + 8000, mac), 'bad form token', 'an old signature on a made-up time: refused');
eq(F.check({ email: 'a@b.com', ft: tok + 'x' }, T0 + 8000, mac), 'no form token', 'a malformed token: refused');
eq(F.check({ email: 'a@b.com' }, T0, none), null, 'no key on the server: nothing to check against (the honeypot still applies)');
eq(F.check({ email: 'a@b.com', website: 'x' }, T0, none), 'honeypot', 'the honeypot works without a key');
eq(F.token(T0, none), '', 'no key, no token');

eq(F.netOf('155.103.69.33'), '155.103.69.0/24', 'IPv4 to its /24');
eq(F.netOf('::ffff:198.12.69.94'), '198.12.69.0/24', 'a mapped IPv4 too');
eq(F.netOf('2600:1700:abcd:12::5'), '2600:1700:abcd::/48', 'IPv6 to its /48');
eq(F.netOf(''), 'unknown', 'no address');

const html = F.fields(tok);
ok(html.includes('name="ft"') && html.includes(tok) && html.includes('name="website"') && html.includes('tabindex="-1"') && html.includes('aria-hidden="true"'), 'the hidden fields: the token, and a honeypot kept from people and screen readers');

console.log(`subform-test: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
