// The local article text archive (newsarchive.js), against a throwaway file.
// No network, no Turso.
//
//   node newsarchive-test.js
const fs = require('fs'), os = require('os'), path = require('path');
const NA = require('./newsarchive.js');

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newsarchive-'));
const file = path.join(dir, 'a.db');
const A = NA.open(file);
const text = 'ServiceNow shares fell 27% — café, “quotes”, and 日本語 survive. '.repeat(200);
const u = 'https://example.com/a?x=1';
check('put: a new article is added', A.put({ url: u, symbol: 'now', text, headline: 'H', source: 'S', host: 'example.com', published_at: '2026-10-29T21:00:00.000Z' }).added, true);
const g = A.get(u);
check('get: the text comes back exactly, unicode and all', g.text === text, true);
check('get: the details', [g.headline, g.source, g.host, g.published_at, g.chars], ['H', 'S', 'example.com', '2026-10-29T21:00:00.000Z', text.length]);
check('stored compressed: the file is smaller than the text', A.db.prepare('select length(body) n from articles').get().n < text.length / 3, true);
check('put again: never replaced, the first text stays', [A.put({ url: u, symbol: 'CRM', text: 'other' }).added, A.get(u).text === text], [false, true]);
check('carried: both stocks are recorded, symbols upper-cased', A.db.prepare('select symbol from carried where url = ? order by symbol').all(u).map((r) => r.symbol), ['CRM', 'NOW']);
A.carry(u, 'wday');
check('carry: a third stock without touching the text', [A.forSymbol('WDAY', '2026-10-01', '2026-11-01').length, A.get(u).text === text], [1, true]);
check('forSymbol: by stock and window', [A.forSymbol('NOW', '2026-10-01', '2026-11-01').length, A.forSymbol('NOW', '2026-10-30', '2026-11-01').length, A.forSymbol('AAPL', '2026-10-01', '2026-11-01').length], [1, 0, 0]);
check('has', [A.has(u), A.has('https://example.com/b')], [true, false]);
check('get: an unknown address is null', A.get('https://example.com/b'), null);
let threw = false; try { A.put({ url: 'https://example.com/c', text: '' }); } catch (e) { threw = true; }
check('put: empty text is refused, not stored as an article', [threw, A.has('https://example.com/c')], [true, false]);
check('count', A.count(), 1);
A.close();
const B = NA.open(file);
check('reopened: everything is still there', [B.count(), B.get(u).text === text], [1, true]);
B.close();
check('the default file is beside the code and gitignored', [path.basename(NA.DEFAULT_PATH), /^news-archive\.db$/m.test(fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8'))], ['news-archive.db', true]);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${n - failed} of ${n} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exitCode = failed ? 1 : 0;
