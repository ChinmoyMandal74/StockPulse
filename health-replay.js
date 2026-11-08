// Health, rebuilt for the past: the lookalike behind research entries 27 and 28, kept.
//
//   node --use-system-ca --no-warnings health-replay.js            # a new build (~25 min, reads the local copy)
//   node --no-warnings health-replay.js --from-jsonl FILE --note X  # import rows an earlier run wrote
//   node --no-warnings health-replay.js --stats                     # the builds on file
//
// On the first session of every month from 2010, every stock's Health by the live
// rules (health.js, unchanged) on a row rebuilt from what was known that day:
// prices exactly, the filings as filed (SecFacts.visibleAsOf), the newest results
// release's outlook change (from 2017), the P/E against its own history, and the
// trailing P/E (else price to sales) against the same month's industry median.
// The estimate, short interest and tone checks cannot be rebuilt and are left
// out, as the live rules leave out any missing check.
//
// Written to health-history.db (local, gitignored, never Turso). A build never
// replaces an earlier one (owner, 2026-11-07: "Keep the health history"): each run
// is a new build id; studies read the newest unless told otherwise. Each row keeps
// every input as JSON, so a later health.js can be re-scored over it (scoreRows).
// Months without 42 sessions ahead are kept with blank forward returns, so the
// newest months are on file and a later build fills them.
//
// Reads analysis.db (run analysis-db.js --sec first) and, once, today's snapshot
// for the sector and industry taxonomy (one Turso read; nothing is written there).
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const Health = require('./health.js');

const HIST_PATH = path.join(__dirname, 'health-history.db');
const H = [21, 42];
const WORD = { raised: 'Raised', lowered: 'Lowered', reaffirmed: 'Reaffirmed', initiated: 'Initiated', withdrawn: 'Withdrawn', mixed: 'Mixed' };
const med = (a) => { const v = a.slice().sort((x, y) => x - y); const h = v.length / 2; return v.length % 2 ? v[(v.length - 1) / 2] : (v[h - 1] + v[h]) / 2; };

function openHist(readOnly) {
  const db = new DatabaseSync(HIST_PATH, readOnly ? { readOnly: true } : {});
  if (readOnly) return db;
  db.exec('pragma journal_mode = WAL');
  db.exec(`create table if not exists health_builds (build integer primary key, at text not null, note text,
    health_js text, rows integer, months integer)`);
  db.exec(`create table if not exists health_months (build integer not null, symbol text not null, d text not null,
    score integer, weighed real, capped integer, business real, results real, valuation real, price real, sentiment real,
    r21 real, r42 real, inputs text not null, primary key (build, symbol, d))`);
  db.exec(`create table if not exists health_bench (build integer not null, d text not null,
    ew21 real, ew42 real, spy21 real, spy42 real, primary key (build, d))`);
  return db;
}

// The industry comparison needs the whole month, so Health is worked out a month at a time.
// rows: one month's records (replay shape). Sets peerPe/peerPs and the Health fields on each.
function scoreMonth(list) {
  const pe = new Map(), ps = new Map();
  for (const r of list) {
    if (!r.industry || r.currency !== 'USD') continue;
    if (r.pe > 0 && r.pe <= 1000) { if (!pe.has(r.industry)) pe.set(r.industry, []); pe.get(r.industry).push(r.pe); }
    if (r.ps > 0) { if (!ps.has(r.industry)) ps.set(r.industry, []); ps.get(r.industry).push(r.ps); }
  }
  const mPe = new Map([...pe].filter(([, v]) => v.length >= 5).map(([k, v]) => [k, med(v)]));
  const mPs = new Map([...ps].filter(([, v]) => v.length >= 5).map(([k, v]) => [k, med(v)]));
  for (const r of list) {
    r.peerPe = r.pe > 0 && r.pe <= 1000 && mPe.get(r.industry) > 0 ? r.pe / mPe.get(r.industry) : null;
    r.peerPs = r.ps > 0 && mPs.get(r.industry) > 0 ? r.ps / mPs.get(r.industry) : null;
    // The release history stores outlook changes in lower case; Health matches ReleaseView's words.
    const e = Health.explain({ symbol: r.s, sector: r.sector, currency: r.currency || 'USD', instrumentType: 'Common Stock',
      revenueTtm: r.revenueTtm, revenueGrowthYoY: r.revenueGrowthYoY, profitMargin: r.profitMargin, fcfMargin: r.fcfMargin,
      netCash: r.netCash, intCover: r.intCover, sharesChg: r.sharesChg,
      erGuideChange: r.erGuideChange ? WORD[String(r.erGuideChange).toLowerCase()] || null : null,
      peVsMed: r.peVsMed, peerPe: r.peerPe, peerPs: r.peerPs, oneMonthPct: r.oneMonthPct, threeYearPct: r.threeYearPct,
      vs200ma: r.vs200ma, maBullish: r.maBullish, action: r.action || null });
    r.health = e ? { score: e.score, weighed: e.weighed, capped: e.capped ? 1 : 0,
      pillars: Object.fromEntries(e.pillars.map((p) => [p.id, p.points])) } : null;
  }
  return list;
}
function scoreRows(rows) {
  const byD = new Map(); for (const r of rows) { if (!byD.has(r.d)) byD.set(r.d, []); byD.get(r.d).push(r); }
  for (const list of byD.values()) scoreMonth(list);
  return rows;
}

function writeBuild(db, rows, bench, note) {
  const build = (db.prepare('select max(build) b from health_builds').get().b || 0) + 1;
  const hash = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'health.js'))).digest('hex').slice(0, 12);
  const ins = db.prepare(`insert into health_months values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('begin');
  for (const r of rows) {
    const h = r.health, p = (h && h.pillars) || {};
    const { health, r: fwd, ...inputs } = r;
    const v = (x) => (x == null || !isFinite(x) ? null : x);
    ins.run(build, r.s, r.d, h ? h.score : null, h ? h.weighed : null, h ? h.capped : null,
      v(p.business), v(p.results), v(p.value), v(p.price), v(p.sentiment),
      fwd ? v(fwd[0]) : null, fwd ? v(fwd[1]) : null, JSON.stringify(inputs));
  }
  const bi = db.prepare('insert into health_bench values (?,?,?,?,?,?)');
  for (const b of bench) bi.run(build, b.d, b.ew21, b.ew42, b.spy21, b.spy42);
  db.prepare('insert into health_builds values (?,?,?,?,?,?)').run(build, new Date().toISOString(), note || null, hash, rows.length, new Set(rows.map((r) => r.d)).size);
  db.exec('commit');
  return build;
}

// ---- the replay itself (research entry 27's, unchanged but for keeping months without a forward window) ----
async function replay() {
  const Action = require('./private/action.js'), TechRow = require('./techrow.js');
  const SecFacts = require('./secfacts.js'), Adjusted = require('./adjusted.js'), Longrun = require('./longrun.js');
  require('dotenv').config();
  const store = require('./db.js');
  const snap = await store.readSnapshot();
  const prof = new Map(snap.stocks.map((s) => [s.symbol, { sector: s.sector || null, industry: s.industry || null, etf: s.instrumentType === 'ETF' }]));
  const db = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });
  const { cfg } = Action.resolve(null, 'Balanced'); cfg.__resolved = true;
  const camel = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) r[k.replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase())] = v; return r; };
  const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
  const spy = db.prepare("select d, close from bars where symbol='SPY' and d >= '2007-01-01' order by d").all();
  const cal = spy.map((r) => r.d);
  const samples = []; for (let i = 1; i < cal.length; i++) if (cal[i].slice(0, 7) !== cal[i - 1].slice(0, 7) && cal[i] >= '2010-01-01') samples.push(i);
  const syms = db.prepare('select distinct symbol from bars order by symbol').all().map((r) => r.symbol);
  const factsQ = db.prepare('select * from sec_facts where symbol = ?');
  const splitsQ = db.prepare('select d, f from splits where symbol = ? order by d');
  const relQ = db.prepare('select filed, guide_change from earnings_releases where symbol = ? and is_results = 1 order by filed');
  const barsQ = db.prepare('select d, high, close, volume from bars where symbol = ? and d >= ? order by d');
  const ew = new Map(), rows = [];
  const t0 = Date.now();
  const splitAfter = (splits, from, to) => { let f = 1; for (const sp of splits) if (sp.d > from && (!to || sp.d <= to) && Number(sp.f) > 0) f *= Number(sp.f); return f; };
  for (const [si, sym] of syms.entries()) {
    const bars = barsQ.all(sym, '2006-01-01');
    if (bars.length < 260) continue;
    const p = prof.get(sym) || {};
    const dates = bars.map((b) => b.d), closes = bars.map((b) => Number(b.close));
    const highs = bars.map((b) => Number(b.high) || Number(b.close)), vols = bars.map((b) => Number(b.volume) || 0);
    const rsi = TechRow.rsiSeries(closes), ix = new Map(dates.map((d, i) => [d, i]));
    const closeOn = (d) => { let lo = 0, hi = dates.length - 1, best = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { best = m; lo = m + 1; } else hi = m - 1; } return best >= 0 ? closes[best] : null; };
    const facts = factsQ.all(sym).map(camel), splits = splitsQ.all(sym), rels = relQ.all(sym);
    for (const k of samples) {
      const d = cal[k], i = ix.get(d);
      if (i == null || i < TechRow.MIN_SESSIONS || !(closes[i] > 0)) continue;
      const fwd = H.map((h) => { const j = k + h < cal.length ? ix.get(cal[k + h]) : null; return j == null ? null : closes[j] / closes[i] - 1; });
      for (const [hj, h] of H.entries()) if (fwd[hj] != null) { const key = d + '|' + h; const b = ew.get(key) || [0, 0]; b[0] += fwd[hj]; b[1]++; ew.set(key, b); }
      if (p.etf) continue;
      const tech = TechRow.rowAt(closes, highs, vols, i); if (!tech) continue;
      let s50 = 0, s200 = 0; if (i >= 199) { for (let q = i - 199; q <= i; q++) { s200 += closes[q]; if (q > i - 50) s50 += closes[q]; } }
      const rec = { s: sym, d, r: fwd, sector: p.sector, industry: p.industry,
        oneMonthPct: tech.oneMonthPct, vs200ma: tech.vs200ma, pctFromHigh: tech.pctFromHigh,
        maBullish: i >= 199 ? s50 / 50 > s200 / 200 : null,
        threeYearPct: i >= 756 && closes[i - 756] > 0 ? (closes[i] / closes[i - 756] - 1) * 100 : null };
      rows.push(rec);
      if (!facts.length) continue;
      const seen = SecFacts.visibleAsOf(facts, d);
      const sec = seen.length ? Adjusted.fundamentalsFrom(SecFacts, seen) : null;
      if (!sec) continue;
      const filled = SecFacts.latestFilled(seen);
      const qRows = filled.filter((r) => r.periodType === 'Q');
      const usd = !qRows.some((r) => r.currency && r.currency !== 'USD');
      if (sec.sharesDiluted != null) {
        const filedOf = seen.filter((r) => r.periodEnd === sec.sharesFrom).reduce((m, r) => (r.filed > m ? r.filed : m), '');
        sec.sharesDiluted *= splitAfter(splits, filedOf || sec.sharesFrom);
      }
      const nxt = rels.find((r) => r.filed > d);
      const row = Object.assign({}, { symbol: sym, ...tech, rsi: rsi[i] }, { nextEarningsDate: nxt && (Date.parse(nxt.filed) - Date.parse(d)) / 864e5 <= 120 ? nxt.filed : null },
        Adjusted.overlayFrom(sec, null, null, closes[i]));
      const rf = Action.evaluate(row, cfg);
      rec.action = rf.type === 'ETF' ? null : rf.action;
      rec.revenueGrowthYoY = sec.revenueGrowthYoY; rec.profitMargin = sec.profitMargin; rec.fcfMargin = sec.fcfMargin;
      const t = SecFacts.ttm(qRows);
      rec.revenueTtm = t ? t.revenue : null;
      rec.currency = usd ? 'USD' : 'other';
      const nq = qRows[0];
      if (nq) {
        const cash = num(nq.cash), sti = num(nq.shortTermInvestments);
        const debt = num(nq.debt) != null ? num(nq.debt) : (num(nq.ltdTotal) != null ? num(nq.ltdTotal) + (num(nq.debtCurrent) || 0) : null);
        rec.netCash = cash != null && debt != null ? cash + (sti || 0) - debt : null;
      }
      const cov = Longrun.coverage(filled, d, p.sector === 'Financial Services');
      rec.intCover = cov ? cov.cover : null;
      const qs = filled.filter((r) => r.periodType === 'Q' && r.sharesDiluted > 0).sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1));
      if (qs.length >= 5) { const a = qs[0], b = qs.find((x) => Math.abs((Date.parse(a.periodEnd) - Date.parse(x.periodEnd)) / 864e5 - 365) <= 20);
        if (b) { const f = splitAfter(splits, b.periodEnd, a.periodEnd); const r1 = a.sharesDiluted / b.sharesDiluted, r2 = r1 / f;
          rec.sharesChg = ((Math.abs(Math.log(r1)) <= Math.abs(Math.log(r2)) ? r1 : r2) - 1) * 100; } }
      const cap = row.marketCap;
      if (usd && cap > 0) {
        const series = SecFacts.ttmSeries(qRows).slice(-41);
        const pes = series.map((pt) => {
          if (!(pt.netIncome > 0)) return null;
          const qr = qRows.find((r) => r.periodEnd === pt.d);
          const sh = qr ? num(qr.sharesDiluted) : null, c = closeOn(pt.d);
          if (!(sh > 0) || !(c > 0)) return null;
          return c * sh * splitAfter(splits, qr.filed || pt.d) / pt.netIncome;
        });
        const v = Longrun.peVsHistory(pes, cap, t ? { netIncome: t.netIncome, d: t.to } : null, d);
        rec.peVsMed = v ? v.vsMed : null;
        rec.pe = row.forwardPe > 0 ? row.forwardPe : null;            // trailing, from the overlay
        rec.ps = t && t.revenue > 0 ? cap / t.revenue : null;
      }
      const rel = rels.filter((r) => r.filed <= d && (Date.parse(d) - Date.parse(r.filed)) / 864e5 <= 130).pop();
      if (rel) rec.erGuideChange = rel.guide_change || null;
      rec.rel = !!rel;
    }
    if (si % 100 === 0) console.log(si, sym, rows.length, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  const bench = samples.map((k) => {
    const d = cal[k], g = (h) => { const b = ew.get(d + '|' + h); return b ? b[0] / b[1] : null; };
    const s = (h) => (k + h < cal.length ? Number(spy[k + h].close) / Number(spy[k].close) - 1 : null);
    return { d, ew21: g(21), ew42: g(42), spy21: s(21), spy42: s(42) };
  });
  return { rows, bench, note: `replay ${cal[samples[0]]} to ${cal[samples[samples.length - 1]]}, taxonomy of the snapshot of ${snap.updatedAt || 'today'}` };
}

// An earlier run's rows (the scratch replay of 2026-11-07 wrote JSON lines with k, the index into
// SPY's calendar from 2007, and a benchmark file keyed k|h). Re-scored here by today's health.js.
function fromJsonl(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  const benchFile = file.replace(/hrows(-only)?\.jsonl$/, 'hbench$1.json');
  const B = fs.existsSync(benchFile) ? JSON.parse(fs.readFileSync(benchFile, 'utf8')) : {};
  const db = new DatabaseSync(path.join(__dirname, 'analysis.db'), { readOnly: true });
  const spy = db.prepare("select d, close from bars where symbol='SPY' and d >= '2007-01-01' order by d").all();
  const ks = new Map(); for (const r of rows) { ks.set(r.k, r.d); delete r.k; }
  const bench = [...ks].sort((a, b) => a[0] - b[0]).map(([k, d]) => {
    const s = (h) => (k + h < spy.length ? Number(spy[k + h].close) / Number(spy[k].close) - 1 : null);
    return { d, ew21: B[k + '|21'] ?? null, ew42: B[k + '|42'] ?? null, spy21: s(21), spy42: s(42) };
  });
  return { rows, bench };
}

function stats() {
  if (!fs.existsSync(HIST_PATH)) { console.log('no health-history.db yet'); return; }
  const db = openHist(true);
  for (const b of db.prepare('select * from health_builds order by build').all()) {
    const c = db.prepare('select count(score) n, min(d) a, max(d) z from health_months where build = ?').get(b.build);
    console.log(`build ${b.build}  ${b.at.slice(0, 16)}  health.js ${b.health_js}  ${b.rows} rows, ${c.n} scored, ${b.months} months ${c.a} to ${c.z}  ${b.note || ''}`);
  }
}

// Reading a build back for a study: one object a stock-month, inputs spread out, newest build by default.
function load(build) {
  const db = openHist(true);
  const b = build || db.prepare('select max(build) b from health_builds').get().b;
  const rows = db.prepare('select * from health_months where build = ?').all(b).map((r) => ({ ...JSON.parse(r.inputs),
    h: r.score, weighed: r.weighed, capped: r.capped, pillars: { business: r.business, results: r.results, valuation: r.valuation, price: r.price, sentiment: r.sentiment },
    r21: r.r21, r42: r.r42 }));
  const bench = new Map(db.prepare('select * from health_bench where build = ?').all(b).map((x) => [x.d, x]));
  return { build: b, rows, bench };
}

module.exports = { HIST_PATH, scoreMonth, scoreRows, load };

if (require.main === module) {
  (async () => {
    const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
    if (process.argv.includes('--stats')) return stats();
    let got;
    if (arg('--from-jsonl')) { got = fromJsonl(path.resolve(arg('--from-jsonl'))); got.note = arg('--note') || 'imported from ' + path.basename(arg('--from-jsonl')); }
    else got = await replay();
    scoreRows(got.rows);
    const db = openHist(false);
    const build = writeBuild(db, got.rows, got.bench, got.note);
    console.log(`build ${build}: ${got.rows.length} stock-months, ${got.rows.filter((r) => r.health && r.health.score != null).length} with a Health number, written to ${HIST_PATH}`);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
