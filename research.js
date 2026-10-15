// docs/research.md, read into rows -- the parsing and nothing else.
// No network, no database, so every rule is testable with no server. The
// heading, table and summary readers are backlog.js's own: the two files are
// written the same way and must be read the same way.
//
// WHAT AN ENTRY IS, in the file:
//
//   ## 14. The title — 2026-10-15
//
//   *Family: Mean reversion · Verdict: One period only · Horizon: 1 month · Data: Daily prices · Sample: ...*
//
//   ### The idea
//   ### What was done
//   ### Outcome
//   ### What follows
//   ### Caveats        (optional)
//   ### Numbers        (optional)
//
// The four named sections are the page's columns; the first paragraph of each
// is what the row shows. An entry missing its filing line or a section still
// shows, with a dash, and the page counts it: a gap is a thing to notice.
(function (root) {
  'use strict';
  const B = (typeof module !== 'undefined' && module.exports) ? require('./backlog.js') : root.Backlog;

  const VERDICTS = ['Weak lead', 'One period only', 'No edge', 'Wrong way', 'Used for display', 'Not yet tested'];
  const SECTIONS = { 'the idea': 'idea', 'what was done': 'done', 'outcome': 'outcome', 'what follows': 'follows',
    'caveats': 'caveats', 'numbers': 'numbers' };
  const FILING = /^\*([A-Za-z]+:[^*]+)\*$/;

  // "Family: X · Verdict: Y · ..." into { family, verdict, ... }. Any key is
  // kept, so a new one in the file needs no change here to be carried.
  function filing(line) {
    const m = FILING.exec(line.trim());
    if (!m) return null;
    const out = {};
    for (const part of m[1].split('·')) {
      const at = part.indexOf(':');
      if (at < 1) continue;
      out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
    return out.verdict || out.family ? out : null;
  }

  function parse(md, render) {
    const text = String(md || '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
    const rend = typeof render === 'function' ? render : (s) => '<pre>' + B.esc(s) + '</pre>';
    const parts = text.split(/^(?=## )/m);
    const entries = [];
    // Everything before the first entry is the file's preamble: shown above
    // the table as the method every entry shares.
    let introHtml = '';
    for (const part of parts) {
      const nlAt = part.indexOf('\n');
      const first = (nlAt < 0 ? part : part.slice(0, nlAt)).trim();
      const rest = nlAt < 0 ? '' : part.slice(nlAt + 1);
      const m = /^## (\d+)\.\s+(.+)$/.exec(first);
      if (!m) {
        if (!entries.length) introHtml = B.html(part.replace(/^# .*\n/, '').trim(), rend);
        continue;
      }
      const lines = rest.replace(/\n---\s*\n*$/, '\n').split('\n');
      let meta = null;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        meta = filing(lines[i]);
        if (meta) lines.splice(i, 1);
        break;
      }
      const body = lines.join('\n').trim();
      // Sections, by their ### heading. Text before the first is kept in the
      // full body but belongs to no column.
      const sec = {};
      let key = null;
      for (const l of body.split('\n')) {
        const h = /^###\s+(.+?)\s*$/.exec(l);
        if (h) { key = SECTIONS[h[1].toLowerCase()] || null; if (key) sec[key] = ''; continue; }
        if (key) sec[key] += l + '\n';
      }
      const h = B.heading(m[2]);
      const v = meta && meta.verdict ? VERDICTS.find((x) => x.toLowerCase() === meta.verdict.toLowerCase()) || meta.verdict : null;
      const e = {
        n: Number(m[1]), title: B.plain(h.title), date: h.date,
        verdict: v || 'Unfiled', family: (meta && meta.family) || 'Unfiled',
        horizon: (meta && meta.horizon) || null, data: (meta && meta.data) || null, sample: (meta && meta.sample) || null,
        filed: !!meta,
        html: B.html(body, rend),
      };
      for (const k of ['idea', 'done', 'outcome', 'follows']) e[k] = sec[k] ? B.summary(sec[k]) : null;
      e.hasCaveats = !!(sec.caveats && sec.caveats.trim());
      e.hasNumbers = !!(sec.numbers && sec.numbers.trim());
      e.missing = ['idea', 'done', 'outcome', 'follows'].filter((k) => !e[k]);
      entries.push(e);
    }
    return { entries, introHtml, verdicts: VERDICTS.slice() };
  }

  const api = { parse, filing, VERDICTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Research = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
