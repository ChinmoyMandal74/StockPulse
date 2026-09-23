// xlsx.js — writing an Excel workbook by hand, because an xlsx is a zip of XML
// and a spreadsheet library would be a fourth dependency. Same reasoning that
// sends mail over plain fetch.
//
// It was inside the Excel model builder until 2026-09-22, when the export page needed
// the same machinery. Two copies of a zip writer is exactly the drift rowcard.js,
// action.js and rowcard.js exist to prevent — so the GENERIC half moved here and
// the model kept only the part specific to it. Proven by rebuilding the
// same workbook before and after and comparing SHA-256: byte-identical, which is
// the only check that matters for a file format nobody reads by eye.
//
//   const X = require('./xlsx.js');
//   X.workbook([{ name: 'Data', xml: X.sheetXml(rows, { widths, freeze: 1 }) }])
//
// A row is an array of cells. A cell is a string, a number, null, or
// { v, s } to carry a style id from X.S — or { f } for a formula.
const zlib = require('zlib');

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

// ---- sheet building --------------------------------------------------------
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (n) => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

// Style ids, in the order they are declared in STYLES below.
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
  const auto = opts.autoFilter ? `<autoFilter ref="${opts.autoFilter}"/>` : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    // <drawing> must follow sheetData: the schema fixes the order of these
    // children, and Excel repairs — silently dropping the chart — if it does not.
    // autoFilter sits between them, for the same reason.
    freeze + cols + `<sheetData>${body}</sheetData>` + auto +
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

// ---- the package -----------------------------------------------------------
// `sheets` is [{ name, xml }]. Excel stores no cached values, so it is told to
// recalculate on open — the model's formulas depend on it, and a plain data
// export is unharmed by it.
function workbook(sheets) {
  const files = [
    { name: '[Content_Types].xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
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
  ];
  return zip(files);
}

// A sheet name Excel will accept: it refuses : \ / ? * [ ] and anything over 31
// characters, and REPAIRS the file rather than reporting the problem — so a
// portfolio called "Chips / AI" would produce a workbook that opens with a
// warning and no data.
const sheetName = (s) => (String(s || 'Sheet').replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Sheet');

module.exports = { zip, sheetXml, workbook, sheetName, S, STYLES, colName: col };
