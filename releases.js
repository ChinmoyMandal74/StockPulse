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
  required: ['is_results_release', 'period_label', 'period_end', 'currency', 'revenue', 'operating_income', 'net_income', 'eps_gaap_diluted', 'eps_adjusted', 'guidance', 'guidance_items', 'guidance_change', 'drivers', 'summary'],
  properties: {
    is_results_release: { type: 'boolean', description: 'True if this document reports the company’s financial results for a completed quarter, whatever it is called (a press release, a shareholder letter, a quarterly "Update"). False for a preliminary estimate of results, a contract or deal announcement, or anything without the completed quarter’s figures.' },
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
    // EVERY GUIDANCE FIGURE, not one (2026-10-23, the owner: a revenue and an
    // EPS column, and the change). `guidance` above stays the headline item.
    guidance_items: { type: 'array', description: 'Every outlook figure the release gives for a coming quarter or year, one item each: revenue and EPS especially, GAAP and adjusted separately. Empty array if none. Copy as printed; never work out a range from a midpoint.',
      items: { type: 'object', additionalProperties: false, required: ['metric', 'period_label', 'period_type', 'low_printed', 'high_printed', 'mid_printed', 'unit', 'prior_year_printed', 'sentence'], properties: {
        metric: { type: 'string', enum: ['revenue', 'eps_gaap', 'eps_adjusted', 'other'], description: 'revenue: total revenue or net sales. eps_gaap: GAAP diluted EPS. eps_adjusted: an adjusted or non-GAAP EPS. other: anything else (margins, other lines, cash flow).' },
        period_label: { type: 'string', description: 'The period as the company names it, e.g. "fourth quarter 2026", "fiscal 2027", "full year 2026".' },
        period_type: { type: 'string', enum: ['quarter', 'full_year', 'other'] },
        low_printed: { type: 'string', description: 'The low end as printed, or empty.' },
        high_printed: { type: 'string', description: 'The high end as printed, or empty.' },
        mid_printed: { type: 'string', description: 'A single figure as printed (no range given), or empty.' },
        unit: { type: 'string', enum: ['units', 'thousands', 'millions', 'billions', 'percent', 'per_share', 'none'] },
        prior_year_printed: { type: 'string', description: 'Only for a full-year item: the PREVIOUS full year’s actual figure of the same measure, if the release prints it beside the outlook (e.g. "compared with $5.10 in 2025"), as printed. Empty otherwise.' },
        sentence: { type: 'string', description: 'The sentence or table line it comes from, word for word, under 240 characters.' } } } },
    guidance_change: { type: 'object', additionalProperties: false, required: ['direction', 'quote'], description: 'Whether the company says it changed its outlook. Only what the release itself states.',
      properties: {
        direction: { type: 'string', enum: ['raised', 'reaffirmed', 'lowered', 'initiated', 'withdrawn', 'mixed', 'none'],
          description: 'Judge ONLY the revenue and earnings (EPS, net income) outlook; ignore expense, capital spending, tax and other guidance. raised: it raises at least one revenue or earnings figure and lowers none (reaffirming the rest is still raised). lowered: it lowers at least one and raises none. reaffirmed (or maintained, reiterated): it keeps them unchanged. mixed: it raises one revenue or earnings figure and lowers another. initiated: it gives a revenue or earnings outlook for a new period for the first time. withdrawn: it withdraws or suspends it. none: it says nothing about a change to its revenue or earnings outlook, or gives none.' },
        quote: { type: 'string', description: 'The words that say it, copied exactly from the release, under 200 characters. Empty for none.' } } },
    // WHAT HELPED AND WHAT WEIGHED (2026-10-23): the company's own explanation
    // of the quarter, never an opinion of ours, each point backed by a phrase
    // copied from the release.
    drivers: { type: 'object', additionalProperties: false, required: ['helped', 'weighed'],
      description: 'Why the quarter came out as it did, AS THE COMPANY EXPLAINS IT in this release: what it says helped (drove growth, lifted margins) and what it says weighed (offset, pressured, hurt). Up to three each, the most material first. Only reasons the release states about this quarter; never the forward-looking-statements or risk-factors boilerplate, never your own view. Empty arrays if it gives none.',
      properties: {
        helped: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: {
          text: { type: 'string', description: 'The point in plain words, under 110 characters, as the company presents it. Not the words buy, sell, hold, strong, weak, bullish or bearish.' },
          evidence: { type: 'string', description: 'A phrase of 4 to 20 words copied EXACTLY from the release that states it.' } } } },
        weighed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: {
          text: { type: 'string', description: 'The point in plain words, under 110 characters, as the company presents it. Not the words buy, sell, hold, strong, weak, bullish or bearish.' },
          evidence: { type: 'string', description: 'A phrase of 4 to 20 words copied EXACTLY from the release that states it.' } } } } } },
    summary: { type: 'string', description: 'Two or three plain sentences of what the release reports. Facts only: no opinion, no recommendation, and none of the words buy, sell, hold, strong, weak, bullish, bearish.' },
  } };
const SYSTEM = 'You read a company’s quarterly results press release and copy figures out of it into fixed fields. '
  + 'Copy each number EXACTLY as printed in the document; never compute, round, convert or derive one, and never turn a midpoint plus-or-minus into a range. '
  + 'If a figure or text is not in the document, give an empty string. Quarter figures only, never year-to-date or full-year (except in guidance, which may be for a year). '
  + 'In drivers, give only the reasons the company itself states for this quarter, each with a phrase copied from the release. '
  + 'For the outlook, list every figure in guidance_items, and say in guidance_change only what the company itself states about raising, lowering, reaffirming, initiating or withdrawing it. '
  + 'Report what the document says; add nothing.';
function request(text, model) {
  return { model: model || MODEL, max_tokens: 3000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: '<release>\n' + String(text).slice(0, MAX_CHARS) + '\n</release>' }] };
}

// ---- checks and arithmetic -------------------------------------------------------
const blankStr = (v) => (v == null || String(v).trim() === '' || /^[—–\-−]+$/.test(String(v).trim()) || String(v).trim().toLowerCase() === 'none' ? null : String(v).trim());
// A SCALE WORD AFTER THE DIGITS ("16.3 billion" in a sentence, "$8.60 Billion"
// in a guidance line; Capital One and Lam on the first fill): the digits are
// what must be found in the text, and the word is the figure's own scale,
// which outranks the unit the model gave for the table.
const WORD = { thousand: 1e3, k: 1e3, million: 1e6, mm: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12 };
function split(p) {
  const s = blankStr(p);
  if (s == null) return null;
  const m = s.match(/^(.*?\d\)?)\s*(thousand|million|billion|trillion|bn|mm|k|m|b)\.?\)?$/i);
  return m ? { core: m[1].trim() + (/^\(/.test(s) && !/\)$/.test(m[1]) ? ')' : ''), mult: WORD[m[2].toLowerCase()] } : { core: s, mult: null };
}
// A printed figure as a number: commas gone, parentheses or a leading minus negative.
function num(p) {
  const sp = split(p);
  if (sp == null) return null;
  const s = sp.core;
  const neg = /^\(.*\)$/.test(s) || /^[-−–]/.test(s);
  const digits = s.replace(/[^\d.]/g, '');
  if (!/\d/.test(digits) || (digits.match(/\./g) || []).length > 1) return null;
  const v = Number(digits);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
// Is the printed figure in the text, as a whole number token (so "2.2" is not
// found inside "12.25", nor "64" inside "64,601")?
function inText(norm, p) {
  const sp = split(p);
  if (sp == null) return true;
  const s = sp.core;
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
  // THE SCALE THE RELEASE STATES. On the first fill TD SYNNEX's revenue,
  // printed "21,558,406" under "(in thousands)", came back as "units" and was
  // stored as $21.6 million; the digits were right, so the text check could
  // not see it. A figure the model calls "units" (and that carries no scale
  // word) takes the release's stated scale when it states exactly one, and is
  // refused when it states several.
  const declared = new Set([...norm.matchAll(/\bin (thousands|millions|billions)\b/gi)].map((m) => m[1].toLowerCase()));
  const money = (label, F) => {
    const f = F || {};
    let sc = SCALE[f.unit] || null;
    if (f.unit === 'units' && !(split(f.printed) || {}).mult && declared.size) {
      // Several stated: the one stated last BEFORE the figure's first place in
      // the text, as a reader takes a table's heading.
      const at = blankStr(f.printed) == null ? -1 : norm.indexOf(split(f.printed).core.replace(/[()$\s]/g, ''));
      const before = at < 0 ? [] : [...norm.slice(0, at).matchAll(/\bin (thousands|millions|billions)\b/gi)];
      if (declared.size === 1) sc = SCALE[[...declared][0]];
      else if (before.length) sc = SCALE[before[before.length - 1][1].toLowerCase()];
      else { if (blankStr(f.printed) != null) problems.push(label + ': the release states more than one scale and the figure’s is not clear'); return [null, null]; }
    }
    const a = keep(label, f.printed), b = keep(label + ' a year earlier', f.prior_printed);
    if ((a != null && !(split(a) || {}).mult && !sc) || (b != null && !(split(b) || {}).mult && !sc)) problems.push(label + ': no scale given');
    const v = (s) => { const w = s == null ? null : (split(s) || {}).mult; const k = w || sc; return s == null || !k || num(s) == null ? null : Math.round(num(s) * k); };
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
  const gv = (label, p) => { const s = keep('guidance ' + label, p); const n = num(s); if (n == null) return null; const w = (split(s) || {}).mult; const money = gKind && /^revenue_(range|midpoint)$/.test(gKind); return money ? ((w || gScale) ? n * (w || gScale) : null) : n; };
  const guideLow = gKind ? gv('low', G.low_printed) : null, guideHigh = gKind ? gv('high', G.high_printed) : null, guideMid = gKind ? gv('midpoint', G.mid_printed) : null;
  // The plus-or-minus can be in its own scale ("$8.60 Billion +/- $400 Million"):
  // kept as printed, never converted on a guess.
  const guidePm = gKind === 'revenue_midpoint' ? keep('guidance plus-or-minus', G.plus_minus_printed) : null;
  let summary = blankStr(A.summary);
  if (summary && BANNED.test(summary)) { problems.push('summary used a word the site does not use; dropped'); summary = null; }
  // A SCALE THE TEXT CHECK CANNOT SEE (the recon, 2026-10-22: Synchrony's net
  // income stored as $892 billion, printed "892" in millions). The digits are
  // in the text, so only a figure against the company's size catches it. With
  // the reference the loader passes (meta.ref: shares outstanding and twelve
  // months' revenue from the price data), a net income whose implied share
  // count (net income / EPS) is not within a fifth to five times the shares
  // outstanding, or a quarter's revenue not within a tenth to ten times a
  // quarter of the twelve months', is refused and named. A scale slip is a
  // thousandfold, far outside both; a real quarter is well inside.
  const ref = meta.ref || {};
  let revenueG = revenue, revenuePriorG = revenuePrior, netIncomeG = netIncome, netIncomePriorG = netIncomePrior;
  // EACH FIGURE ON ITS OWN against the reference. Two quarters agreeing with
  // each other prove nothing: a scale slip applied to both still agrees. The
  // share count is the loader's market value over price (market value is the
  // one money figure reliably in dollars), not the provider's share count,
  // which can itself be wrong (CME's reads 359,275 where its figures imply
  // 359 million). CSX's year-earlier net income, stored as $694 billion, is
  // refused this way and its current quarter kept.
  const near = (a, b, lo, hi) => a > 0 && b > 0 && a / b >= lo && a / b <= hi;
  const implied = (ni, e) => (ni == null || e == null || Math.abs(e) < 0.005 ? null : Math.abs(ni / e));
  const shNow = implied(netIncome, epsGaap), shPrior = implied(netIncomePrior, epsGaapPrior);
  if (ref.shares > 0) {
    if (shNow != null && !near(shNow, ref.shares, 0.2, 5)) { problems.push('net income ' + netIncome + ' does not fit the share count (scale doubtful)'); netIncomeG = null; }
    if (shPrior != null && !near(shPrior, ref.shares, 0.2, 5)) { problems.push('net income a year earlier ' + netIncomePrior + ' does not fit the share count (scale doubtful)'); netIncomePriorG = null; }
  }
  if (ref.revenueTtm > 0) {
    const q = ref.revenueTtm / 4;
    if (revenue > 0 && !near(revenue, q, 0.1, 10)) { problems.push('revenue ' + revenue + ' does not fit twelve months’ revenue (scale doubtful)'); revenueG = null; }
    if (revenuePrior > 0 && !near(revenuePrior, q, 0.1, 10)) { problems.push('revenue a year earlier ' + revenuePrior + ' does not fit twelve months’ revenue (scale doubtful)'); revenuePriorG = null; }
  }
  // Every guidance item, each figure found in the text; and the stated change.
  const guides = isRes ? guideItems(A.guidance_items, keep) : [];
  const ch = isRes ? guideChange(A.guidance_change, norm, problems) : { change: null, quote: null };
  const drivers = isRes ? driverLists(A.drivers, norm, problems) : null;
  const pe = blankStr(A.period_end);
  const row = {
    accn: meta.accn, symbol: meta.symbol, filed: meta.filed, url: meta.url || null, exhibit: meta.exhibit || null,
    isResults: isRes, periodEnd: pe && /^\d{4}-\d{2}-\d{2}$/.test(pe) ? pe : null, periodLabel: blankStr(A.period_label), currency: blankStr(A.currency),
    revenue: revenueG, revenuePrior: revenuePriorG, opIncome, opIncomePrior, netIncome: netIncomeG, netIncomePrior: netIncomePriorG, epsGaap, epsGaapPrior, epsAdj, epsAdjPrior,
    epsAdjLabel: epsAdj != null ? blankStr(J.label) : null, epsAdjExcludes: epsAdj != null ? blankStr(J.excludes) : null,
    guideKind: gKind, guidePeriod: gKind ? blankStr(G.period_label) : null, guideLow, guideHigh, guideMid, guidePm,
    guideUnit: gKind ? gUnit : null, guideSentence: gKind ? blankStr(G.sentence) : null, summary,
    // [] for a results release with no guidance, so a guidance re-read knows it was read.
    guides: isRes ? guides : null, guideChange: ch.change, guideChangeQuote: ch.quote,
    drivers,
  };
  return { row, problems };
}

// ---- GUIDANCE ITEMS AND THE STATED CHANGE (2026-10-23) ---------------------
// Each item: metric, period, its figures as numbers (revenue scaled to units,
// per share and percent as printed), and the previous full year's figure when
// printed beside it. A figure not in the text is dropped and named.
const GUIDE_METRICS = ['revenue', 'eps_gaap', 'eps_adjusted', 'other'];
function guideItems(list, keep) {
  const out = [];
  for (const it of (Array.isArray(list) ? list : []).slice(0, 8)) {
    if (!it || !GUIDE_METRICS.includes(it.metric)) continue;
    const unit = blankStr(it.unit);
    const fig = (label, p) => {
      const s = keep('guidance ' + it.metric + ' ' + label, p);
      const n = num(s);
      if (n == null) return null;
      if (it.metric !== 'revenue' || unit === 'percent') return n;
      const k = (split(s) || {}).mult || SCALE[unit];
      return k ? n * k : null;
    };
    const g = { metric: it.metric, periodLabel: blankStr(it.period_label), periodType: ['quarter', 'full_year'].includes(it.period_type) ? it.period_type : 'other',
      low: fig('low', it.low_printed), high: fig('high', it.high_printed), mid: fig('figure', it.mid_printed), unit: unit || null,
      prior: it.period_type === 'full_year' ? fig('prior year', it.prior_year_printed) : null, sentence: blankStr(it.sentence) };
    if (g.low == null && g.high == null && g.mid == null) continue;
    if (g.sentence && g.sentence.length > 240) g.sentence = g.sentence.slice(0, 240);
    out.push(g);
  }
  return out;
}
// ---- WHAT HELPED AND WHAT WEIGHED (2026-10-23) -----------------------------
// Each point kept only when its evidence is in the release word for word, is
// not the legal boilerplate, and its text uses none of the site's banned
// words. At most three a side. { helped: [{text, evidence}], weighed: [...] };
// both empty when the release gives no reasons (stored, so a re-read knows).
const BOILER = /forward-looking|risks and uncertainties|could cause actual|safe harbor|undue reliance|risk factors/i;
function driverLists(d, norm, problems) {
  const flat = flatQ(norm);
  const side = (list, name) => {
    const out = [];
    for (const it of (Array.isArray(list) ? list : [])) {
      if (out.length >= 3) break;
      const text = blankStr(it && it.text), ev = blankStr(it && it.evidence);
      if (!text || !ev) continue;
      if (!flat.includes(flatQ(ev))) { problems.push(name + ' "' + text.slice(0, 50) + '": its words are not in the release'); continue; }
      if (BOILER.test(ev) || BOILER.test(text)) { problems.push(name + ' "' + text.slice(0, 50) + '": boilerplate, left out'); continue; }
      if (BANNED.test(text)) { problems.push(name + ' "' + text.slice(0, 50) + '": used a word the site does not use'); continue; }
      out.push({ text: text.slice(0, 140), evidence: ev.slice(0, 240) });
    }
    return out;
  };
  return { helped: side(d && d.helped, 'helped'), weighed: side(d && d.weighed, 'weighed') };
}
// The middle of an item: its single figure, else the middle of its range.
const guideMidOf = (g) => (!g ? null : g.mid != null ? g.mid : g.low != null && g.high != null ? (g.low + g.high) / 2 : null);
// THE STATED CHANGE: kept only when its quote is in the release, word for
// word, and carries a word that says that change. The model's own view of the
// outlook is never asked for or taken: this is what the company says.
const CHANGE_WORDS = {
  raised: /\b(rais|increas|lift|boost|upgrad|higher)/i,
  lowered: /\b(lower|reduc|cut|decreas|trim|downgrad)/i,
  reaffirmed: /\b(reaffirm|affirm|maintain|reiterat|confirm|unchanged)/i,
  // Not "expect" or "provide": every outlook sentence says those (Crown, 2026-10-19).
  initiated: /\b(initiat|introduc|establish|initial|first)/i,
  withdrawn: /\b(withdr|suspend|no longer)/i,
};
const flatQ = (t) => String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase();
function guideChange(c, norm, problems) {
  const d = c && c.direction;
  if (!d || d === 'none') return { change: null, quote: null };
  const quote = blankStr(c.quote);
  if (!quote || !flatQ(norm).includes(flatQ(quote))) { problems.push('guidance change "' + d + '": its words are not in the release'); return { change: null, quote: null }; }
  const ok = d === 'mixed' ? CHANGE_WORDS.raised.test(quote) && CHANGE_WORDS.lowered.test(quote) : !!(CHANGE_WORDS[d] && CHANGE_WORDS[d].test(quote));
  if (!ok) { problems.push('guidance change "' + d + '": the quote does not say so'); return { change: null, quote: null }; }
  // About revenue or earnings, not costs: Meta's "raising our expense outlook"
  // (2026-10-21) is not a change to what it expects to earn.
  if (/\b(expense|cost|capex|capital expenditure|tax rate|spending)/i.test(quote) && !/\b(revenue|sales|eps|earnings|income|per share|profit|outlook for the (year|quarter)|guidance)\b/i.test(quote.replace(/expense outlook/ig, ''))) {
    problems.push('guidance change "' + d + '": the quote is about costs, not revenue or earnings'); return { change: null, quote: null };
  }
  return { change: d, quote: quote.slice(0, 200) };
}
// THE YEAR A FULL-YEAR ITEM IS FOR, from its label ("fiscal 2027", "FY27",
// "full year 2026"); null when it names none.
function guideYear(label) {
  const t = String(label || '');
  const m = t.match(/\b(20\d\d)\b/) || t.match(/\bFY\s?'?(\d\d)\b/i);
  if (!m) return null;
  return m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
}
// THE PREVIOUS FULL YEAR'S GAAP DILUTED EPS for a full-year GAAP item, from
// the 10-K: the annual figure whose year ends in the year before the one
// guided ("fiscal 2027" against the fiscal year ending in 2026, whatever its
// month). `facts`: the company's sec_facts rows. null when not on file.
function priorFyEps(item, facts) {
  const y = guideYear(item && item.periodLabel);
  if (!y) return null;
  const f = (facts || []).filter((x) => x && x.periodType === 'FY' && x.form === '10-K' && x.epsDiluted != null && Number(String(x.periodEnd).slice(0, 4)) === y - 1)
    .sort((a, b) => (String(a.filed) < String(b.filed) ? 1 : -1))[0];
  return f ? Number(f.epsDiluted) : null;
}
// THE THREE GUIDANCE READINGS for a reader (ReleaseView, the email):
//  revVsQ: the coming quarter's revenue guidance (middle) against this quarter's revenue, %;
//  epsVsFy: full-year EPS guidance (middle) against the previous full year's EPS
//    on the SAME basis, %: the figure the release prints beside it, else, for
//    GAAP guidance only, the 10-K's (row.epsGuidePrior, set by the loader).
//    Adjusted guidance with no printed prior stays blank: no filing carries an
//    adjusted EPS to set it against. Adjusted is preferred when both work;
//  change: the stated change and its words.
// Rows read before guidance items existed fall back to the headline item.
function guideReadings(row) {
  const gs = Array.isArray(row.guides) ? row.guides : [];
  const revQ = gs.find((g) => g.metric === 'revenue' && g.periodType === 'quarter' && g.unit !== 'percent') || null;
  let revMid = guideMidOf(revQ);
  const qLabel = (t) => /quarter|\bq[1-4]\b/i.test(t || '') && !/full|year|annual/i.test(t || '');
  if (revMid == null && !gs.length && /^revenue_(range|midpoint)$/.test(row.guideKind || '') && qLabel(row.guidePeriod)) {
    revMid = row.guideKind === 'revenue_range' && row.guideLow != null && row.guideHigh != null ? (row.guideLow + row.guideHigh) / 2 : row.guideKind === 'revenue_midpoint' ? row.guideMid : null;
  }
  const revVsQ = revMid != null && row.revenue > 0 ? (revMid / row.revenue - 1) * 100 : null;
  const fy = gs.filter((g) => (g.metric === 'eps_adjusted' || g.metric === 'eps_gaap') && g.periodType === 'full_year');
  let epsVsFy = null, epsFy = null;
  for (const g of [...fy.filter((x) => x.metric === 'eps_adjusted'), ...fy.filter((x) => x.metric === 'eps_gaap')]) {
    const mid = guideMidOf(g);
    const prior = g.prior != null ? g.prior : g.metric === 'eps_gaap' ? row.epsGuidePrior : null;
    if (mid == null || prior == null || !(prior > 0)) continue;
    epsVsFy = (mid / prior - 1) * 100;
    epsFy = { basis: g.metric === 'eps_gaap' ? 'GAAP' : 'adjusted', mid, low: g.low, high: g.high, prior, priorFrom: g.prior != null ? 'release' : '10-K', period: g.periodLabel };
    break;
  }
  return { revVsQ, revQ, epsVsFy, epsFy, change: row.guideChange || null, changeQuote: row.guideChangeQuote || null };
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
  // The three guidance readings, worked out here once for every page.
  r.guideRead = guideReadings(row);
  return r;
}

// AGAINST THE 10-Q (2026-10-22). `facts`: the company's sec_facts rows (as
// readSecFactsSince returns them). The quarter whose period end is the
// release's, newest filing first: a 10-Q, or the 10-K's worked-out fourth
// quarter. Revenue and net income within half a percent, diluted EPS to the
// cent; only figures both sides carry are compared. null when the quarter is
// not on file yet (checked again on the next run).
//
// A DIFFERENCE IS NOT AN ERROR BY ITSELF. On the first month, every revenue
// difference but one was the release headlining another line than the filing
// data does (Paychex's total against service revenue; Applied Digital's
// continuing operations). The page says what the 10-Q has, in amber, and
// leaves the reading as the release printed it.
function tenQCheck(row, facts) {
  if (!row || !row.isResults || !row.periodEnd) return null;
  const q = (facts || []).filter((f) => f && f.periodType === 'Q' && f.periodEnd === row.periodEnd)
    .sort((a, b) => (String(a.filed) < String(b.filed) ? 1 : -1))[0];
  if (!q) return null;
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const pairs = [['revenue', row.revenue, n(q.revenue), 0.005], ['net income', row.netIncome, n(q.netIncome), 0.005], ['diluted EPS', row.epsGaap, n(q.epsDiluted), 0]];
  const differs = [];
  let compared = 0;
  for (const [k, a, b, tol] of pairs) {
    if (a == null || b == null) continue;
    compared++;
    if (Math.abs(a - b) > Math.max(Math.abs(b) * tol, tol ? 0 : 0.011)) differs.push(k);
  }
  return { form: q.form || null, filed: q.filed || null, revenue: n(q.revenue), netIncome: n(q.netIncome), eps: n(q.epsDiluted),
    result: !compared ? 'none' : differs.length ? 'differs' : 'match', differs };
}

// THE SCREENER'S COLUMN (2026-10-22, the owner: the group "Last Earning AI
// Extracted", every column). Each company's newest results release in the
// window, as a reader is handed it (forReader: the changes and the provider's
// estimate joined), less the release link's long prose duplicates. Built by
// the loader after each run and stored as one figure, so the screener reads
// one row; the page maps a row to its columns (ReleaseView.fields).
function columnRows(releases, earnBySymbol) {
  const latest = {};
  for (const r of releases || []) {
    if (!r || !r.isResults || !r.symbol) continue;
    const cur = latest[r.symbol];
    if (!cur || r.filed > cur.filed || (r.filed === cur.filed && String(r.accn) > String(cur.accn))) latest[r.symbol] = r;
  }
  const out = {};
  for (const sym of Object.keys(latest)) {
    const f = forReader(latest[sym], (earnBySymbol && earnBySymbol[sym]) || []);
    // The guidance items themselves stay off the column (guideRead carries
    // what the columns show): the figure is fetched by every screener load.
    for (const k of ['problems', 'exhibit', 'accn', 'secForm', 'secCheckedAt', 'guides', 'epsGuidePrior', 'drivers']) delete f[k];
    if (f.guideRead && f.guideRead.revQ) f.guideRead.revQ = Object.assign({}, f.guideRead.revQ, { sentence: undefined });
    out[sym] = f;
  }
  return out;
}

// ---- THE SIGNAL-INPUT RECON (2026-10-22, the owner: "a recon page only for
// s&p 500 only for these important that we need for signal calculation
// showing Twelve data and our AI-extracted release ... quarterly level
// starting this current quarter, Also show the release date"). Display and
// checking only: the Signal reads Twelve Data's figures, as before.
//
// THE SEASON a release belongs to: the calendar quarter nearest its period
// end, so a fiscal quarter ending in August or October counts with
// September's (cards.js restates this for the Results summary; it has no
// requires).
function seasonOf(periodEnd) {
  const t = Date.parse(String(periodEnd) + 'T12:00:00Z'), y = Number(String(periodEnd).slice(0, 4));
  if (!isFinite(t) || !y) return null;
  let best = null;
  for (let yy = y - 1; yy <= y + 1; yy++) for (let q = 1; q <= 4; q++) {
    const gap = Math.abs(t - Date.UTC(yy, q * 3, 0, 12));
    if (!best || gap < best.gap) best = { s: yy + '-Q' + q, gap };
  }
  return best ? best.s : null;
}
// One company's quarter, both sides. The release's figures are the quarter's
// (Twelve Data's growth figures are the quarter's too, on the year earlier:
// Micron matched to the decimal); its margins are twelve months', the
// release's one quarter's, so those two are shown side by side, never called
// a match. Twelve Data is ON THE SAME REPORT when its last report date is
// within five days of the release's filing.
function reconRow(rel, td) {
  const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const t = td || {};
  const report = t.lastEarningsDate ? String(t.lastEarningsDate).slice(0, 10) : null;
  const current = !!(report && rel.filed && Math.abs(Date.parse(report + 'T12:00:00Z') - Date.parse(rel.filed + 'T12:00:00Z')) <= 5 * 86400000);
  return {
    symbol: rel.symbol, season: seasonOf(rel.periodEnd), accn: rel.accn || null, filed: rel.filed || null, periodEnd: rel.periodEnd || null,
    periodLabel: rel.periodLabel || null, currency: rel.currency || null,
    aiRevG: yoy(rel.revenue, rel.revenuePrior), aiNiG: yoy(rel.netIncome, rel.netIncomePrior),
    aiPmQ: rel.revenue > 0 && rel.netIncome != null ? rel.netIncome / rel.revenue * 100 : null,
    aiNiPos: rel.netIncome == null ? null : rel.netIncome > 0,
    tdReport: report, tdCurrent: current,
    tdRevG: n(t.revenueGrowthYoY), tdNiG: n(t.earningsGrowthYoY), tdPm: n(t.profitMargin), tdNiTtm: n(t.netIncomeTtm), tdFcfM: n(t.fcfMargin),
  };
}
// Agreement on the two inputs both sides define the same way: within half a
// point. 'behind' while Twelve Data is on an older report.
const RECON_TOL = 0.5;
function reconStatus(r) {
  if (!r) return { status: 'none', differs: [] };
  if (!r.tdCurrent) return { status: 'behind', differs: [] };
  const differs = [];
  if (r.aiRevG != null && r.tdRevG != null && Math.abs(r.aiRevG - r.tdRevG) > RECON_TOL) differs.push('revenue growth');
  if (r.aiNiG != null && r.tdNiG != null && Math.abs(r.aiNiG - r.tdNiG) > RECON_TOL) differs.push('earnings growth');
  const compared = (r.aiRevG != null && r.tdRevG != null) || (r.aiNiG != null && r.tdNiG != null);
  return { status: !compared ? 'incomplete' : differs.length ? 'differs' : 'agrees', differs };
}

module.exports = { driverLists, BOILER, guideItems, guideChange, guideMidOf, guideYear, priorFyEps, guideReadings, CHANGE_WORDS, seasonOf, reconRow, reconStatus, RECON_TOL, columnRows, tenQCheck, split, againstProvider, forReader, MODEL, MAX_CHARS, SCALE, BANNED, SCHEMA, SYSTEM, toText, pickExhibit, archiveBase, request, num, inText, blankStr, toRow, yoy };
