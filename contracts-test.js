// Federal contracts (backlog 61, E7): the read step's rules (contracts-read.js)
// and the download's care (contracts-load.js). No network.
//   node contracts-test.js
'use strict';
const R = require('./contracts-read.js');
const L = require('./contracts-load.js');
const { splitCsv } = require('./f5500.js');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const H = ['award_id_piid', 'federal_action_obligation', 'action_date_fiscal_year', 'awarding_agency_name', 'recipient_uei', 'recipient_name', 'recipient_parent_uei',
  'recipient_parent_name', 'recipient_address_line_1', 'recipient_city_name', 'recipient_state_code', 'recipient_zip_4_code', 'recipient_phone_number', 'recipient_fax_number', 'naics_code'];
const at = Object.fromEntries(R.NEED.map((k) => [k, H.indexOf(k)]));
const line = (o) => splitCsv(H.map((h) => '"' + String(o[h] ?? '').replace(/"/g, '""') + '"').join(','));
const base = { award_id_piid: 'W1', federal_action_obligation: '250000.50', action_date_fiscal_year: '2024', awarding_agency_name: 'Department of Defense', recipient_uei: 'ABC123DEF456',
  recipient_name: 'CONTINENTAL ELECTRICAL CONSTRUCTION COMPANY, LLC', recipient_parent_uei: 'PAR999', recipient_parent_name: 'FOURGEN HOLDINGS INC',
  recipient_address_line_1: '815 COMMERCE DR', recipient_city_name: 'OAK BROOK', recipient_state_code: 'IL', recipient_zip_4_code: '605231234', recipient_phone_number: '6309271900', recipient_fax_number: '6309271999', naics_code: '238210' };
const a = R.actionOf(line(base), at);
eq([a.fy, a.uei, a.rkey, a.name_key, a.state, a.zip, a.phone, a.obligation, a.agency, a.naics, a.parent_name],
  [2024, 'ABC123DEF456', 'UEI ABC123DEF456', 'CONTINENTAL ELECTRICAL CONSTRUCTION', 'IL', '60523', '630-927-1900', 250000.5, 'Department of Defense', '238210', 'FOURGEN HOLDINGS INC'], 'one action');
ok(!JSON.stringify(a).includes('COMMERCE DR') && !JSON.stringify(a).includes('6309271999'), 'no street, no fax');
const noUei = R.actionOf(line({ ...base, recipient_uei: '' }), at);
eq(noUei.rkey, 'NAME CONTINENTAL ELECTRICAL CONSTRUCTION|IL', 'no UEI: keyed by name and state');
eq(R.actionOf(line({ ...base, recipient_name: '' }), at), null, 'no recipient: not an action');
const m = new Map();
R.fold(m, a);
R.fold(m, R.actionOf(line({ ...base, federal_action_obligation: '-50000.50', awarding_agency_name: 'Department of Energy' }), at));
R.fold(m, R.actionOf(line({ ...base, action_date_fiscal_year: '2025' }), at));
const y24 = m.get('UEI ABC123DEF456#2024');
eq([m.size, y24.obligations, y24.actions], [2, 200000, 2], 'folded by recipient and fiscal year; a negative modification nets off');
eq([...y24.agencies.keys()], ['Department of Defense', 'Department of Energy'], 'agencies weighed by the dollars moved');

// ---- the download's care ----
(async () => {
  const NOW = new Date('2026-11-09T12:00:00');
  const o = L.options([], NOW);
  eq([o.years[0], o.years[o.years.length - 1]], [2027, 2016], 'fiscal 2016 to the current fiscal year (it starts in October)');
  eq(L.options(['--gap', '5'], NOW).gapS, 30, 'never under 30 seconds apart');
  function harness(status) {
    const calls = [], log = [];
    let t = 1e12;
    return { calls, log, deps: {
      log: () => {}, now: () => t, sleep: async (ms) => { t += ms; },
      fetch: async (url) => { calls.push(url); return { status, body: { cancel: async () => {} }, json: async () => ({ monthly_files: [] }) }; },
      onDisk: () => [], readLog: () => log, noteRequest: (u, s) => log.push({ at: t, url: u, status: s }), save: async () => 1000,
    } };
  }
  let h = harness(200);
  await L.download({ commit: false, gapS: 60, years: [2024] }, h.deps);
  eq(h.calls.length, 0, 'a dry run makes no request');
  h = harness(503);
  const r503 = await L.download({ commit: true, gapS: 60, years: [2024, 2023] }, h.deps);
  ok(!r503.ok && h.calls.length === 1, 'a refusal stops at once, nothing retried');
  h = harness(200);
  const none = await L.download({ commit: true, gapS: 60, years: [2024] }, h.deps);
  ok(!none.ok && h.calls.length === 1, 'a listing naming no file stops before any download');
  h = harness(200);
  for (let i = 0; i < L.DAY_CAP; i++) h.log.push({ at: 1e12, url: 'u', status: 200 });
  const capped = await L.download({ commit: true, gapS: 60, years: [2024] }, h.deps);
  ok(!capped.ok && h.calls.length === 0, 'the 24-hour cap stops it before a request');
  console.log(`contracts-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
