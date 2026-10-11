// Which funds hold a stock, from Form N-PORT -- the rules and the arithmetic.
// Pure: no network, no database, no ZIP. nport-load.js streams the SEC's
// tables and hands their rows over; this decides what counts.
//
// WHAT N-PORT IS. Every registered fund -- mutual funds and ETFs -- reports
// its whole portfolio to the SEC each month. The report for the last month
// of each of the fund's fiscal quarters is made public, sixty days after
// that month ends. The SEC publishes everything made public in a calendar
// quarter as one data set (about 460MB zipped; the holdings table is close
// to a gigabyte).
//
// HOW IT DIFFERS FROM 13F, which the app also holds (inst13f.js):
//   13F     by MANAGER.  "BlackRock holds 1.16 billion Apple shares."
//   N-PORT  by FUND.     "iShares Core S&P 500 ETF holds 240 million of them."
// The second is inside the first: a manager's 13F adds up its funds and its
// other accounts. So the two are never added together, and the fund total is
// always the smaller one.
//
// THE DATES ARE NOT ONE DATE. Funds have different fiscal years, so the
// public report of one is as of April, of another May, of a third June, all
// in the same data set. Each fund's row carries its own as-of date, and the
// summary says the range rather than naming a quarter end that is true of
// only a third of them.
//
// WHAT COUNTS AS HOLDING THE STOCK: a long position in the common equity,
// reported in shares. A short position, an option or swap referencing the
// stock, a convertible, a bond of the same issuer and a position reported in
// a principal amount are all left out.
//
// ONE REPORT A FUND. A fund that amends, or whose two fiscal quarter ends
// both fall in the window, appears twice; the newest as-of date wins, then
// the newest filing.
(function (root) {
  'use strict';

  const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  function isoDate(s) {
    const m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(String(s || '').trim().toUpperCase());
    return m && MON[m[2]] ? m[3] + '-' + MON[m[2]] + '-' + m[1].padStart(2, '0') : null;
  }
  // A FUND'S NAME AS FILED IS NOT ALWAYS A NAME. A unit investment trust has
  // no series, and its series name arrives as "N/A": the SPDR S&P 500 ETF
  // Trust, one of the largest funds there is, was listed as "N/A" in the
  // first dry run. Then the registrant's name is the fund's. And some
  // families file in capitals (VANGUARD 500 INDEX FUND); those are set as a
  // name, with the abbreviations a fund name is made of left standing.
  const KEEP = new Set(['ETF', 'ETFS', 'US', 'USA', 'S&P', 'SPDR', 'QQQ', 'II', 'III', 'IV', 'VI', 'VII', 'ESG', 'REIT', 'MSCI', 'NYSE', 'FTSE', 'USD', 'AI', 'LP', 'LLC', 'TIPS', 'EAFE', 'ADR', 'UK', 'EM']);
  function tidyName(s) {
    // Trademark marks are filed as (R), (TM) and (SM); a name reads without them.
    const t = String(s || '').replace(/\((R|TM|SM)\)/gi, '').replace(/\s+/g, ' ').trim();
    if (!t || /^n\/?a$/i.test(t)) return '';
    if (t !== t.toUpperCase() || !/[A-Z]{4}/.test(t)) return t.slice(0, 90);
    // Word by word, and part by part across a hyphen (ALL-WORLD EX-US).
    const one = (w) => (KEEP.has(w.replace(/[.,()]/g, '')) || /\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
    return t.split(' ').map((w) => w.split('-').map(one).join('-')).join(' ').slice(0, 90);
  }
  const cols = (line) => String(line).split('\t');
  const header = (line) => { const h = {}; cols(line).forEach((c, i) => { h[c.trim().toUpperCase()] = i; }); return h; };

  // subs:  { accn: { filed, asOf } }          from SUBMISSION
  // infos: { accn: { id, name, nav } }        from FUND_REPORTED_INFO
  // regs:  { accn: familyName }               from REGISTRANT
  // Returns Map accn -> { id, name, family, asOf, nav } for the one report
  // that counts for each fund.
  function pickReports(subs, infos, regs) {
    const best = new Map();
    for (const accn of Object.keys(infos)) {
      const s = subs[accn], f = infos[accn];
      if (!s || !s.asOf || !f) continue;
      // A fund with no series id is a single-fund registrant: its name stands in.
      const id = (f.id && !/^n\/?a$/i.test(f.id) ? f.id : '') || ('N:' + (regs[accn] || '') + '|' + (f.name || ''));
      const had = best.get(id);
      if (!had || s.asOf > had.asOf || (s.asOf === had.asOf && s.filed > had.filed)) {
        best.set(id, { accn, id, name: tidyName(f.name) || tidyName(regs[accn]) || 'Unnamed fund', family: tidyName(regs[accn]), asOf: s.asOf, filed: s.filed || '', nav: f.nav });
      }
    }
    const out = new Map();
    for (const v of best.values()) out.set(v.accn, v);
    return out;
  }

  // One holdings row -> { accn, cusip, shares, value } or null.
  function holdingOf(c, H) {
    if (String(c[H.ASSET_CAT] || '').trim().toUpperCase() !== 'EC') return null;        // common equity only
    if (String(c[H.PAYOFF_PROFILE] || '').trim().toLowerCase() !== 'long') return null;
    if (String(c[H.UNIT] || '').trim().toUpperCase() !== 'NS') return null;              // a number of shares
    const shares = Number(c[H.BALANCE]);
    if (!(shares > 0) || !isFinite(shares)) return null;
    const cusip = String(c[H.ISSUER_CUSIP] || '').trim().toUpperCase();
    if (cusip.length !== 9) return null;
    const value = Number(c[H.CURRENCY_VALUE]);
    const usd = String(c[H.CURRENCY_CODE] || '').trim().toUpperCase() === 'USD';
    return { accn: c[H.ACCESSION_NUMBER], cusip, shares, value: usd && value > 0 && isFinite(value) ? value : 0 };
  }

  // Accumulates a data set: add(symbol, fund, shares, value), then done() ->
  // Map symbol -> Map fundId -> { name, family, asOf, nav, shares, value }.
  // A fund's several lots of one stock add up.
  function dataset() {
    const by = new Map();
    return {
      add(symbol, fund, shares, value) {
        let m = by.get(symbol);
        if (!m) by.set(symbol, m = new Map());
        const had = m.get(fund.id);
        if (had) { had.shares += shares; had.value += value; } else m.set(fund.id, { name: fund.name, family: fund.family, asOf: fund.asOf, nav: fund.nav, shares, value });
      },
      done: () => by,
    };
  }

  // One stock's summary. `prev` is the same stock in the data set before, or
  // null where there is none: then no change is claimed anywhere.
  function summarise(cur, prev, topN) {
    const now = [...(cur || new Map())];
    const before = prev || new Map();
    let shares = 0, value = 0, added = 0, from = null, to = null;
    for (const [id, h] of now) {
      shares += h.shares; value += h.value;
      if (prev && !before.has(id)) added++;
      if (h.asOf && (!from || h.asOf < from)) from = h.asOf;
      if (h.asOf && (!to || h.asOf > to)) to = h.asOf;
    }
    let sharesPrev = 0, exited = 0;
    const have = new Set(now.map(([id]) => id));
    for (const [id, h] of before) { sharesPrev += h.shares; if (!have.has(id)) exited++; }
    const top = now.sort((a, b) => b[1].shares - a[1].shares).slice(0, topN || 15).map(([id, h]) => {
      const p = before.get(id);
      return { name: h.name, family: h.family, shares: h.shares, asOf: h.asOf,
        // How much of the FUND this one stock is: its value over the fund's
        // net assets. Null where the fund reported neither.
        weight: h.nav > 0 && h.value > 0 ? h.value / h.nav * 100 : null,
        prev: prev ? (p ? p.shares : 0) : null };
    });
    return { funds: now.length, fundsPrev: prev ? before.size : null, shares, sharesPrev: prev ? sharesPrev : null,
      value, added: prev ? added : null, exited: prev ? exited : null, from, to, top };
  }

  const pctOf = (shares, out) => (shares > 0 && out > 0 ? shares / out * 100 : null);
  const change = (now, prev) => (prev > 0 && now >= 0 ? (now / prev - 1) * 100 : null);
  // 'Apr to Jun 2026' for a range of as-of dates; one month where they agree.
  function span(from, to) {
    const m = (iso) => { const t = new Date(String(iso) + 'T12:00:00'); return isNaN(t.getTime()) ? null : t; };
    const a = m(from), b = m(to);
    if (!a || !b) return '';
    const mo = (t) => t.toLocaleDateString('en-US', { month: 'short' });
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return mo(b) + ' ' + b.getFullYear();
    return a.getFullYear() === b.getFullYear() ? mo(a) + ' to ' + mo(b) + ' ' + b.getFullYear() : mo(a) + ' ' + a.getFullYear() + ' to ' + mo(b) + ' ' + b.getFullYear();
  }

  const api = { isoDate, cols, header, tidyName, pickReports, holdingOf, dataset, summarise, pctOf, change, span };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Nport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
