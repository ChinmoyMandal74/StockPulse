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
  const money = (v) => { if (v == null || !isFinite(Number(v))) return DASH; const n = Number(v), a = Math.abs(n), s = n < 0 ? '−$' : '$'; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(0) + 'K' : s + a; };
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
    if (f.crowd) {
      const c = f.crowd, parts = [];
      if (c.revenue != null) parts.push('revenue ' + money(c.revenue));
      if (c.net_income != null) parts.push('net income ' + money(c.net_income));
      if (c.employees != null) parts.push(num(c.employees) + ' staff');
      add('Own figures (Form C)', (parts.join(' · ') || 'no figures filed') + ' <span style="color:var(--faint)">(' + (c.period ? 'year to ' + esc(c.period) : 'filed ' + esc(c.filed || '')) + ')</span>'
        + (f.crowdLink === false ? '' : ' <a href="/crowdfunding?q=' + encodeURIComponent(c.cik) + '&open=' + encodeURIComponent(c.cik) + '" target="_blank" rel="noopener">by year</a>'));
    }
    if (f.rega) {
      const r = f.rega, parts = [];
      if (r.revenue != null) parts.push('revenue ' + money(r.revenue));
      if (r.net_income != null) parts.push('net income ' + money(r.net_income));
      if (r.employees_ft != null) parts.push(num(r.employees_ft) + ' full-time staff');
      add('Own figures (Reg A)', (parts.join(' · ') || 'no figures filed') + ' <span style="color:var(--faint)">(offering statement filed ' + esc(r.filed || '') + (r.auditor ? ', audited by ' + esc(r.auditor) : '') + (r.offering_total ? '; seeking up to ' + money(r.offering_total) : '') + ')</span>');
    }
    if (f.ppp) add('PPP loans, 2020–21', money(f.ppp.amount) + (f.ppp.jobs ? ' <span style="color:var(--faint)">· ' + num(f.ppp.jobs) + ' jobs reported</span>' : ''));
    if (f.sba) {
      const ys = f.sba.loans.map((x) => x.fy).filter(Boolean), a = Math.min(...ys), b = Math.max(...ys);
      add('SBA loans', money(f.sba.amount) + ' <span style="color:var(--faint)">in ' + f.sba.loans.length + ' loan' + (f.sba.loans.length === 1 ? '' : 's') + (ys.length ? ', ' + (a === b ? a : a + '–' + b) : '') + (f.sba.jobs ? ' · ' + num(f.sba.jobs) + ' jobs supported' : '') + (f.sba.chargedOff ? ' · ' + f.sba.chargedOff + ' charged off' : '') + '</span>');
    }
    if (f.fed) {
      const ys = f.fed.years, a = ys[0].fy, b = ys[ys.length - 1].fy;
      add('Federal contracts', money(f.fed.total) + ' <span style="color:var(--faint)">over fiscal ' + (a === b ? a : a + '–' + b) + (f.fed.agency ? ', mostly ' + esc(f.fed.agency) : '') + '</span>');
    }
    if (f.web) {
      const hits = [f.web.name_hit && 'name', f.web.city_hit && 'city', f.web.phone_hit && 'telephone'].filter(Boolean);
      const how = f.web.verdict === 'given' ? 'address given by hand' + (hits.length ? '; ' + hits.join(' and ') + ' on its pages' : '; its filed name and city are not on its pages')
        : f.web.verdict === 'confirmed' ?'name and ' + [f.web.city_hit && 'city', f.web.phone_hit && 'telephone'].filter(Boolean).join(' and ') + ' on its pages' : 'name only on its pages; not read';
      add('Website', '<a href="' + esc(f.web.url || 'https://' + f.web.domain + '/') + '" target="_blank" rel="noopener noreferrer">' + esc(f.web.domain) + '</a> <span style="color:var(--faint)">(' + esc(how) + ')</span>');
      const r = f.web.read;
      if (r && r.founded) add('Founded (its site)', String(r.founded));
      if (r && r.open_jobs != null) add('Open jobs (its site)', num(r.open_jobs));
    }
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
    if (f.sba) {
      const ST = { PIF: 'paid in full', CHGOFF: 'charged off', CANCLD: 'cancelled', COMMIT: 'not yet paid out', EXEMPT: 'running', 'NOT FUNDED': 'not funded', CLOSED: 'closed' };
      out += '<table class="fs-ppp">' + f.sba.loans.map((x) => '<tr><td>' + esc(x.approved || x.fy || '') + ' · ' + (x.program === '504' ? '504' : '7(a)') + '</td><td>' + esc(x.name) + '<span style="display:block;color:var(--faint);font-size:11px">' + esc([[x.city, x.state].filter(Boolean).join(', '), x.lender, ST[x.status] || x.status].filter(Boolean).join(' · ')) + '</span></td><td class="n">' + money(x.amount) + '</td><td class="n">' + (x.jobs ? num(x.jobs) + ' jobs' : DASH) + '</td></tr>').join('') + '</table>'
        + '<p class="fs-note">SBA loans are matched by name and state as PPP loans are. Jobs supported are the lender’s estimate on the application, not checked by the SBA.</p>';
    }
    if (f.web && f.web.read) {
      const r = f.web.read;
      const line = (k, v) => (v ? '<p class="fs-note"><b style="color:var(--strong);font-weight:500">' + esc(k) + ':</b> ' + v + '</p>' : '');
      const joined = (a) => (a && a.length ? a.map(esc).join(' · ') : '');
      out += '<h4 style="margin:12px 0 4px!important">From its own website</h4>'
        + (r.what_they_do ? '<p class="fs-note">“' + esc(r.what_they_do) + '”</p>' : '')
        + line('Headquarters', r.headquarters ? esc(r.headquarters) + ' <span style="color:var(--faint)">(“' + esc(r.headquarters_quote || '') + '”)</span>' : '')
        + line('Services', joined(r.services)) + line('Serves', joined(r.markets))
        + line('Locations (' + (r.locations || []).length + ')', joined(r.locations))
        + line('Key people (' + (r.leaders || []).length + ')', (r.leaders || []).map((l) => esc(l.name) + ((l.role || l.location) ? ' <span style="color:var(--faint)">(' + [l.role, l.location].filter(Boolean).map(esc).join(', ') + ')</span>' : '')).join(' · '))
        + line('Customers named', joined(r.clients))
        + line('Staff', r.employees_quote ? '“' + esc(r.employees_quote) + '”' : '')
        + line('History', (r.history || []).map((h) => esc(h.year) + ': “' + esc(h.quote) + '”').join(' · '))
        + line('Hiring', r.hiring_quote ? '“' + esc(r.hiring_quote) + '”' : '')
        + '<p class="fs-note">Every phrase above is copied from the company’s own pages and checked against them; the site was found by guessing its address from the name.</p>';
    }
    if (f.fed) out += '<p class="fs-note">Federal contracts are matched ' + (f.fed.byPhone ? 'by the company’s own telephone or ' : '') + 'by name and state; recipients matched: ' + f.fed.recipients.slice(0, 4).map(esc).join('; ') + (f.fed.recipients.length > 4 ? '…' : '') + '.</p>';
    if (!cells.length) out += '<p class="fs-note">Nothing more is held on this company.</p>';
    return out + '</div>';
  }

  const api = { html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FactSheet = api;
})();
