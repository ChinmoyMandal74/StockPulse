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
  // o.priceOf(sym)     one price for the stock (optional): what a change in
  //                    shares is valued at, the same for both periods, so
  //                    buying and selling are not confused with the price moving
  // -> Map key -> { key, name, family, asOf, nav, pos: [{ s, sh, v, p }], gone: [{ s, p }] }
  //    p is last period's shares: null where there is no earlier period at
  //    all, 0 where there is one and the holder did not hold the stock.
  function invert(cur, prev, o) {
    const books = new Map();
    // ONLY WHAT CAN BE COMPARED (2026-10-16). A holder with no report at all
    // in the earlier set (a late or missing filing) would read as buying
    // everything it holds, and a stock nobody held in the earlier set (a new
    // listing, such as SpaceX in Q2 2026) as every holder buying it. Neither
    // is a trade, so such a position's last-period shares are null: it is
    // left out of new, gone, bought and sold, as if there were no earlier
    // period for it.
    const prevIds = new Set();
    if (prev) for (const holders of prev.values()) for (const id of holders.keys()) prevIds.add(id);
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
        const pxo = o.priceOf ? o.priceOf(sym) : null;
        const px = pxo > 0 ? pxo : (v > 0 && sh > 0 ? v / sh : null);
        const comparable = before && before.size > 0 && prevIds.has(id);
        bookOf(id, h).pos.push({ s: sym, sh, v: v != null && isFinite(v) && v >= 0 ? v : null, p: comparable ? (was ? o.sharesOf(was) : 0) : null, px });
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
          const pxo = o.priceOf ? o.priceOf(sym) : null;
          if (b && o.sharesOf(h) > 0) b.gone.push({ s: sym, p: o.sharesOf(h), px: pxo > 0 ? pxo : null });
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
    // BOUGHT AND SOLD IN TRACKED STOCKS (2026-10-16): each position's change
    // in shares at ONE price for the stock (this period's), so the figure
    // is the holder's trading and not the market's move; an exit counts its
    // whole last-period holding as sold. A position with no price is left
    // out of both. Null where there is no earlier period.
    let bought = null, sold = null;
    if (hadPrev) {
      bought = 0; sold = 0;
      for (const p of pos) { if (p.p == null || !(p.px > 0)) continue; const d = (p.sh - p.p) * p.px; if (d > 0) bought += d; else sold -= d; }
      for (const g of b.gone) if (g.px > 0) sold += g.p * g.px;
    }
    return { key: b.key, name: b.name, family: b.family, asOf: b.asOf, nav: b.nav,
      positions: pos.length, value, bought, sold,
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

  // The period's net buyers and sellers among the finished books: the N
  // largest each way by bought less sold, at constant prices. Null when no
  // book could be compared with an earlier period.
  function flowList(books, label, period, prevPeriod, n) {
    const rows = (books || []).filter((b) => b.bought != null && b.sold != null)
      // Turnover: bought plus sold as a share of what it holds now. Shown, not
      // filtered on: a holder that turned over half its book in a quarter is
      // more often a trading book or a change in how it files than an investor
      // acting, and the reader can see that and weigh it.
      .map((b) => ({ id: b.key, name: b.name, net: b.bought - b.sold, bought: b.bought, sold: b.sold, value: b.value,
        turnover: b.value > 0 ? (b.bought + b.sold) / b.value * 100 : null }));
    if (!rows.length) return null;
    const k = n || 100;
    return { label, period, prevPeriod, holders: rows.length,
      buyers: rows.filter((r) => r.net > 0).sort((a, b) => b.net - a.net).slice(0, k),
      sellers: rows.filter((r) => r.net < 0).sort((a, b) => a.net - b.net).slice(0, k) };
  }

  const api = { CAP, EXITS, invert, finish, view, flowList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HolderBook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
