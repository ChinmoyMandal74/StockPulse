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
  root.ReleaseView = { esc, money, eps, chg, estimate, tenQ, refused, shortDay };
})(typeof window !== 'undefined' ? window : globalThis);
