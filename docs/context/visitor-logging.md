## Visitor logging
- Every `GET /` inserts a row into the `visitors` table (fire-and-forget, so a logging failure can't block the page)
- Fields: `ts`, `ip`, `ua` (user-agent), `ref` (referrer)
- Admin-only endpoint: `GET /api/visitors` — returns summary + last 500 entries
- Admin-only page: `/visitors` — same visual system as the screener

