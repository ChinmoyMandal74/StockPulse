// PRICE ALERTS (2026-11-03, the owner: "send admin emails when price refresh
// job fails in future, Also if a stock falls off Twelve Data inform Admin by
// email"). Written the day every intraday round failed from 09:32 to 11:15 and
// nobody heard: QRVO had left the provider, and the one failure threw away
// the whole slice's prices (intraday-price-refreshes.md).
//
// Two decisions, both "say it once":
//
//   A PRICE JOB FAILED. The intraday schedule and the nightly's price rounds
//   each mail the first failure of an Eastern day, and once the same job
//   succeeds again that day, a short all-clear. A failure every half hour is
//   one email, not thirteen.
//
//   A STOCK FELL OFF THE PROVIDER. After a live price pull, a symbol asked for
//   and not served at all ('none'), or served with a newest bar more than
//   STALE_DAYS behind the newest bar of the pull ('stale': the provider still
//   answers with a last price from weeks ago, as WBD did), is reported once,
//   and again when it comes back. A pull that served under half of what it
//   asked for is a provider problem, not a stock problem, and says nothing.
//
// Pure: no I/O, no mail. server.js holds the marks (db.js price_alert,
// td_unserved) and sends; pricealert-test.js.
'use strict';

const STALE_DAYS = 7;
const JOBS = { intraday: 'Intraday price refresh', nightly: 'Nightly price refresh' };

const dayDiff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
const newestOf = (s) => {
  const v = s && Array.isArray(s.values) ? s.values : [];
  let best = null;
  for (const b of v) { const d = b && b.datetime ? String(b.datetime).slice(0, 10) : null; if (d && (!best || d > best)) best = d; }
  return best;
};

// state: { [job]: { day, at, error, recovered } }. Returns whether to mail.
function onFail(state, job, today, error, now) {
  const s = Object.assign({}, state || {});
  const cur = s[job];
  if (cur && cur.day === today && !cur.recovered) return { send: false, state: s };
  s[job] = { day: today, at: now, error: String(error || 'unknown').slice(0, 300), recovered: false };
  return { send: true, state: s };
}
function onOk(state, job, today, now) {
  const s = Object.assign({}, state || {});
  const cur = s[job];
  if (!cur || cur.day !== today || cur.recovered) return { send: false, state: s, failedAt: null };
  s[job] = Object.assign({}, cur, { recovered: true, recoveredAt: now });
  return { send: true, state: s, failedAt: cur.at, error: cur.error };
}

// asked: the symbols a live pull asked for; got: { SYM: { values } } as served.
// state: { SYM: { kind, last, since } }. Returns the new state and what changed.
function unserved(asked, got, state, today) {
  const syms = [...new Set((asked || []).map((x) => String(x).toUpperCase()))];
  const newest = {};
  let top = null, served = 0;
  for (const s of syms) {
    const d = newestOf(got && got[s]);
    newest[s] = d;
    if (d) { served++; if (!top || d > top) top = d; }
  }
  const s = Object.assign({}, state || {});
  if (!syms.length || !top || served < syms.length / 2) return { state: s, gone: [], back: [], skipped: true };
  const gone = [], back = [];
  for (const sym of syms) {
    const d = newest[sym];
    const kind = !d ? 'none' : dayDiff(top, d) > STALE_DAYS ? 'stale' : null;
    const was = s[sym];
    if (kind) {
      if (!was || was.kind !== kind) { s[sym] = { kind, last: d, since: (was && was.since) || today }; gone.push({ symbol: sym, kind, last: d }); }
    } else if (was) {
      delete s[sym];
      back.push({ symbol: sym, last: d });
    }
  }
  return { state: s, gone, back, skipped: false, top };
}

module.exports = { STALE_DAYS, JOBS, onFail, onOk, unserved, newestOf, dayDiff };
