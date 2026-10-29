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
  const TEXT_KEYS = new Set(['symbol', 'shortName', 'actionGuards', 'portfolios', 'lastEvent', 'lastHolder', 'erGuide', 'erSummary', 'staleIssues']);
  const CAT_KEYS = new Set(['companyType', 'actionTrend', 'actionEntry', 'actionFund', 'maCrossRank', 'fresh3mHigh',
    'exchange', 'capBand', 'instrumentType', 'filer', 'ddState', 'spMember', 'erTenQ', 'erGuideChange', 'erVsEstWord', 'crNow']);

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
  // ---- Drawdown state: a word for the distance below the 52-week high -------
  //
  // (2026-10-10, the owner: "there is nothing in my app about market and
  // individual stock corrections".) The distance was always on the row as
  // `pctFromHigh`; what was missing was the vocabulary, so nothing could be
  // filtered or counted as "in a correction". The thresholds are the ones
  // the financial press uses for an index, applied to each stock against its
  // own high:
  //
  //   under 5% below    Near high
  //   5 to 10%          Pullback
  //   10 to 20%         Correction
  //   20% or more       Bear market
  //
  // AGAINST THE 52-WEEK HIGH, NOT THE RECORD. The two disagree for a stock
  // that peaked two years ago: 40% off its record and at a one-year high is
  // not "in a bear market" in any sense a reader means today. `% from
  // record` stays its own column for the other question.
  //
  // IT LIVES HERE for the size band's reason: the server stamps it, the
  // screener sorts and filters on it, the cards count it, and none of them
  // may own the thresholds.
  //
  // NO STATE WITHOUT A YEAR'S HIGH TO MEASURE FROM. A stock listed three
  // months ago has a three-month high, and calling it "near high" would be
  // a claim about a year it has not had. Half a year of sessions is the
  // floor; an unknown history is taken as enough, since most rows that
  // reach a page carry the distance without the count.
  const DD_STATES = [
    { label: 'Near high', under: 5, range: 'Less than 5% below the 52-week high' },
    { label: 'Pullback', under: 10, range: '5 to 10% below the 52-week high' },
    { label: 'Correction', under: 20, range: '10 to 20% below the 52-week high' },
    { label: 'Bear market', under: Infinity, range: '20% or more below the 52-week high' },
  ];
  const DD_ORDER = DD_STATES.map((b) => b.label);
  const DD_RANGE = {};
  for (const b of DD_STATES) DD_RANGE[b.label] = b.range;
  const DD_MIN_HISTORY = 126;
  function ddStateOf(pctFromHigh, historyDays) {
    // A null is not a zero: Number(null) is 0, which would read 'Near high'.
    if (pctFromHigh == null || pctFromHigh === '' || !isFinite(Number(pctFromHigh))) return null;
    if (historyDays != null && historyDays !== '' && Number(historyDays) < DD_MIN_HISTORY) return null;
    const below = -Number(pctFromHigh);
    for (const b of DD_STATES) if (below < b.under) return b.label;
    return null;
  }

  // DAYS TO COVER FOR A HOLDER (2026-10-26, the owner: "Like how we have Short
  // Days to cover ... Insiders Days to Cover and Instit Days to Cover"). The
  // shares a holder group owns over the average shares traded a day: how many
  // days of normal trading it would take to absorb them, the way Short days to
  // cover is the shorts' position over the same. A size, not a forecast.
  //   shares held  = pct of shares held (the price provider's) x shares out
  //   average day  = avgVol20, the prior 20 sessions' average volume, put on
  //                  the row by the price refresh from the bars it holds.
  // A row written before avgVol20 existed falls back to today's volume over
  // Rel. volume (volX), which gives that same average back -- but volX is
  // rounded to two places, so early in a session (volX 0.03) the average could
  // be 17% out; the fallback is taken only at volX 0.5 or more (within 1%).
  // Every input must be present and positive; any gap is a blank, never zero.
  function holderDays(pct, sharesOut, avgVol, volume, volX) {
    const n = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
    const p = n(pct), so = n(sharesOut), a = n(avgVol), v = n(volume), x = n(volX);
    if (p == null || p <= 0 || so == null || so <= 0) return null;
    const adv = a != null && a > 0 ? a : (v != null && v > 0 && x != null && x >= 0.5 ? v / x : null);
    if (adv == null) return null;
    return Math.round((p / 100) * so / adv * 10) / 10;
  }

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
  const BOUND_KEYS = new Set(['sector', 'industry', 'av:Balanced', 'capBand', 'spMember']);
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
      // Days until the report. A date already passed is not a next date (the
      // screener draws a dash for it, RowCard.nextEarn), so it is blank here
      // too and "..14" no longer matches reports that were due weeks ago.
      // A fund reports no earnings.
      if (!x.nextEarningsDate || x.instrumentType === 'ETF') return null;
      const days = Math.round((new Date(String(x.nextEarningsDate).slice(0, 10) + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00')) / 86400000);
      return days >= 0 ? days : null;
    }
    if (key === 'pricedAt') {
      // Hours since this stock's price was fetched. >24 is "not refreshed for
      // a day"; a stock never priced stays blank and matches nothing, which is
      // the rule for blanks everywhere in this grammar.
      return x.pricedAt ? Math.round(((c.now || Date.now()) - x.pricedAt) / 360000) / 10 : null;
    }
    // Days SINCE the last report, mirroring nextEarningsDate's days-to: a raw
    // date string is nothing anyone can type against, the pricedAt rule. TWO
    // NAMES, ONE EXPRESSION -- `daysSinceEarnings` is the screen-only key the
    // starter screens already filter on, `lastEarningsDate` is the column's
    // own key, and a second copy of this arithmetic is exactly the drift
    // filters.js exists to prevent.
    // The period end filters on DAYS SINCE too, for the reason the
    // announcement date does: an ISO string is not something a reader
    // can type a comparison against. Local noon, or every count is a
    // day high west of Greenwich.
    if (key === 'mostRecentQuarter') {
      return x.mostRecentQuarter
        ? Math.round((Date.now() - new Date(x.mostRecentQuarter + 'T12:00:00').getTime()) / 86400000) : null;
    }
    if (key === 'lastEarningsDate' || key === 'daysSinceEarnings') {
      // LOCAL NOON, not the bare string. `new Date('2026-09-20')` is UTC
      // midnight, so west of Greenwich it lands on the 19th and every count
      // here came out a day high -- the cell's tooltip said "10 days ago"
      // while this said 11, and a `>10` filter then returned rows whose own
      // tooltip said 10. The card-dating lesson, one line apart.
      return x.lastEarningsDate
        ? Math.round((Date.now() - new Date(x.lastEarningsDate + 'T12:00:00').getTime()) / 86400000) : null;
    }
    // The results release's two dates (Last Earning AI Extracted) filter as
    // days since, like the report date above.
    if (key === 'erFiled' || key === 'erPeriodEnd') {
      return x[key] ? Math.round((Date.now() - new Date(x[key] + 'T12:00:00').getTime()) / 86400000) : null;
    }
    // Out of date: the issues as the cell words them, so a text filter
    // ("predate", "missed") finds them. rowcard.js owns the rule; on the
    // server it is loaded before any screen runs. None is blank, not ''.
    // The compounding record's Now filters on its words, as the cell shows them.
    if (key === 'crNow') return x.crNow ? ({ grow: 'Still growing', slow: 'Slowing', decline: 'Declining' })[x.crNow] || null : null;
    if (key === 'staleIssues') {
      const RC = (typeof globalThis !== 'undefined' ? globalThis : window).RowCard;
      const l = RC && RC.staleIssues ? RC.staleIssues(x, c.now) : null;
      return l && l.length ? l.map((i) => i.t).join(' · ') : null;
    }
    if (key === 'fresh3mHigh') return x.fresh3mHigh ? 'Yes' : 'No';
    // A NULL IS NOT A NO. With no holdings file imported every row is
    // unknown, and a dropdown offering only Yes/No would silently filter
    // those rows away rather than showing them as unanswered.
    if (key === 'spMember') return x.spMember == null ? '' : (x.spMember ? 'Yes' : 'No');
    if (key === 'ndxMember') return x.ndxMember == null ? '' : (x.ndxMember ? 'Yes' : 'No');
    if (key === 'indexMember') return indexLabel(x);
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
  // `ActionRules.ACTIONS` RUNS WORST-FIRST (Very Weak → Very Strong), so
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
  // ---- index membership: ONE cut, two indexes ----------------------------
  // (2026-10-08, owner: "single Index picker".) The S&P 500 and the Nasdaq 100
  // are each a three-state flag on the row -- true, false, or null where no
  // holdings file has been imported -- and every surface that narrows by
  // index asks THIS function, so the screener, the pivot and a screen the
  // server runs cannot disagree about what a cut means.
  //
  // `=== true` / `=== false`, NEVER truthy: a null is not a No. An unchecked
  // row is in no cut but All. `ndxonly` and `neither` therefore need BOTH
  // flags known, because each asserts an absence.
  const INDEX_CUTS = [
    ['All', 'All stocks'], ['in', 'S&P 500'], ['ndx', 'Nasdaq 100'],
    ['either', 'In either index'], ['ndxonly', 'Nasdaq 100, not S&P 500'],
    ['neither', 'In neither index'],
  ];
  // `Yes` / `No` are what the screener's picker stored before it knew two
  // indexes; `out` (not in the S&P 500) is still understood, not offered.
  function normIndexCut(v) {
    if (v === 'Yes') return 'in';
    if (v === 'No' || v === 'out') return 'out';
    return INDEX_CUTS.some((c) => c[0] === v) ? v : 'All';
  }
  function indexCutIs(x, cut) {
    const sp = x ? x.spMember : null, nd = x ? x.ndxMember : null;
    switch (cut) {
      case 'in': return sp === true;
      case 'out': return sp === false;
      case 'ndx': return nd === true;
      case 'either': return sp === true || nd === true;
      case 'ndxonly': return nd === true && sp === false;
      case 'neither': return sp === false && nd === false;
      default: return true;
    }
  }
  // What the Index column shows. Blank where it cannot be said: "Neither"
  // is a claim about both indexes, so it needs both files.
  function indexLabel(x) {
    const sp = x ? x.spMember : null, nd = x ? x.ndxMember : null;
    if (sp === true && nd === true) return 'S&P 500 · Nasdaq 100';
    if (sp === true) return 'S&P 500';
    if (nd === true) return 'Nasdaq 100';
    return sp === false && nd === false ? 'Neither' : '';
  }

  function screenRows(def, rows, ctx) {
    const d = def || {};
    const list = (rows || []).filter((x) => x && !x.error);
    const tests = [];
    for (const [key, src] of Object.entries(d.filters || {})) {
      const fn = compileFilter(key, src);
      if (fn) tests.push([key, fn]);
    }
    // Sector, industry, size and the Signal may each hold several values joined by "|"
    // (the screener's multi-choice pickers, 2026-10-15); a single value reads
    // as before. Size was stored on screens and never applied here until then.
    const anyOf = (s) => { const set = new Set(String(s).split('|')); return (v) => set.has(v); };
    if (d.sector && d.sector !== 'All') tests.push(['sector', anyOf(d.sector)]);
    if (d.industry && d.industry !== 'All') tests.push(['industry', anyOf(d.industry)]);
    if (d.size && d.size !== 'All') tests.push(['capBand', anyOf(d.size)]);
    if (d.advice && d.advice !== 'All') tests.push(['av:Balanced', anyOf(d.advice)]);
    let out = list.filter((x) => tests.every(([key, fn]) => fn(filterValue(x, key, ctx))));
    // A screen's index cut. It was stored and never applied here, so a screen
    // the server ran (the phone, a promo card) ignored it.
    const ic = normIndexCut(d.sp);
    if (ic !== 'All') out = out.filter((x) => indexCutIs(x, ic));
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

  // ---- a card's own question, as a screen a link can open (2026-10-14) ----------
  //
  // A posted card is a picture: nothing on it can be clicked. So a card that
  // picks companies by a rule prints a link, and the screener opens that link
  // as a screen. THE RULE IS DEFINED HERE ONCE and both read it: the card
  // chooses its companies with screenRows(cardScreen(...).def), and the
  // screener applies the very same definition. They cannot disagree about who
  // is in it.
  //
  // `q` is the link's query, as plain strings. Every value is checked against
  // a short list; anything else falls back to the default, so a hand-edited
  // link can only ever ask one of the questions the card can ask.
  const PULLBACK = {
    down: ['3', '5', '8'],                       // fell at least this far today, %
    band: ['0..5', '0..10', '-3..10'],           // where it now sits against its 200-day average, %
    fly: ['0', '50'],                            // 50: had risen at least 50% over the year
  };
  // Strong uptrend, still well off the high (2026-10-27): the saved screen
  // upofhigh as a card's rule, the S&P cut its only choice. The filters, sort
  // and columns are the stored screen's (server.js STARTER_SCREENS,
  // add-screen.js); a test holds the three to one definition.
  const UPOFF_FILTERS = { actionTrend: 'Strong uptrend', pctFromHigh: '<=-30' };
  const UPOFF_COLUMNS = ['pctFromHigh', 'vs200ma', 'oneMonthPct', 'threeMonthPct', 'range52Pos', 'actionTrend', 'av:Balanced', 'spMember'];
  function upOffHigh(o) {
    const sp = INDEX_CUTS.some(([k]) => k === o.sp) ? o.sp : 'All';
    return {
      name: 'Strong uptrend, still well off the high',
      params: { sp },
      def: { filters: Object.assign({}, UPOFF_FILTERS), sp, sort: { key: 'pctFromHigh', dir: 1 }, columns: UPOFF_COLUMNS.slice() },
      query: 'card=upofhigh&sp=' + sp,
    };
  }
  // Recent 52-week lows (2026-10-28): the saved screen rec52lo0 as a card's
  // rule, with the index cut and company size, which the stored screen does
  // not have (the owner: "Add a filter for company size too to reduce the
  // list", then "The company size filter should match the screener"). Size is
  // the screener's own: any of the six bands, ticked freely, '|'-joined in the
  // definition as the screener's size picker stores it. In the link and a
  // saved post it is comma-joined, or 'All'. Nothing given: Mega, Large and
  // Mid-Large ($10B and up). The first build's floors ('2B', '10B', '50B')
  // are still read, so links printed with them keep working. Filters, sort
  // and columns are the stored screen's; a test holds them to one definition.
  const REC52LO_FILTERS = { daysSince52wLow: '..4' };
  const REC52LO_COLUMNS = ['daysSince52wLow', 'pctFromLow', 'oneMonthPct', 'threeMonthPct', 'actionTrend', 'av:Balanced', 'spMember'];
  const OLD_FLOORS = { '2B': 2e9, '10B': 10e9, '50B': 50e9 };
  const LOWS_SIZE = 'Mega,Large,Mid-Large';
  function sizeBands(v) {
    const s = v == null || v === '' ? LOWS_SIZE : String(v);
    if (s === 'All') return [];
    if (OLD_FLOORS[s]) return CAP_BANDS.filter((b) => b.min >= OLD_FLOORS[s]).map((b) => b.label);
    const want = new Set(s.split(/[,|]/));
    const out = CAP_ORDER.filter((b) => want.has(b));
    // An unreadable list is the default rather than every size; all six is every size.
    if (!out.length) return sizeBands(LOWS_SIZE);
    return out.length === CAP_ORDER.length ? [] : out;
  }
  function recentLows(o) {
    const sp = INDEX_CUTS.some(([k]) => k === o.sp) ? o.sp : 'All';
    const bands = sizeBands(o.size);
    const size = bands.length ? bands.join(',') : 'All';
    const def = { filters: Object.assign({}, REC52LO_FILTERS), sp, sort: { key: 'oneMonthPct', dir: 1 }, columns: REC52LO_COLUMNS.slice() };
    if (bands.length) def.size = bands.join('|');
    return { name: 'Recent 52-week lows', params: { sp, size, bands }, def, query: 'card=rec52lo0&sp=' + sp + '&size=' + size };
  }
  function cardScreen(kind, q) {
    const o = q || {};
    if (kind === 'upofhigh') return upOffHigh(o);
    if (kind === 'rec52lo0') return recentLows(o);
    if (kind !== 'pullback') return null;
    const pick = (k, d) => (PULLBACK[k].includes(String(o[k])) ? String(o[k]) : d);
    const down = pick('down', '5'), band = pick('band', '0..10'), fly = pick('fly', '0');
    const sp = INDEX_CUTS.some(([k]) => k === o.sp) ? o.sp : 'All';
    const filters = { todayPct: '<=-' + down, vs200ma: band };
    if (fly !== '0') filters.oneYearPct = '>=' + fly;
    return {
      name: 'Pulled back toward the 200-day',
      params: { down, band, fly, sp },
      def: { filters, sp, sort: { key: 'todayPct', dir: 1 } },
      query: 'card=pullback&down=' + down + '&band=' + band + '&fly=' + fly + '&sp=' + sp,
    };
  }

  return {
    PULLBACK, cardScreen,
    RATING_FOR, TEXT_KEYS, CAT_KEYS, SCREEN_ONLY_KEYS, BOUND_KEYS, BLANK,
    CAP_BANDS, CAP_ORDER, CAP_RANGE, capBandOf, holderDays, LOWS_SIZE,
    DD_STATES, DD_ORDER, DD_RANGE, DD_MIN_HISTORY, ddStateOf,
    maCrossWord, filterValue, filterKind, parseNumTerm,
    adviceMove, adviceMoveIs, MOVES,
    compileNum, compileText, compileFilter, screenRows,
    INDEX_CUTS, normIndexCut, indexCutIs, indexLabel,
  };
});
