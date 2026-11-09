// Acquired companies: the rules, pure (backlog 61, phase 2; loader acq-load.js,
// store acqarchive.js, notes docs/context/acquired-companies.md).
//
// THE TRAIL A PURCHASE LEAVES. A filer that completes a significant
// acquisition files an 8-K with item 2.01 ("Completion of Acquisition or
// Disposition of Assets") within four business days, and must file the
// acquired business's own financial statements under item 9.01, nearly always
// by amendment: an 8-K/A within 71 more days, the statements as an EX-99
// exhibit (audited annual accounts, often unaudited interim ones, and the
// combined pro forma figures, which are not the business's). For a private
// business those are frequently the only accounts it ever publishes.
//
// WHAT IS NOT ONE. Item 2.01 also covers disposals, and a public target's
// statements are only "incorporated by reference"; both leave an 8-K/A with
// no statements of a business. The model says which it is, and only a
// reading that is the business's own statements counts.
//
// THE MODEL COPIES, IT NEVER COMPUTES (releases.js's rule): every figure comes
// back as printed with the scale stated, and EVERY FIGURE MUST BE FOUND IN
// THE EXHIBIT TEXT, or it is dropped and named in the problems. The business's
// name and the auditor's must be in the text too.
'use strict';
const Rel = require('./releases.js');

const WINDOW_DAYS = 200;             // an amendment this long after the closing still follows it (71 days, plus extensions and late filers)
const MAX_CHARS = 400000;            // statements run 20k to 300k characters; this only guards a runaway
const MAX_DOCS = 3;                  // exhibits read a filing at most
const MODEL = 'claude-haiku-5-5';

const has = (items, code) => new RegExp('(^|,)\\s*' + code.replace('.', '\\.') + '\\s*(,|$)').test(String(items || ''));
const dayNo = (d) => Math.round(Date.parse(d + 'T12:00:00Z') / 86400000);

// The 8-Ks (and 8-K/As) in one column-array block of the submissions feed.
function filingsOf(block) {
  const out = [];
  if (!block || !Array.isArray(block.form)) return out;
  for (let i = 0; i < block.form.length; i++) {
    const form = String(block.form[i] || '');
    if (form !== '8-K' && form !== '8-K/A') continue;
    const accn = String((block.accessionNumber || [])[i] || '');
    const filed = String((block.filingDate || [])[i] || '').slice(0, 10);
    if (!accn || !/^\d{4}-\d{2}-\d{2}$/.test(filed)) continue;
    out.push({ accn, form, filed, reportDate: String((block.reportDate || [])[i] || '').slice(0, 10) || null,
      items: String((block.items || [])[i] || '') || null, doc: String((block.primaryDocument || [])[i] || '') || null });
  }
  return out;
}

// The candidates among one filer's 8-Ks: each closing (an 8-K with 2.01)
// and each amendment (an 8-K/A with 9.01 or 2.01) filed within WINDOW_DAYS
// after a closing, tied to the latest closing before it. An 8-K/A with no
// closing before it is some other correction and is left out.
function candidates(rows, since) {
  const list = [...rows].filter((r) => !since || r.filed >= since).sort((a, b) => (a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : a.accn < b.accn ? -1 : 1));
  const out = [];
  let closing = null;
  for (const r of list) {
    if (r.form === '8-K' && has(r.items, '2.01')) { closing = r; out.push({ ...r, role: 'closing', closingAccn: null }); continue; }
    if (r.form === '8-K/A' && (has(r.items, '9.01') || has(r.items, '2.01')) && closing && dayNo(r.filed) - dayNo(closing.filed) <= WINDOW_DAYS) {
      out.push({ ...r, role: 'amendment', closingAccn: closing.accn });
    }
  }
  return out;
}

// A filing's documents from its index-headers page.
function parseIndex(headers) {
  const t = String(headers || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const out = [];
  for (const m of t.matchAll(/<DOCUMENT>([\s\S]*?)(?=<DOCUMENT>|$)/g)) {
    const block = m[1];
    const tag = (n) => { const x = new RegExp('<' + n + '>([^\\n<]*)').exec(block); return x ? x[1].trim() : null; };
    const file = tag('FILENAME');
    if (!file) continue;
    const seq = Number(tag('SEQUENCE'));
    out.push({ seq: Number.isFinite(seq) ? seq : null, type: tag('TYPE'), file, description: tag('DESCRIPTION') });
  }
  return out;
}

// Which exhibits may hold the business's statements, best first: EX-99 of any
// number, as HTML or text (a PDF or an image is not read); one described as
// financial statements or audited first, a press release or pro forma
// figures last or not at all.
function pickDocs(docs) {
  const scored = [];
  for (const d of docs || []) {
    if (!/^EX-99/i.test(String(d.type || ''))) continue;
    if (!/\.(htm|html|txt)$/i.test(d.file)) continue;
    const words = (String(d.description || '') + ' ' + d.file).toLowerCase();
    let s = 0;
    if (/financ|audit|balance sheet|statements? of (operations|income)|carve|abbreviated/.test(words)) s += 2;
    if (/pro\s*-?\s*forma|proforma|\bpf\b|_pf/.test(words)) s -= 6;
    if (/press|release|news|announce/.test(words)) s -= 4;
    if (/consent|ex-?23/.test(words)) s -= 4;
    scored.push({ ...d, score: s });
  }
  return scored.filter((d) => d.score > -3).sort((a, b) => b.score - a.score || (a.seq ?? 99) - (b.seq ?? 99) || (a.file < b.file ? -1 : 1)).slice(0, MAX_DOCS);
}

// ---- what the model is asked for ---------------------------------------------------
// Plain strings throughout, "" for absent (the structured-output compiler
// refuses a schema with many nullable fields; found on the release reader).
const S = (d) => ({ type: 'string', description: d });
const FIG = (what) => S(what + ', exactly as printed for this period (digits, commas, decimal point, parentheses or a minus for a negative), no currency sign. Empty string if not shown.');
const PERIOD = { type: 'object', additionalProperties: false,
  required: ['label', 'period_end', 'months', 'audited', 'unit', 'revenue', 'gross_profit', 'operating_income', 'net_income', 'total_assets', 'total_liabilities', 'total_equity', 'cash', 'operating_cash_flow'],
  properties: {
    label: S('The column heading as printed, e.g. "Year ended December 31, 2023" or "Nine months ended September 30, 2024".'),
    period_end: S('The last day of the period (or the balance sheet date) as YYYY-MM-DD.'),
    months: { type: 'integer', description: 'Length of the period in months: 12 for a year, 3, 6 or 9 for an interim period; 0 for a balance sheet date only.' },
    audited: { type: 'string', enum: ['audited', 'unaudited', 'not stated'], description: 'Whether this period is covered by the audit report or marked unaudited.' },
    unit: { type: 'string', enum: ['units', 'thousands', 'millions', 'billions'], description: 'The scale the figures are printed in, from the statement heading (e.g. "(in thousands)").' },
    revenue: FIG('Total revenue (or net sales, total revenues)'),
    gross_profit: FIG('Gross profit'),
    operating_income: FIG('Operating income or loss (income from operations)'),
    net_income: FIG('Net income or loss'),
    total_assets: FIG('Total assets at the period end'),
    total_liabilities: FIG('Total liabilities at the period end'),
    total_equity: FIG("Total stockholders', members' or partners' equity (or deficit) at the period end"),
    cash: FIG('Cash and cash equivalents at the period end'),
    operating_cash_flow: FIG('Net cash provided by (used in) operating activities'),
  } };
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['kind', 'business', 'business_quote', 'currency', 'basis', 'auditor', 'opinion', 'periods'],
  properties: {
    kind: { type: 'string', enum: ['business statements', 'carve-out statements', 'pro forma only', 'press release', 'other'],
      description: '"business statements": the acquired (or acquiring-in) business\'s own balance sheet and income statement. "carve-out statements": statements of a division or of revenues and direct expenses only. "pro forma only": combined pro forma figures and nothing of the business alone. "press release" or "other" otherwise.' },
    business: S('The name of the business whose statements these are, exactly as printed. Empty string if none.'),
    business_quote: S('One sentence copied word for word from the notes saying what the business does (its nature of business or organisation note), at most 200 characters. Empty string if there is none.'),
    currency: S('The currency of the statements as a three-letter code, e.g. USD. Empty string if not stated.'),
    basis: { type: 'string', enum: ['US GAAP', 'IFRS', 'other', 'not stated'] },
    auditor: S('The audit firm that signed the report, exactly as printed (e.g. "Grant Thornton LLP"). Empty string if no audit report.'),
    opinion: { type: 'string', enum: ['unmodified', 'unmodified with going-concern paragraph', 'qualified', 'adverse or disclaimer', 'no audit report'] },
    periods: { type: 'array', description: 'Each period shown in the business\'s statements, newest first, at most six. Empty for pro forma only, a press release or other.', items: PERIOD },
  } };
const SYSTEM = [
  'You read an exhibit filed with an SEC Form 8-K about a completed acquisition and fill the fields asked for.',
  'Copy every figure exactly as printed; never add, subtract, convert or round. If a figure is not printed for a period, give an empty string.',
  'A pro forma combined statement is not the business\'s own; take figures only from the business\'s own statements.',
  'Do not judge the business or the purchase; only report what the document states.',
].join(' ');

function request(text, model) {
  return { model: model || MODEL, max_tokens: 4000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: '<exhibit>\n' + String(text).slice(0, MAX_CHARS) + '\n</exhibit>' }] };
}

// ---- checks ----------------------------------------------------------------------------
const FIELDS = ['revenue', 'gross_profit', 'operating_income', 'net_income', 'total_assets', 'total_liabilities', 'total_equity', 'cash', 'operating_cash_flow'];
const SCALE = { units: 1, thousands: 1e3, millions: 1e6, billions: 1e9 };
// THE SIGN. The text check ignores brackets, so a loss copied as a profit
// would pass it. A figure given as negative must appear negative somewhere in
// the text ("(14,014,393 )" once whitespace is closed up, or a minus), and one
// given as positive must appear somewhere without them. Each whole-number
// occurrence is judged by what stands just before it, spaces and a dollar
// sign skipped: "Revenues 13 $ 194,702,004" is positive (13 is a note).
function signOk(norm, printed) {
  const sp = Rel.split(printed);
  if (!sp) return true;
  const core = sp.core.replace(/[()$\s−–-]/g, '');
  if (!/^[\d.,]+$/.test(core) || !/\d/.test(core)) return true;
  const want = Rel.num(printed) < 0;
  for (let i = norm.indexOf(core); i >= 0; i = norm.indexOf(core, i + 1)) {
    const after = norm.slice(i + core.length, i + core.length + 2);
    if (/^\d/.test(after) || /^[.,]\d/.test(after)) continue;
    if (i > 0 && /[\d.,]/.test(norm[i - 1])) continue;
    let j = i - 1;
    while (j >= 0 && (norm[j] === ' ' || norm[j] === '$')) j--;
    const neg = j >= 0 && /[(\-−–]/.test(norm[j]);
    if (neg === want) return true;
  }
  return false;
}
const flat = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase();

// The answer, checked, as { read, periods, problems }. A figure not in the
// text is dropped; a name not in the text is dropped; a period with nothing
// left is dropped. THE SCALE: a period the model calls "units" takes the
// exhibit's stated scale when it states exactly one ("in thousands"), as the
// release reader learned from TD SYNNEX; stated several, "units" stands.
function check(ans, text) {
  const A = ans || {};
  const norm = String(text || '').replace(/\s+/g, ' ');
  const low = flat(text);
  const problems = [];
  const named = (label, v) => { const s = Rel.blankStr(v); if (s == null) return null; if (!low.includes(flat(s))) { problems.push(label + ' "' + s.slice(0, 80) + '" is not in the exhibit'); return null; } return s; };
  const declared = new Set([...norm.matchAll(/\bin (thousands|millions|billions)\b/gi)].map((m) => m[1].toLowerCase()));
  const kind = String(A.kind || 'other');
  const isBusiness = kind === 'business statements' || kind === 'carve-out statements';
  const read = {
    kind, is_business: isBusiness,
    business: named('business', A.business),
    what_it_does: named('business_quote', A.business_quote),
    currency: /^[A-Z]{3}$/.test(String(A.currency || '').trim()) ? String(A.currency).trim() : null,
    basis: A.basis && A.basis !== 'not stated' ? A.basis : null,
    auditor: named('auditor', A.auditor),
    opinion: A.opinion || null,
  };
  const periods = [];
  for (const p of (isBusiness ? A.periods || [] : []).slice(0, 6)) {
    let unit = SCALE[p.unit] ? p.unit : null;
    if (unit === 'units' && declared.size === 1) unit = [...declared][0];
    const row = { label: Rel.blankStr(p.label), period_end: /^\d{4}-\d{2}-\d{2}$/.test(String(p.period_end || '')) ? p.period_end : null,
      months: Number.isInteger(p.months) && p.months >= 0 && p.months <= 24 ? p.months : null,
      audited: p.audited === 'audited' ? true : p.audited === 'unaudited' ? false : null,
      currency: read.currency, unit, printed: {} };
    let any = false;
    for (const f of FIELDS) {
      const s = Rel.blankStr(p[f]);
      if (s == null) { row[f] = null; continue; }
      if (!Rel.inText(norm, s)) { problems.push(`${row.label || row.period_end || 'a period'}: ${f} "${s}" is not in the exhibit`); row[f] = null; continue; }
      if (!signOk(norm, s)) { problems.push(`${row.label || row.period_end || 'a period'}: ${f} "${s}" appears in the exhibit only with the other sign`); row[f] = null; continue; }
      const v = Rel.num(s);
      if (v == null || !unit) { row[f] = null; continue; }
      const mult = (Rel.split(s) || {}).mult;
      row[f] = v * (mult || SCALE[unit]);
      row.printed[f] = s;
      any = true;
    }
    if (!row.period_end) problems.push(`${row.label || 'a period'}: no period end date`);
    if (!any || !row.period_end) continue;
    row.printed = JSON.stringify(row.printed);
    periods.push(row);
  }
  if (isBusiness && !read.business) problems.push('no business name found in the exhibit');
  if (isBusiness && !periods.length) problems.push('statements named but no period kept');
  return { read, periods, problems };
}

module.exports = { WINDOW_DAYS, MAX_CHARS, MAX_DOCS, MODEL, FIELDS, SCHEMA, SYSTEM, has, filingsOf, candidates, parseIndex, pickDocs, request, signOk, check };
