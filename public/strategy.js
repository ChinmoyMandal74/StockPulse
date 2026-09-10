// Time-series momentum, as a strategy rather than an association.
//
// Everything else in this project measures whether a signal *correlates* with
// what happens next. This turns a signal into positions, holds them, and reports
// what the account would have done — which is a different question and can give
// a different answer. A rule right 53% of the time with volatility targeting can
// compound well on a correlation of 0.05, and a t-statistic cannot show a 40%
// drawdown in eight weeks.
//
// Loaded as a plain <script> by /strategy and required() by the offline runner,
// the arrangement every shared module here uses.
//
// THE RULE, following Moskowitz-Ooi-Pedersen:
//   signal   sign of the return over `lookback` sessions ending `skip` back
//   filter   optionally require price on the right side of its 200-day average
//   size     targetVol / realised vol, so each position carries equal risk
//   hold     rebalanced every `rebalance` sessions, not daily
//
// Two things about it are worth stating plainly, because the arithmetic hides
// them. Position sizing by 1/vol gives equal risk per position only if positions
// are roughly independent; across a correlated universe the portfolio's realised
// volatility lands well above the target. And the returns come from long trends,
// so anything that exits early truncates the part that pays.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Strategy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const DEFAULTS = {
    lookback: 252,     // 12 months
    skip: 21,          // less the last month, where reversal lives
    volWindow: 60,
    rebalance: 21,     // monthly
    targetVol: 10,     // % annualised, per position
    maxWeight: 3,      // leverage cap per position
    longOnly: false,
    sma: false,        // require price above/below its 200-day average
    smaWindow: 200,
  };

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Annualised realised volatility, %, over a full window — the same definition
  // indicators.js uses, which is momentum.js's.
  function volSeries(closes, window) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    const r = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
      const a = num(closes[i]), b = num(closes[i - 1]);
      if (a > 0 && b > 0) r[i] = Math.log(a / b);
    }
    let sum = 0, sumsq = 0, count = 0;
    for (let i = 1; i < n; i++) {
      if (r[i] != null) { sum += r[i]; sumsq += r[i] * r[i]; count++; }
      const drop = i - window;
      if (drop >= 1 && r[drop] != null) { sum -= r[drop]; sumsq -= r[drop] * r[drop]; count--; }
      if (count < Math.max(20, window)) continue;
      const varc = (sumsq - sum * sum / count) / (count - 1);
      if (varc > 0) out[i] = Math.sqrt(varc * 252) * 100;
    }
    return out;
  }

  function smaSeries(closes, window) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const c = num(closes[i]);
      if (c == null) return out;
      sum += c;
      if (i >= window) sum -= num(closes[i - window]);
      if (i >= window - 1) out[i] = sum / window;
    }
    return out;
  }

  // Below this, annualised, a "volatility" is a data artefact rather than a calm
  // stock — a run of carried-forward prints, or a series too short to have moved.
  // Sizing at target/vol divides by it, so an unfloored near-zero produces a
  // weight in the millions and the leverage cap silently becomes the position.
  // The real fix is upstream (do not carry a long hole forward at all); this is
  // the guard that makes the failure impossible rather than merely unlikely.
  const MIN_VOL = 1;

  // The weight this symbol would carry on each session, before any rebalance
  // schedule is applied. `null` where the rule cannot be evaluated yet.
  function targetWeights(closes, p) {
    const n = closes.length;
    const w = new Array(n).fill(null);
    const vol = volSeries(closes, p.volWindow);
    const sma = p.sma ? smaSeries(closes, p.smaWindow) : null;
    for (let i = 0; i < n; i++) {
      const end = i - p.skip, start = end - p.lookback;
      if (start < 0 || vol[i] == null || !(vol[i] >= MIN_VOL)) continue;
      const a = num(closes[end]), b = num(closes[start]);
      if (a == null || b == null || b === 0) continue;
      const ret = (a - b) / b;
      let sign = ret > 0 ? 1 : ret < 0 ? -1 : 0;
      if (p.longOnly && sign < 0) sign = 0;
      // The dual-confirmation filter: a long needs price above the average and a
      // short needs it below, so the two must agree before anything is held.
      if (sma) {
        if (sma[i] == null) continue;
        const above = num(closes[i]) > sma[i];
        if (sign > 0 && !above) sign = 0;
        if (sign < 0 && above) sign = 0;
      }
      w[i] = sign === 0 ? 0 : sign * Math.min(p.maxWeight, p.targetVol / vol[i]);
    }
    return w;
  }

  // Run the rule across a universe and return the portfolio's daily returns.
  //
  // `series` is [{ symbol, dates, closes }] — every symbol on the SAME date axis,
  // which the caller must guarantee. Aligning here would hide the assumption,
  // and a portfolio built from misaligned series is silently wrong rather than
  // loudly broken.
  function run(series, dates, params) {
    const p = { ...DEFAULTS, ...params };
    const n = dates.length;
    const weights = series.map((s) => targetWeights(s.closes, p));
    const rets = series.map((s) => s.closes.map((c, i) =>
      (i === 0 ? null : (num(c) != null && num(s.closes[i - 1]) > 0
        ? num(c) / num(s.closes[i - 1]) - 1 : null))));

    const held = new Array(series.length).fill(0);
    const out = { dates, ret: new Array(n).fill(0), turnover: new Array(n).fill(0),
      exposure: new Array(n).fill(0), names: new Array(n).fill(0) };

    for (let i = 0; i < n; i++) {
      // EARN THE DAY FIRST, on the position carried into it. Rebalancing before
      // this decided a weight from today's close and then earned today's own
      // move with it — a one-day lookahead, and the sizing was the worse half:
      // vol[i] contains the very return being earned, so a rule facing a gap
      // sized itself down for a move it could not have seen.
      //
      // Measured on a synthetic series with a 48% gap landing on a rebalance
      // day, the wrong order booked 5.98% and the right one books 39.98% — the
      // stale weight is the correct one, because that is the position actually
      // held into the gap. Note the direction: here the lookahead *understated*
      // the return. It will not always, and either way the rule was reading a
      // number it could not have had.
      let sum = 0, gross = 0, live = 0;
      for (let k = 0; k < series.length; k++) {
        if (!held[k]) continue;
        const r = rets[k][i];
        if (r == null) continue;
        sum += held[k] * r;
        gross += Math.abs(held[k]);
        live++;
      }
      // Then rebalance on today's close, which takes effect tomorrow.
      if (i % p.rebalance === 0) {
        for (let k = 0; k < series.length; k++) {
          const w = weights[k][i];
          const want = w == null ? 0 : w;
          out.turnover[i] += Math.abs(want - held[k]);
          held[k] = want;
        }
      }
      // Divided by the whole universe, not by the number of positions: capital
      // is committed to the universe, and a rule that is in cash for most names
      // should show that as a smaller return rather than as the same return.
      out.ret[i] = series.length ? sum / series.length : 0;
      out.turnover[i] = series.length ? out.turnover[i] / series.length : 0;
      out.exposure[i] = series.length ? gross / series.length : 0;
      out.names[i] = live;
    }
    return out;
  }

  // Equal-weight buy and hold over the same universe — the comparison that
  // decides whether any of this was worth doing.
  function buyHold(series, dates) {
    const n = dates.length;
    const out = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      let sum = 0, live = 0;
      for (const s of series) {
        const a = num(s.closes[i]), b = num(s.closes[i - 1]);
        if (a == null || b == null || b <= 0) continue;
        sum += a / b - 1; live++;
      }
      out[i] = live ? sum / live : 0;
    }
    return out;
  }

  // Compound a daily series into calendar months, summing turnover within each
  // and averaging exposure. Exposure is carried because a long-only rule spends
  // much of its life in cash, and cash has a yield — ignoring it understates the
  // strategy by whatever T-bills paid, which over 2023-2026 was not a rounding
  // error.
  function toMonthly(dates, daily, turnover, exposure) {
    const months = [], ret = [], turn = [], exp = [];
    let key = null, acc = 1, t = 0, e = 0, days = 0;
    const flush = () => { months.push(key); ret.push(acc - 1); turn.push(t); exp.push(days ? e / days : 0); };
    for (let i = 0; i < dates.length; i++) {
      const m = dates[i].slice(0, 7);
      if (m !== key) {
        if (key != null) flush();
        key = m; acc = 1; t = 0; e = 0; days = 0;
      }
      acc *= 1 + (daily[i] || 0);
      t += turnover ? (turnover[i] || 0) : 0;
      e += exposure ? (exposure[i] || 0) : 0;
      days++;
    }
    if (key != null) flush();
    return { months, ret, turn, exp };
  }

  // ---- reading the result ---------------------------------------------------
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1));
  };

  // Statistics from a monthly return series. `costBps` is charged against
  // turnover, which is why turnover is carried alongside the returns rather than
  // baked in: at a monthly rebalance across a hundred names, cost is frequently
  // the difference between a positive and a negative result, and it should be a
  // dial rather than an assumption.
  //
  // `cashYield` does TWO things, and both are required for it to be honest.
  // It is credited on the uninvested share of the book (only when `exp` is
  // given, so a fully-invested benchmark gets nothing), AND it is subtracted as
  // the risk-free rate in the Sharpe ratio. Doing only the first turned a rule
  // sitting 87% in cash into a Sharpe of 2.79 — the T-bill's Sharpe, borrowed.
  // Sharpe is excess of cash by definition, and if the caller is willing to say
  // what cash pays then that is the rate the excess is measured against.
  function summarise(ret, turn, costBps, scale, opts) {
    const k = scale == null ? 1 : scale;
    const o = opts || {};
    const yieldPm = (o.cashYield || 0) / 100 / 12;    // annual %, charged monthly
    const net = ret.map((r, i) => {
      const cost = turn && turn[i] ? turn[i] * k * (costBps || 0) / 10000 : 0;
      // Whatever is not invested sits in cash and earns. Capped at 1 because a
      // levered position has no idle capital to lend, and floored at 0 because
      // this does not model paying to borrow.
      const idle = o.exp ? Math.max(0, 1 - Math.min(1, (o.exp[i] || 0) * k)) : 0;
      return r * k - cost + idle * yieldPm;
    });
    let eq = 1, peak = 1, maxDD = 0;
    const curve = [];
    for (const r of net) {
      eq *= 1 + r;
      curve.push(eq);
      if (eq > peak) peak = eq;
      const dd = eq / peak - 1;
      if (dd < maxDD) maxDD = dd;
    }
    const years = net.length / 12;
    const m = mean(net), s = sd(net);
    // The same rate that was credited is the rate Sharpe is measured against, so
    // parking in cash cannot manufacture a ratio.
    const excess = m - yieldPm;
    return {
      curve,
      months: net.length,
      total: eq - 1,
      cagr: years > 0 && eq > 0 ? Math.pow(eq, 1 / years) - 1 : null,
      vol: s * Math.sqrt(12),
      // The epsilon is not decoration: a book sitting entirely in cash has a
      // constant monthly return, whose standard deviation is not exactly zero in
      // floating point but ~1e-19. Dividing an equally tiny excess by it printed
      // a Sharpe of 3.45 for a T-bill. No volatility means no ratio.
      sharpe: s > 1e-12 ? (excess * 12) / (s * Math.sqrt(12)) : null,
      maxDD,
      hit: net.length ? net.filter((r) => r > 0).length / net.length : null,
      turnover: turn ? mean(turn) * k : null,
      best: net.length ? Math.max(...net) : null,
      worst: net.length ? Math.min(...net) : null,
    };
  }

  function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 3) return null;
    const x = a.slice(0, n), y = b.slice(0, n);
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const p = x[i] - mx, q = y[i] - my; sxy += p * q; sxx += p * p; syy += q * q; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  }

  return { DEFAULTS, MIN_VOL, run, buyHold, toMonthly, summarise, correlation,
    targetWeights, volSeries, smaSeries, mean, sd };
});
