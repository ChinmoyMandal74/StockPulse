#!/usr/bin/env node
// The daytime updates of /briefs (2026-11-12, the owner: "May be refresh the
// news 3 or 4 times a day"): the same ping as the evening briefs, publishing
// only (no email, the evening's mark untouched). Run by the scheduler on
// Fly.io at 08:40, 11:40 and 14:40 Eastern on weekdays (job `newsbrief-update`
// in schedule.js); the 17:40 run of news-brief-ping.js sends the emails and
// publishes the evening edition. One HTTP call, NOT `node server.js`.
'use strict';
process.argv.push('--publish');
require('./news-brief-ping.js');
