// secdaily.js — next-day 8-Ks and 13D/13G filings, from the SEC's daily index.
//
// The owner, 2026-10-20, on hearing that the filings rotation re-checks each
// company once every seven days: "focus on the next-day freshness for
// 13D/13G and 8-Ks". The rotation stays as it was (it reads the financial
// statements, 1-5MB a company, and a week is fine for those). This adds a
// second, light pass each morning:
//
//   1. Read the SEC's master index for each business day since the last one
//      read: one file a day listing every filing made that day, by CIK and
//      form (https://www.sec.gov/Archives/edgar/daily-index/).
//   2. Keep the 8-K and Schedule 13D/13G lines whose CIK is a company we
//      track. A 13D or 13G is listed under the company it is about as well
//      as under its filer, which is what makes this work for them.
//   3. For just those companies, read the filing list (the submissions file,
//      about 0.15MB) and run the same two readers the rotation runs:
//      Events8k and Holders13. Nothing else.
//
// PURE: no fetches, no database. server.js hands in the fetches and the
// storage (step, below), so the whole of it is tested without either.
'use strict';

// The forms that matter here, as the index spells them. The structured
// 13D/13G (since December 2024) are SCHEDULE 13D/13G; the older SC 13D/13G
// are kept so a late amendment in the old form still wakes the company up
// (Holders13 itself reads only the structured ones).
const FORMS = new Set(['8-K', '8-K/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A',
  'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A']);
const kindOf = (form) => (/^8-K/.test(form) ? '8-K' : /13D/.test(form) ? '13D' : '13G');

// Dates as YYYY-MM-DD strings, worked at noon so no zone can move a day.
const at = (iso) => new Date(iso + 'T12:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = at(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekday = (s) => { const w = at(s).getUTCDay(); return w !== 0 && w !== 6; };

// Today in New York, where the SEC's days are.
function todayET(now) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now || new Date());
  return p;
}
// The business days after `through`, up to and including yesterday, oldest
// first, at most `max`. The index for a day is published that night, so
// today's is never asked for.
function datesToRead(through, today, max) {
  const out = [];
  for (let d = addDays(through, 1); d < today && out.length < (max || 3); d = addDays(d, 1)) if (weekday(d)) out.push(d);
  return out;
}
// Where a day's index starts when nothing has been read yet: three business
// days back, so a first run catches the recent past without a flood.
function startThrough(today) {
  let d = today, n = 0;
  while (n < 4) { d = addDays(d, -1); if (weekday(d)) n++; }
  return d;
}
function indexUrl(date) {
  const [y, m, dd] = date.split('-');
  return 'https://www.sec.gov/Archives/edgar/daily-index/' + y + '/QTR' + Math.ceil(Number(m) / 3) + '/master.' + y + m + dd + '.idx';
}
// A missing index is a holiday when the day is well past, and simply not
// published yet when it is recent: the run stops there and tries again.
function missingMeans(date, today) {
  return addDays(date, 3) < today ? 'holiday' : 'not yet';
}

// The master index: a header, a line of dashes, then
// CIK|Company Name|Form Type|Date Filed|Filename. Only the forms above.
function parseIndex(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^-{10,}/.test(l));
  const out = [];
  for (let i = start + 1; start >= 0 && i < lines.length; i++) {
    const f = lines[i].split('|');
    if (f.length < 5) continue;
    const form = f[2].trim();
    if (!FORMS.has(form)) continue;
    const cik = Number(f[0]);
    if (!(cik > 0)) continue;
    out.push({ cik, name: f[1].trim(), form, kind: kindOf(form), filed: f[3].trim(), file: f[4].trim() });
  }
  return out;
}
// The tracked companies those lines name: { symbols: [...], hits: [...] }.
// `ciks` maps a CIK to its symbols (a company with two share classes has
// two). Symbols come back in first-seen order, each once.
function match(lines, ciks) {
  const symbols = [], seen = new Set(), hits = [];
  for (const l of lines) {
    const syms = ciks.get(l.cik);
    if (!syms) continue;
    for (const s of syms) {
      hits.push({ symbol: s, form: l.form, kind: l.kind, filed: l.filed });
      if (!seen.has(s)) { seen.add(s); symbols.push(s); }
    }
  }
  return { symbols, hits };
}
// CIK -> symbols, from sec_state's rows ({ SYM: { cik } }), the universe only.
function cikMap(state, universe) {
  const m = new Map();
  for (const sym of universe || []) {
    const st = state && state[String(sym).toUpperCase()];
    const cik = st && Number(st.cik);
    if (!(cik > 0)) continue;
    if (!m.has(cik)) m.set(cik, []);
    m.get(cik).push(String(sym).toUpperCase());
  }
  return m;
}


// ONE BOUNDED STEP, with everything it touches handed in, so the whole
// logic is testable with no network and no database. server.js wires it:
//   today        YYYY-MM-DD in New York
//   readState()  -> the stored state or null;  writeState(st)
//   loadCiks()   -> { ciks: Map(cik -> [symbols]), cikOf(sym) -> cik }
//   fetchIndex(date) -> { status, text }  (throws on a network failure)
//   readOne(sym, cik) -> { ok } | { throttled } | { status }
// Up to `dates` index days are read when nothing is queued, then up to `n`
// companies are re-read. `done` means stop calling for now: the SEC could
// not be read (not published yet, or it asked us to slow down; whatever is
// queued waits for the next run), or nothing is queued and nothing is left.
async function step(o) {
  const prev = await o.readState();
  const st = prev && prev.through
    ? { through: prev.through, pending: Array.isArray(prev.pending) ? prev.pending : [], days: Array.isArray(prev.days) ? prev.days : [] }
    : { through: startThrough(o.today), pending: [], days: [] };
  const read = [], notes = [];
  let blocked = false;
  if (!st.pending.length) {
    const dates = datesToRead(st.through, o.today, o.dates || 2);
    if (dates.length) {
      const { ciks, cikOf } = await o.loadCiks();
      for (const d of dates) {
        let r;
        try { r = await o.fetchIndex(d); } catch (e) { notes.push(d + ': the index could not be read'); blocked = true; break; }
        if (r.status === 429) { notes.push('the SEC asked us to slow down'); blocked = true; break; }
        if (!(r.status >= 200 && r.status < 300)) {
          // Well past: a holiday, nothing filed. Recent: not published yet,
          // so stop and let the next run try again.
          if (missingMeans(d, o.today) === 'holiday') { st.through = d; read.push({ date: d, holiday: true }); continue; }
          notes.push(d + ': index not published yet'); blocked = true; break;
        }
        const m = match(parseIndex(r.text), ciks);
        const queued = new Set(st.pending.map((p) => p[0]));
        for (const s of m.symbols) if (!queued.has(s)) { st.pending.push([s, cikOf(s)]); queued.add(s); }
        st.through = d;
        const by = {}; for (const h of m.hits) by[h.kind] = (by[h.kind] || 0) + 1;
        read.push({ date: d, companies: m.symbols.length, filings: by });
      }
    }
  }
  const fetched = [];
  for (let i = 0; i < (o.n || 6) && st.pending.length; i++) {
    const [sym, cik] = st.pending[0];
    if (!(cik > 0)) { st.pending.shift(); continue; }
    let r;
    try { r = await o.readOne(sym, cik); } catch (e) { r = { status: 'error' }; }
    if (r && r.throttled) { notes.push('the SEC asked us to slow down'); blocked = true; break; }
    // A company whose list could not be read leaves the queue rather than
    // blocking it: the weekly rotation still reaches it.
    st.pending.shift();
    if (r && r.ok) fetched.push(sym);
  }
  st.days = st.days.concat(read).slice(-14);
  st.at = o.now || Date.now();
  await o.writeState(st);
  const more = datesToRead(st.through, o.today, 1).length > 0;
  return { through: st.through, read, fetched: fetched.length, symbols: fetched, remaining: st.pending.length,
    done: blocked || (!st.pending.length && !more), notes };
}

module.exports = { step, FORMS, todayET, datesToRead, startThrough, indexUrl, missingMeans, parseIndex, match, cikMap, addDays };
