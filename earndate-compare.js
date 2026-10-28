// HOW GOOD IS OUR NEXT-REPORT DATE, beside two sources of confirmed dates?
// (2026-10-28, the owner asked about earnings calendars; Twelve Data confirms
// a date for about 18 of ~1,280 stocks, so nearly every Next Earn date is
// earndate.js's estimate, and that date feeds the Signal's Earnings soon rule.)
//
// READ ONLY: nothing is written to the database. Two steps:
//
//   node --use-system-ca earndate-compare.js [--days 21]
//     Records what each source says today and saves it beside this script as
//     earndate-compare-<day>.json (not in git):
//       ours     profiles.nextEarningsDate, and whether it is our estimate
//       nasdaq   api.nasdaq.com's earnings calendar, one call a weekday ahead
//       av       Alpha Vantage EARNINGS_CALENDAR, one call for three months,
//                when .env holds Alpha_Vantage (the name used on Vercel)
//     Prints how far they agree and how many Balanced Signals would read
//     Earnings soon differently.
//
//   node --use-system-ca earndate-compare.js --score earndate-compare-<day>.json
//     After the window has passed: each source against the day the company's
//     results 8-K (item 2.02) was filed, from sec_events. A report after the
//     close is often filed the next business day, so a filing one business
//     day after an after-hours date counts as on time.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const store = require('./db.js');
const ActionRules = require('./private/action.js');
const EarnCal = require('./earncal.js');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DAYS = Number(arg('--days')) || 21;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLACKOUT = ((ActionRules.PRESETS.Balanced || {}).earnings || ActionRules.DEFAULTS.earnings).blackout_days;

// Days as YYYY-MM-DD at noon UTC, so no zone moves them.
const dayMs = (d) => Date.parse(d + 'T12:00:00Z');
const addDays = (d, n) => new Date(dayMs(d) + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((dayMs(a) - dayMs(b)) / 86400000);
const isWeekday = (d) => { const w = new Date(dayMs(d)).getUTCDay(); return w > 0 && w < 6; };
const nextBizDay = (d) => { let x = addDays(d, 1); while (!isWeekday(x)) x = addDays(x, 1); return x; };
const easternToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function envKey(name) {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
      const m = new RegExp('^\\s*' + name + '\\s*=\\s*(.*)$').exec(line);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
  return process.env[name] || '';
}

async function nasdaq(from, days) { return EarnCal.fetchNasdaq(from, days); }
async function alphaVantage() {
  const key = envKey('Alpha_Vantage') || envKey('ALPHA_VANTAGE_API_KEY');
  if (!key) return { rows: null, note: 'no Alpha_Vantage in .env' };
  const r = await EarnCal.fetchAlphaVantage(key);
  return r.rows ? { rows: r.rows, note: Object.keys(r.rows).length + ' companies' } : { rows: null, note: 'not read (' + r.reason + ')' };
}

function pctTxt(n, of) { return of ? n + ' (' + Math.round(n / of * 100) + '%)' : String(n); }

async function snapshot() {
  const today = easternToday(), until = addDays(today, DAYS);
  console.log('Recording next report dates, ' + today + ' to ' + until + ' (Earnings soon is ' + BLACKOUT + ' days in Balanced)');
  const profiles = await store.readProfiles();
  const universe = Object.keys(profiles).filter((s) => profiles[s]);
  const [nq, av] = [await nasdaq(today, DAYS), await alphaVantage()];
  nq.rows = nq.rows || {};
  console.log('  Nasdaq: ' + Object.keys(nq.rows).length + ' companies over ' + nq.calls + ' weekdays' + (nq.failed ? ', ' + nq.failed + ' calls failed' : ''));
  console.log('  Alpha Vantage: ' + av.note);
  const rows = {};
  for (const s of universe) {
    const p = profiles[s];
    rows[s] = {
      ours: p.nextEarningsDate ? String(p.nextEarningsDate).slice(0, 10) : null, est: !!p.nextEarningsEstimated,
      nasdaq: nq.rows[s] || null, av: av.rows ? av.rows[s] || null : undefined,
    };
  }
  const file = path.join(__dirname, 'earndate-compare-' + today + '.json');
  fs.writeFileSync(file, JSON.stringify({ at: today, days: DAYS, until, blackout: BLACKOUT, rows }, null, 1));
  report(rows, today, until, !!av.rows);
  console.log('\nSaved ' + path.basename(file) + '. After ' + until + ', score it with --score ' + path.basename(file));
}

function report(rows, today, until, haveAv) {
  const syms = Object.keys(rows);
  const inWin = (d) => d && d >= today && d <= until;
  const soon = (d) => d != null && diffDays(d, today) >= 0 && diffDays(d, today) <= BLACKOUT;
  for (const [src, label] of [['nasdaq', 'Nasdaq'], ['av', 'Alpha Vantage']]) {
    if (src === 'av' && !haveAv) continue;
    const both = syms.filter((s) => rows[s][src] && inWin(rows[s][src].d));
    const ests = both.filter((s) => rows[s].est && rows[s].ours);
    const same = ests.filter((s) => rows[s].ours === rows[s][src].d);
    const near = ests.filter((s) => Math.abs(diffDays(rows[s].ours, rows[s][src].d)) <= 7);
    const flips = syms.filter((s) => rows[s][src] && inWin(rows[s][src].d) && soon(rows[s].ours) !== soon(rows[s][src].d));
    console.log('\n' + label + ': ' + both.length + ' of ' + syms.length + ' universe stocks report by ' + until);
    console.log('  where our date is an estimate (' + ests.length + '): same day ' + pctTxt(same.length, ests.length) + ', within a week ' + pctTxt(near.length, ests.length));
    const worst = ests.map((s) => [s, diffDays(rows[s].ours, rows[s][src].d)]).filter((x) => x[1] !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
    if (worst.length) console.log('  furthest apart (ours minus theirs, days): ' + worst.map(([s, d]) => s + ' ' + (d > 0 ? '+' : '') + d).join(', '));
    console.log('  Earnings soon would read differently today for ' + flips.length + ' stocks' + (flips.length ? ': ' + flips.slice(0, 20).join(', ') + (flips.length > 20 ? ' ...' : '') : ''));
  }
  if (haveAv) {
    const both = syms.filter((s) => rows[s].nasdaq && rows[s].av && inWin(rows[s].nasdaq.d));
    const agree = both.filter((s) => rows[s].nasdaq.d === rows[s].av.d);
    console.log('\nNasdaq and Alpha Vantage, both listing a date by ' + until + ': ' + both.length + ', the same day ' + pctTxt(agree.length, both.length));
  }
}

async function score(file) {
  const snap = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const today = easternToday();
  if (today <= snap.until) console.log('NOTE: the window runs to ' + snap.until + '; reports still to come are scored as not yet filed.');
  const events = await store.readSecEventsSince(snap.at);
  const actual = {};
  for (const e of events) {
    if (!/\b2\.02\b/.test(e.items) || !snap.rows[e.symbol]) continue;
    if (!actual[e.symbol] || e.filed < actual[e.symbol]) actual[e.symbol] = e.filed.slice(0, 10);
  }
  console.log('Scoring ' + path.basename(file) + ' (' + snap.at + ' to ' + snap.until + '): ' + Object.keys(actual).length + ' results 8-Ks filed since');
  const onTime = (pred, filed) => filed === pred.d || (/after/.test(pred.time || '') && filed === nextBizDay(pred.d));
  for (const [src, label] of [['ours', 'Ours (estimates only)'], ['oursAll', 'Ours (all)'], ['nasdaq', 'Nasdaq'], ['av', 'Alpha Vantage']]) {
    let n = 0, exact = 0, one = 0, week = 0, none = 0;
    for (const [s, r] of Object.entries(snap.rows)) {
      const pred = src === 'ours' ? (r.est && r.ours ? { d: r.ours } : null) : src === 'oursAll' ? (r.ours ? { d: r.ours } : null) : r[src];
      if (!pred || !pred.d || pred.d < snap.at || pred.d > snap.until) continue;
      n++;
      const f = actual[s];
      if (!f) { none++; continue; }
      const gap = Math.abs(diffDays(f, pred.d));
      if (onTime(pred, f)) exact++;
      if (onTime(pred, f) || gap <= 1) one++;
      if (gap <= 7) week++;
    }
    if (!n) continue;
    console.log('  ' + label.padEnd(22) + n + ' dated in the window: on the day ' + pctTxt(exact, n) + ', within a day ' + pctTxt(one, n) + ', within a week ' + pctTxt(week, n) + ', no 8-K yet ' + none);
  }
}

(async () => {
  const f = arg('--score');
  await (f ? score(f) : snapshot());
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
