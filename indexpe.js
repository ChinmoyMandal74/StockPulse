// The price-to-earnings ratio of a whole index, quarter by quarter.
//
// (2026-10-14, the owner: "in Promo, I don't think we have anything talking
// about historical PE at the index level".) Every P/E history the site drew
// was one company's (Evolution, Against its peers, the drill-down).
//
// TWO READINGS, BOTH SHOWN, because they answer different questions:
//   the index's own   the members' combined market value over their combined
//                     trailing-year net income: what you pay for a dollar of
//                     the group's earnings. Losses are IN the sum, as they
//                     are in the published index P/E, and the largest
//                     companies dominate it.
//   the middle one    the median of each member's own P/E, profitable
//                     members only (a multiple of a loss is arithmetic, not
//                     a price): what the typical member costs.
//
// THE MEMBERS ARE TODAY'S, applied to every past quarter: the only list
// there is. A company that left the index is in no quarter, and one that
// joined lately is in all of them, so the past is the past of today's
// members. The card says so. A member counts in a quarter only when it has
// both a market value and a trailing year of earnings there.
//
// The per-company figures are the peer chart's own (trendSeries in
// server.js): market value at the quarter's last close on the share count
// filed then, split-adjusted, over the trailing year from the filings.
//
// PURE. Display only: nothing here reaches the Signal.
const MIN_COVER = 0.5;           // a quarter needs half of today's members on record to be drawn

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// quarters: ['YYYY-MM-DD', ...] oldest first. cap / ni: { SYM: [per quarter] }.
// members: the symbols of the cut today.
function build(quarters, members, cap, ni) {
  const out = { quarters, members: members.length, pe: [], median: [], n: [], cap: [], ni: [] };
  quarters.forEach((q, i) => {
    let c = 0, e = 0, n = 0;
    const own = [];
    for (const s of members) {
      const cv = cap[s] ? cap[s][i] : null, nv = ni[s] ? ni[s][i] : null;
      if (cv == null || nv == null || !Number.isFinite(cv) || !Number.isFinite(nv) || !(cv > 0)) continue;
      c += cv; e += nv; n++;
      if (nv > 0) own.push(cv / nv);
    }
    const enough = members.length && n >= members.length * MIN_COVER;
    out.n.push(n);
    out.cap.push(enough ? c : null);
    out.ni.push(enough ? e : null);
    // Combined earnings at or below nothing make no multiple at all.
    out.pe.push(enough && e > 0 ? Math.round((c / e) * 100) / 100 : null);
    const med = enough ? median(own) : null;
    out.median.push(med == null ? null : Math.round(med * 100) / 100);
  });
  return out;
}

module.exports = { MIN_COVER, median, build };
