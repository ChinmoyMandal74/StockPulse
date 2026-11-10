// SBA 7(a) and 504 loans: the Small Business Administration's loan-level
// FOIA files, every loan approved since fiscal 1991 (backlog 61, E13;
// docs/context/sba-loans.md). Loan size, jobs supported, industry code,
// city and state, the lender, and how the loan ended (paid in full or
// charged off). Like the PPP files, but every year: a size signal for
// small private firms long before and after 2020. Matched to the plan
// sponsors and Form D issuers by name and state (no EIN), so inexact.
//
// LOCAL, BY HAND, AND SLOW ON PURPOSE: the PPP loader's download (ppp-load.js),
// the same host, folder, request log, 20-a-day cap, lock and rules:
//   - six bulk CSVs, never a request per business;
//   - one request at a time, --gap seconds apart (60 by default, never under 30);
//   - any answer but a 200 stops the run, nothing retried;
//   - every file kept in the system temp folder and never fetched twice;
//   - one run at a time; nothing schedules it.
//
//   node --use-system-ca sba-load.js                      # what it would do; no request
//   node --use-system-ca sba-load.js --download --commit  # fetch what is missing, a minute apart
//   node --use-system-ca sba-load.js --load --commit      # read the files on disk into formd.db; no request
'use strict';
const P = require('./ppp-load.js');

// The quarterly release named in the file names (as of 2026-09-30). A newer
// release has new names: change ASOF; files already read are not read again.
const ASOF = '260930';
const BASE = 'https://data.sba.gov/sites/default/files/uploaded_resources/';
const FILES = ['FOIA_7a_FY1991_FY1999', 'FOIA_7a_FY2000_FY2009', 'FOIA_7a_FY2010_FY2019', 'FOIA_7a_FY2020_Present',
  'FOIA_504_FY1991_FY2009', 'FOIA_504_FY2010_Present'].map((f) => `${f}_asof_${ASOF}.csv`);

if (require.main === module) {
  const opts = P.options(process.argv);
  let unlock = () => {};
  (async () => {
    if (opts.commit) unlock = P.lock();
    const deps = { ...P.fileDeps(/BorrName/i), files: FILES, base: BASE };
    let r = { ok: true };
    if (opts.download || !opts.load) r = await P.download(opts, deps);
    if (opts.load) r = await require('./sbaload-read.js').load(opts, deps);
    if (!r.ok) process.exitCode = 1;
    unlock();
  })().catch((e) => { console.error(e.message); unlock(); process.exit(1); });
}

module.exports = { FILES, BASE, ASOF };
