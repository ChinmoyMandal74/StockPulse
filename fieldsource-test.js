// fieldsource.js: every column the screener has carries a source, and the
// source rule's own fields follow sourcerule.js. And every column has a
// definition: its header's hover text, which /fields lists (2026-11-06).
//   node fieldsource-test.js
const fs = require('fs');
const path = require('path');
const FieldSource = require('./fieldsource.js');
const SourceRule = require('./sourcerule.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// The header row, as columnCatalogue() reads it: every cell with an id and a group (or the frozen pair).
const html = fs.readFileSync(path.join(__dirname, 'private', 'index.html'), 'utf8');
const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
const cols = [];
for (const m of head.matchAll(/<th ([^>]*)>/g)) {
  const a = m[1];
  if (/class="group /.test(a)) continue;
  const id = (/data-col="([^"]+)"/.exec(a) || /data-fkey="([^"]+)"/.exec(a) || /data-key="([^"]+)"/.exec(a) || [])[1];
  if (!id) continue;
  const g = (/grp-([a-z]+)/.exec(a) || [])[1] || (/\bfrz\b/.test(a) ? 'stock' : null);
  if (g) cols.push({ id, g, def: ((/\btitle="([^"]*)"/.exec(a) || [])[1] || '').trim() });
}
ok(cols.length > 150, 'the header row read', cols.length);
// A column with no hover text has no definition on /fields; a few words is a label, not a definition.
const undefd = cols.filter((c) => c.def.length < 15).map((c) => c.g + ':' + c.id);
ok(undefd.length === 0, 'every column has a definition (its header title, 15 characters or more)', undefd);
const missing = cols.filter((c) => !FieldSource.sourceOf(c.id, c.g)).map((c) => c.g + ':' + c.id);
ok(missing.length === 0, 'every column has a source', missing);

// The rule's fields: a column under the rule reads the rule, with or without the Twelve Data fallback.
ok(FieldSource.sourceOf('revenueTtm', 'size') === FieldSource.S.rule, 'Revenue TTM: the source rule, Twelve Data last');
ok(FieldSource.sourceOf('fcfTtm', 'cflow') === FieldSource.S.ruleNoTd, 'FCF TTM: the source rule, no Twelve Data fallback');
for (const f of SourceRule.FIELDS) {
  const s = FieldSource.sourceOf(f, 'size');
  if (cols.some((c) => c.id === f)) ok(s === FieldSource.S.rule || s === FieldSource.S.ruleNoTd, f + ' follows the rule', s);
}
// Not under the rule: stays Twelve Data's.
ok(FieldSource.sourceOf('forwardPe', 'value') === 'Twelve Data (analysts’ estimate)', 'Fwd P/E stays Twelve Data');
ok(FieldSource.sourceOf('marketCap', 'info') === 'Twelve Data', 'Market Cap stays Twelve Data');
// A group default, and an unknown column in an unknown group is null, never invented.
ok(FieldSource.sourceOf('rsi', 'rel') === FieldSource.S.prices, 'RSI: from the price group default');
ok(FieldSource.sourceOf('noSuchField', 'nogroup') === null, 'an unknown column has no source');

// What a member reads names no data source (owner, 2026-11-09), for every column, and says the same thing otherwise.
const VENDOR = /twelve|\bSEC\b|finra|yahoo|nasdaq|alpha vantage|google|clearing|edgar/i;
const named = cols.filter((c) => VENDOR.test(FieldSource.publicSourceOf(c.id, c.g) || '')).map((c) => c.id + ': ' + FieldSource.publicSourceOf(c.id, c.g));
ok(named.length === 0, 'the member wording names no source', named);
ok(cols.every((c) => !!FieldSource.publicSourceOf(c.id, c.g)), 'every column keeps a member source');
ok(FieldSource.publicSourceOf('forwardPe', 'value') === 'The data feed (analysts’ estimate)', 'Fwd P/E for a member', FieldSource.publicSourceOf('forwardPe', 'value'));
ok(FieldSource.publicSourceOf('shortBuild', 'react') === 'Short interest reports', 'short interest for a member');
ok(FieldSource.publicSourceOf('instManagers', 'own') === 'Form 13F filings', 'form names stay');
ok(FieldSource.publicSourceOf('noSuchField', 'nogroup') === null, 'an unknown column has no member source either');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
