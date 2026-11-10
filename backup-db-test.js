// backup-db.js: copies are whole (including rows still in the -wal file), the
// zip holds every database, --only narrows, the unzipped copies go, zips stay.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const B = require('./backup-db.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
const root = path.join(tmp, 'proj');
const out = path.join(tmp, 'backups');
fs.mkdirSync(root);

// a.db: WAL mode, a connection left open so the rows stay in the -wal file.
const a = new DatabaseSync(path.join(root, 'a.db'));
a.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0; create table t (x); create table u (y)");
const ins = a.prepare('insert into t values (?)');
for (let i = 0; i < 500; i++) ins.run(i);
a.prepare('insert into u values (?)').run('k');
ok(fs.statSync(path.join(root, 'a.db-wal')).size > 0, 'fixture: rows sit in the -wal file');
const b = new DatabaseSync(path.join(root, 'b.db'));
b.exec("create table s (z); insert into s values (1), (2)");
b.close();
fs.writeFileSync(path.join(root, 'notes.txt'), 'not a database');

const logs = [];
const r = B.run([], { root, out, stamp: 'one', log: (l) => logs.push(l) });
ok(r.ok, 'the backup ran: ' + logs.join(' | '));
ok(fs.existsSync(path.join(out, 'tickrlab-db-one.zip')), 'the zip is made');
ok(!fs.existsSync(path.join(out, 'tickrlab-db-one')), 'the unzipped copies are removed');
ok(r.files.sort().join() === 'a.db,b.db', 'every .db and nothing else: ' + r.files);

// Unzip and read the copies back.
const back = path.join(tmp, 'back');
fs.mkdirSync(back);
require('child_process').spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-x', '-f', path.join(out, 'tickrlab-db-one.zip'), '-C', back]);
const ca = B.rowCounts(path.join(back, 'tickrlab-db-one', 'a.db'));
ok(ca.t === 500 && ca.u === 1, 'the copy holds the rows that were only in the -wal file: ' + JSON.stringify(ca));
ok(!fs.existsSync(path.join(back, 'tickrlab-db-one', 'a.db-wal')), 'the copy is one file, no -wal beside it');
ok(B.rowCounts(path.join(back, 'tickrlab-db-one', 'b.db')).s === 2, 'the second database comes back');

// --only, and --keep-folder.
const r2 = B.run(['--only', 'b.db', '--keep-folder'], { root, out, stamp: 'two', log: () => {} });
ok(r2.ok && r2.files.join() === 'b.db', '--only narrows to one database');
ok(fs.existsSync(path.join(out, 'tickrlab-db-two', 'b.db')), '--keep-folder keeps the copies');
ok(fs.existsSync(path.join(out, 'tickrlab-db-one.zip')), 'an earlier zip is never removed');

// A copy that lost rows or a table is caught; one the original outgrew is not.
ok(B.compare({ t: 5, u: 1 }, { t: 4, u: 1 }).length === 1, 'a copy short of rows is a problem');
ok(B.compare({ t: 5, u: 1 }, { t: 5 }).length === 1, 'a copy missing a table is a problem');
ok(B.compare({ t: 5 }, { t: 6 }).length === 0, 'rows written while copying are not a problem');
let threw = false;
try { B.run(['--only', 'none.db'], { root, out, stamp: 'three', log: () => {} }); } catch (_) { threw = true; }
ok(threw, 'nothing to back up is an error, not an empty zip');

a.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`backup-db-test: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
