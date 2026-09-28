// FINRA consolidated short interest — parsing and shaping, no network and no
// database. The news.js / secfacts.js / insider.js shape: orchestration lives
// in server.js and in the local loader, so every rule below is testable with
// no server.
//
// WHAT THIS IS, AND WHAT IT IS NOT — FINRA publishes two things and only one
// of them is short interest:
//
//   - the RegSHO **daily** file is short *volume*: shares sold short during a
//     session, most of which is market-maker intermediation that is flat again
//     by the close. It runs 50-60% on liquid names and says nothing about
//     positioning. It is the file everybody reaches for and it is NOT loaded.
//   - the **bi-weekly** consolidated file is the real position: shares actually
//     held short at a settlement date, twice a month. That is this.
//
// Measured 2026-09-28: the bi-weekly position divided by our stored float
// reproduces the provider's `shortPctFloat` to 0.00pt on NVDA, PTON, MU and
// JPM (AAPL -0.08pt). So the paid field IS this number, and this source adds
// the ~8 years of history the provider does not sell at all.
(function (root) {
  'use strict';

  // Reject the empty before coercing. `Number('')` and `Number(null)` are both
  // 0 and finite, and a fabricated zero here would read as "nobody is short"
  // rather than "not reported" — the sixth place this project has needed the
  // sentence.
  const num = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  // A settlement date arrives as `2026-09-15` from the API and as `20260915`
  // from the bulk file's own `accountingYearMonthNumber`. One shape stored.
  function isoDate(v) {
    const s = String(v == null ? '' : v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return s;
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  // THREE SPELLINGS OF ONE SYMBOL, and this is the third. We write `BRK.B`,
  // SEC and Yahoo write `BRK-B`, and FINRA strips the separator entirely:
  // `BRKB`, `HEIA`. Measured — zero dots and zero spaces across all 22,595
  // symbols in one file. The failure is a silent miss, never a 404, so the
  // loader tries both spellings rather than assuming.
  const finraSymbol = (sym) => String(sym || '').trim().toUpperCase().replace(/[.\-/]/g, '');

  // The bulk file is pipe-delimited and the API answers comma-delimited; the
  // bulk file was unquoted until some point in 2026 and is quoted now
  // (measured: 2024-06-14 unquoted, 2026-09-15 quoted). So the delimiter is
  // sniffed from the header and quotes are optional per field — a parser that
  // assumed either would silently stop reading one of the two sources.
  function parse(text) {
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const delim = lines[0].indexOf('|') >= 0 ? '|' : ',';
    const unq = (s) => String(s == null ? '' : s).trim().replace(/^"(.*)"$/, '$1');
    const head = lines[0].split(delim).map(unq);
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(delim);
      if (cells.length < 2) continue;
      const rec = {};
      for (let c = 0; c < head.length; c++) rec[head[c]] = unq(cells[c]);
      const row = normalise(rec);
      if (row) out.push(row);
    }
    return out;
  }

  // One stored shape, whichever source it came from. `symbol` is kept as FINRA
  // spells it; the caller maps it back to ours.
  function normalise(rec) {
    const d = isoDate(rec.settlementDate || rec.accountingYearMonthNumber);
    const symbol = String(rec.symbolCode || '').trim().toUpperCase();
    if (!d || !symbol) return null;
    const shares = num(rec.currentShortPositionQuantity);
    if (shares == null) return null;
    const split = /^[A-Za-z]/.test(String(rec.stockSplitFlag || '').trim());
    return {
      symbol,
      d,
      shares,
      prev: num(rec.previousShortPositionQuantity),
      adv: num(rec.averageDailyVolumeQuantity),
      dtc: num(rec.daysToCoverQuantity),
      // A SPLIT MAKES `changePercent` NONSENSE AND FINRA SHIPS IT ANYWAY.
      // Measured on NVDA's 10:1 of June 2024: current 315,033,985 against an
      // unrestated previous of 29,202,972, reported as **+978.77%**. FINRA
      // does not restate history, it only flags the row — so the flag is what
      // makes the change figure safe to show, and without it the card would
      // print a thousand-percent build-up in bearish bets that never happened.
      changePct: split ? null : num(rec.changePercent),
      split,
      revised: /^[A-Za-z]/.test(String(rec.revisionFlag || '').trim()),
    };
  }

  // The robust ceiling for the strip, the earnings strip's own rule on this
  // same page: scale to the 90th percentile of what is in view rather than to
  // the largest bar, or one crowded fortnight flattens every ordinary one.
  function pctile(values, p) {
    const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const i = Math.min(v.length - 1, Math.max(0, Math.round((v.length - 1) * p)));
    return v[i];
  }

  const MIN_SCALE = 2; // days to cover; below this the strip is all noise

  // `rows` newest-first or oldest-first, either is fine.
  // `opts.floatShares` is TODAY'S float and is applied to the LATEST reading
  // only — see the note below.
  function build(rows, opts) {
    const o = opts || {};
    const series = (rows || []).slice().filter((r) => r && r.d).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!series.length) return null;

    const latest = series[series.length - 1];
    const dtcs = series.map((r) => r.dtc).filter((x) => x != null);
    const scale = Math.max(MIN_SCALE, pctile(dtcs, 0.9) || 0);

    // PERCENT OF FLOAT IS THE LATEST READING ONLY, and that is not tidiness.
    // Float history is not stored (`fundamentals_history` began 2026-08-30),
    // so dividing a 2019 position by today's float would invent a series. The
    // latest reading is the one where today's float is contemporaneous.
    const fl = o.floatShares;
    const pctFloat = (fl != null && fl > 0 && latest.shares != null)
      ? (latest.shares / fl) * 100 : null;

    // Where does today's crowding sit in this stock's OWN history? A bare
    // "2.5 days to cover" means nothing without it — the Cushion column's
    // lesson, and the hit-rate-needs-a-base-rate rule from the research log.
    let rank = null;
    if (latest.dtc != null && dtcs.length >= 8) {
      const below = dtcs.filter((x) => x < latest.dtc).length;
      rank = Math.round((below / dtcs.length) * 100);
    }

    return {
      n: series.length,
      from: series[0].d,
      to: latest.d,
      scale,
      latest: Object.assign({}, latest, { pctFloat, rank }),
      // The strip only ever draws days to cover — see the note in the card.
      series: series.map((r) => ({ d: r.d, dtc: r.dtc, shares: r.shares, split: r.split })),
      medianDtc: pctile(dtcs, 0.5),
      splits: series.filter((r) => r.split).length,
    };
  }

  const api = { num, isoDate, finraSymbol, parse, normalise, build, pctile, MIN_SCALE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShortInt = api;
})(typeof window !== 'undefined' ? window : globalThis);
