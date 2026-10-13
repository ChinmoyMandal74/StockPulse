// How good is the filings data, and does it agree with the price provider's?
//
// WHY (2026-10-13). Two faults sat in the filings table for months with every
// status reading "ok": about 110 companies were a quarter behind because the
// SEC's facts feed lacked their newest report, and about 340 had no quarterly
// cash flow because a subtraction was fed an empty row. "ok" had only ever
// meant that a request succeeded. Both were found by accident, by comparing
// the filings with the provider's figures for another reason. This is that
// comparison made permanent, plus the checks the filings can make on
// themselves, for the SEC EDGAR data page (/edgar).
//
// TWO KINDS OF CHECK, kept apart on the page:
//   the filings alone   is the newest report on the SEC's list stored; is
//                       there a trailing year; has the newest quarter a cash
//                       flow; how old is it
//   filings v. the API  do both describe the same quarter, and where they do,
//                       do trailing revenue, net income and operating cash
//                       flow agree
//
// A DIFFERENCE IS NOT A VERDICT ON EITHER SIDE. The provider may be right and
// our reader wrong (banks, insurers and REITs: the reader picks a partial
// revenue tag), or the reverse. The page shows both figures and says so.
//
// ONLY WHAT IS COMPARABLE IS COMPARED: the same quarter in both, a company
// that reports in dollars under US GAAP. A foreign filer's stored rows are
// converted to dollars and the provider's are not, so those are counted as
// not compared rather than as disagreeing.
//
// PURE. No fetch, no clock and no database: the daily pass that already holds
// every company's rows (marginChangeBuild) hands them over, so this costs no
// read of its own. Display only, admin only; nothing here reaches the Signal.
const SecFacts = require('./secfacts');

const DAY = 86400000;
const SAME_DAYS = 10;            // two quarter-end dates this close are the same quarter
const DIFFER = 5;                // per cent: beyond this the two figures are said to differ
const OLD_DAYS = 200;            // a newest quarter older than this is a company that reports rarely, or has stopped
const REPORT_FORMS = /^(10-K|10-Q|20-F|40-F)$/i;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const at = (d) => Date.parse(String(d) + 'T12:00:00');
const daysBetween = (a, b) => Math.round((at(b) - at(a)) / DAY);

// The filing date of the newest annual or quarterly report on a company's
// list, amendments left out. Recorded on every refresh so the table can be
// asked "is the newest report on the SEC's list the newest one we hold".
function newestReport(recent) {
  if (!recent || !Array.isArray(recent.form)) return null;
  let best = null;
  for (let i = 0; i < recent.form.length; i++) {
    if (!REPORT_FORMS.test(String(recent.form[i] || ''))) continue;
    const d = String((recent.filingDate || [])[i] || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!best || d > best)) best = d;
  }
  return best;
}

// The newest four quarters, summed, or null where they are not four
// consecutive quarters or one of them lacks the figure. The same refusal
// SecFacts.ttm makes, for a figure it does not carry.
function trailing(q, key) {
  if (q.length < 4) return null;
  const span = daysBetween(q[3].periodStart || q[3].periodEnd, q[0].periodEnd);
  if (!Number.isFinite(span) || span < 300 || span > 430) return null;
  let t = 0;
  for (let i = 0; i < 4; i++) { const v = num(q[i][key]); if (v == null) return null; t += v; }
  return t;
}

// Per cent apart, on the larger of the two. Null where either is missing.
function apart(a, b) {
  if (a == null || b == null) return null;
  if (a === 0 && b === 0) return 0;
  return (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))) * 100;
}

const NO_FILINGS = { nocik: 'no company at the SEC', nofacts: 'no figures at the SEC', empty: 'nothing usable filed' };

// One company. `rows` are its stored filings rows (any order), `vendor` its
// snapshot row, `state` its sec_state reading, `dates` { filed, report } from
// the same table, `filled` the accessions read from a report's own data file.
function company(o) {
  const sym = String(o.symbol || '').toUpperCase();
  const v = o.vendor || {};
  const st = o.state || null;
  const out = { s: sym, n: v.shortName || v.name || null, type: v.instrumentType || null, flags: [], q: null, filed: null,
    vq: v.mostRecentQuarter || null, t: null, rev: null, ni: null, ocf: null };
  const status = st ? st.status : 'never';
  const rows = Array.isArray(o.rows) ? o.rows : [];
  const quarters = SecFacts.latestFilled(rows).filter((r) => r.periodType === 'Q')
    .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0));

  // ---- the filings alone ---------------------------------------------------
  if (status === 'never') out.flags.push('never fetched');
  else if (status === 'error') out.flags.push('fetch failed');
  else if (status === 'currency') out.flags.push('currency not converted');
  else if (NO_FILINGS[status]) out.flags.push(NO_FILINGS[status]);
  const dates = o.dates || {};
  // The newest report on the SEC's list is newer than the newest we hold.
  // Only said where both dates are known: a company fetched before the list
  // date was recorded says nothing either way.
  if (dates.report && dates.filed && dates.report > dates.filed) out.flags.push('behind the SEC list');
  if (quarters.length) {
    const top = quarters[0];
    out.q = top.periodEnd; out.filed = top.filed || null;
    if (o.filled && o.filled.has(top.accn)) out.flags.push('read from the report');
    if (o.today && daysBetween(top.periodEnd, o.today) > OLD_DAYS) out.flags.push('newest quarter is old');
    if (!SecFacts.ttm(quarters)) out.flags.push('no trailing year');
    if (num(top.operatingCashFlow) == null) out.flags.push('no cash flow');
  } else if (status === 'ok') {
    // A company that files a year at a time (a 20-F or 40-F filer) has years
    // and no quarters. That is how it reports, not something missing.
    out.flags.push(rows.some((r) => r.periodType === 'FY') ? 'annual reports only' : 'no quarters');
  }

  // ---- against the provider ------------------------------------------------
  const hasVendor = num(v.revenueTtm) != null || num(v.netIncomeTtm) != null;
  if (!quarters.length) {
    if (hasVendor) out.flags.push('API only');
    return out;
  }
  if (!hasVendor) { out.flags.push('filings only'); return out; }
  if (out.vq) {
    const lag = daysBetween(out.vq, out.q);          // positive: the filings are newer
    out.t = Math.abs(lag) <= SAME_DAYS ? 'same' : lag > 0 ? 'filings' : 'api';
    if (out.t === 'api') out.flags.push('API ahead');
    if (out.t === 'filings') out.flags.push('filings ahead');
  }
  const foreign = !!(st && (st.currency || (st.taxonomy && st.taxonomy !== 'us-gaap')));
  if (foreign) { out.flags.push('not compared (currency)'); return out; }
  if (out.t !== 'same') return out;
  const pair = (key, mine, name) => {
    const a = num(v[key]);
    if (a == null || mine == null) return;
    const d = apart(a, mine);
    out[name] = [a, mine, Math.round(d * 10) / 10];
    if (d > DIFFER) out.flags.push({ rev: 'revenue differs', ni: 'net income differs', ocf: 'cash flow differs' }[name]);
  };
  const t = SecFacts.ttm(quarters);
  pair('revenueTtm', t ? num(t.revenue) : null, 'rev');
  pair('netIncomeTtm', trailing(quarters, 'netIncome'), 'ni');
  pair('operatingCashFlowTtm', trailing(quarters, 'operatingCashFlow'), 'ocf');
  return out;
}

// Which flags are a fault to look at, and which are simply a fact about the
// company. The page colours by this and nothing else decides it.
const KIND = {
  'never fetched': 'fault', 'fetch failed': 'fault', 'behind the SEC list': 'fault', 'no quarters': 'fault',
  'no trailing year': 'gap', 'no cash flow': 'gap', 'currency not converted': 'gap',
  'API ahead': 'gap', 'revenue differs': 'gap', 'net income differs': 'gap', 'cash flow differs': 'gap',
  'filings ahead': 'note', 'read from the report': 'note', 'annual reports only': 'note', 'newest quarter is old': 'note',
  'no company at the SEC': 'note', 'no figures at the SEC': 'note', 'nothing usable filed': 'note',
  'API only': 'note', 'filings only': 'note', 'not compared (currency)': 'note',
};

function summarise(list) {
  const flags = {};
  const timing = { same: 0, api: 0, filings: 0, unknown: 0 };
  const agree = { rev: { n: 0, within: 0 }, ni: { n: 0, within: 0 }, ocf: { n: 0, within: 0 } };
  let withFilings = 0, clean = 0;
  for (const r of list) {
    for (const f of r.flags) flags[f] = (flags[f] || 0) + 1;
    if (r.q) { withFilings++; timing[r.t || 'unknown']++; }
    if (r.q && !r.flags.some((f) => KIND[f] !== 'note')) clean++;
    for (const k of Object.keys(agree)) if (r[k]) { agree[k].n++; if (r[k][2] <= DIFFER) agree[k].within++; }
  }
  return { companies: list.length, withFilings, clean, flags, timing, agree, differ: DIFFER };
}

// Everything, from what the daily pass already holds.
function build(o) {
  const vendor = new Map();
  for (const s of o.stocks || []) if (s && s.symbol) vendor.set(String(s.symbol).toUpperCase(), s);
  const list = [];
  for (const symbol of o.universe || []) {
    const sym = String(symbol).toUpperCase();
    try {
      list.push(company({ symbol: sym, vendor: vendor.get(sym), rows: o.facts && o.facts.get(sym),
        state: o.state && o.state[sym], dates: o.dates && o.dates[sym], filled: o.filled && o.filled.get(sym), today: o.today }));
    } catch (e) { list.push({ s: sym, n: null, flags: ['could not be checked'], q: null, filed: null, vq: null, t: null, rev: null, ni: null, ocf: null }); }
  }
  return { rows: list, summary: summarise(list) };
}

module.exports = { newestReport, trailing, apart, company, summarise, build, KIND, DIFFER, SAME_DAYS, OLD_DAYS };
