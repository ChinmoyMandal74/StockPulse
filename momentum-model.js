// Writes an Excel model of the momentum score for one symbol.
//
//   node --use-system-ca momentum-model.js            # defaults to CRWD
//   node --use-system-ca momentum-model.js MU 320     # any symbol, any depth
//
// Every cell is a live formula over the daily bars, so the workbook is not a
// picture of the calculation — it *is* the calculation, and changing a close
// price moves the score. The last sheet compares its own answer with the one the
// app currently reports, which is the only real check that the two agree.
//
// Written by hand rather than with a spreadsheet library: an xlsx is a zip of
// XML, and a fourth dependency for a one-off explainer is not worth it. Same
// reasoning as sending mail over plain fetch.

require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@tursodatabase/serverless/compat');
// The zip writer, the sheet builder and the styles live in xlsx.js — the
// export page needs the same machinery, and two copies of a zip writer is the
// drift this project keeps paying for. What stays here is the momentum.
const XLSX = require('./xlsx.js');
const { sheetXml, S } = XLSX;

const SYMBOL = (process.argv[2] || 'CRWD').toUpperCase();   // CLI only
// The shortest series momentum can be scored from at all: a year, plus the
// month 12-1 skips, plus the bar the return is measured against.
const MIN_BARS = 274;
// 320 rows mirrors the ~300 bars a refresh fetches, with a little room. The
// deepest factor needs 253 (a year plus the month 12-1 skips), and the moving
// averages need 200 with somewhere to look back for the last cross.
const ROWS = Math.max(280, Number(process.argv[3]) || 320);

// ---- the workbook ----------------------------------------------------------
// ---- the workbook ----------------------------------------------------------
// Takes the bars and the score the app currently reports, and returns the file
// as a Buffer. Kept separate from any I/O so the same code serves the CLI below
// and GET /api/model, rather than the route growing a second copy that drifts.
//
//   bars: newest first, [{ d, high, close }]
//   live: the app's momentum score, or null — only used for the CHECK block
// Every cell is a formula over the bars. Nothing here is a stored value any
// more: the Momentum column used to be one, read from a history table that has
// since been retired, and the Signal sheet that put its delta against the next
// fortnight went with it. What remains is the live calculation of today's
// score, which is what the workbook was always for.
function buildModel(SYMBOL, bars, live) {
  const n = bars.length;

  // Excel serial dates: days since 1899-12-30.
  const serial = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569);

  // ================= Sheet 1 — Bars ==========================================
  // Newest first, matching the arrays the app works with. Row 2 is today.
  const LAST = n + 1;                       // last data row
  const RSI_SEED = LAST - 14;               // Wilder is seeded at the old end
  const b = [];
  b.push([{ v: `${SYMBOL} — daily bars and the running indicators`, s: S.title }]);
  b.push([{ v: 'Newest first. Row 2 is the most recent session, exactly as the app holds it. Grey columns are intermediates the factors need. Every cell recalculates: change a close and the score on the Score sheet moves with it.', s: S.note }]);
  b.push([]);
  const HEAD = ['Date', 'High', 'Close', 'Log return', 'MA 50', 'MA 200', 'MA50 vs 200',
    'Gain', 'Loss', 'Avg gain', 'Avg loss', 'RSI 14'];
  b.push(HEAD.map((h) => ({ v: h, s: S.head })));
  for (let i = 0; i < n; i++) {
    const R = i + 5;                        // data starts at row 5
    const nxt = R + 1;                      // the older session
    const row = [
      { v: serial(bars[i].d), s: S.date },
      { v: bars[i].close === null ? '' : bars[i].high, s: S.num2 },
      { v: bars[i].close, s: S.num2 },
    ];
    const hasOlder = i < n - 1;
    row.push(hasOlder ? { f: `LN(C${R}/C${nxt})`, s: S.num3 } : '');
    row.push(i + 50 <= n ? { f: `AVERAGE(C${R}:C${R + 49})`, s: S.num2 } : '');
    row.push(i + 200 <= n ? { f: `AVERAGE(C${R}:C${R + 199})`, s: S.num2 } : '');
    row.push(i + 200 <= n ? { f: `IF(E${R}>=F${R},1,-1)`, s: S.plain } : '');
    row.push(hasOlder ? { f: `MAX(C${R}-C${nxt},0)`, s: S.num3 } : '');
    row.push(hasOlder ? { f: `MAX(C${nxt}-C${R},0)`, s: S.num3 } : '');
    // Wilder: a simple average of the oldest 14 changes, then smoothed forward.
    if (R === RSI_SEED + 4) {
      row.push({ f: `AVERAGE(H${R}:H${R + 13})`, s: S.num3 });
      row.push({ f: `AVERAGE(I${R}:I${R + 13})`, s: S.num3 });
    } else if (R < RSI_SEED + 4) {
      row.push({ f: `(J${R + 1}*13+H${R})/14`, s: S.num3 });
      row.push({ f: `(K${R + 1}*13+I${R})/14`, s: S.num3 });
    } else { row.push('', ''); }
    row.push(R <= RSI_SEED + 4 ? { f: `IF(K${R}=0,100,100-100/(1+J${R}/K${R}))`, s: S.num2 } : '');
    b.push(row);
  }

  // ================= Sheet 2 — Factors =======================================
  // Every raw value is a formula over Bars, then the curve that turns it into a
  // 0–1 sub-score. Nothing here is a typed-in number except the constants.
  const D = 4;                              // Bars data begins on row 5
  // values[k] in the app is bar k back from today, which lives on row D+1+k.
  // Writing D+k instead is an off-by-one that silently reads the wrong session,
  // and every return here is a difference between two of these.
  const B = (k) => D + 1 + k;
  const f = [];
  const SF = (label, formula, style, note) => f.push([
    { v: label, s: S.label }, { f: formula, s: style }, { v: note || '', s: S.note },
  ]);
  f.push([{ v: `${SYMBOL} — the eight momentum factors`, s: S.title }]);
  f.push([{ v: 'Each raw value is read from the Bars sheet; each sub-score is that value put through a fixed curve. Change a close price on Bars and every number here moves.', s: S.note }]);
  f.push([]);
  f.push([{ v: 'RAW MEASUREMENTS', s: S.head }, { v: 'Value', s: S.head }, { v: 'What it is', s: S.head }]);
  SF('Close today', `Bars!C${D + 1}`, S.num2, 'The latest session on the Bars sheet.');
  SF('Realised volatility %', `STDEV.S(Bars!D${D + 1}:Bars!D${D + 126})*SQRT(252)*100`, S.num2,
    'Annualised from 126 daily log returns. The denominator that makes returns comparable across calm and wild stocks.');
  SF('12-1 return %', `(Bars!C${B(21)}-Bars!C${B(252)})/Bars!C${B(252)}*100`, S.num2,
    'A year of return ending one month ago. The recent month is skipped on purpose — over a year strength continues, over weeks it reverses.');
  SF('6M return %', `(Bars!C${B(0)}-Bars!C${B(126)})/Bars!C${B(126)}*100`, S.num2, '126 sessions.');
  SF('3M return %', `(Bars!C${B(0)}-Bars!C${B(63)})/Bars!C${B(63)}*100`, S.num2, '63 sessions.');
  SF('1M return %', `(Bars!C${B(0)}-Bars!C${B(21)})/Bars!C${B(21)}*100`, S.num2, '21 sessions. Used inverted.');
  SF('% from 52-week high', `(Bars!C${D + 1}-MAX(Bars!B${D + 1}:Bars!B${D + 252}))/MAX(Bars!B${D + 1}:Bars!B${D + 252})*100`, S.num2,
    'Against the highest intraday high of the last year, not the highest close.');
  SF('Positive months %',
    Array.from({ length: 12 }, (_, k) => `IF(Bars!C${D + 1 + k * 21}>Bars!C${D + 1 + (k + 1) * 21},1,0)`).join('+') + '/12*100',
    S.num2, 'Twelve 21-session blocks; how many finished above the block before.');
  SF('RSI 14', `Bars!L${D + 1}`, S.num2, 'Wilder smoothing, computed down the Bars sheet.');
  SF('Close vs 200-day MA %', `(Bars!C${D + 1}-Bars!F${D + 1})/Bars!F${D + 1}*100`, S.num2, 'Positive means above the average.');
  SF('Sessions since MA cross', `IFERROR(MATCH(-Bars!G${D + 1},Bars!G${D + 2}:Bars!G${n - 200 + D + 1},0),"none in range")`, S.plain,
    'How far back the 50-day last changed sides with the 200-day. Under 20 counts as a fresh cross.');

  f.push([]);
  f.push([{ v: 'RISK ADJUSTMENT', s: S.head }, { v: 'Value', s: S.head }, { v: '', s: S.head }]);
  const rowOf = {};                          // remember where each label landed
  f.forEach((row, i) => { if (row[0] && row[0].v) rowOf[row[0].v] = i + 1; });
  const V = (label) => `B${rowOf[label]}`;
  SF('12-1, risk-adjusted', `${V('12-1 return %')}/${V('Realised volatility %')}`, S.num3,
    'Return divided by its own volatility. Dimensionless — which is what lets a fixed scale mean anything.');
  SF('6M, risk-adjusted', `${V('6M return %')}/${V('Realised volatility %')}`, S.num3, '');
  SF('3M, risk-adjusted', `${V('3M return %')}/${V('Realised volatility %')}`, S.num3, '');
  f.forEach((row, i) => { if (row[0] && row[0].v) rowOf[row[0].v] = i + 1; });

  f.push([]);
  f.push([{ v: 'THE CURVE', s: S.head }, { v: '', s: S.head }, { v: '', s: S.head }]);
  f.push([{ v: 'sub = 0.5 + 0.5 × TANH((value − centre) ÷ scale)', s: S.label }, '',
           { v: 'Centres are medians measured across the archive at six dates from 2011 to 2026; scales are roughly the interquartile spread. Because tanh never quite reaches 0 or 1, two very strong stocks still separate — a clamped straight line flattened a third of the list onto the ends.', s: S.note }]);
  f.push([]);
  f.push(['Factor', 'Raw value', 'Centre', 'Scale', 'Sub-score', 'Weight', 'Weighted'].map((h) => ({ v: h, s: S.head })));

  const CURVES = [
    ['12-1 momentum', V('12-1, risk-adjusted'), 0.70, 1.30, 20, false],
    ['6M return (risk-adj.)', V('6M, risk-adjusted'), 0.55, 0.90, 18, false],
    ['3M return (risk-adj.)', V('3M, risk-adjusted'), 0.25, 0.45, 17, false],
    ['% from 52W high', V('% from 52-week high'), -12, 14, 10, false],
    ['Consistency', V('Positive months %'), 58, 15, 10, false],
    ['1M reversal', V('1M return %'), 1.0, 10, 8, true],
  ];
  const firstCurve = f.length + 1;
  for (const [name, ref, c, s, w, inv] of CURVES) {
    const R = f.length + 1;
    const body = `0.5+0.5*TANH((${ref}-C${R})/D${R})`;
    f.push([{ v: name, s: S.label }, { f: ref, s: S.num3 }, { v: c, s: S.num2 }, { v: s, s: S.num2 },
            { f: inv ? `1-(${body})` : body, s: S.num3 }, { v: w, s: S.plain },
            { f: `E${R}*F${R}`, s: S.num3 }]);
  }
  // The two that were always absolute — a category and a curve of their own.
  const trR = f.length + 1;
  f.push([{ v: 'Trend regime', s: S.label }, { f: V('Sessions since MA cross'), s: S.plain },
          { v: 'n/a', s: S.note }, { v: 'n/a', s: S.note },
          { f: `IF(${V('Close vs 200-day MA %')}>0,IF(AND(ISNUMBER(B${trR}),B${trR}<=20),1,0.75),IF(AND(ISNUMBER(B${trR}),B${trR}<=20),0,0.25))`, s: S.num3 },
          { v: 10, s: S.plain }, { f: `E${trR}*F${trR}`, s: S.num3 }]);
  const rsR = f.length + 1;
  f.push([{ v: 'RSI timing', s: S.label }, { f: V('RSI 14'), s: S.num2 },
          { v: 'n/a', s: S.note }, { v: 'n/a', s: S.note },
          { f: `IF(B${rsR}<30,0.15,IF(B${rsR}<50,0.15+(B${rsR}-30)/20*0.4,IF(B${rsR}<70,0.55+(B${rsR}-50)/20*0.45,IF(B${rsR}<=75,1,IF(B${rsR}<85,1-(B${rsR}-75)/10*0.5,0.4)))))`, s: S.num3 },
          { v: 7, s: S.plain }, { f: `E${rsR}*F${rsR}`, s: S.num3 }]);
  const lastCurve = f.length;

  f.push([]);
  const totR = f.length + 1;
  f.push([{ v: 'Total', s: S.label }, '', '', '',
          { v: '', s: S.plain }, { f: `SUM(F${firstCurve}:F${lastCurve})`, s: S.band },
          { f: `SUM(G${firstCurve}:G${lastCurve})`, s: S.band }]);

  // ================= Sheet 3 — Score =========================================
  const sc = [];
  sc.push([{ v: `${SYMBOL} — the momentum score`, s: S.title }]);
  sc.push([{ v: 'The weighted average of the eight sub-scores. Weights are renormalised over whichever factors have data, so a missing one dilutes nobody.', s: S.note }]);
  sc.push([]);
  sc.push([{ v: 'Weighted sum', s: S.label }, { f: `Factors!G${totR}`, s: S.num3 },
           { v: 'Σ (sub-score × weight)', s: S.note }]);
  sc.push([{ v: 'Total weight', s: S.label }, { f: `Factors!F${totR}`, s: S.num2 },
           { v: 'Σ weight, counting only factors with a value', s: S.note }]);
  sc.push([{ v: 'Score 0–1', s: S.label }, { f: 'B4/B5', s: S.num3 }, { v: '', s: S.note }]);
  sc.push([]);
  sc.push([{ v: 'MOMENTUM SCORE', s: S.label }, { f: 'ROUND(B6*100,1)', s: S.big },
           { v: 'What the Mom. column is built from, 0–100.', s: S.note }]);
  sc.push([{ v: 'MOMENTUM RATING', s: S.label }, { f: 'MAX(1,MIN(10,ROUND(B6*9+1,0)))', s: S.big },
           { v: 'The 1–10 shown in the table.', s: S.note }]);
  sc.push([]);
  sc.push([{ v: 'CHECK', s: S.head }, { v: '', s: S.head }, { v: '', s: S.head }]);
  sc.push([{ v: 'What the app reports', s: S.label },
           { v: live && live.momentumScore != null ? live.momentumScore : 'n/a', s: S.num2 },
           { v: `Read from the snapshot when this file was written (${new Date().toISOString().slice(0, 10)}).`, s: S.note }]);
  sc.push([{ v: 'Difference', s: S.label }, { f: 'ABS(B8-B12)', s: S.num3 },
           { v: 'Should be within rounding. A larger gap means the app has refreshed since, or a formula here has drifted.', s: S.note }]);
  sc.push([]);
  sc.push([{ v: 'HOW TO USE THIS', s: S.head }, { v: '', s: S.head }, { v: '', s: S.head }]);
  for (const line of [
    'Change any close price on the Bars sheet and watch every number move — nothing in this workbook is typed in but the constants.',
    'The centres and scales on the Factors sheet are the fixed scale. They do not depend on the other stocks, which is why a score means the same thing in any month.',
    'Weights are the same eight the app uses. Editing column F reproduces what the Weights menu does on the screener.',
    'Overall = 0.65 × momentum + 0.35 × quality. Quality is company data and is not modelled here.',
  ]) sc.push([{ v: '• ' + line, s: S.note }]);

  // ---- assemble ------------------------------------------------------------
  const sheets = [
    { name: 'Bars', xml: sheetXml(b, {
      widths: [12, 10, 10, 11, 10, 10, 12, 9, 9, 10, 10, 9],
      freeze: 4 }) },
    { name: 'Factors', xml: sheetXml(f, { widths: [26, 14, 9, 9, 11, 8, 10, 70], tab: true }) },
    { name: 'Score', xml: sheetXml(sc, { widths: [24, 14, 78] }) },
  ];

  return XLSX.workbook(sheets);
}

// ---- CLI -------------------------------------------------------------------
// Only when run directly. Requiring this file must not touch the database.
async function main() {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await db.execute({
    sql: 'select d, high, close from bars where symbol = ? order by d desc limit ?',
    args: [SYMBOL, ROWS],
  });
  if (r.rows.length < MIN_BARS) {
    console.error(`${SYMBOL}: only ${r.rows.length} bars — momentum needs at least ${MIN_BARS}.`);
    process.exit(1);
  }
  const bars = r.rows.map((x) => ({ d: x.d, high: Number(x.high), close: Number(x.close) }));
  const store = require('./db.js');
  const live = ((await store.readSnapshot()).stocks || [])
    .find((x) => x.symbol === SYMBOL);

  const out = `momentum-model-${SYMBOL}.xlsx`;
  fs.writeFileSync(out, buildModel(SYMBOL, bars, live));
  console.log(`${out}  —  ${bars.length} bars, ${bars[bars.length - 1].d} to ${bars[0].d}`);
  if (live && live.momentumScore != null) {
    console.log(`the app currently reports momentum ${live.momentumScore} for ${SYMBOL}; the Score sheet checks itself against it`);
  }
  process.exit(0);
}

module.exports = { buildModel, MODEL_ROWS: ROWS, MODEL_MIN_BARS: MIN_BARS };

if (require.main === module) main();

