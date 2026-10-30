# The scheduled jobs' machine on Fly.io (fly/cron.js). Only the ping scripts
# and schedule.js go in: they need nothing beyond Node itself.
FROM node:24-slim
WORKDIR /app
COPY schedule.js nightlysteps.js nightly-ping.js intraday-ping.js news-ping.js digest-ping.js ./
COPY fly/cron.js fly/
CMD ["node", "fly/cron.js"]
