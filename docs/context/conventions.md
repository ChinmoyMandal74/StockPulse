## Conventions
- All persistence goes through `db.js` — never reintroduce `fs` reads/writes for state; a serverless filesystem discards them
- No build step — vanilla JS, plain CSS. The design system lives in `public/app.css`; each page keeps only its own layout in one inline `<style>` block
- Admin-only UI elements use class `admin-only` — toggled by `applyAdminUI()` in index.html
- **The CSV export was removed on 2026-09-14** (the owner had planned to retire it; it was the one bulk-copy button in the UI and fell with the watermark work). `esc()` — the escaper scoped inside it that twice caused bugs — went with it; `we()` is now the page's only escaper. Older notes in this file about CSV headers naming the weighting/horizon describe the removed feature.
