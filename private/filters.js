// The column-filter grammar, defined once.
//
// The screener's filter row, the Screens, and — since the mobile page arrived
// (2026-09-16) — the SERVER all decide "does this row match this filter?". The
// mobile page asks the server to run a screen and send back the twenty rows it
// matched rather than shipping the 1.3MB table to a phone, so this had to stop
// living inside index.html: two implementations of `>=3` would have drifted
// inside a week, the same reason action.js and rowcard.js exist.
//
// Nothing here touches the DOM. What it cannot know on its own — a member's
// personal portfolios — is passed in as `ctx`.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Filters = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // A score column filters on the 1-10 rating the cell shows, not the 0-100
  // score behind it.
  const RATING_FOR = { qualityScore: 'qualityRating' };
  const TEXT_KEYS = new Set(['symbol', 'shortName', 'actionGuards', 'portfolios']);
  const CAT_KEYS = new Set(['companyType', 'actionTrend', 'actionEntry', 'actionFund', 'maCrossRank', 'fresh3mHigh',
    'exchange', 'capBand']);

  // ---- Size by market cap ---------------------------------------------------
  // It lives HERE because four surfaces need it and none of them may own it:
  // the server stamps the band, the screener sorts and filters on it, the pivot
  // uses it as a dimension, and the row card shows it. This file is already the
  // "what a column means, defined once" module and is both require()d by the
  // server and <script>-loaded by the pages.
  //
  // The conventional US tiers, with ONE departure, recorded as a choice rather
  // than smuggled in as a standard: Large ($10–200B) is split at $50B. Measured
  // before the split, 418 of 602 stocks — 69% — landed in a single "Large"
  // bucket, which is a dimension that barely discriminates; the split takes the
  // biggest bucket to 43%. $50B is no more canonical than $200B or $10B, which
  // are themselves just widely-repeated round numbers.
  //
  // THE THRESHOLDS ARE FIXED, never derived from the universe. Today's median
  // cap is $33.4B and splitting there would balance the chart beautifully — and
  // would be percentiles wearing a band's name: "mid cap" would stop meaning the
  // same thing next year, and a stock would change band because someone added a
  // ticker. A band that moves with the data is a percentile in disguise.
  //
  // SAFE TO BAND IN DOLLARS, verified rather than assumed: market cap comes back
  // in USD even when the rest of the row does not — Ericsson reads a $33.2B cap
  // beside 236.7B of revenue in SEK — checked across 18 foreign reporters. That
  // holds because the universe is US-listed only; it would NOT hold for a
  // foreign listing, which is one more reason that rule exists.
  const CAP_BANDS = [
    { label: 'Mega',      min: 200e9, range: '$200B and above' },
    { label: 'Large',     min: 50e9,  range: '$50B – $200B' },
    { label: 'Mid-Large', min: 10e9,  range: '$10B – $50B' },
    { label: 'Mid',       min: 2e9,   range: '$2B – $10B' },
    { label: 'Small',     min: 300e6, range: '$300M – $2B' },
    { label: 'Micro',     min: 0,     range: 'under $300M' },
  ];
  const CAP_ORDER = CAP_BANDS.map((b) => b.label);
  const CAP_RANGE = {};
  for (const b of CAP_BANDS) CAP_RANGE[b.label] = b.range;

  // The band, or null. A missing or zero cap is NOT a band: an ETF reports AUM
  // rather than capitalisation, so it belongs in the blank bucket rather than
  // being called the smallest company on the screen.
  function capBandOf(cap) {
    if (cap == null || !isFinite(cap) || cap <= 0) return null;
    for (const b of CAP_BANDS) if (cap >= b.min) return b.label;
    return null;
  }
  // Filters a screen can set that have no column of their own.
  const SCREEN_ONLY_KEYS = { fresh3mHigh: 'Fresh 3M high', lastSurprise: 'Last surprise %', daysSinceEarnings: 'Days since earnings' };
  // These write the bar's own pickers rather than a column filter of their own.
  // capBand joins these because it gained a bar picker: a BOUND key writes
  // the bar's own state, so the column filter and the picker can never show
  // two different things, and it is not counted as a column filter.
  const BOUND_KEYS = new Set(['sector', 'industry', 'av:Balanced', 'capBand']);
  const BLANK = '— blank';

  function maCrossWord(x) {
    if (x.maBullish == null) return null;
    const fresh = x.maCrossDays != null && x.maCrossDays <= 20;
    return x.maBullish ? (fresh ? 'Golden cross' : 'Bullish') : (fresh ? 'Death cross' : 'Bearish');
  }

  // What a filter reads: the value the cell SHOWS, in the unit it shows it —
  // the 1-10 rating rather than the score behind it, days to earnings rather
  // than a date, the MA cross as its word.
  function filterValue(x, key, ctx) {
    const c = ctx || {};
    if (key.startsWith('av:')) {
      const v = x.adviceBy && x.adviceBy[key.slice(3)];
      // Server-side there is no client scoring pass, so fall back to the
      // Balanced verdict already stamped on the row.
      if (v) return v.a;
      return key.slice(3) === 'Balanced' ? (x.action || null) : null;
    }
    if (RATING_FOR[key]) return x[RATING_FOR[key]];
    if (key === 'maCrossRank') return maCrossWord(x);
    if (key === 'shortName') return [x.shortName, x.name].filter(Boolean).join(' · ');
    if (key === 'portfolios') {
      const mine = c.myPortfolios || {};
      return (x.portfolios || []).concat(
        Object.keys(mine).filter((n) => (mine[n] || []).includes(x.symbol))).join(' · ');
    }
    if (key === 'nextEarningsDate') {
      return x.nextEarningsDate ? Math.round((new Date(x.nextEarningsDate) - new Date()) / 86400000) : null;
    }
    if (key === 'pricedAt') {
      // Hours since this stock's price was fetched. >24 is "not refreshed for
      // a day"; a stock never priced stays blank and matches nothing, which is
      // the rule for blanks everywhere in this grammar.
      return x.pricedAt ? Math.round(((c.now || Date.now()) - x.pricedAt) / 360000) / 10 : null;
    }
    if (key === 'daysSinceEarnings') {
      return x.lastEarningsDate ? Math.round((new Date() - new Date(x.lastEarningsDate)) / 86400000) : null;
    }
    if (key === 'fresh3mHigh') return x.fresh3mHigh ? 'Yes' : 'No';
    return x[key];
  }

  function filterKind(key) {
    if (BOUND_KEYS.has(key)) return 'bound';
    if (key.startsWith('av:') || CAT_KEYS.has(key)) return 'cat';
    if (TEXT_KEYS.has(key)) return 'text';
    return 'num';
  }

  function parseNumTerm(t) {
    const m = /^([-+]?\d*\.?\d+)([kmbt])?$/i.exec(String(t).replace(/[\s,$%]/g, ''));
    if (!m) return null;
    const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[(m[2] || '').toLowerCase()] || 1;
    const dec = (m[1].split('.')[1] || '').length;
    return { n: parseFloat(m[1]) * mult, tol: (0.5 * Math.pow(10, -dec)) * mult };
  }

  // null = empty (no filter), false = not understood, else a predicate.
  // Blanks never pass a number filter in either direction.
  function compileNum(src) {
    const s = String(src || '').trim();
    if (!s) return null;
    const num = (f) => (v) => v != null && v !== '' && isFinite(v) && f(Number(v));
    const range = /^(.*?)\.\.(.*)$/.exec(s);
    if (range) {
      const lo = range[1].trim() ? parseNumTerm(range[1]) : { n: -Infinity };
      const hi = range[2].trim() ? parseNumTerm(range[2]) : { n: Infinity };
      if (!lo || !hi) return false;
      return num((v) => v >= lo.n && v <= hi.n);
    }
    const m = /^(>=|<=|!=|=>|=<|>|<|=|≥|≤)?\s*(.+)$/.exec(s);
    const t = m && parseNumTerm(m[2]);
    if (!t) return false;
    const n = t.n;
    switch (m[1]) {
      case '>': return num((v) => v > n);
      case '<': return num((v) => v < n);
      case '<=': case '=<': case '≤': return num((v) => v <= n);
      // "=" matches at the precision typed, so =61 finds an RSI of 61.2
      case '=': return num((v) => Math.abs(v - n) < t.tol);
      case '!=': return num((v) => Math.abs(v - n) >= t.tol);
      default: return num((v) => v >= n);       // bare, >=, => and ≥: at least
    }
  }

  function compileText(src) {
    const s = String(src || '').trim().toLowerCase();
    if (!s) return null;
    const terms = s.split('|').map((x) => x.trim()).filter(Boolean);
    const neg = terms.filter((x) => x[0] === '!').map((x) => x.slice(1)).filter(Boolean);
    const pos = terms.filter((x) => x[0] !== '!');
    if (!neg.length && !pos.length) return false;
    return (v) => {
      const hay = v == null ? '' : String(v).toLowerCase();
      if (neg.some((x) => hay.includes(x))) return false;
      if (!pos.length) return true;
      return pos.some((x) => (x[0] === '=' ? hay === x.slice(1).trim()
        || hay.split(' · ').includes(x.slice(1).trim()) : hay.includes(x)));
    };
  }

  function compileFilter(key, src) {
    const k = filterKind(key);
    if (k === 'num') return compileNum(src);
    if (k === 'text') return compileText(src);
    if (k === 'cat') {
      if (!src) return null;
      if (src === BLANK) return (v) => v == null || v === '';
      // a screen may ask for either of several values: "Breakdown|Downtrend"
      if (src.includes('|')) { const any = new Set(src.split('|')); return (v) => any.has(v); }
      return (v) => v === src;
    }
    return null;
  }

  // Which way a stock's Balanced verdict went since the previous close:
  // 'Upgraded' | 'Downgraded' | 'Unchanged', or null when there is nothing to
  // compare against — a stock new to the screener has not "held" its verdict,
  // and calling that Unchanged would be a third thing the blank rule exists to
  // prevent.
  //
  // DEFINED HERE because three surfaces need the same answer: the screener's
  // bar filter, the pivot's dimension and measure, and this module's own screen
  // evaluation, which the server runs for the phone.
  //
  // `ActionRules.ACTIONS` RUNS WORST-FIRST (Sell Immediately → Strong Buy), so
  // an upgrade is an INCREASE in index. Both pages reverse that list for
  // display; using the display order here would label every upgrade a
  // downgrade. Read off the global lazily rather than at load, because
  // /pivot loads this file before action.js.
  const MOVES = ['Moved', 'Upgraded', 'Unchanged', 'Downgraded'];
  function adviceMove(s) {
    if (!s || !s.action || !s.advicePrev) return null;
    if (s.action === s.advicePrev) return 'Unchanged';
    const L = (typeof globalThis !== 'undefined' && globalThis.ActionRules
      && globalThis.ActionRules.ACTIONS) || null;
    if (!L) return null;                     // no ladder, no honest direction
    return L.indexOf(s.action) > L.indexOf(s.advicePrev) ? 'Upgraded' : 'Downgraded';
  }
  // 'Moved' is either direction — what the screener's Changed chip meant before
  // it became this filter, and what a screen saved with `changed: true` means.
  const adviceMoveIs = (s, want) => {
    if (!want || want === 'All') return true;
    const m = adviceMove(s);
    return want === 'Moved' ? (m === 'Upgraded' || m === 'Downgraded') : m === want;
  };

  // Every row a screen's definition matches, in its sort order. The bound keys
  // (sector, industry, the Balanced verdict) are part of the definition too,
  // and are applied here rather than by the caller.
  function screenRows(def, rows, ctx) {
    const d = def || {};
    const list = (rows || []).filter((x) => x && !x.error);
    const tests = [];
    for (const [key, src] of Object.entries(d.filters || {})) {
      const fn = compileFilter(key, src);
      if (fn) tests.push([key, fn]);
    }
    if (d.sector && d.sector !== 'All') tests.push(['sector', (v) => v === d.sector]);
    if (d.industry && d.industry !== 'All') tests.push(['industry', (v) => v === d.industry]);
    if (d.advice && d.advice !== 'All') tests.push(['av:Balanced', (v) => v === d.advice]);
    let out = list.filter((x) => tests.every(([key, fn]) => fn(filterValue(x, key, ctx))));
    // Which way the Balanced verdict went since the previous close.
    // `d.changed` is the older spelling and means "moved either way"; it is
    // still read so screens saved before the split keep working, and it is
    // exactly what `move: 'Moved'` means.
    const mv = d.move || (d.changed ? 'Moved' : '');
    if (mv && mv !== 'All') out = out.filter((x) => adviceMoveIs(x, mv));
    const sort = d.sort || null;
    if (sort && sort.key) {
      const dir = sort.dir === 1 ? 1 : -1;
      out = out.slice().sort((a, b) => {
        const av = filterValue(a, sort.key, ctx);
        const bv = filterValue(b, sort.key, ctx);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;              // blanks last, whichever way it points
        if (bv == null) return -1;
        if (typeof av === 'string' || typeof bv === 'string') {
          return String(av).localeCompare(String(bv)) * dir;
        }
        return (av - bv) * dir;
      });
    }
    return out;
  }

  return {
    RATING_FOR, TEXT_KEYS, CAT_KEYS, SCREEN_ONLY_KEYS, BOUND_KEYS, BLANK,
    CAP_BANDS, CAP_ORDER, CAP_RANGE, capBandOf,
    maCrossWord, filterValue, filterKind, parseNumTerm,
    adviceMove, adviceMoveIs, MOVES,
    compileNum, compileText, compileFilter, screenRows,
  };
});
