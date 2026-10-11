// Where a company's revenue comes from: by product, by business segment and
// by region, read out of its own annual report. Pure -- no network, no
// database. The loader and the server fetch the two files and hand them over.
//
// WHY THIS NEEDS ITS OWN FILES. The SEC feed the filings refresh downloads
// (companyfacts) carries only the totals. A breakdown is a "dimensional"
// fact -- revenue for the iPhone, revenue for Europe -- and those live only
// in the filing's own XBRL instance document. So for each company's newest
// annual report two files are read: the instance (the numbers) and the label
// file (what the company calls each member).
//
// THREE BREAKDOWNS, each along one axis, as the company tagged it:
//   product   what was sold                (srt:ProductOrServiceAxis)
//   segment   which division sold it       (us-gaap:StatementBusinessSegmentsAxis)
//   geo       where it was sold            (srt:StatementGeographicalAxis)
// plus their IFRS equivalents for a foreign filer. A fact tagged on TWO axes
// at once (iPhone in Europe) is left out: it belongs to a table, not a list.
//
// A COMPANY CHOOSES ITS OWN MEMBERS, so nothing here is comparable across
// companies. Apple reports "Americas" and Microsoft reports "United States";
// one company's segments are another's products. Each list is that
// company's own description of itself and is shown as that.
//
// SUBTOTALS ARE IN THE SAME LIST AS THEIR PARTS. Apple tags "Products" and
// also iPhone, Mac, iPad and the rest, all on one axis; adding the list up
// counts the products twice. A member whose value is the sum of some other
// members is marked a subtotal and left out of the leaves. Then the leaves
// are checked against the company's total revenue: where they add up to it
// the breakdown is `complete`; where they do not, it says so and no share of
// the total is claimed to be the whole picture.
//
// NO CONVERSION. A foreign filer's breakdown stays in its reporting currency,
// named beside the figures: the shares are what matter and they need none.
(function (root) {
  'use strict';

  const AXES = {
    product: ['srt:ProductOrServiceAxis', 'ifrs-full:ProductsAndServicesAxis'],
    segment: ['us-gaap:StatementBusinessSegmentsAxis', 'ifrs-full:SegmentsAxis'],
    geo: ['srt:StatementGeographicalAxis', 'ifrs-full:GeographicalAreasAxis'],
  };
  const KIND_OF = {};
  for (const k of Object.keys(AXES)) for (const a of AXES[k]) KIND_OF[a] = k;
  // In order of preference for the TOTAL. A breakdown may use any of them.
  const REVENUE = ['us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap:Revenues',
    'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax', 'us-gaap:SalesRevenueNet',
    'us-gaap:RevenuesNetOfInterestExpense', 'ifrs-full:Revenue', 'ifrs-full:RevenueFromContractsWithCustomers'];
  const DAY = 86400000;
  const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const isYear = (c) => c && c.s && c.e && days(c.s, c.e) >= 350 && days(c.s, c.e) <= 380;
  const unesc = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
  const attr = (tag, name) => { const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };

  // Every context: its one or more dimension members and its period.
  function contexts(xml) {
    const out = {};
    for (const m of xml.matchAll(/<(?:\w+:)?context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?context>/g)) {
      const body = m[2];
      // A typed member is a free-form key (a customer id, a date); never a list.
      if (/typedMember/.test(body)) continue;
      const dims = [...body.matchAll(/explicitMember\s+dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((d) => [d[1], d[2]]);
      const s = /<(?:\w+:)?startDate>\s*([^<\s]+)/.exec(body), e = /<(?:\w+:)?endDate>\s*([^<\s]+)/.exec(body);
      out[m[1]] = { dims, s: s ? s[1] : null, e: e ? e[1] : null };
    }
    return out;
  }

  // The company's own name for each member, from the label file:
  // 'aapl:IPhoneMember' -> 'iPhone'.
  function labels(xml) {
    const out = {};
    if (!xml) return out;
    const loc = {}, arc = {}, text = {};
    for (const m of xml.matchAll(/<(?:\w+:)?loc\s([^>]*?)\/?>/g)) {
      const href = attr(m[1], 'xlink:href'), lab = attr(m[1], 'xlink:label');
      const frag = href && href.includes('#') ? href.slice(href.indexOf('#') + 1) : null;
      if (frag && lab) loc[lab] = frag;
    }
    for (const m of xml.matchAll(/<(?:\w+:)?labelArc\s([^>]*?)\/?>/g)) {
      const from = attr(m[1], 'xlink:from'), to = attr(m[1], 'xlink:to');
      if (from && to) (arc[from] = arc[from] || []).push(to);
    }
    for (const m of xml.matchAll(/<(?:\w+:)?label\s([^>]*)>([\s\S]*?)<\/(?:\w+:)?label>/g)) {
      const id = attr(m[1], 'xlink:label'), role = attr(m[1], 'xlink:role') || '';
      if (!id) continue;
      // The standard label wins over a terse or verbose one.
      const rank = /\/role\/label$/.test(role) ? 0 : /terseLabel$/.test(role) ? 1 : 2;
      if (!text[id] || rank < text[id].rank) text[id] = { rank, t: unesc(m[2]) };
    }
    for (const l of Object.keys(loc)) {
      const best = (arc[l] || []).map((to) => text[to]).filter(Boolean).sort((a, b) => a.rank - b.rank)[0];
      if (best && best.t) out[loc[l]] = best.t;
    }
    return out;
  }
  // 'aapl:IPhoneMember' with no label on file -> 'I Phone'. Better than a
  // code, worse than the company's word, which is why the label file is read.
  const fallbackName = (q) => String(q).replace(/^.*:/, '').replace(/Member$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
  function nameOf(q, lab) {
    const frag = String(q).replace(':', '_');
    const t = lab[frag];
    let n = (t ? t.replace(/\s*\[Member\]\s*$/i, '').replace(/\s+Member$/i, '') : fallbackName(q)).slice(0, 80);
    // The standard country members are labelled in capitals (UNITED STATES);
    // set them as a name. A short all-capitals label is left alone: it is
    // an abbreviation (EMEA, APAC, US).
    if (n.length > 4 && n === n.toUpperCase() && /[A-Z]/.test(n)) n = n.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
    return n;
  }

  // Which members are sums of other members. Small lists only: past twenty
  // the search is not worth its time and nothing is marked.
  function subtotals(vals) {
    const out = new Set();
    const idx = vals.map((v, i) => i).filter((i) => vals[i] > 0);
    if (idx.length < 3 || idx.length > 20) return out;
    for (const i of idx) {
      const target = vals[i];
      // TIGHT, because a filing's subtotal is the exact sum of its parts to the
      // unit it reports in. At 0.4% a list of fifteen drug names produced a
      // coincidental sum for nearly every large one (Pfizer, first dry run).
      const tol = Math.max(1, Math.abs(target) * 0.0005);
      const parts = idx.filter((j) => j !== i && vals[j] < target).sort((a, b) => vals[b] - vals[a]);
      const suffix = new Array(parts.length + 1).fill(0);
      for (let k = parts.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + vals[parts[k]];
      let found = false, steps = 0;
      const go = (k, left, used) => {
        if (found || steps++ > 200000) return;
        if (Math.abs(left) <= tol && used >= 2) { found = true; return; }
        if (k >= parts.length || left < -tol || suffix[k] < left - tol) return;
        go(k + 1, left - vals[parts[k]], used + 1);
        go(k + 1, left, used);
      };
      go(0, target, 0);
      if (found) out.add(i);
    }
    return out;
  }

  // The instance and the label file -> the three breakdowns, or null where
  // the file has no annual revenue to break down.
  function parse(instanceXml, labelXml) {
    const xml = String(instanceXml || '');
    if (!/<(?:\w+:)?context\s/.test(xml)) return null;
    const ctx = contexts(xml);
    const lab = labels(String(labelXml || ''));
    // every revenue fact, with its context
    const facts = [];
    const re = /<((?:us-gaap|ifrs-full):[A-Za-z]+)\s([^>]*)>\s*(-?[\d.]+(?:[eE][-+]?\d+)?)\s*<\//g;
    for (const m of xml.matchAll(re)) {
      if (!REVENUE.includes(m[1])) continue;
      const c = ctx[attr(m[2], 'contextRef')];
      const v = Number(m[3]);
      if (!c || !isFinite(v)) continue;
      facts.push({ concept: m[1], c, v, unit: attr(m[2], 'unitRef') });
    }
    if (!facts.length) return null;
    // THE YEAR is the newest full-year period any undimensioned revenue fact
    // covers. Taken from the facts rather than from the cover page: a filing
    // can carry a period-end date that differs by a day from its contexts.
    const plain = facts.filter((f) => !f.c.dims.length && isYear(f.c));
    if (!plain.length) return null;
    const fyEnd = plain.map((f) => f.c.e).sort().pop();
    const inYear = (c) => isYear(c) && c.e === fyEnd;
    const inPrior = (c) => isYear(c) && Math.abs(days(c.e, fyEnd) - 365) <= 12;
    const totalFact = REVENUE.map((r) => plain.find((f) => f.concept === r && f.c.e === fyEnd)).find(Boolean);
    if (!totalFact) return null;
    const total = totalFact.v;
    const priorFact = facts.find((f) => !f.c.dims.length && f.concept === totalFact.concept && inPrior(f.c));
    // the currency, from the unit the total was reported in
    const um = totalFact.unit ? new RegExp('<(?:\\w+:)?unit\\s+id="' + totalFact.unit.replace(/[^\w.\-]/g, '') + '"[^>]*>[\\s\\S]*?iso4217:([A-Z]{3})').exec(xml) : null;
    const currency = um ? um[1] : null;

    const kinds = {};
    for (const kind of Object.keys(AXES)) {
      const mine = facts.filter((f) => f.c.dims.length === 1 && KIND_OF[f.c.dims[0][0]] === kind);
      if (!mine.length) continue;
      // ONE CONCEPT PER BREAKDOWN: WHICHEVER THE COMPANY USED MOST ON THIS AXIS,
      // the total's own on a tie. Pfizer tags two small lines with the
      // contract-revenue concept and its whole drug list with plain Revenues;
      // preferring the total's concept drew the two small lines as the mix.
      const count = {};
      for (const f of mine) if (inYear(f.c)) count[f.concept] = (count[f.concept] || 0) + 1;
      const concept = Object.keys(count).sort((x, y) => count[y] - count[x] || (x === totalFact.concept ? -1 : y === totalFact.concept ? 1 : 0))[0];
      if (!concept) continue;
      // ...and the breakdown is measured against THAT concept's own total
      // where the report gives one, since the two can differ (a company's
      // contract revenue is not always all of its revenue).
      const own = plain.find((f) => f.concept === concept && f.c.e === fyEnd);
      const base = own ? own.v : total;
      const cur = new Map(), prev = new Map();
      for (const f of mine) {
        if (f.concept !== concept) continue;
        const key = f.c.dims[0][1];
        if (inYear(f.c)) cur.set(key, f.v); else if (inPrior(f.c)) prev.set(key, f.v);
      }
      const keys = [...cur.keys()];
      if (keys.length < 2) continue;                       // one member is the total again, not a breakdown
      const vals = keys.map((k) => cur.get(k));
      const near = (x, y) => Math.abs(x - y) <= Math.abs(y) * 0.015;
      const sumOf = (skip) => vals.reduce((s, v, i) => s + (skip.has(i) ? 0 : v), 0);
      // A member can equal a sum of others BY COINCIDENCE (Phone 500 beside
      // Service 300 and PC 200). So the candidates are only candidates: the
      // marking kept is the smallest set of them that leaves parts adding up
      // to the total.
      const cand = [...subtotals(vals)];
      let subs = new Set(cand);
      if (base > 0 && cand.length && cand.length <= 10) {
        let best = null;
        for (let mask = 0; mask < (1 << cand.length) && !(best && best.size === 0); mask++) {
          const set = new Set(cand.filter((_, bit) => mask & (1 << bit)));
          if (near(sumOf(set), base) && (!best || set.size < best.size)) best = set;
        }
        if (best) subs = best;
        // No marking makes the parts add up. In a short list the candidates
        // are still very likely real subtotals; in a long one they are as
        // likely coincidence, and marking them would hide the largest members.
        else if (keys.length > 8) subs = new Set();
      }
      // THE SAME TOTAL SPLIT TWO WAYS ON ONE AXIS. Microsoft tags Product and
      // Service (two members, the whole) and also its ten product lines (the
      // whole again); neither is a subtotal of the other, and together they
      // are twice the revenue. Where the parts overshoot, the largest set of
      // them that makes exactly the total is the detailed split and is kept;
      // the rest are the coarser grouping and are marked like subtotals.
      if (base > 0 && sumOf(subs) > base * 1.015) {
        const idx = keys.map((_, i) => i).filter((i) => !subs.has(i) && vals[i] > 0).sort((x, y) => vals[y] - vals[x]);
        if (idx.length <= 22) {
          const tol = Math.max(1, base * 0.002);
          const suffix = new Array(idx.length + 1).fill(0);
          for (let k = idx.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + vals[idx[k]];
          let best = null, steps = 0;
          const pick = [];
          const go = (k, left) => {
            if (steps++ > 400000) return;
            if (Math.abs(left) <= tol) { if (!best || pick.length > best.length) best = pick.slice(); }
            if (k >= idx.length || left < -tol || suffix[k] < left - tol) return;
            if (best && pick.length + (idx.length - k) <= best.length) return;     // cannot beat it
            pick.push(idx[k]); go(k + 1, left - vals[idx[k]]); pick.pop();
            go(k + 1, left);
          };
          go(0, base);
          if (best && best.length >= 2) { const keep = new Set(best); for (const i of idx) if (!keep.has(i)) subs.add(i); }
        }
      }
      const members = keys.map((k, i) => ({ key: k, name: nameOf(k, lab), v: vals[i], prev: prev.has(k) ? prev.get(k) : null, subtotal: subs.has(i) }));
      const sum = sumOf(subs);
      kinds[kind] = {
        concept, total: base, members: members.sort((x, y) => y.v - x.v), sum,
        // The parts account for the whole, to within a rounding.
        complete: base > 0 && near(sum, base),
      };
    }
    if (!Object.keys(kinds).length) return null;
    return { fyEnd, currency, total, totalPrev: priorFact ? priorFact.v : null, concept: totalFact.concept, kinds };
  }

  // Where the two files of a filing live, from the feed's own row for it.
  function urls(cik, accn, primaryDoc) {
    if (!cik || !accn || !primaryDoc || !/^[\w.\-]+\.html?$/i.test(primaryDoc)) return null;
    const base = 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/';
    const stem = primaryDoc.replace(/\.html?$/i, '');
    return { instance: base + stem + '_htm.xml', labels: base + stem + '_lab.xml', page: base + primaryDoc };
  }
  // The newest annual report in a company's list: { accn, filed, form, doc }.
  const ANNUAL = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);
  function latestAnnual(recent) {
    if (!recent || !Array.isArray(recent.form)) return null;
    let best = null;
    for (let i = 0; i < recent.form.length; i++) {
      if (!ANNUAL.has(recent.form[i])) continue;
      const filed = String((recent.filingDate || [])[i] || '');
      // An amendment often restates nothing and carries no figures; the
      // original is preferred unless the amendment is the only one there.
      const amended = /\/A$/.test(recent.form[i]);
      const cand = { accn: String((recent.accessionNumber || [])[i] || ''), filed, form: recent.form[i], doc: String((recent.primaryDocument || [])[i] || ''), amended };
      if (!cand.accn || !cand.doc) continue;
      if (!best || (best.amended && !amended && filed >= best.filed.slice(0, 4)) || (amended === best.amended && filed > best.filed)) best = cand;
    }
    return best;
  }
  const KIND_NAME = { product: 'By product or service', segment: 'By business segment', geo: 'By region' };

  // One company's newest annual report, read if it is not the one already
  // stored. `getText(url)` returns { status, text }. Returns null when there
  // is nothing new to do; otherwise a row to store, with `data` null where
  // the filing had no breakdown -- recorded so it is not fetched again.
  // A 429 is passed up as { throttled: true } and nothing is recorded.
  async function collect(o) {
    const a = latestAnnual(o.recent);
    if (!a || a.accn === o.haveAccn) return null;
    const u = urls(o.cik, a.accn, a.doc);
    const base = { accn: a.accn, filed: a.filed, form: a.form, url: u ? u.page : null };
    if (!u) return Object.assign(base, { data: null });
    const inst = await o.getText(u.instance);
    if (inst.status === 429) return { throttled: true };
    // No instance beside the document: an old or paper-style filing. Recorded.
    if (inst.status === 404) return Object.assign(base, { data: null });
    if (inst.status !== 200) return null;                    // a server error: try again next time
    let lab = { status: 0, text: '' };
    try { lab = await o.getText(u.labels); } catch (e) { /* names fall back to the member codes */ }
    if (lab.status === 429) return { throttled: true };
    const parsed = parse(inst.text, lab.status === 200 ? lab.text : '');
    return Object.assign(base, { data: parsed });
  }

  const api = { AXES, REVENUE, KIND_NAME, parse, contexts, labels, subtotals, nameOf, urls, latestAnnual, collect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Segments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
