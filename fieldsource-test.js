// fieldsource.js: every column the screener has carries a source, and the
// source rule's own fields follow sourcerule.js.
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
  if (g) cols.push({ id, g });
}
ok(cols.length > 150, 'the header row read', cols.length);
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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
