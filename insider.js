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
  CODES, KEEP, build, summarise, isoDate, cleanTicker, roleOf,
  parseForm4, parseDailyIndex, tagVal,
};
