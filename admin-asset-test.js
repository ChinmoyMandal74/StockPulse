// Admin pages' files are refused to everyone but the admin (2026-11-09).
// Reads server.js, no server: every page whose route admits the admin only
// must be on ADMIN_ONLY_ASSET, every member page must not be, and each script
// in private/ loaded only by admin pages must be on it too.
//   node admin-asset-test.js
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const lines = src.split(/\r?\n/);
const m = /const ADMIN_ONLY_ASSET = new Set\(\[([\s\S]*?)\]\);/.exec(src);
ok(!!m, 'ADMIN_ONLY_ASSET is defined');
const listed = new Set(m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []);

// Each page route: the file it sends, and whether its first lines admit the admin only.
const adminPages = new Set(), memberPages = new Set();
lines.forEach((l, i) => {
  if (!/app\.get\(/.test(l)) return;
  const body = lines.slice(i, i + 8).join('\n');
  const f = /sendFile\(path\.join\(__dirname, 'private', '([^']+\.html)'\)/.exec(body);
  if (!f) return;
  (/isAdmin|requireAdmin/.test(body) ? adminPages : memberPages).add(f[1]);
});
ok(adminPages.size >= 30, `found the admin page routes (${adminPages.size})`);
for (const p of adminPages) if (!memberPages.has(p)) ok(listed.has(p), `admin page ${p} is on ADMIN_ONLY_ASSET`);
for (const p of memberPages) if (!adminPages.has(p)) ok(!listed.has(p), `member page ${p} is not on ADMIN_ONLY_ASSET`);
for (const p of listed) ok(fs.existsSync(path.join(__dirname, 'private', p)), `${p} exists in private/`);

// A script in private/ that only admin pages load is admin-only too.
const htmls = fs.readdirSync(path.join(__dirname, 'private')).filter((f) => f.endsWith('.html'));
const text = Object.fromEntries(htmls.map((h) => [h, fs.readFileSync(path.join(__dirname, 'private', h), 'utf8')]));
for (const js of fs.readdirSync(path.join(__dirname, 'private')).filter((f) => f.endsWith('.js'))) {
  const users = htmls.filter((h) => text[h].includes(js));
  if (users.length && users.every((h) => listed.has(h))) ok(listed.has(js), `${js}, loaded only by admin pages, is on ADMIN_ONLY_ASSET`);
}

// The gate uses it, for signed-in callers, before anything is served.
ok(/ADMIN_ONLY_ASSET\.has\(rel\) && !\(await isAdmin\(req\)\)\) return res\.status\(404\)/.test(src), 'gateAssets refuses a listed file to a non-admin with a 404');

console.log(`admin-asset-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
