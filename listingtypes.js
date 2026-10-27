// INSTRUMENT TYPE FOR EVERY US LISTING (2026-10-27, the owner: "Can you show
// the instrument column on this page?" — /nasdaq). The NASDAQ file says what a
// company is called and where it trades, never what the security IS, so a
// 5.35% note due 2066 (TBB) reads like a stock beside Equinor's ADR. The
// screener's Instrument column already takes this fact from Twelve Data's
// /stocks reference list; this is the same source for the whole list.
//
// FREE AND ONE REQUEST. /stocks sends no `api-credits-request` header (checked
// 2026-10-27: 20,507 US rows, unmetered), so it costs nothing against the 610
// a minute and the whole country comes back in a single call.
//
// PINNED TO THE COUNTRY, AND TO THE MAIN EXCHANGES. Without country= the list
// answers with whichever listing it likes. Within the US, 12,848 of the rows
// are OTC; where a symbol appears twice the exchange listing wins, because
// that is the one the NASDAQ file describes.
const MAIN = new Set(['NYSE', 'NASDAQ', 'CBOE']);

// rows: /stocks `data`. Returns [{ symbol, type }] — Twelve Data's own symbol
// spelling (BRK.A, where NASDAQ writes BRK/A; db.js joins across the two).
function pickTypes(rows) {
  const best = new Map();
  for (const r of rows || []) {
    const sym = String((r && r.symbol) || '').trim().toUpperCase();
    const type = String((r && r.type) || '').trim().slice(0, 48);
    if (!sym || !type || sym.length > 20) continue;
    const main = MAIN.has(String(r.exchange || '').toUpperCase());
    const had = best.get(sym);
    if (!had || (main && !had.main)) best.set(sym, { type, main });
  }
  return [...best].map(([symbol, v]) => ({ symbol, type: v.type }));
}

async function fetchListingTypes(apiKey, timeoutMs = 30000) {
  if (!apiKey) throw new Error('no API key');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.twelvedata.com/stocks?country=United%20States&apikey=' + encodeURIComponent(apiKey), { signal: ac.signal });
    if (!res.ok) throw new Error('reference list returned ' + res.status);
    const j = await res.json();
    const rows = pickTypes(j && j.data);
    // An empty or tiny answer is a fault, not news: refuse rather than store it.
    if (rows.length < 1000) throw new Error('reference list returned ' + rows.length + ' rows');
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { pickTypes, fetchListingTypes };
