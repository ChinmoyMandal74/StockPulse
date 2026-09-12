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

  // ---- presets: diffs over Balanced -----------------------------------------
  // Conservative/Balanced/Aggressive are the brief's originals; Trend Rider,
  // Max Risk and Dip Buyer are the owner's additions (2026-09-12). Every one
  // is a fixed named diff — there is deliberately NO custom profile, so a
  // verdict is always explainable by one name plus the ladder panel. The
  // picker shows five (Conservative stays for the offline tools); the vetoes'
  // position in the lists is structural and no preset can reorder them.
  const PRESETS = {
    Balanced: {},
    Conservative: {
      stop_loss: { established_vs200: -5, early_vs200: -3 },
      chase: { max_1m: 15 },
      earnings: { blackout_days: 10 },
      early: { allow_buy: false },              // Early caps at Buy with Risk
    },
    // Buys strength sooner and holds it longer — entry-side aggression ONLY.
    // The stops, the drawdown limits and the blackout all stay Balanced:
    // let winners run, still cut losers fast.
    'Trend Rider': {
      chase: { max_1m: 40, max_vs50: 20, max_rsi: 78 },
      early: { allow_strong_buy: true },
    },
    Aggressive: {
      stop_loss: { established_vs200: -15, early_vs200: -8 },
      chase: { max_1m: 35 },
      earnings: { blackout_days: 3 },
      early: { buy_requires: 'ok' },            // Early may reach Buy with OK fundamentals
    },
    // The far end of the trend ladder: Aggressive with everything turned
    // further. Still never buys below the 200D — that is Dip Buyer's job.
    'Max Risk': {
      stop_loss: { established_vs200: -20, confirm_1m: -12, confirm_3m: -25,
        early_vs200: -10, early_confirm_1m: -8 },
      chase: { max_1m: 45, max_vs50: 22, max_rsi: 80 },
      entry: { buy_max_drawdown: -30 },
      earnings: { blackout_days: 2 },
      early: { allow_strong_buy: true, buy_requires: 'ok' },
    },
    // The one orthogonal profile: flips the trend gate, so a clean entry
    // below the 200D with OK fundamentals earns Buy with Risk instead of
    // Hold. The stops stay Balanced — Breakdown still sells, so the knife-
    // catch has a floor. The research log tested buy-the-lower-side three
    // ways on this universe and it came back flat-to-wrong; this profile
    // exists to show what the model says in that mode, not to endorse it.
    'Dip Buyer': {
      trend_gate: { never_buy_below_200d: false },
      entry: { buy_max_drawdown: -35 },
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
    // Each establishment point named, so the panel can show which were earned.
    // Same arithmetic as before, just held in a list instead of an accumulator.
    const parts = [
      { label: 'Size', earned: gte(mc, c.mc_big) ? 2 : gte(mc, c.mc_mid) ? 1 : 0, max: 2 },
      { label: 'Profitability', earned: gt(ni, 0) ? (gte(pm, c.pm_min) ? 2 : 1) : 0, max: 2 },
      { label: 'Free cash flow', earned: gt(fcf, 0) && gte(fm, c.fm_min) ? 1 : 0, max: 1 },
      { label: 'Priced on earnings', earned: gt(pe, 0) && lte(pe, c.pe_max) ? 1 : 0, max: 1 },
      // The seventh point: Quality when the composite is switched on, plain ROE
      // when it is not — a raw stand-in for "consistently good business".
      { label: cfg.use_quality ? 'Quality' : 'ROE',
        earned: (cfg.use_quality ? gte(q, c.quality_min) : gte(roe, c.roe_min)) ? 1 : 0, max: 1 },
    ];
    const score = parts.reduce((t, x) => t + x.earned, 0);
    const type = gte(mc, c.mc_override) || score >= c.score_cutoff ? 'Established' : 'Early';
    return { type, estScore: score, pinned: false, parts };
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
      vol, sf, hist,
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
        // Two different roads lead here and the flag must name the right one:
        // fundamentals that made no case, or good fundamentals refused a full
        // Buy because the stock is too deep below its high.
        return ['Buy with Risk', d.below200
          ? 'Buy with Risk: below 200D, mean-reversion mode'
          : (fund === 'ok' || fund === 'strong')
            ? 'Buy with Risk: deep below the high'
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

  // ---- the intermediate states, one word per family --------------------------
  // The table shows these beside the Action so the derivation reads left to
  // right: Trend says whether you may, Entry whether now, Fundamentals how much
  // conviction, Guards say wait. Each family's overlapping booleans collapse to
  // ONE value — the trend ladder is priority-ordered exactly like the rules, so
  // the word shown is always the most severe condition that holds.
  const FUND_LABELS = { strong: 'Strong', ok: 'OK', weak: 'Weak', none: '—' };

  function states(d, fund) {
    const trend = d.blankTrend ? 'No data'
      : d.breakdown ? 'Breakdown'
        : d.downtrend ? 'Downtrend'
          : d.below200 ? 'Below 200D'
            : d.strongUptrend ? 'Strong uptrend'
              : d.above200 ? 'Above 200D'
                : 'Near 200D';           // inside the neutral band, or exactly on the line
    const entry = d.extended ? 'Extended'
      : d.cleanEntry ? (d.nearHigh ? 'Clean, near high' : 'Clean') : 'None';
    const guards = [];
    if (d.thinHistory) guards.push('Thin history');
    if (d.earningsSoon) guards.push('Earnings ' + d.dte + 'd');
    return { trend, entry, fund: FUND_LABELS[fund] || '—', guards: guards.join(' · ') };
  }

  // The trend word for one date, from raw readings — definitions() and
  // states() on a minimal row, so a replayed history (the stock page's trend
  // ribbon) walks the exact ladder the Trend column does. r carries
  // { v200, v50, m1, m3 } in percent; type decides which breakdown
  // thresholds apply (Early's shorter leash), and everything else stays
  // blank, which the null discipline treats as "condition not met".
  function trendAt(r, type, cfg) {
    const d = definitions({ vs200ma: r.v200, vs50ma: r.v50,
      oneMonthPct: r.m1, threeMonthPct: r.m3 }, cfg, type);
    return states(d, 'none').trend;
  }

  // Severity ladders for sorting the state columns — alphabetical order would
  // file Breakdown between Above and Clean, which helps nobody.
  const TREND_ORDER = ['No data', 'Breakdown', 'Downtrend', 'Below 200D', 'Near 200D', 'Above 200D', 'Strong uptrend'];
  const ENTRY_ORDER = ['Extended', 'None', 'Clean', 'Clean, near high'];
  const FUND_ORDER = ['Weak', '—', 'OK', 'Strong'];

  // ---- the whole answer for one row ------------------------------------------
  function evaluate(stock, cfg) {
    const s = stock || {};
    const { type, estScore, pinned, parts } = classify(s, cfg);
    const d = definitions(s, cfg, type);
    const fund = fundamentals(s, cfg, type);
    const [action, flag] = type === 'ETF' ? etfRules(d, cfg)
      : type === 'Early' ? earlyRules(d, fund, cfg)
        : establishedRules(d, fund, cfg);
    return { type, action, flag, fund, estScore, pinned, typeParts: parts || null,
      defs: d, states: states(d, fund) };
  }

  // ---- Step 4: the ladder, as data --------------------------------------------
  // explain() is what the per-stock panel draws: the SAME rule lists evaluate()
  // walks, but as rungs — each rung one rule, each condition carrying the
  // stock's value and the zone that passes, so the UI can draw a gauge instead
  // of restating prose. It also carries one ladder per state column (trend /
  // entry / fundamentals / guards), in the same priority order states() uses.
  // Built from the same defs and fundamentals bucket, and the test suite
  // sweeps random rows asserting that the first rung whose conditions all hold
  // IS the rule evaluate() fired, and the lit state IS the word in the column
  // (`mismatch` / `familyMismatch` mark any divergence) — so neither
  // description can drift from the engine without a test failing.
  //
  // Gauge shape: { value, unit, domain: [lo, hi], band: [lo, hi] } — the dot
  // sits at value, the band is the zone that PASSES. A null value has no dot.
  const DOMAINS = {
    v200: [-40, 40], v50: [-30, 30], rsi: [0, 100], m1: [-40, 40], m3: [-60, 60],
    fh: [-60, 0], vol: [-40, 40], sf: [0, 40], hist: [0, 400], dte: [0, 30],
    eg: [-60, 60], rg: [-40, 60], pm: [-30, 40], fm: [-40, 40], gm: [0, 90], q: [0, 10],
  };
  const clampTo = (x, dom) => Math.max(dom[0], Math.min(dom[1], x));
  function gauge(key, value, band, unit) {
    const dom = DOMAINS[key];
    return { value, unit: unit == null ? '%' : unit, domain: dom,
      band: [clampTo(band[0], dom), clampTo(band[1], dom)] };
  }
  const n2 = (x) => (x > 0 ? '+' + x : String(x));
  // Condition builders. `met` goes through the same blank-refusing comparison
  // helpers the rules use, so a gauge can never disagree with its rule.
  const cLT = (label, key, v, x, u) => ({ label, met: lt(v, x), gauge: gauge(key, v, [DOMAINS[key][0], x], u) });
  const cLTE = (label, key, v, x, u) => ({ label, met: lte(v, x), gauge: gauge(key, v, [DOMAINS[key][0], x], u) });
  const cGT = (label, key, v, x, u) => ({ label, met: gt(v, x), gauge: gauge(key, v, [x, DOMAINS[key][1]], u) });
  const cGTE = (label, key, v, x, u) => ({ label, met: gte(v, x), gauge: gauge(key, v, [x, DOMAINS[key][1]], u) });
  const cBT = (label, key, v, lo, hi, u) => ({ label, met: between(v, lo, hi), gauge: gauge(key, v, [lo, hi], u) });
  const cB = (label, met) => ({ label, met: !!met });
  const anyOf = (label, conds) => ({ label, any: conds, met: conds.some((c) => c.met) });

  const R = (section, action, flag, conds, fallback) => ({ section, action, flag, conds, fallback: !!fallback });

  // The builders both ladders draw from — the Action rungs and the per-column
  // state ladders must describe one condition with one label, so each lives
  // here exactly once.
  function condKit(d, cfg) {
    const sl = cfg.stop_loss, en = cfg.entry, ex = cfg.exit, ch = cfg.chase;
    const band = cfg.whipsaw.neutral_band_pct;
    const below200 = () => cLT(`vs 200D below ${n2(-band)}%`, 'v200', d.v200, -band);
    return {
      clean: () => [
        cBT(`vs 50D between ${n2(en.vs50_low)}% and ${n2(en.vs50_high)}%`, 'v50', d.v50, en.vs50_low, en.vs50_high),
        cBT(`RSI between ${en.rsi_low} and ${en.rsi_high}`, 'rsi', d.rsi, en.rsi_low, en.rsi_high, ''),
      ],
      below200,
      above200: () => cGT(`vs 200D above ${n2(band)}%`, 'v200', d.v200, band),
      // The "may buy" side of the line: met mirrors !d.below200 exactly, blanks
      // and the neutral band included, which is what the rule actually tests.
      above200ish: () => ({ label: `vs 200D at or above ${n2(-band)}%`, met: !d.below200,
        gauge: gauge('v200', d.v200, [-band, DOMAINS.v200[1]]) }),
      breakdown: (type) => (type === 'Early'
        ? [cLT(`vs 200D below ${n2(sl.early_vs200)}%`, 'v200', d.v200, sl.early_vs200),
          cLT(`1M below ${n2(sl.early_confirm_1m)}%`, 'm1', d.m1, sl.early_confirm_1m)]
        : [cLT(`vs 200D below ${n2(sl.established_vs200)}%`, 'v200', d.v200, sl.established_vs200),
          anyOf('Still falling', [
            cLT(`1M below ${n2(sl.confirm_1m)}%`, 'm1', d.m1, sl.confirm_1m),
            cLT(`3M below ${n2(sl.confirm_3m)}%`, 'm3', d.m3, sl.confirm_3m),
          ])]),
      downtrend: () => [below200(), cLT('vs 50D below 0%', 'v50', d.v50, 0)],
      distribution: () => [
        { label: `Vol Trend above ${n2(ex.distribution_vol)}%` + (cfg.use_vol_trend ? '' : ' (check off)'),
          met: cfg.use_vol_trend && gt(d.vol, ex.distribution_vol),
          gauge: gauge('vol', d.vol, [ex.distribution_vol, DOMAINS.vol[1]]) },
        cLT('1M return below 0%', 'm1', d.m1, 0),
      ],
      extended: () => [anyOf('Any chase signal', [
        cGT(`1M above ${n2(ch.max_1m)}%`, 'm1', d.m1, ch.max_1m),
        cGT(`vs 50D above ${n2(ch.max_vs50)}%`, 'v50', d.v50, ch.max_vs50),
        cGT(`RSI above ${ch.max_rsi}`, 'rsi', d.rsi, ch.max_rsi, ''),
      ])],
      thinCond: () => cLT(`History under ${cfg.history.min_days} sessions`, 'hist', d.hist, cfg.history.min_days, 'd'),
      earnCond: () => ({ label: `Earnings within ${cfg.earnings.blackout_days} days`, met: d.earningsSoon,
        gauge: gauge('dte', d.dte, [0, cfg.earnings.blackout_days], 'd') }),
      blankCond: () => cB('No 200D average yet', d.blankTrend),
      mom: () => (cfg.use_momentum ? [cB(`Momentum rating at least ${en.momentum_min}`, d.momentumOk)] : []),
      nearHigh: () => cGT(`Within ${-en.near_high}% of the 52W high`, 'fh', d.fh, en.near_high),
      strongUp: () => cGT(`vs 200D above ${n2(en.strong_buy_vs200)}%`, 'v200', d.v200, en.strong_buy_vs200),
      shallow: () => cGT(`Drawdown shallower than ${-en.buy_max_drawdown}%`, 'fh', d.fh, en.buy_max_drawdown),
    };
  }

  function buildRungs(type, d, fund, cfg) {
    const en = cfg.entry, ex = cfg.exit;
    const fundOK = fund === 'ok' || fund === 'strong';
    const K = condKit(d, cfg);
    const { clean, below200, above200ish, distribution, extended, mom, nearHigh, strongUp, shallow } = K;
    const thin = () => R('cap', 'Hold', 'Thin history', [K.thinCond()]);
    const earnings = () => R('cap', 'Hold', 'Earnings soon', [K.earnCond()]);
    const noTrend = () => R('cap', 'Hold', 'No trend data', [K.blankCond()]);

    const r = [];
    if (type === 'Established') {
      r.push(R('veto', 'Sell Immediately', 'Breakdown', K.breakdown(type)));
      r.push(R('veto', 'Avoid', 'Downtrend', K.downtrend()));
      r.push(R('veto', 'Avoid', 'Weak fundamentals below 200D',
        [below200(), cB('Fundamentals Weak', fund === 'weak')]));
      r.push(R('veto', 'Avoid', 'Distribution deep in drawdown', distribution().concat([
        cLT(`More than ${-ex.distribution_avoid_drawdown}% below the 52W high`, 'fh', d.fh, ex.distribution_avoid_drawdown),
      ])));
      if (cfg.trend_gate.never_buy_below_200d) r.push(R('cap', 'Hold', 'Below 200D', [below200()]));
      if (cfg.fixes.blank_trend_holds) r.push(noTrend());
      r.push(thin());
      if (cfg.earnings.enabled) r.push(earnings());
      r.push(R('cap', 'Hold', 'Extended — wait for a pullback', extended()));

      r.push(R('setup', 'Strong Buy', 'Strong Buy: uptrend, clean entry, near high, strong fundamentals',
        [strongUp()].concat(clean(), [nearHigh(), cB('Fundamentals Strong', fund === 'strong')], mom())));
      r.push(R('setup', 'Buy', 'Buy: clean entry, fundamentals OK',
        [above200ish()].concat(clean(), [cB('Fundamentals OK or Strong', fundOK), shallow()])));
      if (!cfg.trend_gate.never_buy_below_200d) {
        r.push(R('setup', 'Buy with Risk', 'Buy with Risk: below 200D, mean-reversion mode',
          [below200()].concat(clean(), [cB('Fundamentals OK or Strong', fundOK)])));
      }
      r.push(R('setup', 'Buy with Risk', 'Buy with Risk: deep below the high',
        [above200ish()].concat(clean(), [cB('Fundamentals OK or Strong', fundOK),
          { label: `More than ${-en.buy_max_drawdown}% below the 52W high`, met: !d.shallowEnough,
            gauge: gauge('fh', d.fh, [DOMAINS.fh[0], en.buy_max_drawdown]) }])));
      const notOK = fund === 'none' || (fund === 'weak' && !cfg.fixes.weak_blocks_buy_with_risk);
      r.push(R('setup', 'Buy with Risk', 'Buy with Risk: fundamentals not OK',
        [above200ish()].concat(clean(), [cB('Fundamentals not OK', notOK)])));
      if (!cfg.trend_gate.never_buy_below_200d) {
        r.push(R('setup', 'Hold', 'Below 200D without fundamentals',
          [below200()].concat(clean(), [cB('Fundamentals not OK', notOK)])));
      }
      if (cfg.fixes.weak_blocks_buy_with_risk) {
        r.push(R('setup', 'Hold', 'Weak fundamentals',
          clean().concat([cB('Fundamentals Weak', fund === 'weak')])));
      }
      r.push(R('setup', 'Hold', 'No clean entry', clean(), true));
    } else if (type === 'Early') {
      r.push(R('veto', 'Sell Immediately', 'Breakdown (early)', K.breakdown(type)));
      r.push(R('veto', 'Sell Immediately', 'Weak fundamentals below 200D',
        [below200(), cB('Fundamentals Weak', fund === 'weak')]));
      r.push(R('veto', 'Avoid', 'Below 200D', [below200()]));
      r.push(R('veto', 'Avoid', 'Distribution', distribution()));
      r.push(R('veto', 'Avoid', 'Heavy short interest',
        [cGT(`Short interest above ${ex.early_avoid_short_float}% of float`, 'sf', d.sf, ex.early_avoid_short_float)]));
      if (cfg.fixes.blank_trend_holds) r.push(noTrend());
      r.push(thin());
      if (cfg.earnings.enabled) r.push(earnings());
      r.push(R('cap', 'Hold', 'Extended — wait for a pullback', extended()));
      r.push(R('cap', 'Hold', 'Weak fundamentals', [cB('Fundamentals Weak', fund === 'weak')]));

      const needStrong = cfg.early.buy_requires !== 'ok';
      const needCond = () => cB(needStrong ? 'Fundamentals Strong' : 'Fundamentals OK or Strong',
        needStrong ? fund === 'strong' : fundOK);
      if (cfg.early.allow_buy && cfg.early.allow_strong_buy) {
        r.push(R('setup', 'Strong Buy', 'Strong Buy (early): enabled by profile',
          [strongUp()].concat(clean(), [nearHigh(), cB('Fundamentals Strong', fund === 'strong'), shallow()], mom())));
      }
      if (cfg.early.allow_buy) {
        r.push(R('setup', 'Buy', 'Buy (early): strong growth in an uptrend',
          [strongUp()].concat(clean(), [needCond(), shallow()], mom())));
      }
      r.push(R('setup', 'Buy with Risk', 'Buy with Risk (early)',
        clean().concat([cB('Fundamentals OK or Strong', fundOK)])));
      r.push(R('setup', 'Hold', 'No clean entry', clean(), true));
    } else {
      r.push(R('veto', 'Sell Immediately', 'Breakdown', K.breakdown(type)));
      r.push(R('veto', 'Avoid', 'Downtrend', K.downtrend()));
      r.push(R('cap', 'Hold', 'Below 200D', [below200()]));
      if (cfg.fixes.blank_trend_holds) r.push(noTrend());
      r.push(thin());
      r.push(R('cap', 'Hold', 'Extended — wait for a pullback', extended()));
      r.push(R('setup', 'Strong Buy', 'Strong Buy: uptrend, clean entry, near high',
        [strongUp()].concat(clean(), [nearHigh()], mom())));
      r.push(R('setup', 'Buy', 'Buy: clean entry', clean()));
      r.push(R('setup', 'Hold', 'No clean entry', clean(), true));
    }
    return r;
  }

  // ---- Step 4b: the state columns, as ladders ----------------------------------
  // One ladder per column, in the exact priority order states() collapses each
  // family by, so the lit rung is always the word the column shows. Guards is
  // the exception and says so: its checks are independent — both can be
  // active at once — so every rung is evaluated, none dimmed.
  function firstMatch(rungs) {
    let fi = -1;
    for (let i = 0; i < rungs.length; i++) {
      const g = rungs[i];
      g.met = g.fallback || g.conds.every((c) => c.met);
      if (fi < 0 && g.met) fi = i;
    }
    rungs.forEach((g, i) => { g.fired = i === fi; g.checked = i <= fi; });
    return rungs;
  }

  function buildFamilies(type, d, fund, cfg, s) {
    const K = condKit(d, cfg);
    const F = (label, conds, fallback) => ({ label, conds, fallback: !!fallback });

    const trend = firstMatch([
      F('No data', [K.blankCond()]),
      F('Breakdown', K.breakdown(type)),
      F('Downtrend', K.downtrend()),
      F('Below 200D', [K.below200()]),
      F('Strong uptrend', [K.strongUp()]),
      F('Above 200D', [K.above200()]),
      F('Near 200D', [], true),
    ]);

    const entry = firstMatch([
      F('Extended', K.extended()),
      F('Clean, near high', K.clean().concat([K.nearHigh()])),
      F('Clean', K.clean()),
      F('None', K.clean(), true),
    ]);

    // The fundamentals bucket, walked in the order fundamentals() tests:
    // Weak disqualifies first, then Strong, then OK, then no case made.
    let fundRungs = [];
    if (type === 'Early') {
      const f = cfg.fund_early;
      const rg = num(s.revenueGrowthYoY), fm = num(s.fcfMargin), gm = num(s.grossMargin);
      fundRungs = firstMatch([
        F('Weak', [anyOf('Any of', [
          cLT(`Revenue growth below ${n2(f.weak.rg)}%`, 'rg', rg, f.weak.rg),
          cLT(`FCF margin below ${n2(f.weak.fcf_margin)}%`, 'fm', fm, f.weak.fcf_margin),
          cGT(`Short interest above ${f.weak.short_float}% of float`, 'sf', d.sf, f.weak.short_float),
        ])]),
        F('Strong', [
          cGT(`Revenue growth above ${n2(f.strong.rg)}%`, 'rg', rg, f.strong.rg),
          cGT(`Gross margin above ${n2(f.strong.gross_margin)}%`, 'gm', gm, f.strong.gross_margin),
          cB('Free cash flow positive', gt(num(s.fcfTtm), 0)),
        ]),
        F('OK', [
          cGT(`Revenue growth above ${n2(f.ok.rg)}%`, 'rg', rg, f.ok.rg),
          cGT(`Gross margin above ${n2(f.ok.gross_margin)}%`, 'gm', gm, f.ok.gross_margin),
          cGTE(`FCF margin at least ${n2(f.ok.fcf_margin)}%`, 'fm', fm, f.ok.fcf_margin),
          cLT(`Short interest below ${f.ok.short_float}% of float`, 'sf', d.sf, f.ok.short_float),
        ]),
        F('—', [], true),
      ]);
    } else if (type === 'Established') {
      const f = cfg.fund_established;
      const eg = num(s.earningsGrowthYoY), rg = num(s.revenueGrowthYoY);
      const fm = num(s.fcfMargin), pm = num(s.profitMargin), q = num(s.qualityRating);
      const weakAny = [
        cB('Earnings and revenue growth both negative', lt(eg, 0) && lt(rg, 0)),
        cLT('Profit margin below 0%', 'pm', pm, 0),
      ];
      if (cfg.use_quality) weakAny.unshift(cLTE(`Quality at or below ${f.weak.quality}`, 'q', q, f.weak.quality, ''));
      fundRungs = firstMatch([
        F('Weak', [anyOf('Any of', weakAny)]),
        cfg.use_quality
          ? F('Strong', [
            cGTE(`Quality at least ${f.strong.quality}`, 'q', q, f.strong.quality, ''),
            cGT(`Earnings growth above ${n2(f.strong.eg)}%`, 'eg', eg, f.strong.eg),
            cGT(`Revenue growth above ${n2(f.strong.rg)}%`, 'rg', rg, f.strong.rg),
            cGT('FCF margin above 0%', 'fm', fm, 0),
          ])
          : F('Strong', [
            cGT(`Earnings growth above ${n2(f.strong.eg)}%`, 'eg', eg, f.strong.eg),
            cGT(`Revenue growth above ${n2(f.strong.rg)}%`, 'rg', rg, f.strong.rg),
            cGT(`FCF margin above ${n2(f.strong.fcf_margin)}%`, 'fm', fm, f.strong.fcf_margin),
            cGT(`Profit margin above ${n2(f.strong.pm)}%`, 'pm', pm, f.strong.pm),
          ]),
        cfg.use_quality
          ? F('OK', [
            cGTE(`Quality at least ${f.ok.quality}`, 'q', q, f.ok.quality, ''),
            cGT(`Earnings growth above ${n2(f.ok.eg)}%`, 'eg', eg, f.ok.eg),
            cGT(`Revenue growth above ${n2(f.ok.rg)}%`, 'rg', rg, f.ok.rg),
          ])
          : F('OK', [
            cGT(`Earnings growth above ${n2(f.ok.eg)}%`, 'eg', eg, f.ok.eg),
            cGT(`Revenue growth above ${n2(f.ok.rg)}%`, 'rg', rg, f.ok.rg),
            cB('Net income positive', gt(num(s.netIncomeTtm), 0)),
          ]),
        F('—', [], true),
      ]);
    }

    const guards = [];
    const gRung = (label, cond, active) =>
      Object.assign(F(label, [cond]), { met: !!active, fired: !!active, checked: true });
    guards.push(gRung('Thin history', K.thinCond(), d.thinHistory));
    if (cfg.earnings.enabled) guards.push(gRung('Earnings soon', K.earnCond(), d.earningsSoon));

    return { trend, entry, fund: fundRungs, guards };
  }

  function explain(stock, cfg) {
    const s = stock || {};
    const res = evaluate(s, cfg);
    const rungs = buildRungs(res.type, res.defs, res.fund, cfg);
    let fired = -1;
    for (let i = 0; i < rungs.length; i++) {
      const g = rungs[i];
      g.met = g.fallback || g.conds.every((c) => c.met);
      if (fired < 0 && g.met) fired = i;
    }
    rungs.forEach((g, i) => { g.fired = i === fired; g.checked = i <= fired; });
    const mismatch = fired < 0
      || rungs[fired].action !== res.action || rungs[fired].flag !== res.flag;

    const families = buildFamilies(res.type, res.defs, res.fund, cfg, s);
    const lit = (rs) => { const g = rs.find((x) => x.fired); return g ? g.label : null; };
    const familyMismatch =
      lit(families.trend) !== res.states.trend
      || lit(families.entry) !== res.states.entry
      || (res.type !== 'ETF' && lit(families.fund) !== res.states.fund)
      || ((res.states.guards.indexOf('Thin history') >= 0) !== !!families.guards[0].fired)
      || (cfg.earnings.enabled
        && ((res.states.guards.indexOf('Earnings') >= 0) !== !!families.guards[1].fired));
    return Object.assign({}, res, { rungs, firedIndex: fired, mismatch, families, familyMismatch });
  }

  // The model-level reference: the same rungs with no stock behind them —
  // labels and passing zones only, for the "How is this computed?" view.
  function ladder(type, cfg) {
    const d = definitions({}, cfg, type);
    const rungs = buildRungs(type, d, null, cfg);
    const strip = (c) => { c.met = false; if (c.any) c.any.forEach(strip); };
    rungs.forEach((g) => { g.met = false; g.fired = false; g.checked = true; g.conds.forEach(strip); });
    return rungs;
  }

  // One resolved config for a whole pass — what both the server and a browser
  // re-score actually do.
  function apply(stocks, diffOrCfg, presetName) {
    const cfg = diffOrCfg && diffOrCfg.__resolved ? diffOrCfg : resolve(diffOrCfg, presetName).cfg;
    return (stocks || []).map((s) => (s && !s.error ? evaluate(s, cfg) : null));
  }

  return {
    ACTIONS, TYPES, DEFAULTS, PRESETS, TREND_ORDER, ENTRY_ORDER, FUND_ORDER,
    resolve, validate, diff, merge,
    classify, definitions, fundamentals, evaluate, apply, daysToEarnings,
    explain, ladder, trendAt,
  };
});
