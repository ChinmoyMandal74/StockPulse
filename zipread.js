// Read entries out of a ZIP file held in memory. Node has zlib but no reader
// for the ZIP container, and the SEC publishes its bulk data sets (13F
// holdings, fails to deliver) only as ZIPs. A dependency for forty lines of
// well-specified format is not worth it, so this is the forty lines.
//
// WHAT IT HANDLES: the central directory, stored (method 0) and deflated
// (method 8) entries, and ZIP64 sizes -- the 13F holdings table is several
// hundred megabytes unpacked and its entry may carry them. Nothing else: no
// encryption, no multi-disk archives, no other compression methods. An entry
// it cannot read throws, naming the method, rather than returning bytes that
// are not the file.
'use strict';
const zlib = require('zlib');

// [{ name, method, csize, usize, offset }] from the central directory.
function entries(buf) {
  // The end-of-central-directory record is within the last 64KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file: no end-of-central-directory record');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  // ZIP64: the real values live in a second record, found through a locator
  // that sits immediately before the ordinary one.
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const z = Number(buf.readBigUInt64LE(loc + 8));
      if (buf.readUInt32LE(z) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(z + 32));
        cdOffset = Number(buf.readBigUInt64LE(z + 48));
      }
    }
  }
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP central directory is damaged at entry ' + n);
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // The ZIP64 extra field (id 1) carries whichever of the three overflowed,
    // in this fixed order.
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = buf.readUInt16LE(x), len = buf.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(buf.readBigUInt64LE(q)); }
      }
      x += 4 + len;
    }
    out.push({ name, method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// One entry's bytes. The local header's own name and extra lengths are read
// again here: they may differ from the central directory's.
function read(buf, e) {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('ZIP entry header is damaged: ' + e.name);
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(e.usize + 1024, 1024) });
  throw new Error('ZIP entry ' + e.name + ' uses compression method ' + e.method + ', which this reader does not handle');
}

// Call `fn(line)` for each line of a buffer without ever making one string of
// the whole thing: the 13F table is past what a single JS string may hold.
function eachLine(bytes, fn) {
  let a = 0;
  for (;;) {
    let b = bytes.indexOf(10, a);
    if (b < 0) b = bytes.length;
    if (b > a) {
      const end = bytes[b - 1] === 13 ? b - 1 : b;
      if (end > a) fn(bytes.toString('utf8', a, end));          // a bare CR LF is a blank line too
    }
    if (b >= bytes.length) break;
    a = b + 1;
  }
}

// ---- the same, for an archive too large to hold in memory -------------------
//
// The fund-portfolio data set is a 460MB ZIP whose main table unpacks to
// several gigabytes. So the archive stays on disk: its directory is read from
// the tail of the file, and one entry at a time is piped through the
// inflater and handed over line by line. Nothing larger than a read buffer
// is ever in memory.
const fs = require('fs');

// The directory of a ZIP on disk: the last megabyte is read, which holds the
// whole central directory of any archive with a sane number of entries, and
// the same parser is run over it with its offsets shifted.
function entriesOfFile(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const want = Math.min(size, 1 << 20);
    const tail = Buffer.alloc(want);
    fs.readSync(fd, tail, 0, want, size - want);
    const shift = size - want;
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a ZIP file: no end-of-central-directory record');
    let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 archive without its locator');
      const z = Number(tail.readBigUInt64LE(loc + 8)) - shift;
      if (z < 0 || tail.readUInt32LE(z) !== 0x06064b50) throw new Error('ZIP64 directory record is outside the part read');
      count = Number(tail.readBigUInt64LE(z + 32)); cdSize = Number(tail.readBigUInt64LE(z + 40)); cdOffset = Number(tail.readBigUInt64LE(z + 48));
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const out = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP central directory is damaged at entry ' + n);
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); }
        }
        x += 4 + len;
      }
      out.push({ name, method, csize, usize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally { fs.closeSync(fd); }
}

// Each line of one entry of a ZIP on disk, in order. Resolves with the count.
// `fn(line)` may return false to stop early (a header peek).
function streamLines(file, e, fn) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(30);
    fs.readSync(fd, head, 0, 30, e.offset);
    fs.closeSync(fd);
    if (head.readUInt32LE(0) !== 0x04034b50) return reject(new Error('ZIP entry header is damaged: ' + e.name));
    const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    if (e.csize === 0) return resolve(0);
    const raw = fs.createReadStream(file, { start, end: start + e.csize - 1, highWaterMark: 1 << 20 });
    let src = raw;
    if (e.method === 8) src = raw.pipe(zlib.createInflateRaw());
    else if (e.method !== 0) return reject(new Error('ZIP entry ' + e.name + ' uses compression method ' + e.method + ', which this reader does not handle'));
    let rest = '', n = 0, stopped = false;
    const dec = new (require('string_decoder').StringDecoder)('utf8');
    const stop = () => { stopped = true; raw.destroy(); resolve(n); };
    src.on('data', (chunk) => {
      if (stopped) return;
      const text = rest + dec.write(chunk);
      let a = 0;
      for (;;) {
        const b = text.indexOf('\n', a);
        if (b < 0) break;
        const line = text.charCodeAt(b - 1) === 13 ? text.slice(a, b - 1) : text.slice(a, b);
        a = b + 1;
        if (!line) continue;
        n++;
        if (fn(line) === false) return stop();
      }
      rest = text.slice(a);
    });
    src.on('end', () => { if (stopped) return; const last = (rest + dec.end()).replace(/\r$/, ''); if (last) { n++; fn(last); } resolve(n); });
    src.on('error', (err) => { if (!stopped) reject(err); });
    raw.on('error', (err) => { if (!stopped) reject(err); });
  });
}

module.exports = { entries, read, eachLine, entriesOfFile, streamLines };
