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
  const own = new Map();
  for (const o of owners) {
    if (!own.has(o.ACCESSION_NUMBER)) own.set(o.ACCESSION_NUMBER, o);   // the first named filer
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
    const price = num(t.TRANS_PRICEPERSHARE);
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

module.exports = { CODES, KEEP, build, summarise, isoDate, cleanTicker, roleOf };
