// A holder's book: everything one institutional manager or one fund holds
// among the tracked stocks, turned round from the per-stock data the two
// quarterly loaders already build. Pure: no network, no database.
//
// (2026-10-12, the owner: "We now have institutional and fund holders at the
// stock level, can you create page for each of these different entities so
// that I can see what they hold".) The stock page answers "who holds this";
// this answers "what does this one hold".
//
// ONLY THE TRACKED STOCKS. A manager's 13F lists every US security it holds
// and a fund's report its whole portfolio; what is kept here is the part of
// each that is a stock on the screen. So a book's total is "held in tracked
// stocks", never the manager's or the fund's size, and every surface says so.
//
// THE SAME RULES AS THE STOCK SIDE, because it is the same rows: for 13F a
// position is valued at the stock's one quarter-end price (the median the
// managers themselves implied) and not at the dollars a manager filed, some
// of whom file in thousands; a position larger than the whole company is a
// units error and is left out. The loader hands those two decisions in, so
// this module cannot disagree with the stock page about them.
//
// A BOOK IS STORED CAPPED. The largest positions by value are kept (CAP);
// the count and the total are of all of them, so the page can say "the 250
// largest of 1,912".
(function (root) {
  'use strict';

  const CAP = 250;
  const EXITS = 40;

  // cur, prev:  Map symbol -> Map holderId -> holding (whatever the loader has)
  // o.keyOf(id)        the stored id for a holder
  // o.sharesOf(h)      shares in a holding
  // o.valueOf(sym, h)  its value in dollars, or null
  // o.keep(sym, h)     false to leave a position out (the units guard)
  // o.meta(id, h)      { name, family, asOf, nav } for the holder
  // -> Map key -> { key, name, family, asOf, nav, pos: [{ s, sh, v, p }], gone: [{ s, p }] }
  //    p is last period's shares: null where there is no earlier period at
  //    all, 0 where there is one and the holder did not hold the stock.
  function invert(cur, prev, o) {
    const books = new Map();
    const bookOf = (id, h) => {
      const key = o.keyOf(id);
      let b = books.get(key);
      if (!b) { const m = o.meta(id, h) || {}; books.set(key, b = { key, name: m.name || 'Unnamed', family: m.family || null, asOf: m.asOf || null, nav: m.nav > 0 ? m.nav : null, pos: [], gone: [] }); }
      return b;
    };
    for (const [sym, holders] of cur || new Map()) {
      const before = prev ? prev.get(sym) || new Map() : null;
      for (const [id, h] of holders) {
        if (o.keep && !o.keep(sym, h)) continue;
        const sh = o.sharesOf(h);
        if (!(sh > 0)) continue;
        const was = before ? before.get(id) : null;
        const v = o.valueOf(sym, h);
        bookOf(id, h).pos.push({ s: sym, sh, v: v != null && isFinite(v) && v >= 0 ? v : null, p: before ? (was ? o.sharesOf(was) : 0) : null });
      }
    }
    // What a holder had last period and has none of now. Only for a holder
    // that still has a book: one that vanished altogether has no page.
    if (prev) {
      for (const [sym, holders] of prev) {
        const now = (cur && cur.get(sym)) || new Map();
        for (const [id, h] of holders) {
          if (now.has(id)) continue;
          const b = books.get(o.keyOf(id));
          if (b && o.sharesOf(h) > 0) b.gone.push({ s: sym, p: o.sharesOf(h) });
        }
      }
    }
    return books;
  }

  // One book -> the row that is stored.
  function finish(b, cap) {
    const pos = b.pos.slice().sort((x, y) => (y.v || 0) - (x.v || 0) || y.sh - x.sh || (x.s < y.s ? -1 : 1));
    const valued = pos.filter((p) => p.v != null);
    const value = valued.length ? valued.reduce((s, p) => s + p.v, 0) : null;
    const hadPrev = pos.some((p) => p.p != null) || b.gone.length > 0;
    return { key: b.key, name: b.name, family: b.family, asOf: b.asOf, nav: b.nav,
      positions: pos.length, value,
      added: hadPrev ? pos.filter((p) => p.p === 0).length : null,
      exited: hadPrev ? b.gone.length : null,
      data: { pos: pos.slice(0, cap || CAP).map((p) => [p.s, p.sh, p.v == null ? null : Math.round(p.v), p.p]),
        gone: b.gone.slice().sort((x, y) => y.p - x.p).slice(0, EXITS).map((g) => [g.s, g.p]) } };
  }

  // The stored row + what the screen knows of each stock -> the page's rows.
  // `rowOf(sym)` gives { name, sector, sharesOutstanding, marketCap } or null;
  // a stock no longer tracked is dropped rather than shown as a bare symbol.
  function view(book, rowOf) {
    const total = book.value > 0 ? book.value : null;
    const pos = [];
    for (const [s, sh, v, p] of (book.data && book.data.pos) || []) {
      const r = rowOf(s);
      if (!r) continue;
      pos.push({ symbol: s, name: r.name || null, sector: r.sector || null, shares: sh, value: v,
        // Of what this holder has in tracked stocks, not of the holder.
        ofBook: v != null && total ? v / total * 100 : null,
        // Of the fund's net assets, where it is a fund that reported them.
        ofFund: v != null && book.nav > 0 ? v / book.nav * 100 : null,
        ofCompany: sh > 0 && r.sharesOutstanding > 0 && sh <= r.sharesOutstanding ? sh / r.sharesOutstanding * 100 : null,
        isNew: p === 0, change: p > 0 ? (sh / p - 1) * 100 : null });
    }
    const gone = [];
    for (const [s, p] of (book.data && book.data.gone) || []) { const r = rowOf(s); if (r) gone.push({ symbol: s, name: r.name || null, shares: p }); }
    const bySector = new Map();
    for (const x of pos) if (x.value != null) bySector.set(x.sector || 'Other', (bySector.get(x.sector || 'Other') || 0) + x.value);
    const shown = pos.reduce((s, x) => s + (x.value || 0), 0);
    return { positions: pos, gone,
      sectors: [...bySector].map(([name, value]) => ({ name, value, pct: shown > 0 ? value / shown * 100 : null })).sort((a, b) => b.value - a.value) };
  }

  const api = { CAP, EXITS, invert, finish, view };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HolderBook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
