// Institutional holdings from Form 13F -- the arithmetic and the rules.
// Pure: no network, no database, no ZIP. inst13f-load.js downloads the SEC's
// files and hands their lines over; this decides what counts.
//
// WHAT A 13F IS. An institutional manager with more than $100 million in
// US-listed securities reports, within 45 days of each quarter end, every
// long position it held on the last day of the quarter. The SEC publishes
// all of them as one data set a quarter (about 3.8 million rows).
//
// WHAT IT IS NOT, which matters more than what it is:
//   - NOT CURRENT. A quarter-end snapshot filed up to 45 days later, and
//     published a few weeks after that. In mid-October the newest complete
//     quarter is the one that ended in June.
//   - NOT EVERYONE. Managers under $100 million do not file; individuals do
//     not file; holders outside the US mostly do not file.
//   - NOT NET. Long positions only: a manager short a stock reports nothing
//     of it, and one that lent its shares still reports them.
//   - NOT ONLY SHARES, as filed. The table also carries options (a row with
//     PUT or CALL) and bonds (an amount in principal, not shares). Both are
//     left out here: an option on a million shares is not a million shares
//     held.
//   - NOT FREE OF DOUBLE COUNTING. Related managers sometimes report the same
//     shares. The total can exceed the shares that exist; where it does, the
//     page says so rather than printing more than 100% as a holding.
//
// AMENDMENTS. A manager may refile. A RESTATEMENT replaces what came before;
// a NEW HOLDINGS amendment adds to it. So for each manager and quarter the
// base is the LATEST original-or-restatement, plus any new-holdings
// amendments filed on or after it. Without this a manager who restated is
// counted twice.
//
// THE SECURITY CODE. A 13F names a holding by CUSIP, not by ticker, and
// nothing in the app mapped one to the other. The SEC's own fails-to-deliver
// files carry both for every security that had a fail in the half-month,
// which is nearly every liquid one; a few of those files give the map.
(function (root) {
  'use strict';

  const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  // '30-JUN-2026' -> '2026-06-30'. Null for anything else.
  function isoDate(s) {
    const m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(String(s || '').trim().toUpperCase());
    return m && MON[m[2]] ? m[3] + '-' + MON[m[2]] + '-' + m[1].padStart(2, '0') : null;
  }
  const cols = (line) => String(line).split('\t');
  // A header line -> { NAME: index }.
  const header = (line) => { const h = {}; cols(line).forEach((c, i) => { h[c.trim().toUpperCase()] = i; }); return h; };

  // The quarter a data set is mostly about: the commonest period among its
  // holdings reports. A window also carries late filings for old quarters
  // (one manager filed for 2001 in the 2026 set), so "the newest" is wrong
  // and "the commonest" is right.
  function mainPeriod(subs) {
    const n = {};
    for (const s of subs) if (s.type === '13F-HR' && s.period) n[s.period] = (n[s.period] || 0) + 1;
    return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null;
  }

  // subs: [{ accn, filed, type, cik, period }], covers: { accn: { name,
  // amendType } }. Returns Map accn -> { cik, name } for the filings that
  // count for `period`.
  function chosen(subs, covers, period) {
    const by = new Map();
    for (const s of subs) {
      if (s.period !== period) continue;
      if (s.type !== '13F-HR' && s.type !== '13F-HR/A') continue;      // 13F-NT is a notice with no holdings
      if (!by.has(s.cik)) by.set(s.cik, []);
      by.get(s.cik).push(s);
    }
    const out = new Map();
    for (const [cik, list] of by) {
      list.sort((a, b) => (a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : a.accn < b.accn ? -1 : 1));
      const kind = (s) => (s.type === '13F-HR' ? 'base' : /NEW\s*HOLDINGS/i.test((covers[s.accn] || {}).amendType || '') ? 'add' : 'base');
      let baseAt = -1;
      list.forEach((s, i) => { if (kind(s) === 'base') baseAt = i; });
      if (baseAt < 0) continue;                                         // only additions on file: nothing to add them to
      const name = (covers[list[baseAt].accn] || {}).name || ('CIK ' + cik);
      out.set(list[baseAt].accn, { cik, name });
      for (let i = baseAt + 1; i < list.length; i++) if (kind(list[i]) === 'add') out.set(list[i].accn, { cik, name });
    }
    return out;
  }

  // One line of the holdings table -> { accn, cusip, shares, value } or null
  // where it is not a plain holding of shares.
  function holdingOf(c, H) {
    if (String(c[H.PUTCALL] || '').trim()) return null;                 // an option, not a holding
    if (String(c[H.SSHPRNAMTTYPE] || '').trim().toUpperCase() !== 'SH') return null;   // principal amount: a bond
    const shares = Number(c[H.SSHPRNAMT]);
    if (!(shares > 0) || !isFinite(shares)) return null;
    const cusip = String(c[H.CUSIP] || '').trim().toUpperCase();
    if (cusip.length !== 9) return null;
    const value = Number(c[H.VALUE]);
    return { accn: c[H.ACCESSION_NUMBER], cusip, shares, value: value > 0 && isFinite(value) ? value : 0 };
  }

  // Accumulates one quarter: add(symbol, cik, name, shares, value), then
  // done() -> Map symbol -> Map cik -> { name, shares, value }. A manager's
  // several rows for one stock (split by sub-manager or by who votes) add up.
  function quarter() {
    const by = new Map();
    return {
      add(symbol, cik, name, shares, value) {
        let m = by.get(symbol);
        if (!m) by.set(symbol, m = new Map());
        const had = m.get(cik);
        if (had) { had.shares += shares; had.value += value; } else m.set(cik, { name, shares, value });
      },
      done: () => by,
    };
  }

  // One stock's summary from this quarter's holders and last quarter's.
  //   sharesOut  the company's shares outstanding, where known: a manager
  //              reporting more than all of them has made a units error (a
  //              few file in thousands) and is dropped, counted in `dropped`.
  // The share count a position may not exceed, or null where the count on
  // file is not to be trusted (see below). One function, so the stock's
  // summary and a manager's book (holderbook.js) leave out the same rows.
  function shareCap(cur, sharesOut) {
    let out = sharesOut > 0 ? sharesOut : null;
    if (out && cur) {
      let over = 0;
      for (const h of cur.values()) if (h.shares > out) over++;
      if (over > 5 || (cur.size >= 50 && over > cur.size * 0.02)) out = null;
    }
    return out;
  }
  function summarise(cur, prev, sharesOut, topN) {
    // THE SHARE COUNT ITSELF CAN BE THE WRONG ONE. For a company with two
    // classes the vendor's count may be the other class's: Berkshire's B
    // shares came with 1.4 million outstanding, which is the A class, and
    // the guard threw out every real holder and kept the ones just under
    // that. So it is trusted only while it is exceeded by a handful: more
    // than five managers, or more than two in a hundred, over the "whole
    // company" means the count is wrong, not the managers.
    const out = shareCap(cur, sharesOut);
    const ok = (h) => !(out && h.shares > out);
    const now = [...(cur || new Map())].filter(([, h]) => ok(h));
    const dropped = (cur ? cur.size : 0) - now.length;
    const before = new Map([...(prev || new Map())].filter(([, h]) => ok(h)));
    // THE DOLLAR VALUES AS FILED ARE NOT ADDED UP. A manager is meant to
    // report in dollars and some still file in thousands: T. Rowe Price's
    // 370 million Nvidia shares arrived valued at $0.1 billion. So the value
    // is the shares held times ONE price for the stock: the median of what
    // the managers themselves implied (value over shares), which is the
    // quarter-end price to within a rounding and is unmoved by the few who
    // filed in the wrong units.
    const implied = now.filter(([, h]) => h.value > 0).map(([, h]) => h.value / h.shares).sort((a, b) => a - b);
    const px = implied.length ? (implied.length % 2 ? implied[(implied.length - 1) / 2] : (implied[implied.length / 2 - 1] + implied[implied.length / 2]) / 2) : null;
    let shares = 0, added = 0;
    for (const [cik, h] of now) { shares += h.shares; if (prev && !before.has(cik)) added++; }
    const value = px == null ? null : shares * px;
    let sharesPrev = 0, exited = 0;
    const have = new Set(now.map(([cik]) => cik));
    for (const [cik, h] of before) { sharesPrev += h.shares; if (!have.has(cik)) exited++; }
    const top = now.sort((a, b) => b[1].shares - a[1].shares).slice(0, topN || 15).map(([cik, h]) => {
      const p = before.get(cik);
      return { cik, name: h.name, shares: h.shares,
        // null when there is no earlier quarter to compare against at all;
        // 0 when there is one and this manager was not in it (a new holder).
        prev: prev ? (p ? p.shares : 0) : null };
    });
    return { managers: now.length, managersPrev: prev ? before.size : null, shares, sharesPrev: prev ? sharesPrev : null,
      value, px, added: prev ? added : null, exited: prev ? exited : null, dropped, top };
  }

  // Words and figures shared by the page and the screener.
  const pctOf = (shares, out) => (shares > 0 && out > 0 ? shares / out * 100 : null);
  const change = (now, prev) => (prev > 0 && now >= 0 ? (now / prev - 1) * 100 : null);
  // 'Q2 2026' for a period ending 2026-06-30.
  const quarterName = (period) => { const m = /^(\d{4})-(\d{2})/.exec(String(period || '')); return m ? 'Q' + Math.ceil(Number(m[2]) / 3) + ' ' + m[1] : ''; };

  const api = { isoDate, cols, header, mainPeriod, chosen, holdingOf, quarter, summarise, shareCap, pctOf, change, quarterName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Inst13f = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
