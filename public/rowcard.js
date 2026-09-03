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
  // The palette lives here because this file already owns GROUP_ORDER and
  // FIELD_SPEC. index.html keeps its own copy — it also colours the table's
  // group banners and the columns menu — so those two must stay in step.
  const GROUP_COLORS = {
    info: '#7c9cff', rank: '#a3e635', short: '#34d399', long: '#a78bfa', fwd: '#fb923c',
    rel: '#22d3ee', trend: '#fbbf24', vol: '#f472b6', size: '#94a3b8', fund: '#fb7185',
  };
  const GROUP_LABELS = {
    info: 'Info', rank: 'Rank', short: 'Short-term %', long: 'Long-term %', fwd: 'Forward',
    rel: 'Relative', trend: 'Trend', vol: 'Volume', size: 'Size', fund: 'Fundamentals',
  };

  // ---- price history -------------------------------------------------------
  // Cached per symbol for the life of the page: the same row gets hovered over
  // and over while scanning, and the archive only changes on a refresh.
  // Exactly the window computeStocks() calls ONE_YEAR. Anything else and the
  // chart's headline change disagrees with the 1Y row a few centimetres below
  // it, which reads as a bug even though both numbers are right.
  // 253 bars, not 252: the change is measured across the gaps between bars, so
  // matching pctChange(values, ONE_YEAR) — which compares bar 0 against bar 252
  // — needs one more bar than there are intervals. One short and the headline
  // disagreed with the 1Y row by 27 points on a name that gapped on earnings a
  // year ago.
  const HISTORY_DAYS = 253;
  const histCache = new Map();

  function loadHistory(symbol, days) {
    const n = days || HISTORY_DAYS;
    const key = symbol + '|' + n;
    if (histCache.has(key)) return histCache.get(key);
    const pr = fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${n}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    histCache.set(key, pr);
    return pr;
  }

  // A plain line with a soft fill, coloured by the period's direction, and a
  // dashed line at the opening price so the shape reads against a baseline
  // rather than floating.
  // Simple moving average. Returns an array the same length as the input, with
  // null for the first n-1 points where the window is not yet full — the caller
  // fetches extra history so those nulls fall outside the visible window.
  function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  // RSI at every point, oldest-first, with Wilder smoothing — the same method
  // rsi() uses in server.js, so the last visible value matches the screener's
  // RSI column. Null until the window is full; the caller over-fetches so those
  // nulls fall outside the visible range.
  //
  // Wilder is an exponential average, so it converges slowly: a value computed
  // from 15 bars differs materially from one computed over 250 and read at the
  // same point. The padding is not decoration.
  function rsiSeries(closes, period) {
    const n = period || 14;
    const out = new Array(closes.length).fill(null);
    if (closes.length < n + 1) return out;
    let gains = 0, losses = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    let avgGain = gains / n, avgLoss = losses / n;
    const val = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    out[n] = val();
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
      avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
      out[i] = val();
    }
    return out;
  }

  // Prices at even steps along whichever scale is in use, each rounded to a
  // readable precision. Even spacing beats round numbers here: on a log axis
  // round values land unevenly and the gridlines look accidental.
  function priceTicks(lo, hi, useLog, n) {
    const t = useLog ? Math.log : (v) => v;
    const inv = useLog ? Math.exp : (v) => v;
    const a = t(lo), b = t(hi);
    const out = [];
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0.5 : k / (n - 1);
      const v = inv(a + f * (b - a));
      // significant-figure rounding, so $1.69 and $932 both read sensibly
      const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1)) - 1);
      out.push({ v: Math.round(v / mag) * mag, f: 1 - f });   // f: 0 = top
    }
    return out;
  }

  // A sparkline: the line and nothing else. Deliberately not chartSVG with
  // flags — at 72x20 there is no room for a baseline, an end dot or padding,
  // and a function that draws "everything except" is harder to reason about
  // than two small ones.
  function sparkSVG(closes) {
    if (!closes || closes.length < 2) return '';
    const W = 120, H = 32, PAD = 3;
    const lo = Math.min.apply(null, closes);
    const hi = Math.max.apply(null, closes);
    const span = (hi - lo) || 1;
    let d = '';
    for (let i = 0; i < closes.length; i++) {
      const x = (i / (closes.length - 1)) * W;
      const y = PAD + (1 - (closes[i] - lo) / span) * (H - PAD * 2);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
           `<path d="${d}"/></svg>`;
  }

  // Returns { svg, log, ticks }. The caller labels the chart when the scale is
  // logarithmic, because an unmarked log axis misleads.
  //
  // opts.volumes draws bars beneath the price, each coloured by whether that
  // session closed up or down. The hover card passes none — at 104px tall
  // there is no room — so it stays a plain price line.
  function chartSVG(closes, opts) {
    const o = opts || {};
    const vols = o.volumes && o.volumes.length === closes.length ? o.volumes : null;
    const rsis = o.rsi && o.rsi.length === closes.length ? o.rsi : null;
    const W = 600;

    // Indicator panes stack below the price, in the order RSI then volume, each
    // with its own scale and a gap so none of them reads as part of another.
    // Turning one on grows the chart rather than squeezing the price, which is
    // the panel that matters.
    // The RSI band is the taller of the two: it carries threshold lines with
    // words above and below them, where volume only needs bars.
    const PANE_GAP = 13;
    const PANE_H = 44;
    const RSI_H = 58;
    const PRICE_H = (vols || rsis) ? 150 : 104;
    let cursor = PRICE_H;
    let rsiTop = 0, rsiBot = 0, volTop = 0, volBot = 0;
    if (rsis) { cursor += PANE_GAP; rsiTop = cursor; rsiBot = cursor + RSI_H; cursor = rsiBot; }
    if (vols) { cursor += PANE_GAP; volTop = cursor; volBot = cursor + PANE_H; cursor = volBot; }
    const H = (vols || rsis) ? cursor + 6 : 104;
    const PT = 12, PB = (vols || rsis) ? 8 : 12;
    // Overlays are folded into the range: a moving average sits above a falling
    // price and below a rising one, so scaling to the price alone clips it.
    const overlays = (o.overlays || []).filter((ov) => ov && ov.values);
    const scaleVals = closes.concat(
      overlays.reduce((acc, ov) => acc.concat(ov.values.filter((v) => v != null)), []));
    const lo = Math.min.apply(null, scaleVals);
    const hi = Math.max.apply(null, scaleVals);
    // Over a long span a linear axis is useless: MU ran from $1.69 to $932, so
    // nineteen of twenty years flatten onto the floor and only the last month
    // is visible. Above a 4x range the axis goes logarithmic, which is what
    // makes a 20-year price chart readable at all. A single year almost never
    // trips it, so the default view stays linear and literal.
    const useLog = lo > 0 && hi / lo > 4;
    const t = useLog ? Math.log : (v) => v;
    const tLo = t(lo), tSpan = (t(hi) - tLo) || 1;
    const x = (i) => (closes.length === 1 ? W / 2 : (i / (closes.length - 1)) * W);
    const y = (v) => PT + (1 - (t(v) - tLo) / tSpan) * (PRICE_H - PT - PB);

    let d = '';
    for (let i = 0; i < closes.length; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(closes[i]).toFixed(1);
    const baseY = y(closes[0]).toFixed(1);

    // Gridlines at the price ticks. Returned alongside so the caller can put
    // HTML labels at the same heights — SVG text would distort, since the
    // chart stretches with preserveAspectRatio="none".
    // Overlay paths. A null breaks the line rather than joining across the gap.
    let overlayPaths = '';
    for (const ov of overlays) {
      let od = '', pen = false;
      for (let i = 0; i < ov.values.length; i++) {
        const v = ov.values[i];
        if (v == null) { pen = false; continue; }
        od += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        pen = true;
      }
      if (od) overlayPaths += `<path class="ov ${ov.cls || ''}" d="${od}"/>`;
    }

    // RSI pane: 0-100 on its own scale, with the 30 and 70 lines that make the
    // reading mean anything, and a faint 50 midline.
    let rsiPane = '';
    if (rsis) {
      const ry = (v) => rsiBot - (Math.max(0, Math.min(100, v)) / 100) * (rsiBot - rsiTop);
      // A band of its own, so the indicator reads as a separate instrument
      // rather than as more of the price chart.
      rsiPane += `<rect class="pane-bg" x="0" y="${rsiTop}" width="${W}" height="${(rsiBot - rsiTop).toFixed(1)}"/>`;
      // Overbought and oversold carry the colours they mean; 50 is only an
      // anchor for the eye and stays neutral.
      for (const [lvl, cls] of [[70, 'hi'], [50, 'mid'], [30, 'lo']]) {
        rsiPane += `<line class="rsi-gl ${cls}" x1="0" y1="${ry(lvl).toFixed(1)}" ` +
                   `x2="${W}" y2="${ry(lvl).toFixed(1)}"/>`;
      }
      let rd = '', pen = false;
      for (let i = 0; i < rsis.length; i++) {
        const v = rsis[i];
        if (v == null) { pen = false; continue; }
        rd += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + ry(v).toFixed(1);
        pen = true;
      }
      if (rd) rsiPane += `<path class="rsi-ln" d="${rd}"/>`;
    }

    const wantTicks = o.ticks || 0;
    const ticks = wantTicks ? priceTicks(lo, hi, useLog, wantTicks) : [];
    let grid = '';
    for (const tk of ticks) {
      const gy = y(tk.v);
      if (gy < PT - 1 || gy > PRICE_H) continue;
      grid += `<line class="grid" x1="0" y1="${gy.toFixed(1)}" x2="${W}" y2="${gy.toFixed(1)}"/>`;
    }
    // Where each label sits as a fraction of the whole viewBox, not of the
    // price band, since the caller positions against the rendered svg.
    for (const tk of ticks) tk.top = y(tk.v) / H;

    // Fractions of the viewBox, so the caller can place HTML labels against
    // each pane without knowing the geometry.
    const panes = {
      // `at` maps a price to its height, through whichever scale is in use, so a
      // crosshair can sit on the line without knowing about the log switch.
      price: { top: 0, bottom: PRICE_H / H, at: (v) => y(v) / H, lo, hi },
      rsi: rsis ? { top: rsiTop / H, bottom: rsiBot / H,
                    at: (v) => (rsiBot - (v / 100) * (rsiBot - rsiTop)) / H } : null,
      volume: vols ? { top: volTop / H, bottom: volBot / H } : null,
    };

    // Volume bars. Scaled to the largest bar in view rather than an absolute,
    // so a quiet stretch still shows its own shape.
    let bars = '';
    if (vols) {
      const vMax = Math.max.apply(null, vols) || 1;
      const slot = W / vols.length;
      const bw = Math.max(0.6, Math.min(slot * 0.72, 7));
      const band = volBot - volTop;
      for (let i = 0; i < vols.length; i++) {
        const h = Math.max(0.5, (vols[i] / vMax) * band);
        const cx = vols.length === 1 ? W / 2 : (i / (vols.length - 1)) * (W - bw) + bw / 2;
        // Green when the session closed up on the one before it, matching the
        // convention every other charting tool uses.
        const up = i === 0 ? closes[i] <= closes[Math.min(1, closes.length - 1)] : closes[i] >= closes[i - 1];
        bars += `<rect class="vb ${up ? 'vu' : 'vd'}" x="${(cx - bw / 2).toFixed(2)}" ` +
                `y="${(volBot - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}"/>`;
      }
    }

    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      grid +
      `<line class="base" x1="0" y1="${baseY}" x2="${W}" y2="${baseY}"/>` +
      `<path class="ln" d="${d}"/>` +
      overlayPaths +
      rsiPane +
      `<circle class="dot" cx="${x(closes.length - 1).toFixed(1)}" cy="${y(closes[closes.length - 1]).toFixed(1)}" r="2.6"/>` +
      bars +
      '</svg>';
    return { svg, log: useLog, ticks, panes };
  }

  const fmtPrice = (n) => (n >= 1000 ? n.toFixed(0) : n.toFixed(2));
  const shortDay = (iso) => {
    const p = String(iso).split('-');
    return p.length === 3 ? MON[+p[1] - 1] + " '" + p[0].slice(2) : iso;
  };

  // Called after the card is already on screen. Bails if the pointer has moved
  // on to a different row in the meantime.
  function paintChart(el, symbol) {
    const box = el.querySelector('.rc-chart');
    if (!box) return;
    loadHistory(symbol).then((data) => {
      if (!box.isConnected || box.dataset.sym !== symbol) return;
      const closes = (data && data.closes) || [];
      if (closes.length < 2) {
        box.innerHTML = '<div class="msg">No price history stored yet</div>';
        return;
      }
      const first = closes[0], last = closes[closes.length - 1];
      const chg = ((last - first) / first) * 100;
      box.classList.add(chg >= 0 ? 'up' : 'down');
      const c = chartSVG(closes);
      box.innerHTML = c.svg +
        `<span class="cap chg">${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</span>` +
        `<span class="cap hi">${fmtPrice(Math.max.apply(null, closes))}${c.log ? ' · log' : ''}</span>` +
        `<span class="cap lo">${fmtPrice(Math.min.apply(null, closes))}</span>` +
        `<span class="cap from">${esc(shortDay(data.from))} → now</span>`;
    });
  }

  // Every field of a row, grouped and coloured. Shared by the hover card and
  // the stock page so FIELD_SPEC stays the single description of a row —
  // the same reason the card exists rather than a second copy of the table.

  // ---- score breakdown tooltip ---------------------------------------------
  // Lives here rather than in index.html because the stock page explains the
  // same three numbers and a second copy would drift — the reason this module
  // exists at all. Only the markup is shared; each page owns its own hover
  // wiring, since one hovers table cells and the other a chip and a card row.

  function factorRow(b) {
    if (b.sub == null) {
      return `<div class="tip-row off"><span class="lbl">${esc(b.label)} <em>${b.weight}%</em></span>` +
             '<span class="val">n/a</span></div>';
    }
    const pct = Math.round(b.sub * 100);
    return `<div class="tip-row"><span class="lbl">${esc(b.label)} <em>${b.weight}%</em></span>` +
      `<span class="tip-bar"><i style="width:${pct}%"></i></span><span class="val">${pct}</span></div>`;
  }

  // The two halves of Overall, as bars. Shared by the 'overall' and 'rank'
  // tooltips, which differ only in what they put above them.
  function overallRows(s) {
    const parts = [];
    if (s.momentumScore != null) parts.push(['Momentum', s.momentumScore, 65]);
    if (s.qualityScore != null) parts.push(['Quality', s.qualityScore, 35]);
    const rows = parts.map(([lbl, sc, w]) => {
      const pct = Math.round(sc);
      return `<div class="tip-row"><span class="lbl">${lbl} <em>${parts.length > 1 ? w + '%' : 'only'}</em></span>` +
        `<span class="tip-bar"><i style="width:${pct}%"></i></span><span class="val">${pct}</span></div>`;
    }).join('');
    const note = parts.length > 1
      ? 'Overall = 65% Momentum + 35% Quality.'
      : 'Overall = Momentum only (no company data).';
    return { rows, note, count: parts.length };
  }

  // kind: 'overall' | 'momentum' | 'quality' | 'rank'.
  // opts: { pulled, rank, rankTotal } — `pulled` is the "as of" line, and the
  // two rank fields are only read by the 'rank' kind.
  // Returns null when there is nothing to explain, so a caller can skip showing.
  function scoreTip(s, kind, opts) {
    const o = opts || {};
    const foot = o.pulled ? ` · pulled ${esc(o.pulled)}` : '';

    if (kind === 'rank') {
      if (!o.rank) return null;
      const { rows, note } = overallRows(s);
      // Rank is not a factor of its own — it is a position in a sorted list, so
      // what needs explaining is the number it sorts on.
      return `<div class="tip-head">Rank ${esc(o.rank)} of ${esc(o.rankTotal)} ` +
        `<span>· by Overall score</span></div>` + rows +
        `<div class="tip-foot">Ranked on Overall score${s.overallScore != null ? ` (${s.overallScore}/100)` : ''}, ` +
        `highest first, across every stock in the screener. ${note}${foot}</div>`;
    }

    if (kind === 'overall') {
      if (s.overallRating == null) return null;
      const { rows, note } = overallRows(s);
      return `<div class="tip-head">Overall ${s.overallRating}/10 ` +
        `<span>· score ${s.overallScore}/100</span></div>` + rows +
        `<div class="tip-foot">${note}${foot}</div>`;
    }

    const quality = kind === 'quality';
    const bd = quality ? s.qualityBreakdown : s.momentumBreakdown;
    if (!bd) return null;
    const rating = quality ? s.qualityRating : s.momentumRating;
    const score = quality ? s.qualityScore : s.momentumScore;
    const label = quality ? 'Quality' : 'Momentum';
    const totalW = bd.reduce((a, b) => a + b.weight, 0);
    const availW = bd.reduce((a, b) => a + (b.sub != null ? b.weight : 0), 0);
    const conf = totalW ? Math.round((availW / totalW) * 100) : 0;
    return `<div class="tip-head">${label} ${rating}/10 ` +
      `<span>· score ${score}/100 · ${conf}% of factors</span></div>` +
      bd.map(factorRow).join('') +
      `<div class="tip-foot">Confidence ${conf}%: share of factor-weight with data ` +
      `(rest excluded &amp; renormalized).${foot}</div>`;
  }

  // Clamp the card beside its anchor and inside the viewport — preferring the
  // right, falling back to the left rather than hanging off the edge.
  function placeTip(tip, el) {
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.right + 8;
    if (left + tw > window.innerWidth - 8) left = r.left - tw - 8;
    if (left < 8) left = 8;
    let top = r.top;
    if (top + th > window.innerHeight - 8) top = window.innerHeight - th - 8;
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  // opts: { colors, labels, rank }
  // Which rank-group rows carry a breakdown, when a caller asks for them.
  // Off by default: inside the hover card these rows are already in a tooltip,
  // and a tooltip on a tooltip helps nobody.
  const ROW_TIPS = { 'Overall': 'overall', 'Mom.': 'momentum', 'Qual.': 'quality', 'Rank': 'rank' };

  function buildSections(s, opts) {
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

    return GROUP_ORDER
      .filter((g) => byGroup[g] && byGroup[g].some((r) => r.t !== '—'))
      .map((g) => {
        const c = colors[g] || 'var(--accent)';
        const rows = byGroup[g].map((r) => {
          const tip = o.tips && g === 'rank' ? ROW_TIPS[r.k] : null;
          return `<div class="rc-row${tip ? ' has-tip' : ''}"${tip ? ` data-tip="${tip}"` : ''}>` +
            `<span class="rc-k">${esc(r.k)}</span>` +
            `<span class="rc-v ${r.c}"${r.b ? ' style="font-weight:600"' : ''}>${esc(r.t)}</span></div>`;
        }).join('');
        return `<div class="rc-sec"><div class="rc-sec-h" style="color:${c}"><i></i>` +
               `${esc(labels[g] || g)}</div>${rows}</div>`;
      }).join('');
  }

  // opts: { colors, labels, rank, actions }
  function buildHTML(s, opts) {
    const o = opts || {};
    const sections = buildSections(s, o);

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
      // Filled in asynchronously by paintChart(); the card must not wait on a
      // network round trip to appear, since it opens 140ms after the pointer
      // settles and any further delay reads as broken.
      `<div class="rc-chart" data-sym="${esc(s.symbol)}"><div class="msg">…</div></div>` +
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
      paintChart(el, s.symbol);
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

  global.RowCard = {
    buildHTML, attach, fmtMktCap, FIELD_SPEC,
    // used by the stock page
    buildSections, chartSVG, sparkSVG, loadHistory, fmtPrice, shortDay, HISTORY_DAYS, sma, rsiSeries,
    scoreTip, placeTip,
    GROUP_ORDER, GROUP_COLORS, GROUP_LABELS,
  };
})(window);
