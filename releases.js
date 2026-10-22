// EARNINGS RELEASES: a company's quarterly results press release, read by an
// AI model into fixed fields (2026-10-22, the owner: "Do you think we can read
// these 99.1 exhibit details and store it in a separate table using AI" ...
// "go ahead with a prototype" ... "We don't need to build history, But you can
// go like a month back").
//
// WHERE IT COMES FROM. A results release is filed with the SEC as Exhibit 99.1
// of an 8-K carrying item 2.02 ("Results of Operations"). The daily SEC read
// (secdaily.js) already records every such 8-K in sec_events; the loader
// (release-load.js) takes the ones it has not read, fetches the exhibit, and
// hands the text to the model.
//
// THE MODEL COPIES, IT NEVER COMPUTES. Every figure comes back exactly as
// printed, with the scale the document states, and the code here does the
// arithmetic. And EVERY PRINTED FIGURE MUST BE FOUND IN THE RELEASE TEXT: one
// that is not is dropped and named in `problems`. The prototype (20 releases)
// caught the model working out a guidance range from "$8.60 billion +/- $400
// million" this way; the guidance fields now take that shape as printed.
//
// TWO EPS FIGURES, NEVER ONE. The GAAP diluted figure, and the company's own
// adjusted one stored with its own name and what it leaves out (Meta, 2026 Q3:
// $3.83 as reported, $7.40 "excluding" a $9.89 billion litigation charge).
// Adjusted has no standard definition, so it never travels without its label.
//
// DISPLAY ONLY. Nothing here reaches the Signal.
const MODEL = 'claude-haiku-5-5';
const MAX_CHARS = 350000;          // a release is 7k-70k characters; this only guards a runaway
const SCALE = { units: 1, thousands: 1e3, millions: 1e6, billions: 1e9 };
// The site's rule: nothing recommends, rates or targets (newstone.js's list).
const BANNED = /\b(buy|sell|hold|bullish|bearish|outperform|underperform|overweight|underweight|price target|target price|strong|weak)\b/i;

// HTML to text that keeps table rows readable: a row a line, cells by " | ".
function toText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ').replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&rsquo;/g, '’')
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').replace(/(\s*\|\s*)+/g, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim()).filter(Boolean).join('\n');
}

// The press release among a filing's documents, from its index-headers page:
// EX-99.1 first, else the first EX-99 of any number (NextEra files "EX-99").
function pickExhibit(indexHeaders) {
  const t = String(indexHeaders || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const docs = [...t.matchAll(/<TYPE>([^\n<]+)[\s\S]*?<FILENAME>([^\n<]+)/g)].map((m) => ({ type: m[1].trim(), file: m[2].trim() }));
  return docs.find((d) => d.type === 'EX-99.1') || docs.find((d) => /^EX-99/.test(d.type)) || null;
}
const archiveBase = (cik, accn) => 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/';

// ---- what the model is asked for -------------------------------------------------
// Plain strings throughout, "" for absent: the structured-output compiler
// refuses a schema with many nullable fields (found on the prototype).
const FIG = (what) => ({ type: 'object', additionalProperties: false, required: ['printed', 'prior_printed', 'unit'], description: what, properties: {
  printed: { type: 'string', description: 'This quarter, exactly as printed (digits, commas, decimal point, parentheses for a negative), no $ sign. Empty string if not given.' },
  prior_printed: { type: 'string', description: 'The same quarter a year earlier, exactly as printed. Empty string if not given.' },
  unit: { type: 'string', enum: ['units', 'thousands', 'millions', 'billions'], description: 'The scale the printed figures are in, from the table heading or the sentence (e.g. "In millions").' } } });
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['is_results_release', 'period_label', 'period_end', 'currency', 'revenue', 'operating_income', 'net_income', 'eps_gaap_diluted', 'eps_adjusted', 'guidance', 'summary'],
  properties: {
    is_results_release: { type: 'boolean', description: 'True only if this document reports the company’s financial results for a completed quarter. A business update, a preliminary estimate or a contract announcement is false.' },
    period_label: { type: 'string', description: 'The company’s own name for the quarter, e.g. "Third Quarter 2026".' },
    period_end: { type: 'string', description: 'The last day of the quarter reported, YYYY-MM-DD.' },
    currency: { type: 'string', description: 'ISO code of the reporting currency, e.g. USD.' },
    revenue: FIG('Total revenue (or net sales, total net revenue) for the three months, not year to date.'),
    operating_income: FIG('GAAP income (loss) from operations for the three months.'),
    net_income: FIG('GAAP net income (loss) attributable to the company for the three months.'),
    eps_gaap_diluted: { type: 'object', additionalProperties: false, required: ['printed', 'prior_printed'], description: 'GAAP diluted earnings (loss) per share for the three months.',
      properties: { printed: { type: 'string' }, prior_printed: { type: 'string' } } },
    eps_adjusted: { type: 'object', additionalProperties: false, required: ['printed', 'prior_printed', 'label', 'excludes'],
      description: 'An adjusted diluted EPS for the three months that the COMPANY states: its non-GAAP or adjusted EPS, or an EPS it gives "excluding" an item. All empty strings if it gives none.',
      properties: { printed: { type: 'string' }, prior_printed: { type: 'string' },
        label: { type: 'string', description: 'The company’s own name for it, e.g. "Non-GAAP diluted EPS", or "Diluted EPS excluding the litigation charge".' },
        excludes: { type: 'string', description: 'What it leaves out, briefly, in the company’s terms (under 160 characters).' } } },
    guidance: { type: 'object', additionalProperties: false, required: ['kind', 'period_label', 'low_printed', 'high_printed', 'mid_printed', 'plus_minus_printed', 'unit', 'sentence'],
      description: 'The outlook the release gives for a coming period, copied as printed. Never work out a range from a midpoint.',
      properties: {
        kind: { type: 'string', enum: ['revenue_range', 'revenue_midpoint', 'revenue_growth', 'eps_range', 'other', 'none'],
          description: 'revenue_range: a low and a high revenue figure. revenue_midpoint: a figure plus or minus another. revenue_growth: a percent change. eps_range: an EPS low and high. other: some other outlook. none: no outlook.' },
        period_label: { type: 'string' },
        low_printed: { type: 'string', description: 'The low end as printed (revenue_range, revenue_growth, eps_range).' },
        high_printed: { type: 'string', description: 'The high end as printed.' },
        mid_printed: { type: 'string', description: 'The central figure as printed (revenue_midpoint).' },
        plus_minus_printed: { type: 'string', description: 'The plus-or-minus figure as printed (revenue_midpoint).' },
        unit: { type: 'string', enum: ['units', 'thousands', 'millions', 'billions', 'percent', 'per_share', 'none'], description: 'The scale of low/high/mid; plus_minus may be in its own scale, given in its sentence.' },
        sentence: { type: 'string', description: 'The outlook sentence copied word for word, under 300 characters.' } } },
    summary: { type: 'string', description: 'Two or three plain sentences of what the release reports. Facts only: no opinion, no recommendation, and none of the words buy, sell, hold, strong, weak, bullish, bearish.' },
  } };
const SYSTEM = 'You read a company’s quarterly results press release and copy figures out of it into fixed fields. '
  + 'Copy each number EXACTLY as printed in the document; never compute, round, convert or derive one, and never turn a midpoint plus-or-minus into a range. '
  + 'If a figure or text is not in the document, give an empty string. Quarter figures only, never year-to-date or full-year (except in guidance, which may be for a year). '
  + 'Report what the document says; add nothing.';
function request(text, model) {
  return { model: model || MODEL, max_tokens: 3000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: '<release>\n' + String(text).slice(0, MAX_CHARS) + '\n</release>' }] };
}

// ---- checks and arithmetic -------------------------------------------------------
const blankStr = (v) => (v == null || String(v).trim() === '' || /^[—–\-−]+$/.test(String(v).trim()) || String(v).trim().toLowerCase() === 'none' ? null : String(v).trim());
// A printed figure as a number: commas gone, parentheses or a leading minus negative.
function num(p) {
  const s = blankStr(p);
  if (s == null) return null;
  const neg = /^\(.*\)$/.test(s) || /^[-−–]/.test(s);
  const digits = s.replace(/[^\d.]/g, '');
  if (!/\d/.test(digits) || (digits.match(/\./g) || []).length > 1) return null;
  const v = Number(digits);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
// Is the printed figure in the text, as a whole number token (so "2.2" is not
// found inside "12.25", nor "64" inside "64,601")?
function inText(norm, p) {
  const s = blankStr(p);
  if (s == null) return true;
  const core = s.replace(/[()$%\s−–-]/g, '');
  if (!/^[\d.,]+$/.test(core) || !/\d/.test(core)) return false;
  const re = new RegExp('(^|[^\\d.,])\\(?\\$?\\s?' + core.replace(/[.]/g, '\\.') + '(?![\\d]|[.,]\\d)');
  return re.test(norm);
}

// The model's answer, checked, into one stored row. `meta`: symbol, accn,
// filed, url, exhibit. Returns { row, problems }.
function toRow(ans, text, meta) {
  const A = ans || {};
  const norm = String(text || '').replace(/\s+/g, ' ');
  const problems = [];
  const keep = (label, p) => { const s = blankStr(p); if (s == null) return null; if (!inText(norm, s)) { problems.push(label + ' "' + s + '" is not in the release'); return null; } return s; };
  const money = (label, F) => {
    const f = F || {};
    const sc = SCALE[f.unit] || null;
    const a = keep(label, f.printed), b = keep(label + ' a year earlier', f.prior_printed);
    if ((a != null || b != null) && !sc) problems.push(label + ': no scale given');
    const v = (s) => (s == null || !sc || num(s) == null ? null : Math.round(num(s) * sc));
    return [v(a), v(b)];
  };
  const isRes = A.is_results_release === true;
  const [revenue, revenuePrior] = isRes ? money('revenue', A.revenue) : [null, null];
  const [opIncome, opIncomePrior] = isRes ? money('operating income', A.operating_income) : [null, null];
  const [netIncome, netIncomePrior] = isRes ? money('net income', A.net_income) : [null, null];
  const E = A.eps_gaap_diluted || {}, J = A.eps_adjusted || {}, G = A.guidance || {};
  const epsGaap = isRes ? num(keep('GAAP EPS', E.printed)) : null;
  const epsGaapPrior = isRes ? num(keep('GAAP EPS a year earlier', E.prior_printed)) : null;
  const epsAdj = isRes ? num(keep('adjusted EPS', J.printed)) : null;
  const epsAdjPrior = isRes ? num(keep('adjusted EPS a year earlier', J.prior_printed)) : null;
  // Guidance: the printed figures as printed, scaled when they are money.
  const gKind = ['revenue_range', 'revenue_midpoint', 'revenue_growth', 'eps_range', 'other'].includes(G.kind) ? G.kind : null;
  const gUnit = blankStr(G.unit);
  const gScale = gKind && /^revenue_(range|midpoint)$/.test(gKind) ? SCALE[gUnit] || null : 1;
  const gv = (label, p) => { const s = keep('guidance ' + label, p); const n = num(s); return n == null ? null : gScale ? n * gScale : null; };
  const guideLow = gKind ? gv('low', G.low_printed) : null, guideHigh = gKind ? gv('high', G.high_printed) : null, guideMid = gKind ? gv('midpoint', G.mid_printed) : null;
  // The plus-or-minus can be in its own scale ("$8.60 Billion +/- $400 Million"):
  // kept as printed, never converted on a guess.
  const guidePm = gKind === 'revenue_midpoint' ? keep('guidance plus-or-minus', G.plus_minus_printed) : null;
  let summary = blankStr(A.summary);
  if (summary && BANNED.test(summary)) { problems.push('summary used a word the site does not use; dropped'); summary = null; }
  const pe = blankStr(A.period_end);
  const row = {
    accn: meta.accn, symbol: meta.symbol, filed: meta.filed, url: meta.url || null, exhibit: meta.exhibit || null,
    isResults: isRes, periodEnd: pe && /^\d{4}-\d{2}-\d{2}$/.test(pe) ? pe : null, periodLabel: blankStr(A.period_label), currency: blankStr(A.currency),
    revenue, revenuePrior, opIncome, opIncomePrior, netIncome, netIncomePrior, epsGaap, epsGaapPrior, epsAdj, epsAdjPrior,
    epsAdjLabel: epsAdj != null ? blankStr(J.label) : null, epsAdjExcludes: epsAdj != null ? blankStr(J.excludes) : null,
    guideKind: gKind, guidePeriod: gKind ? blankStr(G.period_label) : null, guideLow, guideHigh, guideMid, guidePm,
    guideUnit: gKind ? gUnit : null, guideSentence: gKind ? blankStr(G.sentence) : null, summary,
  };
  return { row, problems };
}

// The quarter's change on a year earlier, in percent; null when either side is
// missing or the earlier one is not above zero (a change off a loss is no %).
const yoy = (a, b) => (a == null || b == null || !(b > 0) ? null : (a / b - 1) * 100);

// AGAINST THE PRICE PROVIDER'S EPS (earnings_history, Twelve Data): the row
// whose report date is within five days of the filing. Its reported figure is
// usually the company's adjusted one; which of the two it matches is said, and
// a figure matching neither is "differs" (amber on the page: in the prototype
// Danaher's provider figure was $1.17 against $1.94 adjusted and $1.23 GAAP,
// and the 10-Q confirmed the release). The estimate is the provider's.
function againstProvider(row, earn) {
  if (!row || !row.filed) return null;
  const at = Date.parse(row.filed + 'T12:00:00Z');
  const near = (earn || []).map((x) => ({ x, gap: Math.abs(Date.parse(String(x.date) + 'T12:00:00Z') - at) }))
    .filter((o) => o.gap <= 5 * 86400000).sort((a, b) => a.gap - b.gap)[0];
  if (!near) return null;
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const actual = n(near.x.epsActual), estimate = n(near.x.epsEstimate);
  const same = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.011;
  const matches = actual == null ? null : same(actual, row.epsAdj) ? 'adjusted' : same(actual, row.epsGaap) ? 'gaap' : 'differs';
  return { date: near.x.date, actual, estimate, matches };
}
// What a reader is handed: the stored row less the bookkeeping, with the two
// changes on a year earlier and the provider's check.
function forReader(row, earn) {
  const r = Object.assign({}, row);
  for (const k of ['inTok', 'outTok', 'usd', 'model', 'readAt']) delete r[k];
  r.revenueYoY = yoy(row.revenue, row.revenuePrior);
  r.provider = againstProvider(row, earn);
  return r;
}

module.exports = { againstProvider, forReader, MODEL, MAX_CHARS, SCALE, BANNED, SCHEMA, SYSTEM, toText, pickExhibit, archiveBase, request, num, inText, blankStr, toRow, yoy };
