// THE DATA CHECK (2026-11-08, the owner: "Yes built it", on a nightly check
// that flags suspect data and emails what it finds). Pure; no I/O.
//
// WHY. Wrong prices reached the archive three ways in 2026 and each was found
// by accident: a split the provider never applied (IESC, MLI: a 54% "fall"
// fed every reading for weeks), a split the provider applied late (ITA, MTUM:
// a 66% and 75% cliff), and a split check that deleted history (SCCO, MSGS,
// SOXX cut to a dozen rows). Every one of them leaves a mark a cheap check can
// see: a one-day move far outside an ordinary day, or a history that got
// shorter. So this looks for those marks every evening, and the jobs email
// lists anything it has not reported before.
//
// WHAT IT LOOKS AT, and what it reads to do it (the route, POST
// /api/cron/jobs-digest, does the I/O):
//   moves     each stock's closes over the last two weeks (a date-ranged read
//             of the archive), against the splits held
//   history   each stock's first stored date (two seeks a stock), against the
//             first date seen on the last run
//   factors   splits listed in the last four months that are not a whole
//             ratio: a spin-off or other price factor the app does not apply
// Two checks tried and dropped on today's data: market value against price
// times shares (40 false alarms, all foreign listings and share classes) and
// readings out of range (nothing the moves check does not already catch).
'use strict';
const { wholeRatio } = require('./barsplit.js');

const LN_MOVE = 0.4;        // a close-to-close move of about -33% / +49% or more
const SPLIT_FIT = 0.15;     // what is left once a held split is divided out
const RATIO_FIT = 0.06;     // a move this close to 1/n (n = 2..10) looks like an unrecorded split (ITA's 1-for-3 day was 3% off, the market moved too)
const SHRINK_DAYS = 7;      // the first stored date moving later than this is lost history
const FACTOR_MIN = 0.1;     // |ln f| below this is a stock dividend, not worth a line

const pct = (r) => (r >= 1 ? '+' : '−') + Math.abs((r - 1) * 100).toFixed(0) + '%';
const dayGap = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

// bars: { SYM: [{ d, close }] } in any order. splits: Map SYM -> [{ d, f }].
// since: only moves dated on or after it.
function moves(bars, splits, since) {
  const out = [];
  for (const [sym, list] of Object.entries(bars || {})) {
    const b = (list || []).filter((x) => x && x.d && x.close > 0).slice().sort((x, y) => (x.d < y.d ? -1 : 1));
    for (let i = 1; i < b.length; i++) {
      if (b[i].d < since) continue;
      const r = b[i].close / b[i - 1].close;
      if (Math.abs(Math.log(r)) < LN_MOVE) continue;
      const near = ((splits && splits.get(sym)) || []).filter((s) => Math.abs(dayGap(s.d, b[i].d)) <= 12);
      const explained = near.find((s) => Math.abs(Math.log(r * s.f)) < SPLIT_FIT);
      let kind, note;
      if (explained) {
        kind = 'unadjusted';
        note = `${sym} ${pct(r)} on ${b[i].d}: its ${explained.d} split (×${+Number(explained.f).toFixed(4)}) was never applied to the stored prices`;
      } else {
        // 1/n or n for a whole n: a split nobody has recorded yet.
        let n = null;
        for (let k = 2; k <= 10 && n == null; k++) { if (Math.abs(Math.log(r * k)) < RATIO_FIT) n = k; else if (Math.abs(Math.log(r / k)) < RATIO_FIT) n = 1 / k; }
        if (n != null) {
          kind = 'split?';
          note = `${sym} ${pct(r)} on ${b[i].d}: the size of a ${n >= 1 ? n + '-for-1' : '1-for-' + Math.round(1 / n)} split, and none is recorded`;
        } else {
          kind = 'move';
          note = `${sym} ${pct(r)} on ${b[i].d} (${b[i - 1].close} to ${b[i].close}): no split explains it; worth checking against the news`;
        }
      }
      out.push({ key: `${kind}|${sym}|${b[i].d}`, kind, symbol: sym, d: b[i].d, r, n: kind === 'split?' ? note.match(/a (\S+) split/)[1] : null, note });
    }
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : -1));
}

// spanNow: { SYM: { first, last } }. firstBefore: { SYM: 'YYYY-MM-DD' } from the last run.
function history(spanNow, firstBefore) {
  const out = [];
  for (const [sym, was] of Object.entries(firstBefore || {})) {
    const now = spanNow && spanNow[sym];
    if (!now || !now.first || !was) continue;   // a stock that left, or no bars read: not a shrink
    if (dayGap(was, now.first) > SHRINK_DAYS) {
      out.push({ key: `history|${sym}|${now.first}`, kind: 'history', symbol: sym, d: now.first,
        note: `${sym}'s stored prices now start ${now.first}; yesterday they started ${was}. History was lost (restore: backfill-bars.js --only ${sym})` });
    }
  }
  return out;
}

// splits: Map SYM -> [{ d, f }]; only those dated on or after `since`.
function factors(splits, since) {
  const out = [];
  for (const [sym, list] of splits || new Map()) {
    for (const s of list) {
      const f = Number(s.f);
      if (!(s.d >= since) || !(f > 0) || Math.abs(Math.log(f)) < FACTOR_MIN || wholeRatio(f)) continue;
      out.push({ key: `factor|${sym}|${s.d}`, kind: 'factor', symbol: sym, d: s.d,
        note: `${sym}: the provider lists a ×${+f.toFixed(4)} factor on ${s.d}, not a whole-number split (a spin-off or similar); the app does not apply it, so returns across that date include the drop` });
    }
  }
  return out;
}

// What to say this time. `seen` is { key: firstSeenDay } from the last run.
// New findings are reported; ones still there are listed as open; the
// lasting kinds that have gone are reported as cleared. A move leaves the
// two-week window on its own and is not "cleared".
function diff(findings, seen, today) {
  const was = seen || {};
  const now = {};
  const fresh = [], open = [];
  for (const f of findings) {
    now[f.key] = was[f.key] || today;
    (was[f.key] ? open : fresh).push(f);
  }
  const cleared = Object.keys(was).filter((k) => !now[k] && !/^(move|split\?)\|/.test(k));
  return { fresh, open, cleared, seen: now };
}

module.exports = { moves, history, factors, diff, LN_MOVE, SHRINK_DAYS };
