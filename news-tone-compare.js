// How the shadow model's article readings compare with the main model's
// (news-tone-load.js --shadow). Reads news-tone-shadow.jsonl, which only this
// machine has; no database, no network.
//
//   node news-tone-compare.js            the whole file
//   node news-tone-compare.js --days 3   the last three days
//
// (2026-10-19, the owner: "try using a lower model and observe for a few days
// and compare costs".) What matters for the site, in order: does the cheaper
// model agree on WHETHER an article is mainly about the company (that decides
// what is shown and counted at all), on the tone's WORD (Positive / Neutral /
// Negative, what a member reads), on the number, and on the kind. Then what
// each costs, per article and projected over a month.
'use strict';
const fs = require('fs');
const path = require('path');
const NewsTone = require('./newstone.js');

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const DAYS = Number(arg('--days')) || 0;
const FILE = path.join(__dirname, 'news-tone-shadow.jsonl');
if (!fs.existsSync(FILE)) { console.log('No news-tone-shadow.jsonl yet: run news-tone-load.js with --shadow first.'); process.exit(0); }

const since = DAYS ? Date.now() - DAYS * 86400000 : 0;
const rows = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.main && r.shadow && Date.parse(r.at) >= since);
// The same article can be logged twice (a dry run, then the scheduled run): the latest counts.
const byId = new Map();
for (const r of rows) byId.set(r.id, r);
const all = [...byId.values()];
if (!all.length) { console.log('Nothing in the window.'); process.exit(0); }

const answered = (x) => x && !x.error && !x.refused && typeof x.tone === 'number';
const both = all.filter((r) => answered(r.main) && answered(r.shadow));
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '—');
const mean = (a) => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : NaN);
const sum = (a) => a.reduce((t, v) => t + v, 0);

const models = { main: all.find((r) => r.main.model).main.model, shadow: all.find((r) => r.shadow.model).shadow.model };
const first = all.map((r) => r.at).sort()[0], last = all.map((r) => r.at).sort().slice(-1)[0];
console.log(`${models.main} (main) against ${models.shadow} (shadow): ${all.length} articles, ${first.slice(0, 16)} to ${last.slice(0, 16)} UTC\n`);

// ---- did each answer at all ------------------------------------------------
const fails = (k) => all.filter((r) => !answered(r[k])).length;
const problems = (k) => all.filter((r) => answered(r[k]) && (r[k].problems || []).length).length;
console.log('Answered            main ' + (all.length - fails('main')) + '/' + all.length + '   shadow ' + (all.length - fails('shadow')) + '/' + all.length);
console.log('Broke a rule        main ' + problems('main') + '   shadow ' + problems('shadow') + '   (a banned word in the summary, a field out of range)');
const shProb = all.filter((r) => answered(r.shadow) && (r.shadow.problems || []).length).map((r) => r.shadow.problems.join('; '));
if (shProb.length) console.log('  shadow problems: ' + [...new Set(shProb)].slice(0, 5).join(' | '));

// ---- agreement ---------------------------------------------------------------
const n = both.length;
const aboutSame = both.filter((r) => r.main.about === r.shadow.about).length;
// What is SHOWN is decided by about === 'primary': agreement on that one line.
const shownSame = both.filter((r) => (r.main.about === 'primary') === (r.shadow.about === 'primary')).length;
const kindSame = both.filter((r) => r.main.kind === r.shadow.kind).length;
const word = (t) => NewsTone.label(t);
const wordSame = both.filter((r) => word(r.main.tone) === word(r.shadow.tone)).length;
const flips = both.filter((r) => (word(r.main.tone) === 'Positive' && word(r.shadow.tone) === 'Negative') || (word(r.main.tone) === 'Negative' && word(r.shadow.tone) === 'Positive'));
const diffs = both.map((r) => Math.abs(r.main.tone - r.shadow.tone));
const mx = mean(both.map((r) => r.main.tone)), my = mean(both.map((r) => r.shadow.tone));
const cov = sum(both.map((r) => (r.main.tone - mx) * (r.shadow.tone - my)));
const corr = cov / Math.sqrt(sum(both.map((r) => (r.main.tone - mx) ** 2)) * sum(both.map((r) => (r.shadow.tone - my) ** 2)));
console.log(`\nOn the ${n} articles both answered:`);
console.log('  shown or not (mainly about the company)   ' + pct(shownSame, n));
console.log('  about (primary / mentioned / not about)   ' + pct(aboutSame, n));
console.log('  tone word (Positive / Neutral / Negative) ' + pct(wordSame, n));
console.log('  opposite words (one Positive, one Negative) ' + flips.length);
console.log('  tone, mean difference                     ' + mean(diffs).toFixed(3) + ' on the -1 to +1 scale; within 0.10: ' + pct(diffs.filter((d) => d <= 0.1001).length, n));
console.log('  tone, correlation                         ' + (isFinite(corr) ? corr.toFixed(2) : '—'));
console.log('  kind (results, opinion, price move, ...)  ' + pct(kindSame, n));
console.log('  mean tone                                 main ' + (mx >= 0 ? '+' : '') + mx.toFixed(3) + '   shadow ' + (my >= 0 ? '+' : '') + my.toFixed(3));

// ---- cost ------------------------------------------------------------------------
// Cost only where BOTH models were paid for in the same run: a catch-up row
// (--shadow-backfill) carries the stored main reading, whose cost was paid
// earlier and is not in this file.
const paired = all.filter((r) => r.main && r.main.cost && r.shadow && r.shadow.cost);
const cm = sum(paired.map((r) => r.main.cost.usd)), cs = sum(paired.map((r) => r.shadow.cost.usd));
const csAll = sum(all.filter((r) => r.shadow && r.shadow.cost).map((r) => r.shadow.cost.usd));
if (paired.length) {
  console.log(`\nCost on the ${paired.length} articles both read in the same run:  main $${cm.toFixed(3)} ($${(cm / paired.length).toFixed(4)} each)   shadow $${cs.toFixed(3)} ($${(cs / paired.length).toFixed(4)} each)   ratio ${(cm / cs).toFixed(1)}x`);
  const pf = paired.map((r) => r.at).sort(), days = (Date.parse(pf[pf.length - 1]) - Date.parse(pf[0])) / 86400000;
  if (days >= 1) console.log(`Over ${days.toFixed(1)} days, about ${(paired.length / days).toFixed(0)} articles a day: a month is about main $${(cm / days * 30).toFixed(2)}, shadow $${(cs / days * 30).toFixed(2)}`);
}
console.log(`Shadow spend in the file, catch-up included: $${csAll.toFixed(3)}`);
console.log('(Articles the main model alone read, skipped and unreadable ones, and the main model\'s re-asks are not in this file; see news-tone.log for the whole spend.)');

// ---- where they differ most -------------------------------------------------------
const worst = both.slice().sort((a, b) => Math.abs(b.main.tone - b.shadow.tone) - Math.abs(a.main.tone - a.shadow.tone)
  || ((b.main.about !== b.shadow.about) - (a.main.about !== a.shadow.about))).slice(0, 5);
console.log('\nWhere they differ most:');
for (const r of worst) {
  const f = (x) => `${word(x.tone)} ${x.tone >= 0 ? '+' : ''}${x.tone.toFixed(2)} [${x.about}, ${x.kind}]`;
  console.log(`  ${r.symbol}  ${String(r.headline).slice(0, 90)}`);
  console.log(`    main:   ${f(r.main)}  ${String(r.main.summary || '').slice(0, 160)}`);
  console.log(`    shadow: ${f(r.shadow)}  ${String(r.shadow.summary || '').slice(0, 160)}`);
}
