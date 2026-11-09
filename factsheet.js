// The fact sheet: everything the local archive holds on one company, drawn
// the same way in the Form D and Employers side panels (backlog 61, phase 5).
// The facts come from formd-view.js facts(); this only draws them. Served by
// the local viewer only, never by the site.
//   FactSheet.html(facts) -> an HTML string
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DASH = '<span style="color:var(--faint)">—</span>';
  const num = (v) => (v == null || !isFinite(Number(v)) ? DASH : Number(v).toLocaleString('en-US'));
  const money = (v) => { if (v == null || !isFinite(Number(v))) return DASH; const n = Number(v), a = Math.abs(n); return a >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? '$' + (n / 1e3).toFixed(0) + 'K' : '$' + n; };
  const pct = (a, b) => (a == null || b == null || b < 10 ? null : (a / b - 1) * 100);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const STYLE = '<style>.fs-card{border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);background:color-mix(in srgb,var(--accent) 6%,var(--surface));border-radius:12px;padding:12px 14px;margin:4px 0 6px}'
    + '.fs-card h4{margin:0 0 8px!important}.fs-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;font-size:13px}'
    + '.fs-grid div{min-width:0}.fs-grid span{display:block;color:var(--faint);font-size:11px;letter-spacing:.04em;text-transform:uppercase}'
    + '.fs-grid b{color:var(--strong);font-weight:500}.fs-note{color:var(--muted);font-size:12px;margin:8px 0 0;line-height:1.45}'
    + '.fs-ppp{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}.fs-ppp td{padding:4px 6px;border-top:1px solid var(--hair)}.fs-ppp td.n{text-align:right;font-family:var(--mono)}'
    + '@media (max-width:600px){.fs-grid{grid-template-columns:minmax(0,1fr)}}</style>';

  function html(f) {
    if (!f) return '';
    const cells = [];
    const add = (k, v) => { if (v) cells.push('<div><span>' + esc(k) + '</span><b>' + v + '</b></div>'); };
    if (f.tickers && f.tickers.length) add('Now trades as', f.tickers.map(esc).join(', ') + (f.tracked && f.tracked.length ? ' (on Tickr Lab)' : ''));
    if (f.business) add('Business', esc(f.business.title) + ' <span style="color:var(--faint)">(' + esc(f.business.code) + (f.businessFrom === 'ppp' ? ', from its PPP loan' : '') + ')</span>');
    if (f.staff) {
      const g = pct(f.staff.now, f.staff.y2019);
      add('Staff, ' + f.staff.year, num(f.staff.now) + (g == null ? '' : ' <span style="color:' + (g >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(0) + '% since 2019</span>'));
      add('Plans on file', f.staff.firstYear + ' to ' + f.staff.year + ' (' + f.staff.years + ' years; ' + num(f.staff.first) + ' people in ' + f.staff.firstYear + ')');
    }
    if (f.raised) add('Money raised (Form D)', money(f.raised.sold) + ' <span style="color:var(--faint)">in ' + f.raised.n + ' offering' + (f.raised.n === 1 ? '' : 's') + ', ' + esc(String(f.raised.first || '').slice(0, 4)) + (f.raised.last && f.raised.last.slice(0, 4) !== String(f.raised.first || '').slice(0, 4) ? '–' + esc(f.raised.last.slice(0, 4)) : '') + '</span>');
    if (f.ppp) add('PPP loans, 2020–21', money(f.ppp.amount) + (f.ppp.jobs ? ' <span style="color:var(--faint)">· ' + num(f.ppp.jobs) + ' jobs reported</span>' : ''));
    add('Place', esc(f.place));
    if (f.incorporated) add('Incorporated in', esc(f.incorporated));
    if (f.fiscalYearEnd && /^\d{4}$/.test(f.fiscalYearEnd)) add('Fiscal year ends', MONTHS[Number(f.fiscalYearEnd.slice(0, 2)) - 1] + ' ' + Number(f.fiscalYearEnd.slice(2)));
    if (f.ein) add('Tax ID', esc(f.ein.slice(0, 2) + '-' + f.ein.slice(2)));
    if (f.names && f.names.length > 1) add('Names on file', f.names.map(esc).join('; '));
    let out = STYLE + '<div class="fs-card"><h4>Known facts</h4><div class="fs-grid">' + cells.join('') + '</div>';
    if (f.ppp) {
      out += '<table class="fs-ppp">' + f.ppp.loans.map((x) => '<tr><td>' + esc(x.approved || '') + (x.draw === 2 ? ' · second draw' : '') + '</td><td>' + esc(x.name) + '<span style="display:block;color:var(--faint);font-size:11px">' + esc([x.city, x.state].filter(Boolean).join(', ')) + '</span></td><td class="n">' + money(x.amount) + '</td><td class="n">' + (x.jobs == null ? DASH : num(x.jobs) + ' jobs') + '</td></tr>').join('') + '</table>'
        + '<p class="fs-note">PPP loans are matched by name and state (the loan files carry no tax ID), so a loan to another business of the same name in the same state can appear here.</p>';
    }
    if (!cells.length) out += '<p class="fs-note">Nothing more is held on this company.</p>';
    return out + '</div>';
  }

  const api = { html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FactSheet = api;
})();
