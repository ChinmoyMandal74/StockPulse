// TRENDING (2026-11-07, the owner: "Create a page similar to ideas called trending .. add 4 sub
// tabs .. trending up by gain .. trending down by loss .. trending by volume up and down ..
// trending by market cap up and down"). /trending, members, drawn by the Ideas page's own table
// (private/selloff.html in its trending mode). Pure: the served rows in, four views out.
//
// Every reading is the screener's own (server.js lays the same read-path stamps on as for
// /ideas). A description of what prices did, nothing more: no rule reads any of it, and nothing
// is stored.
const Selloff = require('./selloff.js');

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
// The move each period reads: the screener's own Today, 1W and 1M columns.
const PERIODS = { today: { field: 'todayPct', label: 'Today' }, '1w': { field: 'oneWeekPct', label: '1 week' }, '1m': { field: 'oneMonthPct', label: '1 month' } };
const DEFAULT_PERIOD = 'today';
const TOP = 50;              // rows a list
const VOL_MIN = 1.5;         // the screener's own mark for heavy volume (Rel. volume drawn amber from 1.5x)
const usable = (r) => r && r.symbol && !r.error && r.instrumentType !== 'ETF';

// The change in market value over the period, in dollars: the value now less the value the move
// started from. Market value is the one money figure reliably in US dollars, so these compare.
function capChange(cap, movePct) {
  const c = num(cap), m = num(movePct);
  if (!(c > 0) || m == null || m <= -100) return null;
  return c - c / (1 + m / 100);
}

function rowOut(row, period) {
  const p = PERIODS[period] || PERIODS[DEFAULT_PERIOD];
  const move = num(row[p.field]);
  return Object.assign(Selloff.fields(row, null), {
    w1: num(row.oneWeekPct), move, volX: num(row.volX), dollarVolume: num(row.dollarVolume),
    capChg: capChange(row.marketCap, move),
  });
}
const bySym = (a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
// Larger first by `key`, or smaller first with dir -1; a blank never passes `keep`.
const pick = (rows, keep, key, dir) => rows.filter(keep).sort((a, b) => ((b[key] - a[key]) * dir) || bySym(a, b)).slice(0, TOP);

// The four views. Volume reads the latest session whatever the period: relative volume is one
// session's volume against its 20-day average, so its direction is that session's move.
function views(rows, period) {
  const per = PERIODS[period] ? period : DEFAULT_PERIOD;
  const base = (rows || []).filter(usable);
  const out = base.map((r) => rowOut(r, per));
  const today = base.map((r) => rowOut(r, 'today'));
  const heavy = (r) => r.volX != null && r.volX >= VOL_MIN && r.move != null;
  return {
    up: pick(out, (r) => r.move != null && r.move > 0, 'move', 1),
    down: pick(out, (r) => r.move != null && r.move < 0, 'move', -1),
    volUp: pick(today, (r) => heavy(r) && r.move > 0, 'volX', 1),
    volDown: pick(today, (r) => heavy(r) && r.move < 0, 'volX', 1),
    capUp: pick(out, (r) => r.capChg != null && r.capChg > 0, 'capChg', 1),
    capDown: pick(out, (r) => r.capChg != null && r.capChg < 0, 'capChg', -1),
  };
}

// Each view's rule in words: the tab tooltips, the footnote and the workbook's About sheet.
function rules(period) {
  const L = (PERIODS[period] || PERIODS[DEFAULT_PERIOD]).label.toLowerCase();
  const over = L === 'today' ? 'in the latest session' : 'over ' + L;
  return {
    up: 'Up to ' + TOP + ' companies whose share price rose the most ' + over + ', in percent. Largest rise first.',
    down: 'Up to ' + TOP + ' companies whose share price fell the most ' + over + ', in percent. Largest fall first.',
    volume: 'Companies trading at ' + VOL_MIN + ' times their 20-day average volume or more in the latest session (the screener’s Rel. volume; during trading, the volume so far), split by whether the price rose or fell that session. Heaviest volume first, up to ' + TOP + ' each way.',
    cap: 'Up to ' + TOP + ' companies each way whose market value rose, or fell, by the most dollars ' + over + ': the market value now less the value the move started from. Largest change first.',
  };
}

// THE EXCEL DOWNLOAD: the answer /api/trending serves, a sheet a list, as Selloff.workbookSheets
// shapes them ({ name, cols: [[heading, width, numeric]], rows }); a blank stays empty, never 0.
function workbookSheets(body) {
  const r1 = (v) => (num(v) == null ? null : Math.round(num(v) * 10) / 10);
  const r2 = (v) => (num(v) == null ? null : Math.round(num(v) * 100) / 100);
  const bn = (v) => (num(v) == null ? null : Math.round(num(v) / 1e7) / 100);
  const txt = (v) => (v == null || v === '' ? null : String(v));
  const cols = [
    ['Symbol', 9, false, (r) => r.symbol],
    ['Company', 30, false, (r) => txt(r.name)],
    ['Health (0 to 100)', 10, true, (r) => num(r.health)],
    ['Sector', 20, false, (r) => txt(r.sector)],
    ['Industry', 30, false, (r) => txt(r.industry)],
    ['Market cap ($B)', 12, true, (r) => bn(r.cap)],
    ['Market value change ($B)', 13, true, (r) => bn(r.capChg)],
    ['Today (%)', 9, true, (r) => r2(r.today)],
    ['1 week (%)', 9, true, (r) => r1(r.w1)],
    ['1 month (%)', 9, true, (r) => r1(r.m1)],
    ['Rel. volume (x 20-day avg)', 12, true, (r) => r2(r.volX)],
    ['$ volume ($M)', 11, true, (r) => (num(r.dollarVolume) == null ? null : Math.round(num(r.dollarVolume) / 1e4) / 100)],
    ['From 52-week high (%)', 12, true, (r) => r1(r.fromHigh)],
    ['RSI (14-day)', 9, true, (r) => r1(r.rsi)],
    ['P/E (trailing)', 9, true, (r) => r2(r.pe)],
    ['Fwd P/E', 9, true, (r) => r2(r.fpe)],
    ['Value vs industry', 16, false, (r) => txt(r.valueVsIndustry)],
    ['Growth & profit', 22, false, (r) => txt(r.growthProfile)],
    ['Signal', 22, false, (r) => txt(r.signal)],
    ['Signal: the rule that fired', 30, false, (r) => txt(r.signalWhy)],
    ['Tone 7D (−1 to +1)', 11, true, (r) => (r.tone ? r2(r.tone.avg) : null)],
    ['Articles read (7D)', 10, true, (r) => (r.tone ? r.tone.n : null)],
  ];
  const sheet = (name, rows) => ({ name, cols: cols.map(([h, w, n]) => [h, w, n]), rows: (rows || []).map((r) => cols.map((c) => c[3](r))) });
  const v = (body && body.views) || {}, ru = (body && body.rules) || rules(body && body.period);
  const at = body && body.at ? new Date(body.at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' Eastern' : 'not known';
  const per = (PERIODS[body && body.period] || PERIODS[DEFAULT_PERIOD]).label;
  return [
    sheet('Trending up', v.up), sheet('Trending down', v.down),
    sheet('Volume, price up', v.volUp), sheet('Volume, price down', v.volDown),
    sheet('Market cap, up', v.capUp), sheet('Market cap, down', v.capDown),
    { name: 'About', cols: [['Item', 30, false], ['What it means', 120, false]], rows: [
      ['Prices as of', at],
      ['Period', per + ' (chosen on the page; the volume lists always read the latest session)'],
      ['Trending up', ru.up], ['Trending down', ru.down], ['By volume', ru.volume], ['By market cap', ru.cap],
      ['Market value change', 'The market value now less the value the move started from, in billions of US dollars.'],
      ['Rel. volume', 'The latest session’s volume against its 20-day average, as on the screener.'],
      ['Signal', 'The screener’s mechanical reading of strength under its Balanced rules, with the rule that fired. A description of where the stock stands on those rules, not an instruction to trade.'],
      ['Tone 7D', 'Article tone over the last seven days, as on the screener, from −1 to +1. Never an input to the Signal.'],
      ['Empty cells', 'A figure that is not known. Never a zero.'],
      ['', 'Descriptions of what prices did, not a reading of what comes next. Nothing here is a recommendation to trade. Tickr Lab, tickrlab.com.'],
    ] },
  ];
}

module.exports = { PERIODS, DEFAULT_PERIOD, TOP, VOL_MIN, capChange, views, rules, workbookSheets };
