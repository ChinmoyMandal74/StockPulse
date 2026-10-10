## The backlog page — every story as a row (2026-10-10, owner's request)

**`/backlog`, admin only, linked from the console beside the Build log.** Asked as *"a nice looking page on all backlog stories, maybe keep the backlog data in a table and link the page to admin"*.

### The markdown file is the data
**`docs/backlog.md` is the backlog; the page is a reading of it.** A database table was the other way to build this and was not taken: the same thirty entries would then live in two places, and the file is the one a session is told to read before proposing work. A story is added, changed or closed by editing the file and pushing, which is also the deploy. If stories ever need editing FROM the page, that is when a table earns its keep.

- **One line of filing data under each heading**, which the page reads for its Area and Status columns:

      *Area: Promo · Status: Open · Note: optional, one sentence*

  Status is Open, Partly done, Parked or Done. All thirty entries were filed when the page was built. **An entry without the line still shows**, as Open and Unfiled, and the page's footnote counts them: a missing line is something to notice, not a reason to hide the work. A status the page does not know is shown as written, never turned into Open.
- **Three entries were found stale while filing them** and are marked Done or Partly done with a note saying what changed, their bodies left as written: 11 (Google sign-in has shipped), 12 (the insider table is three days behind, not 89) and 13 (`onboard.js` exists; insider trades are still a separate step).

### How it is read
- **`backlog.js`** is the parser and nothing else (pure, the `earngrowth.js` shape): `parse(md, render)` returns `{ entries, notHtml, statuses }`. Each entry carries `n`, `title`, `date`, `area`, `status`, `note`, `filed`, `summary`, `words` and `html`.
  - A heading reads "Title — date" or "Title — parked 2026-09-24": where the part after the LAST dash holds a date it is filing, not title. A dash with no date after it is the title's own ("The PEAD study — the best untested idea this project has").
  - The summary is the first paragraph, or the first list item where an entry opens on a list. **A status banner (a blockquote) is skipped**, since it is about the entry rather than what the entry is.
  - Bodies go through the site's own `renderMarkdown`, which escapes first. It does not draw pipe tables, so `backlog.js` renders those itself (cells escaped, then bold and code only).
- **`GET /api/backlog`** (`requireAdmin`), cached ten minutes, `?fresh=1` to read again.
- **Two places to find the file, in order.** The copy beside `server.js`, which exists locally and on Vercel only if the build traced it into the function: `private/` is bundled because the server lists it at boot, and nothing promises the same for `docs/`. Where it is missing, the same text is fetched from the public repository's `main` branch (`raw.githubusercontent.com`, 200 when checked). The response says which was used (`source`) and the page prints it. **Local works either way; only production can exercise the second half.**

### The page
- Four count cards (Open, Partly done, Parked, Done) that are also the status filter; a search box; an Area picker; sortable columns. A row opens in place to the full entry. `/backlog#17` opens story 17.
- Undated stories (the first eight, written before entries carried dates) show a dash and sort last by date either way.
- The file's closing section, "What is deliberately NOT on this list", is shown under the table.
- Its shell is the Database page's. Everything it adds is prefixed `bk-`.
- Verified: 27 checks in Node (`bl-test.js` in the session scratchpad) — the parser on fixtures, then the real file through the real renderer lifted out of server.js: thirty stories, all filed, only ordinary document tags, no script or handler. **The page itself was not rendered.**
