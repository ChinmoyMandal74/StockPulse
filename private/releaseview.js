// How an earnings release (releases.js, earnings_releases) is written out on a
// page: the money and per-share figures, the change on a year ago, the price
// provider's estimate, and the check against the 10-Q. ONE implementation for
// /filings and the stock page; each page lays the pieces out and styles the
// two classes it returns (rv-sub, a quiet line under a figure; rv-amb, amber
// for what needs noticing). The promo card (cards.js) has no DOM and formats
// for itself.
(function (root) {
  const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pre = (cur) => (!cur || cur === 'USD' ? '$' : cur + ' ');
  const DASH = '—', MINUS = '−';
  function money(v, cur) {
    if (v == null) return DASH;
    const a = Math.abs(v), sg = v < 0 ? MINUS : '';
    return sg + pre(cur) + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : Math.round(a).toLocaleString('en-US'));
  }
  const eps = (v, cur) => (v == null ? DASH : (v < 0 ? MINUS : '') + pre(cur) + Math.abs(v).toFixed(2));
  // A change off a loss or a zero is no percentage.
  function chg(a, b) {
    if (a == null || b == null || !(b > 0)) return '';
    const p = (a / b - 1) * 100;
    return (p > 0 ? '+' : p < 0 ? MINUS : '') + Math.abs(p).toFixed(1) + '% on a year ago';
  }
  // The provider's estimate, and how far the figure the provider matched (the
  // adjusted one, or GAAP) is above or below it. Amber when the provider's own
  // figure matches neither of the company's.
  function estimate(r) {
    const cur = r.currency, pv = r.provider;
    let out = DASH;
    if (pv && pv.estimate != null) {
      const vs = pv.matches === 'adjusted' ? r.epsAdj : pv.matches === 'gaap' ? r.epsGaap : null;
      const d = vs == null ? null : Math.round((vs - pv.estimate) * 100) / 100;
      out = esc(eps(pv.estimate, cur)) + (d == null ? '' : '<span class="rv-sub">' + (d === 0 ? 'in line with it' : esc(eps(Math.abs(d), cur)) + (d > 0 ? ' above' : ' below'))
        + (pv.matches === 'gaap' ? ', as reported' : '') + '</span>');
    }
    if (pv && pv.matches === 'differs') {
      out += '<span class="rv-sub rv-amb" title="The price provider gives ' + esc(eps(pv.actual, cur)) + ' for this report, which is neither figure in the release.">Provider’s '
        + esc(eps(pv.actual, cur)) + ' matches neither</span>';
    }
    return out;
  }
  const shortDay = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  // Against the 10-Q, once it is filed: a quiet line when the figures agree,
  // amber with what the 10-Q has when they do not. Nothing before it is filed.
  function tenQ(r) {
    if (!r.secCheck || r.secCheck === 'none') return '';
    const form = esc(r.secForm || '10-Q') + (r.secFiled ? ' filed ' + esc(shortDay(r.secFiled)) : '');
    if (r.secCheck === 'match') return '<span class="rv-ok">Matches its ' + form + '.</span>';
    const cur = r.currency, d = r.secDiffers || [];
    const said = [];
    if (d.includes('revenue')) said.push('revenue ' + money(r.secRevenue, cur));
    if (d.includes('net income')) said.push('net income ' + money(r.secNetIncome, cur));
    if (d.includes('diluted EPS')) said.push('diluted EPS ' + eps(r.secEps, cur));
    return '<span class="rv-amb" title="The release’s figure is shown as the company printed it; the 10-Q’s line can be a different one (continuing operations, service revenue).">The '
      + form + ' has ' + esc(said.join(', ')) + '.</span>';
  }
  // Figures the release did not contain as given (the summary's own note is not one).
  const refused = (r) => (r.problems || []).filter((p) => !/^summary/.test(p));

  // THE SCREENER'S GROUP "Last Earning AI Extracted" (2026-10-22): one release
  // as the row fields the columns read, er-prefixed so nothing else on a row
  // is touched. The screener merges these after it paints (and after the
  // Signal is scored); the stock page fills its All fields from the same. A
  // change off a loss or a zero is no percentage, as everywhere.
  const yoy = (a, b) => (a == null || b == null || !(b > 0) ? null : (a / b - 1) * 100);
  const FIELD_KEYS = ['erFiled', 'erPeriodEnd', 'erPeriodLabel', 'erCurrency', 'erUrl', 'erRevenue', 'erRevYoY', 'erOpIncome', 'erOpYoY', 'erNetIncome', 'erNiYoY',
    'erEps', 'erEpsYoY', 'erEpsAdj', 'erEpsAdjYoY', 'erEpsAdjLabel', 'erEpsAdjExcludes', 'erEst', 'erVsEst', 'erVsEstBasis', 'erVsEstWord', 'erGuideVsQ', 'erGuideVsQNote', 'erEpsGuideVsFy', 'erEpsGuideNote', 'erGuideChange', 'erGuideChangeQuote', 'erGuide', 'erTenQ', 'erTenQNote', 'erSummary'];
  const TENQ_WORD = { match: 'Matches', differs: 'Differs', none: 'Not comparable' };
  function tenQText(r) {
    if (!r || !r.secCheck) return 'The quarter’s 10-Q is not filed yet, or not read yet.';
    if (r.secCheck === 'match') return 'Matches its ' + (r.secForm || '10-Q') + (r.secFiled ? ' filed ' + shortDay(r.secFiled) : '') + '.';
    if (r.secCheck === 'none') return 'The 10-Q carries none of the same figures to compare.';
    const d = r.secDiffers || [], said = [];
    if (d.includes('revenue')) said.push('revenue ' + money(r.secRevenue, r.currency));
    if (d.includes('net income')) said.push('net income ' + money(r.secNetIncome, r.currency));
    if (d.includes('diluted EPS')) said.push('diluted EPS ' + eps(r.secEps, r.currency));
    return 'The ' + (r.secForm || '10-Q') + (r.secFiled ? ' filed ' + shortDay(r.secFiled) : '') + ' has ' + said.join(', ') + '; the release’s line can be a different one.';
  }
  const CHANGE_WORD = { raised: 'Raised', lowered: 'Lowered', reaffirmed: 'Reaffirmed', initiated: 'Initiated', withdrawn: 'Withdrawn', mixed: 'Mixed' };
  // THE LABEL'S COLOURS (the owner, 2026-10-23: raised dark green). Pages use
  // the app.css tokens through the classes; mail cannot, so it takes these.
  const CHANGE_HEX = { raised: '#15803d', lowered: '#b91c1c', withdrawn: '#b91c1c', mixed: '#c2410c', initiated: '#1d4ed8', reaffirmed: '#475569' };
  // A word (Raised) or a key (raised) to the key.
  const changeKey = (c) => { const k = String(c || '').toLowerCase(); return CHANGE_WORD[k] ? k : null; };
  const changeTag = (c, title) => { const k = changeKey(c); return k ? '<span class="gch gch-' + k + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + CHANGE_WORD[k] + '</span>' : ''; };
  // A guidance item's figures in words: a range, or its single figure.
  const guideRange = (g, cur, f) => (g.low != null && g.high != null ? f(g.low, cur) + ' to ' + f(g.high, cur) : f(g.mid != null ? g.mid : g.low != null ? g.low : g.high, cur));
  function fields(r) {
    const o = {};
    for (const k of FIELD_KEYS) o[k] = null;
    if (!r || !r.isResults && r.isResults !== undefined) return o;
    const pv = r.provider;
    const basis = pv && pv.estimate != null ? (pv.matches === 'adjusted' && r.epsAdj != null ? 'adjusted' : pv.matches === 'gaap' && r.epsGaap != null ? 'gaap' : null) : null;
    const vs = basis === 'adjusted' ? r.epsAdj : basis === 'gaap' ? r.epsGaap : null;
    // Next quarter's revenue outlook against this quarter's revenue: the
    // range's middle, or the printed midpoint. Money guidance FOR A QUARTER
    // only: a full-year outlook against one quarter read +297% for Medpace
    // on the first draw. A period naming both ("Third Quarter and Full Year")
    // is left out too.
    // THE GUIDANCE READINGS are worked out once, on the server (releases.js
    // guideReadings, handed over as r.guideRead by forReader); this only lays
    // them out. A row without them falls back to the headline item below.
    const gr = r.guideRead || null;
    const quarterly = /quarter|\bq[1-4]\b/i.test(r.guidePeriod || '') && !/full|year|annual/i.test(r.guidePeriod || '');
    const mid = !quarterly ? null : r.guideKind === 'revenue_range' && r.guideLow != null && r.guideHigh != null ? (r.guideLow + r.guideHigh) / 2
      : r.guideKind === 'revenue_midpoint' ? r.guideMid : null;
    Object.assign(o, {
      erFiled: r.filed || null, erPeriodEnd: r.periodEnd || null, erPeriodLabel: r.periodLabel || null, erCurrency: r.currency || null, erUrl: r.url || null,
      erRevenue: r.revenue, erRevYoY: yoy(r.revenue, r.revenuePrior), erOpIncome: r.opIncome, erOpYoY: yoy(r.opIncome, r.opIncomePrior),
      erNetIncome: r.netIncome, erNiYoY: yoy(r.netIncome, r.netIncomePrior), erEps: r.epsGaap, erEpsYoY: yoy(r.epsGaap, r.epsGaapPrior),
      erEpsAdj: r.epsAdj, erEpsAdjYoY: yoy(r.epsAdj, r.epsAdjPrior), erEpsAdjLabel: r.epsAdj != null ? r.epsAdjLabel || null : null, erEpsAdjExcludes: r.epsAdj != null ? r.epsAdjExcludes || null : null,
      erEst: pv && pv.estimate != null ? pv.estimate : null, erVsEst: vs == null ? null : Math.round((vs - pv.estimate) * 100) / 100, erVsEstBasis: basis, erVsEstWord: vs == null ? null : vsEstWord(vs, pv.estimate),
      erGuideVsQ: gr ? gr.revVsQ : mid != null && r.revenue > 0 ? (mid / r.revenue - 1) * 100 : null,
      erGuideVsQNote: gr && gr.revVsQ != null && gr.revQ ? 'Revenue guidance for ' + (gr.revQ.periodLabel || 'the coming quarter') + ': ' + guideRange(gr.revQ, r.currency, money) + ', against ' + money(r.revenue, r.currency) + ' this quarter.' : null,
      erEpsGuideVsFy: gr ? gr.epsVsFy : null,
      erEpsGuideNote: gr && gr.epsFy ? (gr.epsFy.basis === 'GAAP' ? 'GAAP' : 'Adjusted') + ' EPS guidance for ' + (gr.epsFy.period || 'the year') + ': ' + guideRange(gr.epsFy, r.currency, eps)
        + ', against ' + eps(gr.epsFy.prior, r.currency) + ' the year before (' + (gr.epsFy.priorFrom === 'release' ? 'as the release prints it' : 'from the 10-K') + ').' : null,
      erGuideChange: gr && gr.change ? CHANGE_WORD[gr.change] || null : null, erGuideChangeQuote: gr && gr.change ? gr.changeQuote || null : null,
      erGuide: r.guideSentence || null,
      erTenQ: r.secCheck ? TENQ_WORD[r.secCheck] || null : 'Waiting', erTenQNote: tenQText(r), erSummary: r.summary || null,
    });
    return o;
  }
  // THE RESULT AGAINST THE ESTIMATE IN A WORD (2026-10-25, the owner: "saying
  // above, in line or below"). In line: within 2% of the estimate or within a
  // cent, whichever is wider, so a $0.01 gap on a $0.05 estimate is not a
  // 20% beat. The same per-share figure the vs est. column differences.
  const VS_EST_BAND = 0.02;
  function vsEstWord(actual, est) {
    if (actual == null || est == null || !isFinite(actual) || !isFinite(est)) return null;
    const d = Math.round((actual - est) * 100) / 100;
    if (Math.abs(d) <= Math.max(0.01, Math.abs(est) * VS_EST_BAND)) return 'In line';
    return d > 0 ? 'Above' : 'Below';
  }

  // WHAT HELPED AND WHAT WEIGHED, two columns of the company's own reasons
  // (2026-10-23). One definition for the stock page and the results page;
  // styled once in app.css (.rv-drv). The email lays them out for itself.
  // Each point's backing phrase from the release is its hover.
  function driversHtml(r) {
    const d = r && r.drivers;
    if (!d || (!(d.helped || []).length && !(d.weighed || []).length)) return '';
    const col = (title, list) => '<div class="rv-drv-col"><b>' + title + '</b>' + ((list || []).length
      ? '<ul>' + list.map((x) => '<li title="' + esc('\u201c' + x.evidence + '\u201d') + '">' + esc(x.text) + '</li>').join('') + '</ul>'
      : '<p>None stated.</p>') + '</div>';
    return '<div class="rv-drv">' + col('What helped', d.helped) + col('What weighed', d.weighed) + '</div>';
  }

  // THE GUIDANCE AS A GRID (2026-10-23, the owner over CrowdStrike's
  // "Total revenue | $1,523.2 - $1,529.2 million | $5,991.1 - $6,011.1 million"):
  // the stored guidance items laid out as the release's own table, one row a
  // measure and one column a period, instead of the sentence with its pipes.
  // Money items are stored scaled; an 'other' item keeps the printed number and
  // its unit word. Empty string when there are no items (the page then shows
  // the sentence, as for readings made before the items were read).
  const GUIDE_LABEL = { revenue: 'Revenue', eps_gaap: 'EPS, as reported', eps_adjusted: 'EPS, adjusted' };
  const UNIT_WORD = { thousands: 'thousand', millions: 'million', billions: 'billion' };
  function guideValue(g, v, cur) {
    if (v == null) return null;
    if (g.unit === 'percent') return (Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v * 10) / 10) + '%';
    if (g.metric === 'revenue') return money(v, cur);
    if (g.metric === 'eps_gaap' || g.metric === 'eps_adjusted' || g.unit === 'per_share') return eps(v, cur);
    const n = (v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return UNIT_WORD[g.unit] ? pre(cur) + n + ' ' + UNIT_WORD[g.unit] : n;
  }
  function guideCell(g, cur) {
    const lo = guideValue(g, g.low, cur), hi = guideValue(g, g.high, cur), mid = guideValue(g, g.mid, cur);
    const v = lo && hi ? lo + ' – ' + hi : mid || (lo ? 'from ' + lo : hi ? 'up to ' + hi : null);
    if (!v) return null;
    const pr = guideValue(g, g.prior, cur);
    return v + (pr ? ' (year before ' + pr + ')' : '');
  }
  const guideLabel = (g) => GUIDE_LABEL[g.metric]
    || (String(g.sentence || '').split(/\s*[|:]\s*/)[0] || '').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Other';
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  function guideTable(r) {
    const items = Array.isArray(r && r.guides) ? r.guides : [];
    const rows = [], cols = [], cell = {};
    for (const g of items) {
      const v = guideCell(g, r.currency);
      if (!v) continue;
      const k = guideLabel(g), p = cap(g.periodLabel || '') || 'Outlook';
      if (!rows.includes(k)) rows.push(k);
      if (!cols.includes(p)) cols.push(p);
      if (cell[k + '\u0000' + p] == null) cell[k + '\u0000' + p] = v;
    }
    if (!rows.length) return '';
    return '<div class="rv-gtw"><table class="rv-gt"><thead><tr><th></th>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>'
      + rows.map((k) => '<tr><th>' + esc(k) + '</th>' + cols.map((c) => '<td>' + esc(cell[k + '\u0000' + c] || '—') + '</td>').join('') + '</tr>').join('')
      + '</tbody></table></div>';
  }
  // ONE LINE A QUARTER for a history table (the stock page's, 2026-10-23): the
  // few figures a row shows, worked out from the full reading on the server so
  // the list stays small. The estimate is compared with the figure the price
  // provider matched, as estimate() does.
  function historyRow(r) {
    const pv = r.provider || null;
    const vs = pv && pv.estimate != null ? (pv.matches === 'adjusted' ? r.epsAdj : pv.matches === 'gaap' ? r.epsGaap : null) : null;
    return { accn: r.accn, filed: r.filed, periodLabel: r.periodLabel || null, periodEnd: r.periodEnd || null, currency: r.currency || null,
      revenue: r.revenue == null ? null : r.revenue, revYoY: yoy(r.revenue, r.revenuePrior),
      epsGaap: r.epsGaap == null ? null : r.epsGaap, epsYoY: yoy(r.epsGaap, r.epsGaapPrior), epsAdj: r.epsAdj == null ? null : r.epsAdj,
      est: pv && pv.estimate != null ? pv.estimate : null, vsEst: vs == null || !pv || pv.estimate == null ? null : Math.round((vs - pv.estimate) * 100) / 100,
      estDiffers: !!(pv && pv.matches === 'differs'),
      guideChange: changeKey(r.guideRead && r.guideRead.change ? r.guideRead.change : r.guideChange),
      tenQ: r.secCheck || null };
  }
  root.ReleaseView = { esc, money, eps, chg, estimate, tenQ, refused, shortDay, fields, FIELD_KEYS, tenQText, CHANGE_WORD, CHANGE_HEX, changeKey, changeTag, vsEstWord, VS_EST_BAND, driversHtml, guideTable, guideCell, historyRow };
})(typeof window !== 'undefined' ? window : globalThis);
