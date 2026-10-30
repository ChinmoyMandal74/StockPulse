// THE NIGHTLY'S STEPS, each with its outcome (2026-10-30, the owner: "I want
// that email to tell me about every sub-step"). nightly-ping.js runs a dozen
// steps around the refresh (the SEC daily read, the earnings calendar, then
// after it SEC filings, short interest, holdings, insiders, splits, options
// and four rebuilds); each writes its own log lines and none returns a status.
// So a step's outcome is read from what it said: a line that says it was
// skipped, stopped, refused or failed makes the step a problem, and so does a
// step that said nothing at all. The steps go onto the run
// (POST /api/cron/refresh-steps) and the jobs email reads them.
//
// Pure and dependency-free: it ships in the Fly image beside the ping.
'use strict';

// What the email calls each step, in the order the nightly runs them.
const NAMES = {
  'sec daily': 'SEC filings since yesterday',
  calendar: 'Earnings calendar',
  refresh: 'Prices and fundamentals',
  sec: 'SEC filings rotation',
  short: 'Short interest',
  holdings: 'Index holdings',
  insider: 'Insider filings',
  splits: 'Splits',
  options: 'Options open interest',
  months: 'Group months',
  figures: 'Group figures',
  'index P/E': 'Index P/E',
  'news archive': 'Headline archive',
};

const BAD = /\b(skipped|stopped|refused|REFUSED|unreachable|not built|not read|failed|FAILED|rate-limiting|HTTP \d{3})\b/;

// Each logged line starts with its step's label padded to ten characters.
const strip = (line) => String(line).slice(10).trim();

function stepFrom(name, lines, at, now) {
  const said = (lines || []).map(strip).filter(Boolean);
  return {
    name, at, ms: Math.max(0, (now || Date.now()) - at),
    state: said.length && !said.some((l) => BAD.test(l)) ? 'ok' : 'problem',
    note: said.length ? said.join('; ').slice(0, 300) : 'said nothing',
  };
}

module.exports = { NAMES, BAD, stepFrom };
