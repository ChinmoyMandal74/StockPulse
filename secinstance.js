// A report the SEC's facts feed does not carry, read from the report itself.
//
// WHY (2026-10-13). The filings table is filled from one feed,
// data.sec.gov/api/xbrl/companyfacts. The SEC probe (secprobe.js) found that
// feed two to three months behind the SEC's own filing list for about 110
// companies: Ford, Visa, PayPal and the rest had a June 10-Q on the list and
// no fact from it in the feed, and Citigroup had neither its March nor its
// June one. No re-read could help, because the figures were not there to read.
//
// Every report has its figures in a data file of its own beside the document
// (`<stem>_htm.xml`, the XBRL instance) -- the file segments.js already reads
// for the revenue breakdown. So where a report is on the list and absent from
// the feed, its instance is read and its figures are put INTO THE FEED'S OWN
// SHAPE before the reader runs. Nothing downstream changes: `normalise` sees
// one more filing, with the same tags, and builds its rows, its derived
// quarters and its ratios exactly as it does for any other.
//
// WHAT IS TAKEN. Only the tags the reader's catalogue names, and only figures
// for the company as a whole: a context with a dimension (a segment, a class
// of share, a subsidiary) is a breakdown and is left out, as the feed leaves
// it out. A report's comparatives come too -- the same quarter a year ago,
// the year to date -- as they do in the feed.
//
// PURE. No fetch and no database: the caller fetches the file and keeps what
// was read, so a report is fetched once and not on every refresh while the
// feed stays behind.
//
// DISPLAY ONLY, like the rest of the filings table. Nothing here reaches the
// Signal.
const SecFacts = require('./secfacts');

const MAX_GAPS = 3;              // reports read for one company on one visit
const FORMS = /^(10-K|10-Q|20-F|40-F)$/i;   // not amendments: they often carry no figures
const STATEMENT = /^(10-K|10-Q|20-F|40-F)(\/A)?$/i;

// The reports on the list that the feed knows nothing of, OLDEST FIRST, and
// only those filed after the newest thing the feed does carry: an old report
// missing from the feed is a paper-era filing, not a lagging one, and has no
// data file to read.
function missing(recent, facts) {
  const out = [];
  if (!recent || !Array.isArray(recent.form) || !facts || !facts.facts) return out;
  const seen = new Set(); let newest = '';
  for (const sec of Object.keys(facts.facts)) {
    for (const tag of Object.keys(facts.facts[sec] || {})) {
      const units = (facts.facts[sec][tag] && facts.facts[sec][tag].units) || {};
      for (const u of Object.keys(units)) {
        for (const x of units[u] || []) {
          if (!x || !x.accn) continue;
          seen.add(x.accn);
          // "Newest" is the newest REPORT the feed carries. Citigroup's feed
          // has prospectus fee tables filed after reports it lacks; dated by
          // those, both missing reports looked older than the feed and
          // neither was read.
          if (x.filed && x.filed > newest && STATEMENT.test(String(x.form || ''))) newest = x.filed;
        }
      }
    }
  }
  // A feed with nothing in it is a company the SEC has no figures for at
  // all. That is a different condition and not this module's to repair.
  if (!newest) return out;
  for (let i = 0; i < recent.form.length; i++) {
    const form = String(recent.form[i] || '');
    if (!FORMS.test(form)) continue;
    const accn = String((recent.accessionNumber || [])[i] || '');
    const doc = String((recent.primaryDocument || [])[i] || '');
    const filed = String((recent.filingDate || [])[i] || '').slice(0, 10);
    if (!accn || !doc || !/^\d{4}-\d{2}-\d{2}$/.test(filed)) continue;
    if (seen.has(accn) || filed <= newest) continue;
    out.push({ accn, form, filed, doc });
  }
  out.sort((a, b) => (a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : 0));
  return out.slice(-MAX_GAPS);
}

// Where the report's data file lives.
function url(cik, report) {
  if (!cik || !report || !/^[\w.\-]+\.html?$/i.test(report.doc || '')) return null;
  return 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' +
    String(report.accn).replace(/-/g, '') + '/' + report.doc.replace(/\.html?$/i, '') + '_htm.xml';
}

const attr = (tag, name) => { const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
const local = (s) => String(s || '').replace(/^.*:/, '');

// Contexts for the company as a whole: id -> { start, end }. `start` is null
// for a balance-sheet date. Anything with a dimension is skipped.
function contexts(xml) {
  const out = {};
  for (const m of xml.matchAll(/<(?:\w+:)?context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?context>/g)) {
    const body = m[2];
    if (/explicitMember|typedMember/.test(body)) continue;
    const s = /<(?:\w+:)?startDate>\s*(\d{4}-\d{2}-\d{2})/.exec(body);
    const e = /<(?:\w+:)?endDate>\s*(\d{4}-\d{2}-\d{2})/.exec(body);
    const i = /<(?:\w+:)?instant>\s*(\d{4}-\d{2}-\d{2})/.exec(body);
    if (s && e) out[m[1]] = { start: s[1], end: e[1] };
    else if (i) out[m[1]] = { start: null, end: i[1] };
  }
  return out;
}

// Units, named as the feed names them: 'USD', 'shares', 'USD/shares'.
function units(xml) {
  const out = {};
  for (const m of xml.matchAll(/<(?:\w+:)?unit\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?unit>/g)) {
    const body = m[2];
    const measures = [...body.matchAll(/<(?:\w+:)?measure>\s*([^<\s]+)\s*</g)].map((x) => local(x[1]));
    if (/<(?:\w+:)?divide>/.test(body)) { if (measures.length === 2) out[m[1]] = measures[0] + '/' + measures[1]; }
    else if (measures.length === 1) out[m[1]] = measures[0];
  }
  return out;
}

// Every catalogue tag the instance states for the company as a whole:
// [{ tax, tag, unit, start, end, val }]. One figure per tag and period; a
// report that states the same fact twice states it the same way.
function extract(instanceXml) {
  const xml = String(instanceXml || '');
  if (!/<(?:\w+:)?context\s/.test(xml)) return [];
  const want = { 'us-gaap': new Set(), 'ifrs-full': new Set() };
  for (const k of Object.keys(SecFacts.CONCEPTS)) for (const t of SecFacts.CONCEPTS[k]) want['us-gaap'].add(t);
  for (const k of Object.keys(SecFacts.IFRS_CONCEPTS)) for (const t of SecFacts.IFRS_CONCEPTS[k]) want['ifrs-full'].add(t);
  const ctx = contexts(xml), un = units(xml);
  const out = [], seen = new Set();
  const re = /<(us-gaap|ifrs-full):(\w+)\s([^>]*)>\s*(-?\d[\d.]*(?:[eE][-+]?\d+)?)\s*<\//g;
  for (const m of xml.matchAll(re)) {
    if (!want[m[1]].has(m[2])) continue;
    const c = ctx[attr(m[3], 'contextRef')];
    const unit = un[attr(m[3], 'unitRef')];
    const val = Number(m[4]);
    if (!c || !unit || !Number.isFinite(val)) continue;
    const k = m[1] + '|' + m[2] + '|' + unit + '|' + (c.start || '') + '|' + c.end;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ tax: m[1], tag: m[2], unit, start: c.start, end: c.end, val });
  }
  return out;
}

// Put a report's figures into the feed's own shape, in place. Returns how
// many were added. A report the feed has meanwhile gained is left alone: the
// feed is the authority wherever it speaks.
function inject(facts, report, obs) {
  if (!facts || !report || !Array.isArray(obs) || !obs.length) return 0;
  if (!facts.facts) facts.facts = {};
  let n = 0;
  for (const o of obs) {
    if (!o || !o.tax || !o.tag || !o.unit || !o.end) continue;
    const sec = facts.facts[o.tax] || (facts.facts[o.tax] = {});
    const tag = sec[o.tag] || (sec[o.tag] = { units: {} });
    if (!tag.units) tag.units = {};
    const list = tag.units[o.unit] || (tag.units[o.unit] = []);
    const x = { end: o.end, val: o.val, accn: report.accn, form: report.form, filed: report.filed, fy: null, fp: null };
    if (o.start) x.start = o.start;
    list.push(x);
    n++;
  }
  return n;
}

// THE CHECK THAT THIS READS A REPORT AS THE FEED DOES. For a report the feed
// DOES carry, line up what `extract` took from its data file against the
// feed's own facts under the same accession, tag, unit and period. `differ`
// should be nothing; `onlyFeed` is a figure the feed has and this missed;
// `onlyReport` is one this took and the feed did not. Counts and at most a
// few examples -- the examples name tag and period, with both values.
function compare(facts, report, obs) {
  const key = (tax, tag, unit, start, end) => tax + '|' + tag + '|' + unit + '|' + (start || '') + '|' + end;
  const want = { 'us-gaap': new Set(), 'ifrs-full': new Set() };
  for (const k of Object.keys(SecFacts.CONCEPTS)) for (const t of SecFacts.CONCEPTS[k]) want['us-gaap'].add(t);
  for (const k of Object.keys(SecFacts.IFRS_CONCEPTS)) for (const t of SecFacts.IFRS_CONCEPTS[k]) want['ifrs-full'].add(t);
  const feed = new Map();
  for (const tax of Object.keys(want)) {
    const g = (facts && facts.facts && facts.facts[tax]) || {};
    for (const tag of Object.keys(g)) {
      if (!want[tax].has(tag)) continue;
      const un = (g[tag] && g[tag].units) || {};
      for (const u of Object.keys(un)) for (const x of un[u] || []) {
        if (x && x.accn === report.accn && x.end) feed.set(key(tax, tag, u, x.start, x.end), Number(x.val));
      }
    }
  }
  const out = { feed: feed.size, report: 0, same: 0, differ: 0, onlyFeed: 0, onlyReport: 0, examples: [] };
  const mine = new Set();
  for (const o of Array.isArray(obs) ? obs : []) {
    const k = key(o.tax, o.tag, o.unit, o.start, o.end);
    mine.add(k); out.report++;
    if (!feed.has(k)) { out.onlyReport++; if (out.examples.length < 6) out.examples.push({ what: 'onlyReport', k, report: o.val }); continue; }
    const f = feed.get(k);
    if (f === o.val || Math.abs(f - o.val) <= Math.abs(f) * 1e-9) out.same++;
    else { out.differ++; if (out.examples.length < 6) out.examples.push({ what: 'differ', k, feed: f, report: o.val }); }
  }
  for (const [k, f] of feed) if (!mine.has(k)) { out.onlyFeed++; if (out.examples.length < 6) out.examples.push({ what: 'onlyFeed', k, feed: f }); }
  return out;
}

module.exports = { missing, url, contexts, units, extract, inject, compare, MAX_GAPS };
