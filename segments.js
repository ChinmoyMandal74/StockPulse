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
    // A label escaped twice in its own file (Ulta's "Haircare Products &amp;amp;
    // Styling Tools") is unescaped until it stops changing.
    for (let i = 0; i < 3 && /&(amp|lt|gt|quot|apos|#\d+);/.test(n); i++) n = unesc(n);
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

  // ---- reading an instance ------------------------------------------------------
  //
  // AN INSTANCE CARRIES MORE THAN ITS OWN PERIOD. An annual report gives the
  // year and, as comparatives, the one or two before it; a quarterly report
  // gives the quarter and the same quarter a year earlier (and year-to-date
  // figures, which are neither a quarter nor a year and are not read). So
  // one filing yields several periods, and `periods()` returns all of them.
  //
  // WHAT A PERIOD IS is decided by its length: 350 to 380 days is a fiscal
  // year, 80 to 100 a quarter. A six- or nine-month figure is neither.
  const SPANS = { FY: [350, 380], Q: [80, 100] };
  const isSpan = (c, p) => c && c.s && c.e && days(c.s, c.e) >= SPANS[p][0] && days(c.s, c.e) <= SPANS[p][1];

  // Everything parsed once: the contexts, the labels, every revenue fact.
  function read(instanceXml, labelXml) {
    const xml = String(instanceXml || '');
    if (!/<(?:\w+:)?context\s/.test(xml)) return null;
    const ctx = contexts(xml);
    const facts = [], shares = [];
    const re = /<((?:us-gaap|ifrs-full):[A-Za-z0-9]+)\s([^>]*)>\s*(-?[\d.]+(?:[eE][-+]?\d+)?)\s*<\//g;
    for (const m of xml.matchAll(re)) {
      const c = ctx[attr(m[2], 'contextRef')];
      const v = Number(m[3]);
      if (!c || !isFinite(v)) continue;
      if (REVENUE.includes(m[1])) { facts.push({ concept: m[1], c, v, unit: attr(m[2], 'unitRef') }); continue; }
      // A SHARE OF REVENUE, NOT AN AMOUNT (2026-10-26): Ross Stores, TJX, Ulta
      // and others tag their mix only as a concentration percentage of revenue
      // by product or region (us-gaap ConcentrationRiskPercentage1, with a
      // revenue benchmark). Kept apart; used only where a breakdown has no
      // dollar facts at all (shareKind, below).
      if (/^us-gaap:ConcentrationRiskPercentage/.test(m[1]) && c.dims.some((d) => /Benchmark/.test(d[0]) && /Revenue|Sales/i.test(d[1]))) shares.push({ c, v });
    }
    return facts.length ? { xml, facts, shares, lab: labels(String(labelXml || '')) } : null;
  }

  // A BREAKDOWN TAGGED ON TWO AXES (2026-10-26): 41 companies with no mix
  // tagged their segment revenue as segment x "operating segments"
  // (srt:ConsolidationItemsAxis, the newer segment disclosure), and Netflix
  // its regions as region x "streaming". Taken only where the second axis
  // holds ONE member throughout the breakdown: the operating segments member
  // of ConsolidationItemsAxis (never eliminations or corporate), or a single
  // member of another breakdown's axis. The facts come back as if tagged on
  // the one axis, so everything after reads them unchanged.
  function twoAxis(facts, kind, inP) {
    const groups = new Map();
    for (const f of facts) {
      if (f.c.dims.length !== 2 || !inP(f.c)) continue;
      const mineDim = f.c.dims.filter((d) => KIND_OF[d[0]] === kind);
      if (mineDim.length !== 1) continue;
      const other = f.c.dims.find((d) => d !== mineDim[0]);
      const ok = (other[0] === 'srt:ConsolidationItemsAxis' && /OperatingSegmentsMember$/.test(other[1])) || (KIND_OF[other[0]] && KIND_OF[other[0]] !== kind);
      if (!ok) continue;
      const key = other[0] + '|' + other[1];
      if (!groups.has(key)) groups.set(key, { cons: other[0] === 'srt:ConsolidationItemsAxis', list: [] });
      groups.get(key).list.push({ concept: f.concept, v: f.v, unit: f.unit, c: { dims: [mineDim[0]], s: f.c.s, e: f.c.e } });
    }
    let best = null;
    for (const g of groups.values()) {
      const n = new Set(g.list.map((f) => f.c.dims[0][1])).size;
      if (n < 2) continue;
      if (!best || (g.cons && !best.cons) || (g.cons === best.cons && n > best.n)) best = { cons: g.cons, n, list: g.list };
    }
    return best ? best.list : [];
  }
  // A BREAKDOWN TAGGED ONLY AS SHARES OF REVENUE (2026-10-26; Ross Stores:
  // Home Accents and Bed and Bath 26%, Ladies 22% ...): the members as amounts
  // worked out from the shares and the total, marked `fromShare` so no surface
  // shows them as reported amounts or a change between years made from
  // rounded percentages. Only the breakdown's axis and the concentration
  // axes may be on the fact. A share above 1.5 is a percent and divided.
  function shareKind(shares, kind, inP, total, lab) {
    if (!(total > 0)) return null;
    const cur = new Map();
    for (const s of shares) {
      if (!inP(s.c)) continue;
      const mineDim = s.c.dims.filter((d) => KIND_OF[d[0]] === kind);
      if (mineDim.length !== 1) continue;
      if (s.c.dims.some((d) => d !== mineDim[0] && !/ConcentrationRiskBy(Benchmark|Type)Axis$/.test(d[0]))) continue;
      cur.set(mineDim[0][1], s.v > 1.5 ? s.v / 100 : s.v);
    }
    if (cur.size < 2) return null;
    const members = [...cur].map(([k, f]) => ({ key: k, name: nameOf(k, lab), v: f * total, share: f, subtotal: false })).sort((a, b) => b.v - a.v);
    const sumF = members.reduce((s, m) => s + m.share, 0);
    return { concept: 'share', total, members, sum: sumF * total, complete: sumF >= 0.97 && sumF <= 1.03, fromShare: true };
  }

  // One period of one length: { ptype, end, currency, total, concept, kinds }
  // or null where the instance has no undimensioned revenue for it.
  function periodOf(R, ptype, end) {
    const { xml, facts, lab } = R;
    const inP = (c) => isSpan(c, ptype) && c.e === end;
    const plain = facts.filter((f) => !f.c.dims.length && inP(f.c));
    const totalFact = REVENUE.map((r) => plain.find((f) => f.concept === r)).find(Boolean);
    if (!totalFact) return null;
    const total = totalFact.v;
    // the currency, from the unit the total was reported in
    const um = totalFact.unit ? new RegExp('<(?:\\w+:)?unit\\s+id="' + totalFact.unit.replace(/[^\w.\-]/g, '') + '"[^>]*>[\\s\\S]*?iso4217:([A-Z]{3})').exec(xml) : null;
    const currency = um ? um[1] : null;
    const kinds = {};
    for (const kind of Object.keys(AXES)) {
      let mine = facts.filter((f) => f.c.dims.length === 1 && KIND_OF[f.c.dims[0][0]] === kind && inP(f.c));
      // Nothing on the axis alone: the same amounts tagged on two axes, where
      // the second holds one member throughout (twoAxis); else a breakdown
      // tagged only as shares of revenue (shareKind).
      // A LONE MEMBER ON THE AXIS IS NO BREAKDOWN (Netflix tags one region
      // alone beside its four region x streaming facts; Ulta one product), so
      // fewer than two members falls through to the other two shapes too.
      const nMembers = (list) => new Set(list.map((f) => f.c.dims[0][1])).size;
      if (nMembers(mine) < 2) { const two = twoAxis(facts, kind, inP); if (nMembers(two) >= 2) mine = two; }
      if (nMembers(mine) < 2) { const sk = shareKind(R.shares || [], kind, inP, total, lab); if (sk) kinds[kind] = sk; continue; }
      // ONE CONCEPT PER BREAKDOWN: WHICHEVER THE COMPANY USED MOST ON THIS AXIS,
      // the total's own on a tie. Pfizer tags two small lines with the
      // contract-revenue concept and its whole drug list with plain Revenues;
      // preferring the total's concept drew the two small lines as the mix.
      const count = {};
      for (const f of mine) count[f.concept] = (count[f.concept] || 0) + 1;
      const concept = Object.keys(count).sort((x, y) => count[y] - count[x] || (x === totalFact.concept ? -1 : y === totalFact.concept ? 1 : 0))[0];
      if (!concept) continue;
      // ...and the breakdown is measured against THAT concept's own total
      // where the report gives one, since the two can differ (a company's
      // contract revenue is not always all of its revenue).
      const own = plain.find((f) => f.concept === concept);
      const base = own ? own.v : total;
      const cur = new Map();
      for (const f of mine) if (f.concept === concept) cur.set(f.c.dims[0][1], f.v);
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
      const members = keys.map((k, i) => ({ key: k, name: nameOf(k, lab), v: vals[i], subtotal: subs.has(i) }));
      const sum = sumOf(subs);
      kinds[kind] = {
        concept, total: base, members: members.sort((x, y) => y.v - x.v), sum,
        // The parts account for the whole, to within a rounding.
        complete: base > 0 && near(sum, base),
      };
    }
    if (!Object.keys(kinds).length) return null;
    return { ptype, end, currency, total, concept: totalFact.concept, kinds };
  }

  // Every period of one length an instance carries, NEWEST FIRST. The first
  // is the filing's own period; the rest are its comparatives.
  function periods(instanceXml, labelXml, ptype) {
    const R = read(instanceXml, labelXml);
    if (!R || !SPANS[ptype]) return [];
    const ends = [...new Set(R.facts.filter((f) => !f.c.dims.length && isSpan(f.c, ptype)).map((f) => f.c.e))].sort().reverse();
    return ends.map((e) => periodOf(R, ptype, e)).filter(Boolean);
  }

  // The newest fiscal year alone, with last year's figure beside each member
  // where the same instance carries it. The first shape this module had,
  // kept for the one-year view.
  function parse(instanceXml, labelXml) {
    const all = periods(instanceXml, labelXml, 'FY');
    if (!all.length) return null;
    return withPrior(all[0], all.find((p) => Math.abs(days(p.end, all[0].end) - 365) <= 12) || null);
  }

  // ---- the fourth quarter ---------------------------------------------------------
  //
  // NO COMPANY FILES A REPORT FOR ITS FOURTH QUARTER: those three months are
  // only inside the annual figure. (2026-10-11, the owner, seeing Microsoft's
  // newest quarter stop at March with a June year end already filed: "why
  // does microsoft last quarter point to march 2026", then "do the 4th
  // quarter".) So it is WORKED OUT: the year less the three quarters before
  // its end, line by line, and marked `derived` so every surface can say it
  // was not reported as such.
  //
  // IT IS WITHHELD RATHER THAN GUESSED wherever the subtraction is not
  // like-for-like: a quarter missing, another currency, a breakdown measured
  // on a different revenue line, or a list of members that is not the same
  // in the year and in all three quarters (a regrouping). A breakdown that
  // fails is left out; with none left there is no fourth quarter.
  function fourthQuarter(fy, quarters) {
    if (!fy || !fy.end || !fy.kinds || !(fy.total > 0)) return null;
    const at = (back) => (quarters || []).find((q) => q && q.end && Math.abs(days(q.end, fy.end) - back) <= 12) || null;
    const three = [at(273), at(182), at(91)];
    if (three.some((q) => !q || !(q.total > 0) || !q.kinds || (q.currency || null) !== (fy.currency || null))) return null;
    const total = fy.total - three.reduce((s, q) => s + q.total, 0);
    if (!(total > 0)) return null;
    const kinds = {};
    for (const k of Object.keys(fy.kinds)) {
      const F = fy.kinds[k];
      const maps = three.map((q) => (q.kinds[k] && q.kinds[k].concept === F.concept ? new Map(q.kinds[k].members.map((m) => [m.key, m.v])) : null));
      if (maps.some((m) => !m)) continue;
      const keys = F.members.map((m) => m.key);
      if (maps.some((m) => m.size !== keys.length || keys.some((key) => !m.has(key)))) continue;
      const base = F.total - three.reduce((s, q) => s + q.kinds[k].total, 0);
      if (!(base > 0)) continue;
      const members = F.members.map((m) => ({ key: m.key, name: m.name, v: m.v - maps.reduce((s, mp) => s + mp.get(m.key), 0), subtotal: !!m.subtotal }));
      const sum = members.reduce((s, m) => s + (m.subtotal ? 0 : m.v), 0);
      kinds[k] = { concept: F.concept, total: base, members: members.sort((x, y) => y.v - x.v), sum,
        complete: Math.abs(sum - base) <= Math.abs(base) * 0.015 };
    }
    if (!Object.keys(kinds).length) return null;
    return { ptype: 'Q', end: fy.end, derived: true, currency: fy.currency || null, total, concept: fy.concept || null, kinds };
  }

  // ---- the mix over time ----------------------------------------------------------
  //
  // (2026-10-11, the owner: "evolution of revenue mix on individual stock page
  // and also on promo".) Each period's parts as SHARES of that period's parts,
  // so every column is a whole and the eye reads how the proportions moved.
  //
  // A PERIOD IS DRAWN ONLY IF IT IS THE SAME BREAKDOWN AS THE NEWEST ONE: its
  // parts must all be parts the company reports now. A period that names a
  // part the newest does not is on another grouping (a reorganisation), and a
  // column of it beside the others would show a change that is only a
  // relabelling; it is left out and counted in `skipped`. A part that is not
  // in an earlier period is taken as not yet existing there: a share of zero.
  // Also left out: a period with a negative part (shares of a sum with
  // negatives in it are not shares), and one whose parts do not add up where
  // the newest one's do.
  //
  // AT MOST SIX NAMED PARTS, the largest in the newest period; the rest are
  // one 'Other'. Fewer than three periods is not an evolution: null.
  //   cur:  the newest period's breakdown { members: [{ key, name, v, subtotal }], complete }
  //   hist: [{ end, derived, kind }] newest first, the newest included
  //
  // A PERIOD MISSING BETWEEN TWO THAT ARE DRAWN IS A GAP, AND IS SHOWN AS ONE.
  // (2026-10-11, the owner, of Nvidia: its Jul 25 column stood right beside
  // Apr 26 as if they were consecutive, with two quarters left out between
  // them. "Yes indicate the gaps clearly.") Given the period type, the
  // columns are checked for spacing and an empty one is put in for every
  // period skipped: `gapAt` is true there and every part's share is null.
  // It carries the date of the period on file where there is one, and the
  // date it would have had otherwise.
  const MIX_PARTS = 6;
  function mixOver(cur, hist, ptype) {
    if (!cur || !Array.isArray(cur.members)) return null;
    const parts = cur.members.filter((m) => !m.subtotal);
    if (parts.length < 2 || parts.some((m) => !(m.v >= 0))) return null;
    const now = new Set(parts.map((m) => m.key));
    const cols = [];
    const out0 = [];                                                 // the ends of the periods left out
    for (const h of hist || []) {
      const P = h && h.kind;
      if (!P || !Array.isArray(P.members)) continue;                 // not reported that period: nothing to leave out
      const mine = P.members.filter((m) => !m.subtotal);
      const sum = mine.reduce((s, m) => s + m.v, 0);
      if (!mine.length || mine.some((m) => !(m.v >= 0) || !now.has(m.key)) || !(sum > 0) || (cur.complete && !P.complete)) { out0.push(h.end); continue; }
      cols.push({ end: h.end, derived: !!h.derived, at: new Map(mine.map((m) => [m.key, m.v / sum * 100])), val: new Map(mine.map((m) => [m.key, m.v])), sum });
    }
    if (cols.length < 3) return null;
    cols.reverse();                                                  // oldest on the left
    // `skipped` counts only those BEFORE the first column: one inside the
    // range is drawn as a gap and so is not left out of the picture.
    const skipped = out0.filter((e) => e < cols[0].end).length;
    const step = ptype === 'Q' ? 91.3125 : ptype === 'FY' ? 365.25 : 0;
    if (step) {
      const iso = (from, add) => new Date(Date.parse(from + 'T00:00:00Z') + Math.round(add) * DAY).toISOString().slice(0, 10);
      for (let i = cols.length - 1; i > 0; i--) {
        const missing = Math.min(12, Math.round(days(cols[i - 1].end, cols[i].end) / step) - 1);
        for (let g = missing; g >= 1; g--) {
          const want = iso(cols[i - 1].end, g * step);
          const known = (hist || []).find((h) => h && h.end && Math.abs(days(h.end, want)) <= 12);
          cols.splice(i, 0, { end: known ? known.end : want, gap: true, derived: false, at: new Map(), val: new Map(), sum: null });
        }
      }
    }
    const last = cols[cols.length - 1].at;
    const shareAt = (c, f) => (c.gap ? null : f(c.at));
    const order = parts.slice().sort((x, y) => (last.get(y.key) || 0) - (last.get(x.key) || 0));
    const named = order.length > MIX_PARTS + 1 ? order.slice(0, MIX_PARTS) : order;
    const rest = order.slice(named.length);
    // THE AMOUNTS BESIDE THE SHARES (2026-10-13, the owner, of the card: "you are
    // showing the %, can you also show the absolute value as another option").
    // `values` is each part's figure in each column and `totals` the column's
    // sum of parts, in the company's reporting currency; null in a gap, like
    // the shares. A share alone cannot say whether the business grew.
    const valueAt = (c, f) => (c.gap ? null : f(c.val));
    const out = named.map((m) => ({ name: m.name, other: false, shares: cols.map((c) => shareAt(c, (at) => at.get(m.key) || 0)),
      values: cols.map((c) => valueAt(c, (v) => v.get(m.key) || 0)) }));
    if (rest.length) out.push({ name: 'Other (' + rest.length + ' smaller)', other: true, shares: cols.map((c) => shareAt(c, (at) => rest.reduce((s, m) => s + (at.get(m.key) || 0), 0))),
      values: cols.map((c) => valueAt(c, (v) => rest.reduce((s, m) => s + (v.get(m.key) || 0), 0))) });
    return { ends: cols.map((c) => c.end), derivedAt: cols.map((c) => c.derived), gapAt: cols.map((c) => !!c.gap), parts: out, skipped,
      totals: cols.map((c) => (c.gap ? null : c.sum)) };
  }

  // A period beside the same period a year before: `prev` on each member
  // (matched by the company's own member code, which is stable across its
  // filings) and `totalPrev`. Null where the earlier one is not held, or
  // where that member was not reported in it.
  function withPrior(p, prior) {
    if (!p) return null;
    const out = { fyEnd: p.end, ptype: p.ptype, end: p.end, currency: p.currency, total: p.total,
      totalPrev: prior ? prior.total : null, concept: p.concept, kinds: {} };
    for (const k of Object.keys(p.kinds)) {
      const was = new Map(((prior && prior.kinds[k] && prior.kinds[k].members) || []).map((m) => [m.key, m.v]));
      out.kinds[k] = Object.assign({}, p.kinds[k], { members: p.kinds[k].members.map((m) => Object.assign({}, m, { prev: was.has(m.key) ? was.get(m.key) : null })) });
    }
    return out;
  }
  // Where the two files of a filing live, from the feed's own row for it.
  function urls(cik, accn, primaryDoc) {
    if (!cik || !accn || !primaryDoc || !/^[\w.\-]+\.html?$/i.test(primaryDoc)) return null;
    const base = 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/';
    const stem = primaryDoc.replace(/\.html?$/i, '');
    return { instance: base + stem + '_htm.xml', labels: base + stem + '_lab.xml', schema: base + stem + '.xsd', page: base + primaryDoc };
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

  // ---- which filings to read ----------------------------------------------------
  //
  // (2026-10-11, the owner, of the first version, which kept one fiscal year:
  // "annual data could be very old, why not store annual and quarter and also
  // the history".) So both kinds of report are read, and every period each
  // one carries is kept.
  const QUARTERLY = new Set(['10-Q']);
  // Every annual and quarterly report in a company's list, newest first:
  // { accn, filed, form, doc, ptype }. Amendments are left out: they usually
  // restate nothing and often carry no figures, and the original is there.
  function reports(recent) {
    if (!recent || !Array.isArray(recent.form)) return [];
    const out = [];
    for (let i = 0; i < recent.form.length; i++) {
      const form = recent.form[i];
      const ptype = QUARTERLY.has(form) ? 'Q' : ANNUAL.has(form) && !/\/A$/.test(form) ? 'FY' : null;
      if (!ptype) continue;
      const accn = String((recent.accessionNumber || [])[i] || ''), doc = String((recent.primaryDocument || [])[i] || '');
      const filed = String((recent.filingDate || [])[i] || '').slice(0, 10);
      if (!accn || !doc || !/^\d{4}-\d{2}-\d{2}$/.test(filed)) continue;
      out.push({ accn, filed, form, doc, ptype });
    }
    return out.sort((x, y) => (x.filed < y.filed ? 1 : x.filed > y.filed ? -1 : 0));
  }
  // THE BACKFILL PLAN, chosen so a few filings cover several years: each
  // annual report carries its year and usually the two before it, and each
  // quarterly one its quarter and the same quarter a year earlier. So the
  // newest annual report and the one three years older give about six
  // years, and the six newest quarterly reports give about nine quarters
  // (three a year, so their comparatives overlap).
  function plan(recent) {
    const all = reports(recent);
    const fy = all.filter((r) => r.ptype === 'FY'), q = all.filter((r) => r.ptype === 'Q');
    const out = [];
    if (fy[0]) out.push(fy[0]);
    const older = fy.find((r) => fy[0] && r.filed <= String(Number(fy[0].filed.slice(0, 4)) - 3) + fy[0].filed.slice(4));
    if (older) out.push(older);
    return out.concat(q.slice(0, 6));
  }

  // One report read: { accn, form, filed, url, ptype, periods: [...] }.
  // `periods` is empty where the filing had no breakdown, which is still an
  // answer and is recorded so the filing is not fetched again. A 429 is
  // passed up as { throttled: true }; a server error returns null, to be
  // tried again. `labelsFrom` lets a caller reuse the label file of a newer
  // filing rather than fetch one per report: a company's member names
  // rarely change between its filings.
  async function readReport(o) {
    const r = o.report;
    const u = urls(o.cik, r.accn, r.doc);
    const base = { accn: r.accn, form: r.form, filed: r.filed, ptype: r.ptype, url: u ? u.page : null };
    if (!u) return Object.assign(base, { periods: [] });
    const inst = await o.getText(u.instance);
    if (inst.status === 429) return { throttled: true };
    if (inst.status === 404) return Object.assign(base, { periods: [] });
    if (inst.status !== 200) return null;
    let labText = o.labelsFrom || '';
    if (!labText) {
      // NOT EVERY FILING HAS A LABEL FILE. Some carry the labels inside the
      // schema instead (Microsoft's 2026 annual report: no _lab.xml, and its
      // product lines came out as raw member codes). So a 404 tries the schema.
      try {
        let lab = await o.getText(u.labels);
        if (lab.status === 404) lab = await o.getText(u.schema);
        if (lab.status === 429) return { throttled: true };
        if (lab.status === 200 && /<(?:\w+:)?label[\s>]/.test(lab.text)) labText = lab.text;
      } catch (e) { /* names fall back to the member codes */ }
    }
    return Object.assign(base, { periods: periods(inst.text, labText, r.ptype), labels: labText });
  }

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

  const api = { AXES, REVENUE, KIND_NAME, SPANS, days, parse, periods, withPrior, fourthQuarter, mixOver, contexts, labels, subtotals, nameOf, urls, latestAnnual, collect, reports, plan, readReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Segments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
