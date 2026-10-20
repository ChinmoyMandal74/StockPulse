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
  // A starting amount the member chooses (2026-10-20, the owner: "B and B").
  const MIN_CASH = 1000, MAX_CASH = 10000000;
  // How far back a position may be dated: the depth the account chart reads.
  const MAX_BACK_DAYS = 1460;
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

  // DATED ENTRIES (2026-10-20, the owner: "include entry date so that I can
  // input historical purchases"). A trade may carry `d`, the trading day it
  // is dated to; one without is dated to the New York day it was made. The
  // ledger is replayed in that order (day, then the order entered), so a past
  // entry takes its place in the history wherever it was typed in. `whenOf`
  // is the moment shown and measured: the trade's own time, or noon on its day.
  const dayOf = (t) => (t && t.d ? String(t.d) : nyDay(t.ts));
  const whenOf = (t) => (t && t.d ? Date.parse(String(t.d) + 'T12:00:00Z') : t.ts);
  const byDay = (a, b) => (dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : a.id - b.id);

  // Replay the ledger. `prices` maps a symbol to { price, pricedAt, name } for
  // what the site holds now; a symbol missing from it is no longer tracked and
  // is valued at its last traded price, and says so.
  function summarise(account, trades, prices) {
    const acct = account || { start_cash: START_CASH, started_at: Date.now() };
    const startCash = Number(acct.start_cash) || START_CASH;
    let cash = startCash;
    const pos = new Map();
    const closed = [];
    const list = (trades || []).slice().sort(byDay);
    for (const t of list) {
      const sh = Number(t.shares), px = Number(t.price);
      if (!(sh > 0) || !(px > 0)) continue;
      const p = pos.get(t.symbol) || { symbol: t.symbol, shares: 0, cost: 0, openedAt: whenOf(t), signal: t.signal || null, lastPrice: px };
      if (t.kind === 'open') {
        if (p.shares < EPS) { p.openedAt = whenOf(t); p.signal = t.signal || null; p.cost = 0; p.dated = !!t.d; p.split = false; }
        if (Number(t.split_k) > 0 && Number(t.split_k) !== 1) p.split = true;
        p.shares += sh; p.cost += sh * px; cash -= sh * px;
      } else if (t.kind === 'close') {
        const take = Math.min(sh, p.shares);
        if (take < EPS) continue;
        const avg = p.cost / p.shares;
        p.cost -= avg * take; p.shares -= take; cash += take * px;
        closed.push({ id: t.id, symbol: t.symbol, shares: take, entry: avg, exit: px,
          pnl: take * (px - avg), ret: px / avg - 1, openedAt: p.openedAt, closedAt: whenOf(t),
          days: Math.max(0, Math.round((whenOf(t) - p.openedAt) / 86400000)), note: t.note || null, dated: !!t.d });
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
        gain: value - p.cost, gainPct: price / avg - 1, openedAt: p.openedAt, signal: p.signal, dated: !!p.dated, splitAdjusted: !!p.split };
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
    const list = (trades || []).slice().sort(byDay);
    const idx = {};
    const last = {};
    let ti = 0, cash = startCash;
    const held = {};
    const base = days[0].c;
    const out = [];
    for (const b of days) {
      while (ti < list.length && dayOf(list[ti]) <= b.d) {
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

  // DOES THE WHOLE HISTORY STILL ADD UP with this ledger? Replayed in day
  // order: the cash may never go below zero and a close may never take more
  // than was held on its day. A past entry can break a later one (an earlier
  // open spends cash a later open had used), so this is asked of the whole
  // ledger, not of the new row alone. Returns null, or { error } naming the
  // first day it fails.
  function checkLedger(account, trades) {
    let cash = Number(account && account.start_cash) || START_CASH;
    const held = {};
    for (const t of (trades || []).slice().sort(byDay)) {
      const sh = Number(t.shares), px = Number(t.price);
      if (t.kind === 'open') {
        cash -= sh * px;
        held[t.symbol] = (held[t.symbol] || 0) + sh;
        if (cash < -0.005) return { error: 'On ' + dayOf(t) + ' that would spend more than the paper cash there was (' + fmtUsd(cash + sh * px) + ').' };
      } else if (t.kind === 'close') {
        if (sh > (held[t.symbol] || 0) + 1e-6) return { error: 'On ' + dayOf(t) + ' only ' + round(held[t.symbol] || 0, 6) + ' shares of ' + t.symbol + ' were open.' };
        held[t.symbol] -= sh; cash += sh * px;
      }
    }
    return null;
  }
  const fmtUsd = (v) => '$' + Math.max(0, v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Shares of a symbol held at the end of a day, for a dated close of "all".
  function heldOn(trades, symbol, day) {
    let h = 0;
    for (const t of (trades || []).slice().sort(byDay)) {
      if (dayOf(t) > day) break;
      if (t.symbol !== symbol) continue;
      h += t.kind === 'open' ? Number(t.shares) : -Number(t.shares);
    }
    return Math.max(0, round(h, 6));
  }
  // SPLITS SINCE A DAY. Stored prices are adjusted for every split since, so a
  // statement's figures from before one are on another footing: shares times
  // the factor, price divided by it. `splits` is [{ d, f }], f the shares
  // multiplier (10 for a 10-for-1).
  function splitFactor(splits, day) {
    let k = 1;
    for (const x of splits || []) if (x && String(x.d) > day && Number(x.f) > 0 && isFinite(Number(x.f))) k *= Number(x.f);
    return k;
  }
  // A PRICE ENTERED FOR A PAST DAY must lie within that day's low to high (on
  // today's split basis), with half a percent of room for rounding in the
  // adjusted figures. Blank takes the close. `bar` is { low, high, close }.
  function pricedOn(entered, bar, k) {
    const close = Number(bar && bar.close);
    if (!(close > 0)) return { error: 'There is no stored price for that day.' };
    if (entered == null || entered === '') return { price: close, entered: null };
    const px = Number(entered) / (k || 1);
    if (!(px > 0)) return { error: 'Enter a price above zero, or leave it blank for the close.' };
    const lo = Number(bar.low) > 0 ? Number(bar.low) : close, hi = Number(bar.high) > 0 ? Number(bar.high) : close;
    if (px < lo * 0.995 || px > hi * 1.005) {
      const f = (v) => '$' + (v * (k || 1)).toFixed(2);
      return { error: 'That price is outside the day\u2019s range (' + f(lo) + ' to ' + f(hi) + (k !== 1 ? ', before the split' + (k > 1 ? 's' : '') + ' since' : '') + ').' };
    }
    return { price: px, entered: Number(entered) };
  }
  // A starting amount: whole dollars between MIN_CASH and MAX_CASH.
  function startCashOf(v) {
    if (v == null || v === '') return { cash: START_CASH };
    const n = Math.round(Number(String(v).replace(/[$,\s]/g, '')));
    if (!(n >= MIN_CASH) || n > MAX_CASH) return { error: 'Choose a starting amount between $' + MIN_CASH.toLocaleString('en-US') + ' and $' + MAX_CASH.toLocaleString('en-US') + '.' };
    return { cash: n };
  }

  const api = { summarise, sizeOpen, sizeClose, history, nyDay, START_CASH, MIN_CASH, MAX_CASH, MAX_BACK_DAYS,
    dayOf, whenOf, checkLedger, heldOn, splitFactor, pricedOn, startCashOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Paper = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
