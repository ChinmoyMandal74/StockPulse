// Form 5500: the yearly report every employer files for its retirement or
// welfare plan, from the Labor Department's data sets (backlog 61, E2;
// docs/context/form-5500.md). Pure: CSV in, rows out.
//
// Why: Form D says what a private company raised, not how big it is. A
// company with a retirement plan reports how many people are in it (a fair
// headcount proxy) and its principal business code (6-digit, from NAICS),
// keyed by its EIN, which the SEC profile of each Form D issuer supplies
// (formd.js filerProfile). Two forms, two files a year: the full Form 5500
// (larger plans) and the short Form 5500-SF (under 100 participants, most of
// the small companies here).
//
// Kept: plan, sponsor name, EIN, business code, participant counts, the
// short form's plan assets, the plan types, the sponsor's city and state.
// NOT kept: street addresses, telephone numbers, or the names of the people
// who signed (the files carry all three).
'use strict';

// The columns read from each form, by the name in the file's header. A
// column an older year lacks is simply absent (null).
const FORMS = {
  full: {
    ein: 'SPONS_DFE_EIN', sponsor: 'SPONSOR_DFE_NAME', dba: 'SPONS_DFE_DBA_NAME', plan: 'PLAN_NAME', planNum: 'SPONS_DFE_PN',
    begin: 'FORM_PLAN_YEAR_BEGIN_DATE', code: 'BUSINESS_CODE', city: 'SPONS_DFE_MAIL_US_CITY', state: 'SPONS_DFE_MAIL_US_STATE',
    participants: 'TOT_PARTCP_BOY_CNT', active: 'TOT_ACTIVE_PARTCP_CNT', activeBoy: 'TOT_ACT_PARTCP_BOY_CNT',
    pension: 'TYPE_PENSION_BNFT_CODE', welfare: 'TYPE_WELFARE_BNFT_CODE', entity: 'TYPE_PLAN_ENTITY_CD',
  },
  sf: {
    ein: 'SF_SPONS_EIN', sponsor: 'SF_SPONSOR_NAME', dba: 'SF_SPONSOR_DFE_DBA_NAME', plan: 'SF_PLAN_NAME', planNum: 'SF_PLAN_NUM',
    begin: 'SF_PLAN_YEAR_BEGIN_DATE', code: 'SF_BUSINESS_CODE', city: 'SF_SPONS_US_CITY', state: 'SF_SPONS_US_STATE',
    participants: 'SF_TOT_PARTCP_BOY_CNT', active: 'SF_TOT_ACT_PARTCP_EOY_CNT', activeBoy: 'SF_TOT_ACT_PARTCP_BOY_CNT',
    netAssets: 'SF_NET_ASSETS_EOY_AMT', pension: 'SF_TYPE_PENSION_BNFT_CODE', welfare: 'SF_TYPE_WELFARE_BNFT_CODE', entity: 'SF_PLAN_ENTITY_CD',
  },
};

// One CSV record into fields: double quotes around a field, "" for a quote
// inside it. Returns null while a quoted field is still open (the record goes
// on to the next line); the caller joins the lines and asks again.
function splitCsv(line) {
  const out = [];
  let i = 0, f = '', q = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; } else f += c;
  }
  if (q) return null;
  out.push(f);
  return out;
}

const num = (s) => {
  if (s == null) return null;
  const t = String(s).trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;   // blank is null, never 0
};
const text = (s) => (s == null || String(s).trim() === '' ? null : String(s).trim());
const isoDay = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : null);

// The file's header into a column finder for one form.
function reader(header, kind) {
  const spec = FORMS[kind];
  if (!spec) throw new Error('unknown form ' + kind);
  const at = new Map(header.map((h, i) => [String(h).trim().toUpperCase(), i]));
  const idx = {};
  for (const [k, col] of Object.entries(spec)) idx[k] = at.has(col) ? at.get(col) : -1;
  idx.ack = at.has('ACK_ID') ? at.get('ACK_ID') : -1;
  if (idx.ack < 0 || idx.ein < 0) throw new Error('the header lacks ACK_ID or the EIN column; the layout may have changed');
  return (fields) => {
    const g = (k) => (idx[k] >= 0 ? fields[idx[k]] : null);
    const ein = String(g('ein') || '').replace(/\D/g, '');
    return {
      ack_id: text(g('ack')),
      form: kind === 'sf' ? '5500-SF' : '5500',
      ein: /^\d{9}$/.test(ein) && ein !== '000000000' ? ein : null,
      sponsor: text(g('sponsor')),
      dba: text(g('dba')),
      plan: text(g('plan')),
      plan_num: text(g('planNum')),
      plan_year: isoDay(g('begin')),
      business_code: /^\d{2,6}$/.test(String(g('code') || '').trim()) ? String(g('code')).trim() : null,
      participants: num(g('participants')),
      active: num(g('active')),
      active_boy: num(g('activeBoy')),
      net_assets: kind === 'sf' ? num(g('netAssets')) : null,
      pension: text(g('pension')),
      welfare: text(g('welfare')),
      entity: text(g('entity')),
      city: text(g('city')),
      state: text(g('state')),
    };
  };
}

// A business code to its title: the code itself, else with its padding
// zeros dropped (the form writes 523900 for NAICS 5239), else its 5-, 4-, 3-
// and 2-digit parents. Returns { code, title, exact } or null.
function naicsTitle(code, table) {
  const c = String(code || '').trim();
  if (!/^\d{2,6}$/.test(c) || !table) return null;
  const tries = [c];
  let t = c;
  while (t.length > 2 && t.endsWith('0')) { t = t.slice(0, -1); tries.push(t); }
  for (let n = c.length - 1; n >= 2; n--) tries.push(c.slice(0, n));
  for (const k of tries) if (table[k]) return { code: k, title: table[k], exact: k === c || c.startsWith(k) && /^0*$/.test(c.slice(k.length)) };
  return null;
}

// The plan types say what kind of plan it is: the first character of each
// two-character code (2 = defined contribution, 1 = defined benefit, 4 = welfare).
function planKind(pension, welfare) {
  const pairs = (s) => String(s || '').toUpperCase().match(/[0-9][A-Z]/g) || [];
  const p = pairs(pension);
  if (p.some((x) => x[0] === '2')) return 'retirement savings (defined contribution)';
  if (p.some((x) => x[0] === '1')) return 'pension (defined benefit)';
  if (pairs(welfare).length) return 'welfare (health, life or disability)';
  return null;
}

// A company's own plan, not a union (multi-employer) fund. The code means
// different things on the two forms (found 2026-11-09 on Continental's plan,
// coded 1 on the short form and 2 on the full one): on the full form 1 is a
// multi-employer plan and 2 a single employer; the short form is closed to
// multi-employer plans and writes 1 for a single employer (2 there is a plan
// several unrelated employers share).
function ownPlan(r) {
  if (!r) return false;
  return r.form === '5500-SF' ? r.entity === '1' : r.entity === '2';
}

// The headcount proxy of one filing: the largest count it reports; null when none.
function headcount(r) {
  const c = [r.participants, r.active, r.active_boy].filter((x) => x != null);
  return c.length ? Math.max(...c) : null;
}

// The yearly files, as the Labor Department names them.
const BASE = 'https://www.askebsa.dol.gov/FOIA%20Files/';
const fileUrl = (year, kind) => `${BASE}${year}/Latest/F_5500_${kind === 'sf' ? 'SF_' : ''}${year}_Latest.zip`;
const fileName = (year, kind) => `F_5500_${kind === 'sf' ? 'SF_' : ''}${year}_Latest.zip`;

// Only a 200 carries on; anything else stops the run, nothing retried.
function verdict(status) {
  if (status === 200) return { go: true };
  return { go: false, why: `askebsa.dol.gov answered ${status || 'nothing'}. Stopped; nothing retried.` };
}

module.exports = { FORMS, ownPlan, headcount, splitCsv, reader, naicsTitle, planKind, fileUrl, fileName, verdict, BASE };
