// THE EARNINGS CALENDAR: companies' announced report days, from Alpha Vantage
// or Nasdaq (2026-10-28, the owner chose confirmed dates over our estimate).
//
// Measured that day (earndate-compare.js): the two agreed on 802 of 811
// universe stocks reporting in the next three weeks, so they are one source
// in practice. Alpha Vantage is first: one call covers three months, it is an
// API meant for this, and its key (Alpha_Vantage) is set on Vercel. Nasdaq is
// the fallback: keyless, one call a weekday, and known to refuse some
// data-centre addresses.
//
// IT FEEDS THE SIGNAL. A listed day replaces our estimate as the profile's
// nextEarningsDate, which the Earnings soon rule reads.
//
// Fetch and parse only: no database, no state. Used by server.js (the
// nightly's calendar phase) and earndate-compare.js.
'use strict';

const NASDAQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const dayMs = (d) => Date.parse(d + 'T12:00:00Z');
const addDays = (d, n) => new Date(dayMs(d) + n * 86400000).toISOString().slice(0, 10);
const isWeekday = (d) => { const w = new Date(dayMs(d)).getUTCDay(); return w > 0 && w < 6; };
// Class shares are written BRK/B or BRK-B upstream; the universe uses a dot.
const normSym = (s) => String(s || '').trim().toUpperCase().replace(/[/-]/, '.');
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// A CSV line with quoted fields (company names carry commas).
function csvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// Alpha Vantage's CSV into { SYM: { d, time } }, or null when what came back
// is not the calendar (a refusal arrives as JSON with a message).
function parseAlphaVantage(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  const head = csvLine(lines[0] || '').map((h) => h.trim());
  const iS = head.indexOf('symbol'), iD = head.indexOf('reportDate'), iT = head.indexOf('timeOfTheDay');
  if (iS < 0 || iD < 0) return null;
  const out = {};
  for (const l of lines.slice(1)) {
    const f = csvLine(l), s = normSym(f[iS]), d = String(f[iD] || '').trim();
    // A company listed twice keeps its earliest day: that is the next one.
    if (s && ISO.test(d) && (!out[s] || d < out[s].d)) out[s] = { d, time: iT >= 0 ? (f[iT] || '').trim() || null : null };
  }
  return out;
}

async function fetchAlphaVantage(key) {
  if (!key) return { rows: null, reason: 'no key' };
  const r = await fetch('https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=' + encodeURIComponent(key), { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return { rows: null, reason: 'HTTP ' + r.status };
  const rows = parseAlphaVantage(await r.text());
  // Never pass the body on: it can echo the request, key included.
  return rows ? { rows, reason: null } : { rows: null, reason: 'no calendar in the answer' };
}

// Nasdaq's calendar for one day's JSON into rows.
function parseNasdaq(json, d) {
  const out = {};
  for (const row of (json && json.data && json.data.rows) || []) {
    const s = normSym(row.symbol);
    if (s && !out[s]) out[s] = { d, time: String(row.time || '').replace('time-', '') || null };
  }
  return out;
}

async function fetchNasdaq(from, days, gapMs = 600) {
  const out = {}; let calls = 0, failed = 0;
  for (let i = 0; i <= days; i++) {
    const d = addDays(from, i);
    if (!isWeekday(d)) continue;
    calls++;
    try {
      const r = await fetch('https://api.nasdaq.com/api/calendar/earnings?date=' + d, { headers: { 'User-Agent': NASDAQ_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { failed++; continue; }
      const day = parseNasdaq(await r.json(), d);
      for (const [s, v] of Object.entries(day)) if (!out[s]) out[s] = v;
    } catch { failed++; }
    if (gapMs) await new Promise((res) => setTimeout(res, gapMs));
  }
  // Every call refused is no calendar at all, not an empty one.
  return { rows: calls && failed === calls ? null : out, calls, failed };
}

module.exports = { normSym, csvLine, parseAlphaVantage, fetchAlphaVantage, parseNasdaq, fetchNasdaq, addDays };
