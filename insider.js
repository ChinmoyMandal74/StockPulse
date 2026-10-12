// SEC Forms 3/4/5 — what the people running a company did with their own money.
//
// PURE: no database, no network, no universe. It takes the rows of the SEC's
// quarterly Form 345 data sets and gives back transactions and a summary.
// Orchestration lives in insider-load.js (the bulk load, local) and server.js
// (the read) — the shape secfacts.js and news.js already follow.
//
// IT IS FOR DISPLAY, like the filings card. Nothing here may reach the Advice
// engine or the screener; see the boundary note in CLAUDE.md.
'use strict';

// ---- which transactions are a DECISION -----------------------------------
//
// THE CODE IS THE WHOLE GAME. Measured on 2026 Q2: of 78,328 non-derivative
// transactions, **5,326 are open-market purchases** — 6.8%. The rest is
// compensation machinery: 19,211 grants, 10,783 option exercises, 9,357
// lots of shares withheld to pay tax. A grant is not a decision, withholding
// is automatic, and an exercise is usually a sale wearing a hat.
//
// A screen that counts "insider activity" without this filter is measuring
// payroll. Only P and S are kept.
const CODES = {
  P: { word: 'Bought', buy: true },
  S: { word: 'Sold', buy: false },
};
const KEEP = new Set(Object.keys(CODES));

// The relationship flags arrive as a comma-joined string on the owner row.
function roleOf(rel, title) {
  const r = String(rel || '').toLowerCase();
  const t = String(title || '').trim();
  if (t) return t;                                  // the filer's own words win
  if (r.includes('officer')) return 'Officer';
  if (r.includes('director')) return 'Director';
  if (r.includes('tenpercent')) return '10% owner';
  return null;
}

const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const pos = (n) => (n != null && n > 0 ? n : null);

// SEC dates in these files are `30-JUN-2026`.
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function isoDate(s) {
  const t = String(s || '').trim();
  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(t);
  if (m) {
    const mm = MONTHS[m[2].toUpperCase()];
    if (!mm) return null;
    return m[3] + '-' + String(mm).padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? m[0] : null;
}

// ---- one quarter's rows -> transactions -----------------------------------
//
// `subs` is SUBMISSION.tsv, `owners` REPORTINGOWNER.tsv, `trans`
// NONDERIV_TRANS.tsv, each as an array of objects keyed by column name.
//
// KEYED ON THE ISSUER'S CIK, NEVER ITS TICKER. Measured: 763 of 56,102
// filings (1.4%) carry `NONE` or `N/A` in ISSUERTRADINGSYMBOL — which would
// collapse 117 unrelated companies into one fake symbol called NONE — while
// every single filing carries ISSUERCIK. The ticker is kept for display and
// is never the join.
function build(subs, owners, trans) {
  const sub = new Map();
  for (const s of subs) sub.set(s.ACCESSION_NUMBER, s);
  // A FILING CAN NAME SEVERAL OWNERS — 1,229 of 56,102 in one quarter
  // (2.2%), usually a couple filing jointly or a fund and its manager. The
  // two ingest paths were picking DIFFERENT ones: this took the TSV's row
  // order and the XML path took document order, so the same trade was
  // attributed to a different person depending on which loaded it. Caught by
  // comparing the two sources against each other.
  //
  // Both sort by CIK and take the lowest. Arbitrary, but identical
  // everywhere, which is the property that actually matters. The COUNT is
  // kept so the card can say "+1 other" rather than quietly crediting one
  // spouse with the pair's trade.
  const ownAll = new Map();
  for (const o of owners) {
    const k = o.ACCESSION_NUMBER;
    if (!ownAll.has(k)) ownAll.set(k, []);
    ownAll.get(k).push(o);
  }
  const own = new Map();
  for (const [k, list] of ownAll) {
    list.sort((a, b) => Number(a.RPTOWNERCIK || 0) - Number(b.RPTOWNERCIK || 0));
    own.set(k, list[0]);
  }

  const out = [];
  for (const t of trans) {
    const code = String(t.TRANS_CODE || '').trim().toUpperCase();
    if (!KEEP.has(code)) continue;
    const s = sub.get(t.ACCESSION_NUMBER);
    if (!s) continue;
    const cik = num(s.ISSUERCIK);
    if (!cik) continue;
    const shares = num(t.TRANS_SHARES);
    // A ZERO PRICE IS NOT A PRICE. 79 of one quarter's P/S rows carry
    // exactly 0 — the bulk extract rounds to two decimals, so a sub-cent
    // trade lands there — and `shares * 0` would print a confident "$0"
    // where the honest answer is a dash. Reject the empty before coercing,
    // the rule this project has now needed in five places.
    const price = pos(num(t.TRANS_PRICEPERSHARE));
    const o = own.get(t.ACCESSION_NUMBER) || {};
    // FILED is the date it became public and TRANS is the date it happened;
    // both are kept, because anything measuring this must use the first.
    const filed = isoDate(s.FILING_DATE);
    const tdate = isoDate(t.TRANS_DATE);
    if (!filed || !tdate) continue;
    out.push({
      cik,
      symbol: cleanTicker(s.ISSUERTRADINGSYMBOL),
      issuer: (s.ISSUERNAME || '').trim() || null,
      accn: t.ACCESSION_NUMBER,
      seq: num(t.NONDERIV_TRANS_SK) || 0,
      form: (s.DOCUMENT_TYPE || '').trim() || null,
      filed,
      transDate: tdate,
      code,
      buy: CODES[code].buy ? 1 : 0,
      shares,
      price,
      // A transaction with no price is a transfer of some kind; the value is
      // left null rather than guessed at from the day's close.
      value: (shares != null && price != null) ? Math.round(shares * price) : null,
      sharesAfter: num(t.SHRS_OWND_FOLWNG_TRANS),
      ownerCik: num(o.RPTOWNERCIK),
      ownerName: (o.RPTOWNERNAME || '').trim() || null,
      ownerRole: roleOf(o.RPTOWNER_RELATIONSHIP, o.RPTOWNER_TITLE),
      // A 10b5-1 trade was scheduled months ahead, so it says much less about
      // what the insider thinks today. The filer marks it; we keep the mark.
      owners: (ownAll.get(t.ACCESSION_NUMBER) || [o]).length,
      planned: /1|true|y/i.test(String(s.AFF10B5ONE || '')) ? 1 : 0,
      direct: /^D/i.test(String(t.DIRECT_INDIRECT_OWNERSHIP || '')) ? 1 : 0,
    });
  }
  return out;
}

// `NONE`, `N/A` and blanks are not tickers.
function cleanTicker(v) {
  const t = String(v == null ? '' : v).trim().toUpperCase();
  if (!t || t === 'NONE' || t === 'N/A' || t === 'NA') return null;
  return t;
}

// ---- what the card says ---------------------------------------------------
//
// Summarised over a window, counting PEOPLE as well as transactions: one
// director topping up three times is one person's opinion, and three
// directors buying is the thing the literature actually likes. A count of
// transactions alone cannot tell those apart.
function summarise(rows, sinceIso) {
  const within = sinceIso ? rows.filter((r) => r.filed >= sinceIso) : rows.slice();
  const side = (buy) => {
    const rs = within.filter((r) => !!r.buy === buy);
    const people = new Set(rs.map((r) => r.ownerCik || r.ownerName));
    const valued = rs.filter((r) => r.value != null);
    return {
      trades: rs.length,
      people: people.size,
      value: valued.reduce((a, r) => a + r.value, 0),
      // Said rather than hidden: a total over 8 of 11 trades is not a total.
      valued: valued.length,
      planned: rs.filter((r) => r.planned).length,
    };
  };
  return { since: sinceIso || null, bought: side(true), sold: side(false), trades: within.length };
}

// ---- the digest ------------------------------------------------------------
//
// (2026-10-12, the owner: "can you summarize the insider transactions on
// individual stock page and promo".) The card listed up to sixty trades
// under one line of totals; a company whose officers sell every week is
// sixty rows of the same thing. This adds it up three ways: over three, six
// and twelve months; month by month; and person by person.
//
// THE SAME FILTER AS EVERYTHING ELSE HERE: open-market purchases and sales
// only, counted by PEOPLE as well as trades, with FILED as the date.
//
// WHAT A TOTAL OF SALES DOES NOT SAY, and the digest keeps the figure that
// qualifies it beside it: how much of the selling was under a 10b5-1 plan
// set up months before. An officer paid mostly in stock sells all the
// time, for tax and to diversify; a plan sale says least of all.
//
// NET IS OF THE TRADES THAT CARRY A PRICE. A transfer without one has no
// value to add, and is counted as a trade and left out of the dollars.
//
// THE ROWS HANDED IN MAY BE CAPPED (the read takes the newest N). Where the
// oldest row is newer than a window's start and the cap was hit, that
// window is `partial`: it may be missing older trades, and says so.
const DAY_MS = 86400000;
const WINDOWS = [90, 180, 365];
const PEOPLE_MAX = 10;
// 'COOK TIMOTHY D' as filed -> 'Cook Timothy D'. The order is the filer's
// and is left alone: turning it round would guess at which word is which.
function tidyName(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t || t !== t.toUpperCase()) return t;
  return t.split(' ').map((w) => (w.length <= 3 && /^(LLC|LP|INC|II|III|IV|LTD|CO|JR|SR|NV|SA|AG|PLC)\.?$/.test(w) ? w : w.split('-').map((p) => (p.charAt(0) + p.slice(1).toLowerCase()).replace(/'([a-z])/g, (m, c) => "'" + c.toUpperCase())).join('-'))).join(' ');
}
function digest(rows, today, cap) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.filed && (!today || r.filed <= today));
  if (!list.length) return null;
  const t0 = Date.parse(String(today) + 'T00:00:00Z');
  if (!isFinite(t0)) return null;
  const oldest = list.reduce((m, r) => (r.filed < m ? r.filed : m), list[0].filed);
  const capped = !!cap && rows.length >= cap;
  const key = (r) => String(r.ownerCik || r.ownerName || '?');
  const side = (rs, buy) => {
    const mine = rs.filter((r) => !!r.buy === buy);
    const valued = mine.filter((r) => r.value != null);
    const planned = valued.filter((r) => r.planned);
    return { trades: mine.length, people: new Set(mine.map(key)).size, value: valued.reduce((a, r) => a + r.value, 0),
      valued: valued.length, planned: mine.filter((r) => r.planned).length, plannedValue: planned.reduce((a, r) => a + r.value, 0) };
  };
  const peopleOf = (rs) => {
    const by = new Map();
    for (const r of rs) {
      const k = key(r);
      const p = by.get(k) || by.set(k, { name: tidyName(r.ownerName) || 'Unnamed filer', role: r.ownerRole || null, bought: 0, sold: 0, trades: 0, planned: 0, last: '', after: null, afterAt: '' }).get(k);
      p.trades++;
      if (r.planned) p.planned++;
      if (r.value != null) { if (r.buy) p.bought += r.value; else p.sold += r.value; }
      if (r.filed > p.last) p.last = r.filed;
      // What the person held after their newest trade, where the filing says.
      const at = (r.transDate || r.filed) + '|' + r.filed;
      if (r.sharesAfter != null && at >= p.afterAt) { p.after = r.sharesAfter; p.afterAt = at; }
      if (!p.role && r.ownerRole) p.role = r.ownerRole;
    }
    const all = [...by.values()].map((p) => ({ name: p.name, role: p.role, bought: p.bought, sold: p.sold, net: p.bought - p.sold,
      trades: p.trades, allPlanned: p.trades > 0 && p.planned === p.trades, last: p.last, after: p.after }));
    all.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.trades - a.trades || (a.name < b.name ? -1 : 1));
    return { count: all.length, top: all.slice(0, PEOPLE_MAX) };
  };
  const windows = WINDOWS.map((days) => {
    const since = new Date(t0 - days * DAY_MS).toISOString().slice(0, 10);
    const rs = list.filter((r) => r.filed >= since);
    const bought = side(rs, true), sold = side(rs, false);
    const ppl = peopleOf(rs);
    return { days, since, trades: rs.length, bought, sold,
      net: rs.some((r) => r.value != null) ? bought.value - sold.value : null,
      // Of the dollars sold, how much was under a plan: null with no priced sale.
      plannedShare: sold.value > 0 ? sold.plannedValue / sold.value * 100 : null,
      people: ppl.top, peopleCount: ppl.count, partial: capped && oldest > since };
  });
  // The twelve calendar months ending with this one, oldest first.
  const months = [];
  const d0 = new Date(t0);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1));
    months.push({ m: d.toISOString().slice(0, 7), bought: 0, sold: 0, buyers: new Set(), sellers: new Set() });
  }
  const at = new Map(months.map((m) => [m.m, m]));
  for (const r of list) {
    const m = at.get(r.filed.slice(0, 7));
    if (!m) continue;
    if (r.buy) { m.buyers.add(key(r)); if (r.value != null) m.bought += r.value; } else { m.sellers.add(key(r)); if (r.value != null) m.sold += r.value; }
  }
  const year = list.filter((r) => r.filed >= windows[2].since && r.value != null);
  const big = year.slice().sort((a, b) => b.value - a.value)[0] || null;
  return { today, windows,
    months: months.map((m) => ({ m: m.m, bought: m.bought, sold: m.sold, buyers: m.buyers.size, sellers: m.sellers.size })),
    largest: big ? { name: tidyName(big.ownerName) || 'Unnamed filer', role: big.ownerRole || null, buy: !!big.buy, value: big.value, filed: big.filed, planned: !!big.planned } : null,
    oldest, capped };
}

// ---- the daily top-up ------------------------------------------------------
//
// The quarterly data sets are published AFTER a quarter ends, so a table fed
// only by them runs up to 90 days behind — measured: the load reached
// 2026-06-30 while the calendar said 2026-09-28, and asking "who bought in
// the last 90 days" returned 3 names when the truth was 188. Fine under a
// card that prints a filing date on every row; a lie anywhere that presents
// itself as current.
//
// So the recent end is filled from the filings themselves. A complete Form 4
// submission is ~5KB, and the ownership block inside it is regular enough to
// read without adding an XML dependency to a project that has three.
//
// PARSED WITH TARGETED EXTRACTION, NOT A GENERAL PARSER, and validated
// against the SEC's own quarterly extract of the same filings rather than
// against my reading of the schema — see insider-xml-test.js.

// Values appear either bare (`<issuerCik>0000001800</issuerCik>`) or wrapped
// (`<transactionDate><value>2026-09-23</value></transactionDate>`), so the
// optional <value> is part of the pattern rather than two functions.
function tagVal(xml, tag) {
  const m = new RegExp('<' + tag + '>\\s*(?:<value>\\s*)?([^<]*)').exec(xml);
  const v = m ? m[1].trim() : '';
  return v === '' ? null : v;
}
const blocks = (xml, tag) => {
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
};
const truthy = (v) => /^(1|true|y|yes)$/i.test(String(v || '').trim());

// `filed` is NOT in the ownership document — it carries `periodOfReport`,
// which is when the trade happened. The filing date comes from the daily
// index that pointed us here, and it is the one that matters: the trade is
// private until it is filed.
function parseForm4(raw, meta = {}) {
  const doc = /<ownershipDocument>([\s\S]*?)<\/ownershipDocument>/.exec(String(raw || ''));
  if (!doc) return [];
  const xml = doc[1];
  const cik = Number(tagVal(xml, 'issuerCik'));
  if (!Number.isFinite(cik) || cik <= 0) return [];
  const symbol = cleanTicker(tagVal(xml, 'issuerTradingSymbol'));
  const issuer = tagVal(xml, 'issuerName');
  const planned = truthy(tagVal(xml, 'aff10b5One')) ? 1 : 0;
  const form = tagVal(xml, 'documentType') || meta.form || '4';

  // The SAME rule the bulk path uses — lowest CIK — because taking
  // "the first one in the document" and "the first row in the TSV" gave
  // different people for the 2.2% of filings that name several.
  const owAll = blocks(xml, 'reportingOwner');
  const ow = owAll.slice().sort((a, b) =>
    (numOf(tagVal(a, 'rptOwnerCik')) || 0) - (numOf(tagVal(b, 'rptOwnerCik')) || 0))[0] || '';
  const rel = [
    truthy(tagVal(ow, 'isDirector')) ? 'Director' : '',
    truthy(tagVal(ow, 'isOfficer')) ? 'Officer' : '',
    truthy(tagVal(ow, 'isTenPercentOwner')) ? 'TenPercentOwner' : '',
  ].filter(Boolean).join(',');

  const out = [];
  const trs = blocks(xml, 'nonDerivativeTransaction');
  for (let i = 0; i < trs.length; i++) {
    const t = trs[i];
    const code = (tagVal(t, 'transactionCode') || '').toUpperCase();
    if (!KEEP.has(code)) continue;              // the same filter, in one place
    const shares = numOf(tagVal(t, 'transactionShares'));
    const price = pos(numOf(tagVal(t, 'transactionPricePerShare')));
    const tdate = isoDate(tagVal(t, 'transactionDate'));
    if (!tdate || !meta.filed) continue;
    out.push({
      cik,
      symbol,
      issuer,
      accn: meta.accn || null,
      // The bulk file's own key is a global sequence we cannot reproduce, so
      // the position within the filing is used instead. (accn, seq) stays
      // unique, which is all the primary key needs.
      seq: i + 1,
      form,
      filed: meta.filed,
      transDate: tdate,
      code,
      buy: CODES[code].buy ? 1 : 0,
      shares,
      price,
      value: (shares != null && price != null) ? Math.round(shares * price) : null,
      sharesAfter: numOf(tagVal(t, 'sharesOwnedFollowingTransaction')),
      ownerCik: numOf(tagVal(ow, 'rptOwnerCik')),
      ownerName: tagVal(ow, 'rptOwnerName'),
      ownerRole: roleOf(rel, tagVal(ow, 'officerTitle')),
      owners: Math.max(1, owAll.length),
      planned,
      direct: /^D/i.test(String(tagVal(t, 'directOrIndirectOwnership') || 'D')) ? 1 : 0,
    });
  }
  return out;
}

function numOf(v) {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// One line of a daily form index:
//   `4  ABBOTT LABORATORIES  1800  20260925  edgar/data/1800/0001306119-26-000009.txt`
// Fixed-width in theory; split on runs of spaces in practice, from the right,
// because a company name contains single spaces and the path never does.
function parseDailyIndex(text, wantForms = new Set(['4', '4/A', '3', '5'])) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\s*(3|4|5)(\/A)?\s/.test(line)) continue;
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 5) continue;
    const form = parts[0].trim();
    if (!wantForms.has(form)) continue;
    const path = parts[parts.length - 1].trim();
    const date = parts[parts.length - 2].trim();
    const cik = Number(parts[parts.length - 3]);
    const accn = (/([0-9]{10}-[0-9]{2}-[0-9]{6})/.exec(path) || [])[1] || null;
    if (!accn || !Number.isFinite(cik)) continue;
    out.push({
      form,
      cik,                                   // the FILER's cik, not the issuer's
      filed: /^\d{8}$/.test(date)
        ? date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8) : null,
      accn,
      path: path.startsWith('http') ? path : 'https://www.sec.gov/Archives/' + path,
    });
  }
  return out;
}

module.exports = {
  digest, tidyName, WINDOWS,
  CODES, KEEP, build, summarise, isoDate, cleanTicker, roleOf,
  parseForm4, parseDailyIndex, tagVal,
};
