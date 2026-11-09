// The contact list: the people, companies and brokers named in Form D, as a
// CRM would hold them (backlog 61; docs/context/form-d.md "Contacts"). The
// owner, 2026-11-09: "We have the buyer names in Form D. Can you a separate
// list, this can be a CRM type of data, like a contact database". Form D
// names no investors; it names each company's executives, directors and
// promoters, and the brokers paid to sell.
//
// The owner's choices: companies carry their telephone, city and state, never
// a street address; people carry no address at all ("people data is also
// important but not their addresses"), and the same name is one person only
// within one state (Form D has no ID for a person).
//
// LOCAL ONLY: derived tables in formd.db, rebuilt whole from the raw Form D
// tables (which are never touched). Never Turso, never served.
//
//   node contactsdb.js --build        # rebuild the four tables (a few minutes)
'use strict';

// A first name that is not one: the firm sits in the last-name field.
const NOT_A_NAME = "('', 'N/A', 'NA', 'N A', '-', '.', 'NONE', 'NOT APPLICABLE')";
// A firm, not a person: a name with a company word in it, as a whole word
// ("LLC", "Fund", "Partners"...). Filers put firm names across the person
// fields ("llc" / "Fund GP,") and company words in middle names.
const ORG_WORDS = ['LLC', 'L L C', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'LP', 'L P', 'LLP', 'LTD', 'LIMITED', 'PLC', 'GP', 'FUND', 'FUNDS',
  'PARTNERS', 'PARTNERSHIP', 'MANAGEMENT', 'CAPITAL', 'HOLDINGS', 'TRUST', 'ADVISORS', 'ADVISERS', 'VENTURES', 'COMPANY', 'GROUP', 'ASSOCIATES',
  'BANK', 'SECURITIES', 'INVESTMENTS', 'EQUITY', 'SERIES'];
// SQL: true when the expression holds one of ORG_WORDS as a whole word
// (punctuation turned to spaces first).
function orgWords(expr) {
  const padded = `(' ' || replace(replace(replace(replace(upper(${expr}), ',', ' '), '.', ' '), '(', ' '), ')', ' ') || ' ')`;
  return '(' + ORG_WORDS.map((w) => `${padded} like '% ${w} %'`).join(' or ') + ')';
}
function usPhone(s) {
  const t = String(s == null ? '' : s).trim();
  if (!/[1-9]/.test(t)) return null;                                 // "N/A", "000-000-0000", blank: no telephone
  if (/[a-z]/i.test(t.replace(/\b(ext|x)\b.*$/i, ''))) return t;   // letters: as filed
  const [main, ext] = t.split(/\s*(?:ext\.?|x)\s*/i);
  let d = String(main).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return t;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` + (ext && /^\d+$/.test(ext.trim()) ? ' x' + ext.trim() : '');
}
// The headcount of "check" rows: as the viewer, $1B+ sold to 1 or 2 investors is left out of sums.
const KEPT = 'case when sold >= 1e9 and investors is not null and investors <= 2 then null else sold end';

// The join across states, over ct_raw (k = NAME|STATE): for each person's
// name, its state groups are joined (union-find) when two share a company or
// a telephone any of their companies has filed (as usPhone formats it). The
// joined group takes the key of its member with the most filings; ct_raw.k
// is rewritten for the others. Firms are left as they are.
function mergeAcrossStates(db) {
  const phones = new Map();   // cik -> Set of telephones it has filed
  for (const r of db.prepare(`select f.cik, i.ISSUERPHONENUMBER p from formd f join fd_issuers i on i.ACCESSIONNUMBER = f.accn
      where i.IS_PRIMARYISSUER_FLAG = 'YES' and f.cik is not null and nullif(trim(i.ISSUERPHONENUMBER), '') is not null`).iterate()) {
    const p = usPhone(r.p);
    if (!p) continue;
    if (!phones.has(r.cik)) phones.set(r.cik, new Set());
    phones.get(r.cik).add(p);
  }
  // name -> Map(key -> { ciks, phones, filings })
  const byName = new Map();
  for (const r of db.prepare("select k, cik, count(distinct accn) n from ct_raw where kind = 'person' group by k, cik").iterate()) {
    const name = r.k.slice(0, r.k.indexOf('|'));
    let g = byName.get(name);
    if (!g) byName.set(name, (g = new Map()));
    let e = g.get(r.k);
    if (!e) g.set(r.k, (e = { ciks: new Set(), phones: new Set(), filings: 0 }));
    e.ciks.add(r.cik);
    e.filings += r.n;
    for (const p of phones.get(r.cik) || []) e.phones.add(p);
  }
  db.exec('drop table if exists temp.ct_merge; create temp table ct_merge (k0 text primary key, k text not null);');
  const ins = db.prepare('insert into ct_merge (k0, k) values (?, ?)');
  let joined = 0, into = 0;
  for (const g of byName.values()) {
    if (g.size < 2) continue;
    const keys = [...g.keys()];
    const parent = new Map(keys.map((k) => [k, k]));
    const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    for (let a = 0; a < keys.length; a++) {
      for (let b = a + 1; b < keys.length; b++) {
        const A = g.get(keys[a]), B = g.get(keys[b]);
        let share = false;
        for (const c of A.ciks) if (B.ciks.has(c)) { share = true; break; }
        if (!share) for (const p of A.phones) if (B.phones.has(p)) { share = true; break; }
        if (share) parent.set(find(keys[a]), find(keys[b]));
      }
    }
    const groups = new Map();
    for (const k of keys) { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const head = members.slice().sort((x, y) => g.get(y).filings - g.get(x).filings || (x < y ? -1 : 1))[0];
      for (const k of members) if (k !== head) { ins.run(k, head); joined++; }
      into++;
    }
  }
  db.exec(`update ct_raw set k = (select m.k from ct_merge m where m.k0 = ct_raw.k) where k in (select k0 from ct_merge);
    drop table temp.ct_merge;`);
  return { joined, into };
}

function build(db, log = () => {}) {
  const t0 = Date.now();
  db.exec('begin');
  try {
    db.exec(`
      drop table if exists temp.ct_raw;
      create temp table ct_raw as
        select f.cik, f.accn, f.filed, f.name issuer, f.industry, f.pooled,
          case when upper(trim(coalesce(p.FIRSTNAME, ''))) in ${NOT_A_NAME} or ${orgWords("coalesce(p.FIRSTNAME, '') || ' ' || coalesce(p.LASTNAME, '')")}
               then 'organization' else 'person' end kind,
          trim(coalesce(p.FIRSTNAME, '')) fn,
          -- A middle name that is a company word, a placeholder, no letters at
          -- all, a repeat of the first or last name, or a roman numeral is dropped.
          case when ${orgWords("coalesce(p.MIDDLENAME, '')")} or upper(trim(coalesce(p.MIDDLENAME, ''))) in ${NOT_A_NAME}
                 or trim(coalesce(p.MIDDLENAME, '')) not glob '*[A-Za-z]*'
                 or upper(trim(p.MIDDLENAME)) in (upper(trim(coalesce(p.FIRSTNAME, ''))), upper(trim(coalesce(p.LASTNAME, ''))))
                 or upper(trim(p.MIDDLENAME)) glob '[IVX]*' and upper(trim(p.MIDDLENAME)) not glob '*[^IVX]*' and length(trim(p.MIDDLENAME)) > 1
               then '' else trim(coalesce(p.MIDDLENAME, '')) end mn,
          trim(p.LASTNAME) ln,
          coalesce(nullif(upper(trim(p.STATEORCOUNTRY)), ''), f.state) st,
          (p.RELATIONSHIP_1 = 'Executive Officer' or p.RELATIONSHIP_2 = 'Executive Officer' or p.RELATIONSHIP_3 = 'Executive Officer') exec,
          (p.RELATIONSHIP_1 = 'Director' or p.RELATIONSHIP_2 = 'Director' or p.RELATIONSHIP_3 = 'Director') dir,
          (p.RELATIONSHIP_1 = 'Promoter' or p.RELATIONSHIP_2 = 'Promoter' or p.RELATIONSHIP_3 = 'Promoter') prom,
          nullif(trim(p.RELATIONSHIPCLARIFICATION), '') title
        from fd_persons p join formd f on f.accn = p.ACCESSIONNUMBER
        where upper(trim(coalesce(p.LASTNAME, ''))) not in ${NOT_A_NAME} and f.cik is not null;
      alter table temp.ct_raw add column k text;
      -- A firm whose name runs across both fields ("llc" / "Fund GP,") keeps
      -- both parts; one in the last-name field alone keeps that.
      update temp.ct_raw set ln = trim(fn || ' ' || ln), fn = ''
        where kind = 'organization' and upper(fn) not in ${NOT_A_NAME};
      update temp.ct_raw set fn = '' where kind = 'organization';
      update temp.ct_raw set k = (case kind when 'organization' then upper(ln) else upper(fn) || ' ' || upper(ln) end) || '|' || coalesce(st, '');
      create index temp.ct_raw_k on ct_raw (k, cik);
    `);
    log(`people rows gathered (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    // ONE PERSON (the owner's rule, 2026-11-09): a name within a state, or
    // the same name in another state that shares a company or a company
    // telephone with it. Form D carries no telephone for a person, only the
    // company's, so a telephone joins two entries; it never splits one.
    const merged = mergeAcrossStates(db);
    log(`${merged.joined} name-and-state entries joined into ${merged.into} people (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    // One row a person (a name within a state) or a named organization.
    db.exec(`
      drop table if exists ct_people;
      create table ct_people (
        k text primary key, name text, kind text, state text, states text, first_filed text, last_filed text,
        filings integer, companies integer, exec integer, dir integer, prom integer, funds integer
      );
      insert into ct_people
        select k,
          -- The spelling of the newest filing that writes it in mixed case, else
          -- the newest (a 1 or 0 for mixed case, the 10-character date, '|').
          substr(max(case when (fn || ln) <> upper(fn || ln) then '1' else '0' end || filed || '|'
            || case kind when 'organization' then ln else fn || case when mn <> '' then ' ' || mn else '' end || ' ' || ln end), 13),
          max(kind), nullif(substr(k, instr(k, '|') + 1), ''), group_concat(distinct st), min(filed), max(filed), count(distinct accn), count(distinct cik),
          sum(exec), sum(dir), sum(prom), count(distinct case when pooled = 1 then cik end)
        from ct_raw group by k;
      create index idx_ct_people_name on ct_people (name collate nocase);
      create index idx_ct_people_state on ct_people (state);
      create index idx_ct_people_cos on ct_people (companies);
    `);
    log(`ct_people built (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    // One row a person at a company: roles over every filing, the newest title.
    db.exec(`
      drop table if exists ct_roles;
      create table ct_roles (
        k text not null, cik text not null, exec integer, dir integer, prom integer, title text,
        first_filed text, last_filed text, filings integer, primary key (k, cik)
      );
      insert into ct_roles
        select k, cik, max(exec), max(dir), max(prom),
          nullif(substr(max(filed || '|' || coalesce(title, '')), 12), ''),
          min(filed), max(filed), count(distinct accn)
        from ct_raw group by k, cik;
      create index idx_ct_roles_cik on ct_roles (cik);
    `);
    log(`ct_roles built (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    // One row a company: its newest filing's name, place, telephone (the
    // primary issuer's, as filed) and industry; money raised; people named.
    db.exec(`
      drop table if exists ct_companies;
      create table ct_companies (
        cik text primary key, name text, city text, state text, phone text, industry text, fund_type text, pooled integer,
        first_filed text, last_filed text, offerings integer, raised real, people integer
      );
      insert into ct_companies (cik, name, city, state, industry, fund_type, pooled, first_filed, last_filed, offerings, raised)
        select f.cik, l.name, l.city, l.state, l.industry, l.fund_type, l.pooled, min(f.filed), max(f.filed),
          sum(case when f.superseded = 0 then 1 else 0 end), sum(case when f.superseded = 0 then ${KEPT.replace(/sold/g, 'f.sold').replace(/investors/g, 'f.investors')} end)
        from formd f
        join formd l on l.accn = (select x.accn from formd x where x.cik = f.cik order by x.filed desc, x.accn desc limit 1)
        where f.cik is not null group by f.cik;
      update ct_companies set
        phone = (select i.ISSUERPHONENUMBER from formd x join fd_issuers i on i.ACCESSIONNUMBER = x.accn
                 where x.cik = ct_companies.cik and i.IS_PRIMARYISSUER_FLAG = 'YES' and nullif(trim(i.ISSUERPHONENUMBER), '') is not null
                 order by x.filed desc limit 1),
        people = (select count(*) from ct_roles r where r.cik = ct_companies.cik);
      create index idx_ct_companies_name on ct_companies (name collate nocase);
      create index idx_ct_companies_state on ct_companies (state);
      create index idx_ct_companies_phone on ct_companies (phone);
    `);
    log(`ct_companies built (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    // One row a broker or finder paid to sell: by its regulatory (CRD)
    // number where it has one, else by name.
    // Money raised counts each deal once (a filing names the same broker on
    // several lines), and each offering at its latest filing.
    db.exec(`
      drop table if exists temp.ct_rr;
      create temp table ct_rr as
        select case when nullif(trim(r.RECIPIENTCRDNUMBER), '') is not null and upper(trim(r.RECIPIENTCRDNUMBER)) not in ('NONE', '0', 'N/A')
                    then 'CRD ' || trim(r.RECIPIENTCRDNUMBER) else 'NAME ' || upper(trim(r.RECIPIENTNAME)) end k,
          r.ACCESSIONNUMBER accn, f.cik, f.filed, f.superseded sup, ${KEPT.replace(/sold/g, 'f.sold').replace(/investors/g, 'f.investors')} kept,
          r.RECIPIENTNAME name, case when upper(trim(r.RECIPIENTCRDNUMBER)) not in ('NONE', '0', 'N/A') then trim(r.RECIPIENTCRDNUMBER) end crd,
          case when upper(trim(coalesce(r.ASSOCIATEDBDNAME, ''))) in ${NOT_A_NAME} then null else trim(r.ASSOCIATEDBDNAME) end firm,
          case when upper(trim(r.ASSOCIATEDBDCRDNUMBER)) not in ('NONE', '0', 'N/A') then trim(r.ASSOCIATEDBDCRDNUMBER) end firm_crd
        from fd_recipients r join formd f on f.accn = r.ACCESSIONNUMBER
        where upper(trim(coalesce(r.RECIPIENTNAME, ''))) not in ${NOT_A_NAME};
      create index temp.ct_rr_k on ct_rr (k, accn);
      drop table if exists ct_brokers;
      create table ct_brokers (
        k text primary key, name text, crd text, firm text, firm_crd text, deals integer, companies integer,
        raised real, first_filed text, last_filed text
      );
      insert into ct_brokers
        select k, max(name), max(crd), max(firm), max(firm_crd), count(distinct accn), count(distinct cik),
          (select sum(kept) from (select distinct d.accn, d.kept from ct_rr d where d.k = ct_rr.k and d.sup = 0)),
          min(filed), max(filed)
        from ct_rr group by k;
      create index idx_ct_brokers_name on ct_brokers (name collate nocase);
      drop table temp.ct_raw;
      drop table temp.ct_rr;
    `);
    // Telephones in one form for a CRM: a US number of ten digits (or eleven
    // starting 1) as 312-555-0100; anything else as filed.
    const upd = db.prepare('update ct_companies set phone = ? where cik = ?');
    for (const r of db.prepare('select cik, phone from ct_companies where phone is not null').all()) {
      const p = usPhone(r.phone);
      if (p !== r.phone) upd.run(p, r.cik);
    }
    db.exec('commit');
    log(`ct_brokers built (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } catch (e) { try { db.exec('rollback'); } catch (_) { /* already */ } throw e; }
  const n = (t) => db.prepare(`select count(*) n from ${t}`).get().n;
  return { people: n('ct_people'), roles: n('ct_roles'), companies: n('ct_companies'), brokers: n('ct_brokers') };
}

if (require.main === module && process.argv.includes('--build')) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.FORMD_DB || require('path').join(__dirname, 'formd.db'));
  db.exec('pragma busy_timeout = 10000; pragma journal_mode = wal;');
  const t = Date.now();
  const r = build(db, (s) => console.log(s));
  console.log(JSON.stringify(r), `${((Date.now() - t) / 1000).toFixed(0)}s`);
  db.close();
}

module.exports = { build, usPhone, NOT_A_NAME };
