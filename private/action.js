// What to do with a stock, from one day's screener row.
//
// Loaded as a plain <script> by the screener and require()d by server.js — the
// arrangement every shared module here uses, and for the same reason: the
// server writes the Action into the snapshot, the browser re-scores it live
// under a user's own preset, and a second implementation would drift inside a
// week.
//
// THE RULES CAME FROM A SPREADSHEET, and the spreadsheet is the test. Every
// formula below is a transcription of `stock_action_rules.xlsx`, whose "Scored
// Data" sheet carries 93 rows with the results Excel itself cached. The
// regression test replays those rows through this code and asserts every
// company type, sub-score, rank, action and flag matches. If a rule changes,
// that fixture is what says whether it changed on purpose.
//
// FOUR THINGS ARE EASY TO GET WRONG, and each is deliberate here:
//
//   1. A BLANK IS NOT A ZERO. A missing margin means "no information" and
//      scores nothing; read as 0 it would score a penalty the company has not
//      earned. Every comparison goes through num(), which returns null for
//      anything non-finite, and every branch checks for null first — the same
//      job ISNUMBER() does in the sheet.
//   2. Early and Established are scored on DIFFERENT rules, not the same rules
//      with different thresholds. P/E, PEG and earnings growth are meaningless
//      for a company that has no earnings, so the Early set never looks at
//      them; it looks at revenue growth, gross margin and cash burn.
//   3. The overrides are a floor, not a contribution. They cannot promote —
//      MIN() against the base tier — so a stock cannot be talked into a Buy by
//      accumulating small positives while its trend is broken.
//   4. A hard sell outranks every other consideration, including the caps.
//
// It is a scoring model, not a measurement. Nothing in it has been shown to
// predict a return; see CLAUDE.md's research log for what has been tested and
// what came back flat. Treat the output as a consistent reading of today's
// numbers, which is what it is.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ActionRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Rank 1..6. The index into this array IS the rank, so rank 1 is the worst
  // and 6 the best, and MIN() across the caps therefore means "the most
  // cautious answer wins".
  const TIERS = ['Sell Immediately', 'Avoid', 'Hold', 'Buy with Risk', 'Buy', 'Strong Buy'];

  // Every threshold, grouped the way the spreadsheet groups them. `meaning` is
  // the editor's row text and the help page's wording, so there is one place to
  // change what a parameter is said to do.
  const PARAMS = [
    // ---- company type -------------------------------------------------------
    { key: 'mc_big', group: 'type', d: 100e9, min: 0, max: 5e12, step: 1e9, money: true,
      label: 'Large market cap', meaning: 'Market cap at or above this scores +2 towards Established.' },
    { key: 'mc_mid', group: 'type', d: 20e9, min: 0, max: 5e12, step: 1e9, money: true,
      label: 'Mid market cap', meaning: 'At or above this (but below large) scores +1.' },
    { key: 'pm_est', group: 'type', d: 5, min: 0, max: 60, step: 0.5,
      label: 'Profit margin', meaning: 'Profitable and at or above this margin scores +2; profitable alone scores +1.' },
    { key: 'fm_est', group: 'type', d: 5, min: 0, max: 60, step: 0.5,
      label: 'FCF margin', meaning: 'Positive free cash flow at or above this margin scores +1.' },
    { key: 'pe_max', group: 'type', d: 40, min: 1, max: 200, step: 1,
      label: 'Sane forward P/E', meaning: 'A forward P/E between 0 and this scores +1.' },
    { key: 'q_est', group: 'type', d: 7, min: 1, max: 10, step: 1,
      label: 'Quality', meaning: 'Quality rating at or above this scores +1.' },
    { key: 'est_min', group: 'type', d: 5, min: 0, max: 7, step: 1,
      label: 'Established at', meaning: 'Establishment score at or above this is Established; below it is Early. Maximum is 7.' },
    { key: 'mc_override', group: 'type', d: 200e9, min: 0, max: 1e13, step: 1e9, money: true,
      label: 'Size override', meaning: 'Market cap at or above this is always Established, whatever the score.' },

    // ---- technical (every type) --------------------------------------------
    { key: 'v200_hi', group: 'tech', d: 10, min: 0, max: 100, step: 1,
      label: 'Well above 200-day', meaning: 'More than this far above the 200-day average scores +2; merely above scores +1.' },
    { key: 'v200_lo', group: 'tech', d: -10, min: -80, max: 0, step: 1,
      label: 'Far below 200-day', meaning: 'Below the 200-day scores −1, and below this scores −2.' },
    { key: 'v50_lo', group: 'tech', d: -3, min: -40, max: 40, step: 1,
      label: 'Base, lower edge', meaning: 'Between this and the upper edge is a healthy pullback: +1.' },
    { key: 'v50_hi', group: 'tech', d: 8, min: -40, max: 60, step: 1,
      label: 'Base, upper edge', meaning: 'The top of the healthy-pullback band against the 50-day.' },
    { key: 'v50_ext', group: 'tech', d: 15, min: 0, max: 100, step: 1,
      label: 'Extended above 50-day', meaning: 'More than this above the 50-day scores −1: stretched.' },
    { key: 'v50_wk', group: 'tech', d: -8, min: -80, max: 0, step: 1,
      label: 'Weak below 50-day', meaning: 'More than this below the 50-day scores −1.' },
    { key: 'rsi_lo', group: 'tech', d: 45, min: 0, max: 100, step: 1,
      label: 'RSI band, low', meaning: 'RSI inside this band scores +1 — moving, not stretched.' },
    { key: 'rsi_hi', group: 'tech', d: 65, min: 0, max: 100, step: 1,
      label: 'RSI band, high', meaning: 'The top of the healthy RSI band.' },
    { key: 'rsi_ob', group: 'tech', d: 72, min: 0, max: 100, step: 1,
      label: 'RSI overbought', meaning: 'RSI above this scores −1.' },
    { key: 'rsi_os', group: 'tech', d: 35, min: 0, max: 100, step: 1,
      label: 'RSI oversold', meaning: 'RSI below this scores −1 — oversold, or broken.' },
    { key: 'md_up', group: 'tech', d: 3, min: 0, max: 40, step: 1,
      label: 'Momentum improving', meaning: 'A two-week momentum gain above this scores +1.' },
    { key: 'md_dn', group: 'tech', d: -5, min: -40, max: 0, step: 1,
      label: 'Momentum fading', meaning: 'A two-week momentum loss below this scores −1.' },
    { key: 'mo_hi', group: 'tech', d: 7, min: 1, max: 10, step: 1,
      label: 'Momentum strong', meaning: 'Momentum rating at or above this scores +1.' },
    { key: 'mo_lo', group: 'tech', d: 3, min: 1, max: 10, step: 1,
      label: 'Momentum weak', meaning: 'Momentum rating at or below this scores −1.' },
    { key: 'vt_hi', group: 'tech', d: 10, min: 0, max: 200, step: 1,
      label: 'Volume surge', meaning: 'Volume trend above this counts as confirmation: +1 if the month is up, −1 if down.' },
    { key: 'fh_near', group: 'tech', d: -10, min: -100, max: 0, step: 1,
      label: 'Near the 52-week high', meaning: 'Within this of the high scores +1.' },
    { key: 'fh_deep', group: 'tech', d: -30, min: -100, max: 0, step: 1,
      label: 'Deep drawdown', meaning: 'Further than this below the high scores −1.' },

    // ---- fundamentals, Established -----------------------------------------
    { key: 'q_hi', group: 'estFund', d: 8, min: 1, max: 10, step: 1,
      label: 'Quality, high', meaning: 'Quality at or above this scores +2.' },
    { key: 'q_mid', group: 'estFund', d: 6, min: 1, max: 10, step: 1,
      label: 'Quality, fair', meaning: 'Quality at or above this scores +1.' },
    { key: 'q_low', group: 'estFund', d: 4, min: 1, max: 10, step: 1,
      label: 'Quality, poor', meaning: 'Quality at or below this scores −1.' },
    { key: 'eg_est', group: 'estFund', d: 15, min: 0, max: 200, step: 1,
      label: 'Earnings growth', meaning: 'Growth above this scores +1; shrinking earnings score −1.' },
    { key: 'rg_est', group: 'estFund', d: 10, min: 0, max: 200, step: 1,
      label: 'Revenue growth', meaning: 'Growth above this scores +1; shrinking revenue scores −1.' },
    { key: 'peg_ok', group: 'estFund', d: 1.5, min: 0, max: 10, step: 0.1,
      label: 'PEG, reasonable', meaning: 'A PEG between 0 and this scores +1.' },
    { key: 'peg_bad', group: 'estFund', d: 3, min: 0, max: 20, step: 0.1,
      label: 'PEG, expensive', meaning: 'A PEG above this scores −1. A negative PEG scores nothing either way.' },
    { key: 'fm_hi', group: 'estFund', d: 10, min: 0, max: 80, step: 1,
      label: 'FCF margin, strong', meaning: 'Above this scores +1; burning cash scores −1.' },

    // ---- fundamentals, Early -----------------------------------------------
    { key: 'rg_e2', group: 'earlyFund', d: 30, min: 0, max: 300, step: 1,
      label: 'Growth, fast', meaning: 'Revenue growth above this scores +2 — the thing an Early company is bought for.' },
    { key: 'rg_e1', group: 'earlyFund', d: 15, min: 0, max: 300, step: 1,
      label: 'Growth, decent', meaning: 'Revenue growth above this scores +1.' },
    { key: 'rg_e_lo', group: 'earlyFund', d: 5, min: 0, max: 100, step: 1,
      label: 'Growth, stalling', meaning: 'Growth below this scores −1; shrinking revenue scores −2.' },
    { key: 'gm_hi', group: 'earlyFund', d: 50, min: 0, max: 100, step: 1,
      label: 'Gross margin, strong', meaning: 'Above this scores +1 — the model that pays for itself later.' },
    { key: 'gm_lo', group: 'earlyFund', d: 25, min: 0, max: 100, step: 1,
      label: 'Gross margin, thin', meaning: 'Below this scores −1.' },
    { key: 'fm_neg', group: 'earlyFund', d: -20, min: -200, max: 0, step: 1,
      label: 'Burn, heavy', meaning: 'Positive free cash flow scores +1; an FCF margin below this scores −1.' },
    { key: 'sf_hi', group: 'earlyFund', d: 15, min: 0, max: 100, step: 1,
      label: 'Short interest, high', meaning: 'Short interest above this scores −1.' },
    { key: 'sf_vhi', group: 'earlyFund', d: 25, min: 0, max: 100, step: 1,
      label: 'Short interest, very high', meaning: 'Above this scores −2.' },
    { key: 'q_e_hi', group: 'earlyFund', d: 6, min: 1, max: 10, step: 1,
      label: 'Quality, good', meaning: 'Quality at or above this scores +1.' },
    { key: 'q_e_lo', group: 'earlyFund', d: 3, min: 1, max: 10, step: 1,
      label: 'Quality, poor', meaning: 'Quality at or below this scores −1.' },

    // ---- composite and tiers ------------------------------------------------
    { key: 'early_fund_wt', group: 'tiers', d: 0.5, min: 0, max: 2, step: 0.1,
      label: 'Early fundamentals weight', meaning: 'Early composite = technical + this × fundamental. Below 1 because Early fundamentals are noisy; Established uses the full weight.' },
    { key: 'est_sb', group: 'tiers', d: 13, min: -30, max: 40, step: 1, label: 'Established → Strong Buy', meaning: 'Composite at or above this.' },
    { key: 'est_b', group: 'tiers', d: 9, min: -30, max: 40, step: 1, label: 'Established → Buy', meaning: 'Composite at or above this.' },
    { key: 'est_bwr', group: 'tiers', d: 5, min: -30, max: 40, step: 1, label: 'Established → Buy with Risk', meaning: 'Composite at or above this.' },
    { key: 'est_h', group: 'tiers', d: 0, min: -30, max: 40, step: 1, label: 'Established → Hold', meaning: 'Composite at or above this.' },
    { key: 'est_av', group: 'tiers', d: -5, min: -30, max: 40, step: 1, label: 'Established → Avoid', meaning: 'At or above this is Avoid; below it is Sell Immediately.' },
    { key: 'early_b', group: 'tiers', d: 9, min: -30, max: 40, step: 1, label: 'Early → Buy', meaning: 'Early never reaches Strong Buy: the evidence is not there for a company without earnings.' },
    { key: 'early_bwr', group: 'tiers', d: 5, min: -30, max: 40, step: 1, label: 'Early → Buy with Risk', meaning: 'Composite at or above this.' },
    { key: 'early_h', group: 'tiers', d: 1, min: -30, max: 40, step: 1, label: 'Early → Hold', meaning: 'Composite at or above this.' },
    { key: 'early_av', group: 'tiers', d: -4, min: -30, max: 40, step: 1, label: 'Early → Avoid', meaning: 'At or above this is Avoid; below it is Sell Immediately.' },
    { key: 'etf_sb', group: 'tiers', d: 8, min: -30, max: 40, step: 1, label: 'ETF → Strong Buy', meaning: 'ETFs are scored on technicals alone — there are no company fundamentals to read.' },
    { key: 'etf_b', group: 'tiers', d: 5, min: -30, max: 40, step: 1, label: 'ETF → Buy', meaning: 'Technical score at or above this.' },
    { key: 'etf_bwr', group: 'tiers', d: 2, min: -30, max: 40, step: 1, label: 'ETF → Buy with Risk', meaning: 'Technical score at or above this.' },
    { key: 'etf_h', group: 'tiers', d: 0, min: -30, max: 40, step: 1, label: 'ETF → Hold', meaning: 'Technical score at or above this.' },
    { key: 'etf_av', group: 'tiers', d: -5, min: -30, max: 40, step: 1, label: 'ETF → Avoid', meaning: 'At or above this is Avoid; below it is Sell Immediately.' },

    // ---- overrides ----------------------------------------------------------
    { key: 'hist_min', group: 'over', d: 100, min: 0, max: 1000, step: 10,
      label: 'Minimum history', meaning: 'Fewer sessions than this caps the answer at Hold — not enough data to judge.' },
    { key: 'hs_est_v200', group: 'over', d: -10, min: -80, max: 0, step: 1,
      label: 'Hard sell: below 200-day', meaning: 'Established hard sell needs a death cross AND this far below the 200-day AND one of the two falls below.' },
    { key: 'hs_est_m1', group: 'over', d: -8, min: -80, max: 0, step: 1, label: 'Hard sell: 1-month fall', meaning: 'Either this or the three-month fall triggers it.' },
    { key: 'hs_est_m3', group: 'over', d: -15, min: -90, max: 0, step: 1, label: 'Hard sell: 3-month fall', meaning: 'Either this or the one-month fall triggers it.' },
    { key: 'hs_early_v200', group: 'over', d: -5, min: -80, max: 0, step: 1,
      label: 'Early hard sell: below 200-day', meaning: 'Early gets a shorter leash: a death cross, this far below the 200-day, and a one-month fall.' },
    { key: 'hs_early_m1', group: 'over', d: -5, min: -80, max: 0, step: 1, label: 'Early hard sell: 1-month fall', meaning: 'Both conditions are required, not either.' },
    { key: 'below200_cap_est', group: 'over', d: 3, min: 1, max: 6, step: 1,
      label: 'Below 200-day caps at', meaning: 'A stock under its 200-day average is capped here. 3 is Hold. Set to 6 to switch the cap off.' },
    { key: 'below200_cap_early', group: 'over', d: 2, min: 1, max: 6, step: 1,
      label: 'Below 200-day caps Early at', meaning: 'Early is capped harder. 2 is Avoid.' },
    { key: 'ext_m1', group: 'over', d: 25, min: 0, max: 200, step: 1,
      label: 'Extended: 1-month rise', meaning: 'A run bigger than this caps at Hold — do not chase, wait for a pullback.' },
    { key: 'ext_v50', group: 'over', d: 15, min: 0, max: 100, step: 1, label: 'Extended: above 50-day', meaning: 'Any one of the three extended tests is enough.' },
    { key: 'ext_rsi', group: 'over', d: 72, min: 0, max: 100, step: 1, label: 'Extended: RSI', meaning: 'Any one of the three extended tests is enough.' },
    { key: 'earn_days', group: 'over', d: 7, min: 0, max: 60, step: 1,
      label: 'Earnings blackout', meaning: 'Reporting within this many days caps at Hold — no new entries into an earnings print. 0 switches it off.' },
  ];

  const GROUP_LABELS = {
    type: 'Established or Early',
    tech: 'Technical score',
    estFund: 'Fundamentals — Established',
    earlyFund: 'Fundamentals — Early',
    tiers: 'Composite and tiers',
    over: 'Overrides',
  };

  const DEFAULTS = {};
  for (const p of PARAMS) DEFAULTS[p.key] = p.d;
  const BY_KEY = {};
  for (const p of PARAMS) BY_KEY[p.key] = p;

  // Pairs that must not cross, and tier ladders that must descend. The weight
  // lens needed none of this — its weights are independent. Here an inverted
  // pair does not error, it silently makes a band unreachable, so the page
  // would show a column that can never say "Buy" and never explain why.
  const ORDERED_PAIRS = [
    ['mc_mid', 'mc_big'], ['rsi_lo', 'rsi_hi'], ['rsi_os', 'rsi_ob'],
    ['v50_lo', 'v50_hi'], ['fh_deep', 'fh_near'], ['q_low', 'q_mid'], ['q_mid', 'q_hi'],
    ['q_e_lo', 'q_e_hi'], ['gm_lo', 'gm_hi'], ['rg_e1', 'rg_e2'], ['peg_ok', 'peg_bad'],
    ['sf_hi', 'sf_vhi'], ['mo_lo', 'mo_hi'],
  ];
  const LADDERS = [
    ['est_sb', 'est_b', 'est_bwr', 'est_h', 'est_av'],
    ['early_b', 'early_bwr', 'early_h', 'early_av'],
    ['etf_sb', 'etf_b', 'etf_bwr', 'etf_h', 'etf_av'],
  ];

  // Untrusted input in, a usable parameter set out. Same discipline as
  // cleanWeights(): rebuild from scratch against the known keys so this can
  // never become free storage, then repair the orderings rather than reject the
  // whole set, and report what was repaired so a silent correction is visible.
  function clean(raw) {
    const out = {}, fixed = [];
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const p of PARAMS) {
      const v = Number(src[p.key]);
      if (!isFinite(v)) continue;
      const c = Math.min(p.max, Math.max(p.min, v));
      // Keep a sane number of decimals; the money thresholds stay integers.
      out[p.key] = p.step >= 1 ? Math.round(c) : Math.round(c * 1000) / 1000;
    }
    const get = (k) => (out[k] === undefined ? DEFAULTS[k] : out[k]);
    for (const [lo, hi] of ORDERED_PAIRS) {
      if (get(lo) > get(hi)) { out[hi] = get(lo); fixed.push(`${hi} raised to ${out[hi]}`); }
    }
    for (const ladder of LADDERS) {
      for (let i = 1; i < ladder.length; i++) {
        if (get(ladder[i]) > get(ladder[i - 1])) {
          out[ladder[i]] = get(ladder[i - 1]);
          fixed.push(`${ladder[i]} lowered to ${out[ladder[i]]}`);
        }
      }
    }
    return { params: out, fixed };
  }

  // Only what differs from the defaults, so improving a default still reaches
  // anyone who once opened the editor. Storing all seventy would pin every one
  // of them to the day the user first touched the panel.
  function diff(params) {
    const out = {};
    for (const p of PARAMS) {
      const v = params ? params[p.key] : undefined;
      if (v !== undefined && Number(v) !== p.d) out[p.key] = Number(v);
    }
    return out;
  }

  const resolve = (overrides) => Object.assign({}, DEFAULTS, clean(overrides).params);

  // ---- scoring --------------------------------------------------------------
  // Null for anything that is not a usable number, so a blank never scores.
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  // "Golden" / "Death" / null, from the two fields the snapshot actually holds.
  function maCross(s) {
    if (!s || s.maBullish == null) return null;
    return s.maBullish ? 'Golden' : 'Death';
  }

  // Calendar days until the next report. Negative means a stale date and is
  // ignored rather than treated as "already reported".
  function daysToEarnings(s) {
    if (!s || !s.nextEarningsDate || !s.latestDate) return null;
    const a = Date.parse(s.nextEarningsDate + 'T00:00:00Z');
    const b = Date.parse(s.latestDate + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.round((a - b) / 86400000);
  }

  function isETF(s, q, pe) {
    const names = Array.isArray(s.portfolios) ? s.portfolios.join(' ') : String(s.portfolios || '');
    if (/etf/i.test(names)) return true;
    // No quality rating and no forward P/E means nothing to read as a company.
    return q == null && pe == null;
  }

  function establishment(s, p) {
    const mc = num(s.marketCap), ni = num(s.netIncomeTtm), pm = num(s.profitMargin);
    const fcf = num(s.fcfTtm), fm = num(s.fcfMargin), pe = num(s.forwardPe), q = num(s.qualityRating);
    let n = 0;
    if (mc != null) n += mc >= p.mc_big ? 2 : (mc >= p.mc_mid ? 1 : 0);
    if (ni != null && ni > 0) n += (pm != null && pm >= p.pm_est) ? 2 : 1;
    if (fcf != null && fcf > 0 && fm != null && fm >= p.fm_est) n += 1;
    if (pe != null && pe > 0 && pe <= p.pe_max) n += 1;
    if (q != null && q >= p.q_est) n += 1;
    return n;
  }

  function technical(s, p) {
    const t = {};
    const cross = maCross(s);
    t.t1 = cross === 'Golden' ? 2 : (cross === 'Death' ? -2 : 0);

    const v200 = num(s.vs200ma);
    t.t2 = v200 == null ? 0
      : (v200 > p.v200_hi ? 2 : v200 > 0 ? 1 : v200 >= p.v200_lo ? -1 : -2);

    const v50 = num(s.vs50ma);
    t.t3 = v50 == null ? 0
      : ((v50 >= p.v50_lo && v50 <= p.v50_hi) ? 1 : (v50 > p.v50_ext || v50 < p.v50_wk) ? -1 : 0);

    const rsi = num(s.rsi);
    t.t4 = rsi == null ? 0
      : ((rsi >= p.rsi_lo && rsi <= p.rsi_hi) ? 1 : (rsi > p.rsi_ob || rsi < p.rsi_os) ? -1 : 0);

    const md = num(s.momentumChange);
    t.t5 = md == null ? 0 : (md > p.md_up ? 1 : md < p.md_dn ? -1 : 0);

    const mo = num(s.momentumRating);
    t.t6 = mo == null ? 0 : (mo >= p.mo_hi ? 1 : mo <= p.mo_lo ? -1 : 0);

    // Volume only counts as confirmation when there is a move to confirm, so it
    // reads the month's direction rather than standing on its own.
    const vt = num(s.volTrend), m1 = num(s.oneMonthPct);
    t.t7 = (vt != null && vt > p.vt_hi && m1 != null) ? (m1 < 0 ? -1 : 1) : 0;

    const fh = num(s.pctFromHigh);
    t.t8 = fh == null ? 0 : (fh > p.fh_near ? 1 : fh < p.fh_deep ? -1 : 0);

    t.total = t.t1 + t.t2 + t.t3 + t.t4 + t.t5 + t.t6 + t.t7 + t.t8;
    return t;
  }

  function establishedFund(s, p) {
    const f = {};
    const q = num(s.qualityRating);
    f.fe1 = q == null ? 0 : (q >= p.q_hi ? 2 : q >= p.q_mid ? 1 : q <= p.q_low ? -1 : 0);
    const eg = num(s.earningsGrowthYoY);
    f.fe2 = eg == null ? 0 : (eg > p.eg_est ? 1 : eg < 0 ? -1 : 0);
    const rg = num(s.revenueGrowthYoY);
    f.fe3 = rg == null ? 0 : (rg > p.rg_est ? 1 : rg < 0 ? -1 : 0);
    // A negative PEG is not cheap, it is meaningless — it scores nothing.
    const peg = num(s.peg);
    f.fe4 = peg == null ? 0 : ((peg > 0 && peg <= p.peg_ok) ? 1 : peg > p.peg_bad ? -1 : 0);
    const fm = num(s.fcfMargin);
    f.fe5 = fm == null ? 0 : (fm > p.fm_hi ? 1 : fm < 0 ? -1 : 0);
    const nc = num(s.netCash);
    f.fe6 = nc == null ? 0 : (nc > 0 ? 1 : 0);
    f.total = f.fe1 + f.fe2 + f.fe3 + f.fe4 + f.fe5 + f.fe6;
    return f;
  }

  function earlyFund(s, p) {
    const f = {};
    const rg = num(s.revenueGrowthYoY);
    f.ea1 = rg == null ? 0
      : (rg > p.rg_e2 ? 2 : rg > p.rg_e1 ? 1 : rg < 0 ? -2 : rg < p.rg_e_lo ? -1 : 0);
    const gm = num(s.grossMargin);
    f.ea2 = gm == null ? 0 : (gm > p.gm_hi ? 1 : gm < p.gm_lo ? -1 : 0);
    const fcf = num(s.fcfTtm), fm = num(s.fcfMargin);
    f.ea3 = (fcf != null && fcf > 0) ? 1 : ((fm != null && fm < p.fm_neg) ? -1 : 0);
    const ni = num(s.netIncomeTtm);
    f.ea4 = ni == null ? 0 : (ni > 0 ? 1 : 0);
    const sf = num(s.shortPctFloat);
    f.ea5 = sf == null ? 0 : (sf > p.sf_vhi ? -2 : sf > p.sf_hi ? -1 : 0);
    const q = num(s.qualityRating);
    f.ea6 = q == null ? 0 : (q >= p.q_e_hi ? 1 : q <= p.q_e_lo ? -1 : 0);
    f.total = f.ea1 + f.ea2 + f.ea3 + f.ea4 + f.ea5 + f.ea6;
    return f;
  }

  function baseRank(type, composite, p) {
    if (type === 'Established') {
      return composite >= p.est_sb ? 6 : composite >= p.est_b ? 5 : composite >= p.est_bwr ? 4
        : composite >= p.est_h ? 3 : composite >= p.est_av ? 2 : 1;
    }
    if (type === 'Early') {
      // No Strong Buy: the case for a company without earnings is never that good.
      return composite >= p.early_b ? 5 : composite >= p.early_bwr ? 4
        : composite >= p.early_h ? 3 : composite >= p.early_av ? 2 : 1;
    }
    return composite >= p.etf_sb ? 6 : composite >= p.etf_b ? 5 : composite >= p.etf_bwr ? 4
      : composite >= p.etf_h ? 3 : composite >= p.etf_av ? 2 : 1;
  }

  // The whole reading for one stock.
  function score(stock, overrides) {
    const p = overrides && overrides.__resolved ? overrides : resolve(overrides);
    const s = stock || {};
    const q = num(s.qualityRating), pe = num(s.forwardPe);

    const etf = isETF(s, q, pe);
    const est = establishment(s, p);
    const mc = num(s.marketCap);
    const type = etf ? 'ETF'
      : (((mc != null && mc >= p.mc_override) || est >= p.est_min) ? 'Established' : 'Early');

    const tech = technical(s, p);
    const fund = type === 'Established' ? establishedFund(s, p)
      : type === 'Early' ? earlyFund(s, p) : { total: 0 };
    const composite = type === 'Established' ? tech.total + fund.total
      : type === 'Early' ? tech.total + p.early_fund_wt * fund.total
        : tech.total;

    const base = baseRank(type, composite, p);

    const cross = maCross(s);
    const v200 = num(s.vs200ma), m1 = num(s.oneMonthPct), m3 = num(s.threeMonthPct);
    const hist = num(s.historyDays), rsi = num(s.rsi), v50 = num(s.vs50ma);
    const dte = daysToEarnings(s);

    const ov = {};
    ov.hardSell = cross === 'Death' && v200 != null && (type === 'Early'
      ? (v200 < p.hs_early_v200 && m1 != null && m1 < p.hs_early_m1)
      : (v200 < p.hs_est_v200 && ((m1 != null && m1 < p.hs_est_m1) || (m3 != null && m3 < p.hs_est_m3))));
    ov.history = hist != null && hist < p.hist_min;
    ov.below200 = v200 != null && v200 < 0;
    ov.extended = (m1 != null && m1 > p.ext_m1) || (v50 != null && v50 > p.ext_v50)
      || (rsi != null && rsi > p.ext_rsi);
    ov.earnings = dte != null && dte >= 0 && dte <= p.earn_days;

    // Caps floor the answer; they never lift it. A hard sell skips them all.
    let rank;
    if (ov.hardSell) {
      rank = 1;
    } else {
      rank = base;
      if (ov.history) rank = Math.min(rank, 3);
      if (ov.below200) rank = Math.min(rank, type === 'Early' ? p.below200_cap_early : p.below200_cap_est);
      if (ov.extended) rank = Math.min(rank, 3);
      if (ov.earnings) rank = Math.min(rank, 3);
    }
    rank = Math.max(1, Math.min(6, Math.round(rank)));

    const flags = [];
    if (ov.hardSell) flags.push('Hard sell: breakdown');
    if (ov.history) flags.push('Insufficient history');
    if (!ov.hardSell && ov.below200) flags.push('Below 200D');
    if (ov.extended) flags.push('Extended - wait for pullback');
    if (ov.earnings) flags.push(`Earnings within ${p.earn_days}d`);

    return {
      type, estScore: est, tech, fund, composite,
      baseRank: base, rank, action: TIERS[rank - 1], overrides: ov, flags,
      daysToEarnings: dte,
    };
  }

  // Score a whole list once against one resolved parameter set, which is what
  // both the refresh and a browser re-score actually do.
  function apply(stocks, overrides) {
    const p = resolve(overrides);
    p.__resolved = true;
    return (stocks || []).map((s) => (s && !s.error ? score(s, p) : null));
  }

  return {
    TIERS, PARAMS, DEFAULTS, GROUP_LABELS, ORDERED_PAIRS, LADDERS,
    clean, diff, resolve, score, apply, maCross, daysToEarnings,
  };
});
