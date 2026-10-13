// Why is this company's newest quarter not in our filings table?
//
// A diagnosis, not a data path: given what the SEC answers for ONE company it
// says where the newest statements stop -- at the SEC's own facts feed, in our
// reader, or in what we have stored. It was written on 2026-10-13, when a
// comparison with the vendor's figures found about 110 companies whose stored
// filings ended a quarter before the results they had already announced.
//
// Three things are compared, filing by filing:
//   the LIST   data.sec.gov/submissions: every filing the company has made
//   the FEED   data.sec.gov/api/xbrl/companyfacts: the tagged figures
//   the READER secfacts.normalise over that feed -- exactly what a refresh stores
// and beside them what the table holds today.
//
// PURE. No fetch, no clock and no database in here: the route hands over the
// two responses and the stored rows, so the verdicts are testable on fixtures.
// Nothing this returns is stored, and nothing here reaches the Signal.
const SecFacts = require('./secfacts');

const STATEMENT = /^(10-K|10-Q|20-F|40-F)(\/A)?$/i;
const SHOWN = 6;                 // the newest statement filings looked at

// The newest statement filings on the list, newest first.
function statements(recent) {
  const out = [];
  if (!recent || !Array.isArray(recent.form)) return out;
  for (let i = 0; i < recent.form.length; i++) {
    if (!STATEMENT.test(String(recent.form[i] || ''))) continue;
    out.push({
      accn: recent.accessionNumber[i], form: recent.form[i],
      filed: recent.filingDate[i] || null,
      period: (recent.reportDate && recent.reportDate[i]) || null,
    });
  }
  out.sort((a, b) => (String(a.filed) < String(b.filed) ? 1 : -1));
  return out;
}

// Every tag in the feed that says anything under one accession: how many
// observations, and which of them the reader's catalogue would pick up.
function feedFor(facts, tax) {
  const by = new Map();            // accn -> { n, tags:Set }
  const g = (facts && facts.facts && facts.facts[tax]) || {};
  let newestFiled = null, newestEnd = null;
  for (const tag of Object.keys(g)) {
    const units = (g[tag] && g[tag].units) || {};
    for (const u of Object.keys(units)) {
      for (const x of units[u] || []) {
        if (!x || !x.accn) continue;
        let o = by.get(x.accn);
        if (!o) { o = { n: 0, tags: new Set() }; by.set(x.accn, o); }
        o.n++; o.tags.add(tag);
        if (x.filed && (!newestFiled || x.filed > newestFiled)) newestFiled = x.filed;
        if (x.end && (!newestEnd || x.end > newestEnd)) newestEnd = x.end;
      }
    }
  }
  return { by, newestFiled, newestEnd };
}

// The tags the reader knows, flat, for the taxonomy in hand.
function knownTags(tax) {
  const cat = tax === 'ifrs-full' ? SecFacts.IFRS_CONCEPTS : SecFacts.CONCEPTS;
  const s = new Set();
  for (const k of Object.keys(cat)) for (const t of cat[k]) s.add(t);
  return s;
}

const maxOf = (list, f) => list.reduce((m, r) => { const v = f(r); return v && (!m || v > m) ? v : m; }, null);

// `submissions` and `facts` are the two SEC responses (facts may be null: the
// SEC answers 404 for a company with no tagged figures). `readerRows` is
// normalise over that feed, done by the caller because a foreign filer needs
// exchange rates this module has no business fetching. `stored` is the table.
function probe({ symbol, cik, submissions, facts, readerRows, stored }) {
  const tax = facts ? SecFacts.taxonomyOf(facts) : null;
  const list = statements(submissions && submissions.filings && submissions.filings.recent);
  const feed = feedFor(facts, tax);
  const known = knownTags(tax);
  const rows = Array.isArray(readerRows) ? readerRows : [];
  const have = Array.isArray(stored) ? stored : [];
  const readerAccn = new Map(); for (const r of rows) readerAccn.set(r.accn, (readerAccn.get(r.accn) || 0) + 1);
  const storedAccn = new Map(); for (const r of have) storedAccn.set(r.accn, (storedAccn.get(r.accn) || 0) + 1);

  const filings = list.slice(0, SHOWN).map((f) => {
    const inFeed = feed.by.get(f.accn);
    const tags = inFeed ? [...inFeed.tags] : [];
    return {
      accn: f.accn, form: f.form, filed: f.filed, period: f.period,
      feedFacts: inFeed ? inFeed.n : 0,
      feedTags: tags.length,
      knownTags: tags.filter((t) => known.has(t)).length,
      readerRows: readerAccn.get(f.accn) || 0,
      storedRows: storedAccn.get(f.accn) || 0,
    };
  });

  const newest = filings[0] || null;
  let verdict, why;
  if (!newest) {
    verdict = 'nolist'; why = 'The SEC lists no annual or quarterly report for this company.';
  } else if (!facts) {
    verdict = 'nofeed'; why = 'The SEC has no tagged figures for this company at all.';
  } else if (!newest.feedFacts) {
    verdict = 'feed'; why = 'The newest report is on the SEC\'s list but its figures are not in the SEC\'s facts feed. Nothing we read could contain it.';
  } else if (!newest.readerRows) {
    verdict = 'reader'; why = newest.knownTags
      ? 'The feed carries the newest report and tags we know, but our reader made no row from it.'
      : 'The feed carries the newest report, but under none of the tags our reader knows.';
  } else if (!newest.storedRows) {
    verdict = 'stored'; why = 'Our reader makes rows from the newest report, but the table does not hold them: it has not been re-read since the feed gained it, or the write failed.';
  } else {
    verdict = 'instep'; why = 'The newest report is in the feed, read by our reader and stored.';
  }

  return {
    symbol: String(symbol || '').toUpperCase(), cik: cik == null ? null : Number(cik),
    taxonomy: tax, currency: facts ? SecFacts.currencyOf(facts) : null,
    verdict, why,
    list: { statements: list.length, newestFiled: newest ? newest.filed : null, newestPeriod: newest ? newest.period : null },
    feed: { newestFiled: feed.newestFiled, newestEnd: feed.newestEnd, filings: feed.by.size },
    reader: { rows: rows.length, newestEnd: maxOf(rows, (r) => r.periodEnd), newestFiled: maxOf(rows, (r) => r.filed) },
    stored: { rows: have.length, newestEnd: maxOf(have, (r) => r.periodEnd), newestFiled: maxOf(have, (r) => r.filed) },
    filings,
  };
}

module.exports = { probe, statements, feedFor, SHOWN };
