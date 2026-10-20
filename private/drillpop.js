// The history behind a number: click a cell on the screener, get a chart and a
// small table. The server side is drillhist.js and GET /api/drill; this is the
// panel, and nothing else on the page knows how it is drawn.
//
// WHICH CELLS. Only columns that have a real history behind them (the list
// below, which is drillhist.js's own and is tested against it). Price, return,
// trend and volume columns have none on purpose, and neither do the columns
// that are only a few weeks of the price provider's readings.
//
// A CELL IS FOUND BY ITS COLUMN, not by anything written on it: the header
// cell standing over it carries the column's key (see columns() for how a
// two-row header is read). So no cell needed changing to make it drillable,
// and a column added later is drillable the moment its key is on the list.
//
// THEY LOOK DRILLABLE BEFORE THEY ARE TOUCHED: a dotted underline and a
// pointer, from one generated rule per column. Not for a guest, who has no
// detail views.
(function (root) {
  'use strict';
  const KEYS = ['revenueTtm', 'grossProfitTtm', 'netIncomeTtm', 'operatingCashFlowTtm', 'fcfTtm', 'buybackYield',
    'grossMargin', 'operatingMargin', 'profitMargin', 'netMarginChg', 'fcfMargin', 'dilutedEpsTtm',
    'trailingPe', 'peLive', 'priceToSales', 'priceToBook', 'shortPctFloat', 'shortPctOutstanding', 'shortRatio', 'lastEarningsDate',
    'revGrowth3y', 'revGrowth5y', 'niGrowth3y', 'niGrowth5y'];
  const DRILL = new Set(KEYS);
  // THE SAME HISTORIES ON THE STOCK PAGE (2026-10-19, the owner: "enable this
  // drill down feature on the individual stock page section exactly how it
  // behaves on the screener"). Its "Everything the screener knows" rows are
  // rowcard's FIELD_SPEC, keyed `group|label`, where the screener's cells are
  // keyed by the column's data-key; this is the one map between the two, kept
  // beside the list it answers to. Every key on KEYS has its row here.
  const FIELD_OF = {
    'size|Revenue TTM': 'revenueTtm', 'size|Gross profit': 'grossProfitTtm', 'size|Net income': 'netIncomeTtm',
    'size|Operating cash': 'operatingCashFlowTtm', 'size|FCF TTM': 'fcfTtm', 'divs|Buyback yield': 'buybackYield',
    'profit|Gross margin': 'grossMargin', 'profit|Operating margin': 'operatingMargin', 'profit|Profit margin': 'profitMargin',
    'profit|Margin change': 'netMarginChg', 'profit|FCF margin': 'fcfMargin', 'growth|EPS TTM': 'dilutedEpsTtm',
    'value|Trailing P/E': 'trailingPe', 'value|Live P/E': 'peLive', 'value|P/S': 'priceToSales', 'value|P/B': 'priceToBook',
    'own|Short % float': 'shortPctFloat', 'own|Short % out': 'shortPctOutstanding', 'own|Short ratio': 'shortRatio',
    'report|Reported': 'lastEarningsDate',
    'lrun|Revenue /yr 3Y': 'revGrowth3y', 'lrun|Revenue /yr 5Y': 'revGrowth5y',
    'lrun|Net income /yr 3Y': 'niGrowth3y', 'lrun|Net income /yr 5Y': 'niGrowth5y',
  };
  // Where the filings' newest trailing year can be set beside the cell's own
  // figure. The others are defined differently from their cell and say so in
  // their note instead.
  const COMPARE = { revenueTtm: 1, grossProfitTtm: 1, netIncomeTtm: 1, operatingCashFlowTtm: 1, grossMargin: 1, operatingMargin: 1, profitMargin: 1 };
  const APART = 5;                 // per cent, the SEC data page's own line
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthOf = (d) => (/^\d{4}-\d{2}/.test(String(d)) ? MONTHS[Number(String(d).slice(5, 7)) - 1] + ' ' + String(d).slice(0, 4) : String(d || ''));

  const compact = (v) => {
    const a = Math.abs(v);
    return a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M'
      : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K' : a.toFixed(0);
  };
  // A missing value is a dash, never a zero.
  function fmt(v, kind) {
    // Empty is rejected BEFORE it is coerced: Number('') is 0.
    if (v == null || v === '' || !isFinite(Number(v))) return '—';
    const n = Number(v), neg = n < 0 ? '−' : '';
    if (kind === 'money') return neg + '$' + compact(n);
    if (kind === 'pct') return neg + Math.abs(n).toFixed(1) + '%';
    if (kind === 'signed') return (n > 0 ? '+' : neg) + Math.abs(n).toFixed(1) + '%';
    if (kind === 'eps') return neg + '$' + Math.abs(n).toFixed(2);
    if (kind === 'shares') return compact(n);
    if (kind === 'days') return n.toFixed(1);
    if (kind === 'ratio') return n.toFixed(1);
    return String(v);
  }

  // The chart: a line (or bars) drawn into a stretched box, with its figures
  // as HTML beside it. Text inside a stretched SVG would stretch with it.
  function chart(points, kind, bars) {
    const pts = (points || []).filter((p) => p && p.v != null && isFinite(Number(p.v)));
    if (pts.length < 2) return '';
    const vs = pts.map((p) => Number(p.v));
    let lo = Math.min(...vs), hi = Math.max(...vs);
    // Bars are measured from zero, so zero is always on the chart; a line
    // that crosses zero shows where.
    if (bars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi === lo) { hi += Math.abs(hi) * 0.05 || 1; lo -= Math.abs(lo) * 0.05 || 1; }
    const W = 300, H = 100, pad = 4;
    const y = (v) => pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
    const x = (i) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
    let shape;
    if (bars) {
      const bw = Math.max(2, (W / pts.length) * 0.62), y0 = y(0);
      shape = pts.map((p, i) => {
        const cx = (i + 0.5) * (W / pts.length), yy = y(Number(p.v));
        return '<rect x="' + (cx - bw / 2).toFixed(2) + '" y="' + Math.min(yy, y0).toFixed(2) + '" width="' + bw.toFixed(2) + '" height="' + Math.max(1, Math.abs(yy - y0)).toFixed(2) + '" class="dp-bar"/>';
      }).join('');
    } else {
      shape = '<path class="dp-line" vector-effect="non-scaling-stroke" d="' + pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(Number(p.v)).toFixed(2)).join(' ') + '"/>';
    }
    const zero = lo < 0 && hi > 0 ? '<line class="dp-zero" vector-effect="non-scaling-stroke" x1="0" x2="' + W + '" y1="' + y(0).toFixed(2) + '" y2="' + y(0).toFixed(2) + '"/>' : '';
    return '<div class="dp-chart"><div class="dp-y"><span>' + esc(fmt(hi, kind)) + '</span><span>' + esc(fmt(lo, kind)) + '</span></div>'
      + '<div class="dp-plot"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + zero + shape + '</svg>'
      + '<div class="dp-x"><span>' + esc(monthOf(pts[0].d)) + '</span><span>' + esc(pts.length + ' points') + '</span><span>' + esc(monthOf(pts[pts.length - 1].d)) + '</span></div></div></div>';
  }

  function body(j, row, sym) {
    const name = (row && (row.shortName || row.name)) || sym;
    const pts = (j.points || []).filter((p) => p && p.v != null);
    const last = pts.length ? pts[pts.length - 1] : null;
    let h = '<div class="dp-top"><div><h4>' + esc(name) + ' · ' + esc(j.title || '') + '</h4>'
      + '<div class="dp-sub">' + esc(j.basis || '') + ' · ' + esc(j.source || '') + '</div></div>'
      + (last ? '<div class="dp-last"><b>' + esc(fmt(last.v, j.kind)) + '</b><span>' + esc(monthOf(last.d)) + '</span></div>' : '') + '</div>';
    const rows = j.rows || [];
    if (!pts.length && !rows.length) {
      return h + '<div class="dp-empty">No history on file for this company.' + (j.src === 'short' ? '' : ' A fund, or a company that files abroad or only once a year, has none.') + '</div>' + foot(sym);
    }
    h += chart(j.points, j.kind, j.bars) || (pts.length === 1 ? '<div class="dp-empty">One period on file, so there is nothing to draw yet.</div>' : '');
    // The cell is the price provider's figure; say so where the filings' own
    // newest figure is somewhere else.
    if (COMPARE[j.field] && last && row && row[j.field] != null && isFinite(Number(row[j.field]))) {
      const a = Number(row[j.field]), b = Number(last.v);
      const far = j.kind === 'pct' ? Math.abs(a - b) > 2 : (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9)) * 100 > APART;
      if (far) h += '<div class="dp-diff">The cell is the price provider’s figure, ' + esc(fmt(a, j.kind)) + '. The filings’ newest trailing year is ' + esc(fmt(b, j.kind)) + ' (' + esc(monthOf(last.d)) + ').</div>';
    }
    if (rows.length) {
      const kinds = j.colKinds || [];
      h += '<table class="dp-t"><thead><tr>' + (j.cols || []).map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((v, i) => '<td>' + esc(i === 0 ? v : fmt(v, kinds[i])) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    }
    if (j.note) h += '<p class="dp-note">' + esc(j.note) + '</p>';
    return h + foot(sym, pts.length >= 2 || rows.length ? j.field : null);
  }
  // Two ways on: the stock's own page, and the same history as a card in
  // Visuals (only where there is something to draw).
  // On the stock's own page the first link would open the page it is on, so
  // there it is left out (`onPage`).
  let onPage = false;
  const foot = (sym, field) => '<div class="dp-foot">' + (onPage ? '<span></span>' : '<a href="/stock/' + encodeURIComponent(sym) + '" target="_blank" rel="noopener">Open ' + esc(sym) + ' →</a>')
    + (field ? '<a href="/promo?tpl=figure&amp;sym=' + encodeURIComponent(sym) + '&amp;field=' + encodeURIComponent(field) + '" target="_blank" rel="noopener">Open as a card →</a>' : '') + '</div>';

  const STYLE = '#drillPop{position:fixed;z-index:var(--z-tip);width:min(440px,calc(100vw - 24px));max-height:min(78vh,620px);overflow:auto;border-radius:16px;'
    + 'border:1px solid var(--hair-2);background:color-mix(in srgb,var(--glass) 97%,transparent);backdrop-filter:blur(24px);box-shadow:0 30px 80px -24px rgba(0,0,0,0.95);padding:14px 16px;}'
    + '#drillPop .dp-top{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;}'
    + '#drillPop h4{margin:0 0 2px;font-size:13px;font-weight:600;}'
    + '#drillPop .dp-sub{font-size:11px;color:var(--faint);}'
    + '#drillPop .dp-last{text-align:right;white-space:nowrap;}'
    + '#drillPop .dp-last b{display:block;font-family:var(--mono);font-size:15px;font-weight:500;}'
    + '#drillPop .dp-last span{font-size:10.5px;color:var(--faint);}'
    + '#drillPop .dp-chart{display:flex;gap:8px;margin:12px 0 4px;}'
    + '#drillPop .dp-y{display:flex;flex-direction:column;justify-content:space-between;height:110px;font-family:var(--mono);font-size:10px;color:var(--faint);text-align:right;min-width:44px;}'
    + '#drillPop .dp-plot{flex:1;min-width:0;}'
    + '#drillPop .dp-plot svg{display:block;width:100%;height:110px;overflow:visible;}'
    + '#drillPop .dp-line{fill:none;stroke:var(--accent);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;}'
    + '#drillPop .dp-bar{fill:var(--accent);opacity:0.75;}'
    + '#drillPop .dp-zero{stroke:var(--hair-2);stroke-width:1;stroke-dasharray:3 3;}'
    + '#drillPop .dp-x{display:flex;justify-content:space-between;margin-top:4px;font-family:var(--mono);font-size:10px;color:var(--faint);}'
    + '#drillPop .dp-diff{margin:8px 0 0;padding:7px 10px;border-radius:9px;border:1px solid rgba(251,191,36,0.3);color:var(--amber);font-size:11.5px;line-height:1.5;}'
    + '#drillPop .dp-t{width:100%;border-collapse:collapse;margin:10px 0 0;font-size:11.5px;}'
    + '#drillPop .dp-t th{text-align:right;padding:5px 0 5px 10px;font-size:9.5px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--faint);border-bottom:1px solid var(--hair);white-space:nowrap;}'
    + '#drillPop .dp-t td{text-align:right;padding:5px 0 5px 10px;font-family:var(--mono);font-variant-numeric:tabular-nums;border-bottom:1px solid color-mix(in srgb,var(--wash) 4%,transparent);white-space:nowrap;}'
    + '#drillPop .dp-t th:first-child,#drillPop .dp-t td:first-child{text-align:left;padding-left:0;font-family:var(--sans);color:var(--muted);}'
    + '#drillPop .dp-note{margin:10px 0 0;font-size:11px;line-height:1.55;color:var(--faint);}'
    + '#drillPop .dp-empty{font-size:12.5px;color:var(--muted);padding:12px 0 2px;line-height:1.5;}'
    + '#drillPop .dp-foot{margin-top:10px;padding-top:9px;border-top:1px solid color-mix(in srgb,var(--wash) 5.5%,transparent);font-size:11.5px;display:flex;justify-content:space-between;gap:12px;}'
    + '#drillPop .dp-foot a{color:var(--muted);text-decoration:none;}#drillPop .dp-foot a:hover{color:var(--text);text-decoration:underline;}'
    // A drillable row on the stock page looks like a drillable cell on the
    // screener, and only once the viewer is allowed (attach adds dp-on).
    + '.dp-on [data-drill] .rc-v{cursor:pointer;text-decoration:underline dotted color-mix(in srgb,var(--wash) 30%,transparent);text-underline-offset:3px;}'
    + '.dp-on [data-drill]:hover .rc-v{text-decoration-color:var(--accent);}';

  let cfg = null, pop = null, mark = null, openFor = null, seq = 0;

  // WHICH HEADER CELL STANDS OVER A BODY CELL. The header is two rows: the
  // first has the group banners and, at its start, cells that span both rows
  // (Symbol and the name). So a body row is those leading cells, then the
  // second header row in order -- and a body cell's index is NOT its header
  // cell's own index, which is counted within its row. The first version
  // took them as equal and opened the column two to the left; a browser
  // caught it before it shipped.
  function columns() {
    const head = document.querySelector('thead');
    const rows = head ? head.rows : [];
    if (!rows.length) return [];
    if (rows.length === 1) return [...rows[0].cells];
    // THE KEY ROW IS THE ONE WITH THE KEYS, not "the last row". The live page
    // builds a third header row at load, the column filters, which is always
    // there (hidden until switched on) and carries no key at all. The second
    // version read that row, found nothing, and marked no cell: the feature
    // shipped doing nothing, because the test header had two rows and the
    // live one has three. The owner found it.
    let keyRow = null, most = 0;
    for (const r of rows) {
      if (r === rows[0]) continue;
      let k = 0; for (const c of r.cells) if (c.dataset && c.dataset.key) k++;
      if (k > most) { most = k; keyRow = r; }
    }
    if (!keyRow) return [...rows[0].cells];
    const lead = [];
    for (const c of rows[0].cells) { if (c.rowSpan > 1) lead.push(c); else break; }
    return lead.concat([...keyRow.cells]);
  }
  function keyOf(td) {
    const th = td ? columns()[td.cellIndex] : null;
    const k = th && th.dataset ? th.dataset.key : null;
    return k && DRILL.has(k) ? k : null;
  }
  // One rule per drillable column, by position. Rebuilt whenever the header
  // may have changed; an empty rule set for a viewer who cannot drill.
  function restyle() {
    if (!mark) return;
    const cols = columns();
    if (!cols.length || !cfg || !cfg.allowed()) { mark.textContent = ''; return; }
    const sel = [];
    cols.forEach((th, i) => { if (th.dataset && DRILL.has(th.dataset.key)) sel.push('#' + cfg.tbody.id + ' > tr > td:nth-child(' + (i + 1) + ')'); });
    mark.textContent = sel.length ? sel.join(',') + '{cursor:pointer;text-decoration:underline dotted color-mix(in srgb,var(--wash) 30%,transparent);text-underline-offset:3px;}'
      + sel.map((s) => s + ':hover').join(',') + '{text-decoration-color:var(--accent);}' : '';
  }

  function close() { if (pop) pop.hidden = true; openFor = null; }
  // Below the cell if it fits, else above; where it fits neither, on the side
  // with more room and no taller than that room (the panel scrolls inside).
  // It used to clamp to the top of the window, which put a tall panel over
  // the very cell it was opened from.
  function place(cell) {
    const r = cell.getBoundingClientRect();
    pop.hidden = false;
    pop.style.maxHeight = '';
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const below = window.innerHeight - r.bottom - 14, above = r.top - 14;
    let top;
    if (h <= below) top = r.bottom + 6;
    else if (h <= above) top = r.top - h - 6;
    else if (below >= above) { pop.style.maxHeight = Math.max(160, below) + 'px'; top = r.bottom + 6; }
    else { const mh = Math.max(160, above); pop.style.maxHeight = mh + 'px'; top = r.top - 6 - Math.min(h, mh); }
    pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
  }
  async function open(cell, sym, key, row) {
    const mine = ++seq;
    openFor = sym + '|' + key;
    pop.innerHTML = '<div class="dp-top"><div><h4>' + esc((row && (row.shortName || row.name)) || sym) + '</h4><div class="dp-sub">Reading the history…</div></div></div>';
    place(cell);
    let html;
    try {
      const r = await fetch('/api/drill?symbol=' + encodeURIComponent(sym) + '&field=' + encodeURIComponent(key), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      html = r.ok ? body(j, row, sym) : '<div class="dp-empty">' + esc(j.error || 'Could not read the history.') + '</div>' + foot(sym);
    } catch (e) { html = '<div class="dp-empty">Could not read the history.</div>' + foot(sym); }
    // A slower answer for a cell since closed, or left for another, is dropped.
    if (mine !== seq || openFor !== sym + '|' + key) return;
    pop.innerHTML = html;
    if (cell.isConnected) place(cell);
  }

  // The panel, its styles and the ways it closes: once per page, whichever
  // entry point asks first.
  function ui() {
    if (pop) return;
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    mark = document.createElement('style'); document.head.appendChild(mark);
    pop = document.createElement('div'); pop.id = 'drillPop'; pop.hidden = true;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'History');
    document.body.appendChild(pop);
    document.addEventListener('click', (e) => { if (pop && !pop.hidden && !(e.target.closest && e.target.closest('#drillPop'))) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', close);
  }

  // THE STOCK PAGE: one company, rows marked data-drill="<key>" (rowcard's
  // buildSections writes the mark from FIELD_OF, only where the row has a
  // value). Same panel, same endpoint, same membership rule as the screener;
  // the rows look drillable only once allowed() says so.
  // c: { root, symbol, row, allowed() }. allowed may change after the call
  // (the page learns who is looking from /api/me): call refresh() then.
  function attach(c) {
    ui();
    onPage = true;
    const refresh = () => c.root.classList.toggle('dp-on', !!c.allowed());
    c.root.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-drill]');
      if (!el || !c.root.contains(el) || !c.allowed()) return;
      // A link inside the row (a filing, a group page) keeps its own click.
      if (e.target.closest('a')) return;
      const key = el.dataset.drill;
      if (!DRILL.has(key)) return;
      e.stopPropagation();
      if (openFor === c.symbol + '|' + key) return close();
      open(el.querySelector('.rc-v') || el, c.symbol, key, c.row);
    });
    // The panel is fixed and this page scrolls as a whole, so a scroll would
    // leave it hanging away from its row: it closes, as the screener's does
    // when its table scrolls.
    window.addEventListener('scroll', close, { passive: true });
    refresh();
    return { refresh };
  }

  // cfg: { tbody, rowOf(sym), allowed(), before() }
  function init(c) {
    cfg = c;
    ui();
    cfg.tbody.addEventListener('click', (e) => {
      const td = e.target.closest && e.target.closest('td');
      if (!td || td.parentNode.parentNode !== cfg.tbody || !cfg.allowed()) return;
      const key = keyOf(td);
      // A click on any other cell closes the panel: the page's own cell handlers
      // stop the click before the document hears it.
      if (!key) return close();
      const symCell = td.parentNode.querySelector('td.sym');
      const sym = symCell ? symCell.textContent.trim() : '';
      if (!sym) return;
      e.stopPropagation();
      if (cfg.before) cfg.before();
      if (openFor === sym + '|' + key) return close();
      open(td, sym, key, cfg.rowOf(sym));
    });
    const head = document.querySelector('thead');
    if (head && root.MutationObserver) new MutationObserver(restyle).observe(head, { childList: true, subtree: true });
    restyle();
  }

  const api = { KEYS, FIELD_OF, init, attach, close, restyle, fmt, chart, body, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DrillPop = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
