// Large-holder filings: Schedules 13D and 13G. Who crossed 5% of a company,
// how much they hold, and which of the two forms they chose.
// Pure apart from `collect`, which is handed the fetch it uses.
//
// THE TWO FORMS. Anyone who comes to own more than 5% of a class of a
// company's shares must say so. A 13D is filed by a holder who may seek to
// influence or control the company; a 13G is the short form for a passive
// one -- an index fund, an institution holding in the ordinary course. An
// amendment (/A) reports a change, including falling back under 5%.
//
// WHERE IT COMES FROM. Two steps, and the second is new traffic:
//   1. The SEC's per-company submissions list, which the filings refresh
//      already downloads, names each such filing -- but not who filed it or
//      how much they hold.
//   2. So each filing's own document is fetched ONCE: a small XML file
//      (about 5KB), structured since the SEC required it in December 2024,
//      carrying the holder's name, the shares and the percentage.
// A filing already stored is never fetched again.
//
// A COMPANY'S OWN LIST ALSO HOLDS THE 13Gs IT FILED ABOUT OTHER COMPANIES.
// Palantir's list carries its 13G on Surf Air Mobility. Each document names
// its issuer, and one whose issuer is not this company is recorded as "not
// about this company" (kind 'X') so it is neither shown nor fetched again.
// Found on the second company probed; without the check Palantir would have
// been listed as a 5% holder of itself.
//
// ONLY THE STRUCTURED FORMS ARE READ. Before December 2024 these were filed
// as "SC 13D" and "SC 13G", free-form documents with no fields; they fall
// outside the 400-day window kept here in any case.
//
// WHICH FORM A HOLDER CHOSE IS A FACT; WHAT IT MEANS FOR THE SHARE IS NOT
// SAID. A 13D is not "an activist is coming" -- founders and controlling
// holders file them for decades -- and nothing here ranks or colours one.
(function (root) {
  'use strict';

  const FORMS = { 'SCHEDULE 13D': 'D', 'SCHEDULE 13D/A': 'D', 'SCHEDULE 13G': 'G', 'SCHEDULE 13G/A': 'G' };
  const KEEP_DAYS = 400;
  const sinceDate = (now) => new Date((now || Date.now()) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);

  // `filings.recent` -> the filings worth a look, newest first.
  function pick(recent, since) {
    if (!recent || !Array.isArray(recent.form)) return [];
    const out = [];
    for (let i = 0; i < recent.form.length; i++) {
      const kind = FORMS[recent.form[i]];
      if (!kind) continue;
      const filed = String((recent.filingDate || [])[i] || '').slice(0, 10);
      const accn = String((recent.accessionNumber || [])[i] || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filed) || !/^\d{10}-\d{2}-\d{6}$/.test(accn)) continue;
      if (since && filed < since) continue;
      out.push({ accn, filed, form: recent.form[i], kind });
    }
    out.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
    return out;
  }

  // The filings are written by several vendors' software, some with a
  // namespace prefix on every tag and some with none, so a tag is matched
  // with or without one. Read with patterns rather than an XML parser: the
  // file is machine-made, small, and this wants five fields from it.
  const tag = (name) => new RegExp('<(?:\\w+:)?' + name + '\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + name + '>', 'gi');
  const first = (xml, name) => { const m = tag(name).exec(xml); return m ? unesc(m[1]) : null; };
  const unesc = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/\s+/g, ' ').trim();
  const num = (s) => { if (s == null || s === '') return null; const v = Number(String(s).replace(/[,%\s]/g, '')); return isFinite(v) ? v : null; };
  // MM/DD/YYYY, as these forms write a date, to ISO.
  const iso = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : null; };

  // One document -> { issuerCik, eventDate, persons: [{ name, shares, pct }] }.
  // The 13D and the 13G name the same things differently; both are read.
  function parseDoc(xml) {
    const t = String(xml || '');
    if (!/edgarSubmission/i.test(t)) return null;
    const issuer = first(t, 'issuerCik');                        // matches issuerCIK too: the pattern is case-blind
    const persons = [];
    const blocks = [...t.matchAll(tag('reportingPersonInfo'))].concat([...t.matchAll(tag('coverPageHeaderReportingPersonDetails'))]);
    for (const b of blocks) {
      const name = first(b[1], 'reportingPersonName');
      if (!name) continue;
      persons.push({
        name: name.slice(0, 120),
        shares: num(first(b[1], 'aggregateAmountOwned') != null ? first(b[1], 'aggregateAmountOwned') : first(b[1], 'reportingPersonBeneficiallyOwnedAggregateNumberOfShares')),
        pct: num(first(b[1], 'percentOfClass') != null ? first(b[1], 'percentOfClass') : first(b[1], 'classPercent')),
      });
    }
    return { issuerCik: issuer ? Number(issuer) : null,
      eventDate: iso(first(t, 'dateOfEvent') || first(t, 'eventDateRequiresFilingThisStatement')), persons };
  }

  // The row a filing becomes. JOINT FILERS REPORT ONE HOLDING SEVERAL TIMES:
  // a fund, its manager and the manager's owner each list the same shares.
  // So the row is the largest stake reported, never the sum, with how many
  // persons signed it.
  function rowOf(c, doc, cik) {
    const base = { accn: c.accn, filed: c.filed, form: c.form, amended: /\/A$/.test(c.form) };
    if (!doc || doc.issuerCik == null || Number(doc.issuerCik) !== Number(cik) || !doc.persons.length) return Object.assign(base, { kind: 'X' });
    // WHOSE NAME, when several report the same stake: the FIRST one listed.
    // A filing names its principal first (Starboard Value LP) and the people
    // behind it after (Peter Feld), all on one holding; sorting them left
    // the choice to chance and put an individual's name on a fund's stake.
    // Seen on Qorvo in the first dry run.
    const top = Math.max(...doc.persons.map((x) => (x.pct == null ? -1 : x.pct)));
    const lead = doc.persons.find((x) => (x.pct == null ? -1 : x.pct) >= top - 0.05) || doc.persons[0];
    // A percentage past 100 is a typing error in the filing, not a stake.
    const pct = lead.pct != null && lead.pct >= 0 && lead.pct <= 100 ? lead.pct : null;
    return Object.assign(base, { kind: c.kind, holder: lead.name, shares: lead.shares, pct, persons: doc.persons.length, eventDate: doc.eventDate });
  }

  const docUrl = (cik, accn) => 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/primary_doc.xml';
  const pageUrl = (cik, accn) => (cik && accn ? 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/' + accn + '-index.htm' : null);

  // The filings of one company not yet stored, fetched and read: at most
  // `max` documents, in sequence. `getDoc(url)` returns { status, text }.
  // A 429 stops the whole call and says so; a document that cannot be read
  // (404, not the structured form) is recorded 'X' so it is not asked for
  // again; any other failure leaves the filing unrecorded, to be retried.
  async function collect(o) {
    const todo = pick(o.recent, o.since).filter((c) => !o.have.has(c.accn)).slice(0, Math.max(1, o.max || 3));
    const rows = [];
    let throttled = false;
    for (const c of todo) {
      let r;
      try { r = await o.getDoc(docUrl(o.cik, c.accn)); } catch (e) { continue; }
      if (r.status === 429) { throttled = true; break; }
      if (r.status === 404) { rows.push(rowOf(c, null, o.cik)); continue; }
      if (r.status !== 200) continue;
      rows.push(rowOf(c, parseDoc(r.text), o.cik));
      if (o.gap) await new Promise((ok) => setTimeout(ok, o.gap));
    }
    return { rows, throttled, left: Math.max(0, pick(o.recent, o.since).filter((c) => !o.have.has(c.accn)).length - rows.length) };
  }

  // A cell's words: "13D · Cohen Ryan · 8.9%".
  const kindWord = (k) => (k === 'D' ? '13D' : '13G');
  // Zero is an amendment saying the holder no longer has a stake to report,
  // and reads as that rather than as a number.
  const pctWord = (p) => (p == null ? '' : p === 0 ? 'no holding' : (p > 0 && p < 0.1 ? '<0.1' : p >= 10 ? p.toFixed(1).replace(/\.0$/, '') : p.toFixed(1)) + '%');
  function label(kind, holder, pct, max) {
    const m = max || 22;
    const h = String(holder || '').length > m ? String(holder).slice(0, m - 1).trimEnd() + '…' : String(holder || '');
    return [kindWord(kind), h, pctWord(pct)].filter(Boolean).join(' · ');
  }

  const api = { FORMS, KEEP_DAYS, sinceDate, pick, parseDoc, rowOf, collect, docUrl, pageUrl, label, kindWord, pctWord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Holders13 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
