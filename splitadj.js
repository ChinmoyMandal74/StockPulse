// Putting two periods' share counts on one footing across a stock split.
//
// (2026-10-16.) The 13F and N-PORT loaders compare a holder's shares this
// period with last period's. A 10-for-1 split between the two turns every
// holder of that stock into a buyer of nine times what they held: the change
// columns, the new buyers and sellers lists and every holder's book would all
// say so. So last period's shares are multiplied by the splits dated after
// last period's date and on or before this period's (`f` is new shares per
// old, as the splits table stores it: 10 for a 10-for-1, 0.1 for a 1-for-10).
// Pure: no network, no database.
(function (root) {
  'use strict';

  // The product of the splits in (from, to]. 1 when there are none, or when
  // either date is missing (nothing can be said, so nothing is changed).
  function factor(list, from, to) {
    if (!list || !list.length || !from || !to) return 1;
    let f = 1;
    for (const s of list) if (s.d > from && s.d <= to && s.f > 0 && isFinite(s.f)) f *= s.f;
    return f;
  }

  // prev: Map symbol -> Map holderId -> holding. Returns a copy whose shares
  // are on this period's footing. fromOf(sym, id, h) and toOf(sym, id, h)
  // give the two dates for one holding (one date each for a 13F quarter; a
  // fund's own report dates for N-PORT). The holding's other fields, value
  // included, are kept as they were: a value is in dollars and a split does
  // not change it. `adjusted` counts the holdings that moved.
  function adjustPrev(prev, splitsBySym, fromOf, toOf) {
    if (!prev) return { prev, adjusted: 0, symbols: [] };
    const out = new Map();
    let adjusted = 0;
    const symbols = new Set();
    for (const [sym, holders] of prev) {
      const list = splitsBySym.get(sym);
      if (!list || !list.length) { out.set(sym, holders); continue; }
      const m = new Map();
      for (const [id, h] of holders) {
        const f = factor(list, fromOf(sym, id, h), toOf(sym, id, h));
        if (f !== 1) { m.set(id, Object.assign({}, h, { shares: h.shares * f })); adjusted++; symbols.add(sym); }
        else m.set(id, h);
      }
      out.set(sym, m);
    }
    return { prev: out, adjusted, symbols: [...symbols] };
  }

  // NOT EVERY "SPLIT" CHANGED THE SHARE COUNT. The provider's list carries
  // spin-offs as price-adjustment factors too (FedEx 1.241 and Honeywell
  // 0.9535 in Q2 2026, against 25-for-1 at Booking and 10-for-1 at KLA), and
  // multiplying a holding by one of those invents a trade. So the holders
  // decide: among those that held the stock in both periods, the median of
  // this period's shares over last period's sits near the factor after a real
  // split and near 1 after a spin-off. A factor is kept when that median is
  // within `tol` of it and clearly away from 1; the rest are dropped and
  // reported. Fewer than `min` holders in both periods: nothing to go on,
  // so the factor is dropped too.
  //   cur, prev:  Map symbol -> Map holderId -> holding
  //   win(sym):   the [from, to] window the factor is taken over
  function confirmed(cur, prev, splitsBySym, win, opts) {
    const o = opts || {};
    const tol = o.tol || 0.15, min = o.min || 5;
    const keep = new Map(), report = [];
    for (const [sym, list] of splitsBySym) {
      const [from, to] = win(sym);
      const f = factor(list, from, to);
      const c = cur && cur.get(sym), p = prev && prev.get(sym);
      const ratios = [];
      if (c && p) for (const [id, h] of c) { const was = p.get(id); if (was && was.shares > 0 && h.shares > 0) ratios.push(h.shares / was.shares); }
      ratios.sort((a, b) => a - b);
      const med = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2) : null;
      // NEARER THE FACTOR THAN TO 1, as well as within `tol` of it. A factor
      // close to 1 (S&P Global's 1.057, Unilever's 0.888 in the 2026 fund
      // sets) is within 15% of an unchanged count too, and the first version
      // applied both. In log terms the median must sit closer to f than to 1.
      const ok = med != null && med > 0 && ratios.length >= min && Math.abs(f - 1) > 0.02 && Math.abs(med / f - 1) <= tol
        && Math.abs(Math.log(med / f)) < Math.abs(Math.log(med));
      report.push({ sym, f, med, n: ratios.length, kept: ok });
      if (ok) keep.set(sym, list);
    }
    return { splits: keep, report };
  }

  const api = { factor, adjustPrev, confirmed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitAdj = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
