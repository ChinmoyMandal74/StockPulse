// What to do with one stock, from one day's row. Rule-based, not scored.
//
// Loaded as a plain <script> by the screener and require()d by server.js — the
// arrangement every shared module here uses, so the server (house profile) and
// the browser (a user's personal profile, later) cannot drift apart.
//
// THE SHAPE OF THE MODEL, and why it is not the points system that was built
// and reverted before it:
//
//   - First match wins. Each Action rule list is walked top to bottom and the
//     first rule that fires IS the answer, so every verdict has exactly one
//     reason and the Flag column can name it honestly — "Breakdown", not
//     "composite -6".
//   - The Sell / Avoid / Hold rules sit ABOVE every Buy rule, structurally.
//     Avoiding large losses is the owner's stated goal, and here it is not a
//     tuning outcome, it is the order of the list. evaluate() enforces that
//     order; config can move thresholds but never reorder the rules.
//   - Blanks are "condition not met", never zero. A missing value satisfies no
//     comparison in either direction. That cuts both ways, which is why the
//     no-trend-data rule below exists.
//
// WHAT THE RULES MAY READ: raw fundamentals, raw returns, and four standard
// indicators the table already shows as plain columns (% vs 50D and 200D
// averages, RSI, % from the 52-week high). The owner's own composite scores —
// Momentum, Quality, Overall — are EXCLUDED BY DEFAULT because they are custom
// built and he said so; `use_quality` / `use_momentum` switch the original
// gates back on. MA Cross, MACD and PEG are not read at all.
//
// Two holes in the source brief are closed here, both toggleable:
//   - A stock whose 200-day average does not exist yet (young listing) used to
//     fall through every trend rule — none could fire on a blank — and reach
//     "Buy with Risk" with zero trend information. Blank trend now Holds.
//   - Above the 200-day, a clean entry used to reach "Buy with Risk" even with
//     Weak fundamentals (collapsing earnings AND revenue). Weak now Holds.
//
// It is a rules engine, not a measured predictor. Nothing here has been shown
// to forecast a return — the research log records what has been tested and
// what came back flat. The backtest that matters for this model is per-Action
// downside (10th-percentile forward return), which action-backtest.js reports
// for the technical skeleton over the full bar archive.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ActionRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const ACTIONS = ['Sell Immediately', 'Avoid', 'Hold', 'Buy with Risk', 'Buy', 'Strong Buy'];
  const TYPES = ['ETF', 'Established', 'Early'];

  // ---- the Balanced defaults ------------------------------------------------
  // Every threshold a profile may change. The nesting is the grouping the
  // config editor shows and the validator walks, so a key that is not in here
  // is an unknown key by definition.
  const DEFAULTS = {
    profile: 'Balanced',
    version: 1,

    // The owner's composites, off by default at his instruction ("custom
    // built"). Turning one on restores the brief's original gates.
    use_quality: false,
    use_momentum: false,
    use_vol_trend: true,          // Vol Trend % is custom too, but it only ever BLOCKS buys

    company_type: {
      mc_big: 100e9,              // market cap for +2 establishment points
      mc_mid: 20e9,               // +1
      mc_override: 200e9,         // this big is Established no matter what
      pm_min: 5,                  // profit margin % that upgrades "profitable" to +2
      fm_min: 5,                  // FCF margin % required beside positive FCF for +1
      pe_max: 40,                 // 0 < forward P/E <= this earns +1
      quality_min: 7,             // only read when use_quality is on
      roe_min: 10,                // raw substitute for the Quality point when it is off
      score_cutoff: 5,            // Established at or above this (max score 7)
      manual_overrides: {},       // { SYM: 'Established' | 'Early' | 'ETF' } — pins a ticker
    },

    entry: {
      vs50_low: -3, vs50_high: 8, // clean entry: a base or shallow pullback vs the 50D
      rsi_low: 45, rsi_high: 65,  // moving, not stretched
      near_high: -10,             // % from 52W high counted as "near the high"
      buy_max_drawdown: -20,      // a plain Buy must not be deeper in a hole than this
      strong_buy_vs200: 10,       // Strong Buy needs a real uptrend, not a wobble above the line
      momentum_min: 7,            // only read when use_momentum is on
      uptrend_vs50: -8,           // uptrend = above 200D and vs50 above this
    },

    stop_loss: {                  // the breakdown = Sell Immediately triggers
      established_vs200: -10,     // this far below the 200D...
      confirm_1m: -8,             // ...and still falling over 1 month
      confirm_3m: -15,            // ...or over 3 months
      early_vs200: -5,            // Early gets a shorter leash
      early_confirm_1m: -5,
    },

    chase: {                      // "Extended — wait for a pullback" caps at Hold
      max_1m: 25, max_vs50: 15, max_rsi: 72,
    },

    earnings: { enabled: true, blackout_days: 7 },   // no new entries into a print

    history: { min_days: 200 },   // below this the 200D average is not a real 200D average

    exit: {
      distribution_vol: 10,               // Vol Trend % above this with a down month = distribution
      distribution_avoid_drawdown: -30,   // distribution this deep in a hole = Avoid (Established)
      early_avoid_short_float: 25,        // Early with short interest above this = Avoid
    },

    early: {
      allow_buy: true,            // Conservative turns this off (Early caps at Buy with Risk)
      allow_strong_buy: false,    // Early is never Strong Buy unless deliberately enabled
      buy_requires: 'strong',     // 'ok' is the Aggressive stance
    },

    trend_gate: { never_buy_below_200d: true },   // false = mean-reversion mode, BwR only

    fund_established: {
      strong: { eg: 15, rg: 10, fcf_margin: 10, pm: 15, quality: 8 },
      ok: { eg: 0, rg: 0, quality: 6 },
      weak: { quality: 4 },       // weak = (EG<0 AND RG<0) OR pm<0; plus Quality<=this when on
    },

    fund_early: {                 // P/E, PEG and earnings growth deliberately never read
      strong: { rg: 30, gross_margin: 50 },       // plus FCF TTM > 0
      ok: { rg: 15, gross_margin: 25, fcf_margin: -20, short_float: 15 },
      weak: { rg: 5, fcf_margin: -20, short_float: 25 },
    },

    whipsaw: {
      neutral_band_pct: 0,        // |vs200| inside the band counts as neither above nor below
      // persistence_days is deliberately NOT here yet: it needs day-over-day
      // state the engine does not have. Listed as future work, not a dead knob.
    },

    fixes: {                      // the two brief holes, closed but toggleable
      blank_trend_holds: true,
      weak_blocks_buy_with_risk: true,
    },

    output: { emit_flags: true },
  };

  // ---- presets: diffs over Balanced, exactly as the brief specifies ---------
  const PRESETS = {
    Balanced: {},
    Conservative: {
      stop_loss: { established_vs200: -5, early_vs200: -3 },
      chase: { max_1m: 15 },
      earnings: { blackout_days: 10 },
      early: { allow_buy: false },              // Early caps at Buy with Risk
    },
    Aggressive: {
      stop_loss: { established_vs200: -15, early_vs200: -8 },
      chase: { max_1m: 35 },
      earnings: { blackout_days: 3 },
      early: { buy_requires: 'ok' },            // Early may reach Buy with OK fundamentals
    },
  };

  // ---- config plumbing ------------------------------------------------------
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  // Free-form leaves the schema walk must not descend into.
  const FREE_FORM = new Set(['company_type.manual_overrides']);

  function merge(base, over, path, unknown) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!isObj(over)) return out;
    for (const k of Object.keys(over)) {
      const p = path ? path + '.' + k : k;
      if (!(k in base)) { if (unknown) unknown.push(p); continue; }
      if (isObj(base[k]) && !FREE_FORM.has(p)) out[k] = merge(base[k], over[k], p, unknown);
      else out[k] = over[k];
    }
    return out;
  }

  // A usable config from a preset name plus a user diff. Unknown keys are
  // REPORTED, never silently dropped into the void — the brief is explicit.
  function resolve(diff, presetName) {
    const unknown = [];
    // Always a fresh clone — handing DEFAULTS itself out and then stamping the
    // profile name on it would quietly rewrite the defaults for the process.
    let cfg = merge(DEFAULTS, {}, '', null);
    const preset = PRESETS[presetName || (diff && diff.profile)] || null;
    if (preset) cfg = merge(cfg, preset, '', null);
    if (diff) cfg = merge(cfg, diff, '', unknown);
    cfg.profile = presetName || (diff && diff.profile) || 'Balanced';
    return { cfg, unknown };
  }

  // Reject, do not repair. An inverted band here produces rules that silently
  // never fire, so a profile that fails these checks is refused with the
  // reasons, which is what a save dialog can actually show.
  function validate(cfg) {
    const errors = [];
    const bad = (m) => errors.push(m);
    const num = (v) => typeof v === 'number' && isFinite(v);
    const walk = (base, node, path) => {
      for (const k of Object.keys(base)) {
        const p = path ? path + '.' + k : k;
        if (FREE_FORM.has(p)) continue;
        if (isObj(base[k])) { walk(base[k], node[k] || {}, p); continue; }
        if (typeof base[k] === 'number' && !num(node[k])) bad(`${p} must be a number`);
        if (typeof base[k] === 'boolean' && typeof node[k] !== 'boolean') bad(`${p} must be true or false`);
      }
    };
    walk(DEFAULTS, cfg, '');
    if (errors.length) return { ok: false, errors };

    if (cfg.entry.rsi_low >= cfg.entry.rsi_high) bad('entry: rsi_low must be below rsi_high');
    if (cfg.entry.vs50_low >= cfg.entry.vs50_high) bad('entry: vs50_low must be below vs50_high');
    if (cfg.stop_loss.early_vs200 < cfg.stop_loss.established_vs200) {
      bad('stop_loss: the Early breakdown must not be looser than the Established one');
    }
    if (cfg.earnings.blackout_days < 0) bad('earnings: blackout_days must be at least 0');
    if (cfg.history.min_days < 0) bad('history: min_days must be at least 0');
    if (cfg.whipsaw.neutral_band_pct < 0) bad('whipsaw: neutral_band_pct must be at least 0');
    if (cfg.company_type.mc_mid > cfg.company_type.mc_big) bad('company_type: mc_mid must not exceed mc_big');
    if (cfg.entry.near_high > 0) bad('entry: near_high is a % below the high and must be 0 or negative');
    if (cfg.entry.buy_max_drawdown > 0) bad('entry: buy_max_drawdown must be 0 or negative');
    if (!['strong', 'ok'].includes(cfg.early.buy_requires)) bad("early: buy_requires must be 'strong' or 'ok'");
    for (const [sym, t] of Object.entries(cfg.company_type.manual_overrides || {})) {
      if (!TYPES.includes(t)) bad(`company_type.manual_overrides.${sym}: type must be one of ${TYPES.join(', ')}`);
    }
    return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
  }

  // Only what differs from the Balanced defaults, so a stored profile does not
  // pin seventy values to the day it was saved.
  function diff(cfg, base) {
    const b = base || DEFAULTS;
    const out = {};
    for (const k of Object.keys(b)) {
      if (FREE_FORM.has(k)) { if (isObj(cfg[k]) && Object.keys(cfg[k]).length) out[k] = cfg[k]; continue; }
      if (isObj(b[k])) {
        const d = diff(cfg[k] || {}, b[k]);
        if (Object.keys(d).length) out[k] = d;
      } else if (cfg && cfg[k] !== undefined && cfg[k] !== b[k]) out[k] = cfg[k];
    }
    return out;
  }

  // ---- reading a row --------------------------------------------------------
  // null for anything unusable; every comparison below goes through these, so a
  // blank can never satisfy a condition.
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };
  const gt = (v, x) => v != null && v > x;
  const lt = (v, x) => v != null && v < x;
  const gte = (v, x) => v != null && v >= x;
  const lte = (v, x) => v != null && v <= x;
  const between = (v, lo, hi) => v != null && v >= lo && v <= hi;

  function daysToEarnings(s) {
    if (!s || !s.nextEarningsDate || !s.latestDate) return null;
    const a = Date.parse(s.nextEarningsDate + 'T00:00:00Z');
    const b = Date.parse(s.latestDate + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    const d = Math.round((a - b) / 86400000);
    return d < 0 ? null : d;        // a past date is stale feed data, not "reported today"
  }

  // ---- Step 1: company type -------------------------------------------------
  function classify(s, cfg) {
    const c = cfg.company_type;
    const pinned = c.manual_overrides && c.manual_overrides[s.symbol];
    if (pinned) return { type: pinned, estScore: null, pinned: true };

    const q = num(s.qualityRating), pe = num(s.forwardPe);
    const names = Array.isArray(s.portfolios) ? s.portfolios.join(' ') : String(s.portfolios || '');
    if (/etf/i.test(names) || (q == null && pe == null)) return { type: 'ETF', estScore: null, pinned: false };

    const mc = num(s.marketCap), ni = num(s.netIncomeTtm), pm = num(s.profitMargin);
    const fcf = num(s.fcfTtm), fm = num(s.fcfMargin), roe = num(s.roe);
    let score = 0;
    if (gte(mc, c.mc_big)) score += 2; else if (gte(mc, c.mc_mid)) score += 1;
    if (gt(ni, 0)) score += gte(pm, c.pm_min) ? 2 : 1;
    if (gt(fcf, 0) && gte(fm, c.fm_min)) score += 1;
    if (gt(pe, 0) && lte(pe, c.pe_max)) score += 1;
    // The seventh point: Quality when the composite is switched on, plain ROE
    // when it is not — a raw stand-in for "consistently good business".
    if (cfg.use_quality ? gte(q, c.quality_min) : gte(roe, c.roe_min)) score += 1;

    const type = gte(mc, c.mc_override) || score >= c.score_cutoff ? 'Established' : 'Early';
    return { type, estScore: score, pinned: false };
  }

  // ---- Step 2: the named conditions ------------------------------------------
  function definitions(s, cfg, type) {
    const v200 = num(s.vs200ma), v50 = num(s.vs50ma), rsi = num(s.rsi);
    const m1 = num(s.oneMonthPct), m3 = num(s.threeMonthPct);
    const fh = num(s.pctFromHigh), vol = num(s.volTrend), sf = num(s.shortPctFloat);
    const hist = num(s.historyDays), dte = daysToEarnings(s);
    const band = cfg.whipsaw.neutral_band_pct;

    // Inside the neutral band the stock is neither above nor below its 200D,
    // so neither side's rules fire — the anti-whipsaw the brief asked for.
    const above200 = gt(v200, band);
    const below200 = lt(v200, -band);

    const d = {
      v200, v50, rsi, m1, m3, fh, dte,
      above200, below200,
      blankTrend: v200 == null,
      uptrend: above200 && gt(v50, cfg.entry.uptrend_vs50),
      downtrend: below200 && lt(v50, 0),
      breakdown: type === 'Early'
        ? lt(v200, cfg.stop_loss.early_vs200) && lt(m1, cfg.stop_loss.early_confirm_1m)
        : lt(v200, cfg.stop_loss.established_vs200)
          && (lt(m1, cfg.stop_loss.confirm_1m) || lt(m3, cfg.stop_loss.confirm_3m)),
      extended: gt(m1, cfg.chase.max_1m) || gt(v50, cfg.chase.max_vs50) || gt(rsi, cfg.chase.max_rsi),
      cleanEntry: between(v50, cfg.entry.vs50_low, cfg.entry.vs50_high)
        && between(rsi, cfg.entry.rsi_low, cfg.entry.rsi_high),
      nearHigh: gt(fh, cfg.entry.near_high),
      strongUptrend: gt(v200, cfg.entry.strong_buy_vs200),
      shallowEnough: gt(fh, cfg.entry.buy_max_drawdown),
      distribution: cfg.use_vol_trend && gt(vol, cfg.exit.distribution_vol) && lt(m1, 0),
      deepHole: lt(fh, cfg.exit.distribution_avoid_drawdown),
      heavyShort: gt(sf, cfg.exit.early_avoid_short_float),
      earningsSoon: cfg.earnings.enabled && dte != null && dte <= cfg.earnings.blackout_days,
      thinHistory: lt(hist, cfg.history.min_days),
      momentumOk: !cfg.use_momentum || gte(num(s.momentumRating), cfg.entry.momentum_min),
    };
    return d;
  }

  // ---- Step 2b: the fundamentals bucket --------------------------------------
  // 'strong' | 'ok' | 'weak' | 'none'. 'none' means the data did not make any
  // case — which is not the same thing as making a bad one.
  function fundamentals(s, cfg, type) {
    if (type === 'ETF') return 'none';
    const eg = num(s.earningsGrowthYoY), rg = num(s.revenueGrowthYoY);
    const fm = num(s.fcfMargin), pm = num(s.profitMargin), gm = num(s.grossMargin);
    const fcf = num(s.fcfTtm), ni = num(s.netIncomeTtm), sf = num(s.shortPctFloat);
    const q = num(s.qualityRating);

    if (type === 'Early') {
      const f = cfg.fund_early;
      if (lt(rg, f.weak.rg) || lt(fm, f.weak.fcf_margin) || gt(sf, f.weak.short_float)) return 'weak';
      if (gt(rg, f.strong.rg) && gt(gm, f.strong.gross_margin) && gt(fcf, 0)) return 'strong';
      if (gt(rg, f.ok.rg) && gt(gm, f.ok.gross_margin)
        && gte(fm, f.ok.fcf_margin) && lt(sf, f.ok.short_float)) return 'ok';
      return 'none';
    }

    const f = cfg.fund_established;
    const weakByQuality = cfg.use_quality && lte(q, f.weak.quality);
    if (weakByQuality || (lt(eg, 0) && lt(rg, 0)) || lt(pm, 0)) return 'weak';
    if (cfg.use_quality) {
      if (gte(q, f.strong.quality) && gt(eg, f.strong.eg) && gt(rg, f.strong.rg)
        && gt(fm, 0)) return 'strong';
      if (gte(q, f.ok.quality) && gt(eg, f.ok.eg) && gt(rg, f.ok.rg)) return 'ok';
    } else {
      // The raw substitutes: margins stand where Quality stood.
      if (gt(eg, f.strong.eg) && gt(rg, f.strong.rg) && gt(fm, f.strong.fcf_margin)
        && gt(pm, f.strong.pm)) return 'strong';
      if (gt(eg, f.ok.eg) && gt(rg, f.ok.rg) && gt(ni, 0)) return 'ok';
    }
    return 'none';
  }

  // ---- Step 3: the rule lists, first match wins -------------------------------
  // Each returns [action, flag]. The Sell/Avoid/Hold blocks sit above the Buy
  // blocks in the source, and evaluate() runs them in source order — that
  // ordering is the loss-avoidance guarantee and is deliberately not a config.
  function establishedRules(d, fund, cfg) {
    if (d.breakdown) return ['Sell Immediately', 'Breakdown'];
    if (d.downtrend) return ['Avoid', 'Downtrend'];
    if (d.below200 && fund === 'weak') return ['Avoid', 'Weak fundamentals below 200D'];
    if (d.distribution && d.deepHole) return ['Avoid', 'Distribution deep in drawdown'];

    const gate = cfg.trend_gate.never_buy_below_200d;
    if (gate && d.below200) return ['Hold', 'Below 200D'];
    if (cfg.fixes.blank_trend_holds && d.blankTrend) return ['Hold', 'No trend data'];
    if (d.thinHistory) return ['Hold', 'Thin history'];
    if (d.earningsSoon) return ['Hold', 'Earnings soon'];
    if (d.extended) return ['Hold', 'Extended — wait for a pullback'];

    if (d.strongUptrend && d.cleanEntry && d.nearHigh && fund === 'strong' && d.momentumOk) {
      return ['Strong Buy', 'Strong Buy: uptrend, clean entry, near high, strong fundamentals'];
    }
    if (!d.below200 && d.cleanEntry && (fund === 'ok' || fund === 'strong') && d.shallowEnough) {
      return ['Buy', 'Buy: clean entry, fundamentals OK'];
    }
    if (d.cleanEntry && !(cfg.fixes.weak_blocks_buy_with_risk && fund === 'weak')) {
      // In mean-reversion mode (gate off) a below-200D clean entry still needs
      // fundamentals on its side; the brief allows Buy with Risk, no higher.
      if (!d.below200 || fund === 'ok' || fund === 'strong') {
        return ['Buy with Risk', d.below200
          ? 'Buy with Risk: below 200D, mean-reversion mode'
          : 'Buy with Risk: fundamentals not OK'];
      }
      return ['Hold', 'Below 200D without fundamentals'];
    }
    if (d.cleanEntry && fund === 'weak') return ['Hold', 'Weak fundamentals'];
    return ['Hold', 'No clean entry'];
  }

  function earlyRules(d, fund, cfg) {
    if (d.breakdown) return ['Sell Immediately', 'Breakdown (early)'];
    if (d.below200 && fund === 'weak') return ['Sell Immediately', 'Weak fundamentals below 200D'];
    if (d.below200) return ['Avoid', 'Below 200D'];
    if (d.distribution) return ['Avoid', 'Distribution'];
    if (d.heavyShort) return ['Avoid', 'Heavy short interest'];

    if (cfg.fixes.blank_trend_holds && d.blankTrend) return ['Hold', 'No trend data'];
    if (d.thinHistory) return ['Hold', 'Thin history'];
    if (d.earningsSoon) return ['Hold', 'Earnings soon'];
    if (d.extended) return ['Hold', 'Extended — wait for a pullback'];
    if (fund === 'weak') return ['Hold', 'Weak fundamentals'];

    const need = cfg.early.buy_requires === 'ok' ? (fund === 'ok' || fund === 'strong') : fund === 'strong';
    if (cfg.early.allow_buy && d.strongUptrend && d.cleanEntry && need
      && d.shallowEnough && d.momentumOk) {
      if (cfg.early.allow_strong_buy && d.nearHigh && fund === 'strong') {
        return ['Strong Buy', 'Strong Buy (early): enabled by profile'];
      }
      return ['Buy', 'Buy (early): strong growth in an uptrend'];
    }
    if (d.cleanEntry && (fund === 'ok' || fund === 'strong')) {
      return ['Buy with Risk', 'Buy with Risk (early)'];
    }
    return ['Hold', 'No clean entry'];
  }

  function etfRules(d, cfg) {
    if (d.breakdown) return ['Sell Immediately', 'Breakdown'];
    if (d.downtrend) return ['Avoid', 'Downtrend'];
    if (d.below200) return ['Hold', 'Below 200D'];
    if (cfg.fixes.blank_trend_holds && d.blankTrend) return ['Hold', 'No trend data'];
    if (d.thinHistory) return ['Hold', 'Thin history'];
    if (d.extended) return ['Hold', 'Extended — wait for a pullback'];
    if (d.strongUptrend && d.cleanEntry && d.nearHigh && d.momentumOk) {
      return ['Strong Buy', 'Strong Buy: uptrend, clean entry, near high'];
    }
    if (d.cleanEntry) return ['Buy', 'Buy: clean entry'];
    return ['Hold', 'No clean entry'];
  }

  // ---- the whole answer for one row ------------------------------------------
  function evaluate(stock, cfg) {
    const s = stock || {};
    const { type, estScore, pinned } = classify(s, cfg);
    const d = definitions(s, cfg, type);
    const fund = fundamentals(s, cfg, type);
    const [action, flag] = type === 'ETF' ? etfRules(d, cfg)
      : type === 'Early' ? earlyRules(d, fund, cfg)
        : establishedRules(d, fund, cfg);
    return { type, action, flag, fund, estScore, pinned, defs: d };
  }

  // One resolved config for a whole pass — what both the server and a browser
  // re-score actually do.
  function apply(stocks, diffOrCfg, presetName) {
    const cfg = diffOrCfg && diffOrCfg.__resolved ? diffOrCfg : resolve(diffOrCfg, presetName).cfg;
    return (stocks || []).map((s) => (s && !s.error ? evaluate(s, cfg) : null));
  }

  return {
    ACTIONS, TYPES, DEFAULTS, PRESETS,
    resolve, validate, diff, merge,
    classify, definitions, fundamentals, evaluate, apply, daysToEarnings,
  };
});
