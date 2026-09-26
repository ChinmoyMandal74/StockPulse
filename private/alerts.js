// The alert types, defined ONCE — loaded by /alerts in the browser and
// `require`d by server.js for the evaluation pass. The same reason
// `filters.js`, `action.js`, `rowcard.js` and `cards.js` exist: a second copy
// of "what does 'crossed above its 200-day' mean" would drift inside a week.
//
// THE OWNER CHOSE A FIXED DROPDOWN over the filter grammar (docs/backlog.md
// 12). That is a decision about the UI, and it is deliberately NOT a decision
// about the data layer: every type below reads its value through
// `Filters.filterValue(row, key)`, so "price above 150" here and `>150` typed
// into the screener's Price column ask the same function the same question.
// Add a type by adding an entry — never by reading a row field directly.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  root.Alerts = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const F = () => (typeof globalThis !== 'undefined' && globalThis.Filters) || null;

  // ---- the two rules every type obeys --------------------------------------
  //
  // 1. A BLANK SATISFIES NOTHING. `Number(null)` is 0 and `Number.isFinite(0)`
  //    is true, so the obvious coercion turns a missing price into a stock
  //    trading at zero and fires every "below $150" alert at once. This
  //    codebase has met that in `num()`, in the credits header and in
  //    `activity.ms`. Reject the empty BEFORE coercing.
  // 2. A side of `null` means NOT EVALUABLE, which is different from "the
  //    condition is false". A null never fires and never overwrites a
  //    remembered side.
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // The reading, always through the shared grammar.
  function read(row, key) {
    const f = F();
    return f && f.filterValue ? f.filterValue(row, key, {}) : row[key];
  }

  const money = (n) => '$' + Number(n).toFixed(2);
  const pct = (n) => (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%';

  // ---- the types ------------------------------------------------------------
  // side(row, p)  -> 'a' | 'b' | null     the discrete state this round
  // fires(from,to)-> boolean              which transitions are worth saying
  // label(p)      -> the alert as a sentence
  // body(row,p,from,to) -> what happened, as a FACT. Never an instruction:
  //                       "NVDA crossed above its 200-day", never "NVDA is a buy".
  const TYPES = {
    price: {
      name: 'Price level',
      blurb: 'When the price crosses a number you choose.',
      fields: [{ k: 'dir', t: 'dir', label: 'Direction', opts: [['above', 'rises above'], ['below', 'falls below']] },
               { k: 'value', t: 'num', label: 'Price', placeholder: '150', min: 0 }],
      defaults: { dir: 'above', value: null },
      valid: (p) => num(p.value) !== null && num(p.value) > 0 && (p.dir === 'above' || p.dir === 'below'),
      // The side is the SIGN of (price - threshold), which is what makes a gap
      // work: 140 -> 160 never touched 150, and still crossed it.
      side(row, p) {
        const v = num(read(row, 'price'));
        const t = num(p.value);
        if (v === null || t === null) return null;
        return v >= t ? 'a' : 'b';
      },
      fires: (from, to, p) => (p.dir === 'above' ? from === 'b' && to === 'a' : from === 'a' && to === 'b'),
      label: (p) => `Price ${p.dir === 'above' ? 'rises above' : 'falls below'} ${money(p.value || 0)}`,
      body(row, p) {
        const v = num(read(row, 'price'));
        return `${row.symbol} ${p.dir === 'above' ? 'rose above' : 'fell below'} ${money(p.value)} `
          + `— now ${money(v)}.`;
      },
    },

    ma: {
      name: 'Moving-average cross',
      blurb: 'When the price crosses its 50-day or 200-day average.',
      fields: [{ k: 'ma', t: 'dir', label: 'Average', opts: [['200', '200-day'], ['50', '50-day']] },
               { k: 'dir', t: 'dir', label: 'Direction', opts: [['above', 'crosses above'], ['below', 'crosses below']] }],
      defaults: { ma: '200', dir: 'above' },
      valid: (p) => (p.ma === '50' || p.ma === '200') && (p.dir === 'above' || p.dir === 'below'),
      // vs50ma / vs200ma are the percentage distance from the average, so zero
      // is the crossing point and the sign is the side.
      side(row, p) {
        const v = num(read(row, p.ma === '50' ? 'vs50ma' : 'vs200ma'));
        if (v === null) return null;
        return v >= 0 ? 'a' : 'b';
      },
      fires: (from, to, p) => (p.dir === 'above' ? from === 'b' && to === 'a' : from === 'a' && to === 'b'),
      label: (p) => `Price crosses ${p.dir} its ${p.ma}-day average`,
      body(row, p) {
        const v = num(read(row, p.ma === '50' ? 'vs50ma' : 'vs200ma'));
        const price = num(read(row, 'price'));
        return `${row.symbol} crossed ${p.dir} its ${p.ma}-day average`
          + (price !== null ? ` — ${money(price)}` : '')
          + (v !== null ? `, ${Math.abs(v).toFixed(1)}% ${v >= 0 ? 'above' : 'below'} it.` : '.');
      },
    },

    verdict: {
      name: 'Advice verdict change',
      blurb: 'When the Balanced rules read this stock differently than they did.',
      fields: [{ k: 'dir', t: 'dir', label: 'Direction',
                 opts: [['any', 'changes either way'], ['up', 'is upgraded'], ['down', 'is downgraded']] }],
      defaults: { dir: 'any' },
      valid: (p) => ['any', 'up', 'down'].includes(p.dir),
      // The verdict IS the side: any change of word is a transition, so the
      // generic edge detector handles it with no special case.
      side: (row) => (row.action ? String(row.action) : null),
      fires(from, to, p) {
        if (p.dir === 'any') return true;
        const L = (typeof globalThis !== 'undefined' && globalThis.ActionRules
          && globalThis.ActionRules.ACTIONS) || null;
        if (!L) return false;
        // ACTIONS RUNS WORST-FIRST, so an upgrade is an INCREASE in index.
        // Reading the display order labels every upgrade a downgrade.
        const a = L.indexOf(from); const b = L.indexOf(to);
        if (a < 0 || b < 0) return false;
        return p.dir === 'up' ? b > a : b < a;
      },
      label: (p) => `Advice ${p.dir === 'any' ? 'changes' : p.dir === 'up' ? 'is upgraded' : 'is downgraded'}`,
      body: (row, p, from, to) => `${row.symbol} moved from ${from} to ${to}.`,
    },

    rsi: {
      name: 'RSI level',
      blurb: 'When RSI crosses a level — 70 and 30 are the usual two.',
      fields: [{ k: 'dir', t: 'dir', label: 'Direction', opts: [['above', 'rises above'], ['below', 'falls below']] },
               { k: 'value', t: 'num', label: 'RSI', placeholder: '70', min: 1, max: 99 }],
      defaults: { dir: 'above', value: 70 },
      valid: (p) => { const v = num(p.value); return v !== null && v > 0 && v < 100
        && (p.dir === 'above' || p.dir === 'below'); },
      side(row, p) {
        const v = num(read(row, 'rsi'));
        const t = num(p.value);
        if (v === null || t === null) return null;
        return v >= t ? 'a' : 'b';
      },
      fires: (from, to, p) => (p.dir === 'above' ? from === 'b' && to === 'a' : from === 'a' && to === 'b'),
      label: (p) => `RSI ${p.dir === 'above' ? 'rises above' : 'falls below'} ${num(p.value)}`,
      body(row, p) {
        const v = num(read(row, 'rsi'));
        return `${row.symbol} RSI ${p.dir === 'above' ? 'rose above' : 'fell below'} ${num(p.value)}`
          + (v !== null ? ` — now ${v.toFixed(1)}.` : '.');
      },
    },

    extreme: {
      name: '52-week high or low',
      blurb: 'When the stock sets a new 52-week extreme.',
      fields: [{ k: 'dir', t: 'dir', label: 'Which', opts: [['high', 'a new 52-week high'], ['low', 'a new 52-week low']] }],
      defaults: { dir: 'high' },
      valid: (p) => p.dir === 'high' || p.dir === 'low',
      // daysSince is 0 on the day the extreme was set, so "at it" vs "not at
      // it" is the side and the transition into it is the event.
      side(row, p) {
        const d = num(read(row, p.dir === 'high' ? 'daysSince52wHigh' : 'daysSince52wLow'));
        if (d === null) return null;
        return d <= 0 ? 'a' : 'b';
      },
      fires: (from, to) => from === 'b' && to === 'a',
      label: (p) => `Sets ${p.dir === 'high' ? 'a new 52-week high' : 'a new 52-week low'}`,
      body(row, p) {
        const price = num(read(row, 'price'));
        return `${row.symbol} set a new 52-week ${p.dir}`
          + (price !== null ? ` at ${money(price)}.` : '.');
      },
    },

    move: {
      name: 'Big day',
      blurb: 'When the stock moves more than you care about in one session.',
      fields: [{ k: 'dir', t: 'dir', label: 'Direction',
                 opts: [['either', 'up or down by'], ['up', 'up by'], ['down', 'down by']] },
               { k: 'value', t: 'num', label: 'Percent', placeholder: '5', min: 0.1, max: 100 }],
      defaults: { dir: 'either', value: 5 },
      valid: (p) => { const v = num(p.value); return v !== null && v > 0 && v <= 100
        && ['either', 'up', 'down'].includes(p.dir); },
      side(row, p) {
        const v = num(read(row, 'todayPct'));
        const t = num(p.value);
        if (v === null || t === null) return null;
        const hit = p.dir === 'up' ? v >= t : p.dir === 'down' ? v <= -t : Math.abs(v) >= t;
        return hit ? 'a' : 'b';
      },
      fires: (from, to) => from === 'b' && to === 'a',
      label: (p) => `Moves ${p.dir === 'either' ? 'up or down' : p.dir} by ${num(p.value)}% in a day`,
      body(row, p) {
        const v = num(read(row, 'todayPct'));
        return `${row.symbol} moved ${pct(v)} today, past your ${num(p.value)}% mark.`;
      },
    },
  };

  const ids = Object.keys(TYPES);
  const get = (kind) => TYPES[kind] || null;

  // Clean a submitted alert into what will be stored, or null if it is not a
  // usable alert. The route trusts this and nothing else — the prefs-PUT rule:
  // rebuild from scratch rather than filtering what arrived.
  function clean(input) {
    const t = get(input && input.kind);
    if (!t) return null;
    const p = {};
    for (const f of t.fields) {
      const v = input.params ? input.params[f.k] : undefined;
      if (f.t === 'num') {
        const n = num(v);
        if (n === null) return null;
        p[f.k] = n;
      } else {
        const ok = f.opts.some(([o]) => o === v);
        if (!ok) return null;
        p[f.k] = String(v);
      }
    }
    if (!t.valid(p)) return null;
    return { kind: input.kind, params: p, once: !!(input && input.once) };
  }

  const label = (a) => { const t = get(a.kind); return t ? t.label(a.params || {}) : a.kind; };

  // ---- the edge detector, shared by the evaluator and its tests -------------
  //
  // Returns what should happen to ONE alert this round:
  //   { side, fire, body }   side === null  -> not evaluable, change nothing
  //                          fire === false -> remember the side, say nothing
  //
  // The two cases that make this worth having in one place:
  //   * from === null is ARMING. An alert created while its condition is
  //     already true records the side and stays quiet, because announcing a
  //     crossing that did not happen is a false statement.
  //   * from === to is no transition at all. A level being true is not an
  //     event, or "price above 150" notifies every thirty minutes for ever.
  function evaluate(alert, row) {
    const t = get(alert.kind);
    if (!t || !row) return { side: null, fire: false, body: null };
    const to = t.side(row, alert.params || {});
    if (to === null) return { side: null, fire: false, body: null };
    const from = alert.lastSide == null ? null : alert.lastSide;
    if (from === null || from === to) return { side: to, fire: false, body: null };
    if (!t.fires(from, to, alert.params || {})) return { side: to, fire: false, body: null };
    return { side: to, fire: true, body: t.body(row, alert.params || {}, from, to) };
  }

  return { TYPES, ids, get, clean, label, evaluate, num };
});
