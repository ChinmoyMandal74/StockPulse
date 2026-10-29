// The Company summary: one stock written up from the data on file, as a blog
// draft. The fact sheet, the instructions to the model, the checks on what it
// wrote, and the post's body. Pure: no network, no database. server.js gathers
// the figures and calls the model; this decides what goes in and what comes out.
//
// (2026-10-12, the owner: "create a one page executive summary ... for a stock
// as a sample research", then: admin only, AI-written, "Focus on blog post",
// "Company summary is good", "Only at the stock level right now".)
//
// THE MODEL WRITES FROM A FACT SHEET AND FROM NOTHING ELSE. It is handed the
// figures the stock page shows, as text, and told to use only those. It is
// not asked what it knows about the company, and what it knows is out of date.
//
// WHAT IT WRITES IS CHECKED, by code, before anyone reads it:
//   - EVERY NUMBER in the prose must be a number on the fact sheet. A fluent
//     sentence with an invented figure is the failure this exists to catch.
//   - NO WORD OF ADVICE. The site's rule is that nothing recommends: the list
//     below is refused wherever it appears.
// A draft that fails is still saved, with what failed printed at the top of
// it, because the owner reads every one before publishing and a flagged
// draft is more use than a refusal. It is never published by this code.
//
// IT IS A DESCRIPTION, AND SAYS SO. Not research, not a rating, no target.
// The Signal is quoted once, with the rule that fired, as the site's own
// mechanical reading.
(function (root) {
  'use strict';

  // The catalogue rows that go on the sheet, by section. Keys are RowCard's
  // FIELD_SPEC keys, so the summary shows the same figure, formatted the
  // same way, as the stock page.
  const ROW_SECTIONS = [
    ['The company', ['info|Sector', 'info|Industry', 'info|Market Cap', 'info|Size', 'info|Index', 'info|Next Earn']],
    ['Signal', ['act|Signal', 'act|Why', 'act|Trend', 'act|Days held']],
    ['Price and trend', ['info|Price', 'short|Today', 'short|1W', 'short|1M', 'long|3M', 'long|6M', 'long|YTD', 'long|1Y', 'long|5Y',
      'rel|RS vs S&P', 'rel|% from 52W hi', 'risk|Drawdown', 'risk|Corrections 5Y', 'risk|Median recovery', 'rel|RSI', 'trend|vs 50D MA', 'trend|vs 200D MA']],
    ['The business in numbers', ['size|Revenue TTM', 'profit|Gross margin', 'size|Net income', 'cflow|FCF TTM', 'finpos|Net cash',
      'growth|Rev grth Q YoY', 'growth|Earn grth Q YoY', 'profit|Profit margin', 'profit|Margin change', 'profit|ROE', 'finpos|Debt / equity']],
    ['Valuation', ['value|Live P/E', 'value|Fwd P/E', 'value|P/S', 'value|EV/EBITDA', 'divs|Dividend yield', 'divs|Buyback yield']],
    ['Ownership and positioning', ['own|Institutions', 'own|13F holders', 'own|13F shares chg', 'own|Short % float', 'own|Put/call OI', 'react|Insider net']],
  ];

  const money = (v) => (v == null || !isFinite(v) ? null : (v < 0 ? '-' : '') + '$' + (Math.abs(v) >= 1e12 ? (Math.abs(v) / 1e12).toFixed(2) + 'T' : Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(1) + 'B' : Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : Math.round(Math.abs(v)).toLocaleString('en-US')));
  const pct = (v, d) => (v == null || !isFinite(v) ? null : v.toFixed(d == null ? 1 : d) + '%');
  const signed = (v, d) => (v == null || !isFinite(v) ? null : (v > 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%');
  const count = (v) => (v == null || !isFinite(v) ? null : Math.round(v).toLocaleString('en-US'));
  const day = (iso) => { const t = new Date(String(iso || '').slice(0, 10) + 'T12:00:00'); return isNaN(t.getTime()) ? null : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

  // d: { symbol, name, asOf, description, fields (RowCard.fieldValues), capret, segments, insider, options, inst, funds, holders, events, earnings }
  // -> [{ title, items: [[label, value]] }]. An item with no value is left off:
  // the model is never shown a dash to interpret.
  function factSheet(d) {
    const out = [];
    const push = (title, items) => { const got = items.filter((x) => x && x[1] != null && String(x[1]).trim() !== '' && String(x[1]) !== '—'); if (got.length) out.push({ title, items: got.map(([k, v]) => [k, String(v)]) }); };
    const F = d.fields || {};
    for (const [title, keys] of ROW_SECTIONS) {
      push(title, keys.map((k) => { const v = F[k]; return v && v.t ? [k.slice(k.indexOf('|') + 1), v.t] : null; }));
    }
    const R = d.capret;
    if (R && R.last) {
      const L = R.last, X = R.ratios || {};
      const span = (R.basis === 'TTM' ? 'twelve months to ' : 'fiscal year to ') + day(L.end);
      push('What it did with its cash (' + span + ')', [
        ['Shares bought back', money(L.buybacks)], ['Dividends paid', money(L.dividends)], ['Returned to shareholders in total', money(L.returned)],
        ['That as a share of free cash flow', X.ofFcf == null ? null : Math.round(X.ofFcf) + '%'], ['Pay given in stock', money(L.stockComp)],
        ['Change in diluted share count on the fiscal year before', signed(R.sharesChange)]]);
    }
    const S = d.segments;
    if (S && Array.isArray(S.kinds) && S.kinds.length) {
      const K = S.kinds[0];
      const parts = (K.members || []).filter((m) => !m.subtotal && m.v != null).slice(0, 5);
      push('Where the revenue comes from (' + (S.ptype === 'Q' ? 'quarter to ' : 'fiscal year to ') + day(S.end || S.fyEnd) + ', ' + String(K.title || '').toLowerCase() + ')',
        [['Revenue in the period', money(S.total)], ['Change on a year before', signed(S.totalChange)]]
          .concat(parts.map((m) => [m.name, money(m.v) + (m.pct == null ? '' : ', ' + Math.round(m.pct) + '% of revenue') + (m.change == null ? '' : ', ' + signed(m.change) + ' on a year before')])));
    }
    const W = d.insider && Array.isArray(d.insider.windows) ? d.insider.windows.find((w) => w.days === 365) : null;
    if (W && W.trades) {
      push('Insider trades on the open market, last twelve months', [
        ['Bought', W.bought.trades ? money(W.bought.value) + ' by ' + W.bought.people + (W.bought.people === 1 ? ' person' : ' people') : 'none'],
        ['Sold', W.sold.trades ? money(W.sold.value) + ' by ' + W.sold.people + (W.sold.people === 1 ? ' person' : ' people') : 'none'],
        ['Share of the dollars sold that was under a pre-arranged plan', W.plannedShare == null ? null : Math.round(W.plannedShare) + '%']]);
    }
    const P = d.options;
    if (P && P.total > 0) {
      push('Options open at the close of ' + day(P.asOf), [['Call contracts', count(P.call)], ['Put contracts', count(P.put)], ['Puts per call', P.pcr == null ? null : P.pcr.toFixed(2)]]);
    }
    const H = d.inst;
    if (H && H.managers) {
      push('Institutional holders, ' + (H.quarter || 'last published quarter'), [
        ['Managers reporting a holding', count(H.managers)], ['Share of the company they hold', H.pct != null && H.pct <= 100 ? pct(H.pct) : null],
        ['Change in their combined shares on the quarter before', signed(H.sharesChange)],
        ['Largest holders', (H.top || []).slice(0, 3).map((t) => t.name + (t.pct == null ? '' : ' (' + pct(t.pct) + ')')).join('; ') || null]]);
    }
    const FH = d.funds;
    if (FH && FH.count) {
      push('Funds holding it' + (FH.asOf ? ', reports as of ' + FH.asOf : ''), [['Mutual funds and ETFs holding it', count(FH.count)],
        ['Largest', (FH.top || []).slice(0, 3).map((t) => t.name).join('; ') || null]]);
    }
    const LH = (d.holders || []).slice(0, 2);
    if (LH.length) push('Filings by holders of more than 5%', LH.map((e) => [day(e.filed) + ', ' + (e.form || 'filing'), (e.holder || 'a holder') + (e.pctText ? ' reported ' + e.pctText : '')]));
    const EV = (d.events || []).slice(0, 3);
    if (EV.length) push('Recent company announcements (Form 8-K)', EV.map((e) => [day(e.filed), e.label || 'an 8-K']));
    const EQ = (d.earnings || []).filter((q) => q && q.epsActual != null && q.epsEstimate != null).slice(0, 4);
    if (EQ.length) push('Earnings per share against the estimate, latest quarters', EQ.map((q) => [day(q.date), 'reported ' + Number(q.epsActual).toFixed(2) + ' against an estimate of ' + Number(q.epsEstimate).toFixed(2)]));
    if (d.description) out.unshift({ title: 'What the company says it does', items: [['Description', String(d.description).replace(/\s+/g, ' ').trim().slice(0, 700)]] });
    return out;
  }

  const sheetText = (sections) => sections.map((s) => '## ' + s.title + '\n' + s.items.map(([k, v]) => '- ' + k + ': ' + v).join('\n')).join('\n\n');

  const HEADINGS = ['The company', 'Price and trend', 'The business in numbers', 'Cash and ownership', 'Recent filings'];
  const RULES = [
    'You are writing a short factual company summary for a public blog. You are given a FACT SHEET. It is the only source you may use.',
    'Rules, all of them strict:',
    '1. Use only what is on the fact sheet. Do not add anything you know about the company, its products, its history, its competitors or the market.',
    '2. Quote every figure exactly as it is written on the fact sheet: same digits, same units. Do not round, convert, add, subtract, average or compare to produce a new number.',
    '3. Describe; never advise. Do not say or imply that the stock is cheap, expensive, attractive, risky, a good or bad investment, or that anyone should do anything. Do not use the words buy, sell, undervalued, overvalued, bullish, bearish, upside, downside, target, recommend, opportunity, outperform or underperform. Do not predict.',
    '4. The Signal is this site\'s own mechanical reading. Mention it exactly once, together with the rule given beside it under "Why", and call it a mechanical reading.',
    '5. A total of insider sales is not a judgement: if you mention sales, mention the share under a pre-arranged plan where it is given. Options figures are counts of contracts outstanding and say nothing about direction.',
    '6. Where the sheet has nothing on a topic, leave the topic out. Never say data is missing.',
    '7. Plain, calm English. No superlatives, no exclamation marks, no bullet lists, no bold.',
    'Format: Markdown. Exactly these five second-level headings, in this order, each followed by one or two short paragraphs: ' + HEADINGS.map((h) => '"## ' + h + '"').join(', ') + '. Leave a heading out only if the sheet has nothing for it. No title, no introduction before the first heading, nothing after the last paragraph. 280 to 420 words in all.',
  ].join('\n');

  function prompt(d, sections) {
    return { system: RULES, user: 'FACT SHEET for ' + d.name + ' (' + d.symbol + '), data as of ' + (day(d.asOf) || d.asOf || 'the last refresh') + '.\n\n' + sheetText(sections) + '\n\nWrite the summary now.' };
  }

  // ---- the checks ---------------------------------------------------------------
  // A number, as it might be written: 255.2, $272.6B, 49.6%, 1,163, -4.1, 0.77.
  const NUM = /\d[\d,]*(?:\.\d+)?/g;
  const core = (s) => String(s).replace(/,/g, '').replace(/^0+(?=\d)/, '');
  // Numbers anyone may write without their being on the sheet: small counts
  // and the spans the sheet's own labels are written in.
  const FREE = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '13', '50', '52', '100', '200', '500']);
  const BANNED = /\b(buy|sell|strong buy|undervalued|overvalued|bullish|bearish|upside|downside|price target|target price|recommend(?:s|ed|ation)?|opportunity|outperform(?:s|ed)?|underperform(?:s|ed)?|should|must own|attractive|bargain|cheap|expensive)\b/gi;

  function check(text, sections, d) {
    const problems = [];
    const body = String(text || '');
    const allowed = new Set();
    const src = sheetText(sections) + ' ' + (d ? [d.name, d.symbol, day(d.asOf), d.asOf].join(' ') : '');
    for (const m of src.match(NUM) || []) allowed.add(core(m));
    const bad = [];
    for (const m of body.match(NUM) || []) { const c = core(m); if (!allowed.has(c) && !FREE.has(c) && !bad.includes(m)) bad.push(m); }
    if (bad.length) problems.push('Figures not on the fact sheet: ' + bad.slice(0, 12).join(', ') + (bad.length > 12 ? ' and ' + (bad.length - 12) + ' more' : ''));
    const words = [...new Set((body.match(BANNED) || []).map((w) => w.toLowerCase()))];
    if (words.length) problems.push('Words of advice or prediction: ' + words.join(', '));
    const heads = (body.match(/^##\s+(.+)$/gm) || []).map((h) => h.replace(/^##\s+/, '').trim());
    const odd = heads.filter((h) => !HEADINGS.includes(h));
    if (!heads.length) problems.push('No section headings came back');
    if (odd.length) problems.push('Headings that were not asked for: ' + odd.join(', '));
    if (/^\s*[-*]\s+/m.test(body)) problems.push('It used a bullet list');
    const n = body.trim() ? body.trim().split(/\s+/).length : 0;
    if (n < 150) problems.push('Too short: ' + n + ' words');
    if (n > 600) problems.push('Too long: ' + n + ' words');
    if (d && d.signal && !new RegExp(String(d.signal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(body)) problems.push('The Signal is not mentioned');
    return { ok: problems.length === 0, problems, words: n };
  }

  // The post: a line saying what this is, the prose, then the figures it was
  // written from, so a reader can check any sentence against its source.
  function postBody(d, sections, narrative, result) {
    const when = day(d.asOf) || 'the last refresh';
    const head = '*Company summary. Data as of ' + when + '. Written by an AI model from the figures listed below and reviewed before publishing. A description of what the data says, not investment advice, not a rating and not a forecast.*';
    const flag = result && !result.ok
      ? '> **CHECK BEFORE PUBLISHING.** The automatic checks flagged this draft. ' + result.problems.join('. ') + '. Correct the text or delete this draft; remove this note before publishing.\n\n' : '';
    const figures = sections.filter((s) => s.title !== 'What the company says it does')
      .map((s) => '### ' + s.title + '\n\n' + s.items.map(([k, v]) => '- **' + k + ':** ' + v).join('\n')).join('\n\n');
    return flag + head + '\n\n' + String(narrative || '').trim() + '\n\n---\n\n## The figures behind this summary\n\n' + figures
      + '\n\n---\n\n*Sources: prices and fundamentals from the screener\'s data provider; statements, insider trades, 13F and fund holdings, large-holder filings and announcements from the SEC; options from the Options Clearing Corporation. Figures are as of the dates shown and go out of date. The Signal is a mechanical reading of fixed rules. Nothing here is a recommendation to trade.*\n';
  }

  const slugOf = (symbol, asOf) => String(symbol).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-company-summary-' + String(asOf || '').slice(0, 10);
  const titleOf = (d) => d.name + ' (' + d.symbol + '): company summary, ' + (day(d.asOf) || '');

  const api = { ROW_SECTIONS, HEADINGS, RULES, factSheet, sheetText, prompt, check, postBody, slugOf, titleOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Summary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
