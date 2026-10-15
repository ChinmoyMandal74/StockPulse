// Paper positions: the arithmetic and nothing else (2026-10-15, owner's
// request for a "mock trade feature"). No database, no network, so every rule
// here is testable on its own; server.js reads the ledger and the prices and
// hands them over.
//
// A SIMULATION, AND SAID IN THE SITE'S OWN WORDS. A member OPENS and CLOSES a
// position with pretend money; nothing here is called buying or selling (the
// project's wording rule) and nothing here is advice. The Signal never reads
// any of it.
//
// THE LEDGER IS THE TRUTH. Every open and every close is one appended row;
// cash, positions, closed trades and the history are all worked out from it
// here, so no stored figure can drift from the trades that made it. Cost is
// the AVERAGE cost of the shares held: a part-close takes its share of the
// cost and leaves the average of the rest unchanged.
(function (root) {
  'use strict';

  const START_CASH = 100000;
  const EPS = 1e-9;
  const round = (v, d) => { const k = Math.pow(10, d); return Math.round(v * k) / k; };

  // The New York trading day a timestamp falls on: a fill at 8pm Eastern is
  // that day, not the next UTC one.
  const nyDay = (ms) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(ms));
    } catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  };

  // Replay the ledger. `prices` maps a symbol to { price, pricedAt, name } for
  // what the site holds now; a symbol missing from it is no longer tracked and
  // is valued at its last traded price, and says so.
  function summarise(account, trades, prices) {
    const acct = account || { start_cash: START_CASH, started_at: Date.now() };
    const startCash = Number(acct.start_cash) || START_CASH;
    let cash = startCash;
    const pos = new Map();
    const closed = [];
    const list = (trades || []).slice().sort((a, b) => a.id - b.id);
    for (const t of list) {
      const sh = Number(t.shares), px = Number(t.price);
      if (!(sh > 0) || !(px > 0)) continue;
      const p = pos.get(t.symbol) || { symbol: t.symbol, shares: 0, cost: 0, openedAt: t.ts, signal: t.signal || null, lastPrice: px };
      if (t.kind === 'open') {
        if (p.shares < EPS) { p.openedAt = t.ts; p.signal = t.signal || null; p.cost = 0; }
        p.shares += sh; p.cost += sh * px; cash -= sh * px;
      } else if (t.kind === 'close') {
        const take = Math.min(sh, p.shares);
        if (take < EPS) continue;
        const avg = p.cost / p.shares;
        p.cost -= avg * take; p.shares -= take; cash += take * px;
        closed.push({ id: t.id, symbol: t.symbol, shares: take, entry: avg, exit: px,
          pnl: take * (px - avg), ret: px / avg - 1, openedAt: p.openedAt, closedAt: t.ts,
          days: Math.max(0, Math.round((t.ts - p.openedAt) / 86400000)), note: t.note || null });
      }
      p.lastPrice = px;
      if (p.shares < EPS) pos.delete(t.symbol); else pos.set(t.symbol, p);
    }
    const positions = [...pos.values()].map((p) => {
      const now = prices && prices[p.symbol];
      const tracked = !!(now && now.price > 0);
      const price = tracked ? Number(now.price) : p.lastPrice;
      const value = p.shares * price;
      const avg = p.cost / p.shares;
      return { symbol: p.symbol, name: (now && now.name) || null, shares: p.shares, avgCost: avg, cost: p.cost,
        price, pricedAt: tracked ? (now.pricedAt || null) : null, tracked, value,
        gain: value - p.cost, gainPct: price / avg - 1, openedAt: p.openedAt, signal: p.signal };
    }).sort((a, b) => b.value - a.value);
    const invested = positions.reduce((s, p) => s + p.value, 0);
    const equity = cash + invested;
    return {
      startCash, startedAt: Number(acct.started_at) || null, cash, invested, equity,
      ret: equity / startCash - 1,
      positions, closed: closed.reverse(),
    };
  }

  // What can be opened: `dollars` (fractional shares allowed) or `shares`,
  // against the cash there is. Returns { shares } or { error }.
  function sizeOpen(req, price, cash) {
    const px = Number(price);
    if (!(px > 0)) return { error: 'There is no current price for this stock.' };
    let shares;
    if (req && req.dollars != null && req.dollars !== '') {
      const d = Number(req.dollars);
      if (!(d >= 1)) return { error: 'Enter an amount of at least $1.' };
      shares = d / px;
    } else if (req && req.shares != null && req.shares !== '') {
      shares = Number(req.shares);
      if (!(shares > 0)) return { error: 'Enter a number of shares above zero.' };
    } else return { error: 'Enter an amount or a number of shares.' };
    shares = round(shares, 6);
    const cost = shares * px;
    if (cost > cash + 0.005) return { error: 'That is more than the $' + cash.toFixed(2) + ' of paper cash left.' };
    if (!(shares > 0)) return { error: 'That is less than a millionth of a share.' };
    return { shares, cost };
  }

  // How much of a held position to close: `all`, or a number of shares no
  // more than are held.
  function sizeClose(req, held) {
    if (!(held > EPS)) return { error: 'There is no open position in this stock.' };
    if (!req || req.all || req.shares == null || req.shares === '') return { shares: held };
    const s = Number(req.shares);
    if (!(s > 0)) return { error: 'Enter a number of shares above zero.' };
    if (s > held + 1e-6) return { error: 'Only ' + round(held, 6) + ' shares are open.' };
    return { shares: Math.min(s, held) };
  }

  // The account's value at each close since it started, beside the S&P 500
  // (SPY) bought with the same starting cash on the same day. `closes` maps a
  // symbol to [{ d, c }] oldest first; `bench` is SPY's. A held stock with no
  // close on a day is carried at its last known close, or its fill price
  // before it has one.
  function history(account, trades, closes, bench) {
    const startCash = Number(account && account.start_cash) || START_CASH;
    const startDay = nyDay(Number(account && account.started_at) || Date.now());
    const days = (bench || []).filter((b) => b.d >= startDay && b.c > 0);
    if (!days.length) return [];
    const list = (trades || []).slice().sort((a, b) => a.id - b.id);
    const idx = {};
    const last = {};
    let ti = 0, cash = startCash;
    const held = {};
    const base = days[0].c;
    const out = [];
    for (const b of days) {
      while (ti < list.length && nyDay(list[ti].ts) <= b.d) {
        const t = list[ti++];
        const sh = Number(t.shares), px = Number(t.price);
        if (t.kind === 'open') { held[t.symbol] = (held[t.symbol] || 0) + sh; cash -= sh * px; }
        else if (t.kind === 'close') { const take = Math.min(sh, held[t.symbol] || 0); held[t.symbol] = (held[t.symbol] || 0) - take; cash += take * px; }
        if (last[t.symbol] == null) last[t.symbol] = px;
      }
      let value = cash;
      for (const [sym, sh] of Object.entries(held)) {
        if (!(sh > EPS)) continue;
        const series = closes[sym] || [];
        let i = idx[sym] || 0;
        while (i < series.length && series[i].d <= b.d) { last[sym] = series[i].c; i++; }
        idx[sym] = i;
        value += sh * (last[sym] || 0);
      }
      out.push({ d: b.d, value: round(value, 2), bench: round(startCash * b.c / base, 2) });
    }
    return out;
  }

  const api = { summarise, sizeOpen, sizeClose, history, nyDay, START_CASH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Paper = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
