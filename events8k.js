// 8-K filings: which ones a company filed, and what each one was about.
// Pure -- no network, no database. Loaded by the server and by the loader.
//
// WHAT AN 8-K IS. The "current report": a company files one within four
// business days of something material happening. Each carries one or more
// ITEM numbers saying what kind of thing -- results released (2.02), an
// officer or director arriving or leaving (5.02), a material agreement
// signed (1.01), a restatement warning (4.02). The items are the whole
// value here: they turn "the company filed something" into a category a
// reader can scan and filter.
//
// WHERE IT COMES FROM. `filings.recent` in the SEC's own
// data.sec.gov/submissions/CIK##########.json, which the filings refresh
// already downloads for every company to read one date out of it
// (SecFacts.newestResults). This reads the rest of the same block, so
// keeping events current costs no request the app was not already making.
//
// (2026-10-11. The owner had found a third-party API offering 8-K events
// and 13F holdings; both are the SEC's own public data, and this takes the
// first of them from the source.)
//
// THE NAMES ARE SHORT AND PLAIN, AND THE SEC'S OWN TITLE RIDES BESIDE EACH.
// "Departure of Directors or Certain Officers; Election of Directors;
// Appointment of Certain Officers; Compensatory Arrangements of Certain
// Officers" is one item and does not fit a table cell. The short name is
// ours; `title` is the form's.
//
// AN ITEM SAYS WHAT KIND OF EVENT, NEVER WHETHER IT IS GOOD NEWS. 5.02 is a
// retirement after forty years and it is a dismissal; 1.01 is a routine
// credit renewal and it is a merger agreement. Nothing here ranks or scores
// an event, and the page sends the reader to the filing for what happened.
(function (root) {
  'use strict';

  // code: [short name, the SEC's title, rank]. A lower rank leads when one
  // filing carries several items; 9 is housekeeping that never leads.
  const ITEMS = {
    '1.01': ['Material agreement', 'Entry into a Material Definitive Agreement', 3],
    '1.02': ['Agreement ended', 'Termination of a Material Definitive Agreement', 3],
    '1.03': ['Bankruptcy', 'Bankruptcy or Receivership', 1],
    '1.04': ['Mine safety', 'Mine Safety: Reporting of Shutdowns and Patterns of Violations', 5],
    '1.05': ['Cybersecurity incident', 'Material Cybersecurity Incidents', 1],
    '2.01': ['Acquisition or disposal', 'Completion of Acquisition or Disposition of Assets', 2],
    '2.02': ['Results', 'Results of Operations and Financial Condition', 2],
    '2.03': ['New debt', 'Creation of a Direct Financial Obligation', 4],
    '2.04': ['Debt accelerated', 'Triggering Events That Accelerate or Increase a Direct Financial Obligation', 1],
    '2.05': ['Restructuring', 'Costs Associated with Exit or Disposal Activities', 2],
    '2.06': ['Impairment', 'Material Impairments', 1],
    '3.01': ['Listing notice', 'Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard', 1],
    '3.02': ['Unregistered share sale', 'Unregistered Sales of Equity Securities', 4],
    '3.03': ['Holder rights changed', 'Material Modification to Rights of Security Holders', 4],
    '4.01': ['Auditor change', 'Changes in Registrant’s Certifying Accountant', 1],
    '4.02': ['Restatement warning', 'Non-Reliance on Previously Issued Financial Statements', 1],
    '5.01': ['Change of control', 'Changes in Control of Registrant', 1],
    '5.02': ['Officer or director change', 'Departure or Appointment of Directors or Certain Officers; Compensatory Arrangements', 3],
    '5.03': ['Bylaws or fiscal year', 'Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year', 5],
    '5.04': ['Benefit plan blackout', 'Temporary Suspension of Trading Under Registrant’s Employee Benefit Plans', 5],
    '5.05': ['Code of ethics', 'Amendments to the Registrant’s Code of Ethics, or Waiver of a Provision', 5],
    '5.06': ['Shell status', 'Change in Shell Company Status', 4],
    '5.07': ['Shareholder vote', 'Submission of Matters to a Vote of Security Holders', 5],
    '5.08': ['Director nominations', 'Shareholder Director Nominations', 5],
    '7.01': ['Reg FD disclosure', 'Regulation FD Disclosure', 6],
    '8.01': ['Other event', 'Other Events', 6],
    '9.01': ['Exhibits', 'Financial Statements and Exhibits', 9],
  };
  // The uncommon ones a reader would want pointed out. A fact about the
  // category, not a judgement of the company: each of these is rare and is
  // never routine housekeeping.
  const NOTABLE = new Set(['1.03', '1.05', '2.04', '2.06', '3.01', '4.01', '4.02', '5.01']);
  const FORMS = new Set(['8-K', '8-K/A']);
  const KEEP_DAYS = 400;
  const KEEP_MAX = 40;

  const codesOf = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => /^\d\.\d\d$/.test(x));
  const rank = (c) => (ITEMS[c] ? ITEMS[c][2] : 7);
  // Leading item first; a code not in the catalogue keeps its number.
  const ordered = (codes) => codes.slice().sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1));
  const nameOf = (c) => (ITEMS[c] ? ITEMS[c][0] : 'Item ' + c);

  // `filings.recent` -> events, newest first: { accn, filed, form, items,
  // reportDate, doc }. `since` is an ISO date; older filings are dropped.
  function parse(recent, since) {
    if (!recent || !Array.isArray(recent.form)) return [];
    const out = [];
    for (let i = 0; i < recent.form.length; i++) {
      if (!FORMS.has(recent.form[i])) continue;
      const filed = String((recent.filingDate || [])[i] || '').slice(0, 10);
      const accn = String((recent.accessionNumber || [])[i] || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filed) || !accn) continue;
      if (since && filed < since) continue;
      out.push({
        accn, filed, form: recent.form[i],
        items: ordered(codesOf((recent.items || [])[i])).join(','),
        reportDate: String((recent.reportDate || [])[i] || '').slice(0, 10) || null,
        doc: String((recent.primaryDocument || [])[i] || '') || null,
      });
    }
    out.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
    return out.slice(0, KEEP_MAX);
  }

  // What a table cell says: the leading items by name, housekeeping left out
  // unless it is all there is. "Results" for 2.02,9.01; "Officer or director
  // change · Material agreement" for 5.02,1.01,9.01; "+1" past two.
  function label(items, max) {
    const all = ordered(codesOf(items));
    const real = all.filter((c) => c !== '9.01');
    const use = real.length ? real : all;
    if (!use.length) return 'No item given';
    const m = Math.max(1, max || 2);
    return use.slice(0, m).map(nameOf).join(' · ') + (use.length > m ? ' +' + (use.length - m) : '');
  }
  const notable = (items) => codesOf(items).some((c) => NOTABLE.has(c));
  const detail = (items) => ordered(codesOf(items)).map((c) => ({ code: c, name: nameOf(c), title: ITEMS[c] ? ITEMS[c][1] : null, notable: NOTABLE.has(c) }));

  // The document itself where the feed names one, else the filing's index.
  function url(cik, accn, doc) {
    if (!cik || !accn) return null;
    const base = 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/';
    return doc && /^[\w.\-]+$/.test(doc) ? base + doc : base + accn + '-index.htm';
  }
  const sinceDate = (now) => new Date((now || Date.now()) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);

  const api = { ITEMS, NOTABLE, KEEP_DAYS, KEEP_MAX, parse, label, notable, detail, url, codesOf, sinceDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Events8k = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
