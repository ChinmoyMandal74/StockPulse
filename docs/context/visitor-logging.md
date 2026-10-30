## Visitor logging
- Every `GET /` inserts a row into the `visitors` table (fire-and-forget, so a logging failure can't block the page)
- Fields: `ts`, `ip`, `ua` (user-agent), `ref` (referrer)
- Admin-only endpoint: `GET /api/visitors` — returns summary + last 500 entries
- Admin-only page: `/visitors` — same visual system as the screener

- Admin visits are not logged (2026-10-30, owner's request): the signed-in branch of `GET /` skips `logVisit` when `isAdmin(req)`, so neither an admin account nor an `ADMIN_PASSWORD` session writes a row. Members and guests still do. Rows written before that date are kept.
