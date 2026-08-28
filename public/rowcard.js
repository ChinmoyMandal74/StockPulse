// Shared "every column for one row" hover card.
//
// Used by the screener (index.html) and the analysis page (analysis.html). The
// screener's card originally read the row's own <td>s, which guaranteed it
// matched the table — but the analysis tables only carry a handful of columns,
// so that trick does not port. Rather than write a second implementation and
// let the two drift, the card is built from the stock object here, once, and
// both pages use it. FIELD_SPEC below is the single description of what a row
// contains and how each value is rendered; it must stay in step with the
// screener's own cell renderers.

(function (global) {
  'use strict';

  const CUR = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', KRW:'₩', HKD:'HK$', CNY:'¥', INR:'₹',
                CAD:'C$', AUD:'A$', CHF:'CHF ', TWD:'NT$', BRL:'R$', SGD:'S$' };
  const curSym = (c) => (c ? (CUR[c] || c + ' ') : '$');
  const ok = (n) => n != null && isFinite(n);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function fmtMktCap(n, code) {
    if (!ok(n)) return null;
    const c = curSym(code);
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1e12) return sign + c + (a / 1e12).toFixed(1) + 'T';
    if (a >= 1e9) return sign + c + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return sign + c + (a / 1e6).toFixed(1) + 'M';
    return sign + c + a.toLocaleString();
  }

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function shortDate(iso) {
    const p = String(iso).split('-');
    return p.length === 3 ? `${MON[+p[1] - 1]} ${+p[2]}` : iso;
  }

  // --- value renderers, mirroring the screener's cell renderers ---------------
  const V = {
    // a change: signed, green up / red down
    pct: (n) => ok(n) ? { t: (n >= 0 ? '+' : '') + n.toFixed(1) + '%', c: n >= 0 ? 'pos' : 'neg' } : null,
    // a level: no leading +, red only when negative
    lvl: (n) => ok(n) ? { t: n.toFixed(1) + '%', c: n < 0 ? 'neg' : '' } : null,
    num: (n, d = 1) => ok(n) ? { t: n.toFixed(d), c: '' } : null,
    money: (n, code) => ok(n) ? { t: fmtMktCap(n, code), c: n < 0 ? 'neg' : '' } : null,
    signedMoney: (n, code) => ok(n) ? { t: fmtMktCap(n, code), c: n >= 0 ? 'pos' : 'neg' } : null,
    rating: (n) => ok(n) ? { t: String(n), c: n >= 8 ? 'pos' : n <= 4 ? 'neg' : 'warn', b: 1 } : null,
    rsi: (n) => ok(n) ? { t: n.toFixed(0), c: n >= 70 ? 'neg' : n <= 30 ? 'pos' : '' } : null,
    peg: (n) => ok(n) ? { t: n.toFixed(2), c: (n > 0 && n <= 1) ? 'pos' : n >= 2 ? 'neg' : '' } : null,
    short: (n) => ok(n) ? { t: n.toFixed(1) + '%', c: n >= 20 ? 'neg' : n >= 10 ? 'warn' : '' } : null,
    macd: (n) => ok(n) ? { t: n.toFixed(2), c: n >= 0 ? 'pos' : 'neg' } : null,
    text: (t) => (t ? { t: String(t), c: '' } : null),
  };

  // --- what a row contains, in table order -----------------------------------
  const FIELD_SPEC = [
    ['info',  'Portfolios',     (s) => V.text((s.portfolios || []).join(', '))],
    ['info',  'Price',          (s) => ok(s.price) ? { t: curSym(s.currency) + s.price.toFixed(1), c: '' } : null],
    ['info',  'Sector',         (s) => V.text(s.sector)],
    ['info',  'Market Cap',     (s) => V.money(s.marketCap, s.currency)],
    ['info',  'Next Earn',      (s) => s.nextEarningsDate
                                  ? { t: (s.nextEarningsEstimated ? '~' : '') + shortDate(s.nextEarningsDate), c: '' } : null],
    ['rank',  'Overall',        (s) => V.rating(s.overallRating)],
    ['rank',  'Mom.',           (s) => V.rating(s.momentumRating)],
    ['rank',  'Qual.',          (s) => V.rating(s.qualityRating)],
    ['rank',  'Rank',           (s, x) => x.rank ? { t: x.rank, c: 'na' } : null],
    ['short', 'Today',          (s) => V.pct(s.todayPct)],
    ['short', 'YDAY',           (s) => V.pct(s.yesterdayPct)],
    ['short', '1W',             (s) => V.pct(s.oneWeekPct)],
    ['short', '2W',             (s) => V.pct(s.twoWeekPct)],
    ['short', '1M',             (s) => V.pct(s.oneMonthPct)],
    ['long',  '3M',             (s) => V.pct(s.threeMonthPct)],
    ['long',  '6M',             (s) => V.pct(s.sixMonthPct)],
    ['long',  '1Y',             (s) => V.pct(s.oneYearPct)],
    ['fwd',   '+1M',            (s) => V.pct(s.fwd1M)],
    ['fwd',   '+3M',            (s) => V.pct(s.fwd3M)],
    ['fwd',   '+6M',            (s) => V.pct(s.fwd6M)],
    ['fwd',   'Since',          (s) => V.pct(s.fwdSince)],
    ['rel',   'RS vs S&P',      (s) => V.pct(s.relStrength)],
    ['rel',   '% from 52W lo',  (s) => V.lvl(s.pctFromLow)],
    ['rel',   '% from 52W hi',  (s) => V.pct(s.pctFromHigh)],
    ['rel',   'RSI',            (s) => V.rsi(s.rsi)],
    ['trend', 'vs 50D MA',      (s) => V.pct(s.vs50ma)],
    ['trend', 'vs 200D MA',     (s) => V.pct(s.vs200ma)],
    ['trend', 'MA cross',       (s) => {
      if (s.maBullish == null) return null;
      const fresh = s.maCrossDays != null && s.maCrossDays <= 20;
      const t = s.maBullish
        ? (fresh ? `Golden ▲ ${s.maCrossDays}d` : 'Bullish')
        : (fresh ? `Death ▼ ${s.maCrossDays}d` : 'Bearish');
      return { t, c: s.maBullish ? 'pos' : 'neg' };
    }],
    ['trend', 'MACD',           (s) => V.macd(s.macdHist)],
    ['vol',   'Vol trend',      (s) => V.pct(s.volTrend)],
    ['size',  'Revenue TTM',    (s) => V.money(s.revenueTtm, s.currency)],
    ['size',  'Gross profit',   (s) => V.money(s.grossProfitTtm, s.currency)],
    ['size',  'Gross margin',   (s) => V.lvl(s.grossMargin)],
    ['size',  'Net income',     (s) => V.money(s.netIncomeTtm, s.currency)],
    ['size',  'FCF TTM',        (s) => V.money(s.fcfTtm, s.currency)],
    ['size',  'FCF margin',     (s) => V.lvl(s.fcfMargin)],
    ['size',  'Net cash',       (s) => V.signedMoney(s.netCash, s.currency)],
    ['fund',  'Earn grth Q YoY',(s) => V.pct(s.earningsGrowthYoY)],
    ['fund',  'Rev grth Q YoY', (s) => V.pct(s.revenueGrowthYoY)],
    ['fund',  'Profit margin',  (s) => V.pct(s.profitMargin)],
    ['fund',  'ROE',            (s) => V.pct(s.roe)],
    ['fund',  'Fwd P/E',        (s) => V.num(s.forwardPe)],
    ['fund',  'PEG',            (s) => V.peg(s.peg)],
    ['fund',  'Short % float',  (s) => V.short(s.shortPctFloat)],
  ];

  const GROUP_ORDER = ['info', 'rank', 'short', 'long', 'fwd', 'rel', 'trend', 'vol', 'size', 'fund'];

  // opts: { colors, labels, rank, actions }
  function buildHTML(s, opts) {
    const o = opts || {};
    const colors = o.colors || {};
    const labels = o.labels || {};
    const ctx = { rank: o.rank || null };

    const byGroup = {};
    for (const [g, label, get] of FIELD_SPEC) {
      let v = null;
      try { v = get(s, ctx); } catch { v = null; }
      (byGroup[g] = byGroup[g] || []).push({
        k: label,
        t: v ? v.t : '—',
        c: v ? (v.c || '') : 'na',
        b: v && v.b,
      });
    }

    const sections = GROUP_ORDER
      .filter((g) => byGroup[g] && byGroup[g].some((r) => r.t !== '—'))
      .map((g) => {
        const c = colors[g] || 'var(--accent)';
        const rows = byGroup[g].map((r) =>
          `<div class="rc-row"><span class="rc-k">${esc(r.k)}</span>` +
          `<span class="rc-v ${r.c}"${r.b ? ' style="font-weight:600"' : ''}>${esc(r.t)}</span></div>`
        ).join('');
        return `<div class="rc-sec"><div class="rc-sec-h" style="color:${c}"><i></i>` +
               `${esc(labels[g] || g)}</div>${rows}</div>`;
      }).join('');

    const price = ok(s.price) ? curSym(s.currency) + s.price.toFixed(1) : '';
    let foot = 'Company data not cached yet';
    if (s.profileFetchedAt) {
      try { foot = 'Company data cached ' + new Date(s.profileFetchedAt).toLocaleString(); } catch { /* keep default */ }
    }

    const actions = (o.actions || []).map((a) =>
      `<button class="rc-act${a.danger ? ' danger' : ''}" data-action="${esc(a.id)}">${esc(a.label)}</button>`
    ).join('');

    return '<div class="rc-core">' +
      `<div class="rc-head"><span class="rc-sym">${esc(s.symbol)}</span>` +
      `<span class="rc-name">${esc(s.name || '')}</span>` +
      `<span class="rc-price">${esc(price)}</span></div>` +
      `<div class="rc-cols">${sections}</div>` +
      `<div class="rc-foot"><span>${esc(foot)}</span>` +
      (actions ? `<span class="rc-acts">${actions}</span>` : '') +
      '</div>' +
      '</div>';
  }

  // --- attach hover behaviour to a container ---------------------------------
  // opts: { root, selector, getStock, colors, labels, rankOf, onShow, actions, onAction }
  function attach(opts) {
    const el = document.getElementById('rowcard');
    if (!el) return;
    let timer = null;      // delay before showing
    let hideTimer = null;  // grace period before hiding
    let current = null;    // the stock the open card describes

    function show(target) {
      const s = opts.getStock(target);
      if (!s) return;
      if (opts.onShow) opts.onShow();
      current = s;
      el.innerHTML = buildHTML(s, {
        colors: opts.colors,
        labels: opts.labels,
        rank: opts.rankOf ? opts.rankOf(s) : null,
        actions: opts.actions ? opts.actions(s) : null,
      });
      el.style.display = 'block';
      const r = target.getBoundingClientRect();
      const pad = 10;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = r.right + 12;
      if (left + w > window.innerWidth - pad) left = Math.max(pad, r.left - w - 12);
      let top = r.top - 8;
      if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
      if (top < pad) top = pad;
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    }

    function hide() {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      el.style.display = 'none';
      current = null;
    }

    // The card sits 12px clear of the cell, so leaving the cell must not dismiss
    // it instantly — the pointer needs time to cross the gap and land on it.
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 220);
    }

    opts.root.addEventListener('mouseover', (e) => {
      const t = e.target.closest(opts.selector);
      if (!t || !opts.root.contains(t)) return;
      clearTimeout(timer);
      clearTimeout(hideTimer);
      // A short delay so the card does not fire while scanning down the column.
      timer = setTimeout(() => show(t), 140);
    });
    opts.root.addEventListener('mouseout', (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest(opts.selector)) return;
      if (to && el.contains(to)) return;   // heading into the card
      clearTimeout(timer);
      scheduleHide();
    });
    el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.rc-act');
      if (!b || !current || !opts.onAction) return;
      const s = current;
      hide();
      opts.onAction(b.dataset.action, s);
    });

    return { hide };
  }

  global.RowCard = { buildHTML, attach, fmtMktCap, FIELD_SPEC };
})(window);
