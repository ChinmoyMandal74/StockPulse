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
const zlib = require('zlib');
const { createClient } = require('@tursodatabase/serverless/compat');

const SYMBOL = (process.argv[2] || 'CRWD').toUpperCase();   // CLI only
// The shortest series momentum can be scored from at all: a year, plus the
// month 12-1 skips, plus the bar the return is measured against.
const MIN_BARS = 274;
// 320 rows mirrors the ~300 bars a refresh fetches, with a little room. The
// deepest factor needs 253 (a year plus the month 12-1 skips), and the moving
// averages need 200 with somewhere to look back for the last cross.
const ROWS = Math.max(280, Number(process.argv[3]) || 320);

// Every horizon the screener's Past picker offers, taken from the module that
// defines that picker rather than restated here — a workbook that disagreed
// with the dropdown it is named after would be worse than one that omits it.
const { PAST_PERIODS, DEFAULT_PAST } = require('./private/screens.js');
const HORIZONS = PAST_PERIODS.map((p) => ({ id: p.id, lag: p.days, label: p.id.toUpperCase() }));

// The fortnight still has a special place: it is what the screener ships as
// momentumScorePrev and momentumChange, what momentum_deltas lags by, and so
// what the two return columns are measured over.
const PAST_LAG = (PAST_PERIODS.find((p) => p.id === DEFAULT_PAST) || { days: 10 }).days;
const PAST_LABEL = DEFAULT_PAST.toUpperCase();

// ---- a minimal zip writer --------------------------------------------------
// Local file header + central directory, deflated. No dependency, ~50 lines.
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const raw = Buffer.from(data, 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = CRC(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0, 6);               // flags
    local.writeUInt16LE(8, 8);               // deflate
    local.writeUInt32LE(0, 10);              // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

// ---- the scatter chart -----------------------------------------------------
// A chart is four more parts in the zip — the chart itself, a drawing that
// anchors it to a sheet, and a relationship apiece — plus two content-type
// overrides. Written out by hand for the same reason the rest is: a chart is
// XML, and reaching for a library to emit 60 lines of it would buy a dependency
// and lose the ability to say exactly what is in the file.
//
// The series points at the Bars sheet rather than copying the numbers, so the
// scatter is a view of the same formulas everything else uses. Edit a close
// price and the cloud moves with the score.
const AX_X = 745110001, AX_Y = 745110002;   // any two stable ids

function chartXml(title, xRef, yRef, xName, yName) {
  const t = (txt, size) =>
    `<c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="${size}" b="0"/></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="${size}"/><a:t>${esc(txt)}</a:t></a:r></a:p></c:rich>`;
  const axTitle = (txt) => `<c:title><c:tx>${t(txt, 900)}</c:tx><c:overlay val="0"/></c:title>`;
  const valAx = (id, cross, pos, name) =>
    `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${pos}"/>` +
    `<c:majorGridlines/>${axTitle(name)}<c:numFmt formatCode="General" sourceLinked="0"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    // Cross at zero, so the four quadrants of the scatter read as quadrants.
    `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<c:chart><c:title><c:tx>${t(title, 1200)}</c:tx><c:overlay val="0"/></c:title>` +
    '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
    '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' +
    '<c:ser><c:idx val="0"/><c:order val="0"/>' +
    `<c:tx><c:v>${esc(yName)}</c:v></c:tx>` +
    // No connecting line: joining 300 points in date order would draw a scribble
    // over the very shape the chart exists to show.
    '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>' +
    '<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr>' +
    '<a:solidFill><a:srgbClr val="4472C4"><a:alpha val="55000"/></a:srgbClr></a:solidFill>' +
    '<a:ln><a:noFill/></a:ln></c:spPr></c:marker>' +
    // Excel draws the fit and prints r2 on it, so the number on the Signal sheet
    // and the line through the cloud cannot disagree.
    '<c:trendline><c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="808080"/></a:solidFill>' +
    '<a:prstDash val="dash"/></a:ln></c:spPr><c:trendlineType val="linear"/>' +
    '<c:dispRSqr val="1"/><c:dispEq val="0"/></c:trendline>' +
    `<c:xVal><c:numRef><c:f>${esc(xRef)}</c:f></c:numRef></c:xVal>` +
    `<c:yVal><c:numRef><c:f>${esc(yRef)}</c:f></c:numRef></c:yVal>` +
    '<c:smooth val="0"/></c:ser>' +
    `<c:axId val="${AX_X}"/><c:axId val="${AX_Y}"/></c:scatterChart>` +
    valAx(AX_X, AX_Y, 'b', xName) + valAx(AX_Y, AX_X, 'l', yName) +
    '</c:plotArea><c:plotVisOnly val="1"/>' +
    // A blank must leave a hole, never be read as zero — the oldest ten rows
    // have no fortnight behind them and the newest ten have no fortnight ahead.
    '<c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
}

// Anchored across a block of cells so it resizes with the window rather than
// sitting at a fixed pixel size.
const DRAWING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<xdr:twoCellAnchor>' +
  '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>13</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
  '<xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>44</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
  '<xdr:graphicFrame macro="">' +
  '<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Signal scatter"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
  '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
  '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>' +
  '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';

// ---- sheet building --------------------------------------------------------
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (n) => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

// Style ids, in the order they are declared in styles.xml below.
const S = { plain: 0, title: 1, head: 2, label: 3, num2: 4, num3: 5, date: 6, note: 7, band: 8, big: 9, formula: 10 };

const cell = (ref, v, style) => {
  const st = style ? ` s="${style}"` : '';
  if (v == null || v === '') return `<c r="${ref}"${st}/>`;
  if (typeof v === 'object' && v.f) return `<c r="${ref}"${st}><f>${esc(v.f)}</f></c>`;
  if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
};

function sheetXml(rows, opts = {}) {
  const body = rows.map((cells, i) => {
    const r = i + 1;
    const inner = cells.map((c, j) => (c === undefined ? '' : cell(col(j) + r, c && c.v !== undefined ? c.v : c, c && c.s)))
      .filter(Boolean).join('');
    return inner ? `<row r="${r}">${inner}</row>` : '';
  }).filter(Boolean).join('');
  const cols = opts.widths
    ? `<cols>${opts.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const freeze = opts.freeze
    ? `<sheetViews><sheetView workbookViewId="0"${opts.tab ? ' tabSelected="1"' : ''}>` +
      `<pane ySplit="${opts.freeze}" topLeftCell="A${opts.freeze + 1}" activePane="bottomLeft" state="frozen"/>` +
      '</sheetView></sheetViews>'
    : `<sheetViews><sheetView workbookViewId="0"${opts.tab ? ' tabSelected="1"' : ''}/></sheetViews>`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    // <drawing> must follow sheetData: the schema fixes the order of these
    // children, and Excel repairs — silently dropping the chart — if it does not.
    freeze + cols + `<sheetData>${body}</sheetData>` +
    (opts.drawing ? `<drawing r:id="${opts.drawing}"/>` : '') + '</worksheet>';
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
  <numFmt numFmtId="164" formatCode="0.00"/>
  <numFmt numFmtId="165" formatCode="0.000"/>
  <numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd"/>
</numFmts>
<fonts count="6">
  <font><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="15"/><color rgb="FF12151C"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><color rgb="FF12151C"/><name val="Calibri"/></font>
  <font><i/><sz val="10"/><color rgb="FF6B7382"/><name val="Calibri"/></font>
  <font><b/><sz val="13"/><color rgb="FF0F9D58"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF12151C"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F7"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left/><right/><top/><bottom style="thin"><color rgb="FFD5D9E0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
  <xf numFmtId="165" fontId="5" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
  <xf numFmtId="165" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
</cellXfs>
</styleSheet>`;

// ---- the workbook ----------------------------------------------------------
// ---- the workbook ----------------------------------------------------------
// Takes the bars and the score the app currently reports, and returns the file
// as a Buffer. Kept separate from any I/O so the same code serves the CLI below
// and GET /api/model, rather than the route growing a second copy that drifts.
//
//   bars: newest first, [{ d, high, close }]
//   live: the app's momentum score, or null — only used for the CHECK block
// `momentum` is a date -> score map read from momentum_history. It is the one
// column on the Bars sheet that is a stored value rather than a formula: the
// score at an earlier date needs a year of run-up before it, and reproducing
// that down 320 rows would mean 320 copies of the whole Factors sheet. The
// current score stays live on Score, which is the one anybody checks.
function buildModel(SYMBOL, bars, live, momentum) {
  const n = bars.length;

  // Excel serial dates: days since 1899-12-30.
  const serial = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569);

  // ================= Sheet 1 — Bars ==========================================
  // Newest first, matching the arrays the app works with. Row 2 is today.
  const LAST = n + 1;                       // last data row
  const RSI_SEED = LAST - 14;               // Wilder is seeded at the old end
  const b = [];
  b.push([{ v: `${SYMBOL} — daily bars and the running indicators`, s: S.title }]);
  b.push([{ v: `Newest first. Row 2 is the most recent session, exactly as the app holds it. Grey columns are intermediates the factors need. Momentum is the stored score for that date — a value, not a formula, and the only cell here that does not recalculate. Past Mom. and Mom. Delta read it ${HORIZONS.map((h) => h.lag).join(', ')} rows down — the five horizons the screener's Past picker offers. Return ${PAST_LABEL} covers that same fortnight; Next ${PAST_LABEL} Return covers the one after it, and is the column to put the delta against when asking whether it predicts anything.`, s: S.note }]);
  b.push([]);
  // Paired by horizon — Past 1W, Delta 1W, Past 2W, Delta 2W … — because that
  // is the pairing the dropdown expresses: pick a period, read what momentum was
  // and how far it has moved. All five Pasts followed by all five Deltas would
  // read better across horizons and worse for the question actually being asked.
  const HEAD = [...['Date', 'High', 'Close', 'Log return', 'MA 50', 'MA 200', 'MA50 vs 200', 'Gain', 'Loss', 'Avg gain', 'Avg loss', 'RSI 14', 'Momentum'],
    ...HORIZONS.flatMap((h) => [`Past Mom. (${h.label})`, `Mom. Delta (${h.label})`]),
    `Return ${PAST_LABEL} %`, `Next ${PAST_LABEL} Return %`];
  // Looked up rather than counted: adding a horizon shifts every column after
  // it, and a chart pointed at a hardcoded letter would quietly plot the wrong
  // series instead of failing.
  const colOf = (label) => {
    const i = HEAD.indexOf(label);
    if (i < 0) throw new Error(`no such Bars column: ${label}`);
    return col(i);
  };
  const MOM_COL = colOf('Momentum');
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
    // A date with no stored row is left blank rather than carried forward, so a
    // gap in the history reads as a gap.
    const mv = momentum ? momentum.get(bars[i].d) : undefined;
    row.push(mv == null ? '' : { v: mv, s: S.num2 });

    // Past momentum and the deltas are formulas over the Momentum column, not
    // more stored values. The sheet is newest-first, so the score N sessions ago
    // is simply N rows further down — the same offset momentum_deltas lags by,
    // and the reason the workbook agrees with the screener's Past Mom. and Mom.
    // Delta rather than approximating them. Each tests for a blank rather than
    // trusting the reference: an empty cell reads as 0 in Excel, so a gap in the
    // stored history would otherwise print a score of zero and a delta the full
    // size of today's score.
    for (const h of HORIZONS) {
      const P = R + h.lag;
      const ok = i + h.lag < n;
      row.push(ok ? { f: `IF(${MOM_COL}${P}="","",${MOM_COL}${P})`, s: S.num2 } : '');
      row.push(ok ? { f: `IF(OR(${MOM_COL}${R}="",${MOM_COL}${P}=""),"",${MOM_COL}${R}-${MOM_COL}${P})`, s: S.num2 } : '');
    }
    const P = R + PAST_LAG;
    const hasPast = i + PAST_LAG < n;

    // The price beside the score, so the delta can be read against what the
    // stock actually did. Two columns because they answer different questions
    // and are easy to conflate: the first covers the SAME fortnight as the
    // delta, which is why they track each other (measured across the archive:
    // correlation 0.554, most of it by construction — the score is built out of
    // returns). The second is the NEXT fortnight, which nothing in the score has
    // seen, and is the only one of the two a backtest can honestly use.
    //
    // The sheet is newest-first, so the past is DOWN the rows and the future is
    // UP them. Getting that backwards would silently invert the whole question.
    const F = R - PAST_LAG;
    row.push(hasPast ? { f: `(C${R}-C${P})/C${P}*100`, s: S.num2 } : '');
    row.push(F >= 5 ? { f: `(C${F}-C${R})/C${R}*100`, s: S.num2 } : '');   // row 5 is the newest bar
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
    'Change any close price on the Bars sheet and watch every number move — nothing here is typed in but the constants and the stored Momentum column on Bars, which is history rather than calculation.',
    'The centres and scales on the Factors sheet are the fixed scale. They do not depend on the other stocks, which is why a score means the same thing in any month.',
    'Weights are the same eight the app uses. Editing column F reproduces what the Weights menu does on the screener.',
    'Overall = 0.65 × momentum + 0.35 × quality. Quality is company data and is not modelled here.',
  ]) sc.push([{ v: '• ' + line, s: S.note }]);

  // ---- assemble ------------------------------------------------------------
  // ================= Sheet 4 — Signal ========================================
  // The relationship the /signal page draws, in the workbook: does a fortnight's
  // move in the momentum score say anything about the fortnight that follows?
  //
  // Every number here is a formula over the Bars sheet, including the
  // correlation — so this is not a screenshot of the finding, it is the finding,
  // and editing a close price moves it.
  const R1 = 5, R2 = n + 4;                            // the Bars data rows
  const DX = colOf(`Mom. Delta (${PAST_LABEL})`);
  const DY = colOf(`Next ${PAST_LABEL} Return %`);
  const RX = `Bars!$${DX}$${R1}:$${DX}$${R2}`;
  const RY = `Bars!$${DY}$${R1}:$${DY}$${R2}`;
  // A blank from IF(...,"") is text, not a number, and text is greater than any
  // number in an Excel comparison — so every count has to be gated on ISNUMBER
  // or the empty rows at each end quietly join the "positive" side.
  const BOTH = `(ISNUMBER(${RX}))*(ISNUMBER(${RY}))`;

  const sg = [];
  sg.push([{ v: `${SYMBOL} — momentum delta against what happened next`, s: S.title }]);
  sg.push([{ v: `Each point is one session: the ${PAST_LABEL} change in the momentum score, ` +
    `against the return over the ${PAST_LABEL} that followed. Both columns live on the Bars sheet, ` +
    'so this chart and every figure below it recalculate when a price does.', s: S.note }]);
  sg.push([]);
  const F = (label, formula, style, note) =>
    sg.push([{ v: label, s: S.label }, { f: formula, s: style }, { v: note || '', s: S.note }]);
  F('Observations', `SUMPRODUCT(${BOTH})`, S.plain,
    'Sessions with both a delta behind them and a return ahead of them.');
  F('Independent ones', `ROUNDDOWN(SUMPRODUCT(${BOTH})/${PAST_LAG},0)`, S.plain,
    `Consecutive returns share ${PAST_LAG - 1} of their ${PAST_LAG} days, so the honest count is roughly one per window.`);
  F('Correlation', `CORREL(${RX},${RY})`, S.num3,
    'Between -1 and 1. Near zero means the delta told you nothing about the next fortnight.');
  F('R squared', `RSQ(${RY},${RX})`, S.num3, 'The share of the next fortnight the delta explains.');
  F('Slope', `SLOPE(${RY},${RX})`, S.num3, '% of return per point of momentum move.');
  F('Mean next return %', `AVERAGE(${RY})`, S.num2, 'What the stock did over an average fortnight.');
  F('Base rate', `SUMPRODUCT(${BOTH}*(${RY}>=0))/SUMPRODUCT(${BOTH})`, S.num3,
    'How often the next fortnight was positive at all.');
  F('Hit rate', `SUMPRODUCT(${BOTH}*(${RX}>=0)*(${RY}>=0))/SUMPRODUCT(${BOTH}*(${RX}>=0))`, S.num3,
    'How often it was positive after the momentum score rose.');
  F('Lift', `SUMPRODUCT(${BOTH}*(${RX}>=0)*(${RY}>=0))/SUMPRODUCT(${BOTH}*(${RX}>=0))` +
    `-SUMPRODUCT(${BOTH}*(${RY}>=0))/SUMPRODUCT(${BOTH})`, S.num3,
    'Hit rate minus base rate. This is the only one of the three worth reading — a stock that rises most fortnights hands a high hit rate to a signal that knows nothing.');
  sg.push([]);
  sg.push([{ v: 'A round cloud is the honest outcome, and the usual one. Across the whole ' +
    'screener this relationship measures about -0.003, so expect the trendline to lie flat and ' +
    'R squared to sit near zero. Read the lift rather than the hit rate, and remember the ' +
    'independent count above rather than the raw one.', s: S.note }]);

  const sheets = [
    { name: 'Bars', xml: sheetXml(b, {
      widths: [12, 10, 10, 11, 10, 10, 12, 9, 9, 10, 10, 9, 11,
        ...HORIZONS.flatMap(() => [14, 15]), 13, 17],
      freeze: 4 }) },
    { name: 'Factors', xml: sheetXml(f, { widths: [26, 14, 9, 9, 11, 8, 10, 70], tab: true }) },
    { name: 'Score', xml: sheetXml(sc, { widths: [24, 14, 78] }) },
    { name: 'Signal', xml: sheetXml(sg, { widths: [22, 14, 78], drawing: 'rId1' }) },
  ];
  const SIGNAL_SHEET = sheets.length;                  // 1-based, for the parts below

  const files = [
    { name: '[Content_Types].xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
      '</Types>' },
    { name: '_rels/.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' },
    { name: 'xl/workbook.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      // Excel stores no cached values here, so it must recalculate on open.
      '</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>' },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
    // The Signal sheet -> its drawing -> the chart. Two more relationship parts,
    // each naming the next thing down the chain.
    { name: `xl/worksheets/_rels/sheet${SIGNAL_SHEET}.xml.rels`, data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
      '</Relationships>' },
    { name: 'xl/drawings/drawing1.xml', data: DRAWING_XML },
    { name: 'xl/drawings/_rels/drawing1.xml.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>' +
      '</Relationships>' },
    { name: 'xl/charts/chart1.xml', data: chartXml(
      `${SYMBOL} — momentum delta (${PAST_LABEL}) against the next ${PAST_LABEL}`,
      RX, RY, `Momentum delta (${PAST_LABEL}), points`, `Next ${PAST_LABEL} return, %`) },
  ];


  return zip(files);
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
  const momentum = await momentumMap(store, SYMBOL, bars);

  const out = `momentum-model-${SYMBOL}.xlsx`;
  fs.writeFileSync(out, buildModel(SYMBOL, bars, live, momentum));
  console.log(`${out}  —  ${bars.length} bars, ${bars[bars.length - 1].d} to ${bars[0].d}`);
  if (live && live.momentumScore != null) {
    console.log(`the app currently reports momentum ${live.momentumScore} for ${SYMBOL}; the Score sheet checks itself against it`);
  }
  process.exit(0);
}

// The stored momentum for exactly the dates on the Bars sheet. Shared by the
// CLI and /api/model: the two are verified byte-identical, which only holds if
// they assemble their inputs the same way.
async function momentumMap(store, symbol, bars) {
  const oldest = bars.length ? bars[bars.length - 1].d : null;
  if (!oldest) return new Map();
  const rows = await store.readMomentum(symbol, oldest);
  return new Map(rows.map((r) => [r.d, r.score]));
}

module.exports = { buildModel, momentumMap, MODEL_ROWS: ROWS, MODEL_MIN_BARS: MIN_BARS };

if (require.main === module) main();

