// ipos.js — companies filing to go public in the US, from the SEC.
//
// The owner, 2026-11-02, the day Anthropic, PBC amended its S-1 (proposed
// ticker ANT on the Nasdaq Global Select Market): "get all the new pre-ipo
// filings". A company in registration has no price, so it cannot be a
// screener row; it gets its own page, /ipos (members). When one starts trading
// the owner decides whether its ticker joins the universe, in the theme
// "New Listing".
//
// HOW A COMPANY IS FOUND. The SEC's daily index, which the morning filings
// check (secdaily.js) already reads, lists every S-1, F-1 (the foreign form),
// their amendments, the final prospectus (424B4 or 424B1), the SEC's notice
// that a registration is effective (EFFECT) and a withdrawal (RW). Those lines
// are queued; for each new company its filing list (the submissions file,
// about 0.15MB) says whether it is going public for the first time:
//   - a blank-cheque company (SIC 6770, a SPAC) is left out;
//   - a company that filed a 10-K, 10-Q, 20-F or 40-F before its first
//     registration statement is already public (a follow-on or a resale
//     registration, Traws Pharma's S-1 of 2026-10-26) and is left out.
// Every other company is kept, with every registration filing on its list,
// including the confidential drafts (DRS) the SEC releases once the S-1 is
// public. A company left out is remembered, so its next filing costs nothing.
//
// WHAT THE PROSPECTUS SAYS. The cover page of the newest registration
// statement names the proposed ticker and exchange, the price range once it
// is printed, and the price in the final prospectus. Only the start of the
// document is read (the cover is at the top; Anthropic's S-1/A is 14MB).
//
// PURE: no fetches, no database. server.js and ipo-load.js hand them in.
'use strict';

// Forms read from the daily index, as the index spells them.
const INDEX_FORMS = new Set(['S-1', 'S-1/A', 'F-1', 'F-1/A', '424B4', '424B1', 'EFFECT', 'RW']);
// Forms kept from a company's filing list. DRS are the confidential drafts;
// MEF registers a few more shares on the day of pricing.
const HISTORY_FORMS = new Set(['DRS', 'DRS/A', 'S-1', 'S-1/A', 'F-1', 'F-1/A', 'S-1MEF', 'F-1MEF', '424B4', '424B1', 'EFFECT', 'RW']);
const REG_FORM = /^(DRS|S-1|F-1)(\/A)?$/;           // a registration statement or a draft of one
const PUBLIC_REG = /^(S-1|F-1)(\/A)?$/;             // the public ones, whose cover is read
const FINAL = /^424B[14]$/;                          // the final prospectus: the offering is priced
const PERIODIC = /^(10-K|10-Q|20-F|40-F|10-KT|10-QT)(\/A)?$/;

// What each form is, for the page.
const FORM_NAMES = {
  'DRS': 'Confidential draft', 'DRS/A': 'Confidential draft, amended',
  'S-1': 'Registration statement', 'S-1/A': 'Registration statement, amended',
  'F-1': 'Registration statement (foreign company)', 'F-1/A': 'Registration statement (foreign company), amended',
  'S-1MEF': 'More shares registered', 'F-1MEF': 'More shares registered',
  '424B4': 'Final prospectus: priced', '424B1': 'Final prospectus: priced',
  'EFFECT': 'Declared effective by the SEC', 'RW': 'Registration withdrawn',
};

const day = (s) => {
  const t = String(s || '').trim();
  if (/^\d{8}$/.test(t)) return t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
};
const accnOfPath = (p) => (String(p || '').match(/(\d{10}-\d{2}-\d{6})/) || [])[1] || '';
const docUrl = (cik, accn, doc) => 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/' + doc;
const filingUrl = (cik, accn) => 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(accn).replace(/-/g, '') + '/' + accn + '-index.htm';
const companyUrl = (cik) => 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + String(cik).padStart(10, '0') + '&type=&dateb=&owner=include&count=40';
const subsUrl = (cik) => 'https://data.sec.gov/submissions/CIK' + String(cik).padStart(10, '0') + '.json';
const olderUrl = (name) => 'https://data.sec.gov/submissions/' + String(name).replace(/[^A-Za-z0-9._-]/g, '');

// The daily master index: a header, a line of dashes, then
// CIK|Company Name|Form Type|Date Filed|Filename. Only the forms above.
function parseIndex(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^-{10,}/.test(l));
  const out = [];
  for (let i = start + 1; start >= 0 && i < lines.length; i++) {
    const f = lines[i].split('|');
    if (f.length < 5) continue;
    const form = f[2].trim();
    if (!INDEX_FORMS.has(form)) continue;
    const cik = Number(f[0]), accn = accnOfPath(f[4]), filed = day(f[3]);
    if (!(cik > 0) || !accn || !filed) continue;
    out.push({ cik, name: f[1].trim(), form, filed, accn });
  }
  return out;
}

// The submissions file's recent filings as rows, oldest first.
function rows(sub) {
  const r = (sub && sub.filings && sub.filings.recent) || {};
  const n = Array.isArray(r.form) ? r.form.length : 0, out = [];
  for (let i = 0; i < n; i++) {
    const filed = day(r.filingDate && r.filingDate[i]);
    if (!filed) continue;
    out.push({ form: String(r.form[i] || ''), filed, accn: String((r.accessionNumber && r.accessionNumber[i]) || ''), doc: String((r.primaryDocument && r.primaryDocument[i]) || '') });
  }
  return out.sort((a, b) => (a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : a.accn < b.accn ? -1 : 1));
}

// THE OLDER FILINGS. The submissions file's `recent` list stops at about a
// thousand filings; the rest sit in further files listed under `files`, each
// with the dates it covers. CoreWeave's directors' trading reports pushed its
// March 2025 S-1 out of `recent` by September (found 2026-11-02), so it was
// stored with no registration statement at all. When `recent` starts after
// `since`, the older files covering `since` onward are read too.
function olderFiles(sub, since) {
  const all = rows(sub);
  const files = (sub && sub.filings && Array.isArray(sub.filings.files)) ? sub.filings.files : [];
  if (!files.length || !since || !all.length || all[0].filed <= since) return [];
  return files.filter((f) => f && f.name && String(f.filingTo || '') >= since).map((f) => f.name);
}
// The submissions file with older files' filings added to `recent`. An older
// file holds the same arrays at its top level.
function mergeOlder(sub, olders) {
  const r = (sub && sub.filings && sub.filings.recent) || {};
  const keys = ['form', 'filingDate', 'accessionNumber', 'primaryDocument'];
  const out = {};
  for (const k of keys) out[k] = (Array.isArray(r[k]) ? r[k] : []).slice();
  for (const o of olders || []) {
    const n = o && Array.isArray(o.form) ? o.form.length : 0;
    for (let i = 0; i < n; i++) for (const k of keys) out[k].push(Array.isArray(o[k]) ? o[k][i] : '');
  }
  return Object.assign({}, sub, { filings: Object.assign({}, (sub && sub.filings) || {}, { recent: out }) });
}

// Is this company going public for the first time? { keep, reason }.
// `trigger` is the day of the S-1 or F-1 that brought it here: a company
// that filed an annual or quarterly report before that day was already
// public (a follow-on or a resale registration, or one that listed before
// the period read and registers more shares now). Without a trigger, its
// first registration statement stands in.
function judge(sub, trigger) {
  if (!sub) return { keep: false, reason: 'no filing list' };
  if (String(sub.sic || '') === '6770') return { keep: false, reason: 'blank-cheque company (SPAC)' };
  const all = rows(sub);
  const firstReg = day(trigger) || (all.find((x) => REG_FORM.test(x.form)) || {}).filed || '9999-12-31';
  const before = all.find((x) => PERIODIC.test(x.form) && x.filed < firstReg);
  if (before) return { keep: false, reason: 'already public: ' + before.form + ' filed ' + before.filed };
  return { keep: true, reason: '' };
}

// The registration filings worth keeping, oldest first.
function history(sub) {
  return rows(sub).filter((x) => HISTORY_FORMS.has(x.form) && x.accn);
}

// Where the company stands, from its filings and its listing.
//   listed       the SEC lists a ticker for it
//   priced       a final prospectus is filed, no ticker listed yet
//   withdrawn    a withdrawal after its last registration statement
//   filed        a public S-1 or F-1 on file
//   confidential only drafts, released
function status(sub, hist) {
  const tickers = (sub && Array.isArray(sub.tickers) ? sub.tickers : []).filter(Boolean);
  const lastReg = [...hist].reverse().find((x) => REG_FORM.test(x.form));
  const finals = hist.filter((x) => FINAL.test(x.form));
  const rw = [...hist].reverse().find((x) => x.form === 'RW');
  // The SEC can list a ticker before trading starts (Tracx Logis had one
  // while still amending its F-1 with a price range): with a ticker, listed
  // once a final prospectus is on file (a later resale S-1 does not undo
  // that), or, with none (a direct listing), once the SEC's effectiveness
  // notice is newer than the last registration statement.
  const effect = [...hist].reverse().find((x) => x.form === 'EFFECT');
  if (tickers.length && (finals.length || !lastReg || (effect && effect.filed >= lastReg.filed))) return 'listed';
  if (finals.length) return 'priced';
  if (rw && (!lastReg || rw.filed >= lastReg.filed)) return 'withdrawn';
  if (hist.some((x) => PUBLIC_REG.test(x.form))) return 'filed';
  return 'confidential';
}

// ---- THE COVER PAGE ----------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–' };
function plain(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m))
    .replace(/[ \s]+/g, ' ');
}
// The markets a prospectus names. The earliest named next to the symbol is
// taken; where two start at the same place the one listed first wins, so the
// longer names come first.
const MARKETS = [
  ['Nasdaq Global Select Market', 'Nasdaq'], ['Nasdaq Global Market', 'Nasdaq'], ['Nasdaq Capital Market', 'Nasdaq'],
  ['New York Stock Exchange', 'NYSE'], ['NYSE American', 'NYSE American'], ['NYSE Texas', 'NYSE Texas'], ['NYSE Arca', 'NYSE Arca'],
  ['Cboe BZX', 'Cboe'], ['OTCQX', 'OTC'], ['OTCQB', 'OTC'], ['OTC Pink', 'OTC'], ['OTC Markets', 'OTC'],
  // The bare names last: SpaceX's cover says only "Nasdaq". At the same
  // position a longer name above wins (the comparison below is strict).
  ['Nasdaq', 'Nasdaq'], ['NYSE', 'NYSE'],
];
const marketIn = (s) => {
  let best = null;
  for (const [name, short] of MARKETS) {
    const i = s.search(new RegExp(name.replace(/ /g, '\\s+'), 'i'));
    if (i >= 0 && (!best || i < best.i)) best = { i, market: name, exchange: short };
  }
  return best;
};
const num = (s) => { const n = Number(String(s || '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
// { symbol, exchange, market, low, high, price, shares }, each null when the
// cover does not say. The symbol is read only next to "under the symbol",
// and the market from the 300 characters before it, so a word elsewhere in
// the document cannot stand in.
function parseCover(html) {
  const t = plain(html);
  const out = { symbol: null, exchange: null, market: null, low: null, high: null, price: null, shares: null };
  const sym = t.match(/under the (?:ticker |trading )?symbols? [“"'‘]\s*([A-Z][A-Z0-9.\-]{0,6}?)\.?\s*[”"'’]/);
  if (sym) {
    out.symbol = sym[1];
    const m = marketIn(t.slice(Math.max(0, sym.index - 300), sym.index + 10));
    if (m) { out.market = m.market; out.exchange = m.exchange; }
  }
  // Leave the price alone where the range is still blank ("between $ and $").
  const rng = t.match(/between \$\s?(\d[\d,]*(?:\.\d+)?) and \$\s?(\d[\d,]*(?:\.\d+)?)/i);
  if (rng) { const lo = num(rng[1]), hi = num(rng[2]); if (lo && hi && hi >= lo && hi < 10000) { out.low = lo; out.high = hi; } }
  const px = t.match(/(?:initial )?public offering price (?:is|of) \$\s?(\d[\d,]*(?:\.\d+)?) per (?:share|ADS|American Depositary Share)/i)
    || t.match(/initial public offering price per (?:share|ADS|American Depositary Share)[^$.]{0,60} is \$\s?(\d[\d,]*(?:\.\d+)?)/i);
  if (px) { const p = num(px[1]); if (p && p < 10000) out.price = p; }
  const sh = t.match(/(?:we are|is|are) offering (?:an aggregate of )?(\d{1,3}(?:,\d{3}){1,4}) (?:shares|American Depositary Shares|ADSs)/i);
  if (sh) out.shares = num(sh[1]);
  return out;
}

// The filing whose cover is read: the newest final prospectus, else the
// newest public registration statement.
function coverFiling(hist) {
  const rev = [...hist].reverse();
  return rev.find((x) => FINAL.test(x.form) && x.doc) || rev.find((x) => PUBLIC_REG.test(x.form) && x.doc) || null;
}

// One company's row from its filing list, the cover read (or null when it
// was not read this time) and the row already stored (or null).
function companyRow(cik, sub, hist, cover, prev, now) {
  const p = prev || {};
  const c = cover || {};
  const cf = coverFiling(hist);
  const regs = hist.filter((x) => REG_FORM.test(x.form));
  const fin = [...hist].reverse().find((x) => FINAL.test(x.form));
  const tickers = (sub && Array.isArray(sub.tickers) ? sub.tickers : []).filter(Boolean);
  const exchanges = (sub && Array.isArray(sub.exchanges) ? sub.exchanges : []).filter(Boolean);
  const keep = (a, b) => (a != null ? a : (b != null ? b : null));
  // A price range printed on an earlier amendment stays until a newer one
  // prints another; a cover read without one does not blank it.
  return {
    cik: Number(cik), name: String((sub && sub.name) || p.name || ''), tracked: 1, reason: null,
    sic: String((sub && sub.sic) || p.sic || '') || null, industry: String((sub && sub.sicDescription) || p.industry || '') || null,
    state: String((sub && (sub.stateOfIncorporation || (sub.addresses && sub.addresses.business && sub.addresses.business.stateOrCountry))) || p.state || '') || null,
    status: status(sub, hist),
    symbol: keep(c.symbol, p.symbol), exchange: keep(c.exchange, p.exchange), market: keep(c.market, p.market),
    ticker: tickers[0] || p.ticker || null, listedOn: exchanges[0] || p.listedOn || null,
    priceLow: keep(c.low, p.priceLow), priceHigh: keep(c.high, p.priceHigh), price: keep(c.price, p.price), shares: keep(c.shares, p.shares),
    coverAccn: cover ? (cf ? cf.accn : null) : (p.coverAccn || null),
    firstFiled: regs.length ? regs[0].filed : (hist[0] ? hist[0].filed : p.firstFiled || null),
    lastFiled: hist.length ? hist[hist.length - 1].filed : p.lastFiled || null,
    priced: fin ? fin.filed : p.priced || null,
    checkedAt: now, addedAt: p.addedAt || now,
  };
}

// ---- THE QUEUE AND ONE BOUNDED STEP -----------------------------------------
// State, one app_meta row: { queue: [{ cik, name, form, filed, accn }], recheckDay, at }.
function enqueue(st, lines) {
  const s = st && Array.isArray(st.queue) ? st : Object.assign({}, st || {}, { queue: [] });
  const have = new Set(s.queue.map((q) => q.accn));
  let added = 0;
  for (const l of lines || []) {
    if (!l || !(l.cik > 0) || !l.accn || have.has(l.accn)) continue;
    s.queue.push({ cik: Number(l.cik), name: l.name || '', form: l.form || '', filed: l.filed || '', accn: l.accn });
    have.add(l.accn); added++;
  }
  return { state: s, added };
}

// Up to `n` companies off the queue, with everything handed in:
//   readState() / writeState(st)
//   readCompany(cik) -> stored row (with .tracked) or null
//   fetchSubs(cik)   -> { status, json }
//   fetchCover(url)  -> { status, text }   (the start of the document)
//   saveCompany(row, hist)   a kept company and its filings
//   skipCompany(cik, name, reason)   a company left out, remembered
// `done` means stop calling: the queue is empty, or the SEC asked us to
// slow down (the queue waits for the next run).
async function step(o) {
  const st = (await o.readState()) || { queue: [] };
  if (!Array.isArray(st.queue)) st.queue = [];
  const kept = [], skipped = [], notes = [];
  let blocked = false, done = 0;
  while (st.queue.length && done < (o.n || 4)) {
    const cik = st.queue[0].cik, name = st.queue[0].name;
    // The earliest queued S-1 or F-1 of this company is what brought it here.
    const trigger = st.queue.filter((q) => q.cik === cik && PUBLIC_REG.test(q.form) && /^\d{4}-\d{2}-\d{2}$/.test(q.filed || '')).map((q) => q.filed).sort()[0] || null;
    const drop = () => { st.queue = st.queue.filter((q) => q.cik !== cik); };
    let prev = null;
    try { prev = await o.readCompany(cik); } catch (e) { prev = null; }
    // Judged again from scratch (ipo-load.js --recheck): what is stored is ignored.
    if (o.fresh && o.fresh.has(cik)) prev = null;
    // Left out before, or listed already: nothing on its list changes that.
    if (prev && (!prev.tracked || prev.status === 'listed')) { drop(); continue; }
    // A company not seen before comes in only on an S-1 or F-1 of its own.
    // EFFECT, RW and 424B go out for every kind of registration (a public
    // company's S-3 or S-4 among them): 8,014 of the 16,868 lines since
    // 2025 were EFFECT notices. They update a company already on the list.
    if (!prev && !st.queue.some((q) => q.cik === cik && PUBLIC_REG.test(q.form))) { drop(); continue; }
    done++;
    let r;
    try { r = await o.fetchSubs(cik); } catch (e) { r = { status: 'error' }; }
    if (r && r.status === 429) { notes.push('the SEC asked us to slow down'); blocked = true; break; }
    if (!r || !(r.status >= 200 && r.status < 300) || !r.json) { notes.push(name + ': filing list not read (' + (r && r.status) + ')'); drop(); continue; }
    let sub = r.json;
    // The older filings, when the recent list starts after the earliest
    // queued filing (or the first one stored) for this company.
    // A company already kept: back to its first filing stored, so its history
    // stays whole. A new one: a year before the S-1 that brought it here, so
    // a report filed before that S-1 is seen however busy its list is.
    const since = prev ? prev.firstFiled : (trigger ? String(Number(trigger.slice(0, 4)) - 1) + trigger.slice(4) : null);
    const older = o.fetchOlder ? olderFiles(sub, since) : [];
    if (older.length) {
      const got = [];
      let stop = false;
      for (const name of older) {
        let x;
        try { x = await o.fetchOlder(name); } catch (e) { x = { status: 'error' }; }
        if (x && x.status === 429) { stop = true; break; }
        if (x && x.json) got.push(x.json);
      }
      if (stop) { notes.push('the SEC asked us to slow down'); blocked = true; break; }
      sub = mergeOlder(sub, got);
    }
    if (!prev) {
      const j = judge(sub, trigger);
      if (!j.keep) { await o.skipCompany(cik, sub.name || name, j.reason); skipped.push(sub.name || name); drop(); continue; }
    }
    const hist = history(sub);
    const cf = coverFiling(hist);
    let cover = null;
    if (cf && (!prev || prev.coverAccn !== cf.accn)) {
      let c;
      try { c = await o.fetchCover(docUrl(cik, cf.accn, cf.doc)); } catch (e) { c = { status: 'error' }; }
      if (c && c.status === 429) { notes.push('the SEC asked us to slow down'); blocked = true; break; }
      if (c && c.status >= 200 && c.status < 300) cover = parseCover(c.text);
    }
    await o.saveCompany(companyRow(cik, sub, hist, cover, prev, o.now || Date.now()), hist);
    kept.push(sub.name || name);
    drop();
  }
  st.at = o.now || Date.now();
  await o.writeState(st);
  return { kept, skipped, remaining: st.queue.length, done: blocked || !st.queue.length, blocked, notes };
}

// Priced companies with no ticker yet are looked at again once a day, so
// the first day of trading shows without waiting for another filing.
function rechecks(companies, st, today) {
  if (st && st.recheckDay === today) return [];
  return (companies || []).filter((c) => c.tracked && c.status === 'priced' && !c.ticker)
    .map((c) => ({ cik: c.cik, name: c.name, form: 'recheck', filed: today, accn: 'recheck-' + c.cik + '-' + today }));
}

module.exports = { INDEX_FORMS, HISTORY_FORMS, FORM_NAMES, parseIndex, rows, olderFiles, mergeOlder, judge, history, status, plain, parseCover, coverFiling,
  companyRow, enqueue, step, rechecks, docUrl, filingUrl, companyUrl, subsUrl, olderUrl, accnOfPath, day };
