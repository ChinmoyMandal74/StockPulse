// Does private/action.js still agree with the spreadsheet the rules came from?
//
//   node --no-warnings action-test.js
//
// `stock_action_rules.xlsx` is the authored specification for the Action
// column. Its "Scored Data" sheet holds 93 stocks and, beside every formula,
// the result Excel itself cached. So the workbook is not documentation that can
// drift from the code — it is a fixture with 2,500-odd expected values, and
// this replays every one of them.
//
// Run it after touching any rule, threshold or sub-score. A deliberate change
// shows up as a long list of mismatches on exactly the rows you meant to move;
// an accidental one shows up as a short list on rows you did not.
//
// No dependency: an xlsx is a zip of XML, and zlib.inflateRawSync is in Node.
// The same reasoning that has this project writing xlsx by hand in
// momentum-model.js rather than taking a library for one file.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Action = require('./private/action.js');

const BOOK = path.resolve('stock_action_rules.xlsx');
if (!fs.existsSync(BOOK)) {
  console.error(`no workbook at ${BOOK} — it is the fixture, so this test cannot run without it`);
  process.exit(1);
}

// ---- the smallest zip reader that can open this file -----------------------
// Walk the central directory, then inflate by name. Local headers are skipped
// because their length fields are unreliable when a writer uses a data
// descriptor; the central directory always has the truth.
function unzip(buf) {
  const out = new Map();
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const parts = unzip(fs.readFileSync(BOOK));
const xml = (n) => parts.get(n).toString('utf8');

const unesc = (t) => String(t)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const shared = [];
for (const si of xml('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []) {
  shared.push((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || [])
    .map((t) => unesc(t.replace(/<[^>]+>/g, ''))).join(''));
}

// NON-GREEDY attributes. A self-closing <c r="F16" s="10"/> otherwise lets the
// attribute group eat the trailing slash, the /> branch fails, and the closing
// branch swallows the NEXT cell — which shifts a row's columns by one and
// produced 58 phantom mismatches the first time this was written.
const CELL = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function cells(rowXml) {
  const out = {};
  let m;
  CELL.lastIndex = 0;
  while ((m = CELL.exec(rowXml))) {
    const [, col, attrs, inner = ''] = m;
    const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
    if (!v) { out[col] = null; continue; }
    const t = (/t="(\w+)"/.exec(attrs) || [, 'n'])[1];
    const raw = unesc(v[1]);
    if (t === 's') out[col] = shared[Number(raw)];
    else if (t === 'str' || t === 'inlineStr') out[col] = raw;
    else if (t === 'e') out[col] = null;
    else { const n = Number(raw); out[col] = Number.isFinite(n) ? n : raw; }
  }
  return out;
}

const sheet = xml('xl/worksheets/sheet3.xml');
const rowXmls = sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
const header = cells(rowXmls[0]);
const nameOf = {};
for (const col of Object.keys(header)) if (header[col]) nameOf[col] = header[col];

const rows = [];
for (const rx of rowXmls.slice(1)) {
  const c = cells(rx);
  const rec = {};
  for (const col of Object.keys(nameOf)) {
    const v = c[col];
    if (v !== null && v !== undefined && v !== '') rec[nameOf[col]] = v;
  }
  if (rec.Symbol) rows.push(rec);
}

// ---- the sheet's columns, as a screener row --------------------------------
// Excel serial 1 is 1900-01-01, and Excel believes 1900 was a leap year, which
// is why the epoch here is 1899-12-30.
const iso = (serial) => (serial == null ? null
  : new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10));

const toStock = (r) => ({
  symbol: r.Symbol,
  portfolios: String(r.Portfolios || '').split(';').map((x) => x.trim()).filter(Boolean),
  momentumRating: r.Momentum,
  momentumChange: r['Momentum Delta (2 weeks)'],
  qualityRating: r.Quality,
  marketCap: r['Market Cap'],
  oneMonthPct: r['1M %'],
  threeMonthPct: r['3M %'],
  pctFromHigh: r['% from 52W High'],
  rsi: r.RSI,
  vs50ma: r['vs 50D MA %'],
  vs200ma: r['vs 200D MA %'],
  maBullish: r['MA Cross'] == null ? null
    : (/^Golden/.test(r['MA Cross']) ? true : /^Death/.test(r['MA Cross']) ? false : null),
  volTrend: r['Vol Trend %'],
  earningsGrowthYoY: r['Earnings Growth %'],
  revenueGrowthYoY: r['Revenue Growth %'],
  profitMargin: r['Profit Margin %'],
  forwardPe: r['Forward P/E'],
  peg: r.PEG,
  shortPctFloat: r['Short % Float'],
  historyDays: r['History Days'],
  grossMargin: r['Gross Margin %'],
  netIncomeTtm: r['Net Income TTM'],
  fcfTtm: r['FCF TTM'],
  fcfMargin: r['FCF Margin %'],
  netCash: r['Net Cash'],
  nextEarningsDate: iso(r['Next Earnings']),
  latestDate: iso(r['Latest Data']),
});

const TECH = [['T1 MA Cross', 't1'], ['T2 vs 200D', 't2'], ['T3 vs 50D', 't3'], ['T4 RSI', 't4'],
  ['T5 Mom Delta', 't5'], ['T6 Momentum', 't6'], ['T7 Volume', 't7'], ['T8 52W High', 't8']];
const FE = [['FE1 Quality', 'fe1'], ['FE2 Earn Growth', 'fe2'], ['FE3 Rev Growth', 'fe3'],
  ['FE4 PEG', 'fe4'], ['FE5 FCF Margin', 'fe5'], ['FE6 Net Cash', 'fe6']];
const EA = [['EA1 Rev Growth', 'ea1'], ['EA2 Gross Margin', 'ea2'], ['EA3 FCF', 'ea3'],
  ['EA4 Profitable', 'ea4'], ['EA5 Short Float', 'ea5'], ['EA6 Quality', 'ea6']];

let checks = 0;
const bad = [];
const cmp = (sym, what, got, want) => {
  checks++;
  const ok = typeof want === 'string' ? got === want : Math.abs((got || 0) - (want || 0)) < 1e-9;
  if (!ok) bad.push(`${sym}  ${what}: got ${JSON.stringify(got)}, workbook says ${JSON.stringify(want)}`);
};

for (const r of rows) {
  // The defaults, deliberately: the workbook's Parameters sheet IS the defaults
  // in action.js, and this is what proves the two have not drifted.
  const a = Action.score(toStock(r), {});
  const sym = r.Symbol;
  cmp(sym, 'Company Type', a.type, r['Company Type']);
  cmp(sym, 'Est Score', a.estScore, r['Est Score']);
  for (const [col, k] of TECH) cmp(sym, col, a.tech[k], r[col] || 0);
  cmp(sym, 'Tech Score', a.tech.total, r['Tech Score'] || 0);
  if (a.type === 'Established') for (const [col, k] of FE) cmp(sym, col, a.fund[k], r[col] || 0);
  if (a.type === 'Early') for (const [col, k] of EA) cmp(sym, col, a.fund[k], r[col] || 0);
  cmp(sym, 'Fund Score', a.fund.total, r['Fund Score'] || 0);
  cmp(sym, 'Composite', a.composite, r.Composite || 0);
  cmp(sym, 'Base Rank', a.baseRank, r['Base Rank']);
  cmp(sym, 'OV Hard Sell', a.overrides.hardSell ? 1 : 0, r['OV Hard Sell'] || 0);
  cmp(sym, 'OV Hist', a.overrides.history ? 1 : 0, r['OV Hist'] || 0);
  cmp(sym, 'OV Below 200D', a.overrides.below200 ? 1 : 0, r['OV Below 200D'] || 0);
  cmp(sym, 'OV Extended', a.overrides.extended ? 1 : 0, r['OV Extended'] || 0);
  cmp(sym, 'OV Earnings', a.overrides.earnings ? 1 : 0, r['OV Earnings'] || 0);
  cmp(sym, 'Final Rank', a.rank, r['Final Rank']);
  cmp(sym, 'Action', a.action, r.Action);
  cmp(sym, 'Flags', a.flags.map((f) => f + '; ').join(''), r.Flags || '');
}

console.log(`${rows.length} stocks, ${checks} assertions against the workbook's own cached results`);
if (bad.length) {
  console.log(`\n${bad.length} MISMATCH(ES)${bad.length > 30 ? ' — first 30' : ''}:`);
  for (const b of bad.slice(0, 30)) console.log('  ' + b);
  console.log('\nIf the rules changed on purpose, re-check the workbook and update it too.');
  process.exit(1);
}
console.log('every cell matches — action.js and the workbook agree');
