// cards.js — every card the studio and the member Cards page draw, built
// once and shared. The pages own their chrome, their controls and their
// export; this module owns the CARD: its markup, its styles and the wording
// on it. Two copies of "Top gainers this week" would have drifted inside a
// week, which is the same reason rowcard.js, screens.js and action.js exist.
//
// Contract: Cards.build(id, ctx) -> HTML string for the card's inner body.
//   ctx.stocks    the snapshot rows (scored, with prevTech)
//   ctx.myLists   the caller's own portfolios, { name: [symbols] }
//   ctx.size      { id, w, h } — the artboard the card is being drawn into
//   ctx.opts      the control values, by control id (movPeriod, chtWin, ...)
//   ctx.getBasket (days) -> the /api/basket payload or null while it loads
// The module reads no DOM and issues no requests: a host that hands it
// numbers gets a card back, which is what makes it testable off-page.
(function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let stocks = [];
  let myLists = {};
  let size = { id: 'portrait', w: 1080, h: 1350 };
  let O = {};                       // control values, by control id
  let getBasket = () => null;

    const dateStr = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    // dated: true for the data cards, whose numbers belong to a day. The
    // explainers are evergreen, so they carry no date — and no universe
    // count anywhere, since a post outlives the number.
    function chromeTop(dated) {
      return '<div class="s-top">' +
        '<span class="s-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M3 17.4 8.6 12l3.6 2.7L20 6.4"/><path d="M14.6 6.4H20v5.4"/></svg></span>' +
        '<span class="s-word">Tickr Lab</span>' +
        (dated === false ? '' : `<span class="s-date">${esc(dateStr())}</span>`) + '</div>';
    }
    function chromeFoot() {
      return '<div class="s-foot"><b>tickrlab.com</b><span class="dot"></span>' +
        '<span>Screened nightly</span><span class="dot"></span>' +
        '<span>Mechanical readings — not investment advice</span></div>';
    }
    const pct = (n, d = 1) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%');

    // ---- templates ---------------------------------------------------------
    // Gainers and losers are separate cards on purpose — the owner's call:
    // a mixed |move| list buries the story either half tells alone.
    const MOV_PERIODS = {
      d: ['todayPct', 'today', 'today'],
      // Week and 1 month are ROLLING: five and 21 sessions back, i.e. the last
      // 7 and ~30 days. "This week" and "this month" run from the last close
      // before the week or month began; the host stamps wtdPct / mtdPct from
      // /api/period-anchors, and a row without one is simply not ranked.
      wtd: ['wtdPct', 'this week', 'week to date'],
      w1: ['oneWeekPct', 'past week', '7 days'],
      w2: ['twoWeekPct', 'past two weeks', '2 weeks'],
      mtd: ['mtdPct', 'this month', 'month to date'],
      m1: ['oneMonthPct', 'past month', '30 days'],
      m3: ['threeMonthPct', 'past three months', '3 months'],
      m6: ['sixMonthPct', 'past six months', '6 months'],
      y1: ['oneYearPct', 'past year', '1 year'],
    };
    // Every card answers "which stocks?" the same way — a list, then
    // optionally a sector, then optionally an industry inside it — so it is
    // answered in one place. The label is
    // built here too, since a card whose kicker disagreed with its rows
    // would be worse than no kicker at all.
    function scopeOf(scopeKey, sectorKey) {
      const v = O[scopeKey] || 'All';
      let rows, label;
      if (v === 'All') { rows = stocks; label = 'the whole screen'; }
      else if (v.startsWith('my:')) {
        const nm = v.slice(3);
        const set = new Set(myLists[nm] || []);
        rows = stocks.filter((x) => set.has(x.symbol));
        label = nm;
      } else {
        rows = stocks.filter((x) => (x.portfolios || []).includes(v));
        label = v;
      }
      const sec = O[sectorKey] || 'All';
      // The industry control sits under each sector one and shares its
      // prefix (movSector -> movIndustry). A host without it filters nothing.
      const ind = O[sectorKey.replace(/Sector$/, 'Industry')] || 'All';
      if (sec && sec !== 'All') rows = rows.filter((x) => x.sector === sec);
      if (ind && ind !== 'All') rows = rows.filter((x) => x.industry === ind);
      // The kicker names the narrowest cut: an industry already implies its
      // sector, and "Technology · Semiconductors" costs width a card lacks.
      const cut = ind && ind !== 'All' ? ind : sec && sec !== 'All' ? sec : null;
      if (cut) label = v === 'All' ? cut : `${label} \u00b7 ${cut}`;
      return { rows, label };
    }
    const movScopeRows = () => scopeOf('movScope', 'movSector');
    // A feed reads a company name faster than a ticker, and the screener now
    // carries one. Every card labels by it, falling back to the full name and
    // then the ticker. The CHART is the deliberate exception: its legend
    // chips and end tags sit in inches of space beside a drawn line, where a
    // four-letter code is the only thing that fits.
    const nameOf = (x) => (x && (x.shortName || x.name || x.symbol)) || '';
    const symOf = (sym) => {
      const r = stocks.find((x) => x.symbol === sym);
      return r ? nameOf(r) : sym;
    };
    const movLabel = nameOf;

    function tplMovers() {
      const perKey = O.movPeriod;
      const [field, periodLabel, shortLabel] = MOV_PERIODS[perKey] || MOV_PERIODS.w1;
      // The comparison is context, never the ranking: picking the same window
      // twice would only print a column against itself, so it is ignored.
      const cmpKey = O.movCmp;
      const cmp = cmpKey && cmpKey !== perKey && O.movDir !== 'split'
        ? MOV_PERIODS[cmpKey] : null;
      const n = Number(O.movCount) || 10;
      const dir = O.movDir;                 // 'up' | 'down' | 'both' | 'split'
      const split = dir === 'split';
      const both = dir === 'both';
      const up = dir !== 'down';
      const scope = movScopeRows();

      // Both, side by side: two rankings on one card rather than one mixed
      // list. The bars share a scale across the columns, so a +9% and a -9%
      // draw the same length and the two halves stay comparable.
      if (split) {
        const cap = size.id === 'story' ? 20 : 15;
        const k = Math.min(n, cap);
        // Past ten a side the rows tighten rather than overflow the card.
        const dense = k > 10 ? ' dense' : '';
        const ups = scope.rows.filter((x) => x[field] > 0)
          .sort((a, b) => b[field] - a[field]).slice(0, k);
        const downs = scope.rows.filter((x) => x[field] < 0)
          .sort((a, b) => a[field] - b[field]).slice(0, k);
        const mx = Math.max(...ups.concat(downs).map((x) => Math.abs(x[field])), 0.01);
        const col = (title, list, neg) =>
          `<div class="mcol"><div class="mch ${neg ? 'neg' : 'pos'}">${esc(title)}</div>` +
          (list.length ? list.map((x) => {
            const w = Math.max(6, Math.round(Math.abs(x[field]) / mx * 100));
            return `<div class="mrow"><span class="ms">${esc(movLabel(x))}</span>` +
              `<span class="bar-rail"><span class="bar${neg ? ' neg' : ''}" style="width:${w}%;display:block"></span></span>` +
              `<span class="mv ${neg ? 'neg' : 'pos'}">${pct(x[field])}</span></div>`;
          }).join('') : '<div class="mnone">nothing moved that way</div>') +
          '</div>';
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 ${esc(periodLabel)}</span>` +
          '<h2 class="s-title">Up and down<br><span class="dim">' + esc(periodLabel) + '</span></h2>' +
          `<div class="twocol${dense}">${col('Gainers', ups, false)}${col('Losers', downs, true)}</div>` +
          '</div></div>' + chromeFoot();
      }
      // The verdict beside the move. Off unless a rule set is picked, and
      // the card names which one: "Strong Buy" means nothing without the
      // rules behind it, which is the line this whole product is built on.
      // Only the single-column layouts carry it — the side-by-side card
      // already runs two rankings in half the width apiece, and a verdict on
      // every row there would bury the moves it exists to show.
      const advPick = O.movAdv && O.movAdv !== 'off' ? O.movAdv : null;
      const advProf = advPick ? (ADV_PROFILES.indexOf(advPick) >= 0 ? advPick : 'Balanced') : null;
      const advOf = advProf ? advScored(advProf) : null;
      // A row with no verdict — an ETF, or one the rules cannot score —
      // simply has no second line, rather than an em-dash under its name.
      const advWord = (s) => (advOf && (advOf[s.symbol] || {}).action) || null;

      const rows = scope.rows
        .filter((s) => s[field] != null && (both || (up ? s[field] > 0 : s[field] < 0)))
        // 'both' ranks by SIZE of move, so a -9% sits beside a +9%; the
        // single-direction cards rank by the move itself
        .sort((a, b) => (both ? Math.abs(b[field]) - Math.abs(a[field])
          : up ? b[field] - a[field] : a[field] - b[field]))
        .slice(0, n);
      const max = Math.max(...rows.map((s) => Math.abs(s[field])), 0.01);
      // A card is a fixed artboard and cannot scroll: a list too tall for it
      // does not clip, it sits on top of the masthead, because .s-body
      // centres its content. So the rhythm steps down until the ranking
      // fits — the same problem the side-by-side card solved with `dense`,
      // which the ranked list turned out to need too the moment a verdict
      // line could appear under every name. ROOM is the artboard minus the
      // chrome, the kicker, the title and the list's own top margin, with
      // headroom left over because these are estimates and a wrapped title
      // is not.
      const ROOM = { portrait: 840, square: 580, story: 1330 };
      const RHYTHM = [
        { cls: '', row: advOf ? 42 : 40, gap: 16 },
        { cls: ' tight', row: advOf ? 36 : 32, gap: 11 },
        { cls: ' tighter', row: advOf ? 32 : 26, gap: 8 },
      ];
      // the comparison column brings a header row and a caption with it
      const room = (ROOM[size.id] || ROOM.portrait) - (cmp ? 140 : 0);
      const fits = (r, k) => Math.max(0, k * r.row + (k - 1) * r.gap) <= room;
      const rhythm = RHYTHM.find((r) => fits(r, rows.length)) || RHYTHM[RHYTHM.length - 1];
      // Even the tightest rhythm has a ceiling. A square artboard cannot hold
      // fifteen rows, a comparison column AND a verdict under every name at
      // any size still legible once a feed has shrunk the card — so the list
      // is trimmed rather than painted over the masthead, the same per-shape
      // cap the side-by-side card takes. The rows are sorted by the move, so
      // what goes is always the smallest of them, and the title says "Top
      // gainers" rather than a count, so nothing on the card becomes untrue.
      while (rows.length > 3 && !fits(rhythm, rows.length)) rows.pop();
      const head = cmp
        ? '<div class="rowhead"><span class="nm2"></span><span class="bar-rail"></span>' +
          `<span class="val">${esc(shortLabel)}</span><span class="cmp">${esc(cmp[2])}</span></div>`
        : '';
      const body = rows.length
        ? `<div class="rows${rhythm.cls}">${head}${rows.map((s) => {
            const w = Math.max(6, Math.round(Math.abs(s[field]) / max * 100));
            const neg = both ? s[field] < 0 : !up;   // each row by its own sign when mixed
            const c = cmp ? s[cmp[0]] : null;
            const av = advWord(s);
            const label = advOf
              ? `<span class="nm2 stack"><span class="nn">${esc(movLabel(s))}</span>` +
                (av ? `<span class="av" style="color:${ADV_TINT[av] || 'var(--muted)'}">${esc(av)}</span>` : '') +
                '</span>'
              : `<span class="nm2">${esc(movLabel(s))}</span>`;
            return `<div class="row">${label}` +
              `<span class="bar-rail"><span class="bar${neg ? ' neg' : ''}" style="width:${w}%;display:block"></span></span>` +
              `<span class="val ${neg ? 'neg' : 'pos'}">${pct(s[field])}</span>` +
              (cmp ? `<span class="cmp ${c == null ? '' : c < 0 ? 'neg' : 'pos'}">${pct(c)}</span>` : '') +
              '</div>';
          }).join('')}</div>` +
          (cmp ? `<p class="s-sub" style="font-size:18px;margin-top:22px">Ranked on ${esc(periodLabel)}; the right column is the same stock over the ${esc(cmp[1].replace(/^(this|past) /, ''))}, for context.</p>` : '')
        : `<p class="s-empty">Nothing in ${esc(scope.label)} moved ${both ? 'at all' : (up ? 'up' : 'down')} ${esc(periodLabel)} \u2014 which is its own kind of story.</p>`;
      const title = both
        ? 'The biggest<br><span class="dim">moves</span>'
        : `Top ${up ? 'gainers' : 'losers'}<br><span class="dim">${esc(periodLabel)}</span>`;
      // The rule set is named in the kicker rather than in a paragraph: a
      // verdict without the rules behind it is the tip sheet this product
      // refuses to be, and the attribution has to survive on a card where
      // five more lines of prose would push the ranking over the masthead.
      // The footer carries the standing disclaimer either way.
      const kick = `${esc(scope.label)} \u00b7 ${esc(periodLabel)}` +
        (advOf ? ` \u00b7 ${esc(advProf)} rules` : '');
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${kick}</span>` +
        `<h2 class="s-title">${title}</h2>` +
        body + '</div></div>' + chromeFoot();
    }

    // ---- the Advice cards ---------------------------------------------------
    // Four readings of the same thing: the tally, the rules doing the talking,
    // one stock through every profile, and the roll-call at a chosen verdict.
    // All of it reports what a published mechanical rule said — the verdict
    // always travels with the rule that produced it, which is the whole
    // difference between this and a tip sheet.
    const ADV_PROFILES = ['Balanced', 'Trend Rider', 'Aggressive', 'Max Risk', 'Dip Buyer'];
    const ADV_TINT = {
      'Strong Buy': '#34d399', 'Buy': '#a3e635', 'Buy with Risk': '#fbbf24',
      'Hold': '#9aa3b2', 'Avoid': '#fb923c', 'Sell Immediately': '#fb7185',
    };
    const advCache = {};
    // Scored in the browser through the same engine the server uses, so a
    // card can show any profile without a round trip.
    function advScored(profile) {
      if (advCache[profile]) return advCache[profile];
      const res = ActionRules.apply(stocks, {}, profile === 'Balanced' ? undefined : profile);
      const out = {};
      stocks.forEach((s, i) => { if (res[i]) out[s.symbol] = res[i]; });
      advCache[profile] = out;
      return out;
    }
    // Yesterday's verdicts under any profile: the snapshot carries prevTech
    // (the technical readings one bar back) on every row, so the same engine
    // re-run over those inputs gives the previous night's answer — the same
    // second pass the screener's change chevrons use.
    const advPrevCache = {};
    function advScoredPrev(profile) {
      if (advPrevCache[profile]) return advPrevCache[profile];
      const prevRows = stocks.map((s) => (s && s.prevTech ? Object.assign({}, s, s.prevTech) : null));
      const res = ActionRules.apply(prevRows, {}, profile === 'Balanced' ? undefined : profile);
      const out = {};
      stocks.forEach((s, i) => { if (res[i]) out[s.symbol] = res[i]; });
      advPrevCache[profile] = out;
      return out;
    }

    const advScope = () => scopeOf('advScope', 'advSector');

    function tplAdvBoard() {
      const mode = O.advMode;
      const profile = O.advProf || 'Balanced';
      const scored = advScored(profile);
      const scope = advScope();
      const verdict = (s) => (scored[s.symbol] || {}).action || null;
      const flagOf = (s) => (scored[s.symbol] || {}).flag || null;
      const rows = scope.rows.filter((s) => verdict(s));
      const prof = profile === 'Balanced' ? '' : ` \u00b7 ${profile} rules`;

      if (!rows.length) {
        return chromeTop() + `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}${esc(prof)}</span>` +
          '<h2 class="s-title">Nothing<br><span class="dim">scored yet</span></h2></div></div>' + chromeFoot();
      }

      if (mode === 'firing') {
        const tally = {};
        rows.forEach((s) => { const f = flagOf(s); if (f) tally[f] = (tally[f] || 0) + 1; });
        const top = Object.entries(tally).sort((a, b) => b[1] - a[1])
          .slice(0, size.id === 'story' ? 9 : size.id === 'square' ? 5 : 7);
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}${esc(prof)}</span>` +
          '<h2 class="s-title">What the rules<br><span class="dim">are saying</span></h2>' +
          `<div style="margin-top:34px">${top.map(([flag, n]) =>
            `<div class="frule"><span class="fn">\u00d7${n}</span><span class="ft">${esc(flag)}</span>` +
            `<span class="fs">${Math.round(n / rows.length * 100)}% of the list</span></div>`).join('')}</div>` +
          '<p class="s-sub" style="font-size:19px;margin-top:26px">Every verdict names the one rule that fired first. Counting those rules says what kind of market this is \u2014 not what happens next.</p>' +
          '</div></div>' + chromeFoot();
      }

      if (mode === 'changed') {
        const prev = advScoredPrev(profile);
        const tierOf = (a) => ActionRules.ACTIONS.indexOf(a);
        const changes = rows
          .map((s) => ({ sym: s.symbol, from: (prev[s.symbol] || {}).action, to: verdict(s), flag: flagOf(s) }))
          .filter((c) => c.from && c.to && c.from !== c.to);
        if (!changes.length) {
          return chromeTop() +
            `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}${esc(prof)}</span>` +
            '<h2 class="s-title">Every verdict<br><span class="dim">held</span></h2>' +
            '<p class="s-empty">Nothing in this list changed its reading since the last session. The rules only speak when the tape moves \u2014 a quiet night is an answer too.</p>' +
            '</div></div>' + chromeFoot();
        }
        const ups = changes.filter((c) => tierOf(c.to) > tierOf(c.from)).length;
        const downs = changes.length - ups;
        // Grouped by the rule that TOOK OVER: the flag determines the rung,
        // so every row under one heading arrived at the same verdict.
        const byFlag = {};
        changes.forEach((c) => {
          const k = c.flag || '\u2014';
          (byFlag[k] = byFlag[k] || { n: 0, action: c.to, syms: [] }).n++;
          byFlag[k].syms.push(c.sym);
        });
        const top = Object.entries(byFlag).sort((a, b) => b[1].n - a[1].n)
          .slice(0, size.id === 'story' ? 8 : size.id === 'square' ? 4 : 6);
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}${esc(prof)} \u00b7 since the last session</span>` +
          '<h2 class="s-title">What changed<br><span class="dim">tonight</span></h2>' +
          `<div style="margin-top:32px">${top.map(([flag, g]) =>
            `<div class="frule"><span class="fn" style="color:${ADV_TINT[g.action] || 'var(--green)'}">\u00d7${g.n}</span>` +
            `<span class="ft">${esc(flag)}<span style="display:block;font-size:18px;font-weight:500;color:var(--faint);margin-top:4px">` +
            `now ${esc(g.action)} \u00b7 ${esc(g.syms.slice(0, 3).map(symOf).join(', '))}${g.syms.length > 3 ? ` +${g.syms.length - 3}` : ''}</span></span>` +
            '</div>').join('')}</div>` +
          `<p class="s-sub" style="font-size:19px;margin-top:26px">${changes.length} of ${rows.length} verdicts moved \u2014 ` +
          `<span style="color:var(--green)">${ups} up</span>, <span style="color:var(--red)">${downs} down</span>. ` +
          'Same rules as yesterday; only the prices changed.</p>' +
          '</div></div>' + chromeFoot();
      }

      if (mode === 'profiles') {
        const sym = O.advSym || rows[0].symbol;
        const row = stocks.find((r) => r.symbol === sym);
        if (!row) return chromeTop() + '<div class="s-body"><div><p class="s-empty">Pick a stock.</p></div></div>' + chromeFoot();
        const reads = ADV_PROFILES.map((pn) => {
          const r = advScored(pn)[sym];
          return { pn, action: r ? r.action : null, flag: r ? r.flag : null };
        }).filter((r) => r.action);
        const agree = new Set(reads.map((r) => r.action)).size === 1;
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(symOf(sym))} \u00b7 five rule sets</span>` +
          `<h2 class="s-title">${agree ? 'All five<br><span class="dim">agree</span>' : 'Where the rules<br><span class="dim">disagree</span>'}</h2>` +
          `<div style="margin-top:32px">${reads.map((r) =>
            `<div class="pcard"><span class="pn">${esc(r.pn)}</span>` +
            `<span class="pv" style="color:${ADV_TINT[r.action] || 'var(--text)'}">${esc(r.action)}</span>` +
            `<span class="pw">${esc(r.flag || '')}</span></div>`).join('')}</div>` +
          `<p class="s-sub" style="font-size:19px;margin-top:26px">Same stock, same night, five fixed rule sets \u2014 ${agree ? 'and this time they all read it the same way.' : 'and they do not agree. Each names the rule that decided it, so the disagreement is readable rather than mysterious.'}</p>` +
          '</div></div>' + chromeFoot();
      }

      if (mode === 'tier') {
        const want = O.advTier || 'Strong Buy';
        const hits = rows.filter((s) => verdict(s) === want)
          .slice(0, size.id === 'story' ? 11 : size.id === 'square' ? 6 : 8);
        const tint = ADV_TINT[want] || 'var(--text)';
        const body = hits.length
          ? `<div style="margin-top:32px">${hits.map((s) =>
              `<div class="vrow"><span class="vs">${esc(nameOf(s))}</span>` +
              `<span class="vw">${esc(flagOf(s) || '')}</span>` +
              `<span class="vp" style="color:${tint}">${esc(s.actionTrend || '')}</span></div>`).join('')}</div>`
          : `<p class="s-empty">Nothing in ${esc(scope.label)} reads ${esc(want)} tonight.</p>`;
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}${esc(prof)}</span>` +
          `<h2 class="s-title" style="color:${tint}">${esc(want)}</h2>` +
          `<p class="s-sub">What the ${esc(profile)} rules read as ${esc(want)} tonight, each with the rule that decided it.</p>` +
          body +
          '<p class="s-sub" style="font-size:18px;margin-top:24px">A mechanical reading of one table, not a recommendation tailored to anyone.</p>' +
          '</div></div>' + chromeFoot();
      }

      // the board
      const order = ActionRules.ACTIONS.slice().reverse();
      const counts = order.map((a) => rows.filter((s) => verdict(s) === a).length);
      const total = counts.reduce((x, y) => x + y, 0) || 1;
      const max = Math.max(...counts, 1);
      const bull = counts[0] + counts[1] + counts[2];
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}${esc(prof)}</span>` +
        '<h2 class="s-title">Where the rules<br><span class="dim">stand tonight</span></h2>' +
        `<div class="abar">${order.map((a, i) => counts[i]
          ? `<div style="width:${counts[i] / total * 100}%;background:${ADV_TINT[a]}"></div>` : '').join('')}</div>` +
        `<div class="atally">${order.map((a, i) =>
          `<div class="arow"><span class="an" style="color:${ADV_TINT[a]}">${esc(a)}</span>` +
          `<span class="arail"><span class="afill" style="display:block;width:${Math.max(2, counts[i] / max * 100)}%;background:${ADV_TINT[a]}"></span></span>` +
          `<span class="ac">${counts[i]}</span><span class="ap">${Math.round(counts[i] / total * 100)}%</span></div>`).join('')}</div>` +
        `<p class="s-sub" style="font-size:19px;margin-top:28px">${bull} of ${total} clear the buy rules tonight. A reading of the tape by fixed rules \u2014 it says what is, never what is next.</p>` +
        '</div></div>' + chromeFoot();
    }

    // ---- Intro: explainer carousels ---------------------------------------
    // A topic is a list of slides and a slide is a kind plus its payload, so
    // adding an explainer is data, never layout. Every slide carries the same
    // frame — kicker, title, body, dot row — which is what makes a set read
    // as a set. Wording stays inside the house line throughout: it screens
    // and explains, it never recommends.
    const INTRO_ICONS = {
      screen: '<path d="M3 17.4 8.6 12l3.6 2.7L20 6.4"/><path d="M14.6 6.4H20v5.4"/>',
      rules: '<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16.6" r="2.6"/><path d="M18 14v-1.6M18 20.8v-1.6"/>',
      trend: '<path d="M3 19.6h18"/><path d="M4.6 15.2 9.4 9.8l3.4 2.6 6-7"/>',
      ask: '<path d="M12 20.4c4.6 0 8.4-3 8.4-7.2S16.6 6 12 6 3.6 9 3.6 13.2c0 1.9.8 3.6 2.1 4.9L5 21z"/><path d="M8.6 12h6.8M8.6 14.8h4.2"/>',
      guest: '<circle cx="12" cy="8.6" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
      star: '<path d="M12 4.4l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L12 4.4Z"/>',
      list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
      chart: '<path d="M4 19V5M4 19h16"/><path d="M7.5 15.5 11 11l3 2.4 4.4-5.6"/>',
    };

    // One resolved rule set for the explainers, and one real row to explain
    // with: a live Buy beats a mock-up, and the ladder below is that row's
    // own rungs rather than an illustration.
    let introCfg = null;
    const introRules = () => (introCfg = introCfg || ActionRules.resolve({}).cfg);
    function introRow() {
      const pick = (a) => stocks.find((s) => s.action === a && s.actionFlag && s.actionTrend);
      return pick('Buy') || pick('Strong Buy') || pick('Buy with Risk') || pick('Hold')
        || stocks.find((s) => s.action) || null;
    }

    const TOPICS = [
      {
        id: 'what', name: 'What Tickr Lab is',
        slides: [
          { kind: 'cover', kick: 'Introducing', title: 'Tickr Lab',
            sub: 'A momentum screener that shows its work — every score, every verdict, every rule, explained on click.' },
          { kind: 'steps', kick: 'The short version', title: 'Five things<br><span class="dim">it does</span>',
            rows: [
              ['screen', 'var(--green)', 'Screened nightly', 'Momentum and quality scored on a fixed scale after every close — a 7 means the same thing in any market.'],
              ['rules', 'var(--accent)', 'Advice that shows its work', 'Five fixed rule profiles side by side, and every verdict names the ONE rule that fired.'],
              ['trend', 'var(--amber)', 'Twenty years of receipts', 'Trend ribbons, backtests and an indicator lab over the full bar archive — measured, not asserted.'],
              ['ask', 'var(--accent-2)', 'Ask in plain English', 'An assistant that answers from the same table you see — and says so when the data cannot answer.'],
              ['guest', 'var(--red)', 'Try it in one click', 'A guest preview with real stocks and every feature live. No account, no card.'],
            ] },
          { kind: 'close' },
        ],
      },
      {
        id: 'advice', name: 'How Advice works',
        slides: [
          { kind: 'cover', kick: 'How it works', title: 'Advice,<br><span class="dim">explained</span>',
            sub: 'Not a score, not a black box: four readings collapse to one word, and the rule that decided it is always named.' },
          { kind: 'flow' },
          { kind: 'ladder' },
          { kind: 'tiers', kick: 'The whole vocabulary', title: 'Six words,<br><span class="dim">nothing else</span>',
            note: 'The Sell, Avoid and Hold rules sit ABOVE every Buy rule in the source. Loss avoidance is the order of the list, not a setting.' },
          { kind: 'close' },
        ],
      },
      {
        id: 'nope', name: 'What we don’t do',
        slides: [
          { kind: 'cover', kick: 'Where we draw the line', title: 'What this<br><span class="dim">is not</span>',
            sub: 'A screener can describe. It cannot know what happens next — and most of the industry pretends otherwise.' },
          { kind: 'stmts', kick: 'Four refusals', title: 'On purpose',
            rows: [
              ['x', 'No “stocks to buy”', 'The rules read the tape and say what they read. Nobody here is telling you what to own.'],
              ['x', 'No price targets', 'A target is a forecast wearing a decimal point. We do not have one and will not invent one.'],
              ['x', 'No portfolio tracking', 'No shares, no cost basis, no “you are up 4%”. Lists are lists.'],
              ['y', 'Only what we measured', 'Five research ideas were tested and four came back flat. That is written down in the app.'],
            ] },
          { kind: 'close' },
        ],
      },
      {
        id: 'lists', name: 'Build your own lists',
        slides: [
          { kind: 'cover', kick: 'Make it yours', title: 'Your own<br><span class="dim">portfolios</span>',
            sub: 'Star the rows you care about, then read the whole list as one line. Two clicks, no spreadsheet.' },
          { kind: 'mock' },
          { kind: 'steps', kick: 'Three steps', title: 'Star,<br><span class="dim">name, watch</span>',
            rows: [
              ['star', 'var(--amber)', 'Star a row', 'Every row in the screener carries a star. Click it and pick a list — or make one on the spot.'],
              ['list', 'var(--accent)', 'Name your list', 'Up to ten of them, private to your account, following you between machines.'],
              ['chart', 'var(--green)', 'Read it as one line', 'The portfolio page draws your list against the whole screen, with every stock on the same chart.'],
            ] },
          { kind: 'close' },
        ],
      },
    ];
    const topicById = (id) => TOPICS.find((t) => t.id === id) || TOPICS[0];

    function dotRow(n, at) {
      return `<div class="dots">${Array.from({ length: n },
        (_, i) => `<i class="${i === at ? 'on' : ''}"></i>`).join('')}</div>`;
    }

    function slideSteps(sl) {
      const rows = (size.id === 'square' ? sl.rows.slice(0, 4) : sl.rows);
      return `<div class="rows" style="margin-top:34px">${rows.map(([ic, tint, h, p]) =>
        `<div class="feat"><span class="fi" style="color:${tint};border-color:color-mix(in srgb, ${tint} 40%, transparent);background:color-mix(in srgb, ${tint} 9%, transparent)">` +
        `<svg viewBox="0 0 24 24" aria-hidden="true">${INTRO_ICONS[ic]}</svg></span>` +
        `<span><h3>${h}</h3><p>${p}</p></span></div>`).join('')}</div>`;
    }

    function slideFlow() {
      const r = introRow();
      if (!r) return '<p class="s-empty">No scored rows yet.</p>';
      const rows = [
        ['Company type', 'How established is it?', r.companyType || '—'],
        ['Trend', 'May I own this at all?', r.actionTrend || '—'],
        ['Entry', 'Is now a sane moment?', r.actionEntry || '—'],
        ['Fundamentals', 'How much conviction?', r.actionFund || '—'],
        ['Guards', 'Any reason to wait?', r.actionGuards || 'clear'],
      ];
      return `<div class="flow">${rows.map(([k, q, v]) =>
        `<div class="flowrow"><span class="fk">${esc(k)}</span><span class="fq">${esc(q)}</span>` +
        `<span class="fv">${esc(v)}</span></div>`).join('')}</div>` +
        `<div class="flowend"><div class="fl">${esc(nameOf(r))} reads</div>` +
        `<div class="fa">${esc(r.action)}</div>` +
        `<div class="fw">because “${esc(r.actionFlag || '')}” fired first</div></div>`;
    }

    function slideLadder() {
      const r = introRow();
      if (!r) return '<p class="s-empty">No scored rows yet.</p>';
      let e;
      try { e = ActionRules.explain(r, introRules()); } catch (err) { e = null; }
      if (!e || !e.rungs) return '<p class="s-empty">The ladder is unavailable for this row.</p>';
      const firedAt = e.rungs.findIndex((g) => g.fired);
      const cap = size.id === 'square' ? 6 : size.id === 'story' ? 11 : 8;
      let show = e.rungs;
      if (show.length > cap) {
        const from = Math.max(0, Math.min(firedAt - cap + 3, show.length - cap));
        show = show.slice(from, from + cap);
      }
      const SEC = { veto: 'veto', cap: 'cap', setup: 'setup' };
      return `<div class="rungs">${show.map((g) => {
        const i = e.rungs.indexOf(g);
        const cls = g.fired ? 'lit' : (firedAt >= 0 && i < firedAt) ? 'past' : 'never';
        const right = g.fired ? g.action : (cls === 'past' ? 'not met' : 'never checked');
        return `<div class="rung ${cls}"><span class="rs">${esc(SEC[g.section] || g.section)}</span>` +
          `<span class="rf">${esc(g.flag)}</span><span class="ra">${esc(right)}</span></div>`;
      }).join('')}</div>` +
        `<p class="s-sub" style="font-size:18px;margin-top:20px">First match wins, so everything under the lit rung was never consulted — that is why one rule can always be named. This is ${esc(nameOf(r))}, tonight.</p>`;
    }

    const TIER_DEF = [
      ['Sell', 'var(--red)', 'get out'],
      ['Avoid', 'var(--red)', 'not now'],
      ['Hold', 'var(--muted)', 'sit still'],
      ['Buy w/ Risk', 'var(--amber)', 'eyes open'],
      ['Buy', 'var(--green)', 'clean'],
      ['Strong Buy', 'var(--green)', 'everything lines up'],
    ];
    function slideTiers(sl) {
      return `<div class="tiers">${TIER_DEF.map(([n, c, w]) =>
        `<div class="tier" style="border-color:color-mix(in srgb, ${c} 40%, transparent);background:color-mix(in srgb, ${c} 8%, transparent)">` +
        `<b style="color:${c}">${esc(n)}</b><span>${esc(w)}</span></div>`).join('')}</div>` +
        `<p class="s-sub" style="margin-top:30px">${esc(sl.note || '')}</p>`;
    }

    function slideMock() {
      const rows = stocks.slice(0, 3).map((s) => s.symbol);
      while (rows.length < 3) rows.push('—');
      return '<div class="mock">' +
        rows.map((sym, i) =>
          `<div class="mockrow">${i === 0 ? '<span class="star">★</span>' : '<span class="star" style="border-color:var(--hair-2);color:var(--faint)">☆</span>'}` +
          `<span>${esc(sym)}</span><span class="mg">${i === 0 ? 'in 2 of your lists' : ''}</span></div>`).join('') +
        '<p class="mockcap">The star sits beside every ticker in the screener. Click it, tick a list, done — the row shows which of your lists it belongs to.</p>' +
        '</div>';
    }

    function slideStmts(sl) {
      return `<div class="stmts">${sl.rows.map(([k, h, p]) =>
        `<div class="stmt"><span class="${k}">${k === 'x' ? '✕' : '✓'}</span>` +
        `<span><b>${esc(h)}</b><span>${esc(p)}</span></span></div>`).join('')}</div>`;
    }

    function slideClose() {
      return '<div class="flowend" style="margin-top:40px">' +
        '<div class="fl">No account needed</div>' +
        '<div class="fa">Try it free</div>' +
        '<div class="fw">Five real stocks, every feature live, one click on the login page.</div></div>' +
        '<p class="s-sub" style="margin-top:34px">tickrlab.com — one page, and a set of rules that explain themselves.</p>';
    }

    function tplIntro() {
      const topic = topicById(O.intTopic);
      const idx = Math.min(Number(O.intSlide) || 0, topic.slides.length - 1);
      const sl = topic.slides[idx];
      const kick = sl.kick || (sl.kind === 'close' ? 'Start here'
        : sl.kind === 'flow' ? 'Four readings, one word'
        : sl.kind === 'ladder' ? 'One rule decides' : topic.name);
      const title = sl.title || (sl.kind === 'close' ? 'See it<br><span class="dim">on real data</span>'
        : sl.kind === 'flow' ? 'How a verdict<br><span class="dim">gets made</span>'
        : sl.kind === 'ladder' ? 'The rule that<br><span class="dim">fired</span>'
        : sl.kind === 'mock' ? 'One click<br><span class="dim">per stock</span>' : topic.name);
      const body =
        sl.kind === 'steps' ? slideSteps(sl)
        : sl.kind === 'flow' ? slideFlow()
        : sl.kind === 'ladder' ? slideLadder()
        : sl.kind === 'tiers' ? slideTiers(sl)
        : sl.kind === 'mock' ? slideMock()
        : sl.kind === 'stmts' ? slideStmts(sl)
        : sl.kind === 'close' ? slideClose()
        : (sl.sub ? `<p class="s-sub" style="font-size:26px;margin-top:26px">${sl.sub}</p>` : '');
      return chromeTop(false) +
        `<div class="s-body"><div><span class="s-kick">${esc(kick)}</span>` +
        `<h2 class="s-title">${title}</h2>${body}` +
        dotRow(topic.slides.length, idx) +
        '</div></div>' + chromeFoot();
    }

    // ---- the chart card ---------------------------------------------------
    // ONE fetch per window serves every mode: /api/basket?name=All returns
    // each symbol's series normalised to its own first close, so the
    // equal-weight line for any subset is just the mean of the lines drawn —
    // the chart can never disagree with its own legend. Cached per window.
    const CHART_WINDOWS = { w1: [5, 'past week'], m1: [21, 'past month'],
                            m3: [63, 'past three months'], m6: [126, 'past six months'],
                            y1: [253, 'past year'] };
    const CHART_PALETTE = ['#34d399', '#22d3ee', '#a78bfa', '#fbbf24', '#fb923c',
                           '#f472b6', '#a3e635', '#60a5fa'];
    // Presentation attributes, not classes: this markup also travels through
    // the PNG export, where only inlined styles and attributes survive.
    function lineChart(dates, lines, opts) {
      const W = 952, H = (opts && opts.h) || 590, PL = 92, PR = 132, PT = 20, PB = 46;
      const toPct = (S) => S.map((v) => (v == null ? null : (v - 1) * 100));
      const L = lines.map((l) => ({ ...l, P: toPct(l.S) }));
      const vals = [].concat(...L.map((l) => l.P)).filter((v) => v != null);
      if (!vals.length || dates.length < 2) return '<p class="s-empty">No stored history for this window.</p>';
      let lo = Math.min(...vals, 0), hi = Math.max(...vals, 0);
      const pad = Math.max(1.5, (hi - lo) * 0.1); lo -= pad; hi += pad;
      const x = (i) => PL + (i / (dates.length - 1)) * (W - PL - PR);
      const y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
      const path = (P) => {
        let d = '', pen = false;
        for (let i = 0; i < P.length; i++) {
          if (P[i] == null) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(P[i]).toFixed(1);
          pen = true;
        }
        return d;
      };
      let grid = '';
      for (let g = 0; g <= 4; g++) {
        const v = lo + (g / 4) * (hi - lo);
        grid += `<line x1="${PL}" y1="${y(v).toFixed(1)}" x2="${W - PR}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>` +
          `<text x="${PL - 16}" y="${(y(v) + 7).toFixed(1)}" text-anchor="end" font-size="19" fill="#7d8797" font-family="Geist Mono, monospace">${v.toFixed(0)}%</text>`;
      }
      if (lo < 0 && hi > 0) {
        grid += `<line x1="${PL}" y1="${y(0).toFixed(1)}" x2="${W - PR}" y2="${y(0).toFixed(1)}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;
      }
      let area = '';
      const hero = L.find((l) => l.fill);
      if (hero) {
        const first = hero.P.findIndex((v) => v != null);
        let last = -1;
        for (let i = hero.P.length - 1; i >= 0 && last < 0; i--) if (hero.P[i] != null) last = i;
        if (first >= 0 && last > first) {
          area = `<defs><linearGradient id="pfill" x1="0" y1="0" x2="0" y2="1">` +
            `<stop offset="0%" stop-color="${hero.color}" stop-opacity="0.30"/>` +
            `<stop offset="100%" stop-color="${hero.color}" stop-opacity="0"/></linearGradient></defs>` +
            `<path class="carea" d="${path(hero.P)}L${x(last).toFixed(1)} ${(H - PB).toFixed(1)}L${x(first).toFixed(1)} ${(H - PB).toFixed(1)}Z" fill="url(#pfill)" stroke="none"/>`;
        }
      }
      // pathLength="1" normalises the geometry, so one dash rule draws any
      // line in Motion without measuring it — see the motion styles below.
      const strokes = L.map((l) =>
        `<path class="cl" pathLength="1" d="${path(l.P)}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${l.dim ? 0.7 : 1}"/>`).join('');
      const tags = L.map((l) => {
        let last = null, li = -1;
        for (let i = l.P.length - 1; i >= 0 && last == null; i--) { last = l.P[i]; li = i; }
        if (last == null) return '';
        const ty = Math.max(PT + 14, Math.min(H - PB, y(last) + 7));
        return `<text x="${W - PR + 14}" y="${ty.toFixed(1)}" font-size="24" font-weight="600" fill="${l.color}" font-family="Geist Mono, monospace">${(last >= 0 ? '+' : '') + last.toFixed(1)}%</text>`;
      }).join('');
      const d0 = dates[0], d1 = dates[dates.length - 1];
      const axis = `<text x="${PL}" y="${H - 10}" font-size="18" fill="#7d8797" font-family="Geist Mono, monospace">${esc(d0)}</text>` +
        `<text x="${W - PR}" y="${H - 10}" text-anchor="end" font-size="18" fill="#7d8797" font-family="Geist Mono, monospace">${esc(d1)}</text>`;
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin-top:26px" role="img" aria-label="chart">` +
        area + grid + strokes + tags + axis + '</svg>';
    }

    function chartLegend(items) {
      return `<div class="chips">${items.map((it) =>
        `<span class="chipL" style="border-color:${it.color}33"><span class="cdot" style="background:${it.color}"></span>` +
        `${esc(it.label)}</span>`).join('')}</div>`;
    }

    function chartScopeSymbols() {
      const sc = scopeOf('chtScope', 'chtSector');
      return { syms: sc.rows.map((x) => x.symbol), label: sc.label };
    }

    function tplChart() {
      const winKey = O.chtWin;
      const [days, winLabel] = CHART_WINDOWS[winKey] || CHART_WINDOWS.m6;
      const mode = O.chtMode;
      const d = getBasket(days);
      if (!d || !d.dates || !d.dates.length) {
        return chromeTop() +
          '<div class="s-body"><div><span class="s-kick">Reading the archive</span>' +
          '<h2 class="s-title">Drawing<br><span class="dim">the chart\u2026</span></h2></div></div>' + chromeFoot();
      }
      const series = d.series || {};
      const mean = (syms) => {
        const use = syms.filter((x) => series[x]);
        if (!use.length) return null;
        return d.dates.map((_, i) => {
          let sum = 0, n = 0;
          for (const x of use) { const v = series[x][i]; if (v != null) { sum += v; n++; } }
          return n ? sum / n : null;
        });
      };
      const endOf = (S) => { for (let i = S.length - 1; i >= 0; i--) if (S[i] != null) return (S[i] - 1) * 100; return null; };
      let lines = [], legend = [], kick = '', title = '', note = '';

      if (mode === 'stock') {
        const sym = O.chtSym || (stocks[0] && stocks[0].symbol);
        const row = stocks.find((r) => r.symbol === sym);
        const S = series[sym];
        if (!S) return chromeTop() + `<div class="s-body"><div><p class="s-empty">No stored history for ${esc(sym)} in this window.</p></div></div>` + chromeFoot();
        lines = [{ color: '#34d399', S, width: 4, fill: true },
                 { color: '#7c9cff', S: mean(stocks.map((r) => r.symbol)), width: 2, dim: true }];
        legend = [{ color: '#34d399', label: esc(sym) }, { color: '#7c9cff', label: 'All screened' }];
        kick = `${esc(sym)} \u00b7 ${esc(winLabel)}`;
        title = `${esc(sym)}<br><span class="dim">${esc((row && row.name) || '')}</span>`;
        note = 'Price only, rebased to the start of the window \u2014 no dividends, no positions.';
      } else if (mode === 'leaders') {
        const scope = chartScopeSymbols();
        const n = Number(O.chtLines) || 5;
        const ranked = scope.syms.filter((x) => series[x])
          .map((x) => ({ sym: x, S: series[x], end: endOf(series[x]) }))
          .filter((r) => r.end != null)
          .sort((a, b) => b.end - a.end)
          .slice(0, n);
        if (!ranked.length) return chromeTop() + `<div class="s-body"><div><p class="s-empty">Nothing in ${esc(scope.label)} has history for this window.</p></div></div>` + chromeFoot();
        lines = ranked.map((r, i) => ({ color: CHART_PALETTE[i % CHART_PALETTE.length], S: r.S, width: 3 }));
        legend = ranked.map((r, i) => ({ color: CHART_PALETTE[i % CHART_PALETTE.length], label: `${r.sym} ${pct(r.end)}` }));
        kick = `${esc(scope.label)} \u00b7 ${esc(winLabel)}`;
        title = `The leaders<br><span class="dim">${esc(scope.label)}</span>`;
        note = 'Each line is one stock, rebased to the start of the window. Ranked on the window, not a forecast.';
      } else {
        const scope = chartScopeSymbols();
        const basket = mean(scope.syms);
        if (!basket) return chromeTop() + `<div class="s-body"><div><p class="s-empty">Nothing in ${esc(scope.label)} has history for this window.</p></div></div>` + chromeFoot();
        const all = mean(stocks.map((r) => r.symbol));
        const same = O.chtScope === 'All';
        lines = same ? [{ color: '#34d399', S: basket, width: 4, fill: true }]
          : [{ color: '#34d399', S: basket, width: 4, fill: true }, { color: '#7c9cff', S: all, width: 2, dim: true }];
        legend = same ? [{ color: '#34d399', label: 'All screened' }]
          : [{ color: '#34d399', label: esc(scope.label) }, { color: '#7c9cff', label: 'All screened' }];
        kick = `${esc(scope.label)} \u00b7 ${esc(winLabel)}`;
        title = same ? `The whole<br><span class="dim">screen</span>`
          : `${esc(scope.label)}<br><span class="dim">vs the whole screen</span>`;
        note = 'Equal dollars at the window start, held \u2014 a reading of the list, not an account.';
      }

      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${kick}</span>` +
        `<h2 class="s-title">${title}</h2>` +
        lineChart(d.dates, lines, { h: size.id === 'story' ? 1020 : size.id === 'square' ? 470 : 590 }) +
        chartLegend(legend) +
        `<p class="s-sub" style="font-size:17px;margin-top:18px">${note}</p>` +
        '</div></div>' + chromeFoot();
    }

    function tplAnnounce() {
      // The contract is "the host hands over control values"; a missing one
      // should draw an empty field, not throw and blank the card.
      const kick = String(O.annKick || '').trim();
      const head = String(O.annHead || '').trim() || 'Say something';
      const body = String(O.annBody || '').trim();
      return chromeTop() +
        '<div class="s-body"><div>' +
        (kick ? `<div class="ann-kick">${esc(kick)}</div>` : '') +
        `<h2 class="ann-head">${esc(head)}</h2>` +
        (body ? `<p class="ann-body">${esc(body)}</p>` : '') +
        '</div></div>' + chromeFoot();
    }

    // ---- render ------------------------------------------------------------

    // ---- Range -----------------------------------------------------------
    // Where each stock sits between its own 52-week low and high. A ranking
    // of "% from the high" is the obvious card and throws away half the
    // story; a track per stock carries the fall AND the recovery at once,
    // which is why it is the default rather than the ranking.
    function rangeScope() { return scopeOf('rngScope', 'rngSector'); }

    function tplRange() {
      const mode = O.rngMode || 'track';
      const scope = rangeScope();
      const n = Math.min(Number(O.rngCount) || 8, size.id === 'story' ? 14 : 10);
      const has = (x) => x.range52Pos != null && x.pctFromHigh != null && x.pctFromLow != null;
      const rows = scope.rows.filter(has);
      if (!rows.length) {
        return chromeTop() + `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}</span>` +
          '<h2 class="s-title">No range<br><span class="dim">to read</span></h2>' +
          `<p class="s-empty">Nothing in ${esc(scope.label)} has a 52-week range stored yet.</p>` +
          '</div></div>' + chromeFoot();
      }

      // ---- the spread: how the whole list is distributed through its ranges
      if (mode === 'spread') {
        const bands = [
          ['Top fifth \u2014 at the highs', 80, 100, '#34d399'],
          ['Upper middle', 60, 80, '#a3e635'],
          ['Middle', 40, 60, '#9aa3b2'],
          ['Lower middle', 20, 40, '#fb923c'],
          ['Bottom fifth \u2014 at the lows', 0, 20, '#fb7185'],
        ];
        const total = rows.length;
        const counts = bands.map(([, lo, hi]) =>
          rows.filter((x) => x.range52Pos >= lo && (hi === 100 ? x.range52Pos <= 100 : x.range52Pos < hi)).length);
        const mx = Math.max(...counts, 1);
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 52-week range</span>` +
          '<h2 class="s-title">Where the year<br><span class="dim">sits</span></h2>' +
          `<div class="atally" style="margin-top:34px">${bands.map(([label, , , tint], i) =>
            `<div class="arow"><span class="an" style="color:${tint}">${esc(label)}</span>` +
            `<span class="arail"><span class="afill" style="display:block;width:${Math.max(2, counts[i] / mx * 100)}%;background:${tint}"></span></span>` +
            `<span class="ac">${counts[i]}</span><span class="ap">${Math.round(counts[i] / total * 100)}%</span></div>`).join('')}</div>` +
          `<p class="s-sub" style="font-size:19px;margin-top:28px">${counts[0]} of ${total} sit in the top fifth of their own 52-week range, ` +
          `${counts[4]} in the bottom. Each stock measured against its own year, not against each other.</p>` +
          '</div></div>' + chromeFoot();
      }

      // ---- a plain ranking on one of the three readings
      if (mode === 'rank') {
        const MEASURES = {
          high: ['pctFromHigh', 'from the 52-week high', false],
          low:  ['pctFromLow', 'off the 52-week low', true],
          pos:  ['range52Pos', 'position in the 52-week range', true],
        };
        const [field, label, bigFirst] = MEASURES[O.rngMeasure] || MEASURES.high;
        const list = rows.slice()
          .sort((a, b) => (bigFirst ? b[field] - a[field] : a[field] - b[field]))
          .slice(0, n);
        // One recovery of +1900% would leave every other bar invisible, so
        // the bars are drawn on a log scale while the printed number stays
        // the true one. The caption says so rather than leaving it implied.
        const wide = Math.max(...list.map((x) => Math.abs(x[field]))) > 200;
        const scale = (v) => {
          const a = Math.abs(v);
          if (!wide) return a / Math.max(...list.map((x) => Math.abs(x[field])), 1e-9);
          return Math.log10(1 + a) / Math.log10(1 + Math.max(...list.map((x) => Math.abs(x[field])), 1));
        };
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 52-week range</span>` +
          `<h2 class="s-title">${O.rngMeasure === 'low' ? 'Furthest off' : O.rngMeasure === 'pos' ? 'Highest in' : 'Furthest from'}` +
          `<br><span class="dim">${esc(label.replace(/^(from|off|position in) the /, ''))}</span></h2>` +
          `<div class="rows">${list.map((x) => {
            const v = x[field];
            const w = Math.max(5, Math.round(scale(v) * 100));
            const neg = v < 0;
            return `<div class="row"><span class="nm2">${esc(nameOf(x))}</span>` +
              `<span class="bar-rail"><span class="bar${neg ? ' neg' : ''}" style="width:${w}%;display:block"></span></span>` +
              `<span class="val ${neg ? 'neg' : 'pos'}">${pct(v)}</span></div>`;
          }).join('')}</div>` +
          `<p class="s-sub" style="font-size:18px;margin-top:22px">${esc(label[0].toUpperCase() + label.slice(1))}` +
          (wide ? ', bars on a log scale so one outlier does not flatten the rest' : '') +
          '. Each measured against its own year.</p>' +
          '</div></div>' + chromeFoot();
      }

      // ---- the track: the whole year in one row per stock
      const top = O.rngDir !== 'low';
      const list = rows.slice()
        .sort((a, b) => (top ? b.range52Pos - a.range52Pos : a.range52Pos - b.range52Pos))
        .slice(0, n);
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 52-week range</span>` +
        `<h2 class="s-title">${top ? 'Pressed against<br><span class="dim">their highs</span>' : 'Down at<br><span class="dim">their lows</span>'}</h2>` +
        `<div class="tracks">${list.map((x) => {
          const p = Math.max(0, Math.min(100, x.range52Pos));
          const tint = p >= 66 ? '#34d399' : p >= 33 ? '#fbbf24' : '#fb7185';
          return '<div class="trk">' +
            `<span class="ts">${esc(nameOf(x))}</span>` +
            '<span class="trail">' +
            `<span class="tfill" style="width:${p}%;background:linear-gradient(90deg, rgba(255,255,255,0.05), ${tint})"></span>` +
            `<span class="tdot" style="left:${p}%;background:${tint}"></span></span>` +
            `<span class="tlo">${pct(x.pctFromLow)}</span>` +
            `<span class="thi">${pct(x.pctFromHigh)}</span>` +
            '</div>';
        }).join('')}</div>` +
        '<div class="tkey"><span>left edge \u00b7 the 52-week low</span><span>right edge \u00b7 the high</span></div>' +
        '<p class="s-sub" style="font-size:18px;margin-top:16px">Each track is one stock\u2019s own year: the marker is where it trades now, ' +
        'the first number is how far it has come off its low, the second how far it still sits below its high.</p>' +
        '</div></div>' + chromeFoot();
    }

    // ---- Sparklines ------------------------------------------------------
    // The leaders in a list, each as its own small chart. The big Chart card
    // overlays lines to compare them; this one separates them so each shape
    // reads on its own — which is the version that survives being scrolled
    // past at thumbnail size. Same archive read as the Chart card, so
    // switching between them costs nothing.
    function sparkSvg(S, color) {
      const W = 240, H = 74, P = 4;
      const pts = S.map((v, i) => (v == null ? null : [i, (v - 1) * 100])).filter(Boolean);
      if (pts.length < 2) return '';
      const vals = pts.map((p) => p[1]);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 0.6) { hi += 0.3; lo -= 0.3; }
      const x = (i) => P + (i / Math.max(1, S.length - 1)) * (W - 2 * P);
      const y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
      let d = '';
      pts.forEach((p, k) => { d += (k ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); });
      const area = d + `L${x(pts[pts.length - 1][0]).toFixed(1)} ${H - P}L${x(pts[0][0]).toFixed(1)} ${H - P}Z`;
      const zero = (lo < 0 && hi > 0)
        ? `<line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>` : '';
      const wash = color === '#34d399' ? 'rgba(52,211,153,0.13)' : 'rgba(251,113,133,0.13)';
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` + zero +
        `<path d="${area}" fill="${wash}" stroke="none"/>` +
        `<path class="cl" pathLength="1" d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    }

    function tplSparks() {
      const [days, winLabel] = CHART_WINDOWS[O.spkWin] || CHART_WINDOWS.m6;
      const d = getBasket(days);
      if (!d || !d.dates || !d.dates.length) {
        return chromeTop() +
          '<div class="s-body"><div><span class="s-kick">Reading the archive</span>' +
          '<h2 class="s-title">Drawing<br><span class="dim">the shapes\u2026</span></h2></div></div>' + chromeFoot();
      }
      const series = d.series || {};
      const scope = scopeOf('spkScope', 'spkSector');
      const best = O.spkDir !== 'worst';
      const n = Math.min(Number(O.spkCount) || 9, size.id === 'story' ? 15 : 12);
      const items = scope.rows
        .filter((x) => series[x.symbol])
        .map((x) => {
          const S = series[x.symbol];
          let last = null;
          for (let i = S.length - 1; i >= 0 && last == null; i--) last = S[i];
          return { sym: x.symbol, label: nameOf(x), S, end: last == null ? null : (last - 1) * 100 };
        })
        .filter((x) => x.end != null)
        .sort((a, b) => (best ? b.end - a.end : a.end - b.end))
        .slice(0, n);
      if (!items.length) {
        return chromeTop() + `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}</span>` +
          `<h2 class="s-title">No history<br><span class="dim">to draw</span></h2>` +
          `<p class="s-empty">Nothing in ${esc(scope.label)} has stored prices for this window yet.</p>` +
          '</div></div>' + chromeFoot();
      }
      const cols = items.length <= 4 ? 2 : 3;
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 ${esc(winLabel)}</span>` +
        `<h2 class="s-title">${best ? 'The leaders' : 'The laggards'}<br><span class="dim">${esc(winLabel)}</span></h2>` +
        `<div class="spk" style="grid-template-columns:repeat(${cols},1fr)">${items.map((it) => {
          const color = it.end >= 0 ? '#34d399' : '#fb7185';
          return '<div class="spkt">' +
            `<div class="sh"><span class="ss">${esc(it.label || it.sym)}</span>` +
            `<span class="sv ${it.end >= 0 ? 'pos' : 'neg'}">${pct(it.end)}</span></div>` +
            sparkSvg(it.S, color) + '</div>';
        }).join('')}</div>` +
        '<p class="s-sub" style="font-size:18px;margin-top:22px">Each shape is that stock alone, rebased to the start of the window ' +
        '\u2014 the heights are not comparable between tiles, the shapes are. Ranked on the window, not a forecast.</p>' +
        '</div></div>' + chromeFoot();
    }

  // ---- the Fundamentals cards --------------------------------------------
  // Four readings of the company data: a ranking on one measure, the shape
  // of the whole screen, growth against margin as a picture, and one company
  // in full. Size and Fundamentals are the same card — an absolute is just a
  // metric whose units are money.
  const FUND_METRICS = {
    rev:   ['revenueTtm', 'Revenue', 'money'],
    gp:    ['grossProfitTtm', 'Gross profit', 'money'],
    ni:    ['netIncomeTtm', 'Net income', 'money'],
    fcf:   ['fcfTtm', 'Free cash flow', 'money'],
    cash:  ['netCash', 'Net cash', 'money'],
    cap:   ['marketCap', 'Market cap', 'money'],
    gm:    ['grossMargin', 'Gross margin', 'pct'],
    pm:    ['profitMargin', 'Profit margin', 'pct'],
    fm:    ['fcfMargin', 'FCF margin', 'pct'],
    rg:    ['revenueGrowthYoY', 'Revenue growth', 'pct'],
    eg:    ['earningsGrowthYoY', 'Earnings growth', 'pct'],
    roe:   ['roe', 'Return on equity', 'pct'],
    pe:    ['forwardPe', 'Forward P/E', 'ratio'],
    peg:   ['peg', 'PEG', 'ratio'],
    fy:    ['fcfYield', 'FCF yield', 'pct'],
    ncp:   ['netCashPct', 'Net cash, % of cap', 'pct'],
    shrt:  ['shortPctFloat', 'Short interest', 'pct'],
  };
  const MONEY_KEYS = new Set(['rev', 'gp', 'ni', 'fcf', 'cash', 'cap']);
  function fmtMoney(v) {
    if (v == null || !isFinite(v)) return '\u2014';
    const a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return sign + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(0) + 'M';
    return sign + a.toFixed(0);
  }
  const fmtMetric = (v, kind) => (v == null || !isFinite(v) ? '\u2014'
    : kind === 'money' ? fmtMoney(v)
    : kind === 'ratio' ? v.toFixed(1)
    : v.toFixed(1) + '%');

  const fundScope = () => scopeOf('fundScope', 'fundSector');

  function tplFund() {
    const mode = O.fundMode || 'rank';
    const scope = fundScope();

    // ---- one company, in full
    if (mode === 'one') {
      const sym = O.fundSym || (stocks[0] && stocks[0].symbol);
      const r = stocks.find((x) => x.symbol === sym);
      if (!r) return chromeTop() + '<div class="s-body"><div><p class="s-empty">Pick a stock.</p></div></div>' + chromeFoot();
      const tiles = [
        ['Revenue', fmtMoney(r.revenueTtm), 'ttm'],
        ['Gross margin', fmtMetric(r.grossMargin, 'pct'), 'of revenue'],
        ['Profit margin', fmtMetric(r.profitMargin, 'pct'), 'of revenue'],
        ['Net income', fmtMoney(r.netIncomeTtm), 'ttm'],
        ['Free cash flow', fmtMoney(r.fcfTtm), 'ttm'],
        ['FCF margin', fmtMetric(r.fcfMargin, 'pct'), 'of revenue'],
        ['Revenue growth', fmtMetric(r.revenueGrowthYoY, 'pct'), 'year on year'],
        ['Net cash', fmtMoney(r.netCash), 'cash less debt'],
        ['Forward P/E', fmtMetric(r.forwardPe, 'ratio'), 'on estimates'],
      ];
      const neg = (v) => (typeof v === 'string' && v.startsWith('-') ? ' neg' : '');
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${esc(r.sector || 'The numbers')} \u00b7 trailing twelve months</span>` +
        `<h2 class="s-title">${esc(nameOf(r))}<br><span class="dim">${esc(r.symbol)}</span></h2>` +
        `<div class="fgrid">${tiles.map(([k, v, note]) =>
          `<div class="ftile"><div class="fk">${esc(k)}</div>` +
          `<div class="fv${neg(v)}">${esc(v)}</div><div class="fn2">${esc(note)}</div></div>`).join('')}</div>` +
        `<p class="s-sub" style="font-size:18px;margin-top:24px">Quality ${r.qualityRating != null ? r.qualityRating + '/10' : 'not scored'} \u00b7 ` +
        'reported figures, not estimates of what comes next.</p>' +
        '</div></div>' + chromeFoot();
    }

    // ---- the shape of the screen
    if (mode === 'shape') {
      const rows = scope.rows;
      const bands = [
        ['Profitable', (x) => x.netIncomeTtm != null && x.netIncomeTtm > 0, 'var(--green)', 'netIncomeTtm'],
        ['Cash generative', (x) => x.fcfTtm != null && x.fcfTtm > 0, '#a3e635', 'fcfTtm'],
        ['More cash than debt', (x) => x.netCash != null && x.netCash > 0, '#22d3ee', 'netCash'],
        ['Gross margin over 50%', (x) => x.grossMargin != null && x.grossMargin > 50, 'var(--accent-2)', 'grossMargin'],
        ['Growing revenue', (x) => x.revenueGrowthYoY != null && x.revenueGrowthYoY > 0, 'var(--amber)', 'revenueGrowthYoY'],
      ];
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 reported figures</span>` +
        '<h2 class="s-title">What the screen<br><span class="dim">is made of</span></h2>' +
        `<div class="atally" style="margin-top:34px">${bands.map(([label, test, tint, key]) => {
          const known = rows.filter((x) => x[key] != null);
          const n = known.filter(test).length;
          const d = known.length || 1;
          return `<div class="arow"><span class="an" style="color:${tint}">${esc(label)}</span>` +
            `<span class="arail"><span class="afill" style="display:block;width:${Math.max(2, n / d * 100)}%;background:${tint}"></span></span>` +
            `<span class="ac">${n}</span><span class="ap">${Math.round(n / d * 100)}%</span></div>`;
        }).join('')}</div>` +
        '<p class="s-sub" style="font-size:19px;margin-top:28px">Counted out of the companies that report each figure. Facts about businesses, not opinions about prices.</p>' +
        '</div></div>' + chromeFoot();
    }

    // ---- growth against margin
    if (mode === 'quad') {
      const pts = scope.rows
        .filter((x) => x.revenueGrowthYoY != null && x.profitMargin != null)
        .map((x) => ({ sym: x.symbol, label: nameOf(x), x: x.revenueGrowthYoY, y: x.profitMargin }));
      if (pts.length < 3) return chromeTop() + `<div class="s-body"><div><p class="s-empty">Not enough reported figures in ${esc(scope.label)} to plot.</p></div></div>` + chromeFoot();
      const q = {
        gp: pts.filter((p) => p.x > 0 && p.y > 0).length,
        gl: pts.filter((p) => p.x > 0 && p.y <= 0).length,
        sp: pts.filter((p) => p.x <= 0 && p.y > 0).length,
        sl: pts.filter((p) => p.x <= 0 && p.y <= 0).length,
      };
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 growth against margin</span>` +
        '<h2 class="s-title">Who grows,<br><span class="dim">who earns</span></h2>' +
        scatterSvg(pts, q) +
        `<p class="s-sub" style="font-size:18px;margin-top:20px">${q.gp} of ${pts.length} are growing revenue AND profitable. ` +
        'Each dot is one company: revenue growth across, profit margin up. Reported figures, no forecasts.</p>' +
        '</div></div>' + chromeFoot();
    }

    // ---- the ranking
    const key = FUND_METRICS[O.fundMetric] ? O.fundMetric : 'rev';
    const [field, label, kind] = FUND_METRICS[key];
    const top = O.fundDir !== 'low';
    const n = Number(O.fundCount) || 10;
    let rows = scope.rows.filter((x) => x[field] != null && isFinite(x[field]));
    // A negative multiple is arithmetic, not cheapness: the same reason the
    // Quality score refuses a P/E or a PEG from a loss-maker.
    if ((key === 'pe' || key === 'peg') ) rows = rows.filter((x) => x[field] > 0);
    // Net cash means nothing for a bank, and neither does gross margin — a
    // lender has no cost of goods, which is why JPM reports exactly 100%.
    if (key === 'cash' || key === 'ncp' || key === 'gm') {
      rows = rows.filter((x) => x.sector !== 'Financial Services');
    }
    // Everything absolute is in the reporting currency, so a single foreign
    // reporter would top the list for the wrong reason. Silent when the
    // screen is all-USD, which it is.
    if (MONEY_KEYS.has(key)) rows = rows.filter((x) => !x.currency || x.currency === 'USD');
    rows = rows.sort((a, b) => (top ? b[field] - a[field] : a[field] - b[field])).slice(0, n);
    if (!rows.length) {
      return chromeTop() + `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}</span>` +
        `<h2 class="s-title">${esc(label)}</h2><p class="s-empty">Nothing in ${esc(scope.label)} reports this yet.</p></div></div>` + chromeFoot();
    }
    const mx = Math.max(...rows.map((x) => Math.abs(x[field])), 1e-9);
    return chromeTop() +
      `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 reported figures</span>` +
      `<h2 class="s-title">${top ? 'Biggest' : 'Smallest'}<br><span class="dim">${esc(label.toLowerCase())}</span></h2>` +
      `<div class="rows">${rows.map((x) => {
        const v = x[field];
        const w = Math.max(5, Math.round(Math.abs(v) / mx * 100));
        const neg = v < 0;
        return `<div class="row"><span class="nm2">${esc(nameOf(x))}</span>` +
          `<span class="bar-rail"><span class="bar${neg ? ' neg' : ''}" style="width:${w}%;display:block"></span></span>` +
          `<span class="val ${neg ? 'neg' : 'pos'}">${esc(fmtMetric(v, kind))}</span></div>`;
      }).join('')}</div>` +
      `<p class="s-sub" style="font-size:18px;margin-top:22px">${esc(label)}${kind === 'money' ? ', trailing twelve months' : ''} \u2014 ` +
      'as reported. A fact about the business, not a view on the price.</p>' +
      '</div></div>' + chromeFoot();
  }

  // The quadrant plot. Axes cover the middle 96% and the strays are pinned to
  // the edge in amber and counted, the same treatment the indicator lab uses:
  // three runaway growth rates would otherwise press every other dot into a
  // band a few pixels tall.
  function scatterSvg(pts, q) {
    const W = 952, H = size.id === 'story' ? 1000 : size.id === 'square' ? 470 : 600;
    const PL = 96, PR = 30, PT = 24, PB = 60;
    const span = (vals) => {
      const a = vals.slice().sort((m, n) => m - n);
      const lo = a[Math.floor(a.length * 0.02)], hi = a[Math.ceil(a.length * 0.98) - 1];
      return [Math.min(lo, 0), Math.max(hi, 0)];
    };
    let [x0, x1] = span(pts.map((p) => p.x));
    let [y0, y1] = span(pts.map((p) => p.y));
    const padX = (x1 - x0) * 0.08 || 1, padY = (y1 - y0) * 0.08 || 1;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    const X = (v) => PL + (Math.min(Math.max(v, x0), x1) - x0) / (x1 - x0) * (W - PL - PR);
    const Y = (v) => PT + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * (H - PT - PB);
    const zx = X(0), zy = Y(0);
    const stray = (p) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1;
    // the eight furthest from the origin carry their name; labelling 140
    // dots is mush
    const named = pts.slice().sort((a, b) =>
      (Math.abs(b.x) / (x1 - x0) + Math.abs(b.y) / (y1 - y0)) -
      (Math.abs(a.x) / (x1 - x0) + Math.abs(a.y) / (y1 - y0))).slice(0, 8);
    const isNamed = new Set(named.map((p) => p.sym));
    const dots = pts.map((p) => {
      const s2 = stray(p);
      const c = s2 ? '#fbbf24' : (p.x > 0 && p.y > 0) ? '#34d399' : (p.y <= 0) ? '#fb7185' : '#7c9cff';
      return `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${isNamed.has(p.sym) ? 9 : 6.5}" fill="${c}" opacity="${s2 ? 1 : 0.72}"/>`;
    }).join('');
    // A name is many times wider than a ticker, so a label on a dot in the
    // right half is drawn back towards the middle instead of off the edge,
    // and a very long one is clipped rather than allowed to cross the chart.
    const labels = named.map((p) => {
      const cx = X(p.x), right = cx > PL + (W - PL - PR) * 0.55;
      const full = p.label || p.sym;
      const txt = full.length > 22 ? full.slice(0, 21) + '…' : full;
      return `<text x="${(cx + (right ? -13 : 13)).toFixed(1)}" y="${(Y(p.y) + 6).toFixed(1)}" text-anchor="${right ? 'end' : 'start'}" font-size="18" font-weight="600" fill="#e9ecf2" font-family="Geist, sans-serif">${esc(txt)}</text>`;
    }).join('');
    const quad = (tx, ty, anchor, text, tint) =>
      `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="18" font-weight="600" fill="${tint}" font-family="Geist, sans-serif" opacity="0.85">${esc(text)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin-top:26px" role="img" aria-label="growth against margin">` +
      `<rect x="${zx}" y="${PT}" width="${W - PR - zx}" height="${zy - PT}" fill="rgba(52,211,153,0.05)"/>` +
      `<line x1="${PL}" y1="${zy.toFixed(1)}" x2="${W - PR}" y2="${zy.toFixed(1)}" stroke="rgba(255,255,255,0.22)"/>` +
      `<line x1="${zx.toFixed(1)}" y1="${PT}" x2="${zx.toFixed(1)}" y2="${H - PB}" stroke="rgba(255,255,255,0.22)"/>` +
      dots + labels +
      quad(W - PR - 8, PT + 24, 'end', `growing & profitable \u00b7 ${q.gp}`, '#34d399') +
      quad(W - PR - 8, H - PB - 12, 'end', `growing & losing \u00b7 ${q.gl}`, '#fb7185') +
      quad(PL + 8, PT + 24, 'start', `shrinking & profitable \u00b7 ${q.sp}`, '#7c9cff') +
      quad(PL + 8, H - PB - 12, 'start', `shrinking & losing \u00b7 ${q.sl}`, '#94a3b8') +
      `<text x="${W - PR}" y="${H - 16}" text-anchor="end" font-size="18" fill="#7d8797" font-family="Geist Mono, monospace">revenue growth \u2192</text>` +
      `<text x="20" y="${PT + 14}" font-size="18" fill="#7d8797" font-family="Geist Mono, monospace">\u2191 profit margin</text>` +
      '</svg>';
  }

  // The profile picture: the mark alone, full bleed, no header and no
  // footer — a bio avatar is shown at about a hundred pixels in a circle,
  // where a wordmark is mush and only a shape survives. Everything stays
  // inside the middle 70%, which is what the circle crop keeps.
  function tplAvatar() {
    return '<div class="avatarFull">' +
      '<div class="avGlow"></div>' +
      '<svg viewBox="0 0 24 24" class="avMark" aria-hidden="true">' +
      '<path d="M3 17.4 8.6 12l3.6 2.7L20 6.4"/><path d="M14.6 6.4H20v5.4"/></svg>' +
      '</div>';
  }

  const BUILDERS = {
    movers: tplMovers, chart: tplChart, advboard: tplAdvBoard,
    intro: tplIntro, announce: tplAnnounce,
    fund: tplFund, sparks: tplSparks, range: tplRange, avatar: tplAvatar,
  };

  // The card styles travel WITH the builders: a new grammar added to one
  // page and styled in the other is exactly the drift this module prevents.
  const STYLE = `
    /* chrome shared by every card, so the family is unmistakable */
    /* The masthead carries the brand at thumbnail size — a feed shrinks a
       1080 card to a few hundred pixels, where 30px type stops reading. */
    .s-top { display: flex; align-items: center; gap: 20px; }
    .s-glyph { width: 68px; height: 68px; border-radius: 21px; display: inline-flex;
               align-items: center; justify-content: center; color: var(--green);
               background: linear-gradient(160deg, rgba(52, 211, 153, 0.22), rgba(52, 211, 153, 0.05));
               border: 1px solid rgba(52, 211, 153, 0.3); }
    .s-glyph svg { width: 40px; height: 40px; stroke: currentColor; fill: none;
                   stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .s-word { font-size: 44px; font-weight: 700; letter-spacing: -0.035em; }
    .s-date { margin-left: auto; font: 500 24px var(--mono); color: var(--muted);
              padding: 11px 24px; border: 1px solid var(--hair-2); border-radius: 999px; }
    .s-kick { margin: 44px 0 0; font-size: 17px; font-weight: 600; letter-spacing: 0.24em;
              text-transform: uppercase; color: var(--green); }
    .s-title { margin: 10px 0 0; font-size: 66px; font-weight: 800; line-height: 1.02;
               letter-spacing: -0.045em; }
    .s-title .dim { color: var(--faint); }
    .s-sub { margin: 16px 0 0; font-size: 20px; color: var(--muted); line-height: 1.5; max-width: 40ch; }
    .s-body { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
    .s-foot { display: flex; align-items: center; gap: 15px; font: 500 18px var(--mono);
              color: var(--faint); border-top: 1px solid var(--hair); padding-top: 26px; }
    .s-foot b { color: var(--muted); font-weight: 600; }
    .s-foot .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); }


    /* rows shared by list templates */
    .rows { display: flex; flex-direction: column; gap: 16px; margin-top: 40px; }
    .row { display: flex; align-items: center; gap: 20px; }
    .row .sym { font: 600 27px var(--mono); width: 138px; letter-spacing: -0.02em; }
    .row .bar-rail { flex: 1; height: 40px; border-radius: 11px; background: rgba(255, 255, 255, 0.045);
                     overflow: hidden; }
    .row .bar, .mrow .bar { height: 100%; border-radius: 11px;
                background: linear-gradient(90deg, rgba(52, 211, 153, 0.35), var(--green)); }
    .row .bar.neg, .mrow .bar.neg { background: linear-gradient(90deg, rgba(251, 113, 133, 0.35), var(--red)); }
    .row .val { font: 600 26px var(--mono); width: 150px; text-align: right;
                font-variant-numeric: tabular-nums; }
    .row .val.pos { color: var(--green); } .row .val.neg { color: var(--red); }
    /* the comparison column: present, deliberately quieter than the ranked one */
    .row .cmp { font: 500 24px var(--mono); width: 168px; text-align: right;
                font-variant-numeric: tabular-nums; color: var(--faint); }
    .row .cmp.pos { color: var(--green); opacity: 0.58; }
    .row .cmp.neg { color: var(--red); opacity: 0.58; }
    .rowhead { display: flex; align-items: center; gap: 20px; margin-bottom: 4px;
               font: 600 15px var(--mono); text-transform: uppercase; letter-spacing: 0.16em;
               color: var(--faint); }
    .row .nm2 { font: 600 24px var(--sans); width: 330px; letter-spacing: -0.02em;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sz-story .row .nm2 { font-size: 30px; width: 390px; }
    /* The verdict rides UNDER the name rather than taking a column of its
       own: at "Sell Immediately" a column would cost ~170px, and with the
       comparison column on there is not that much left to give. Stacked, it
       costs nothing horizontally and about 2px of row height. */
    .row .nm2.stack { display: flex; flex-direction: column; justify-content: center;
                      gap: 1px; line-height: 1.08; }
    .row .nm2.stack .nn, .row .nm2 .av { overflow: hidden; text-overflow: ellipsis;
                                         white-space: nowrap; }
    .row .nm2 .av { font: 700 14px var(--sans); letter-spacing: 0.1em; text-transform: uppercase; }
    .sz-story .row .nm2 .av { font-size: 17px; }
    /* Two steps down, chosen in the builder from the row count and the
       artboard. Everything shrinks together — bar, name, number — because a
       ranking with a shorter bar and the same 26px number reads as a
       mistake rather than as a denser card. */
    .rows.tight { gap: 11px; margin-top: 30px; }
    .rows.tight .row { gap: 16px; }
    .rows.tight .row .bar-rail { height: 32px; border-radius: 9px; }
    .rows.tight .row .nm2, .rows.tight .rowhead .nm2 { width: 300px; }
    .rows.tight .row .nm2 { font-size: 21px; }
    .rows.tight .row .nm2 .av { font-size: 12px; }
    .rows.tight .row .val, .rows.tight .rowhead .val { width: 132px; }
    .rows.tight .row .val { font-size: 23px; }
    .rows.tight .row .cmp, .rows.tight .rowhead .cmp { width: 148px; }
    .rows.tight .row .cmp { font-size: 21px; }
    .rows.tight .rowhead { font-size: 13px; }

    .rows.tighter { gap: 8px; margin-top: 24px; }
    .rows.tighter .row { gap: 13px; }
    .rows.tighter .row .bar-rail { height: 26px; border-radius: 8px; }
    .rows.tighter .row .nm2, .rows.tighter .rowhead .nm2 { width: 262px; }
    .rows.tighter .row .nm2 { font-size: 18px; }
    .rows.tighter .row .nm2 .av { font-size: 11px; letter-spacing: 0.08em; }
    .rows.tighter .row .val, .rows.tighter .rowhead .val { width: 114px; }
    .rows.tighter .row .val { font-size: 20px; }
    .rows.tighter .row .cmp, .rows.tighter .rowhead .cmp { width: 128px; }
    .rows.tighter .row .cmp { font-size: 18px; }
    .rows.tighter .rowhead { font-size: 12px; }
    .rowhead .nm2 { width: 330px; }
    .sz-story .rowhead .nm2 { width: 390px; }
    .rowhead .sym { width: 138px; }
    .rowhead .bar-rail { flex: 1; }
    .rowhead .val { width: 150px; text-align: right; }
    .rowhead .cmp { width: 168px; text-align: right; }

    /* movers, side by side: two rankings sharing one bar scale */
    .twocol { display: flex; gap: 40px; margin-top: 34px; }
    .mcol { flex: 1; min-width: 0; }
    .mch { font: 600 17px var(--mono); text-transform: uppercase; letter-spacing: 0.18em;
           padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid var(--hair); }
    .mch.pos { color: var(--green); } .mch.neg { color: var(--red); }
    .mrow { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .mrow .ms { font: 600 20px var(--sans); width: 168px; letter-spacing: -0.015em;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mrow .bar-rail { flex: 1; height: 30px; border-radius: 9px;
                      background: rgba(255, 255, 255, 0.045); overflow: hidden; }
    .mrow .mv { font: 600 23px var(--mono); width: 122px; text-align: right;
                font-variant-numeric: tabular-nums; }
    .mrow .mv.pos { color: var(--green); } .mrow .mv.neg { color: var(--red); }
    .mnone { font-size: 19px; color: var(--faint); padding: 10px 0; }
    /* a long list tightens instead of running off the card */
    .twocol.dense { gap: 30px; margin-top: 26px; }
    .twocol.dense .mch { font-size: 15px; padding-bottom: 9px; margin-bottom: 10px; }
    .twocol.dense .mrow { gap: 11px; margin-bottom: 8px; }
    .twocol.dense .mrow .ms { font-size: 21px; width: 92px; }
    .twocol.dense .mrow .bar-rail { height: 24px; border-radius: 7px; }
    .twocol.dense .mrow .mv { font-size: 20px; width: 104px; }

    /* the introduction card */
    .feat { display: flex; align-items: flex-start; gap: 22px; padding: 20px 24px;
            border: 1px solid var(--hair); border-radius: 18px;
            background: rgba(255, 255, 255, 0.028); }
    .feat .fi { width: 54px; height: 54px; flex: none; border-radius: 15px; display: grid;
                place-items: center; border: 1px solid; }
    .feat .fi svg { width: 27px; height: 27px; stroke: currentColor; fill: none;
                    stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .feat h3 { margin: 2px 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
    .feat p { margin: 0; font-size: 17.5px; color: var(--muted); line-height: 1.45; }

    /* ---- the advice board ---------------------------------------------- */
    .abar { display: flex; height: 34px; border-radius: 999px; overflow: hidden; margin-top: 36px; }
    .abar div { height: 100%; }
    .atally { display: flex; flex-direction: column; gap: 12px; margin-top: 28px; }
    .arow { display: flex; align-items: center; gap: 20px; }
    .arow .an { width: 300px; font: 700 27px var(--sans); }
    .arow .arail { flex: 1; height: 30px; border-radius: 9px; background: rgba(255, 255, 255, 0.04); overflow: hidden; }
    .arow .afill { height: 100%; border-radius: 9px; opacity: 0.85; }
    .arow .ac { width: 92px; text-align: right; font: 700 30px var(--mono); font-variant-numeric: tabular-nums; }
    .arow .ap { width: 92px; text-align: right; font: 500 21px var(--mono); color: var(--faint); }

    .frule { display: flex; align-items: baseline; gap: 20px; padding: 17px 24px;
             border-radius: 15px; border: 1px solid var(--hair); background: rgba(255, 255, 255, 0.024); }
    .frule + .frule { margin-top: 11px; }
    .frule .fn { font: 700 30px var(--mono); width: 84px; color: var(--green); }
    .frule .ft { font-size: 25px; font-weight: 600; }
    .frule .fs { margin-left: auto; font: 500 19px var(--mono); color: var(--faint); }

    .pcard { display: flex; align-items: center; gap: 22px; padding: 20px 26px;
             border-radius: 17px; border: 1px solid var(--hair); background: rgba(255, 255, 255, 0.024); }
    .pcard + .pcard { margin-top: 12px; }
    .pcard .pn { width: 240px; font: 600 25px var(--sans); color: var(--muted); }
    .pcard .pv { font: 800 30px var(--sans); letter-spacing: -0.02em; width: 250px; }
    .pcard .pw { margin-left: auto; text-align: right; font-size: 19px; color: var(--faint); max-width: 330px; line-height: 1.35; }

    .vrow { display: flex; align-items: center; gap: 20px; padding: 15px 22px;
            border-radius: 14px; border: 1px solid var(--hair); background: rgba(255, 255, 255, 0.024); }
    .vrow + .vrow { margin-top: 10px; }
    .vrow .vs { font: 700 25px var(--sans); width: 290px; letter-spacing: -0.02em;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vrow .vw { font-size: 21px; color: var(--muted); }
    .vrow .vp { margin-left: auto; font: 600 23px var(--mono); }

    /* ---- explainer slide grammars ------------------------------------- */
    /* dots make a card read as one of a set, which is the whole point of a
       carousel; everything else here is a diagram drawn in plain CSS */
    .dots { display: flex; gap: 10px; margin-top: 30px; }
    .dots i { width: 11px; height: 11px; border-radius: 50%;
              background: rgba(255, 255, 255, 0.16); }
    .dots i.on { background: var(--green); }

    .flow { display: flex; flex-direction: column; gap: 14px; margin-top: 34px; }
    .flowrow { display: flex; align-items: center; gap: 18px; }
    .flowrow .fk { width: 210px; font: 600 23px var(--sans); color: var(--muted); }
    .flowrow .fq { flex: 1; font-size: 21px; color: var(--faint); }
    .flowrow .fv { font: 700 26px var(--mono); padding: 9px 20px; border-radius: 12px;
                   border: 1px solid var(--hair-2); background: rgba(255, 255, 255, 0.04); }
    .flowend { margin-top: 26px; padding: 24px 28px; border-radius: 20px;
               border: 1px solid rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.08); }
    .flowend .fl { font-size: 18px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--green); }
    .flowend .fa { margin-top: 8px; font: 800 46px var(--sans); letter-spacing: -0.03em; }
    .flowend .fw { margin-top: 6px; font-size: 21px; color: var(--muted); }

    .rungs { display: flex; flex-direction: column; gap: 10px; margin-top: 30px; }
    .rung { display: flex; align-items: center; gap: 16px; padding: 15px 22px;
            border-radius: 15px; border: 1px solid var(--hair);
            background: rgba(255, 255, 255, 0.022); }
    .rung .rs { width: 92px; font: 600 15px var(--mono); text-transform: uppercase;
                letter-spacing: 0.12em; color: var(--faint); }
    .rung .rf { font: 600 24px var(--sans); }
    .rung .ra { margin-left: auto; font: 700 22px var(--mono); color: var(--muted); }
    .rung.lit { border-color: rgba(52, 211, 153, 0.5); background: rgba(52, 211, 153, 0.1); }
    .rung.lit .rf, .rung.lit .ra { color: var(--green); }
    .rung.past { opacity: 0.5; }
    .rung.never { opacity: 0.3; }
    .rung.never .ra { font-size: 18px; }

    .tiers { display: flex; gap: 8px; margin-top: 34px; }
    .tier { flex: 1; padding: 18px 12px; border-radius: 14px; text-align: center;
            border: 1px solid var(--hair-2); }
    .tier b { display: block; font-size: 19px; font-weight: 700; }
    .tier span { display: block; margin-top: 6px; font-size: 15px; color: var(--faint); }

    .mock { margin-top: 32px; padding: 26px; border-radius: 20px;
            border: 1px solid var(--hair-2); background: rgba(255, 255, 255, 0.025); }
    .mockrow { display: flex; align-items: center; gap: 20px; padding: 16px 18px;
               border-radius: 12px; background: rgba(255, 255, 255, 0.03); font: 600 24px var(--mono); }
    .mockrow + .mockrow { margin-top: 8px; }
    .mockrow .star { width: 46px; height: 46px; border-radius: 12px; display: grid;
                     place-items: center; font-size: 26px; color: var(--amber);
                     border: 2px solid var(--amber); }
    .mockrow .mg { margin-left: auto; color: var(--green); }
    .mockcap { margin-top: 18px; font-size: 19px; color: var(--faint); }

    .stmts { display: flex; flex-direction: column; gap: 16px; margin-top: 32px; }
    .stmt { display: flex; gap: 20px; align-items: flex-start; padding: 22px 26px;
            border-radius: 18px; border: 1px solid var(--hair); background: rgba(255, 255, 255, 0.022); }
    .stmt .x { font: 700 30px var(--sans); color: var(--red); line-height: 1; }
    .stmt .y { font: 700 30px var(--sans); color: var(--green); line-height: 1; }
    .stmt b { display: block; font-size: 26px; font-weight: 700; }
    .stmt span { display: block; margin-top: 5px; font-size: 19px; color: var(--muted); line-height: 1.45; }

    /* chart legend */
    .chipL { display: inline-flex; align-items: center; gap: 10px; padding: 8px 18px;
             border-radius: 999px; border: 1px solid var(--hair-2);
             background: rgba(255, 255, 255, 0.03);
             font: 600 20px var(--mono); color: var(--text); letter-spacing: -0.01em; }
    .chipL .cdot { width: 12px; height: 12px; border-radius: 50%; }
    .chips { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }

    /* announcement */
    .ann-kick { font-size: 19px; font-weight: 600; letter-spacing: 0.26em; text-transform: uppercase;
                color: var(--green); }
    .ann-head { margin: 18px 0 0; font-size: 86px; font-weight: 800; line-height: 1.03;
                letter-spacing: -0.05em; white-space: pre-wrap; }
    .ann-body { margin: 30px 0 0; font-size: 27px; line-height: 1.55; color: var(--muted);
                max-width: 34ch; white-space: pre-wrap; }

    /* ---- the story shape fills, rather than centring a post inside it ---
       A 9:16 card is 570px taller than a 4:5 one. Centring the same block in
       it leaves a third of the frame empty at each end, so on a story the
       content column takes the full height and the list, grid or tally grows
       into the space instead. Type steps up too: a story is read full-screen
       on a phone, where a post is read in a scrolling feed. */
    .sz-story .s-body > div { display: flex; flex-direction: column; height: 100%; }
    .sz-story .s-kick { font-size: 21px; margin-top: 30px; }
    .sz-story .s-title { font-size: 84px; }
    .sz-story .s-sub { font-size: 25px; max-width: 34ch; }
    .sz-story .s-foot { font-size: 20px; }
    .sz-story .s-empty { font-size: 36px; }

    /* the lists spread through the space rather than bunching at the top */
    .sz-story .rows, .sz-story .atally, .sz-story .stmts, .sz-story .flow,
    .sz-story .rungs { flex: 1; justify-content: space-evenly; }
    .sz-story .twocol { flex: 1; }
    .sz-story .row .sym { font-size: 32px; width: 168px; }
    .sz-story .row .val { font-size: 31px; width: 178px; }
    .sz-story .row .cmp { font-size: 28px; width: 190px; }
    .sz-story .row .bar-rail { height: 50px; }
    .sz-story .arow .an { font-size: 32px; width: 350px; }
    .sz-story .arow .ac { font-size: 36px; }
    .sz-story .arow .arail { height: 38px; }
    .sz-story .frule .ft { font-size: 29px; }
    .sz-story .frule .fn { font-size: 35px; }
    .sz-story .pcard .pv { font-size: 35px; }
    .sz-story .feat h3 { font-size: 28px; }
    .sz-story .feat p { font-size: 21px; }
    .sz-story .ftile .fv { font-size: 44px; }

    /* the sparkline grid stretches its rows, and the shapes stretch with
       them — the sparklines are drawn with preserveAspectRatio="none", so a
       taller tile is a taller chart rather than a distorted one */
    .sz-story .spk { flex: 1; grid-auto-rows: 1fr; gap: 20px; }
    .sz-story .spkt { display: flex; flex-direction: column; }
    .sz-story .spkt svg { flex: 1; height: auto; min-height: 90px; }
    .sz-story .spkt .ss { font-size: 24px; }
    .sz-story .spkt .sv { font-size: 25px; }

    /* the 52-week track: one row carries the fall and the recovery at once */
    .tracks { display: flex; flex-direction: column; gap: 18px; margin-top: 34px; }
    .trk { display: grid; grid-template-columns: 250px 1fr 108px 108px; align-items: center; gap: 16px; }
    .trk .ts { font: 600 23px var(--sans); letter-spacing: -0.02em;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .trk .trail { position: relative; height: 16px; border-radius: 999px;
                  background: rgba(255, 255, 255, 0.05); border: 1px solid var(--hair); }
    .trk .tfill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; }
    .trk .tdot { position: absolute; top: 50%; width: 22px; height: 22px; border-radius: 50%;
                 transform: translate(-50%, -50%); border: 3px solid #050505; }
    .trk .tlo { font: 600 21px var(--mono); text-align: right; color: var(--green); }
    .trk .thi { font: 600 21px var(--mono); text-align: right; color: var(--red); }
    .tkey { display: flex; justify-content: space-between; margin-top: 16px;
            font: 500 16px var(--mono); color: var(--faint); }
    .sz-story .tracks { flex: 1; justify-content: space-evenly; }
    .sz-story .trk { grid-template-columns: 300px 1fr 120px 120px; }
    .sz-story .trk .ts { font-size: 30px; }
    .sz-story .trk .trail { height: 20px; }
    .sz-story .trk .tlo, .sz-story .trk .thi { font-size: 25px; }

    /* sparklines: one small chart per stock, each reading on its own */
    .spk { display: grid; gap: 16px; margin-top: 32px; }
    .spkt { padding: 16px 18px 12px; border-radius: 16px; border: 1px solid var(--hair);
            background: rgba(255, 255, 255, 0.024); }
    .spkt .sh { display: flex; align-items: baseline; gap: 10px; }
    .spkt .ss { font: 600 20px var(--sans); letter-spacing: -0.02em; min-width: 0;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spkt .sv { margin-left: auto; font: 600 21px var(--mono); font-variant-numeric: tabular-nums; }
    .spkt .sv.pos { color: var(--green); } .spkt .sv.neg { color: var(--red); }
    .spkt svg { display: block; width: 100%; height: 78px; margin-top: 10px; }

    /* one company, in full: a grid of reported figures */
    .fgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 34px; }
    .ftile { padding: 20px 22px; border-radius: 17px; border: 1px solid var(--hair);
             background: rgba(255, 255, 255, 0.024); }
    .ftile .fk { font-size: 15px; font-weight: 500; text-transform: uppercase;
                 letter-spacing: 0.14em; color: var(--faint); }
    .ftile .fv { margin-top: 10px; font: 700 38px var(--mono); letter-spacing: -0.03em;
                 color: var(--green); }
    .ftile .fv.neg { color: var(--red); }
    .ftile .fn2 { margin-top: 5px; font-size: 15px; color: var(--faint); }

    /* the avatar card: negative margins undo the stage's padding, since a
       profile picture bleeds to every edge */
    .avatarFull { position: absolute; inset: 0; margin: -56px -64px -48px; display: grid;
                  place-items: center; }
    .avGlow { position: absolute; width: 76%; aspect-ratio: 1; border-radius: 50%;
              background: radial-gradient(circle, rgba(52, 211, 153, 0.22), transparent 62%); }
    .avMark { position: relative; width: 46%; height: 46%; stroke: #34d399; fill: none;
              stroke-width: 1.45; stroke-linecap: round; stroke-linejoin: round;
              filter: drop-shadow(0 0 26px rgba(52, 211, 153, 0.5)); }

    .s-empty { margin-top: 60px; font-size: 30px; color: var(--muted); line-height: 1.5; max-width: 30ch; }`;

  // ---- Motion -----------------------------------------------------------
  // A card is a still by default; Motion makes it perform for three seconds
  // so a screen recording is a finished reel. Everything is CSS on the same
  // markup — no second renderer, and the PNG export is untouched because the
  // host strips the class before it serialises.
  const STAGGER = ['.rows > *', '.atally > *', '.flow > *', '.rungs > *', '.stmts > *',
                   '.tiers > *', '.frule', '.pcard', '.vrow', '.band', '.feat', '.mockrow'];
  const MOTION = `
@keyframes cRise { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
@keyframes cFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes cDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.motion .s-top { animation: cFade .55s cubic-bezier(.22,1,.36,1) both; }
.motion .s-kick { animation: cRise .5s .1s cubic-bezier(.22,1,.36,1) both; }
.motion .s-title { animation: cRise .65s .18s cubic-bezier(.22,1,.36,1) both; }
.motion .s-sub, .motion .mockcap { animation: cFade .7s .75s ease both; }
.motion .s-empty { animation: cRise .6s .3s cubic-bezier(.22,1,.36,1) both; }
.motion .dots, .motion .chips, .motion .s-foot { animation: cFade .7s 1.15s ease both; }
.motion .rowhead { animation: cFade .5s .25s ease both; }
.motion .bar, .motion .afill, .motion .band .fill {
  transform-origin: left center; animation: cGrow .85s .3s cubic-bezier(.22,1,.36,1) both; }
.motion .abar { transform-origin: left center; animation: cGrow .9s .25s cubic-bezier(.22,1,.36,1) both; }
.motion .flowend { animation: cRise .6s 1s cubic-bezier(.22,1,.36,1) both; }
.motion .mock { animation: cFade .6s .25s ease both; }
.motion .cl { stroke-dasharray: 1; animation: cDraw 1.5s .3s cubic-bezier(.33,.9,.5,1) both; }
.motion .carea { animation: cFade .8s 1.2s ease both; }
.motion svg text { animation: cFade .6s 1.35s ease both; }
` + Array.from({ length: 18 }, (_, i) =>
    `.motion ${STAGGER.map((sel) => `${sel}:nth-child(${i + 1})`).join(', .motion ')}` +
    ` { animation: cRise .55s ${(0.28 + i * 0.06).toFixed(2)}s cubic-bezier(.22,1,.36,1) both; }`).join('\n');

  // Numbers land by counting, which is the difference between a screenshot
  // that moves and something that reads as video. The whole timeline is a
  // pure function of elapsed milliseconds — the live preview walks it with
  // rAF and the video exporter samples it frame by frame, so the two cannot
  // disagree. The original text is stashed on the element the first time it
  // is read, since later frames overwrite it.
  const NUM_DELAY = 320, NUM_DUR = 950;
  const MOTION_MS = 2600;                 // the animation's own length
  function numberTargets(root) {
    const out = [];
    root.querySelectorAll('.val, .cmp, .ac, .fn, .n, .fa').forEach((el) => {
      if (el.dataset.raw == null) el.dataset.raw = el.textContent;
      const raw = el.dataset.raw;
      const m = /^(\D*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(raw.trim());
      if (!m) return;
      const target = parseFloat(m[2].replace(/,/g, ''));
      if (!isFinite(target)) return;
      out.push({ el, raw, pre: m[1], target,
        dec: (m[2].split('.')[1] || '').length, post: m[3] });
    });
    return out;
  }
  function setNumbersAt(list, t) {
    const p = Math.max(0, Math.min(1, (t - NUM_DELAY) / NUM_DUR));
    const e = 1 - Math.pow(1 - p, 3);
    list.forEach((n) => {
      n.el.textContent = p >= 1 ? n.raw : n.pre + (n.target * e).toFixed(n.dec) + n.post;
    });
  }

  // Restarting means removing the class, forcing a reflow and putting it
  // back: without the reflow the browser coalesces the two changes and
  // nothing replays.
  function motion(root) {
    if (!root) return;
    root.classList.remove('motion');
    void root.offsetWidth;
    root.classList.add('motion');
    const list = numberTargets(root);
    const t0 = performance.now();
    const step = (t) => {
      const el = t - t0;
      setNumbersAt(list, el);
      if (el < NUM_DELAY + NUM_DUR) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // The exporter's half: pin every animation to one instant so the card can
  // be photographed at that instant. CSS animations are real Animation
  // objects, so seeking them is exact rather than a re-implementation.
  function freezeAt(root, t) {
    if (!root) return;
    if (!root.classList.contains('motion')) root.classList.add('motion');
    root.getAnimations({ subtree: true }).forEach((a) => {
      try {
        a.pause();
        const end = (a.effect && a.effect.getComputedTiming().endTime) || t;
        a.currentTime = Math.min(t, end);
      } catch (e) { /* an animation that will not seek is left where it is */ }
    });
    setNumbersAt(numberTargets(root), t);
  }
  function unfreeze(root) {
    if (!root) return;
    root.getAnimations({ subtree: true }).forEach((a) => { try { a.cancel(); } catch (e) {} });
    root.classList.remove('motion');
    root.querySelectorAll('[data-raw]').forEach((el) => {
      el.textContent = el.dataset.raw;
      delete el.dataset.raw;
    });
  }

  function injectStyle() {
    if (document.getElementById('cards-style')) return;
    const el = document.createElement('style');
    el.id = 'cards-style';
    el.textContent = STYLE + MOTION;
    document.head.appendChild(el);
  }

  window.Cards = {
    STYLE, MOTION, injectStyle, motion, freezeAt, unfreeze, MOTION_MS,
    ids: Object.keys(BUILDERS),
    ADV_PROFILES,
    MOV_PERIODS,
    // the sectors actually present, so a picker can never offer an empty one
    sectors: (rows) => [...new Set((rows || []).map((x) => x.sector).filter(Boolean))].sort(),
    // the industries present, inside one sector when one is given
    industries: (rows, sector) => [...new Set((rows || [])
      .filter((x) => !sector || sector === 'All' || x.sector === sector)
      .map((x) => x.industry).filter(Boolean))].sort(),
    CHART_WINDOWS,
    // shape only — the host builds its own slide picker from this
    topics: () => TOPICS.map((t) => ({ id: t.id, name: t.name, slides: t.slides.map((sl) => sl.kind) })),
    build(id, ctx) {
      const c = ctx || {};
      stocks = c.stocks || [];
      myLists = c.myLists || {};
      size = c.size || { id: 'portrait', w: 1080, h: 1350 };
      O = c.opts || {};
      getBasket = c.getBasket || (() => null);
      const fn = BUILDERS[id] || BUILDERS.movers;
      return fn();
    },
  };
})();
