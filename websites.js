// Company websites: the rules, pure (backlog 61, E17; loader website-load.js,
// notes docs/context/company-websites.md).
//
// NO SOURCE GIVES THE ADDRESS. The plan filings, Form D, the loan and contract
// files carry a name, a city, a state and sometimes a telephone, never a
// website. So the address is GUESSED from the name (pumpprocess.com,
// citcowater.com) and only kept when the site itself bears the company out:
// its name on the pages AND its city or the telephone already on file. A name
// alone is kept as "name only", a weaker match, and is not read.
//
// WHAT IS READ. A handful of the site's own pages (about, services,
// locations, team, careers, news, contact), never more than MAX_PAGES, only
// where the site's robots.txt allows. The model copies, never composes (the
// release reader's rule): every phrase, name and year it returns MUST BE FOUND
// IN THE PAGE TEXT, or it is dropped and named in the problems.
'use strict';

const MODEL = 'claude-haiku-5-5';
const MAX_PAGES = 6;                 // pages read a site besides the home page
const PAGE_CHARS = 15000;            // of each page's text, to the model
const MAX_CHARS = 60000;             // all pages together, to the model
const MAX_CANDIDATES = 16;           // addresses guessed a company
const UA_TOKEN = 'TickrLabResearch'; // the name robots.txt is read for

// Words that say nothing about which company it is.
const GENERIC = new Set(('THE OF AND A AN AT IN FOR ON BY TO INC INCORPORATED CORP CORPORATION CO COMPANY COMPANIES LLC LLP LP LTD PC PA PLLC PLC ' +
  'GROUP HOLDINGS HOLDING SERVICES SERVICE ENTERPRISES ENTERPRISE INDUSTRIES INTERNATIONAL USA US AMERICA AMERICAN NATIONAL ' +
  'SYSTEMS SOLUTIONS PARTNERS ASSOCIATES MANAGEMENT TRUST DBA').split(' '));

// A name as plain words: capitals, apostrophes closed up (O'MEARA is OMEARA),
// "&" dropped, every other mark a space; legal endings kept here and judged
// by GENERIC.
function words(name) {
  return String(name || '').toUpperCase().replace(/['’`]/g, '').replace(/&/g, ' ').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
}
const distinct = (name) => words(name).filter((w) => !GENERIC.has(w) && w.length >= 2);

// The addresses to try, best guess first, at most MAX_CANDIDATES: for the
// trading name (dba), the legal name, then every earlier name on file (a
// holding company now files the plan Continental Electrical once filed), the
// distinctive words joined, the first two, the first alone when it is long
// enough to be a brand, the whole name joined, and the two first words
// hyphenated; .com, then .net, and .org for a charity-shaped name or industry.
// A plan's own name ("... PROFIT SHARING PLAN") is not a company name.
const PLAN_NAME = /\b(PLAN|401 ?K|TRUST FUND|RETIREMENT|PENSION)\b/i;
function candidates(name, dba, naics, others) {
  const out = [];
  const add = (s) => { s = String(s || '').toLowerCase(); if (s.length >= 4 && s.length <= 40 && !out.includes(s)) out.push(s); };
  const orgLike = /^(61|62|71|81|92)/.test(String(naics || '')) || /\b(FOUNDATION|ASSOCIATION|SOCIETY|CHURCH|HOSPITAL|SCHOOL|UNIVERSITY|COLLEGE|COUNCIL|MINISTRIES)\b/.test(String(name || '').toUpperCase());
  const tlds = orgLike ? ['org', 'com', 'net'] : ['com', 'net'];
  const stems = [];
  for (const n of [dba, name, ...(others || [])]) {
    if (!n || PLAN_NAME.test(n)) continue;
    const d = distinct(n), w = words(n).filter((x) => !/^(INC|INCORPORATED|CORP|CORPORATION|CO|LLC|LLP|LP|LTD|PC|PA|PLLC|PLC|THE|DBA)$/.test(x));
    if (d.length) stems.push(d.join(''));
    if (d.length > 2) stems.push(d.slice(0, 2).join(''));
    if (w.length > 1) stems.push(w.join(''));
    if (d.length && d[0].length >= 6) stems.push(d[0]);
    if (d.length >= 2) stems.push(d[0] + '-' + d[1]);
  }
  const seen = [];
  for (const s of stems) if (!seen.includes(s)) seen.push(s);
  for (const tld of tlds) for (const s of seen) add(s + '.' + tld);
  // Order: every stem's first TLD before any second TLD, as built above.
  return out.slice(0, MAX_CANDIDATES);
}

// ---- robots.txt -------------------------------------------------------------------
// The group for our name if there is one, else the "*" group; the longest
// matching rule wins, Allow over Disallow at equal length; "*" and "$" in a
// path are honoured. No file (404) allows everything; a file we could not
// read (any other failure) allows nothing.
function robots(text) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && UA_TOKEN.toLowerCase().includes(a)));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  const rules = pick.flatMap((g) => g.rules).filter((r) => r.path !== '' || !r.allow);
  return function allowed(pathname) {
    let best = null;
    for (const r of rules) {
      if (r.path === '') continue;   // "Disallow:" with nothing allows everything
      // Everything literal but "*" (any run) and a closing "$" (the end).
      const end = /\$$/.test(r.path);
      const rx = new RegExp('^' + r.path.replace(/\$$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (end ? '$' : ''));
      if (!rx.test(pathname)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
    return best ? best.allow : true;
  };
}

// ---- the site's own pages ----------------------------------------------------------
const host0 = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
const KINDS = [
  ['about', /about|who-?we-?are|our-?(story|company|firm|history)|company|history|overview|mission/, 5],
  ['contact', /contact|locations?|offices?|find-?us|directions/, 4],
  ['services', /services|what-?we-?do|capabilit|solutions|products|practice|expertise|industries|markets/, 3],
  ['careers', /careers?|jobs|employment|join-?(us|our)|work-?with-?us|opportunit/, 3],
  ['team', /team|leadership|management|people|attorneys|lawyers|staff|executives|our-?board|professionals/, 3],
  ['news', /news|press|media|blog|announcements/, 1],
];
// The pages worth reading among the home page's links: same site only (www
// or not), no files, at most one a kind and MAX_PAGES in all, the likeliest
// first.
function pickPages(html, baseUrl) {
  const base = new URL(baseUrl);
  const found = new Map();
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1].trim(), base); } catch (_) { continue; }
    if (!/^https?:$/.test(u.protocol) || host0(u.hostname) !== host0(base.hostname)) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|ics)$/i.test(u.pathname)) continue;
    if (u.pathname === '/' || u.pathname === base.pathname) continue;
    const label = (u.pathname + ' ' + m[2].replace(/<[^>]+>/g, ' ')).toLowerCase().replace(/\s+/g, '-');
    for (const [kind, rx, score] of KINDS) {
      if (!rx.test(label)) continue;
      u.hash = '';
      const depth = u.pathname.split('/').filter(Boolean).length;
      const s = score - depth * 0.5;
      const prev = found.get(kind);
      if (!prev || s > prev.s || (s === prev.s && u.href.length < prev.url.length)) found.set(kind, { kind, url: u.href, s });
      break;
    }
  }
  return [...found.values()].sort((a, b) => b.s - a.s).slice(0, MAX_PAGES).map(({ kind, url }) => ({ kind, url }));
}

// ---- the deep crawl: the rest of a confirmed site, kept for later questions ----------
// The owner, 2026-11-10: "bring the entire website content that might be useful
// and store it so that any query can be run using AI later". Same site only,
// HTML only, robots.txt obeyed (the loader), at most MAX_DEEP pages, the most
// telling first: what it does, where, who, its history, its work, its jobs.
const MAX_DEEP = 40;
const MAX_DEPTH = 3;                 // path segments
const DEEP_KINDS = [
  ['about', /about|who-?we-?are|our-?(story|company|firm|history|family)|history|heritage|mission|values|overview/, 6],
  ['services', /services?|what-?we-?do|capabilit|solutions|products?|equipment|fleet|expertise|specialt|offerings?/, 5],
  ['locations', /locations?|branch|offices?|service-?area|areas-?served|where-?we/, 5],
  ['team', /team|leadership|management|people|owners?|executives|our-?board|staff|principals/, 5],
  ['work', /projects?|portfolio|case-?stud|our-?work|gallery|clients?|customers?|industries|markets|sectors|testimonials/, 4],
  ['careers', /careers?|jobs|employment|join-?(us|our)|work-?with-?us|opportunit|benefits|apply/, 4],
  ['credentials', /certif|licen|safety|quality|accredit|awards?|affiliat|associations?|partners?/, 3],
  ['news', /news|press|media|announcements|events|blog/, 2],
  ['contact', /contact|find-?us|directions/, 2],
];
const SKIP_PATH = /(^|\/)(wp-admin|wp-login|wp-json|login|log-?in|sign-?in|sign-?up|register|account|my-?account|cart|checkout|basket|search|feed|rss|xmlrpc|cdn-cgi|privacy|terms|cookie|legal|disclaimer|accessibility|sitemap|tag|tags|category|author|page\/\d+|\d{4}\/\d{2}\/\d{2})(\/|$|\.php)/i;
const FILE_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|rar|docx?|xlsx?|pptx?|csv|mp4|mov|mp3|wav|ics|xml|json|js|css|woff2?|ttf|eot)$/i;

// A link's address made comparable: no fragment, no tracking parameters, no
// trailing slash; null when it is not a page of this site worth fetching.
function pageUrl(href, base) {
  let u;
  try { u = new URL(String(href).trim(), base); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || host0(u.hostname) !== host0(base.hostname)) return null;
  if (FILE_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|_ga|ref$|source$)/i.test(k)) u.searchParams.delete(k);
  if ([...u.searchParams.keys()].length > 1) return null;   // filters, calendars and the like
  if (u.pathname.split('/').filter(Boolean).length > MAX_DEPTH) return null;
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u;
}
// How telling a page looks from its address and link text; 1 for any other page.
function pageScore(u, label) {
  const t = (u.pathname + ' ' + (label || '')).toLowerCase().replace(/\s+/g, '-');
  const depth = u.pathname.split('/').filter(Boolean).length;
  for (const [kind, rx, s] of DEEP_KINDS) if (rx.test(t)) return { kind, s: s - depth * 0.5 };
  return { kind: 'page', s: 1 - depth * 0.5 };
}
// Every link on a page worth a visit, scored.
function crawlLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const out = new Map();
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const u = pageUrl(m[1], base);
    if (!u || u.pathname === '/') continue;
    const { kind, s } = pageScore(u, m[2].replace(/<[^>]+>/g, ' '));
    const prev = out.get(u.href);
    if (!prev || s > prev.s) out.set(u.href, { url: u.href, kind, s });
  }
  return [...out.values()];
}
// The page addresses a sitemap lists (or the child sitemaps a sitemap index lists).
function sitemapUrls(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
}
// A page's own text without the menus, header and footer every page repeats
// (the home page keeps them: a company's city and telephone are often there).
function mainHtml(html) {
  return String(html || '').replace(/<(nav|header|footer|aside|script|style|noscript|svg|form)\b[\s\S]*?<\/\1>/gi, ' ');
}

// ---- is it the company's site -----------------------------------------------------
const flat = (s) => ' ' + String(s || '').toUpperCase().replace(/['’`]/g, '').replace(/&/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim() + ' ';
const PARKED = /domain (name )?(is |may be )?for sale|buy this domain|this domain (is|has been) (parked|registered)|parked (free|domain)|domain parking|hugedomains|sedo\.com|afternic|godaddy\.com\/domain|future home of|website coming soon|account suspended|default web site page|welcome to nginx|it works!/i;

// The name: every distinctive word of the legal or trading name on the
// pages, whole words (a long name may miss one, never its first). The place:
// the city on file, or the telephone on file (its ten digits written any of
// the usual ways). Name and place: "confirmed"; name alone: "name only".
function verify(text, co) {
  const t = flat(text);
  if (PARKED.test(String(text || ''))) return { verdict: 'parked', name: false, city: false, phone: false };
  const nameOk = (n) => {
    const d = distinct(n);
    if (!d.length) return false;
    const hit = d.filter((w) => t.includes(' ' + w + ' '));
    return d.length >= 3 ? hit.includes(d[0]) && hit.length >= d.length - 1 : hit.length === d.length;
  };
  const name = [co.dba, co.name, ...(co.others || [])].some((n) => n && !PLAN_NAME.test(n) && nameOk(n));
  const city = !!(co.city && t.includes(flat(co.city)));
  const want = String(co.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  let phone = false;
  if (want.length === 10) {
    for (const m of String(text || '').matchAll(/(?:\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})\b/g)) if (m[1] + m[2] + m[3] === want) { phone = true; break; }
  }
  return { verdict: name && (city || phone) ? 'confirmed' : name ? 'name only' : 'no match', name, city, phone };
}

// ---- what the model is asked for ---------------------------------------------------
const S = (d) => ({ type: 'string', description: d });
const ARR = (d, items) => ({ type: 'array', description: d, items });
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['is_company_site', 'what_they_do', 'founded_year', 'founded_quote', 'employees_quote', 'headquarters', 'headquarters_quote', 'services', 'markets', 'locations', 'leaders', 'clients', 'history', 'open_jobs', 'hiring_quote', 'hq_address', 'main_phone', 'general_email'],
  properties: {
    is_company_site: { type: 'boolean', description: 'True if these pages are the named company\'s own website (not a directory, a parked domain, or another business of a similar name).' },
    what_they_do: S('One or two sentences copied word for word from the pages that best say what the company does, at most 300 characters. Empty string if none.'),
    founded_year: S('The year the company was founded or established, as four digits, only if the pages state it. Empty string otherwise.'),
    founded_quote: S('The words on the pages stating the founding year, copied exactly, at most 160 characters. Empty string if none.'),
    employees_quote: S('Words copied exactly from the pages stating how many employees, staff or professionals the company has, at most 160 characters. Empty string if none.'),
    services: ARR('The services or products the company offers, each a short phrase copied exactly from the pages (at most 60 characters), at most 12.', S('A phrase as printed')),
    markets: ARR('Industries, sectors or kinds of customer it serves, each copied exactly as printed (at most 60 characters), at most 10.', S('A phrase as printed')),
    locations: ARR('Each office, branch or facility location named, as printed (e.g. "Newport Beach, CA"), at most 30.', S('A place as printed')),
    // HEADQUARTERS AND KEY PEOPLE (2026-11-11, the owner: "also capture head
    // quarter and key employees details"). The headquarters only where the
    // pages call a place that (headquarters, head office, main office, based
    // in), the place inside its own quote; key people widened from the top
    // team to the managers a buyer would meet, each with their own office
    // where the page gives one. The key stays `leaders`.
    headquarters: S('The city and state (or country) the pages name as the company\'s headquarters, head office, main office or home base, as printed (e.g. "Huntington, WV"). Empty string if the pages do not say which place that is.'),
    headquarters_quote: S('The words on the pages stating where the headquarters is, copied exactly, at most 200 characters. Empty string if none.'),
    leaders: ARR('The company\'s key people named on the pages: owners, executives, directors, partners, and managers with a stated role (branch, regional, plant, sales, operations or department heads), at most 40.', { type: 'object', additionalProperties: false, required: ['name', 'role', 'location'],
      properties: { name: S('The person\'s name as printed'), role: S('Their title as printed, or empty string'), location: S('The office, branch or city the page ties them to, as printed, or empty string') } }),
    clients: ARR('Customers or clients the pages name, as printed, at most 15.', S('A name as printed')),
    history: ARR('Dated events the pages state (founded, acquired, merged, opened, renamed), at most 10.', { type: 'object', additionalProperties: false, required: ['year', 'quote'],
      properties: { year: S('Four-digit year'), quote: S('The words stating it, copied exactly, at most 200 characters') } }),
    open_jobs: S('The number of open positions if the pages print a count or list them (count the listed jobs only when they are listed one by one). Empty string if not shown.'),
    hiring_quote: S('Words copied exactly from the pages about hiring or open positions, at most 160 characters. Empty string if none.'),
    // THE COMPANY'S OWN CONTACT DETAILS (2026-11-11, the owner: "Yes add the
    // company level contact details"): what the company prints to be reached,
    // never a person's. People stay a name, a title and an office.
    hq_address: S('The street address of the headquarters or main office as printed on the pages (street, city, state, ZIP), at most 160 characters. Never a person\'s home address. Empty string if none.'),
    main_phone: S('The company\'s main or office telephone number as printed (the general line, not a named person\'s direct line). Empty string if none.'),
    general_email: S('The company\'s general email address as printed, only a shared mailbox such as info@, sales@ or contact@, never an address belonging to a named person. Empty string if none.'),
  } };
const SYSTEM = [
  'You read pages from a company\'s website and fill the fields asked for.',
  'Copy every phrase, name and year exactly as it appears on the pages; never paraphrase, summarise, translate or infer. If something is not stated, give an empty string or an empty list.',
  'Report only what the pages state about this company; do not judge it.',
  'Do not include any person\'s email address, telephone number or home address anywhere; the company\'s own address, main telephone and shared mailbox go only in their three fields.',
].join(' ');

// The pages as one text for the model, each under its address.
function pagesText(pages) {
  let out = '';
  for (const p of pages) {
    const chunk = '=== ' + p.url + ' ===\n' + String(p.text || '').slice(0, PAGE_CHARS) + '\n\n';
    if (out.length + chunk.length > MAX_CHARS) break;
    out += chunk;
  }
  return out;
}

function request(co, pages, model) {
  return { model: model || MODEL, max_tokens: 4000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `<company>${co.name}${co.dba ? ' (trading as ' + co.dba + ')' : ''}, ${[co.city, co.state].filter(Boolean).join(', ')}</company>\n<pages>\n${pagesText(pages)}</pages>` }] };
}

// ---- checks ----------------------------------------------------------------------------
const loose = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/;

// The company's own contact details, each kept only when it is on the pages
// and is the company's, not a person's: an address with a ZIP or a state, a
// telephone with ten digits not printed beside a named person, and an email
// address whose mailbox is a shared one (info@, sales@), by an exact list.
const ROLE_BOX = new Set(['info', 'information', 'sales', 'contact', 'contactus', 'hello', 'office', 'mail', 'admin', 'inquiries', 'inquiry', 'enquiries', 'enquiry', 'service', 'services', 'support', 'customerservice', 'customercare', 'cs', 'orders', 'order', 'quotes', 'quote', 'rfq', 'marketing', 'help', 'general', 'reception', 'frontdesk', 'careers', 'jobs', 'hr', 'recruiting', 'billing', 'accounting', 'accounts', 'ar', 'ap', 'estimating', 'bids', 'media', 'press', 'pr', 'team', 'main', 'operations', 'dispatch', 'parts']);
const ZIP_OR_STATE = /\b\d{5}(-\d{4})?\b|,\s*[A-Z]{2}\b|\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
function contact(A, text, leaders, problems) {
  const low = loose(text);
  const onPages = (s) => low.includes(loose(s));
  const nameParts = new Set();
  for (const l of leaders) for (const w of String(l.name).toLowerCase().split(/[^a-z]+/)) if (w.length >= 3) nameParts.add(w);
  const out = { hq_address: null, main_phone: null, general_email: null };

  const addr = String(A.hq_address || '').trim();
  if (addr) {
    if (addr.length > 200 || EMAIL.test(addr) || PHONE.test(addr)) problems.push('hq_address too long or holds other details');
    else if (!onPages(addr)) problems.push(`hq_address "${addr.slice(0, 60)}" is not on the pages`);
    else if (!/\d/.test(addr) || !ZIP_OR_STATE.test(addr)) problems.push(`hq_address "${addr.slice(0, 60)}" is not a street address`);
    else out.hq_address = addr;
  }

  const tel = String(A.main_phone || '').trim();
  if (tel) {
    const d = tel.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const at = low.indexOf(loose(tel));
    const before = at >= 0 ? low.slice(Math.max(0, at - 60), at) : '';
    if (d.length !== 10 || /^[01]/.test(d) || tel.length > 30) problems.push(`main_phone "${tel.slice(0, 30)}" is not a telephone number`);
    else if (at < 0) problems.push(`main_phone "${tel.slice(0, 30)}" is not on the pages`);
    else if ([...nameParts].some((w) => new RegExp('\\b' + w + '\\b').test(before))) problems.push('main_phone is printed beside a named person; dropped');
    else out.main_phone = tel;
  }

  const em = String(A.general_email || '').trim().toLowerCase();
  if (em) {
    const m = /^([a-z0-9._%+-]+)@([a-z0-9-]+(\.[a-z0-9-]+)+)$/.exec(em);
    const box = m ? m[1].replace(/[._-]/g, '') : '';
    if (!m) problems.push(`general_email "${em.slice(0, 60)}" is not an email address`);
    else if (!onPages(em)) problems.push(`general_email "${em.slice(0, 60)}" is not on the pages`);
    else if (!ROLE_BOX.has(box)) problems.push('general_email is not a shared mailbox; dropped');
    else out.general_email = em;
  }
  return out;
}

// The answer, checked, as { read, problems }: a phrase not on the pages is
// dropped and named; a year must be four digits and stand in its own quote;
// an email address or telephone number in any phrase drops the phrase.
function check(ans, text) {
  const A = ans || {};
  const low = loose(text);
  const problems = [];
  const on = (label, v, max) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (s.length > (max || 400)) { problems.push(`${label} too long`); return null; }
    if (EMAIL.test(s) || PHONE.test(s)) { problems.push(`${label} holds contact details; dropped`); return null; }
    if (!low.includes(loose(s))) { problems.push(`${label} "${s.slice(0, 60)}" is not on the pages`); return null; }
    return s;
  };
  const list = (label, arr, max, cap) => { const out = []; for (const v of (Array.isArray(arr) ? arr : []).slice(0, cap)) { const s = on(label, v, max); if (s && !out.includes(s)) out.push(s); } return out; };
  const year = (y, quote) => (/^(1[89]\d\d|20\d\d)$/.test(String(y || '').trim()) && quote && quote.includes(String(y).trim()) ? Number(y) : null);
  const foundedQuote = on('founded_quote', A.founded_quote, 200);
  const founded = year(A.founded_year, foundedQuote);
  if (String(A.founded_year || '').trim() && founded == null) problems.push(`founded_year "${A.founded_year}" is not in its quote`);
  const leaders = [];
  for (const l of (Array.isArray(A.leaders) ? A.leaders : []).slice(0, 40)) {
    const name = on('leader', l && l.name, 80);
    if (!name || words(name).length < 2 || leaders.some((x) => x.name === name)) continue;
    const p = { name, role: on('role', l.role, 120) };
    const where = on('leader location', l.location, 80);
    if (where) p.location = where;
    leaders.push(p);
  }
  // The headquarters must sit inside the quote that states it, and the quote
  // must say head office in some form, or neither is kept.
  const hqQuote = on('headquarters_quote', A.headquarters_quote, 240);
  const hqRaw = on('headquarters', A.headquarters, 80);
  const HQ_WORDS = /head ?quarter|\bhq\b|head office|main office|corporate office|home office|based in|home base/i;
  let headquarters = null;
  if (hqRaw && hqQuote && loose(hqQuote).includes(loose(hqRaw)) && HQ_WORDS.test(hqQuote)) headquarters = hqRaw;
  else if (hqRaw) problems.push(`headquarters "${hqRaw.slice(0, 60)}" is not stated as the head office`);
  const history = [];
  for (const h of (Array.isArray(A.history) ? A.history : []).slice(0, 10)) {
    const q = on('history', h && h.quote, 240);
    const y = year(h && h.year, q);
    if (q && y) history.push({ year: y, quote: q });
  }
  const jobsRaw = String(A.open_jobs || '').trim();
  const read = {
    is_company_site: A.is_company_site === true,
    what_they_do: on('what_they_do', A.what_they_do, 400),
    founded, founded_quote: founded ? foundedQuote : null,
    employees_quote: on('employees_quote', A.employees_quote, 200),
    headquarters, headquarters_quote: headquarters ? hqQuote : null,
    services: list('service', A.services, 80, 12),
    markets: list('market', A.markets, 80, 10),
    locations: list('location', A.locations, 80, 30),
    leaders,
    clients: list('client', A.clients, 80, 15),
    history,
    open_jobs: /^\d{1,4}$/.test(jobsRaw) ? Number(jobsRaw) : null,
    hiring_quote: on('hiring_quote', A.hiring_quote, 200),
    ...contact(A, text, leaders, problems),
  };
  return { read, problems };
}

module.exports = { MAX_DEEP, MAX_DEPTH, DEEP_KINDS, pageUrl, pageScore, crawlLinks, sitemapUrls, mainHtml, MODEL, MAX_PAGES, PAGE_CHARS, MAX_CHARS, MAX_CANDIDATES, UA_TOKEN, GENERIC, words, distinct, candidates, robots, pickPages, verify, PARKED, SCHEMA, SYSTEM, pagesText, request, check };
