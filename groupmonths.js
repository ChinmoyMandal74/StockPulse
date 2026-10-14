// Month by month for a GROUP of companies: the market, a sector, a theme.
//
// (2026-10-13, the owner, of the single-stock month-by-month card: "I love
// this ... can this be expanded for Market, Sector ... for Theme as well".
// And, asked how a group's month should be struck: "equal weight", "extra row
// reads is fine, can change the logic if too slow", "make it 10 for
// everyone".)
//
// WHAT A CELL IS. The plain average of each member's price return in that
// calendar month: EQUAL WEIGHT, so the smallest company counts as much as the
// largest. It is what the typical member did, not what an index fund did --
// a cap-weighted index is led by a handful of names and can rise in a month
// most of its members fell.
//
// THE MEMBERS ARE TODAY'S, APPLIED TO EVERY PAST MONTH. It is the only list
// there is. So a company that failed or was dropped is in no month, and one
// that listed in 2023 is in none before it: the early years rest on fewer
// companies, and on the ones that lasted. Every card says so, with the count
// behind its earliest year. This is a record of today's members, never a
// claim about what the group returned at the time.
//
// FUNDS ARE NOT MEMBERS. An ETF in a theme holds the theme's own companies and
// would count them twice.
//
// WHAT IT READS: the last close before each month boundary, one indexed seek
// per (company, boundary) -- the pivot view's own shape. Ten years is 119
// boundaries, so about 150,000 single-row reads for the whole universe, done
// ONCE A DAY for every group at once and stored. A card reads the stored
// value.
//
// PURE. The route does the seeks and hands them over. Display only: nothing
// here reaches the Signal.
const YEARS = 10;
const MIN_CLOSE = 0.01;          // server.js's own floor: a sub-cent bar is not a price
const DAY = 86400000;
// A BREAK IN THE SERIES IS NOT A RETURN. Chord Energy's bars run from 0.11 to
// 34.20 across November 2020: the old company's shares were cancelled in its
// reorganisation and new ones issued, and the archive joins the two. Read as a
// return that is +30,991%, and with every member counting the same it alone
// made the Energy sector's 2020 read +554% and the whole market's November
// +49%. Found on the first real build. The largest real month in ten years
// of this universe is GameStop's +1,625% in January 2021, so a month past
// 25 times is left out of the average and counted in the build's report.
const MAX_MONTH = 2500;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// The months to draw and the boundaries their returns are struck between.
// `months[k]` is 'YYYY-MM'; its return is the close before `bounds[k + 1]`
// over the close before `bounds[k]`. Ten CALENDAR years, the newest partial:
// from January nine years back to the month of the newest bar.
function plan(latest, years) {
  const Y = Number(String(latest).slice(0, 4)), M = Number(String(latest).slice(5, 7));
  const months = [], bounds = [];
  for (let y = Y - ((years || YEARS) - 1); y <= Y; y++) {
    for (let m = 1; m <= (y === Y ? M : 12); m++) {
      months.push(y + '-' + String(m).padStart(2, '0'));
      bounds.push(y + '-' + String(m).padStart(2, '0') + '-01');
    }
  }
  // The newest month runs to the newest bar, so its boundary is the day after.
  bounds.push(iso(Date.parse(latest + 'T12:00:00Z') + DAY));
  return { months, bounds };
}

// One company's return in each month, or null. `closes[k]` is the last close
// before `bounds[k]`: { d, close } or nothing. BOTH ENDS MUST BELONG: the
// earlier close to the month before, the later one to the month itself. A
// company not yet listed, or with a hole in its bars, would otherwise borrow a
// price from months earlier and file a long move under one month.
function monthly(closes, bounds) {
  const out = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = closes[k], b = closes[k + 1];
    const prevStart = iso(Date.UTC(Number(bounds[k].slice(0, 4)), Number(bounds[k].slice(5, 7)) - 2, 1));
    const ok = a && b && a.close >= MIN_CLOSE && b.close >= MIN_CLOSE && a.d >= prevStart && a.d < bounds[k] && b.d >= bounds[k] && b.d < bounds[k + 1];
    const v = ok ? (b.close / a.close - 1) * 100 : null;
    out.push(v != null && v > MAX_MONTH ? null : v);
  }
  return out;
}

// Which groups a row belongs to. Keys: 'all', 'sp', 'ndx', 'sec:<sector>',
// 'thm:<theme>'. Index membership is three-state and only a known Yes counts.
function groupsOf(row, themes) {
  const g = ['all'];
  if (row.spMember === true) g.push('sp');
  if (row.ndxMember === true) g.push('ndx');
  if (row.sector) g.push('sec:' + row.sector);
  for (const t of themes || []) g.push('thm:' + t);
  return g;
}

// rows: snapshot rows (symbol, sector, instrumentType, spMember, ndxMember).
// themesOf(symbol) -> [theme names]. closesBySym: Map symbol -> closes[].
function build(o) {
  const { months, bounds } = plan(o.latest, o.years);
  const groups = {};
  const slot = (key) => groups[key] || (groups[key] = { members: 0, sum: months.map(() => 0), n: months.map(() => 0) });
  let companies = 0;
  const broken = [];
  for (const row of o.rows || []) {
    if (!row || !row.symbol || row.error || row.instrumentType === 'ETF') continue;
    const sym = String(row.symbol).toUpperCase();
    const cl = (o.closesBySym && o.closesBySym.get(sym)) || [];
    const r = monthly(cl, bounds);
    // Which months were left out as a break, for the build's own report.
    for (let k = 0; k < months.length; k++) { const a = cl[k], b = cl[k + 1]; if (r[k] == null && a && b && a.close >= MIN_CLOSE && (b.close / a.close - 1) * 100 > MAX_MONTH) broken.push(sym + ' ' + months[k]); }
    companies++;
    for (const key of groupsOf(row, o.themesOf ? o.themesOf(sym) : [])) {
      const g = slot(key);
      g.members++;
      for (let k = 0; k < months.length; k++) if (r[k] != null && Number.isFinite(r[k])) { g.sum[k] += r[k]; g.n[k]++; }
    }
  }
  const out = {};
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    // A month nobody has a return for is absent, never zero.
    out[key] = { members: g.members, n: g.n, r: g.sum.map((s, k) => (g.n[k] ? Math.round((s / g.n[k]) * 100) / 100 : null)) };
  }
  return { latest: o.latest, years: o.years || YEARS, months, companies, broken, groups: out };
}

module.exports = { YEARS, MAX_MONTH, plan, monthly, groupsOf, build };
