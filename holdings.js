// Fund holdings from the issuer's own daily file — reading the workbook and
// shaping its rows, no network and no database. The news.js / secfacts.js /
// insider.js / shortint.js shape: orchestration lives in server.js, so every
// rule below is testable with no server.
//
// WHY THE ISSUER'S FILE AND NOT A LIST SOMEBODY MAINTAINS. Measured
// 2026-10-02, when this was chosen:
//
//   - Twelve Data has no index field on `/stocks`, no constituents endpoint
//     (`/index`, `/indices/composition`, `/index_constituents` all 404), and
//     `/etfs/world/composition` is 403 on Pro — the same wall as
//     `/market_cap`, the forward estimates and the analyst data.
//   - the datahub CSV (a bot's mirror of the Wikipedia table) was eleven days
//     stale and MISSING A REAL NAME: VYLR, Vylor Inc., NYSE common stock,
//     0.070% of the index, in SSGA's file and not in the mirror. Every other
//     one of its 503 agreed, so the staleness is small and NOT zero.
//   - iShares' IVV holdings endpoint answers `200` with `content-type:
//     text/csv` and 2.26MB of HTML in the body. A status check passes it.
//     That is why `parse` validates what it actually read, below.
//
// AND IT WRITES OUR OWN SPELLING: `BRK.B`, `BF.B`. No translation table,
// unlike SEC (hyphens) and FINRA (separators stripped entirely).
//
// WHAT IT DOES NOT GIVE US. The Sector column is `-` on every row — SSGA
// publishes it empty for SPY — so this does NOT close the GICS gap that
// CLAUDE.md records at length. Checked rather than assumed; it was about to
// be reported as a bonus.
(function (root) {
  'use strict';

  const zlib = typeof require === 'function' ? require('zlib') : null;

  // Every fund SSGA publishes at the same URL shape, with the floor below
  // which a file is refused rather than applied. Only SPY is wired today;
  // the table is keyed on (fund, symbol) so a second needs no migration.
  //
  // Measured 2026-10-02: SPY, DIA, MDY, XLK, XLF and XLV all answer 200 with
  // a real xlsx at this shape — the eleven sector SPDRs being the ones we
  // already hold as the Sector Benchmark theme.
  const FUNDS = {
    // `min` IS THE TRUNCATION GUARD AND IT IS NOT DECORATION. The file is a
    // full snapshot, so "absent from today's file" means removed — and a
    // partial download, or an error page served with a 200, would therefore
    // read as every holding being removed at once. S&P targets 500 names and
    // the count has sat between 500 and 505 for decades, so 450 is generous
    // and unambiguous: no real file lands between.
    spy: { index: 'SP500', label: 'S&P 500', min: 450, source: 'ssga' },
    // The Nasdaq 100, from Invesco, QQQ's own issuer. It has sat at 100 to 103
    // names (a few companies have two share classes in it), so 90 is the floor
    // and 130 a ceiling: a file far over it is some other fund's.
    qqq: { index: 'NDX100', label: 'Nasdaq 100', min: 90, max: 130, source: 'invesco' },
  };

  // Reject the empty before coercing. `Number('')` and `Number(null)` are
  // both 0 and finite, and a fabricated 0% weight would read as "held, at no
  // weight" rather than "not reported" — the seventh place this project has
  // needed the sentence.
  function num(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "As of 01-Oct-2026" -> "2026-10-01".
  //
  // PARSED COMPONENT BY COMPONENT, never through `new Date()`. That one reads
  // a bare date as UTC midnight and renders as the previous day west of
  // Greenwich — the card-dating lesson, met in `funddate` and again in the
  // earnings caption. There is no Date object anywhere in this function, so
  // the trap cannot apply.
  function asOfDate(s) {
    const m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(s || ''));
    if (!m) return null;
    const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    if (mon < 0) return null;
    const day = Number(m[1]);
    if (!(day >= 1 && day <= 31)) return null;
    return m[3] + '-' + String(mon + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  // A holding's ticker, or null. The file carries two rows that are not
  // equities — measured on SPY: a cash line whose ticker is `-` at 0.269% and
  // `2602335D` at 0.000003% — so a ticker has to look like one. Dots are kept
  // because that is exactly the spelling we store (BRK.B); a digit anywhere
  // is refused, which is what rejects the second of those two.
  function ticker(v) {
    const s = String(v == null ? '' : v).trim().toUpperCase();
    return /^[A-Z]{1,6}(\.[A-Z]{1,2})?$/.test(s) ? s : null;
  }

  // --- the workbook ---------------------------------------------------
  //
  // An xlsx is a ZIP of DEFLATE entries and node ships zlib, so this needs no
  // dependency — which is the whole reason the import can be a cron phase in
  // the function rather than a local Windows-only loader like
  // `insider-load.js`, which shells out to PowerShell's Expand-Archive.
  //
  // THE CENTRAL DIRECTORY, never the local headers, and on this file that is
  // the difference between working and not working at all. Measured on SSGA's
  // own workbook 2026-10-02: every local header sets the data-descriptor flag
  // (0x08) and writes a compressed size of ZERO, with the real size in a
  // trailer after the data. A reader that walks the file from the front
  // therefore stops at the first entry and finds NOTHING — so this is not
  // defensive style, it is the only shape that reads the file.
  function unzip(buf, wanted) {
    if (!buf || buf.length < 22) throw new Error('empty file');
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip (no local file header)');

    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i -= 1) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip (no end-of-central-directory)');

    const count = buf.readUInt16LE(eocd + 10);
    const want = wanted ? new Set(wanted) : null;
    const out = {};
    let p = buf.readUInt32LE(eocd + 16);
    for (let n = 0; n < count; n += 1) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
        throw new Error('bad central directory entry ' + n);
      }
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const cmtLen = buf.readUInt16LE(p + 32);
      const rel = buf.readUInt32LE(p + 42);
      const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
      // Only inflate what the caller asked for: two of the fourteen entries
      // here, and the printer settings and theme are of no interest.
      if (!want || want.has(name)) {
        const lnameLen = buf.readUInt16LE(rel + 26);
        const lextraLen = buf.readUInt16LE(rel + 28);
        const start = rel + 30 + lnameLen + lextraLen;
        const data = buf.slice(start, start + csize);
        out[name] = method === 0 ? data : zlib.inflateRawSync(data);
      }
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  const unent = (s) => String(s).replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

  // The shared string table, in order — a cell with t="s" holds an index into
  // it. Each <si> may hold several <t> runs (rich text), which have to be
  // joined or a styled cell comes back truncated at its first run.
  function sharedStrings(xml) {
    return [...String(xml).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      unent([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }

  // Rows as { A: value, B: value, ... }. Column letters rather than position,
  // because a row may skip an empty cell entirely and counting siblings would
  // then slide every later value one column left — the header-over-cell
  // hazard the screener's own suites exist to catch.
  function sheetRows(xml, strings) {
    const rows = [];
    for (const r of String(xml).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = c[2];
        const inline = /t="inlineStr"/.test(attrs);
        const m = inline
          ? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3])
          : /<v>([\s\S]*?)<\/v>/.exec(c[3]);
        if (!m) continue;
        cells[c[1]] = /t="s"/.test(attrs) ? (strings[Number(m[1])] ?? null) : unent(m[1]);
      }
      if (Object.keys(cells).length) rows.push(cells);
    }
    return rows;
  }

  // --- Invesco's holdings feed (QQQ, the Nasdaq 100) --------------------
  //
  // (2026-10-08, owner: "work on the bigger task of finding the holdings of
  // nasdaq100".) Measured before it was chosen:
  //
  //   - Invesco's own feed for QQQ answers an honest User-Agent with JSON:
  //     an effective date, 105 rows, weights summing to 100.000.
  //   - 100 of the 105 are equities (97 common stock, 3 depositary receipts).
  //     The other five are a cash line whose TICKER IS `USD`, a pending-
  //     dividend line `USDPDV`, an index future `NQZ6`, and two cash rows with
  //     no ticker. `USD` and `USDPDV` pass any ticker-shape test, so the row's
  //     own security type is what keeps them out -- an ALLOWLIST of equity
  //     types, so a type this has never seen is dropped and counted rather
  //     than let in.
  //   - Those 100 are EXACTLY the 100 symbols Nasdaq's own list endpoint
  //     publishes for the index, with not one extra either way.
  //   - The older CSV download link answers 200 with 425KB of HTML, which is
  //     the iShares shape again and why the body is validated, not the status.
  //   - No dotted tickers and no translation needed.
  //
  // The same contract as the workbook path: it THROWS on anything it cannot
  // vouch for, and the caller's only response to a throw is to write nothing.
  const EQUITY_TYPE = /common stock|ordinary share|depositor?y receipt|depositor?y share|\breit\b|tracking stock|limited partnership/i;
  function parseInvesco(buf, fund, cfg) {
    let j;
    try { j = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)); }
    catch { throw new Error('not JSON -- the holdings feed answered with something else (a page of markup, usually)'); }
    if (!j || !Array.isArray(j.holdings)) throw new Error('no holdings array in the feed');
    const d = String(j.effectiveBusinessDate || j.effectiveDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('no effective date in the feed');
    const held = [];
    const seen = new Set();
    let dropped = 0;
    let weightSum = 0;
    for (const h of j.holdings) {
      const w = num(h && h.percentageOfTotalNetAssets);
      if (w != null) weightSum += w;
      const sym = ticker(h && h.ticker);
      const type = String((h && h.securityTypeName) || '');
      if (!sym || !EQUITY_TYPE.test(type) || seen.has(sym)) { dropped += 1; continue; }
      seen.add(sym);
      held.push({
        symbol: sym,
        name: h.issuerName ? String(h.issuerName).trim() : null,
        weight: w,
        shares: num(h.units),
        cusip: h.cusip ? String(h.cusip).trim() : null,
        sedol: null,
      });
    }
    if (held.length < cfg.min) {
      throw new Error(`only ${held.length} holdings parsed, floor is ${cfg.min} `
        + `— refusing the file rather than reading it as ${cfg.min - held.length}+ removals`);
    }
    // The index holds about 100 names. Far more than that is a different
    // fund's file, or a layout that has started listing something else.
    if (cfg.max && held.length > cfg.max) {
      throw new Error(`${held.length} holdings parsed, ceiling is ${cfg.max} — not this fund's file`);
    }
    return {
      fund, index: cfg.index, label: cfg.label, asOf: d, holdings: held, dropped,
      weightSum: Math.round(weightSum * 1000) / 1000,
    };
  }

  // --- the one entry point --------------------------------------------
  //
  // Throws on anything it cannot vouch for, because the caller's only safe
  // response to a file it cannot read is to write NOTHING: the alternative is
  // a snapshot that looks like 504 removals. Every message says what was
  // actually wrong, since "holdings failed" is not something anyone can act
  // on at seven in the morning.
  function parse(buf, fund) {
    const cfg = FUNDS[String(fund || 'spy').toLowerCase()];
    if (!cfg) throw new Error('unknown fund: ' + fund);
    if (cfg.source === 'invesco') return parseInvesco(buf, String(fund).toLowerCase(), cfg);

    const files = unzip(buf, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
    const sheetXml = files['xl/worksheets/sheet1.xml'];
    if (!sheetXml) throw new Error('workbook has no xl/worksheets/sheet1.xml');
    const strings = sharedStrings(files['xl/sharedStrings.xml'] || '');
    const rows = sheetRows(sheetXml.toString('utf8'), strings);

    // The header row is FOUND, never assumed to be row 4. SSGA puts a fund
    // name, a ticker and a holdings count above it, and the day that preamble
    // gains a line a fixed index reads a label row as a holding.
    const hi = rows.findIndex((r) => Object.values(r).includes('Ticker'));
    if (hi < 0) throw new Error('no Ticker column — not a holdings workbook');
    const head = rows[hi];
    const col = (label) => Object.keys(head).find((k) => head[k] === label) || null;
    const kTick = col('Ticker');
    const kName = col('Name');
    const kWeight = col('Weight');
    const kShares = col('Shares Held');
    const kCusip = col('Identifier');
    const kSedol = col('SEDOL');

    // The as-of date sits in the preamble, above the header.
    let asOf = null;
    for (const r of rows.slice(0, hi + 1)) {
      for (const v of Object.values(r)) {
        const d = asOfDate(v);
        if (d) { asOf = d; break; }
      }
      if (asOf) break;
    }
    if (!asOf) throw new Error('no "As of <date>" in the preamble');

    const held = [];
    let dropped = 0;
    let weightSum = 0;
    for (const r of rows.slice(hi + 1)) {
      const sym = ticker(r[kTick]);
      const w = num(r[kWeight]);
      if (w != null) weightSum += w;
      if (!sym) { if (Object.keys(r).length > 2) dropped += 1; continue; }
      held.push({
        symbol: sym,
        name: r[kName] ? String(r[kName]).trim() : null,
        weight: w,
        shares: num(r[kShares]),
        cusip: kCusip && r[kCusip] ? String(r[kCusip]).trim() : null,
        sedol: kSedol && r[kSedol] ? String(r[kSedol]).trim() : null,
      });
    }

    // THE FLOOR, and this is the guard that matters most. A file that arrived
    // short — a partial download, an error page, a changed layout — would
    // otherwise be applied as a day on which the index lost hundreds of
    // members, and a running membership flag has no way back from that.
    if (held.length < cfg.min) {
      throw new Error(`only ${held.length} holdings parsed, floor is ${cfg.min} `
        + `— refusing the file rather than reading it as ${cfg.min - held.length}+ removals`);
    }

    // Reported, not refused. Measured at 100.23 on SPY, because the cash line
    // and rounding both land in it; a figure nowhere near 100 means the
    // Weight column has moved and is worth seeing in the log, but it is not
    // grounds to throw away a file whose tickers all parsed.
    return {
      fund: String(fund || 'spy').toLowerCase(),
      index: cfg.index,
      label: cfg.label,
      asOf,
      holdings: held,
      dropped,
      weightSum: Math.round(weightSum * 1000) / 1000,
    };
  }

  const api = { FUNDS, parse, parseInvesco, unzip, sharedStrings, sheetRows, asOfDate, ticker, num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Holdings = api;
})(typeof window !== 'undefined' ? window : globalThis);
