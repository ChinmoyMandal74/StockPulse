// Paper competitions: the rules and the arithmetic, nothing else (2026-11-11,
// the owner: "add a concept of paper position teams and competition ..
// ranking .. winners"). No database and no network; server.js reads the
// competitions, teams and ledgers and hands them over.
//
// THE OWNER'S CALLS (2026-11-11): rankings and a winner are allowed HERE ONLY,
// for members' pretend accounts inside a competition; stocks are never ranked
// and nothing says buy or sell (a position is opened and closed, as on
// /paper). The admin runs each competition (name, first and last day,
// starting amount); members enter on their own or as a team. A team decides
// whether others see its positions, and by default they do. No prizes.
//
// A TEAM IS ONE SHARED PAPER ACCOUNT, an entrant on their own a team of one.
// Its ledger is the ordinary paper ledger (paper.js) under the key 'team:<id>',
// so the arithmetic is the one /paper uses. Fills are live only: no dated
// entries, which would let an entrant open a position at a price already
// known to have risen. Trading is open from the first day to the last
// (New York days); after the last day the account is valued at that day's
// close and the standings are final.
(function (root) {
  'use strict';

  const MAX_TEAM = 5;            // members a team
  const MAX_TEAMS = 500;         // teams a competition
  const MAX_DAYS = 400;          // the longest a competition may run
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I
  const teamKey = (id) => 'team:' + Number(id);

  // 'upcoming', 'running' or 'ended' on a New York day.
  function status(comp, today) {
    if (!comp) return null;
    if (today < comp.start_d) return 'upcoming';
    if (today > comp.end_d) return 'ended';
    return 'running';
  }

  // A name a member types: a team's, or the one shown beside them. Letters,
  // digits, spaces and . - ' & only, trimmed, no run of spaces. A
  // competition's name (the admin's, `wide`) may also have ( ) : , and #.
  function cleanName(v, min, max, wide) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (s.length < min || s.length > max) return { error: 'Use ' + min + ' to ' + max + ' characters.' };
    if (!(wide ? /^[\p{L}\p{N} .'&():,#-]+$/u : /^[\p{L}\p{N} .'&-]+$/u).test(s)) {
      return { error: 'Use letters, numbers, spaces and . - \' &' + (wide ? ' ( ) : , #' : '') + ' only.' };
    }
    return { name: s };
  }
  const teamName = (v) => cleanName(v, 2, 30);
  const shownName = (v) => cleanName(v, 2, 24);

  // A competition the admin sets up: a name, two days and an amount.
  function checkComp(b, today) {
    const n = cleanName(b && b.name, 3, 60, true);
    if (n.error) return { error: 'Name: ' + n.error };
    const s = String((b && b.start) || ''), e = String((b && b.end) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return { error: 'Choose a first and a last day.' };
    if (e < s) return { error: 'The last day is before the first.' };
    if (e < today) return { error: 'The last day has already passed.' };
    const days = Math.round((Date.parse(e + 'T12:00:00Z') - Date.parse(s + 'T12:00:00Z')) / 86400000);
    if (days > MAX_DAYS) return { error: 'A competition runs ' + MAX_DAYS + ' days at most.' };
    const cash = Math.round(Number(String(b && b.startCash != null ? b.startCash : '').replace(/[$,\s]/g, '')));
    if (!(cash >= 1000) || cash > 10000000) return { error: 'Choose a starting amount between $1,000 and $10,000,000.' };
    return { name: n.name, start_d: s, end_d: e, start_cash: cash };
  }

  // An invite code: eight characters from `bytes` (random, from the caller).
  function codeFrom(bytes) {
    let s = '';
    for (let i = 0; i < 8; i++) s += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    return s;
  }
  const normCode = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // THE STANDINGS. `entries` is [{ team, members, summary }] where `summary`
  // is paper.js's summarise (running) or the final valuation (ended), each
  // with startCash and equity. Ranked by return, highest first; equal returns
  // (to a hundredth of a percent) share a place, and the next place skips, as
  // in any table. `viewerTeam` is the viewer's own team id: its positions are
  // always shown to it; another team's only if it chose to show them.
  function standings(entries, viewerTeam, ended) {
    const rows = (entries || []).map((x) => {
      const s = x.summary || {};
      const start = Number(s.startCash) || 0;
      const eq = Number(s.equity);
      const ret = start > 0 && isFinite(eq) ? eq / start - 1 : null;
      const mine = viewerTeam != null && Number(x.team.id) === Number(viewerTeam);
      const show = mine || !!x.team.show_positions;
      return {
        teamId: Number(x.team.id), team: x.team.name, mine,
        members: (x.members || []).map((m) => m.display_name),
        value: isFinite(eq) ? eq : null, ret, cash: isFinite(Number(s.cash)) ? Number(s.cash) : null,
        count: (s.positions || []).length, trades: Number(x.trades) || 0,
        positions: show ? (s.positions || []).map((p) => ({ symbol: p.symbol, name: p.name || null, shares: p.shares,
          value: p.value, weight: eq > 0 ? p.value / eq : null, gainPct: p.gainPct })) : null,
        shown: show,
      };
    });
    const key = (r) => (r.ret == null ? -Infinity : Math.round(r.ret * 10000));
    rows.sort((a, b) => key(b) - key(a) || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0));
    let place = 0;
    rows.forEach((r, i) => {
      if (i === 0 || key(r) !== key(rows[i - 1])) place = i + 1;
      r.rank = r.ret == null ? null : place;
    });
    // The winner, once the competition has ended: the highest return among
    // the entrants that opened at least one position (an untouched account
    // cannot win by sitting in cash while everyone else fell); a tie is
    // shared.
    const traded = rows.filter((r) => r.trades > 0 && r.ret != null);
    const top = traded.length ? key(traded[0]) : null;
    rows.forEach((r) => { r.winner = !!ended && top != null && r.trades > 0 && r.ret != null && key(r) === top; });
    return rows;
  }

  // The final value of an account: its last point on or before the last day
  // in paper.js's history (each close since the start). Null with no close.
  function finalOf(hist, endDay) {
    let last = null;
    for (const p of hist || []) if (p.d <= endDay) last = p;
    return last;
  }

  const api = { MAX_TEAM, MAX_TEAMS, MAX_DAYS, teamKey, status, teamName, shownName, checkComp, codeFrom, normCode, standings, finalOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Compete = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
