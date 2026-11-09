// Federal contracts, the read step (contracts-load.js --load): each fiscal
// year's ZIP on disk into fed_contracts in the LOCAL formd.db, no request.
// Backlog 61, E7; docs/context/federal-contracts.md.
//
// One row a recipient a fiscal year: its registration ID (UEI), name and
// match key, parent, city, state, 5-digit ZIP, telephone (one form, as
// contactsdb.usPhone), the dollars obligated that year (a modification can be
// negative, so a year can net below zero), the number of contract actions,
// its largest agency and its most frequent industry code. NOT KEPT: street
// addresses, fax numbers, and every per-action detail.
'use strict';
const fs = require('fs');
const path = require('path');
const Zip = require('./zipread.js');
const { splitCsv } = require('./f5500.js');
const { nameKey } = require('./pppload-read.js');
const { usPhone } = require('./contactsdb.js');

const NEED = ['action_date_fiscal_year', 'federal_action_obligation', 'awarding_agency_name', 'recipient_uei', 'recipient_name', 'recipient_parent_uei',
  'recipient_parent_name', 'recipient_city_name', 'recipient_state_code', 'recipient_zip_4_code', 'recipient_phone_number', 'naics_code'];

function ensureSchema(db) {
  db.exec(`
    create table if not exists fed_contracts (
      rkey text not null, fy integer not null, uei text, name text, name_key text, parent_uei text, parent_name text,
      city text, state text, zip text, phone text, obligations real, actions integer, top_agency text, naics text,
      primary key (rkey, fy)
    );
    create index if not exists idx_fed_key on fed_contracts (name_key, state);
    create index if not exists idx_fed_phone on fed_contracts (phone);
    create index if not exists idx_fed_uei on fed_contracts (uei);
    create table if not exists fed_files (file text primary key, rows integer, recipients integer, at integer not null);
  `);
}

// One record into its fields, or null when it is not a usable action.
function actionOf(f, at) {
  const g = (k) => (at[k] >= 0 ? f[at[k]] : null);
  const fy = Number(g('action_date_fiscal_year'));
  const name = String(g('recipient_name') || '').trim();
  if (!fy || !name) return null;
  const uei = String(g('recipient_uei') || '').trim() || null;
  const state = String(g('recipient_state_code') || '').trim() || null;
  const ob = Number(g('federal_action_obligation'));
  const zip = String(g('recipient_zip_4_code') || '').trim().slice(0, 5);
  return {
    fy, uei, name, name_key: nameKey(name), state,
    rkey: uei ? 'UEI ' + uei : 'NAME ' + (nameKey(name) || name.toUpperCase()) + '|' + (state || ''),
    parent_uei: String(g('recipient_parent_uei') || '').trim() || null,
    parent_name: String(g('recipient_parent_name') || '').trim() || null,
    city: String(g('recipient_city_name') || '').trim() || null,
    zip: /^\d{5}$/.test(zip) ? zip : null,
    phone: usPhone(g('recipient_phone_number')),
    obligation: isFinite(ob) ? ob : 0,
    agency: String(g('awarding_agency_name') || '').trim() || null,
    naics: /^\d{2,6}$/.test(String(g('naics_code') || '').trim()) ? String(g('naics_code')).trim() : null,
  };
}

// Fold one action into its recipient-year.
function fold(map, a) {
  const k = a.rkey + '#' + a.fy;
  let o = map.get(k);
  if (!o) {
    o = { rkey: a.rkey, fy: a.fy, uei: a.uei, name: a.name, name_key: a.name_key, parent_uei: a.parent_uei, parent_name: a.parent_name,
      city: a.city, state: a.state, zip: a.zip, phone: a.phone, obligations: 0, actions: 0, agencies: new Map(), naics: new Map() };
    map.set(k, o);
  }
  o.obligations += a.obligation;
  o.actions++;
  if (!o.phone && a.phone) o.phone = a.phone;
  if (a.agency) o.agencies.set(a.agency, (o.agencies.get(a.agency) || 0) + Math.abs(a.obligation));
  if (a.naics) o.naics.set(a.naics, (o.naics.get(a.naics) || 0) + 1);
  return o;
}
const top = (m) => { let best = null, n = -1; for (const [k, v] of m) if (v > n) { best = k; n = v; } return best; };

async function readZip(file, onAction) {
  let rows = 0;
  for (const e of Zip.entriesOfFile(file).filter((x) => /\.csv$/i.test(x.name))) {
    let at = null, header = null, pending = '', failed = null;
    await Zip.streamLines(file, e, (line) => {
      try {
        const t = pending ? pending + '\n' + line : line;
        const f = splitCsv(t);
        if (!f) { pending = t; return undefined; }
        pending = '';
        if (!header) {
          header = f;
          at = Object.fromEntries(NEED.map((k) => [k, header.indexOf(k)]));
          if (at.recipient_name < 0 || at.federal_action_obligation < 0) throw new Error(e.name + ': the header lacks the recipient or the obligation; the layout may have changed');
          return undefined;
        }
        if (f.length !== header.length) return undefined;
        const a = actionOf(f, at);
        if (a) { onAction(a); rows++; }
        return undefined;
      } catch (err) { failed = err; return false; }
    });
    if (failed) throw failed;
  }
  return rows;
}

async function load(opts, deps) {
  const log = deps.log || console.log;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.FORMD_DB || path.join(__dirname, 'formd.db'));
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  ensureSchema(db);
  const done = new Set(db.prepare('select file from fed_files').all().map((r) => r.file));
  const todo = deps.onDisk().filter((f) => !done.has(f)).sort().reverse();
  log(`${todo.length} fiscal-year file(s) on disk to read${opts.commit ? '' : ' (DRY RUN: add --commit)'}`);
  if (!opts.commit) { db.close(); return { ok: true, todo: todo.length }; }
  const cols = ['rkey', 'fy', 'uei', 'name', 'name_key', 'parent_uei', 'parent_name', 'city', 'state', 'zip', 'phone', 'obligations', 'actions', 'top_agency', 'naics'];
  // A recipient-year can span files (late actions); a later file adds to it.
  const up = db.prepare(`insert into fed_contracts (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})
    on conflict(rkey, fy) do update set obligations = obligations + excluded.obligations, actions = actions + excluded.actions,
      phone = coalesce(phone, excluded.phone), top_agency = coalesce(top_agency, excluded.top_agency), naics = coalesce(naics, excluded.naics)`);
  for (const f of todo) {
    const t0 = Date.now();
    const map = new Map();
    let rows;
    try { rows = await readZip(deps.pathOf(f), (a) => fold(map, a)); }
    catch (e) { db.close(); log(`${f}: ${e.message}`); return { ok: false, stopped: e.message }; }
    db.exec('begin');
    try {
      for (const o of map.values()) up.run(o.rkey, o.fy, o.uei, o.name, o.name_key, o.parent_uei, o.parent_name, o.city, o.state, o.zip, o.phone, o.obligations, o.actions, top(o.agencies), top(o.naics));
      db.prepare('insert into fed_files (file, rows, recipients, at) values (?, ?, ?, ?)').run(f, rows, map.size, Date.now());
      db.exec('commit');
    } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } db.close(); log(`${f}: ${e.message}`); return { ok: false, stopped: e.message }; }
    log(`${f}: ${rows.toLocaleString('en-US')} contract actions, ${map.size.toLocaleString('en-US')} recipient-years, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const n = db.prepare('select count(*) n, count(distinct rkey) r from fed_contracts').get();
  db.close();
  log(`fed_contracts: ${n.n.toLocaleString('en-US')} recipient-years, ${n.r.toLocaleString('en-US')} recipients.`);
  return { ok: true };
}

module.exports = { load, actionOf, fold, readZip, ensureSchema, NEED };
