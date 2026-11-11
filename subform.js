// The public subscribe box's own checks against bots (2026-11-10). From
// 2026-10-13 a script posted about 210 strangers' real addresses into the home
// page's box, from 21 data-centre and proxy addresses, a few to nineteen a day;
// each got a confirmation mail it never asked for and none confirmed. The owner:
// "yes" to stopping it at the form. Pure: server.js makes and checks; the reply
// to a refused post is the same "check your email" as any other, so the script
// learns nothing, and no mail is sent.
//
//   token(now, mac)          the signed time the form was drawn, put in the page
//   check(body, now, mac)    null when the post may go on, else why not (a fact for the log)
//   netOf(ip)                the network an address belongs to, for the per-network cap
// mac(label) is the server's keyed hash (authMac); with no key, no token is made or asked for.
'use strict';
const crypto = require('crypto');

const MIN_MS = 3000;              // a person takes longer than this to type an address
const MAX_MS = 24 * 3600e3;       // a page left open a day: draw it again
const HONEYPOT = 'website';       // a field hidden from people; a script fills it
const TOKEN = 'ft';

function token(now, mac) {
  const m = mac('subscribe-form.' + now);
  return m ? now + '.' + m.slice(0, 32) : '';
}

function check(body, now, mac) {
  const b = body || {};
  if (String(b[HONEYPOT] || '').trim()) return 'honeypot';
  if (!mac('probe')) return null;   // no key on this server: nothing to check against
  const m = /^(\d{12,16})\.([0-9a-f]{32})$/.exec(String(b[TOKEN] || ''));
  if (!m) return 'no form token';
  const ts = Number(m[1]);
  const want = Buffer.from(mac('subscribe-form.' + ts).slice(0, 32));
  if (!crypto.timingSafeEqual(want, Buffer.from(m[2]))) return 'bad form token';
  if (now - ts < MIN_MS) return 'too fast';
  if (now - ts > MAX_MS) return 'stale form';
  return null;
}

// IPv4 to its /24, IPv6 to its /48: the addresses a bot rotates through sit together.
function netOf(ip) {
  const s = String(ip || '').trim().replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.split('.').slice(0, 3).join('.') + '.0/24';
  if (s.includes(':')) return s.split(':').slice(0, 3).join(':') + '::/48';
  return s || 'unknown';
}

// The two hidden fields for the form.
const fields = (tok) => `<input type="hidden" name="${TOKEN}" value="${tok}" />`
  + `<div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">`
  + `<label>Leave this empty <input type="text" name="${HONEYPOT}" tabindex="-1" autocomplete="off" /></label></div>`;

module.exports = { token, check, netOf, fields, MIN_MS, MAX_MS, HONEYPOT, TOKEN };
