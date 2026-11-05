// selloff.js: the release test, the reaction day, the two screens and the
// watchlist. Pure; no server.   node selloff-test.js
'use strict';
const S = require('./selloff.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const near = (a, b) => a != null && Math.abs(a - b) < 1e-9;

// ---- The release test.
const rel = (o) => Object.assign({ isResults: 1, filed: '2026-10-28', revenue: 120, revenuePrior: 100, netIncome: 5, guideKind: 'revenue_range', guideChange: null }, o);
ok(S.passesRelease(rel()), 'revenue +20%, a profit and guidance pass');
ok(S.passesRelease(rel({ revenue: 110 })), 'exactly +10% passes');
ok(!S.passesRelease(rel({ revenue: 109.9 })), 'just under +10% does not');
ok(!S.passesRelease(rel({ netIncome: 0 })), 'a zero profit does not');
ok(!S.passesRelease(rel({ netIncome: null })), 'no net income is not a profit');
ok(!S.passesRelease(rel({ revenuePrior: null })), 'no prior revenue is no growth');
ok(!S.passesRelease(rel({ guideKind: null })), 'no guidance does not');
ok(S.passesRelease(rel({ guideKind: null, guideChange: 'raised' })), 'a change word is guidance');
ok(!S.passesRelease(rel({ guideChange: 'withdrawn' })), 'withdrawn guidance is no guidance');
ok(!S.passesRelease(rel({ isResults: 0 })), 'not a results release');
ok(S.guidanceOf(rel({ guideChange: 'Raised' })) === 'raised' && S.guidanceOf(rel()) === 'given' && S.guidanceOf(rel({ guideKind: null })) === null, 'guidance keys');

// ---- The reaction day.
const bars = (pairs) => pairs.map(([d, close]) => ({ datetime: d, close }));
// Pre-market report: the filing day carries the fall.
let rx = S.reaction(bars([['2026-10-27', 100], ['2026-10-28', 88], ['2026-10-29', 90]]), '2026-10-28');
ok(near(rx.fday, -12) && near(rx.worst, -12) && rx.base === 88 && rx.on === '2026-10-28', 'filing-day fall is the reaction', rx);
// After-hours report: the day after carries it.
rx = S.reaction(bars([['2026-10-29', 90], ['2026-10-28', 100], ['2026-10-27', 99]]), '2026-10-28');
ok(near(rx.day, -10) && near(rx.worst, -10) && rx.base === 90 && rx.on === '2026-10-29', 'day-after fall is the reaction, bars in any order', rx);
// Filed on a Saturday: last close before to first close after.
rx = S.reaction(bars([['2026-10-30', 100], ['2026-11-02', 93]]), '2026-10-31');
ok(rx.fday === null && near(rx.worst, -7) && rx.on === '2026-11-02', 'a non-trading filing day', rx);
// Filed today, no next close yet: the filing day alone.
rx = S.reaction(bars([['2026-11-02', 100], ['2026-11-03', 92]]), '2026-11-03');
ok(near(rx.worst, -8) && rx.day === null, 'no next close yet', rx);
ok(S.reaction(bars([['2026-11-03', 92]]), '2026-11-03') === null, 'one bar alone is no move');
ok(S.reaction([], '2026-11-03') === null && S.reaction(null, '2026-11-03') === null, 'no bars');

// ---- The screens.
const row = (sym, o) => Object.assign({ symbol: sym, shortName: sym + ' Inc', sector: 'Technology', price: 85, pctFromHigh: -30, rsi: 31, trailingPe: 20, forwardPe: 15,
  valueVsIndustry: 'In line', revenueGrowthYoY: 22, profitMargin: 12, growthProfile: 'Growing, profitable' }, o);
const rows = [
  row('TFALL'),                                                   // tech, fell 12% on the filing day
  row('TSOFT'),                                                   // tech, fell 4%: not enough
  row('NFALL', { sector: 'Industrials' }),                        // non-tech, fell 6%
  row('NDEAR', { sector: 'Industrials', valueVsIndustry: 'Above industry' }), // fell, but above industry
  row('NTHIN', { sector: 'Industrials', growthProfile: 'Growing, thin margin' }), // fell, wrong words
  row('TOLD'),                                                    // tech, fell, but filed outside the window
  row('TETF', { instrumentType: 'ETF' }),
  row('TLOSS', { trailingPe: -5, forwardPe: null, pctFromHigh: null }),
];
const rels = {
  TFALL: rel(), TSOFT: rel(), NFALL: rel(), NDEAR: rel(), NTHIN: rel(), TOLD: rel({ filed: '2026-08-01' }), TETF: rel(), TLOSS: rel(),
};
const fall = (pct) => bars([['2026-10-27', 100], ['2026-10-28', 100 + pct], ['2026-10-29', 100 + pct]]);
const barsBy = { TFALL: fall(-12), TSOFT: fall(-4), NFALL: fall(-6), NDEAR: fall(-9), NTHIN: fall(-9), TOLD: fall(-20), TETF: fall(-20), TLOSS: fall(-8) };
const today = '2026-11-03';
const cand = S.candidates('tech', rows, rels, 45, today);
ok(JSON.stringify(cand) === JSON.stringify(['TFALL', 'TSOFT', 'TLOSS']), 'tech candidates: in window, no ETF', cand);
ok(JSON.stringify(S.candidates('nontech', rows, rels, 45, today)) === JSON.stringify(['NFALL']), 'non-tech candidates need both words');
ok(S.candidates('tech', rows, rels, 100, today).includes('TOLD'), 'a wider window takes the older release');
const tech = S.screen('tech', rows, rels, barsBy, 45, today);
ok(tech.map((r) => r.symbol).join() === 'TFALL,TLOSS', 'tech screen: -7% or worse, worst first', tech.map((r) => r.symbol));
const t0 = tech[0];
ok(near(t0.reaction, -12) && near(t0.since, (85 / 88 - 1) * 100) && t0.filed === '2026-10-28' && t0.guidance === 'given', 'the row carries the reaction, since and release', t0);
ok(t0.fromHigh === -30 && t0.rsi === 31 && t0.pe === 20 && t0.fpe === 15 && t0.valueVsIndustry === 'In line' && t0.revGrowth === 22 && t0.profitMargin === 12 && t0.growthProfile === 'Growing, profitable', 'the ten readings come off the served row');
const tl = tech[1];
ok(tl.pe === null && tl.fpe === null && tl.fromHigh === null, 'a negative multiple and a blank stay blank, never 0', tl);
const nt = S.screen('nontech', rows, rels, barsBy, 45, today);
ok(nt.map((r) => r.symbol).join() === 'NFALL', 'non-tech screen: -5% or worse with the words', nt.map((r) => r.symbol));
ok(S.screen('tech', rows, rels, {}, 45, today).length === 0, 'no bars, no row');

// ---- The watchlist.
const w = S.watch([row('MU', { lastEarningsDate: '2026-09-23' }), row('ASML', { lastEarningsDate: '2026-10-15T00:00:00' })], { MU: rel({ filed: '2026-09-24' }) });
ok(w.length === 25 && w[0].symbol === 'MU' && w[0].group === 'Memory' && w[24].symbol === 'TSM' && w[24].group === 'Compute', '25 names in their groups; no market caps, so A to Z within a group', [w[0], w[24]].map((r) => r.symbol));
ok(w.every((r) => r.from === 'list'), 'with no themes, every name is from the list');
ok(w[0].filed === '2026-09-24', 'the release date when there is one');
const asml = w.find((r) => r.symbol === 'ASML');
ok(asml.filed === '2026-10-15' && asml.guidance === null, 'no release: the provider report date, no guidance', asml);
ok(w.find((r) => r.symbol === 'NVDA').missing === true, 'a name not on the screener is listed as missing');

// ---- The owner's AI themes joined in, each company once.
const th = (sym, themes, o) => row(sym, Object.assign({ portfolios: themes }, o));
const aw = S.watch([
  th('MU', ['Memory'], { marketCap: 4e11 }),                                                       // on the list: stays in its list group
  th('SKHY', ['Memory'], { marketCap: 9e11 }),
  th('VEND', ['AI - Optical Networking'], { industry: 'Semiconductor Equipment & Materials', marketCap: 5e9 }),
  th('GFS', ['AI - Optical Networking'], { marketCap: 2e10 }),
  th('ALAB', ['Cloud Infra, Hardware & Networking', 'AI - Optical Networking'], { marketCap: 3e10 }),
  th('CRWV', ['Cloud Infra, Hardware & Networking', 'Neoclouds'], { marketCap: 5e10 }),
  th('DELL', ['Cloud Infra, Hardware & Networking'], { marketCap: 1e11 }),
  th('DRAM', ['Memory', 'ETFs'], { instrumentType: 'ETF', marketCap: 1e9 }),
  th('QBTS', ['Quantum Computing Pure Play'], { marketCap: 1e10 }),
  th('NOCAP', ['AI - Power Generation'], { marketCap: null }),
  th('BIGPW', ['AI - Power Generation'], { marketCap: 9e10 }),
], {});
const at = (s) => aw.find((r) => r.symbol === s);
ok(aw.length === 25 + 8, 'the 25 and eight theme names; the ETF and the quantum name left out', aw.length);
ok(new Set(aw.map((r) => r.symbol)).size === aw.length, 'each company once');
ok(at('MU').group === 'Memory' && at('MU').from === 'list' && at('MU').themes.join() === 'Memory', 'a list name keeps its group, and its themes are named');
ok(at('SKHY').group === 'Memory' && at('SKHY').from === 'Memory', 'a theme name joins the matching group');
ok(at('VEND').group === 'Semicap' && at('GFS').group === 'Compute', 'equipment makers go to Semicap, the foundries to Compute');
ok(at('ALAB').group === 'Networking' && at('CRWV').group === 'Neoclouds' && at('DELL').group === 'Servers & data centres', 'two themes: the first in order wins');
ok(!at('DRAM') && !at('QBTS'), 'no ETF, no theme outside the AI list');
const mem = aw.filter((r) => r.group === 'Memory').map((r) => r.symbol);
ok(mem[0] === 'SKHY' && mem[1] === 'MU', 'largest market value first within a group', mem);
const pw = aw.filter((r) => r.group === 'Power').map((r) => r.symbol);
ok(pw[0] === 'BIGPW' && pw.indexOf('NOCAP') > pw.indexOf('BIGPW'), 'a blank market value sorts after a known one', pw);
const order = [...new Set(aw.map((r) => r.group))];
ok(JSON.stringify(order) === JSON.stringify(S.GROUP_ORDER.filter((g) => g !== 'Hyperscalers')), 'groups in their order (no hyperscaler in this fixture)', order);

// ---- The Excel sheets.
const wb = S.workbookSheets({ at: '2026-11-03T19:17:51Z', days: 45, drop: S.DROP, minGrowth: 10, watchSource: 'x',
  views: { tech: [Object.assign({}, t0, { cap: 2.1e12, sector: 'Technology' })], nontech: [], watch: [Object.assign({}, aw.find((r) => r.symbol === 'SKHY')), { symbol: 'GONE', group: 'Compute', from: 'list', themes: [], missing: true }] } });
ok(wb.map((s) => s.name).join() === 'Tech,Non-tech,AI watchlist,Bouncing off the lows,Quality on a pullback,Dividend growers, lows,Insider buying clusters,Strong 3 years, quiet now,About', 'nine sheets: a tab each, and About');
const tsh = wb[0], hcol = (sh, h) => sh.cols.findIndex((c) => c[0] === h);
ok(tsh.rows.length === 1 && tsh.rows[0].length === tsh.cols.length, 'tech: one row, a cell under every heading');
ok(tsh.rows[0][hcol(tsh, 'Market cap ($B)')] === 2100 && tsh.rows[0][hcol(tsh, 'Reaction (%)')] === -12 && tsh.rows[0][hcol(tsh, 'RSI (14-day)')] === 31, 'figures are numbers: $B, percent, RSI', tsh.rows[0]);
ok(tsh.cols[hcol(tsh, 'Reaction (%)')][2] === true && tsh.cols[hcol(tsh, 'Company')][2] === false, 'numeric columns are marked so');
ok(tsh.rows[0][hcol(tsh, 'Guidance')] === 'Given', 'guidance in words');
ok(wb[1].rows.length === 0, 'an empty screen is an empty sheet, headings kept');
const wsh = wb[2];
const sk = wsh.rows.find((r) => r[0] === 'SKHY');
ok(sk[hcol(wsh, 'Group')] === 'Memory' && sk[hcol(wsh, 'Source')] === 'Memory' && sk[hcol(wsh, 'AI themes')] === 'Memory', 'watchlist: group, source and themes', sk);
ok(sk[hcol(wsh, 'P/E (trailing)')] === 20 && sk[hcol(wsh, 'Reaction (%)')] === undefined && hcol(wsh, 'Reaction (%)') === -1, 'the watchlist has no reaction columns');
const gone = wsh.rows.find((r) => r[0] === 'GONE');
ok(gone[hcol(wsh, 'Company')] === 'Not on the screener' && gone[hcol(wsh, 'Group')] === 'Compute' && gone[hcol(wsh, 'RSI (14-day)')] === null, 'a name not on the screener: said so, figures empty', gone);
const blank = S.workbookSheets({ views: { tech: [S.fields({ symbol: 'B', rsi: null, marketCap: '' }, null)] } })[0].rows[0];
ok(blank.slice(2).filter((x) => x === 0).length === 0, 'a blank figure is empty, never 0', blank);
ok(/Nov 3, 2026/.test(wb[8].rows[0][1]) && /Eastern$/.test(wb[8].rows[0][1]), 'About: prices as of, in Eastern time', wb[8].rows[0]);

// ---- Bouncing off the lows: the rows the screen picked, shaped, in its order.
const bn = S.bounce([row('LOW1', { range52Pos: 3, twoWeekPct: 1.7, oneMonthPct: 7.3 }), row('LOW2', { range52Pos: 9, twoWeekPct: null, oneMonthPct: 4.6 }), { symbol: 'BAD', error: 'x' }], { LOW1: rel({ filed: '2026-10-28' }) });
ok(bn.map((r) => r.symbol).join() === 'LOW1,LOW2', 'the picked rows in their order; an error row dropped');
ok(bn[0].range52 === 3 && bn[0].w2 === 1.7 && bn[0].m1 === 7.3 && bn[0].filed === '2026-10-28' && bn[0].guidance === 'given', 'the screen’s readings and the release', bn[0]);
ok(bn[1].w2 === null, 'a missing move stays blank');
const wbB = S.workbookSheets({ bounceScreen: { description: 'Low in the range.', rule: '52W range ..30' }, views: { bounce: bn } });
const bsh = wbB[3];
ok(bsh.rows.length === 2 && bsh.rows[0][bsh.cols.findIndex((c) => /52-week range/.test(c[0]))] === 3 && bsh.rows[1][bsh.cols.findIndex((c) => c[0] === '2 weeks (%)')] === null, 'Excel: the bounce sheet, range and moves as numbers, blanks empty');
ok(wbB[8].rows.some((r) => r[0] === 'Bouncing off the lows' && r[1].includes('Low in the range. (52W range ..30)')), 'About explains the screen with its rule');

// Today: the latest session's move, blank when the row has none.
ok(S.fields({ symbol: 'X', todayPct: -2.345 }, null).today === -2.345 && [null, '', undefined].every((v) => S.fields({ symbol: 'X', todayPct: v }, null).today === null), 'today carried; a missing move is blank, not zero');
const wbT = S.workbookSheets({ views: { tech: [S.fields({ symbol: 'X', todayPct: -2.345 }, null)] } })[0];
ok(wbT.rows[0][wbT.cols.findIndex((c) => c[0] === 'Today (%)')] === -2.35, 'Excel: Today (%) as a number, two decimals');

// Market cap: carried as a number with its currency; a blank stays blank, never 0.
const cap1 = S.fields({ symbol: 'X', marketCap: 2.1e12, currency: 'USD' }, null);
ok(cap1.cap === 2.1e12 && cap1.currency === 'USD', 'market cap and currency are carried');
ok([null, '', undefined].every((v) => S.fields({ symbol: 'X', marketCap: v }, null).cap === null), 'a missing market cap is blank, not zero');

// Article tone: the stored Tone 7D rows laid onto every view's rows; nothing read is null, never 0.
const tv = { tech: [S.fields({ symbol: 'A' }, null)], watch: [S.fields({ symbol: 'B' }, null), { symbol: 'GONE', missing: true, group: 'Compute' }], bounce: [S.fields({ symbol: 'C' }, null)] };
S.withTone(tv, { A: [-0.412, 9, 1, 6], B: [0.3, 4, 3, 0], GONE: [0.5, 1, 1, 0] });
ok(tv.tech[0].tone && tv.tech[0].tone.avg === -0.412 && tv.tech[0].tone.n === 9 && tv.tech[0].tone.pos === 1 && tv.tech[0].tone.neg === 6, 'tone: average, read, positive, negative', tv.tech[0].tone);
ok(tv.watch[0].tone.avg === 0.3 && tv.bounce[0].tone === null, 'every view gets it; a company with nothing read is null');
ok(!('tone' in tv.watch[1]), 'a name not on the screener is left alone');
S.withTone(tv, null);
ok(tv.tech[0].tone === null, 'no stored figure: every tone blank');
S.withTone(tv, { A: [-0.412, 9, 1, 6] });
const wbTone = S.workbookSheets({ views: tv })[0];
const tci = wbTone.cols.findIndex((c) => /^Tone 7D/.test(c[0]));
ok(tci === wbTone.cols.length - 2 && wbTone.rows[0][tci] === -0.41 && wbTone.rows[0][tci + 1] === 9, 'Excel: Tone 7D and articles read as the last two columns', wbTone.rows[0].slice(-2));
ok(S.workbookSheets({ views: tv })[3].rows[0].slice(-2).every((x) => x === null), 'Excel: no tone, both cells empty');

// ---- The three long-run and insider tabs (2026-11-05).
const lr = (sym, o) => Object.assign({ symbol: sym, name: sym + ' Inc', sector: 'Industrials', price: 50 }, o);
const qRows = [
  lr('Q1', { crChecks: 5, fScore: 7, pctFromHigh: -22, crNow: 'grow' }),
  lr('Q2', { crChecks: 4, fScore: 6, pctFromHigh: -10, crNow: null }),          // both edges, no now-reading
  lr('Q3', { crChecks: 4, fScore: 6, pctFromHigh: -30 }),                       // the deep edge
  lr('QX1', { crChecks: 3, fScore: 9, pctFromHigh: -20 }),                      // record too short
  lr('QX2', { crChecks: 5, fScore: 5, pctFromHigh: -20 }),                      // F-score too low
  lr('QX3', { crChecks: 5, fScore: 8, pctFromHigh: -9.9 }),                     // not pulled back enough
  lr('QX4', { crChecks: 5, fScore: 8, pctFromHigh: -30.1 }),                    // fell too far
  lr('QX5', { crChecks: 5, fScore: 8, pctFromHigh: -20, crNow: 'decline' }),    // quarters turned down
  lr('QX6', { crChecks: null, fScore: 8, pctFromHigh: -20 }),                   // a blank never passes
  lr('QX7', { crChecks: 5, fScore: 8, pctFromHigh: null }),
  lr('QX8', { crChecks: 5, fScore: 8, pctFromHigh: -20, instrumentType: 'ETF' }),
  lr('QX9', { crChecks: 5, fScore: 8, pctFromHigh: -20, error: 'x' }),
];
const qv = S.quality(qRows, { Q1: rel({ filed: '2026-10-21' }) });
ok(qv.map((r) => r.symbol).join() === 'Q3,Q1,Q2', 'quality: the three that pass, furthest under the high first', qv.map((r) => r.symbol));
ok(qv[1].crChecks === 5 && qv[1].fScore === 7 && qv[1].crNow === 'grow' && qv[1].filed === '2026-10-21', 'quality: readings carried, with the release', qv[1]);
const dRows = [
  lr('D1', { divStreak: 12, divSince: '2014', divGrowth5y: 6.5, divYield: 2.4, range52Pos: 25 }),
  lr('D2', { divStreak: 5, range52Pos: 3 }),
  lr('DX1', { divStreak: 4, range52Pos: 3 }),
  lr('DX2', { divStreak: 20, range52Pos: 25.5 }),
  lr('DX3', { divStreak: 0, range52Pos: 1 }),
  lr('DX4', { divStreak: null, range52Pos: 1 }),
  lr('DX5', { divStreak: 8, range52Pos: null }),
];
const dv2 = S.divlow(dRows, {});
ok(dv2.map((r) => r.symbol).join() === 'D2,D1', 'dividends: 5 years or more and at most 25 in the range, lowest first', dv2.map((r) => r.symbol));
ok(dv2[1].divStreak === 12 && dv2[1].divSince === '2014' && dv2[1].divGrowth5y === 6.5 && dv2[1].divYield === 2.4, 'dividends: streak, start, growth and yield carried', dv2[1]);
const iRows = [
  lr('I1', { insiderBuyers: 3, insiderSellers: 0, insiderNet: 0.012 }),
  lr('I2', { insiderBuyers: 7, insiderSellers: 1, insiderNet: 0.004 }),
  lr('I3', { insiderBuyers: 3, insiderSellers: 2, insiderNet: 0.5 }),
  lr('IX1', { insiderBuyers: 2, insiderSellers: 0, insiderNet: 1 }),              // two is not a cluster
  lr('IX2', { insiderBuyers: 30, insiderSellers: 0, insiderNet: 0 }),             // token buys round to nothing
  lr('IX3', { insiderBuyers: 4, insiderSellers: 6, insiderNet: -0.2 }),           // selling outweighed
  lr('IX4', { insiderBuyers: 5, insiderSellers: 0, insiderNet: null }),           // no net reading
  lr('IX5', { insiderBuyers: null, insiderNet: 0.3 }),
];
const iv = S.insider(iRows, {});
ok(iv.map((r) => r.symbol).join() === 'I2,I3,I1', 'insiders: 3 or more buyers and net buying; most buyers, then the larger net', iv.map((r) => r.symbol));
ok(iv[0].insBuyers === 7 && iv[0].insSellers === 1 && iv[0].insNet === 0.004, 'insiders: counts and net carried', iv[0]);
const rules = S.ideaRules(90);
ok(/4 or more of its 5 checks/.test(rules.quality) && /F-score 6/.test(rules.quality) && /10% to 30%/.test(rules.quality) && /Declining/.test(rules.quality), 'rule words: quality', rules.quality);
ok(/5 or more years/.test(rules.divlow) && /25 or lower/.test(rules.divlow) && /3 or more insiders/.test(rules.insider) && /90 days/.test(rules.insider), 'rule words: dividends and insiders');
const wbI = S.workbookSheets({ ideaRules: rules, views: { quality: qv, divlow: dv2, insider: iv } });
const qsh = wbI[4], dsh = wbI[5], ish = wbI[6];
const colOf = (sh, h) => sh.cols.findIndex((c) => c[0] === h);
ok(qsh.rows.length === 3 && qsh.rows[1][colOf(qsh, 'Compounding record (of 5)')] === 5 && qsh.rows[1][colOf(qsh, 'Compounding now')] === 'Still growing' && qsh.rows[2][colOf(qsh, 'Compounding now')] === null, 'Excel: quality sheet, numbers and words, blank empty');
ok(dsh.rows[0][colOf(dsh, 'Dividend growth /yr 5Y (%)')] === null && dsh.rows[1][colOf(dsh, 'Dividend raised (years running)')] === 12 && dsh.rows[1][colOf(dsh, 'Dividend yield (%)')] === 2.4, 'Excel: dividend sheet');
ok(ish.rows[0][colOf(ish, 'Insiders buying')] === 7 && ish.rows[0][colOf(ish, 'Insider net (% of market value)')] === 0.004, 'Excel: insider sheet');
ok(['Quality compounders on a pullback', 'Dividend growers near their lows', 'Insider buying clusters', 'Compounding record', 'F-score', 'Insider net'].every((h) => wbI[8].rows.some((r) => r[0] === h)), 'About explains the three tabs and their readings');
ok(wbI[8].rows.find((r) => r[0] === 'Insider buying clusters')[1] === rules.insider, 'About carries the rule the route sent');

// ---- Strong three years, quiet this year (2026-11-05).
const zRows = [
  lr('Z1', { threeYearPct: 120, ytdPct: 2.1, oneYearPct: 10, revenueGrowthYoY: 8, crNow: 'grow' }),
  lr('Z2', { threeYearPct: 50, ytdPct: -5, revenueGrowthYoY: 0.1, crNow: null }),       // every edge, no now-reading
  lr('Z3', { threeYearPct: 75, ytdPct: 5, revenueGrowthYoY: 30, crNow: 'slow' }),
  lr('ZX1', { threeYearPct: 49.9, ytdPct: 0, revenueGrowthYoY: 5 }),                    // not enough over three years
  lr('ZX2', { threeYearPct: 200, ytdPct: 5.1, revenueGrowthYoY: 5 }),                   // moved this year
  lr('ZX3', { threeYearPct: 200, ytdPct: -5.1, revenueGrowthYoY: 5 }),                  // fell this year
  lr('ZX4', { threeYearPct: 200, ytdPct: 0, revenueGrowthYoY: 0 }),                     // revenue flat
  lr('ZX5', { threeYearPct: 200, ytdPct: 0, revenueGrowthYoY: null }),                  // revenue unknown
  lr('ZX6', { threeYearPct: 200, ytdPct: 0, revenueGrowthYoY: 9, crNow: 'decline' }),   // quarters turned down
  lr('ZX7', { threeYearPct: null, ytdPct: 0, revenueGrowthYoY: 9 }),                    // under three years of history
  lr('ZX8', { threeYearPct: 200, ytdPct: null, revenueGrowthYoY: 9 }),
  lr('ZX9', { threeYearPct: 200, ytdPct: 0, revenueGrowthYoY: 9, instrumentType: 'ETF' }),
];
const zv = S.quiet(zRows, {});
ok(zv.map((r) => r.symbol).join() === 'Z1,Z3,Z2', 'quiet: the three that pass, biggest three-year rise first', zv.map((r) => r.symbol));
ok(zv[0].y3 === 120 && zv[0].ytd === 2.1 && zv[0].y1 === 10 && zv[0].crNow === 'grow', 'quiet: 3Y, YTD, 1Y and the now-reading carried', zv[0]);
ok(/50% or more over three years/.test(S.ideaRules().quiet) && /-5% and \+5%/.test(S.ideaRules().quiet) && /Declining/.test(S.ideaRules().quiet), 'rule words: quiet', S.ideaRules().quiet);
const wbZ = S.workbookSheets({ views: { quiet: zv } });
const zsh = wbZ[7];
ok(zsh.name === 'Strong 3 years, quiet now' && zsh.rows.length === 3 && zsh.rows[0][colOf(zsh, '3 years (%)')] === 120 && zsh.rows[1][colOf(zsh, '1 year (%)')] === null, 'Excel: quiet sheet, figures as numbers, blank empty');
ok(wbZ[8].rows.some((r) => r[0] === 'Strong three years, quiet this year') && wbZ[8].rows.some((r) => r[0] === '3 years'), 'About explains the quiet tab and 3 years');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
