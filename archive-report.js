#!/usr/bin/env node
// The weekly email on the local article text archive (2026-11-01, the owner:
// "create a schedule task on Saturday morning 8AM to send details on New
// Article Archive local copy like how many articles collected this week, Size
// of the local table"). The archive lives on this laptop only
// (newsarchive.js), so its figures are counted here and sent to the app, which
// mails them to the operator (/api/cron/archive-report). Counts only: no
// article text, headline or address leaves the laptop.
//
// Run by its own task (archive-report-task.ps1), Saturdays 08:00. Reads the
// archive and never writes it; spends nothing.
//
//   node archive-report.js          count and send
//   node archive-report.js --dry    print what it would send, send nothing
//
// Exit code 0 when the app took the report, 1 otherwise.
'use strict';
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = __dirname;
const DAY = 86400000;

function fromEnvFile(k) {
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch { return ''; }
  for (const line of raw.split(/\r?\n/)) {
    const m = new RegExp('^\\s*' + k + '\\s*=\\s*(.*)$').exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}
const etDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
function stamp() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '') + ' ET';
}
const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };

// The figures for the seven days to `now`. Exported for the test.
function figures(A, file, now) {
  const db = A.db;
  const from = now - 7 * DAY;
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const tot = one('select count(*) n, sum(chars) chars, sum(length(body)) gz, min(published_at) first, max(published_at) last, max(fetched_at) fetched from articles');
  const wk = one('select count(*) n, sum(chars) chars, sum(length(body)) gz from articles where fetched_at >= ? and fetched_at < ?', from, now);
  // An Eastern day a row, oldest first, every day the window touches even when
  // nothing came (Saturday 08:00 to Saturday 08:00 touches eight: the first
  // and last are part days).
  const byDay = new Map();
  for (const r of all('select fetched_at t from articles where fetched_at >= ? and fetched_at < ?', from, now)) {
    const d = etDay(r.t); byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  const days = [];
  for (let t = from; ; t += DAY) {
    const d = etDay(Math.min(t, now - 1));
    if (!days.some((x) => x.d === d)) days.push({ d, n: byDay.get(d) || 0 });
    if (t >= now - 1) break;
  }
  const top = (rows) => rows.map((r) => ({ name: String(r.name || '—'), n: Number(r.n) }));
  const wal = fileSize(file + '-wal'), main = fileSize(file);
  return {
    at: now, host: require('os').hostname(), file: path.basename(file),
    week: {
      from, to: now, added: Number(wk.n) || 0, chars: Number(wk.chars) || 0, gz: Number(wk.gz) || 0, days,
      companies: Number(one('select count(distinct symbol) n from carried where seen_at >= ? and seen_at < ?', from, now).n) || 0,
      pairs: Number(one('select count(*) n from carried where seen_at >= ? and seen_at < ?', from, now).n) || 0,
      publishers: top(all('select coalesce(source, host) name, count(*) n from articles where fetched_at >= ? and fetched_at < ? group by name order by n desc limit 6', from, now)),
      symbols: top(all('select symbol name, count(*) n from carried where seen_at >= ? and seen_at < ? group by symbol order by n desc limit 8', from, now)),
    },
    total: {
      articles: Number(tot.n) || 0, chars: Number(tot.chars) || 0, gz: Number(tot.gz) || 0,
      companies: Number(one('select count(distinct symbol) n from carried').n) || 0,
      first: tot.first || null, last: tot.last || null, fetched: tot.fetched == null ? null : Number(tot.fetched),
      fileBytes: main + wal, walBytes: wal,
    },
  };
}

async function main() {
  const NA = require('./newsarchive.js');
  const file = process.env.NEWS_ARCHIVE_DB || NA.DEFAULT_PATH;
  let body;
  try {
    if (!fs.existsSync(file)) throw new Error('no archive at ' + file);
    const A = NA.open(file);
    try { body = figures(A, file, Date.now()); } finally { A.close(); }
  } catch (e) {
    // The email still goes: an archive that cannot be read is the news.
    body = { at: Date.now(), host: require('os').hostname(), error: String(e.message).split('\n')[0].slice(0, 200) };
  }
  if (DRY) { console.log(JSON.stringify(body, null, 2)); return; }
  const secret = fromEnvFile('CRON_SECRET');
  const base = (fromEnvFile('APP_URL') || 'https://www.tickrlab.com').replace(/\/+$/, '');
  const i = process.argv.indexOf('--base');
  const url = (i > 0 ? process.argv[i + 1] : base) + '/api/cron/archive-report';
  if (!secret) { console.log(stamp() + '  FAILED  CRON_SECRET is not in .env'); process.exitCode = 1; return; }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    console.log(stamp() + '  ' + (r.ok && j.sent ? 'sent: ' + (body.week ? body.week.added + ' articles this week, ' + body.total.articles + ' in all' : 'the archive could not be read') : 'FAILED  the app answered ' + r.status + ' ' + (j.error || '')));
    if (!r.ok || !j.sent) process.exitCode = 1;
  } catch (e) {
    console.log(stamp() + '  FAILED  ' + String(e.message).split('\n')[0]);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { figures };
