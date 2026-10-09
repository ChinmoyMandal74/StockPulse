## API patterns
- `GET /api/stocks` — serves snapshot to public; `?refresh=1` recomputes live (admin only)
- `GET /api/stocks?asOf=YYYY-MM-DD` — the forward-returns view (admin only)
- `POST /api/refresh-all` — expires the profile cache, forces re-pull (admin only); `DELETE` ends the refresh flag
- `GET /api/status` — `{ refreshing }` only; polled by every open page during a refresh
- `POST /api/cron/refresh` — the nightly job's one round (bearer `CRON_SECRET`, not admin); `?start=1` begins a run, `DELETE` ends one early
- All portfolio/ticker CRUD routes require admin

