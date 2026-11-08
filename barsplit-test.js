// Splits and the bar archive (barsplit.js, 2026-11-08).
//
//   node barsplit-test.js
//
// The pure decisions, then persistBars, rescaleBars and repairStored run for
// real against Node's in-memory SQLite through db.js's own functions: db.js
// reaches its database only through store.db.execute / store.db.batch, and
// both are replaced before the first call, so nothing here can touch Turso.
'use strict';
process.env.TURSO_DATABASE_URL = 'libsql://in-memory-test.invalid';
process.env.TURSO_AUTH_TOKEN = 'none';
const { DatabaseSync } = require('node:sqlite');
const store = require('./db.js');
const B = require('./barsplit.js');

const mem = new DatabaseSync(':memory:');
const run = (stmt) => {
  const sql = typeof stmt === 'string' ? stmt : stmt.sql;
  const args = (typeof stmt === 'string' ? [] : stmt.args || []).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const p = mem.prepare(sql);
  if (/^\s*(select|pragma|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) return { rows: p.all(...args), rowsAffected: 0 };
  const r = p.run(...args);
  return { rows: [], rowsAffected: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
};
store.db.execute = async (stmt) => run(stmt);
store.db.batch = async (stmts) => {
  mem.exec('begin');
  try { const out = (stmts || []).map(run); mem.exec('commit'); return out; } catch (e) { mem.exec('rollback'); throw e; }
};

let n = 0, failed = 0;
function check(label, got, want) {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
  else console.log(`  ok    ${label}`);
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const one = (sql, ...a) => mem.prepare(sql).get(...a);
const count = (sym) => one('select count(*) n from bars where symbol = ?', sym).n;
const closeOn = (sym, d) => { const r = one('select close from bars where symbol = ? and d = ?', sym, d); return r ? r.close : null; };

// Weekday dates ending at `end`, oldest first.
function days(nDays, end) {
  const out = []; const t = new Date(end + 'T12:00:00');
  while (out.length < nDays) { const w = t.getDay(); if (w !== 0 && w !== 6) out.unshift(t.toISOString().slice(0, 10)); t.setDate(t.getDate() - 1); }
  return out;
}
// A gently rising price: day i closes at 100 + i * 0.1.
const px = (i) => 100 + i * 0.1;
async function seed(sym, ds, scaleBefore = null, f = 1) {
  await store.replaceBarsFor(sym, ds.map((d, i) => {
    const c = px(i) * (scaleBefore && d < scaleBefore ? f : 1);
    return { symbol: sym, d, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 };
  }));
}
// The provider's newest `k` bars, newest first, with every bar before `splitAt` divided by f (an adjusted split).
function fetched(ds, k, { splitAt = null, f = 1, shiftAll = 1, only = null } = {}) {
  const tail = ds.slice(-k);
  return { values: tail.map((d) => {
    const i = ds.indexOf(d);
    let c = px(i) * shiftAll;
    if (splitAt && d < splitAt) c = c / f;
    if (only && d === only.d) c = c * only.r;
    return { datetime: d, open: String(c), high: String(c * 1.01), low: String(c * 0.99), close: String(c), volume: '1000' };
  }).reverse() };
}

(async () => {
  console.log('windowSplit, the pure decision');
  const st = new Map([['2026-01-05', 100], ['2026-01-06', 101], ['2026-01-07', 102], ['2026-01-08', 103]]);
  check('nothing re-priced is "same"', B.windowSplit([{ d: '2026-01-05', close: 100 }, { d: '2026-01-06', close: 101 }], st).kind, 'same');
  check('a clean two-for-one: older bars halved, newer equal -> rescale by 0.5',
    B.windowSplit([{ d: '2026-01-05', close: 50 }, { d: '2026-01-06', close: 50.5 }, { d: '2026-01-07', close: 102 }, { d: '2026-01-08', close: 103 }], st), { kind: 'rescale', k: 0.5, changed: 2 });
  check('one changed bar is not enough (a provider correction looks the same)',
    B.windowSplit([{ d: '2026-01-05', close: 50 }, { d: '2026-01-06', close: 101 }], st).kind, 'conflict');
  check('changes on both sides of an unchanged bar are not a split',
    B.windowSplit([{ d: '2026-01-05', close: 50 }, { d: '2026-01-06', close: 101 }, { d: '2026-01-07', close: 51 }, { d: '2026-01-08', close: 103 }], st).kind, 'conflict');
  check('changed bars that disagree on the factor are not a split',
    B.windowSplit([{ d: '2026-01-05', close: 50 }, { d: '2026-01-06', close: 33.7 }, { d: '2026-01-07', close: 102 }], st).kind, 'conflict');
  check('no shared date is a conflict, never a rescale', B.windowSplit([{ d: '2026-02-01', close: 1 }], st).kind, 'conflict');

  console.log('storedStep, a listed split the archive never took');
  // IESC as stored in production: 685.04 on Aug 21, 313.23 on Aug 25 (no Aug 24 bar), split 2026-08-24 x2.
  const iesc = [['2026-08-14', 756.18], ['2026-08-17', 793.96], ['2026-08-18', 738.79], ['2026-08-19', 697.38], ['2026-08-20', 683.27],
    ['2026-08-21', 685.04], ['2026-08-25', 313.23], ['2026-08-26', 331.48], ['2026-08-27', 333.67], ['2026-08-28', 309.80]].map(([d, close]) => ({ d, close }));
  const s1 = B.storedStep(iesc, { d: '2026-08-24', f: 2 });
  check('IESC: unadjusted, cliff at Aug 25, scale the bars before it by 0.5', [s1.kind, s1.at, s1.k], ['unadjusted', '2026-08-25', 0.5]);
  const adjusted = iesc.map((b) => ({ d: b.d, close: b.d < '2026-08-25' ? b.close / 2 : b.close }));
  check('the same series already adjusted: nothing to do', B.storedStep(adjusted, { d: '2026-08-24', f: 2 }).kind, 'adjusted');
  check('a real 30% fall on a two-for-one date is not taken for the split',
    B.storedStep([{ d: '2026-03-02', close: 100 }, { d: '2026-03-03', close: 70 }], { d: '2026-03-03', f: 2 }).kind, 'adjusted');
  check('a 15% stock dividend on an already-adjusted, flat series is not mistaken for unadjusted',
    B.storedStep([{ d: '2026-04-01', close: 50 }, { d: '2026-04-02', close: 50 }, { d: '2026-04-03', close: 50.2 }], { d: '2026-04-02', f: 1.15 }).kind, 'adjusted');
  check('a spin-off price factor is not a split (REZI 1.437, shares unchanged)',
    B.storedStep([{ d: '2026-08-12', close: 25.71 }, { d: '2026-08-13', close: 20.46 }], { d: '2026-08-04', f: 1.437 }).kind, 'skip');
  check('nor is an unexplained factor that is close to one (ATRO 1.253)',
    B.storedStep([{ d: '2026-06-05', close: 84.72 }, { d: '2026-06-08', close: 67.29 }], { d: '2026-06-15', f: 1.253 }).kind, 'skip');
  check('a three-for-two is a whole ratio and is judged',
    B.storedStep([{ d: '2026-02-02', close: 90 }, { d: '2026-02-03', close: 60.5 }], { d: '2026-02-03', f: 1.5 }).kind, 'unadjusted');
  check('a 1% stock dividend is skipped (too small to tell from a day)', B.storedStep(iesc, { d: '2026-08-24', f: 1.0106 }).kind, 'skip');
  check('a one-for-ten reverse split, unadjusted: scale before by 10',
    (() => { const r = B.storedStep([{ d: '2026-05-01', close: 2.1 }, { d: '2026-05-04', close: 20.5 }], { d: '2026-05-04', f: 0.1 }); return [r.kind, r.at, Math.round(r.k)]; })(), ['unadjusted', '2026-05-04', 10]);
  check('the provider’s date need not be the step’s (Mueller: listed Jul 1, stepped Jun 25)',
    B.storedStep([{ d: '2026-06-24', close: 120 }, { d: '2026-06-25', close: 61 }, { d: '2026-06-26', close: 60 }, { d: '2026-07-01', close: 61 }], { d: '2026-07-01', f: 2 }).at, '2026-06-25');

  console.log('undoesSplit');
  check('k = f undoes a two-for-one', B.undoesSplit(2, [{ d: '2026-08-24', f: 2 }]), true);
  check('k = 1/f adjusts for it', B.undoesSplit(0.5, [{ d: '2026-08-24', f: 2 }]), false);
  check('a reverse split: k = f (0.1) undoes, k = 10 adjusts', [B.undoesSplit(0.1, [{ f: 0.1 }]), B.undoesSplit(10, [{ f: 0.1 }])], [true, false]);
  check('no split held: nothing to undo', B.undoesSplit(2, []), false);

  console.log('persistBars against a real archive');
  const ds = days(420, '2026-11-06');
  const splitAt = ds[ds.length - 6];                 // a two-for-one six sessions ago
  // 1) the live pull sees a split the provider applied: the old code deleted the symbol and kept 12 rows.
  await seed('AAA', ds.slice(0, -1));                // archive through yesterday, unadjusted
  const r1 = await B.persistBars(store, ['AAA'], { AAA: fetched(ds, 12, { splitAt, f: 2 }) });
  check('a split seen in a 12-bar pull keeps the whole history (420 bars, not 12)', count('AAA'), 420);
  check('…and scales the older bars by 0.5', near(closeOn('AAA', ds[0]), px(0) / 2), true);
  check('…the window is the provider’s (adjusted) bars', near(closeOn('AAA', ds[ds.length - 8]), px(ds.length - 8) / 2), true);
  check('…the bars after the split are untouched', near(closeOn('AAA', ds[ds.length - 1]), px(ds.length - 1)), true);
  check('…no cliff left across the split', near(closeOn('AAA', splitAt) / closeOn('AAA', ds[ds.indexOf(splitAt) - 1]), px(ds.indexOf(splitAt)) / (px(ds.indexOf(splitAt) - 1) / 2), 1e-9), true);
  check('…reported as one split with its factor', [r1.splits.length, r1.splits[0] && r1.splits[0].k], [1, 0.5]);
  const r1b = await B.persistBars(store, ['AAA'], { AAA: fetched(ds, 12, { splitAt, f: 2 }) });
  check('the next round sees nothing to rescale (not scaled twice)', [r1b.splits.length, near(closeOn('AAA', ds[0]), px(0) / 2)], [0, true]);

  // 2) one disagreeing bar: kept as stored, only newer bars taken.
  await seed('BBB', ds.slice(0, -1));
  const r2 = await B.persistBars(store, ['BBB'], { BBB: fetched(ds, 12, { only: { d: ds[ds.length - 12], r: 0.8 } }) });
  check('a single disagreeing bar: history and that bar kept as stored', [count('BBB'), near(closeOn('BBB', ds[ds.length - 12]), px(ds.length - 12))], [420, true]);
  check('…reported as a conflict, not a split', [r2.splits.length, r2.conflicts.length], [0, 1]);

  // 3) the archive already took a split the provider never applied; a deep pull of the provider's
  //    unadjusted bars must not undo it.
  await seed('CCC', ds.slice(0, -1), splitAt, 0.5);  // archive adjusted: before the split, halved
  await store.writeSplits('CCC', [{ d: splitAt, f: 2 }]);
  const r3 = await B.persistBars(store, ['CCC'], { CCC: fetched(ds, 300) });   // provider: unadjusted
  check('the provider’s unadjusted bars do not undo a split already applied', near(closeOn('CCC', ds[0]), px(0) * 0.5), true);
  check('…a conflict, and the newest bar still taken', [r3.conflicts.length, near(closeOn('CCC', ds[ds.length - 1]), px(ds.length - 1))], [1, true]);

  // 4) a window that does not reach the archive is added beside it, never in place of it.
  await seed('DDD', ds.slice(0, 200));
  await B.persistBars(store, ['DDD'], { DDD: fetched(ds, 12) });
  check('no overlap: the 200 stored bars stay and the 12 are added', count('DDD'), 212);

  // 5) nothing stored: the fetch becomes the archive.
  await B.persistBars(store, ['EEE'], { EEE: fetched(ds, 12) });
  check('a new symbol takes the window', count('EEE'), 12);

  console.log('repairStored and the archive');
  await seed('FFF', ds, splitAt, 2);                  // an IESC: before the split, still at twice the price
  await store.writeSplits('FFF', [{ d: splitAt, f: 2 }]);
  const dry = await B.repairStored(store, { since: '2026-01-01', only: ['FFF'] });
  check('dry run finds the cliff and changes nothing', [dry.length, dry[0] && dry[0].at, near(closeOn('FFF', ds[0]), px(0) * 2)], [1, splitAt, true]);
  const done = await B.repairStored(store, { since: '2026-01-01', only: ['FFF'], commit: true });
  check('commit scales every bar before the cliff (all 414 of them)', done[0].scaled, ds.indexOf(splitAt));
  check('…the archive is continuous again', near(closeOn('FFF', ds[0]), px(0)), true);
  check('…volume is put on the new share count (x2)', one('select volume v from bars where symbol = ? and d = ?', 'FFF', ds[0]).v, 2000);
  check('a second run finds nothing (idempotent)', (await B.repairStored(store, { since: '2026-01-01', only: ['FFF'], commit: true })).length, 0);

  console.log('rescaleBars is one transaction');
  await seed('GGG', ds.slice(0, 50));
  let threw = false;
  try { await store.rescaleBars('GGG', ds[40], 0.5, [{ symbol: 'GGG', d: ds[45], close: null }]); } catch { threw = true; }
  check('a window that fails to write leaves the older bars unscaled', [threw, near(closeOn('GGG', ds[0]), px(0))], [true, true]);

  console.log(`\n${n - failed} of ${n} checks passed${failed ? `, ${failed} FAILED` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
