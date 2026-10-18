// Small, pure pieces of the sign-in hardening (backlog 44a and 44c, confirmed
// by the VulnHunter scan of 2026-10-18, backlog 45). No database, no
// request: server.js wires them in, authsec-test.js holds them still.
'use strict';
const crypto = require('crypto');
const path = require('path');

// ---- the private-file gate ---------------------------------------------------
// THE GATE MUST SEE THE PATH THE FILE SERVER WILL SERVE. It matched the raw
// req.path against the file list, while express.static decodes and
// normalises before it opens a file, so a percent-encoded spelling of a
// private file's name missed the list, fell through to the file server and
// was served to anyone. Measured with a stand-in on express.static:
// /lab.html refused, /lab%2Ehtml and /%6Cab.html served.
//
// Returns the file name the server would open, relative to private/, or null
// for a path that cannot be decoded or carries a byte no file name should
// (a backslash, which Windows treats as a separator, or a NUL). The caller
// refuses null outright rather than letting it reach the file server.
function assetRel(reqPath) {
  let p;
  try { p = decodeURIComponent(String(reqPath || '/')); } catch (e) { return null; }
  if (/[\\\0]/.test(p)) return null;
  p = path.posix.normalize('/' + p);
  return p === '/' ? 'index.html' : p.replace(/^\/+/, '');
}

// ---- attempt limits ------------------------------------------------------------
// A counter row is { count, windowStart }. It limits only while its window
// is open; an old row counts as empty, so nothing has to sweep it.
function overLimit(row, now, limit, windowMs) {
  if (!row || !(Number(row.count) > 0)) return false;
  if (!(now - Number(row.windowStart) < windowMs)) return false;
  return Number(row.count) >= limit;
}

// ---- tokens --------------------------------------------------------------------
// What is stored for a session token: its hash, so the table never holds a
// usable credential.
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// ---- cost limits (backlog 44b) ---------------------------------------------------
// An email address: the length first, then the pattern. The pattern takes time
// quadratic in a run of dots, and every form that takes an address runs it
// before anyone signs in (30,000 characters took 0.9s, 100KB about 9s). No
// address is longer than 254 characters (RFC 5321).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);

// A request another site started, from its Sec-Fetch-Site header. Only
// 'cross-site' counts: the site's own pages send 'same-origin', schedulers
// send nothing.
const crossSite = (header) => String(header || '').toLowerCase() === 'cross-site';

// The nearest of a fixed set of values, so a cache keyed by the value has as
// many entries as the set and no more. `fallback` for anything not a positive
// number.
function snapTo(list, v, fallback) {
  const n = Number(v);
  if (!(n > 0) || !list.length) return fallback;
  return list.reduce((best, d) => (Math.abs(d - n) < Math.abs(best - n) ? d : best), list[0]);
}

module.exports = { assetRel, overLimit, tokenHash, newToken, EMAIL_RE, isEmail, crossSite, snapTo };
