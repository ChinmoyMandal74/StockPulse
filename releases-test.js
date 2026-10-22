// releases.js: the text it hands the model, the exhibit it picks, and above
// all the checks on what comes back (every figure in the text, scales, the
// two EPS figures, guidance as printed, the words the site does not use).
const Rel = require('./releases.js');
let ran = 0, failed = 0;
const check = (name, ok, extra) => { ran++; if (!ok) { failed++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// ---- text ----
const html = '<html><style>.x{}</style><p>Meta Reports Third Quarter&#160;2026 Results</p><table><tr><td>Revenue</td><td>$</td><td>64,601</td><td>$</td><td>51,242</td></tr>'
  + '<tr><td>Diluted EPS</td><td>$ 3.83</td><td>$ 1.05</td></tr></table><p>Excluding this charge, diluted EPS of $3.83 would have increased by $3.57 to $7.40.</p>'
  + '<p>We expect fourth quarter 2026 total revenue to be in the range of $73-76 billion.</p><p>Revenue $8.60 Billion +/- $400 Million</p><p>Prior: &#8212;</p>';
const text = Rel.toText(html);
check('text: a table row is one line, cells by bars', /Revenue \| \$ \| 64,601 \| \$ \| 51,242/.test(text), text);
check('text: entities decoded', /Third Quarter 2026/.test(text) && !/&#/.test(text));
check('text: styles dropped', !/\.x\{\}/.test(text));

// ---- the exhibit ----
const hdr = '&lt;DOCUMENT&gt;\n&lt;TYPE&gt;8-K\n&lt;FILENAME&gt;a.htm\n&lt;DOCUMENT&gt;\n&lt;TYPE&gt;EX-99.2\n&lt;FILENAME&gt;slides.htm\n&lt;DOCUMENT&gt;\n&lt;TYPE&gt;EX-99.1\n&lt;FILENAME&gt;release.htm\n';
check('exhibit: EX-99.1 over EX-99.2', (Rel.pickExhibit(hdr) || {}).file === 'release.htm');
check('exhibit: a bare EX-99 when there is no .1', (Rel.pickExhibit('<TYPE>8-K\n<FILENAME>a.htm\n<TYPE>EX-99\n<FILENAME>nee.htm') || {}).file === 'nee.htm');
check('exhibit: none', Rel.pickExhibit('<TYPE>8-K\n<FILENAME>a.htm\n<TYPE>EX-10.1\n<FILENAME>deal.htm') === null);
check('archive base', Rel.archiveBase('0001326801', '0001628280-26-066700') === 'https://www.sec.gov/Archives/edgar/data/1326801/000162828026066700/');

// ---- numbers ----
check('num: commas', Rel.num('64,601') === 64601);
check('num: parentheses are negative', Rel.num('(0.02)') === -0.02);
check('num: a leading minus', Rel.num('−0.5') === -0.5);
check('num: a dash is not a number', Rel.num('—') === null && Rel.num('') === null && Rel.num('none') === null);
check('num: two points is not a number', Rel.num('1.2.3') === null);
const norm = text.replace(/\s+/g, ' ');
check('inText: a table figure', Rel.inText(norm, '64,601'));
check('inText: an EPS in prose', Rel.inText(norm, '7.40'));
check('inText: not inside a larger number (64 in 64,601)', !Rel.inText(norm, '64'));
check('inText: not a part of a decimal (3.8 in 3.83)', !Rel.inText(norm, '3.8'));
check('inText: a computed figure is refused', !Rel.inText(norm, '8.20') && !Rel.inText(norm, '9.00'));
check('inText: absent is fine', Rel.inText(norm, ''));

// ---- the answer into a row ----
const meta = { accn: '0001628280-26-066700', symbol: 'META', filed: '2026-10-21', url: 'u', exhibit: 'EX-99.1' };
const good = {
  is_results_release: true, period_label: 'Third Quarter 2026', period_end: '2026-09-30', currency: 'USD',
  revenue: { printed: '64,601', prior_printed: '51,242', unit: 'millions' },
  operating_income: { printed: '', prior_printed: '', unit: 'millions' },
  net_income: { printed: '', prior_printed: '', unit: 'millions' },
  eps_gaap_diluted: { printed: '3.83', prior_printed: '1.05' },
  eps_adjusted: { printed: '7.40', prior_printed: '', label: 'Diluted EPS excluding the litigation charge', excludes: 'a $9.89 billion charge' },
  guidance: { kind: 'revenue_range', period_label: 'Fourth quarter 2026', low_printed: '73', high_printed: '76', mid_printed: '', plus_minus_printed: '', unit: 'billions', sentence: 'We expect fourth quarter 2026 total revenue to be in the range of $73-76 billion.' },
  summary: 'Meta reported revenue of $64.60 billion for the third quarter of 2026.',
};
let { row, problems } = Rel.toRow(good, text, meta);
check('row: no problems on a clean answer', problems.length === 0, problems);
check('row: revenue scaled to dollars', row.revenue === 64601e6 && row.revenuePrior === 51242e6);
check('row: both EPS kept apart', row.epsGaap === 3.83 && row.epsGaapPrior === 1.05 && row.epsAdj === 7.4);
check('row: the adjusted label travels with it', /excluding the litigation charge/.test(row.epsAdjLabel) && /9.89/.test(row.epsAdjExcludes));
check('row: guidance range in dollars', row.guideKind === 'revenue_range' && row.guideLow === 73e9 && row.guideHigh === 76e9);
check('row: empty figures are null, not zero', row.opIncome === null && row.netIncome === null);
check('row: identifiers', row.accn === meta.accn && row.symbol === 'META' && row.filed === '2026-10-21' && row.isResults === true && row.periodEnd === '2026-09-30');
// A figure not in the text is dropped and named.
({ row, problems } = Rel.toRow(Object.assign({}, good, { revenue: { printed: '64,600', prior_printed: '51,242', unit: 'millions' } }), text, meta));
check('row: a figure not in the release is dropped', row.revenue === null && row.revenuePrior === 51242e6 && problems.some((p) => /revenue "64,600"/.test(p)), problems);
// A computed guidance range (the prototype's Lam case) is refused; the midpoint form is kept as printed.
({ row, problems } = Rel.toRow(Object.assign({}, good, { guidance: { kind: 'revenue_range', period_label: 'Q4', low_printed: '8.20', high_printed: '9.00', mid_printed: '', plus_minus_printed: '', unit: 'billions', sentence: 'x' } }), text, meta));
check('row: a worked-out range is refused', row.guideLow === null && row.guideHigh === null && problems.length === 2, problems);
({ row, problems } = Rel.toRow(Object.assign({}, good, { guidance: { kind: 'revenue_midpoint', period_label: 'Q4', low_printed: '', high_printed: '', mid_printed: '8.60', plus_minus_printed: '400', unit: 'billions', sentence: 'Revenue $8.60 Billion +/- $400 Million' } }), text, meta));
check('row: midpoint and plus-or-minus kept as printed', row.guideMid === 8.6e9 && row.guidePm === '400' && problems.length === 0, [row.guideMid, row.guidePm, problems]);
// A dash for "not given".
({ row, problems } = Rel.toRow(Object.assign({}, good, { eps_adjusted: { printed: '7.40', prior_printed: '—', label: 'x', excludes: 'y' } }), text, meta));
check('row: a dash is "not given", not a refused figure', row.epsAdjPrior === null && problems.length === 0, problems);
// No scale: refused rather than guessed.
({ row, problems } = Rel.toRow(Object.assign({}, good, { revenue: { printed: '64,601', prior_printed: '', unit: 'lots' } }), text, meta));
check('row: no scale, no revenue', row.revenue === null && problems.some((p) => /no scale/.test(p)), problems);
// The site's words.
({ row, problems } = Rel.toRow(Object.assign({}, good, { summary: 'A strong quarter; analysts say buy.' }), text, meta));
check('row: a summary with buy/strong is dropped', row.summary === null && problems.some((p) => /summary/.test(p)));
check('row: "buyback" is not "buy"', Rel.toRow(Object.assign({}, good, { summary: 'It spent $1 billion on its buyback.' }), text, meta).row.summary != null);
// Not a results release: nothing filled in.
({ row, problems } = Rel.toRow(Object.assign({}, good, { is_results_release: false }), text, meta));
check('row: not a results release carries no figures', row.isResults === false && row.revenue === null && row.epsGaap === null && row.epsAdj === null);
check('row: the adjusted label is not kept without the figure', Rel.toRow(Object.assign({}, good, { eps_adjusted: { printed: '', prior_printed: '', label: 'Non-GAAP', excludes: 'x' } }), text, meta).row.epsAdjLabel === null);
check('row: a bad period end is dropped', Rel.toRow(Object.assign({}, good, { period_end: 'Sept 30' }), text, meta).row.periodEnd === null);

// A scale word on the figure (first fill: Capital One's "16.3 billion" in a
// sentence, Lam's "$8.60 Billion +/- $400 Million"): found by its digits,
// scaled by its own word, which outranks the table unit given.
const prose = 'Revenue of $16.3 billion, up from $14.1 billion. Net income of $(1.2) billion. Guidance: Revenue $8.60 Billion +/- $400 Million.';
({ row, problems } = Rel.toRow(Object.assign({}, good, { revenue: { printed: '16.3 billion', prior_printed: '14.1 billion', unit: 'millions' }, net_income: { printed: '(1.2) billion', prior_printed: '', unit: 'millions' },
  eps_gaap_diluted: { printed: '', prior_printed: '' }, eps_adjusted: { printed: '', prior_printed: '', label: '', excludes: '' },
  guidance: { kind: 'revenue_midpoint', period_label: 'Q4', low_printed: '', high_printed: '', mid_printed: '$8.60 Billion', plus_minus_printed: '400 Million', unit: 'millions', sentence: 'Revenue $8.60 Billion +/- $400 Million' } }), prose, meta));
check('word: "16.3 billion" is found and scaled by its word', row.revenue === 16.3e9 && row.revenuePrior === 14.1e9, [row.revenue, row.revenuePrior, problems]);
check('word: a negative in parentheses with a word', row.netIncome === -1.2e9, row.netIncome);
check('word: the guidance midpoint scaled by its word, the plus-or-minus kept as printed', row.guideMid === 8.6e9 && row.guidePm === '400 Million', [row.guideMid, row.guidePm]);
check('word: no problems', problems.length === 0, problems);
check('word: "16 billion" is not found in "16.3 billion"', !Rel.inText(prose, '16 billion'));
check('word: a word does not rescue a figure that is not there', Rel.toRow(Object.assign({}, good, { revenue: { printed: '17.0 billion', prior_printed: '', unit: 'millions' } }), prose, meta).row.revenue === null);

// ---- year on year ----
check('yoy', Math.abs(Rel.yoy(64601, 51242) - 26.07) < 0.01);
check('yoy: off a loss is no percent', Rel.yoy(5, -2) === null && Rel.yoy(null, 3) === null);

// ---- the request ----
const req = Rel.request('x'.repeat(Rel.MAX_CHARS + 10));
check('request: structured output, the model, capped text', req.output_config.format.type === 'json_schema' && req.model === 'claude-haiku-5-5' && req.messages[0].content.length < Rel.MAX_CHARS + 40);
const unions = JSON.stringify(Rel.SCHEMA).match(/"type":\[/g) || [];
check('request: no nullable unions (the compiler refuses many)', unions.length === 0, unions.length);

console.log(`${ran} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
