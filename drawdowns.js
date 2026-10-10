// Drawdown history for the screener: rebuild a slice of `drawdown_stats`.
//
// One function, two callers: the server's daily check (a slice a night) and
// drawdown-load.js (the first fill, or a full rebuild by hand). The reasons
// it is stored at all, and rebuilt this way, are with the constants' use in
// server.js under "Drawdown history".
//
// THE ANALYSIS IS Cards.drawdownAnalyse, the stock page's and the promo
// card's own, handed in rather than required: private/cards.js is a browser
// module that hangs itself on a global, and the server already holds it.
'use strict';

const WINDOW_DAYS = 1830;        // five years of calendar days
const MIN_SESSIONS = 500;        // two years: fewer, and "none in five years" is not a finding
const SLICE = 200;
const CHUNK = 40;

// One symbol's row from its closes, or { n: null } when there is too little
// history to say. Pure.
function rowFor(Cards, sym, series) {
  const an = series ? Cards.drawdownAnalyse(series.dates, series.closes, 10) : null;
  const st = an && an.under.length >= MIN_SESSIONS ? Cards.drawdownStats(an) : null;
  return st
    ? { symbol: sym, n: st.n, nBack: st.nBack, medBack: st.medBack, medDepth: st.medDepth, worst: st.worst, from: st.from, through: st.through }
    : { symbol: sym, n: null };
}

// opts: limit (how many symbols), budgetMs (stop starting new chunks after
// this), dry (compute, write nothing), only (these symbols), onChunk (rows).
async function slice(store, Cards, opts = {}) {
  const limit = Math.max(1, Number(opts.limit) || SLICE);
  const until = Date.now() + (Number(opts.budgetMs) || 25000);
  const [universe, have] = await Promise.all([store.readUniverse(), store.readDrawdownStats()]);
  const all = universe.map((s) => String(s).toUpperCase());
  // Never built first, then the longest since.
  const todo = (opts.only ? all.filter((s) => opts.only.includes(s)) : all.slice()
    .sort((a, b) => ((have[a] ? have[a].at : 0) - (have[b] ? have[b].at : 0)) || (a < b ? -1 : 1))).slice(0, limit);
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  let done = 0;
  for (let i = 0; i < todo.length && Date.now() < until; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const series = await store.readCloseSeries(chunk, since);
    const out = chunk.map((sym) => rowFor(Cards, sym, series[sym]));
    if (opts.onChunk) opts.onChunk(out);
    done += opts.dry ? out.length : await store.writeDrawdownStats(out);
  }
  return { done, asked: todo.length, universe: all.length, built: Object.keys(have).length };
}

module.exports = { slice, rowFor, WINDOW_DAYS, MIN_SESSIONS, SLICE, CHUNK };
