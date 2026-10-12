// Options open interest for one stock, from the Options Clearing Corporation's
// public series report -- the reading and the arithmetic. Pure: no network,
// no database.
//
// (2026-10-11, the owner, from the list of public data not yet read: "can you
// work on options open interest".)
//
// WHAT OPEN INTEREST IS. The number of option contracts that exist and have
// not been closed, exercised or expired. Every contract has a buyer and a
// seller, so it says how much is outstanding and NOT which way anyone is
// leaning: a large put position can be a bet on a fall, insurance on shares
// someone owns, or one leg of a trade that is neutral overall. So this module
// counts, and no surface built on it reads a direction into the count.
//
// THE SOURCE. The OCC clears every listed US option and publishes, for any
// underlying, each series (expiry and strike) with its call and put open
// interest: marketdata.theocc.com/series-search. One request a stock, about
// 100KB for a heavily traded one. The figures are as of the close of the
// last trading day and change once a day, overnight.
//
// WHAT IS COUNTED: the standard contracts on the stock itself. The same
// report also lists FLEX contracts (product symbols 1AAPL, 2AAPL: privately
// negotiated terms) and contracts adjusted for a corporate action (AAPL1,
// which no longer deliver 100 shares). Both are left out, so every contract
// counted is 100 shares of the stock.
//
// THE REPORT CARRIES NO DATE. It is taken as the last weekday before the day
// it is read in New York. A market holiday is not known here, so on the day
// after one the label is a day late; the figures are right either way.
(function (root) {
  'use strict';

  const BASE = 'https://marketdata.theocc.com/series-search?symbolType=U&symbol=';
  // The OCC writes a share class without the dot: BRK.B is BRKB.
  const occSymbol = (sym) => String(sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const url = (sym) => BASE + encodeURIComponent(occSymbol(sym));

  // The last weekday strictly before `now`'s date in New York, 'YYYY-MM-DD'.
  function asOf(now) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(now instanceof Date ? now : new Date(now == null ? Date.now() : now));
    let t = Date.parse(parts + 'T12:00:00Z');
    do { t -= 86400000; } while ([0, 6].includes(new Date(t).getUTCDay()));
    return new Date(t).toISOString().slice(0, 10);
  }

  // The report's text -> { status, series: [{ exp, strike, call, put }] }.
  //   'ok'       series read
  //   'none'     the OCC knows the symbol and lists no options on it
  //   'invalid'  the OCC does not know the symbol
  //   'blocked'  an HTML page came back instead of the report
  //   'unread'   anything else: not a report this module recognises
  function parse(text, sym) {
    const raw = String(text || '');
    if (/^\s*<(!doctype|html)/i.test(raw)) return { status: 'blocked', series: [] };
    if (/^\s*Invalid symbol/i.test(raw)) return { status: 'invalid', series: [] };
    if (/^\s*No data exists/i.test(raw)) return { status: 'none', series: [] };
    if (!/Series Search Results/i.test(raw)) return { status: 'unread', series: [] };
    const want = occSymbol(sym);
    const series = [];
    for (const line of raw.split(/\r?\n/)) {
      const c = line.split('\t');
      if (c.length < 10 || c[0].trim() !== want) continue;
      const y = c[2], m = c[3], d = c[4];
      if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) continue;
      const strike = Number(c[5]) + Number(c[6]) / 1000;
      const call = Number(c[8]), put = Number(c[9]);
      if (!isFinite(strike) || !isFinite(call) || !isFinite(put) || call < 0 || put < 0) continue;
      series.push({ exp: y + '-' + m + '-' + d, strike, call, put });
    }
    // The report was read and held only FLEX or adjusted contracts.
    return { status: series.length ? 'ok' : 'none', series };
  }

  // Puts for every call. Null where there are no calls: a ratio over nothing
  // is not a large ratio.
  const pcr = (call, put) => (call > 0 && put >= 0 ? put / call : null);

  // series + the date they describe -> the summary that is stored.
  // A series that expired on or before that date is settled: the report
  // still lists the contracts that expired at that day's close, and they are
  // no longer open by the time anyone reads this.
  const EXPIRIES = 8, TOP = 5;
  function summarise(series, date) {
    const live = (series || []).filter((s) => !date || s.exp > date);
    let call = 0, put = 0;
    const byExp = new Map();
    for (const s of live) {
      call += s.call; put += s.put;
      const e = byExp.get(s.exp) || byExp.set(s.exp, { exp: s.exp, call: 0, put: 0 }).get(s.exp);
      e.call += s.call; e.put += s.put;
    }
    const all = [...byExp.values()].sort((a, b) => (a.exp < b.exp ? -1 : 1));
    const top = (k) => live.filter((s) => s[k] > 0).sort((a, b) => b[k] - a[k] || (a.exp < b.exp ? -1 : 1)).slice(0, TOP)
      .map((s) => ({ exp: s.exp, strike: s.strike, oi: s[k] }));
    // THE EXPIRIES SHOWN ARE THE LARGEST, in date order -- not the nearest,
    // which for a heavily traded stock are eight weeklies holding a sliver
    // of what is open while the quarterly dates hold most of it.
    const big = all.slice().sort((a, b) => (b.call + b.put) - (a.call + a.put)).slice(0, EXPIRIES).sort((a, b) => (a.exp < b.exp ? -1 : 1));
    return { call, put, total: call + put, expiries: big, expiryCount: all.length, seriesCount: live.length,
      topCalls: top('call'), topPuts: top('put') };
  }

  // How many shares the open contracts speak for, as a share of the company:
  // each is 100 shares. Null without a share count.
  const ofShares = (contracts, sharesOut) => (contracts >= 0 && sharesOut > 0 ? contracts * 100 / sharesOut * 100 : null);
  const change = (now, prev) => (prev > 0 && now >= 0 ? (now / prev - 1) * 100 : null);

  const api = { BASE, url, occSymbol, asOf, parse, pcr, summarise, ofShares, change, EXPIRIES, TOP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OptionsOI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
