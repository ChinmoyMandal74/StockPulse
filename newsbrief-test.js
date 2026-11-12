// newsbrief.js: the trading calendar, the window, the order, the line, the
// calendar lists, and every check on the model's next-session note.
'use strict';
const NB = require('./newsbrief.js');
let ran = 0, failed = 0;
function check(name, got, want) {
  ran++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log('FAIL ' + name + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}

// ---- the NYSE's holidays, against the exchange's published lists ----------------
const h26 = [...NB.holidays(2026)].sort();
check('2026 holidays', h26, ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);
const h27 = [...NB.holidays(2027)].sort();
check('2027 holidays (Juneteenth and Christmas on a weekend move to the Friday, July 4th to the Monday)', h27, ['2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24']);
// 2022: New Year's Day on a Saturday is not made up on Friday Dec 31, 2021.
check('a New Year on a Saturday is not observed', NB.holidays(2022).has('2021-12-31') || NB.holidays(2021).has('2021-12-31'), false);
check('Easter 2026 and 2027', [NB.easter(2026), NB.easter(2027)], ['2026-04-05', '2027-03-28']);
check('Thursday to Friday', NB.nextTradingDay('2026-11-12'), '2026-11-13');
check('Friday to Monday', NB.nextTradingDay('2026-11-13'), '2026-11-16');
check('Saturday and Sunday to Monday', [NB.nextTradingDay('2026-11-14'), NB.nextTradingDay('2026-11-15')], ['2026-11-16', '2026-11-16']);
check('the day before Thanksgiving to the Friday after', NB.nextTradingDay('2026-11-25'), '2026-11-27');
check('Christmas Eve 2026 to the 28th', NB.nextTradingDay('2026-12-24'), '2026-12-28');
check('Holy Thursday 2026 over Good Friday', NB.nextTradingDay('2026-04-02'), '2026-04-06');
check('a holiday is not a trading day', [NB.isTradingDay('2026-11-26'), NB.isTradingDay('2026-11-27')], [false, true]);

// ---- the window -----------------------------------------------------------------
const now = Date.parse('2026-11-12T22:40:00Z');            // 17:40 Eastern
const prev = Date.parse('2026-11-11T22:40:00Z');
const R = (o) => Object.assign({ id: 'x', symbol: 'AAA', published_at: '2026-11-12T15:00:00Z', scored_at: now - 3600e3, source: 's1', url: 'u', about: 'primary', kind: 'results', event: true, summary: 'AAA reported results.', headline: 'AAA results' }, o);
check('published since the last brief: in', NB.inWindow(R({}), prev, now), true);
check('published before it and read before it: out (it was in that brief)', NB.inWindow(R({ published_at: '2026-11-11T22:30:00Z', scored_at: prev - 60e3 }), prev, now), false);
check('published before it, read after it: in (the late read)', NB.inWindow(R({ published_at: '2026-11-11T22:30:00Z', scored_at: prev + 46 * 60e3 }), prev, now), true);
check('read late but published two days earlier: out', NB.inWindow(R({ published_at: '2026-11-10T20:00:00Z', scored_at: prev + 60e3 }), prev, now), false);
check('the first brief: the last 24 hours', [NB.inWindow(R({ published_at: '2026-11-11T23:00:00Z' }), null, now), NB.inWindow(R({ published_at: '2026-11-11T22:00:00Z' }), null, now)], [true, false]);
check('dated in the future: out', NB.inWindow(R({ published_at: '2026-11-13T22:00:00Z' }), prev, now), false);

// ---- stories: grouped, ranked, the lead's summary -------------------------------
const info = (s) => ({ AAA: { name: 'Alpha Holdings', cap: 5e9 }, BBB: { name: 'Beta Systems', cap: 900e9 }, CCC: { name: 'Gamma', cap: 50e9 } })[s] || null;
const rows = [
  R({ id: 'a1', symbol: 'AAA', kind: 'results', source: 'one', summary: 'Alpha reported results.' }),
  R({ id: 'a2', symbol: 'AAA', kind: 'results', source: 'two', published_at: '2026-11-12T16:00:00Z', summary: 'Alpha beat estimates.' }),
  R({ id: 'b1', symbol: 'BBB', kind: 'deal', source: 'one', headline: 'Beta buys a firm', summary: 'Beta agreed to buy a firm.' }),
  R({ id: 'c1', symbol: 'CCC', kind: 'analyst', source: 'one', headline: 'Gamma upgraded', summary: 'An analyst raised Gamma.' }),
  R({ id: 'c2', symbol: 'CCC', kind: 'opinion', source: 'one', headline: 'Is Gamma cheap', summary: 'A columnist weighs Gamma.' }),
  R({ id: 'z1', symbol: 'CCC', kind: 'results', about: 'mentioned', source: 'one', headline: 'Sector wrap', summary: 'Gamma was mentioned.' }),
  R({ id: 'n1', symbol: 'AAA', kind: 'deal', summary: null, headline: 'no summary' }),
];
const list = NB.stories(rows, info, prev, now);
check('stories: one per story, high before medium before low, then by outlets', list.map((s) => s.symbol + ':' + s.importance + ':' + s.coverage), ['AAA:high:2', 'BBB:high:1', 'CCC:medium:1', 'CCC:low:1', 'CCC:low:1']);
check('a story is led by its earliest most important article', list[0].summary, 'Alpha reported results.');
check('names and values from the screener', [list[1].name, list[1].cap], ['Beta Systems', 900e9]);
check('an article with no summary leads nothing', list.some((s) => s.headline === 'no summary'), false);
check('same importance, same outlets: the larger company first', NB.stories([R({ id: 'p', symbol: 'AAA', kind: 'deal', headline: 'Alpha deal' }), R({ id: 'q', symbol: 'BBB', kind: 'deal', headline: 'Beta deal' })], info, prev, now).map((s) => s.symbol), ['BBB', 'AAA']);

// ---- one or two lines -------------------------------------------------------------
check('a long first sentence alone', NB.line('Nvidia shares fell more than 8% after hours after reports that its board is preparing to remove its CEO. The company denied it.'), 'Nvidia shares fell more than 8% after hours after reports that its board is preparing to remove its CEO.');
check('a short first sentence keeps the second', NB.line('Apple reported results. Revenue rose 8% to a record.'), 'Apple reported results. Revenue rose 8% to a record.');
check('a decimal is not a sentence end', NB.line('Revenue rose to $1.2 billion, and the company raised its outlook for the rest of the fiscal year sharply. More.'), 'Revenue rose to $1.2 billion, and the company raised its outlook for the rest of the fiscal year sharply.');
check('cut under 260 characters', NB.line('word '.repeat(80)).length <= 260, true);

// ---- the calendar lists -----------------------------------------------------------
const cal = NB.calendar({ AAA: { d: '2026-11-13', time: 'pre-market' }, BBB: { d: '2026-11-13', time: null }, CCC: { d: '2026-11-12', time: 'post-market' },
  DDD: { d: '2026-11-13', time: 'pre-market' }, AAB: { d: '2026-11-13', time: 'post-market' } }, (s) => (s === 'DDD' ? null : info(s) || { name: s, cap: null }), '2026-11-12', '2026-11-13');
check('before the next open: pre-market and time unstated, larger first; tomorrow evening not', cal.before.map((r) => r.symbol), ['BBB', 'AAA']);
check('after today\'s close', cal.after.map((r) => r.symbol), ['CCC']);
check('a company not on the screener is left out', cal.before.some((r) => r.symbol === 'DDD'), false);

// ---- the model's note: checks -----------------------------------------------------
const cands = NB.candidates(list, cal, '2026-11-12');
check('candidates: the high stories, the medium ones two outlets carried, then the calendar', cands.map((c) => c.id + ':' + c.symbol), ['n1:AAA', 'n2:BBB', 'b1:BBB', 'b2:AAA', 'a1:CCC']);
const syms = new Set(['AAA', 'BBB', 'CCC', 'DDD', 'ON']);
const one = (line, ids, intro) => NB.check({ intro: intro || '', items: [{ ids, line }] }, cands, syms, 'Friday, November 13 2026-11-13');
check('a clean line passes, with its companies', one('Alpha reported results, and Beta Systems reports before the open.', ['n1', 'b1']).items, [{ line: 'Alpha reported results, and Beta Systems reports before the open.', symbols: ['AAA', 'BBB'], ids: ['n1', 'b1'] }]);
check('an id that does not exist: dropped', one('Alpha reported results.', ['n1', 'n9']).dropped, ['cites an input that does not exist']);
check('no ids: dropped', one('Alpha reported results.', []).dropped, ['cites an input that does not exist']);
check('a word the site does not use: dropped', one('Alpha is a buy after its results.', ['n1']).dropped, ['a word the site does not use (buy)']);
check('a figure not in what it cites: dropped', one('Alpha reported results, up 12%.', ['n1']).dropped, ['a figure not in its inputs (12)']);
check('the session date is allowed', one('Beta Systems reports on November 13.', ['b1']).items.length, 1);
check('a quarter label is not a figure', one('Alpha reported Q3 results.', ['n1']).items.length, 1);
check('a company its inputs do not hold, in brackets: dropped', one('Alpha reported results; watch Delta (DDD).', ['n1']).dropped, ['names a company its inputs do not (DDD)']);
check('a bare ticker its inputs do not hold: dropped', one('Alpha reported results, as did DDD.', ['n1']).dropped, ['names a company its inputs do not (DDD)']);
check('a common abbreviation that is also a ticker passes', one('Alpha reported results ON its AI unit.', ['n1']).items.length, 1);
check('too long: dropped', one('Alpha reported results. ' + 'x'.repeat(260), ['n1']).dropped, ['too long']);
check('an intro with a stray figure is dropped, the items kept', (() => { const c = one('Alpha reported results.', ['n1'], 'Seven companies report.'); return [c.intro, c.items.length]; })(), ['Seven companies report.', 1]);
check('an intro with a figure in no input is dropped', one('Alpha reported results.', ['n1'], 'Up 40% on the day.').dropped, ['intro']);
check('at most ten lines', NB.check({ intro: '', items: Array.from({ length: 14 }, () => ({ ids: ['n1'], line: 'Alpha reported results.' })) }, cands, syms).items.length, 10);
check('nothing readable: not ok', NB.check(null, cands, syms).ok, false);
const req = NB.request(cands, '2026-11-13');
check('the request: the model, a schema, the session named', [req.model, req.output_config.format.type, /Friday, November 13/.test(req.messages[0].content)], ['claude-sonnet-5-5', 'json_schema', true]);
check('the request tells the model not to advise', /do not advise or forecast/.test(req.system) && /buy, sell, hold/.test(req.system), true);
check('the cost of a call', Math.round(NB.spend({ input_tokens: 15000, output_tokens: 1000 }) * 1000) / 1000, 0.04);

// ---- the day re-read by the model: the inputs ----------------------------------
const day = NB.dayInputs(rows, info, prev, now);
check('the re-read takes every article mainly about its company, with a summary, in the window', day.map((x) => x.symbol + ':' + x.kind), ['AAA:results', 'AAA:results', 'BBB:deal', 'CCC:analyst', 'CCC:opinion']);
check('numbered r1.., most important first, the story\'s outlets on each', day.map((x) => x.id + ':' + x.importance + ':' + x.coverage), ['r1:high:2', 'r2:high:2', 'r3:high:1', 'r4:medium:1', 'r5:low:1']);
const treq = NB.todayRequest(day, '2026-11-12');
check('the request: Sonnet, the schema with importance, every article in the prompt', [treq.model, treq.output_config.format.schema.properties.items.items.properties.importance.enum, (treq.messages[0].content.match(/\nr\d+ \|/g) || []).length], ['claude-sonnet-5-5', ['high', 'medium'], 5]);
check('the instructions: one event one line, never repeated, acquire not buy', /every article about one event goes into one line, never two/.test(treq.system) && /Never repeat a piece of news/.test(treq.system) && /write "acquire"/.test(treq.system), true);

// ---- the day re-read: the checks ----------------------------------------------------
const T = (items, intro) => NB.checkToday({ intro: intro || '', items }, day, syms, 'Thursday, November 12 2026-11-12');
const ok1 = T([{ importance: 'high', ids: ['r1', 'r2'], line: 'Alpha reported results and beat estimates.' }, { importance: 'medium', ids: ['r4'], line: 'An analyst raised Gamma.' }, { importance: 'high', ids: ['r3'], line: 'Beta agreed to acquire a firm.' }]);
check('clean lines kept, high before medium, the model\'s order within', ok1.items.map((x) => x.importance + ':' + x.symbols.join()), ['high:AAA', 'high:BBB', 'medium:CCC']);
check('each line says how many articles it was drawn from', ok1.items[0].articles, 2);
check('an article backing a second line: dropped', T([{ importance: 'high', ids: ['r1'], line: 'Alpha reported results.' }, { importance: 'high', ids: ['r2', 'r1'], line: 'Alpha beat estimates on its quarter.' }]).dropped, ['repeats an article an earlier line used']);
check('the same news again in other articles: dropped', T([{ importance: 'high', ids: ['r1'], line: 'Alpha Holdings reported quarterly results above estimates today.' }, { importance: 'high', ids: ['r2'], line: 'Alpha Holdings reported quarterly results above estimates.' }]).dropped, ['repeats an earlier line']);
check('a different event at the same company is kept', T([{ importance: 'high', ids: ['r1'], line: 'Alpha reported results.' }, { importance: 'medium', ids: ['r2'], line: 'Alpha beat estimates.' }]).items.length, 2);
check('no importance: dropped', T([{ importance: 'low', ids: ['r5'], line: 'A columnist weighs Gamma.' }]).dropped, ['no importance']);
check('the line checks hold: a figure, a word, a stray company', T([{ importance: 'high', ids: ['r1'], line: 'Alpha rose 9%.' }, { importance: 'high', ids: ['r3'], line: 'Beta is a buy.' }, { importance: 'high', ids: ['r3'], line: 'Beta and DDD agreed a deal.' }]).dropped,
  ['a figure not in its inputs (9)', 'a word the site does not use (buy)', 'names a company its inputs do not (DDD)']);
check('an analyst\'s pick list or price target: dropped', [T([{ importance: 'medium', ids: ['r4'], line: 'JPMorgan named Gamma a top pick.' }]).dropped, T([{ importance: 'medium', ids: ['r4'], line: 'Two banks raised targets on Gamma.' }]).dropped, T([{ importance: 'medium', ids: ['r4'], line: 'An analyst lowered its price target.' }]).dropped],
  [['a ranking or target (top pick)'], ['a ranking or target (raised targets)'], ['a word the site does not use (price target)']]);
check('a company\'s own target passes', T([{ importance: 'high', ids: ['r3'], line: 'Beta set a new target for reducing its debt.' }]).items.length, 1);
check('at most sixty lines', NB.checkToday({ intro: '', items: Array.from({ length: 70 }, (_, i) => ({ importance: 'medium', ids: [], line: 'x' })) }, day, syms).items.length, 0);
check('sixty kept of more', (() => { const many = Array.from({ length: 70 }, (_, i) => ({ id: 'r' + (i + 1), symbol: 'AAA', name: 'Alpha', text: 'event ' + 'w' + i + ' happened', kind: 'deal', importance: 'high', coverage: 1 }));
  return NB.checkToday({ intro: '', items: many.map((m, i) => ({ importance: 'high', ids: [m.id], line: 'w' + i + 'aaaa w' + i + 'bbbb w' + i + 'cccc' })) }, many, syms).items.length; })(), 60);
check('the count of articles read', ok1.read, 5);

console.log(`\nnewsbrief-test: ${ran} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
