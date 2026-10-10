// docs/backlog.md, read into rows -- the parsing and nothing else.
// No network, no database: the earngrowth.js / secfacts.js shape, so every
// rule here is testable with no server. server.js finds the file and hands
// the text over, with its own markdown renderer.
//
// THE MARKDOWN FILE IS THE BACKLOG. This is a reading of it for the admin page
// at /backlog, not a second copy: an entry is added, changed or closed by
// editing docs/backlog.md, which is also the file a session is told to read
// before proposing work. A table in the database was the other way to build
// this, and it would have been a second place for the same thirty entries to
// be wrong in.
//
// WHAT AN ENTRY IS, in the file:
//
//   ## 12. The title, perhaps with a dash — and a date at the end 2026-09-27
//
//   *Area: Data · Status: Open · Note: optional, one sentence*
//
//   ...the entry, in markdown...
//
// The filing line is optional. Without it the entry still shows, as Open and
// unfiled, rather than vanishing -- a missing line is a thing to notice on
// the page, not a reason to hide the work.
(function (root) {
  'use strict';

  const STATUSES = ['Open', 'Partly done', 'Parked', 'Done'];
  const DATE = /\d{4}-\d{2}-\d{2}/g;
  const META = /^\*Area:\s*([^·*]+?)\s*·\s*Status:\s*([^·*]+?)\s*(?:·\s*Note:\s*(.+?)\s*)?\*$/;

  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Markdown marks out of a line of prose, for the one-line summary.
  const plain = (s) => String(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim();
  const clip = (s, n) => {
    if (s.length <= n) return s;
    const cut = s.slice(0, n);
    const at = cut.lastIndexOf(' ');
    return (at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '') + '…';
  };

  // The title, and the date the heading carries. A heading reads "Title — date"
  // or "Title — parked 2026-09-24": where the part after the LAST dash holds a
  // date it is filing, not title. A dash with no date after it is the title's
  // own ("The PEAD study — the best untested idea this project has").
  function heading(text) {
    const dates = text.match(DATE);
    const date = dates ? dates[dates.length - 1] : null;
    const at = text.lastIndexOf(' — ');
    if (at > 0 && DATE.test(text.slice(at))) { DATE.lastIndex = 0; return { title: text.slice(0, at).trim(), date }; }
    DATE.lastIndex = 0;
    return { title: text.trim(), date };
  }

  // A pipe table, which the site's renderer does not draw. Cells are escaped
  // first, then given bold and code and nothing else.
  function table(lines) {
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const inline = (c) => esc(c)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const head = cells(lines[0]);
    const body = lines.slice(2).map(cells);
    return '<div class="bk-tw"><table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'
      + body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  // The entry's own markdown as HTML: the caller's renderer for prose, and
  // table() for the pipe tables between it.
  function html(body, render) {
    const lines = body.split('\n');
    const out = [];
    let buf = [];
    const flush = () => { if (buf.join('').trim()) out.push(render(buf.join('\n'))); buf = []; };
    for (let i = 0; i < lines.length; i++) {
      const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || '');
      if (isRow(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        flush();
        const t = [];
        while (i < lines.length && isRow(lines[i])) t.push(lines[i++]);
        i--;
        out.push(table(t));
      } else buf.push(lines[i]);
    }
    flush();
    return out.join('\n');
  }

  // The first thing the entry SAYS: its first paragraph, or its first list
  // item where it opens on a list. A status banner (a blockquote) is skipped,
  // since it is about the entry rather than what the entry is.
  function summary(body) {
    const lines = body.split('\n');
    let para = [];
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) { if (para.length) break; continue; }
      if (/^>/.test(l) || /^#{1,6}\s/.test(l) || /^\|/.test(l) || /^```/.test(l)) { if (para.length) break; continue; }
      const item = /^[-*]\s+(.*)$/.exec(l);
      if (item) { if (para.length) break; para.push(item[1]); continue; }
      para.push(l);
    }
    return clip(plain(para.join(' ')), 230);
  }

  function parse(md, render) {
    const text = String(md || '').replace(/\r\n/g, '\n');
    const rend = typeof render === 'function' ? render : (s) => '<pre>' + esc(s) + '</pre>';
    const parts = text.split(/^(?=## )/m);
    const entries = [];
    let notHtml = '';
    for (const part of parts) {
      const nlAt = part.indexOf('\n');
      const first = (nlAt < 0 ? part : part.slice(0, nlAt)).trim();
      let rest = nlAt < 0 ? '' : part.slice(nlAt + 1);
      const m = /^## (\d+)\.\s+(.+)$/.exec(first);
      if (!m) {
        if (/^## What is deliberately NOT/i.test(first)) notHtml = html(rest.replace(/\n---\s*$/, ''), rend);
        continue;
      }
      // An entry ends at the rule before the next heading.
      rest = rest.replace(/\n---\s*\n*$/, '\n');
      let area = null, status = 'Open', note = null, filed = false;
      const lines = rest.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const mm = META.exec(lines[i].trim());
        if (mm) {
          area = mm[1].trim();
          const s = STATUSES.find((x) => x.toLowerCase() === mm[2].trim().toLowerCase());
          // A status the page does not know is shown as written, never
          // silently turned into Open.
          status = s || mm[2].trim();
          note = mm[3] ? mm[3].trim() : null;
          filed = true;
          lines.splice(i, 1);
        }
        break;                       // only the first line that says anything
      }
      const body = lines.join('\n').trim();
      const h = heading(m[2]);
      entries.push({
        n: Number(m[1]), title: plain(h.title), date: h.date,
        area: area || 'Unfiled', status, note, filed,
        summary: summary(body),
        words: body ? body.split(/\s+/).length : 0,
        html: html(body, rend),
      });
    }
    return { entries, notHtml, statuses: STATUSES.slice() };
  }

  const api = { parse, STATUSES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Backlog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
