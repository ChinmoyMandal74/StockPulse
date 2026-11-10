// Acquisition targets: private companies that fit a buyer's profile, from the
// LOCAL archive (backlog 61; docs/context/acquisition-targets.md). The owner,
// 2026-11-10: "mainly for a private equity owned company operating in the same
// space looking to buy smaller privately owned companies or a private equity GP
// looking for new portfolio company on a certain characteristics". Pure: the
// regions, the presets, the filters, the staff-history pattern and the fit
// score with its reasons. formd-view.js reads the archive; targets-view.html
// draws it. A fit is a description against a stated profile, never advice.
'use strict';

// ---- regions ----
const DIVISIONS = {
  'New England': ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'],
  'Middle Atlantic': ['NJ', 'NY', 'PA'],
  'East North Central': ['IL', 'IN', 'MI', 'OH', 'WI'],
  'West North Central': ['IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD'],
  'South Atlantic': ['DE', 'DC', 'FL', 'GA', 'MD', 'NC', 'SC', 'VA', 'WV'],
  'East South Central': ['AL', 'KY', 'MS', 'TN'],
  'West South Central': ['AR', 'LA', 'OK', 'TX'],
  Mountain: ['AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'UT', 'WY'],
  Pacific: ['AK', 'CA', 'HI', 'OR', 'WA'],
};
const REGIONS = {
  Northeast: [...DIVISIONS['New England'], ...DIVISIONS['Middle Atlantic']],
  Midwest: [...DIVISIONS['East North Central'], ...DIVISIONS['West North Central']],
  South: [...DIVISIONS['South Atlantic'], ...DIVISIONS['East South Central'], ...DIVISIONS['West South Central']],
  West: [...DIVISIONS.Mountain, ...DIVISIONS.Pacific],
};
// States sharing a border (the Four Corners counted; DC with MD and VA).
const NEIGHBOURS = {
  AL: 'FL GA MS TN', AZ: 'CA CO NM NV UT', AR: 'LA MO MS OK TN TX', CA: 'AZ NV OR', CO: 'AZ KS NE NM OK UT WY',
  CT: 'MA NY RI', DE: 'MD NJ PA', DC: 'MD VA', FL: 'AL GA', GA: 'AL FL NC SC TN', ID: 'MT NV OR UT WA WY',
  IL: 'IN IA KY MO WI', IN: 'IL KY MI OH', IA: 'IL MN MO NE SD WI', KS: 'CO MO NE OK', KY: 'IL IN MO OH TN VA WV',
  LA: 'AR MS TX', ME: 'NH', MD: 'DE PA VA WV DC', MA: 'CT NH NY RI VT', MI: 'IN OH WI', MN: 'IA ND SD WI',
  MS: 'AL AR LA TN', MO: 'AR IL IA KS KY NE OK TN', MT: 'ID ND SD WY', NE: 'CO IA KS MO SD WY', NV: 'AZ CA ID OR UT',
  NH: 'ME MA VT', NJ: 'DE NY PA', NM: 'AZ CO OK TX UT', NY: 'CT MA NJ PA VT', NC: 'GA SC TN VA', ND: 'MN MT SD',
  OH: 'IN KY MI PA WV', OK: 'AR CO KS MO NM TX', OR: 'CA ID NV WA', PA: 'DE MD NJ NY OH WV', RI: 'CT MA', SC: 'GA NC',
  SD: 'IA MN MT NE ND WY', TN: 'AL AR GA KY MS MO NC VA', TX: 'AR LA NM OK', UT: 'AZ CO ID NV NM WY', VT: 'MA NH NY',
  VA: 'KY MD NC TN WV DC', WA: 'ID OR', WV: 'KY MD OH PA VA', WI: 'IL IA MI MN', WY: 'CO ID MT NE SD UT', AK: '', HI: '',
};
const STATES = Object.keys(NEIGHBOURS);
const near = (st) => (NEIGHBOURS[st] || '').split(' ').filter(Boolean);

// A region spec to its states (null: the whole country). One of:
//   region:South · division:South Atlantic · near:WV (it and its neighbours)
//   near2:WV (and theirs) · states:WV,OH,KY
function regionStates(spec) {
  const s = String(spec || '').trim();
  if (!s) return null;
  const [kind, rest = ''] = s.split(/:(.*)/s);
  const val = rest.trim();
  if (kind === 'region' && REGIONS[val]) return REGIONS[val].slice();
  if (kind === 'division' && DIVISIONS[val]) return DIVISIONS[val].slice();
  const st = val.toUpperCase();
  if (kind === 'near' && NEIGHBOURS[st] != null) return [st, ...near(st)];
  if (kind === 'near2' && NEIGHBOURS[st] != null) {
    const one = [st, ...near(st)];
    return [...new Set([...one, ...one.flatMap(near)])];
  }
  if (kind === 'states') {
    const list = [...new Set(val.toUpperCase().split(/[\s,]+/).filter((x) => NEIGHBOURS[x] != null))];
    return list.length ? list : null;
  }
  return null;
}

// ---- presets: the profile a search starts from ----
// planCodes: starts of the business code on the retirement-plan filings (broad:
// the forms often stop at five digits). pppCodes: the six-digit codes on the
// 2020-21 payroll loans, sharper, and a candidate source of their own for
// companies with no plan. keywords: what its own website must say.
const PRESETS = {
  water: {
    label: 'Water wells, pumps and treatment (like CITCO)',
    planCodes: ['2371', '4237'],
    pppCodes: ['237110', '423720', '221310'],
    // Water-specific words: a plain 'pump' or 'plumbing' is on every plumbing supply house's site.
    keywords: ['water well', 'well drilling', 'well pump', 'pump service', 'water treatment', 'water system', 'water softener', 'water filtration', 'geothermal', 'irrigation', 'wastewater'],
    staff: { addon: [15, 150], platform: [60, 400] },
  },
};

const clean = (s, max = 200) => (s == null ? '' : String(s).trim().slice(0, max));
const intIn = (v, lo, hi) => { const n = Number(v); return v !== '' && v != null && Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

function filters(sp) {
  const get = (k) => clean(sp.get(k));
  const preset = Object.prototype.hasOwnProperty.call(PRESETS, get('preset')) ? get('preset') : 'water';
  const P = PRESETS[preset];
  const buyer = get('buyer') === 'platform' ? 'platform' : 'addon';
  const codes = (v, re) => [...new Set(v.split(/[\s,]+/).filter((c) => re.test(c)))].slice(0, 12);
  const planCodes = get('planCodes') ? codes(get('planCodes'), /^\d{2,6}$/) : P.planCodes;
  const pppCodes = get('pppCodes') ? codes(get('pppCodes'), /^\d{6}$/) : P.pppCodes;
  const keywords = get('keywords') ? [...new Set(get('keywords').toLowerCase().split(',').map((k) => k.trim()).filter((k) => k.length >= 3 && k.length <= 40))].slice(0, 20) : P.keywords;
  const [lo, hi] = P.staff[buyer];
  const minStaff = intIn(get('minStaff'), 1, 100000) ?? lo;
  const maxStaff = intIn(get('maxStaff'), 1, 100000) ?? hi;
  const region = clean(get('region'), 120);
  return {
    preset, buyer, planCodes, pppCodes, keywords,
    minStaff: Math.min(minStaff, maxStaff), maxStaff: Math.max(minStaff, maxStaff),
    region, states: regionStates(region),
    home: /^(near2?):([A-Za-z]{2})$/.test(region) ? region.slice(-2).toUpperCase() : null,
    minYears: intIn(get('minYears'), 0, 20) ?? 5,
    pppOnly: get('pppOnly') !== '0',          // include companies known only from a payroll loan
    hideBacked: get('hideBacked') === '1',    // leave out those that look already bought or backed
    confirmedOnly: get('confirmed') === '1',  // only those whose own site bears the business out
    page: intIn(get('page'), 0, 100000) ?? 0,
  };
}

// The staff history's shape. A jump (the newest year a third above the typical
// year three to eight years before, and 15 people more) is how a buy-and-build
// shows: CITCO sat near 100 for a decade, then 138 and 180 once its new owner
// began buying. Few years on file is too short to say.
function pattern(series) {
  const ys = (series || []).filter((y) => y && y.staff != null && y.year >= 2000).sort((a, b) => a.year - b.year);
  if (ys.length < 4) return { kind: 'short', base: null, last: ys.length ? ys[ys.length - 1].staff : null };
  const last = ys[ys.length - 1];
  const window = ys.filter((y) => y.year >= last.year - 8 && y.year <= last.year - 3).map((y) => y.staff).sort((a, b) => a - b);
  if (window.length < 2) return { kind: 'short', base: null, last: last.staff };
  const base = window[Math.floor((window.length - 1) / 2)];
  if (base >= 10 && last.staff >= base * 1.35 && last.staff - base >= 15) return { kind: 'jump', base, last: last.staff };
  if (base >= 10 && last.staff <= base * 0.7) return { kind: 'shrinking', base, last: last.staff };
  return { kind: 'steady', base, last: last.staff };
}

// Words in a name that usually mean a holding or acquisition vehicle.
const VEHICLE = /\b(HOLDINGS?|HOLDCO|TOPCO|ACQUISITION|ACQUISITIONS|INTERMEDIATE|PARENT|BIDCO|PARTNERS\s+LP)\b/i;

// What its own pages say: each keyword found, by whole words.
function keywordHits(text, keywords) {
  const t = String(text || '').toLowerCase();
  if (!t) return [];
  // Whole words, a plural allowed ("water wells", "well pumps").
  return keywords.filter((k) => new RegExp('(^|[^a-z])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + 's?([^a-z]|$)').test(t));
}

// The fit: points for each part of the profile met, and every reason in words.
// c: { planCode, pppCodes[], staff, years, pattern, formd, vehicle, state, site:{status, hits[]} }
function fit(c, f) {
  const why = [], flags = [];
  let s = 0;
  const add = (n, w) => { s += n; why.push((n > 0 ? '+' : '') + n + ' ' + w); };
  if (c.planCode && f.planCodes.some((p) => String(c.planCode).startsWith(p))) add(15, 'industry code on its plan');
  if ((c.pppCodes || []).some((p) => f.pppCodes.includes(p))) add(20, 'exact industry code on its payroll loan');
  if (c.site && c.site.status === 'read') {
    const n = c.site.hits.length;
    if (n >= 2) add(30, 'its own site says ' + c.site.hits.slice(0, 3).join(', '));
    else if (n === 1) add(15, 'its own site says ' + c.site.hits[0]);
    else { add(-20, 'its own site says none of the keywords'); flags.push('site: other business'); }
  }
  if (c.staff != null && c.staff >= f.minStaff && c.staff <= f.maxStaff) add(10, 'size in range');
  if (c.years >= 10) add(10, c.years + ' years of plan filings');
  else if (c.years >= 5) add(5, c.years + ' years of plan filings');
  const p = c.pattern ? c.pattern.kind : 'short';
  if (p === 'steady') add(10, 'steady staff');
  if (p === 'jump') { flags.push('staff jumped: may already be bought or backed'); if (f.buyer === 'platform') add(-10, 'already growing by acquisition, likely'); }
  if (p === 'shrinking') { add(-5, 'staff shrinking'); flags.push('shrinking'); }
  if (f.buyer === 'platform' && c.growth != null && c.growth >= 0.1 && p !== 'jump') add(5, 'staff up ' + Math.round(c.growth * 100) + '% since 2019');
  if (c.formd) { add(-5, 'has raised outside money'); flags.push('raised outside money (Form D)'); }
  if (c.vehicle) { add(-5, 'holding-company name'); flags.push('holding-company name'); }
  if (f.home && c.state === f.home) add(5, 'in ' + f.home);
  return { score: s, why, flags, backed: p === 'jump' || !!c.formd || !!c.vehicle };
}

// The list as a spreadsheet: one row a company, the reasons in words.
function toCsv(rows) {
  const q = (v) => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ['Fit', 'Company', 'Trading as', 'City', 'State', 'From', 'Tax ID', 'Plan business code', 'Staff', 'Staff year', 'Staff 2019', 'Years of plans',
    'Pattern', 'Payroll loan codes', 'Payroll loan jobs', 'Website', 'Website status', 'Website says', 'Flags', 'Reasons'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([r.score, r.name, r.dba, r.city, r.state, r.source === 'plan' ? 'plan filings' : 'payroll loan only', r.ein ? r.ein.slice(0, 2) + '-' + r.ein.slice(2) : '',
      r.planCode, r.staff, r.staffYear, r.y2019, r.years, r.pattern ? r.pattern.kind : '', (r.pppCodes || []).join(' '), r.pppJobs,
      r.site && r.site.domain, r.site && r.site.status, r.site && r.site.hits.join('; '), (r.flags || []).join('; '), (r.why || []).join('; ')].map(q).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, DIVISIONS, REGIONS, NEIGHBOURS, STATES, near, regionStates, PRESETS, filters, pattern, VEHICLE, keywordHits, fit };
