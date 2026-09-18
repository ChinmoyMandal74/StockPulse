// The column-filter grammar, defined once.
//
// The screener's filter row, the Screens, and — since the mobile page arrived
// (2026-09-16) — the SERVER all decide "does this row match this filter?". The
// mobile page asks the server to run a screen and send back the twenty rows it
// matched rather than shipping the 1.3MB table to a phone, so this had to stop
// living inside index.html: two implementations of `>=3` would have drifted
// inside a week, the same reason momentum.js, action.js and screens.js exist.
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
  const RATING_FOR = { overallScore: 'overallRating', qualityScore: 'qualityRating', momentumScore: 'momentumRating' };
  const TEXT_KEYS = new Set(['symbol', 'shortName', 'actionGuards', 'portfolios']);
  const CAT_KEYS = new Set(['companyType', 'actionTrend', 'actionEntry', 'actionFund', 'maCrossRank', 'fresh3mHigh',
    'exchange']);
  // Filters a screen can set that have no column of their own.
  const SCREEN_ONLY_KEYS = { fresh3mHigh: 'Fresh 3M high', lastSurprise: 'Last surprise %', daysSinceEarnings: 'Days since earnings' };
  // These write the bar's own pickers rather than a column filter of their own.
  const BOUND_KEYS = new Set(['sector', 'industry', 'av:Balanced']);
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
    if (d.changed) out = out.filter((x) => x.action && x.advicePrev && x.advicePrev !== x.action);
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
    maCrossWord, filterValue, filterKind, parseNumTerm,
    compileNum, compileText, compileFilter, screenRows,
  };
});
