// cards.js — every card the studio and the member Cards page draw, built
// once and shared. The pages own their chrome, their controls and their
// export; this module owns the CARD: its markup, its styles and the wording
// on it. Two copies of "Top gainers this week" would have drifted inside a
// week, which is the same reason rowcard.js, screens.js and action.js exist.
//
// Contract: Cards.build(id, ctx) -> HTML string for the card's inner body.
//   ctx.stocks    the snapshot rows (scored, with prevTech)
//   ctx.myLists   the caller's own portfolios, { name: [symbols] }
//   ctx.getShortMoves () -> the fortnight's short-interest change, or null
//                 while it loads. Only the `shortmoves` card needs it; ask
//                 Cards.shortMovesNeed(tpl) rather than listing templates.
//   ctx.filers    { SYMBOL: cik } — which symbols are the same company, so
//                 a dual-class name is one holding and not two. A host that
//                 passes none simply folds nothing.
//   ctx.size      { id, w, h } — the artboard the card is being drawn into
//   ctx.opts      the control values, by control id (movPeriod, chtWin, ...)
//   ctx.getBasket (days) -> the /api/basket payload or null while it loads
//   ctx.getHistory (symbol, days) -> { dates, closes } for ONE symbol, or
//                 null while it loads. Only the chart card's moving average
//                 needs it, and only because an average needs run-up from
//                 BEFORE the window — see CHART_MAS.
//   ctx.chart     ONE stock's own closes, for the `stock` card — see below
// The module reads no DOM and issues no requests: a host that hands it
// numbers gets a card back, which is what makes it testable off-page.
(function (global) {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let stocks = [];
  let myLists = {};
  // The starter screens, as the host holds them: [{ id, name, group, def }].
  // A host that does not pass them simply offers no screen cut.
  let screens = [];
  // Symbol -> issuer CIK. Only the three cards that add up market value read
  // it, and it never reaches a card: it is consumed by foldListings and
  // discarded. See that function for why the display name will not do.
  let filers = {};
  let size = { id: 'portrait', w: 1080, h: 1350 };
  let O = {};                       // control values, by control id
  let getBasket = () => null;
  let getHistory = () => null;
  // One symbol's filings series, for the Evolution card. A third channel
  // beside the basket and the per-symbol closes, because it answers a
  // different question from either and both hosts cache it themselves.
  let getEvolution = () => null;
  // The fortnight's short-interest change, per symbol. A fourth channel
  // beside the basket, the per-symbol closes and the filings series,
  // because it is the only card fed by the FINRA archive and both hosts
  // cache it themselves.
  let getShortMoves = () => null;
  // ONE stock's own daily closes — { symbol, name, closes, dates, rangeLabel,
  // price, today }. A plain data field rather than a getter, because the only
  // host that has it (the stock page) already holds it: it drew the chart from
  // these very numbers. Every other host leaves it null and the `stock` card
  // says so rather than inventing a line.
  let chartOne = null;

    // The date on a card is the DATA's, not the reader's clock. It stamped
    // `new Date()` until 2026-09-16, so a card built on a Saturday — or after
    // a refresh had failed — put today's date over Thursday's prices, and that
    // card goes on Instagram. Noon local, because `new Date('2026-09-16')`
    // parses as UTC midnight and renders as the 15th west of Greenwich.
    let marketDay = null;
    let pulledAt = null;
    // ALWAYS New York, never the builder's own zone. The card is a baked
    // image: whoever renders it bakes their clock into something other people
    // read, and the market it describes keeps one timezone. ET is also what
    // the refresh report prints.
    const timeStr = (iso) => {
      const t = Date.parse(iso || '');
      if (!isFinite(t)) return '';
      try {
        return new Date(t).toLocaleTimeString('en-US',
          { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
      } catch (e) { return ''; }
    };
    const dateStr = () => {
      const d = marketDay ? new Date(marketDay + 'T12:00:00') : new Date();
      const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const at = timeStr(pulledAt);
      return at ? day + ' · ' + at : day;
    };
    // dated: true for the data cards, whose numbers belong to a day. The
    // explainers are evergreen, so they carry no date — and no universe
    // count anywhere, since a post outlives the number.
    function chromeTop(dated) {
      return '<div class="s-top">' +
        '<span class="s-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M3 17.4 8.6 12l3.6 2.7L20 6.4"/><path d="M14.6 6.4H20v5.4"/></svg></span>' +
        '<span class="s-lock"><span class="s-word">Tickr Lab</span>' +
        '<span class="s-tag">From data to decisions</span></span>' +
        (dated === false ? '' : `<span class="s-date">${esc(dateStr())}</span>`) + '</div>';
    }
    function chromeFoot() {
      return '<div class="s-foot"><b>tickrlab.com</b><span class="dot"></span>' +
        '<span>Screened nightly</span><span class="dot"></span>' +
        '<span>Mechanical readings — not investment advice</span></div>';
    }
    const pct = (n, d = 1) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%');

    // ---- the four index funds, and why the list is restated here ----------
    //
    // They are ordinary rows in the universe, so anything that aggregates the
    // market has to take them OUT first or the S&P's own ETF sits inside
    // Technology and inflates it — /consolidated records exactly that trap.
    //
    // server.js owns the authoritative set (it is the delete guard: these four
    // cannot be removed from the screener, because every group page draws
    // their line). This module cannot read it: cards.js is deliberately
    // standalone, with no DOM and no requires, so that a card renders
    // identically in the browser and in Node. The copy is the cost of that,
    // and `benchmarks()` is exported so a test can assert the two agree
    // rather than hoping they do — the treatment BRAND_IG already gets.
    const BENCH = [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'],
      ['IWM', 'Russell 2000'], ['DIA', 'Dow 30']];
    const IS_BENCH = new Set(BENCH.map((b) => b[0]));

    // THE ELEVEN SELECT SECTOR SPDRs, one per GICS sector. Our sector names
    // map one-to-one onto GICS at sector level, which is what makes this a
    // complete set rather than a sample.
    //
    // Restated here rather than read from the server, for the reason
    // `benchmarks()` is: this module has no requires and no DOM, which is what
    // lets a card render identically in Node and the browser. Exported so a
    // test can assert the two lists agree rather than hope.
    const SECTOR_ETF = [
      ['Technology', 'XLK'], ['Financial Services', 'XLF'], ['Healthcare', 'XLV'],
      ['Energy', 'XLE'], ['Industrials', 'XLI'], ['Consumer Cyclical', 'XLY'],
      ['Consumer Defensive', 'XLP'], ['Utilities', 'XLU'], ['Real Estate', 'XLRE'],
      ['Basic Materials', 'XLB'], ['Communication Services', 'XLC'],
    ];
    const IS_SECTOR_ETF = new Set(SECTOR_ETF.map((s) => s[1]));

    // THE S&P 500 CUT, offered by every scoped template through scopeOf.
    // Exported, so the studio builds its eight pickers from the catalogue the
    // card READS rather than from a copy in the markup: a host sending `yes`
    // where the module means `in` would silently filter nothing, which is the
    // quiet-fallback class this module exists to keep out.
    //
    // Three values and no fourth. "Unknown" is deliberately not offered as a
    // cut: it is a gap in our own data rather than a fact about a company, and
    // a card captioned "stocks we have not checked" is not a card.
    const SP_CUTS = [
      ['All', 'All stocks'],
      ['in', 'In the index'],
      ['out', 'Not in the index'],
    ];
    // What the kicker calls each cut. `All` is absent, so it names nothing.
    const SP_CUT_LABEL = { in: 'S&P 500', out: 'Outside the S&P 500' };

    // THE THREE-STATE READ, IN ONE PLACE. `=== true` / `=== false`, NEVER
    // truthy/falsy, and that is the whole guard: `spMember` is three-state.
    // It is null until a holdings file has been imported, and null is not
    // No -- "not in the S&P 500" said of a stock nobody has checked is a
    // confident, wrong answer, which is the same rule the screener's own
    // column keeps. So an unknown row is in NEITHER cut, and on an instance
    // with no file both cuts are empty. That reads correctly, because every
    // caller names the cut that emptied the card.
    //
    // Membership only. The index WEIGHT never leaves /holdings: a Yes/No for
    // the stocks we happen to track is derivable from any financial website,
    // a weighted constituent list is the issuer's dataset.
    //
    // SHARED by scopeOf -- which gives it to the eight scoped templates at
    // once -- and by tplDay, which has no scope pickers at all and reads its
    // own control. Two copies of this guard would drift the first time one
    // was tuned, which is the drift this module exists to prevent.
    function spFilter(rows, cut) {
      if (cut === 'in') return rows.filter((x) => x.spMember === true);
      if (cut === 'out') return rows.filter((x) => x.spMember === false);
      return rows;
    }

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
      // Calendar, like wtd and mtd above -- and unlike those two it needs no
      // stamping from /api/period-anchors, because computeStocks puts ytdPct
      // on every row.
      ytd: ['ytdPct', 'this year', 'year to date'],
      y1: ['oneYearPct', 'past year', '1 year'],
    };
    // THE SNAPSHOT'S PERIODS, a SUBSET of MOV_PERIODS rather than a second
    // mapping -- one catalogue, so the Snapshot and the Movers card can
    // never disagree about what "past week" reads.
    //
    // WHY THESE FIVE. The owner asked for "week, Month, YTD and Year"
    // beside the day, and that is exactly the screener's own column family:
    // 1W and 1M are ROLLING (five and 21 sessions), YTD is CALENDAR (since
    // last year's close) and 1Y is rolling again. The mix looks odd written
    // down and is the house convention, so the card reads in the same words
    // as the table it is made from.
    //
    // `wtd` and `mtd` are deliberately NOT offered. They need the host to
    // stamp anchors from /api/period-anchors, which /api/m/post does not do
    // -- so a saved Snapshot on those would draw blank on the phone, which
    // is the trap the Movers card already records for its own calendar
    // windows. YTD needs no stamping: computeStocks puts ytdPct on the row.
    const SNAP_PERIODS = [
      ['d', 'Today'], ['w1', 'Past week'], ['m1', 'Past month'],
      ['ytd', 'This year'], ['y1', 'Past year'],
    ];

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
      const taxo = ind && ind !== 'All' ? ind : sec && sec !== 'All' ? sec : null;
      // The size band shares the prefix too (movSector -> movCap), and is
      // ORTHOGONAL to the two above rather than narrower: a band is not a
      // smaller sector, so it is ANDed and named alongside the taxonomy cut
      // instead of replacing it. `/cards` has no such control, so the member
      // page filters nothing and is unchanged.
      //
      // A fund has no band, so a size-filtered card drops it \u2014 which is right:
      // this is a cut by company size, and a fund is not a company.
      const cap = O[sectorKey.replace(/Sector$/, 'Cap')] || 'All';
      if (cap && cap !== 'All') rows = rows.filter((x) => x.capBand === cap);
      // S&P 500 MEMBERSHIP, on the same prefix again (movSector -> movSp500),
      // so one change here gives it to every scoped template at once — the
      // reason the size band and the screen cut each cost one change. The
      // three-state guard lives on spFilter above, shared with the day card.
      const sp = O[sectorKey.replace(/Sector$/, 'Sp500')] || 'All';
      rows = spFilter(rows, sp);
      // A SCREEN is the screener's own question, asked of a card. It shares the
      // prefix like the three above (movSector -> movScreen), so putting it
      // here is the one change that gives it to every scoped template at once —
      // the same reason the size band cost one change.
      //
      // The definition is evaluated by `Filters.screenRows`, the module the
      // server require()s and the screener loads, so a card and the table
      // cannot disagree about who is in a screen. Read off the global lazily
      // and guarded: a host that loaded neither the screens nor filters.js
      // filters nothing rather than throwing, which is how `/cards` used to
      // ignore the industry control it did not have.
      const scrId = O[sectorKey.replace(/Sector$/, 'Screen')] || '';
      let scrName = null;
      if (scrId) {
        const F = (typeof globalThis !== 'undefined' && globalThis.Filters) || null;
        const sc = screens.find((x) => x && x.id === scrId);
        if (sc && F && F.screenRows) {
          // screenRows applies the screen's own sector / industry / advice /
          // move as well as its filters, so this is the whole question and not
          // just its numeric half. It also sorts; every card re-sorts to its
          // own measure afterwards, so that is spent rather than wrong.
          rows = F.screenRows(sc.def || {}, rows);
          scrName = sc.name;
        }
      }
      // The screen leads the kicker: it is the idea, where a sector or a band
      // is a narrowing of it.
      const cuts = [scrName, taxo, cap && cap !== 'All' ? `${cap} caps` : null,
        SP_CUT_LABEL[sp] || null].filter(Boolean);
      const base = label;                 // before the cuts are folded in
      if (cuts.length) {
        const cut = cuts.join(' \u00b7 ');
        label = v === 'All' ? cut : `${label} \u00b7 ${cut}`;
      }
      // `screen` rides back so a card can tell "the screen caught nobody today"
      // apart from "this data is not stored yet". They are different facts and
      // an empty card that blames the wrong one gets posted.
      //
      // `labelSansScreen` is for a card that PROMOTES the screen to its title:
      // the kicker would otherwise print the same words again directly above
      // the headline. Cards that leave the screen in the kicker use `label`.
      const sansCuts = cuts.filter((c) => c !== scrName);
      const labelSansScreen = sansCuts.length
        ? (v === 'All' ? sansCuts.join(' · ') : `${base} · ${sansCuts.join(' · ')}`)
        : base;
      return { rows, label, labelSansScreen, screen: scrName };
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
        // On a story the rows spread down the column, so the shorter list is
        // padded with invisible rows: the nth gainer then sits level with the
        // nth loser instead of the two columns spacing out differently.
        const slots = size.id === 'story' ? Math.max(ups.length, downs.length) : 0;
        const pad = (list) => (list.length && slots > list.length
          ? '<div class="mrow mpad" aria-hidden="true"><span class="ms">&nbsp;</span><span class="bar-rail"></span><span class="mv">&nbsp;</span></div>'
            .repeat(slots - list.length) : '');
        const col = (title, list, neg) =>
          `<div class="mcol"><div class="mch ${neg ? 'neg' : 'pos'}">${esc(title)}</div><div class="mlist">` +
          (list.length ? list.map((x) => {
            const w = Math.max(6, Math.round(Math.abs(x[field]) / mx * 100));
            return `<div class="mrow"><span class="ms">${esc(movLabel(x))}</span>` +
              `<span class="bar-rail"><span class="bar${neg ? ' neg' : ''}" style="width:${w}%;display:block"></span></span>` +
              `<span class="mv ${neg ? 'neg' : 'pos'}">${pct(x[field])}</span></div>`;
          }).join('') + pad(list) : '<div class="mnone">nothing moved that way</div>') +
          '</div></div>';
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)} \u00b7 ${esc(periodLabel)}</span>` +
          '<h2 class="s-title">Up and down<br><span class="dim">' + esc(periodLabel) + '</span></h2>' +
          `<div class="twocol${dense}${slots && slots <= 6 ? ' few' : ''}">${col('Gainers', ups, false)}${col('Losers', downs, true)}</div>` +
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
                (av ? `<span class="av" style="color:${pal.tints[av] || 'var(--muted)'}">${esc(av)}</span>` : '') +
                '</span>'
              : `<span class="nm2">${esc(movLabel(s))}</span>`;
            return `<div class="row">${label}` +
              `<span class="bar-rail"><span class="bar${neg ? ' neg' : ''}" style="width:${w}%;display:block"></span></span>` +
              `<span class="val ${neg ? 'neg' : 'pos'}">${pct(s[field])}</span>` +
              (cmp ? `<span class="cmp ${c == null ? '' : c < 0 ? 'neg' : 'pos'}">${pct(c)}</span>` : '') +
              '</div>';
          }).join('')}</div>` +
          (cmp ? `<p class="s-sub wide" style="--fs:18px;margin-top:22px">Ranked on ${esc(periodLabel)}; the right column is the same stock over the ${esc(cmp[1].replace(/^(this|past) /, ''))}, for context.</p>` : '')
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
    // The DARK ladder. Read only through pal.tints now (LADDER_LIGHT is its
    // light counterpart), so no template can print it on a ground it does not
    // clear — which is what five of them were doing until 2026-09-30.
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
          '<p class="s-sub wide" style="--fs:19px;margin-top:26px">Every verdict names the one rule that fired first. Counting those rules says what kind of market this is \u2014 not what happens next.</p>' +
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
            `<div class="frule"><span class="fn" style="color:${pal.tints[g.action] || 'var(--green)'}">\u00d7${g.n}</span>` +
            `<span class="ft">${esc(flag)}<span style="display:block;font-size:18px;font-weight:500;color:var(--faint);margin-top:4px">` +
            `now ${esc(g.action)} \u00b7 ${esc(g.syms.slice(0, 3).map(symOf).join(', '))}${g.syms.length > 3 ? ` +${g.syms.length - 3}` : ''}</span></span>` +
            '</div>').join('')}</div>` +
          `<p class="s-sub wide" style="--fs:19px;margin-top:26px">${changes.length} of ${rows.length} verdicts moved \u2014 ` +
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
            `<span class="pv" style="color:${pal.tints[r.action] || 'var(--text)'}">${esc(r.action)}</span>` +
            `<span class="pw">${esc(r.flag || '')}</span></div>`).join('')}</div>` +
          `<p class="s-sub wide" style="--fs:19px;margin-top:26px">Same stock, same night, five fixed rule sets \u2014 ${agree ? 'and this time they all read it the same way.' : 'and they do not agree. Each names the rule that decided it, so the disagreement is readable rather than mysterious.'}</p>` +
          '</div></div>' + chromeFoot();
      }

      if (mode === 'tier') {
        const want = O.advTier || 'Strong Buy';
        const hits = rows.filter((s) => verdict(s) === want)
          .slice(0, size.id === 'story' ? 11 : size.id === 'square' ? 6 : 8);
        const tint = pal.tints[want] || 'var(--text)';
        const body = hits.length
          ? `<div style="margin-top:32px">${hits.map((s) =>
              `<div class="vrow"><span class="vs">${esc(nameOf(s))}</span>` +
              `<span class="vw">${esc(flagOf(s) || '')}</span>` +
              `<span class="vp" style="color:${tint}">${esc(s.actionTrend || '')}</span></div>`).join('')}</div>`
          : `<p class="s-empty">Nothing in ${esc(scope.label)} reads ${esc(want)} tonight.</p>`;
        return chromeTop() +
          `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}${esc(prof)}</span>` +
          `<h2 class="s-title" style="color:${tint}">${esc(want)}</h2>` +
          `<p class="s-sub wide">What the ${esc(profile)} rules read as ${esc(want)} tonight, each with the rule that decided it.</p>` +
          body +
          '<p class="s-sub wide" style="--fs:18px;margin-top:24px">A mechanical reading of one table, not a recommendation tailored to anyone.</p>' +
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
          ? `<div style="width:${counts[i] / total * 100}%;background:${pal.tints[a]}"></div>` : '').join('')}</div>` +
        `<div class="atally">${order.map((a, i) =>
          `<div class="arow"><span class="an" style="color:${pal.tints[a]}">${esc(a)}</span>` +
          `<span class="arail"><span class="afill" style="display:block;width:${Math.max(2, counts[i] / max * 100)}%;background:${pal.tints[a]}"></span></span>` +
          `<span class="ac">${counts[i]}</span><span class="ap">${Math.round(counts[i] / total * 100)}%</span></div>`).join('')}</div>` +
        `<p class="s-sub wide" style="--fs:19px;margin-top:28px">${bull} of ${total} clear the buy rules tonight. A reading of the tape by fixed rules \u2014 it says what is, never what is next.</p>` +
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
            sub: 'A stock screener that shows its work — every verdict, every rule, every number, explained on click.' },
          { kind: 'steps', kick: 'The short version', title: 'Five things<br><span class="dim">it does</span>',
            rows: [
              ['screen', 'var(--green)', 'Screened nightly', 'Returns, trend and a 1–10 Quality score after every close, on an absolute scale — a 7 means the same thing in any market.'],
              ['rules', 'var(--accent)', 'Advice that shows its work', 'Five fixed rule profiles side by side, and every verdict names the ONE rule that fired.'],
              ['trend', 'var(--amber)', 'Twenty years of receipts', 'Trend ribbons, backtests and an indicator lab over the full bar archive — measured, not asserted.'],
              ['ask', 'var(--accent-2)', 'Alerts on what you follow', 'Watch one stock for one thing — a price level, a moving-average cross, a change of verdict — and see it when it happens.'],
              ['guest', 'var(--red)', 'Try it in one click', 'A guest preview: twenty real stocks across every sector, the whole table and every verdict. No account, no card.'],
            ] },
          // The posts are PUBLIC first and the list is the convenience, which
          // is the order the slide states them in. Saying the terms on the
          // slide rather than at the form is the point: a list nobody
          // regrets joining is cheaper than one people report.
          { kind: 'stmts', kick: 'Where the writing goes', title: 'Read it,<br><span class="dim">or have it sent</span>',
            rows: [
              ['y', 'A blog anyone can read', 'What the screen found, and what it did not. No sign-in, no paywall, nothing behind a form.'],
              ['y', 'New posts by email', 'Confirmed opt-in, one click to leave, and nothing else ever goes to that address.'],
              ['y', 'The failures are published too', 'The research that came back flat is written up beside the research that did not.'],
            ] },
          { kind: 'close' },
        ],
      },
      {
        id: 'advice', name: 'How Advice works',
        slides: [
          { kind: 'cover', kick: 'How it works', title: 'Advice,<br><span class="dim">explained</span>',
            sub: 'Not a score, not a black box: the company type picks the rulebook, four readings collapse to one word, and the rule that decided it is always named.' },
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
              ['y', 'Only what we measured', 'Eight research framings have been tested and seven came back flat. Every one is written down in the app, failures included.'],
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
        `<p class="s-sub" style="--fs:18px;margin-top:20px">First match wins, so everything under the lit rung was never consulted — that is why one rule can always be named. This is ${esc(nameOf(r))}, tonight.</p>`;
    }

    const TIER_DEF = [
      // THE PRODUCT'S OWN WORDS, not abbreviations of them. A card posted
      // beside the Advice board has to use the same six, or the vocabulary
      // the carousel exists to teach does not match the one on screen.
      ['Sell Immediately', 'var(--red)', 'get out'],
      ['Avoid', 'var(--red)', 'not now'],
      ['Hold', 'var(--muted)', 'sit still'],
      ['Buy with Risk', 'var(--amber)', 'eyes open'],
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

    // THE CLOSE ENDS ALL FOUR CARROUSELS, so it carries both asks: the preview
    // for anyone who wants to look now, and the list for anyone who would
    // rather it came to them. It states what the preview ACTUALLY contains —
    // it read "every feature live" until 2026-09-26, while a guest gets
    // neither the assistant nor personal lists, both of which the slides
    // before it promise.
    function slideClose() {
      return '<div class="flowend" style="margin-top:40px">' +
        '<div class="fl">No account needed</div>' +
        '<div class="fa">Try it free</div>' +
        '<div class="fw">Twenty real stocks, the whole table and every verdict — one click on the login page.</div></div>' +
        '<p class="s-sub wide" style="margin-top:30px">Or have the write-ups sent to you: <b>tickrlab.com/blog</b> — confirmed opt-in, one click to leave, and nothing else ever goes to that address.</p>';
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
        : (sl.sub ? `<p class="s-sub" style="--fs:26px;margin-top:26px">${sl.sub}</p>` : '');
      return chromeTop(false) +
        `<div class="s-body"><div><span class="s-kick">${esc(kick)}</span>` +
        `<h2 class="s-title">${title}</h2>${body}` +
        dotRow(topic.slides.length, idx) +
        '</div></div>' + chromeFoot();
    }

    // ---- the how-to deck ---------------------------------------------------
    // Training slides, one topic at a time (2026-10-02, owner's request:
    // "like training slides, focusing on each topic separately").
    //
    // A HOW-TO IS INSTRUCTIONS, AND THAT RAISES THE BAR ON EVERY CLAIM IN IT.
    // This file records four occasions when copy outlived its feature — "every
    // feature live", the welcome email, "49 columns", the owner-only refresh
    // buttons. Stale marketing disappoints; a stale STEP sends a reader to a
    // control they do not have. So every label below was read off index.html
    // and alerts.html rather than recalled, and every topic states WHO CAN DO
    // IT — because the answer genuinely differs, and the first topic is the
    // proof: `New theme` is admin-only while `New personal theme` is the
    // member's, so "create your own theme" means two different things.
    //
    // The close slide is deliberately NOT reused from the Intro deck. That one
    // ends "No account needed — try it free", which is exactly wrong under a
    // how-to for a member-only action: it would send the reader to the one
    // place the feature is not.
    const HOW_WHO = {
      member: 'Any signed-in member. A guest can read the screen but has no account to save one.',
      everyone: 'Everyone signed in, the guest preview included.',
      applyOnly: 'Everyone signed in can apply one. Starring needs an account; writing one is the owner’s.',
      readOnly: 'Everyone sees the verdict and the rule that fired. The full rule ladder is the owner’s.',
    };
    // The default name for each slide kind. A slide may override it with its
    // own `label` where the generic one would not say what it holds.
    const HOW_SLIDE_LABEL = {
      cover: 'What it is, and who can',
      hsteps: 'The steps',
      stmts: 'What it does not do',
    };
    const HOWTOS = [
      {
        id: 'theme', name: 'Themes, and your own lists',
        slides: [
          { kind: 'cover', kick: 'How to', title: 'Themes,<br><span class="dim">and your own lists</span>',
            sub: 'A named group of stocks, read as one line. The shared themes are the site’s; the ones you make are <b>personal themes</b>, private to your account.',
            who: 'member' },
          { kind: 'hsteps', kick: 'Four steps', title: 'Star it,<br><span class="dim">name it, read it</span>',
            rows: [
              ['Star the row', 'Every row in the screener carries a star beside the ticker. Click it.'],
              ['Pick a list, or make one', 'Tick an existing personal theme, or choose <b>New personal theme</b>. The menu stays open while you tick.'],
              ['Switch to it', 'The theme picker at the head of the bar lists your personal themes under the shared ones.'],
              ['Read it as one line', 'The chart arrow beside a theme opens its own page: the group against the S&amp;P 500 and the Dow, with every stock underneath.'],
            ] },
          { kind: 'stmts', kick: 'Worth knowing', title: 'What a theme<br><span class="dim">is not</span>',
            rows: [
              ['y', 'Ten of them, following your account', 'Personal themes are stored against your sign-in, so they are there on another machine.'],
              ['x', 'Not a way to add a stock', 'A personal theme is a filter over the shared screen. A ticker the site does not track cannot go in one.'],
              ['x', 'Not a portfolio', 'No shares, no cost basis, no profit and loss. Lists are lists.'],
            ] },
        ],
      },
      {
        id: 'view', name: 'Views — your own columns',
        slides: [
          { kind: 'cover', kick: 'How to', title: 'Views,<br><span class="dim">your own columns</span>',
            sub: 'The table is ninety-odd columns in twelve groups. A view is a named set of them — Symbol, Name and exactly the ones you picked.',
            who: 'member' },
          { kind: 'hsteps', kick: 'Four steps', title: 'Pick the columns<br><span class="dim">you actually read</span>',
            rows: [
              ['Open <b>View</b> in the bar', 'Standard is the full grouped table. Under it sit the starter views, then yours.'],
              ['Choose <b>+ New view</b>', 'It opens on whatever is on screen now, so you are editing rather than starting from nothing.'],
              ['Tick the columns', 'Grouped and searchable, with a running count and a tick for a whole group at once.'],
              ['<b>Save view</b>', 'It joins the View menu and follows your account to any machine.'],
            ] },
          { kind: 'stmts', kick: 'Worth knowing', title: 'How a view<br><span class="dim">behaves</span>',
            rows: [
              ['y', 'Ten views, renamed or deleted any time', 'The starter views are the site’s and carry a lock; the + beside one copies it into yours.'],
              ['y', 'Columns keep the table’s own order', 'A view chooses WHICH columns, not what order they sit in.'],
              ['x', 'It cannot bring back a hidden column', 'Columns switched off site-wide stay off. The editor does not offer them, rather than letting a tick do nothing.'],
            ] },
        ],
      },
      {
        id: 'screens', name: 'Screens',
        slides: [
          { kind: 'cover', kick: 'How to', title: 'Screens',
            // COUNTED LIVE, never written down. "Twenty-two of them, in six
            // groups" was the first draft and was already wrong: two starter
            // screens were inserted directly after the seed. The host hands
            // the module the real list, so a number that would rot is read
            // instead — and omitted entirely where the host passes none.
            sub: () => {
              const n = (screens || []).length;
              const g = new Set((screens || []).map((x) => x.group || x.grp).filter(Boolean)).size;
              return 'A screen is a saved question: its filters, its Sector / Industry / Advice picks, a sort and a column set.'
                + (n ? ` There are <b>${n}</b>, in ${g} group${g === 1 ? '' : 's'}.` : '');
            },
            who: 'applyOnly' },
          { kind: 'hsteps', kick: 'Four steps', title: 'Ask it,<br><span class="dim">then put it back</span>',
            rows: [
              ['Open <b>Screens</b> in the bar', 'Each one carries a live count of how many rows in view pass it right now.'],
              ['Click one to apply it', 'The table re-sorts, the columns change, and the filter row opens where the screen has something to show.'],
              ['Star the ones you use', 'A starred screen moves to a Favourites group at the top. It moves rather than copies, so the menu does not get longer.'],
              ['<b>Clear screen</b>', 'Puts the table back exactly as it was — your sort, your filters, your pickers.'],
            ] },
          { kind: 'hnames', label: 'The screens themselves', kick: 'What is in there',
            title: 'Questions<br><span class="dim">already asked</span>' },
          { kind: 'stmts', kick: 'Worth knowing', title: 'What a screen<br><span class="dim">does not keep</span>',
            rows: [
              ['x', 'Filters are never saved', 'A filter surviving a reload is a table missing rows for no visible reason. Whether the filter row is OPEN is remembered; what is typed in it is not.'],
              ['y', 'Change anything and it says so', 'The menu reads “(edited)” the moment the table stops matching the screen, so you always know which you are looking at.'],
              ['y', 'The screens are the site’s', 'You apply and star them. Writing and editing them is the owner’s, so everyone is asking the same question.'],
            ] },
        ],
      },
      {
        id: 'advice', name: 'Reading Advice',
        slides: [
          { kind: 'cover', kick: 'How to', title: 'Reading<br><span class="dim">the Advice group</span>',
            sub: 'A mechanical reading of the table, not a recommendation. The company type picks the rulebook, four readings collapse to one word, and the rule that decided it is always named.',
            who: 'readOnly' },
          { kind: 'hsteps', kick: 'Four steps', title: 'Read it<br><span class="dim">left to right</span>',
            rows: [
              ['Start with Type', 'Established, Early or a fund. It decides which rulebook runs — an Early company is never judged on a P/E.'],
              ['Then Trend, Entry, Fund., Guards', 'May you · now · how much conviction · anything to wait for. Each is one word, and Guards is blank on most rows by design.'],
              ['Read the verdict, and its reason', 'Hover any Advice cell: it names the ONE rule that fired. Five rule profiles sit side by side, Balanced first.'],
              ['Check the Cushion', 'How far the price can fall before the rules change their mind, in that stock’s own monthly volatility — so it compares across stocks.'],
            ] },
          { kind: 'stmts', kick: 'Worth knowing', title: 'What the verdict<br><span class="dim">is claiming</span>',
            rows: [
              ['y', 'Loss avoidance is the ORDER of the list', 'Every Sell, Avoid and Hold rule sits above every Buy rule in the source. That is a property of the code, not a setting.'],
              ['y', 'Six words, nothing else', 'Sell Immediately · Avoid · Hold · Buy with Risk · Buy · Strong Buy. No scores, no targets, no percentages of confidence.'],
              ['x', 'It does not pick winners', 'Replayed over twenty years the tiers order the DOWNSIDE correctly and the medians are flat. It manages risk; that is the honest claim.'],
            ] },
        ],
      },
      {
        id: 'alerts', name: 'Setting up alerts',
        slides: [
          { kind: 'cover', kick: 'How to', title: 'Alerts',
            sub: 'Watch one stock for one thing, and see it the next time you open the site. Five per account, in the app — no email, ever.',
            who: 'member' },
          { kind: 'hsteps', kick: 'Four steps', title: 'One stock,<br><span class="dim">one thing</span>',
            rows: [
              ['Open <b>Alerts</b> in the bar', 'Your alerts, and everything they have reported, on one page.'],
              ['Pick a stock and a type', 'Six: a price level, a moving-average cross, a change of Advice verdict, an RSI level, a 52-week extreme, or a big day.'],
              ['Press <b>Add alert</b>', 'The form asks only for what that type needs — a direction and a number, or just a direction.'],
              ['Watch the badge', 'Every page carries the unread count. Nothing interrupts you; it is there when you next look.'],
            ] },
          { kind: 'stmts', kick: 'Read this first', title: 'They are not<br><span class="dim">real time</span>',
            rows: [
              ['x', 'An alert fires when new data arrives', 'Prices land on a schedule — up to about half an hour during the session, the next morning outside it.'],
              ['y', 'A level is not an event', '“Above 150” fires on the CROSSING, once, not every time it is still true. Set one that is already true and it arms quietly instead.'],
              ['y', 'Pausing forgets where it was', 'A resumed alert missed whatever happened while it was off, so it arms again rather than reporting a crossing it never saw.'],
            ] },
        ],
      },
    ];
    const howById = (id) => HOWTOS.find((t) => t.id === id) || HOWTOS[0];

    // NUMBERED, and the numbering is TRUE: these are steps performed in order,
    // which is the one thing that earns a number rather than an icon. The box
    // is `.feat` — the Intro's own, already proved on all three grounds — with
    // the icon square carrying a digit, so this adds no surface for the ground
    // sweep to have to re-clear.
    function slideHow(sl) {
      const rows = (size.id === 'square' ? sl.rows.slice(0, 3) : sl.rows);
      return `<div class="rows" style="margin-top:34px">${rows.map(([h, p], i) =>
        '<div class="feat"><span class="fi hnum">' + (i + 1) + '</span>' +
        `<span><h3>${h}</h3><p>${p}</p></span></div>`).join('')}</div>` +
        (rows.length < sl.rows.length
          // A trimmed deck must not silently lose a step — the square is the
          // short artboard and the last step is the one that completes the job.
          ? `<p class="s-sub" style="margin-top:22px">Step ${rows.length + 1}: ${sl.rows[rows.length][0].replace(/<[^>]+>/g, '')}.</p>`
          : '');
    }
    // NAMING THE SCREENS — read live, never written down. The cover already
    // counts them for the reason recorded there (a hardcoded "twenty-two, in
    // six groups" was wrong the day it was written), and a slide that LISTS
    // them is the same hazard with twenty-nine chances to be wrong instead of
    // two. Both read the same `screens`, so the count and the list cannot
    // disagree about what is on the site.
    //
    // GROUPED BEFORE IT IS CAPPED, which is not merely tidier. Stored order is
    // position, and a screen appended later sits at the END whatever group it
    // belongs to — `At a record high` is position 28 and the first group's
    // eighth member. Capping raw order would drop it while the Screens menu,
    // which collects a group by NAME, shows it eighth. The card has to agree
    // with the menu.
    // Tuned against the measured artboards rather than chosen: the post fits
    // all 29 with 126px to spare and the story with 425px, so neither cap
    // binds today and both are headroom against a growing catalogue. The
    // SQUARE is the short one and is the only cap that bites.
    // THE 4:5 ARTBOARD'S ID IS `portrait`, NOT `post` — `post` is only its
    // LABEL in the studio ("Post 4:5"). Keyed on `post` this map never matched
    // it and silently fell through to the default, which happened to be the
    // same number, so nothing looked wrong. Caught by a sweep that asserted
    // the size chip had actually moved rather than trusting the click.
    const HNAME_CAP = { portrait: 34, square: 26, story: 34 };
    function slideNames() {
      const all = (screens || []).filter((s) => s && s.name);
      // A host that passes no screens gets a sentence rather than a blank
      // panel: the phone and the studio both pass them, so this is the
      // off-page case rather than something a reader will meet.
      if (!all.length) return '<p class="s-sub wide" style="--fs:22px;margin-top:30px">'
        + 'The list is drawn live from the site, so this slide names whatever is there on the day it is built.</p>';

      const groups = [];
      for (const s of all) {
        const g = String(s.group || s.grp || 'Other');
        let e = groups.find((x) => x.g === g);
        if (!e) groups.push(e = { g, names: [] });
        e.names.push(String(s.name));
      }
      // WHOLE GROUPS ONLY. Cutting mid-group puts four of Technical's six on
      // the card under a heading that reads as the complete set, and the tail
      // then has to count Technical as both shown AND missing — which is what
      // the square's first reading did ("…and 7 more, across 4 more groups"
      // over a visible Technical). A group is on the card entire or not at all,
      // so every heading means what it says.
      const cap = HNAME_CAP[size.id] || HNAME_CAP.portrait;
      const out = [];
      let n = 0;
      const dropped = [];
      for (const grp of groups) {
        if (!dropped.length && n + grp.names.length <= cap) { out.push(grp); n += grp.names.length; }
        else dropped.push(grp.g);
      }
      // The degenerate case: one group alone is bigger than the artboard. Show
      // what fits of it rather than an empty card, and the tail then counts
      // rather than naming groups, because the first one is only half there.
      let partial = false;
      if (!out.length) {
        out.push({ g: groups[0].g, names: groups[0].names.slice(0, cap) });
        n = out[0].names.length;
        partial = true;
      }
      const left = all.length - n;
      // A trimmed list must say what it dropped, or the slide reads as the
      // whole catalogue — the square's own step rule, one card along.
      // Name the groups that lost entries where there are one or two of them;
      // past that the sentence becomes a list longer than the thing it is
      // apologising for ("in Value and growth, Technical, Short interest,
      // Earnings and Advice" was the square's first reading) and a count of
      // groups says the same thing in four words.
      const where = partial || dropped.length === 0 ? ''
        : dropped.length <= 2 ? `, in ${esc(dropped.join(' and '))}`
        : `, across ${dropped.length} more groups`;
      const tail = left
        ? `<p class="s-sub wide" style="--fs:19px;margin-top:20px">…and ${left} more${where}.</p>`
        : '';
      return `<div class="hcat">${out.map((grp) =>
        `<div class="hg"><b>${esc(grp.g)}</b>${grp.names.map((nm) =>
          `<span>${esc(nm)}</span>`).join('')}</div>`).join('')}</div>` + tail;
    }

    // WHO CAN DO THIS, on the cover of every topic. It is the fact a reader
    // needs before following any of the steps, and it is not guessable: the
    // same screener shows a member a `New personal theme` button and the owner
    // a `New theme` one.
    function slideWho(key) {
      const t = HOW_WHO[key];
      return t ? `<div class="hwho"><b>Who can do this</b><span>${esc(t)}</span></div>` : '';
    }

    function tplHowTo() {
      const topic = howById(O.howTopic);
      const idx = Math.min(Math.max(Number(O.howSlide) || 0, 0), topic.slides.length - 1);
      const sl = topic.slides[idx];
      // A `sub` may be a function, so a slide can count something live rather
      // than carry a number that goes stale.
      const sub = typeof sl.sub === 'function' ? sl.sub() : sl.sub;
      const body = sl.kind === 'hsteps' ? slideHow(sl)
        : sl.kind === 'stmts' ? slideStmts(sl)
        : sl.kind === 'hnames' ? slideNames()
        : (sub ? `<p class="s-sub" style="--fs:26px;margin-top:26px">${sub}</p>` : '') + slideWho(sl.who);
      return chromeTop(false) +
        `<div class="s-body"><div><span class="s-kick">${esc(sl.kick || topic.name)}</span>` +
        `<h2 class="s-title">${sl.title || esc(topic.name)}</h2>${body}` +
        dotRow(topic.slides.length, idx) +
        '</div></div>' + chromeFoot();
    }

    // ---- the chart card ---------------------------------------------------
    // ONE fetch per window serves every mode: /api/basket?name=All returns
    // each symbol's series normalised to its own first close, so the
    // equal-weight line for any subset is just the mean of the lines drawn —
    // the chart can never disagree with its own legend. Cached per window.
    // A THIRD ELEMENT MARKS A CALENDAR WINDOW, and `ytd` is the only one.
    //
    // Every other entry here is a BAR COUNT, which is why year-to-date was
    // refused on this card when the screener's YTD column shipped: a count of
    // sessions is not a calendar boundary on any date but one. It is in now
    // because the mechanism is, not because that reasoning stopped holding —
    // the count is only the FETCH size (a year of sessions, with headroom),
    // and `winStart` then finds the boundary in the date axis the host
    // returned. Nothing else in the module may read `[0]` as the window.
    const CHART_WINDOWS = { w1: [5, 'past week'], m1: [21, 'past month'],
                            m3: [63, 'past three months'], m6: [126, 'past six months'],
                            ytd: [260, 'this year', 'ytd'],
                            y1: [253, 'past year'] };

    // WHERE A WINDOW STARTS IN A DATE AXIS. A bar count is already the whole
    // axis the host fetched, so it starts at 0; a calendar window has to be
    // looked for.
    //
    // THE ORIGIN IS THE LAST SESSION BEFORE 1 JANUARY, not the first session
    // of the year — the same close the screener's ytdPct anchors on. Rebasing
    // to the first session OF the year would silently drop its own day's move
    // and leave the card and the column disagreeing by a number nobody could
    // account for (measured on the fixture: +100.0% against +66.7%).
    //
    // IT AGREES WITH THAT COLUMN TO THE PAYLOAD'S OWN PRECISION, NOT EXACTLY,
    // and the difference is not worth closing. `symbolSeries` rounds each
    // value to 3dp, so re-dividing two of them compounds that — measured
    // against production over 1,169 symbols: median 0.03pt, worst 0.31pt, and
    // the error grows with the move (the worst case is a +430% stock). The
    // alternatives are worse: more decimals on the wire costs ~0.6MB on a
    // payload that is already the largest thing the studio fetches, and
    // taking the end tag from the row's ytdPct instead would print a number
    // that disagrees with the point it is drawn beside.
    //
    // The year is the LOCAL one, never `toISOString`'s: on 1 January the two
    // disagree west of Greenwich and UTC would ask for last year's boundary —
    // the card-dating lesson, met again.
    function winStart(win, dates) {
      if (!win || win[2] !== 'ytd' || !dates || !dates.length) return 0;
      const jan = `${new Date().getFullYear()}-01-01`;
      const i = dates.findIndex((d) => String(d) >= jan);
      if (i < 0) return dates.length;          // no session this year yet
      return i > 0 ? i - 1 : 0;
    }

    // Re-slice the basket payload and RE-REBASE every series to the new
    // origin. The host's series are rebased to the first session it fetched,
    // so slicing alone would draw a year-to-date window off a year-ago origin
    // — the right dates with the wrong numbers, which looks perfectly well
    // formed. A symbol with no close on the origin falls back to its own
    // first close in the slice, which is `symbolSeries`' own convention.
    function sliceBasket(d, i0) {
      if (!i0) return d;
      const dates = d.dates.slice(i0);
      const series = {};
      for (const sym of Object.keys(d.series || {})) {
        const S = d.series[sym].slice(i0);
        let base = null;
        for (const v of S) if (v != null) { base = v; break; }
        series[sym] = base ? S.map((v) => (v == null ? null : v / base)) : S.map(() => null);
      }
      return Object.assign({}, d, { dates, series });
    }

    // The label reads as a noun beside the kicker ("AAA vs BBB · this year")
    // and has to read as a phrase inside a sentence. One helper rather than
    // two labels per entry, since only the calendar window differs.
    const winPhrase = (win) => (win && win[2] === 'ytd' ? 'so far this year' : `over the ${win[1]}`);

    // ONLY THE CHART CARD CAN SLICE, so only the chart card may be given a
    // calendar window. Sparks and the spotlight read this same map and draw
    // the axis the host fetched as-is — handed `ytd` they would draw a full
    // YEAR under a heading reading "this year", which is wrong and looks
    // right. Their pickers do not offer it; this is what stops a hand-edited
    // saved post reaching them, and what stops the map lying to two of its
    // three consumers.
    const barWin = (key) => {
      const w = CHART_WINDOWS[key];
      return w && !w[2] ? w : CHART_WINDOWS.m6;
    };
    // A moving average on the one-stock chart. Colours are the stock page's
    // own, so 50-day and 200-day mean the same thing on both surfaces.
    //
    // AN AVERAGE NEEDS RUN-UP FROM BEFORE THE WINDOW, which is the whole reason
    // this cannot come off the basket payload: that carries only the window, so
    // a 200-day average over six months (~126 sessions) would be undefined
    // everywhere, and a 50-day one would start 40% of the way along. The card
    // asks its host for `window + n` sessions of ONE symbol's closes instead —
    // cheap, where deepening the whole-universe basket would read hundreds of
    // thousands of rows for 844 stocks nobody is charting.
    const CHART_MAS = {
      off:   { n: 0 },
      ma50:  { n: 50,  label: '50-day average',  color: '#7c9cff' },
      ma200: { n: 200, label: '200-day average', color: '#fbbf24' },
      // routed through pal.ink() at the point of use, below
    };
    // What the chart card needs fetched, so the studio and the server's saved-post
    // builder ask for the same thing rather than each guessing. Exported.
    // HOW MANY SESSIONS A TEMPLATE NEEDS FROM THE ARCHIVE, or 0 for none.
    //
    // Three templates draw a price line and each keeps its window under its
    // own control id, so both hosts had to know the pairing: server.js listed
    // `chart -> chtWin, sparks -> spkWin` inline, and promo.html repeated the
    // template names again in the repaint its fetch triggers. A THIRD such
    // card is what made that a list rather than a pair — the Stock spotlight
    // shipped for an hour reading a basket that never arrived, because its
    // fetch landed and nothing repainted. Asked here instead, the way
    // chartHistoryNeed already is, so a fourth costs one line in one place.
    const BASKET_WIN_KEY = { chart: 'chtWin', sparks: 'spkWin', spotlight: 'spotWin' };
    function basketDays(tpl, opts) {
      const key = BASKET_WIN_KEY[tpl];
      if (!key) return 0;
      // The chart may ask for a calendar window; the other two may not, so
      // they resolve through barWin and can never request a year by accident.
      const v = (opts || {})[key];
      const win = tpl === 'chart' ? (CHART_WINDOWS[v] || CHART_WINDOWS.m6) : barWin(v);
      return win[0];
    }

    function chartHistoryNeed(opts) {
      const o = opts || {};
      if (o.chtMode !== 'stock') return null;
      const ma = CHART_MAS[o.chtMa];
      if (!ma || !ma.n) return null;
      const win = CHART_WINDOWS[o.chtWin] || CHART_WINDOWS.m6;
      // A little slack past the average's own length: sessions and calendar
      // days are not the same thing, and a short archive simply yields fewer
      // points rather than an error.
      return { symbol: o.chtSym || null, days: win[0] + ma.n + 15 };
    }
    // The average, rebased the way every line on this card is: to the close on
    // the window's first session, so `(v - 1) * 100` reads as a percentage move
    // from the same origin as the price line.
    function maSeries(hist, winDates, n) {
      if (!hist || !Array.isArray(hist.closes) || !Array.isArray(hist.dates)) return null;
      if (hist.closes.length < n) return null;
      const at = new Map();
      hist.dates.forEach((d, i) => at.set(String(d).slice(0, 10), i));
      // The base is the first window date the archive actually holds — not
      // simply winDates[0], which a symbol may have no bar for.
      let base = null;
      for (const d of winDates) {
        const i = at.get(String(d).slice(0, 10));
        if (i != null && hist.closes[i] > 0) { base = hist.closes[i]; break; }
      }
      if (!(base > 0)) return null;
      const sma = [];
      let sum = 0;
      for (let i = 0; i < hist.closes.length; i++) {
        sum += hist.closes[i];
        if (i >= n) sum -= hist.closes[i - n];
        sma.push(i >= n - 1 ? sum / n : null);
      }
      let any = false;
      const out = winDates.map((d) => {
        const i = at.get(String(d).slice(0, 10));
        const v = i == null ? null : sma[i];
        if (v != null) any = true;
        return v == null ? null : v / base;
      });
      return any ? out : null;
    }
    // ---- the ground a card is drawn on ---------------------------------
    //
    // THE SIGNAL COLOURS ARE NOT A THEME'S TO REPAINT, with one exception.
    // Green is up, red is down, amber is "notice this", and the six-tier
    // ladder is the same ladder the screener shows — a palette that moved any
    // of them would make the card say something it does not mean. So a theme
    // is the GROUND and the FURNITURE.
    //
    // The exception is a LIGHT ground, where holding that line is impossible:
    // measured against #f7f8fa, every one of them fails outright — green
    // 1.9:1, red 2.7:1, amber 1.7:1, --text 1.2:1. So the light theme keeps
    // each HUE and darkens it until it clears 4.5:1, which preserves the
    // meaning (green is still green) while making it legible. Same semantics,
    // second value. Navy needs none of that: measured on #0d1a2d the whole
    // dark palette still clears the floor (green 9.1, red 6.5, faint 4.8), so
    // it is a ground and an aura and nothing else — which is why it cost an
    // hour against the light theme's day.
    //
    // These are the values a CSS variable cannot reach: lineChart and
    // recoveryLeg emit presentation ATTRIBUTES as string literals, because
    // that markup also travels through the PNG export. Everything else rides
    // the token block in STYLE, which is most of the card for free.
    // EVERY DARK SIGNAL COLOUR, AND ITS LIGHT SECOND VALUE (2026-09-30).
    //
    // The spotlight's own note said the light theme's token block was "most
    // of the card for free", and it was — for the spotlight. Extending the
    // grounds to all thirteen templates found what that missed: 17 distinct
    // hex LITERALS across 76 uses, emitted as presentation attributes and
    // inline styles by the chart, the spark line, the verdict ladder, the
    // bubble tints and the range bands. A CSS variable cannot reach a
    // literal, and on #f7f8fa they run 1.1:1 to 2.6:1 — invisible rather
    // than wrong, which is the failure that reads as an empty card.
    //
    // So one table rather than 76 decisions. Each light value keeps the dark
    // one's HUE exactly (solved in HSL, lightness alone moved) and is darkened
    // until it clears 4.5:1 against the strictest surface a card actually puts
    // it on — NOT the bare artboard, but the 0.05 ink tint of a filled tile,
    // which is where the first cut of these values landed at 4.2-4.4. One set
    // that is safe everywhere beats a set that is safe on the page and
    // marginal on a tile.
    const LIGHT_INK = {
      '#34d399': '#157a51',   // green — up
      '#fb7185': '#c81e37',   // red — down
      '#9aa3b2': '#5b6675',   // grey — flat
      '#fbbf24': '#9d5a07',   // amber — notice this
      '#a3e635': '#4a770e',   // lime — Buy
      '#fb923c': '#b44902',   // orange — Avoid
      '#7c9cff': '#2e5fe8',   // accent
      '#a78bfa': '#6d3fd4',   // accent-2
      '#22d3ee': '#0d6c80',   // cyan
      '#f472b6': '#b81b66',   // pink
      '#f0abfc': '#9420a0',   // fuchsia
      '#94a3b8': '#5b6675',   // slate
      '#60a5fa': '#1d4ed8',   // blue
      '#e9ecf2': '#0d1017',   // ink — text
      '#cfd6e2': '#46505f',   // dim ink
      '#7d8797': '#606b7a',   // axis / faint
    };
    // Identity on dark and navy, which is the point: navy is the dark palette
    // on another ground, so a future edit to a dark literal carries to it with
    // no second entry to keep in step. An unmapped colour is returned as it
    // is rather than guessed at — the sweep is what finds those.
    const inkFor = (map) => (hex) => (map && map[hex]) || hex;
    // SKY SHARES LIGHT'S FURNITURE BUT NOT ITS INK, and that is a
    // measurement. LIGHT_INK is tuned against light's 0.938 ground; sky is
    // 0.808, and on sky's card tile (#c7e1f3) TEN of its sixteen entries
    // land at 3.94-4.46, under the 4.5:1 text floor. The contrast sweep
    // caught exactly one of them -- the accent, on a fund-quadrant label --
    // because that is the only one currently drawn as SVG text in a swept
    // mode; the other nine are latent, and would surface one at a time as
    // cards change. Each is darkened with its channels scaled together, so
    // the HUE is light's exactly and only the lightness moves.
    //
    // SPREAD, not restated: the six that already clear both grounds still
    // carry a future edit to LIGHT_INK, which is the bargain sky has with
    // light's furniture. And LIGHT'S OWN MAP IS UNTOUCHED -- a shipped
    // theme does not move to suit a new one, the call LADDER_SKY made.
    const SKY_INK = Object.assign({}, LIGHT_INK, {
      '#34d399': '#136e49',   // green - up
      '#fb7185': '#bc1c34',   // red - down
      '#9aa3b2': '#56616f',   // grey - flat
      '#fbbf24': '#8d5106',   // amber - notice this
      '#a3e635': '#436b0d',   // lime - Buy
      '#fb923c': '#a44202',   // orange - Avoid
      '#7c9cff': '#2956d1',   // accent
      '#22d3ee': '#0d697c',   // cyan
      '#94a3b8': '#56616f',   // slate
      '#7d8797': '#57616f',   // axis / faint
    });

    const LADDER_LIGHT = {
      'Strong Buy': '#157a51', 'Buy': '#4a770e', 'Buy with Risk': '#9d5a07',
      'Hold': '#5b6675', 'Avoid': '#b44902', 'Sell Immediately': '#c81e37',
    };
    // SKY NEEDS ITS OWN LADDER, and that is a MEASUREMENT rather than a
    // precaution. LADDER_LIGHT clears only ~4.52:1 on light's own card tile,
    // so on a ground 0.130 darker in luminance (#d1ecff at 0.808 against
    // #f7f8fa at 0.938) ALL SIX entries land under the floor. Each is
    // darkened toward black with its channels scaled together, so the HUE is
    // light's exactly and only the lightness moves -- the LIGHT_INK approach.
    // Tuned to clear 4.6 on the card tile rather than 4.5: a ladder sitting
    // on its floor is what broke when the ground moved the first time, so the
    // margin is the point rather than a nicety. Re-tuned when the ground went
    // #e0ebf9 -> #d1ecff, which cost 1-2 channel steps an entry -- nothing the
    // eye can see, and the margin back where it was said to be.
    const LADDER_SKY = {
      'Strong Buy': '#136e49', 'Buy': '#426b0d', 'Buy with Risk': '#8e5106',
      'Hold': '#56616f', 'Avoid': '#a44202', 'Sell Immediately': '#bc1d33',
    };
    const THEMES = {
      dark: {
        cls: '', ground: '#050505',
        up: '#34d399', down: '#fb7185', flat: '#9aa3b2',
        grid: 'rgba(255,255,255,0.07)', zero: 'rgba(255,255,255,0.2)',
        axis: '#7d8797',
        legUp: 'rgba(52,211,153,0.55)', legDown: 'rgba(251,113,133,0.55)',
        washUp: 'rgba(52,211,153,0.13)', washDown: 'rgba(251,113,133,0.13)',
        tints: ADV_TINT, ink: inkFor(null),
      },
      light: {
        cls: 'th-light', ground: '#f7f8fa',
        up: '#157a51', down: '#c81e37', flat: '#5b6675',
        grid: 'rgba(13,16,23,0.10)', zero: 'rgba(13,16,23,0.28)',
        axis: '#606b7a',
        legUp: 'rgba(21,122,81,0.45)', legDown: 'rgba(200,30,55,0.45)',
        washUp: 'rgba(21,122,81,0.14)', washDown: 'rgba(200,30,55,0.13)',
        tints: LADDER_LIGHT, ink: inkFor(LIGHT_INK),
      },
      // 2026-10-05, owner: "a light blue theme .. just to see how it looks",
      // then committed. It REVERSES the recorded "Only 3 colors, Dark, Light
      // and Navy", which is why that is written down rather than absorbed.
      //
      // Sky CARRIES the light class as well as its own, so it inherits every
      // one of light's furniture rules by BEING one of them rather than by
      // duplicating their selectors -- the bargain navy has with dark, and
      // the reason this cost 4KB rather than a second sweep of the 34
      // rgba(255,255,255,.0x) sites a CSS variable cannot reach. Note that
      // classList.add REFUSES a string with a space in it, so promo.html
      // splits; the phone's two hosts build a class attribute string and
      // need nothing. What it does NOT inherit is anything tuned to light's
      // own luminance -- see LADDER_SKY above and the th-sky block below.
      sky: {
        cls: 'th-light th-sky', ground: '#d1ecff',
        up: '#126b46', down: '#bb1b33', flat: '#566070',
        grid: 'rgba(13,16,23,0.11)', zero: 'rgba(13,16,23,0.30)',
        axis: '#515b69',
        legUp: 'rgba(18,107,70,0.45)', legDown: 'rgba(187,27,51,0.45)',
        washUp: 'rgba(18,107,70,0.14)', washDown: 'rgba(187,27,51,0.13)',
        tints: LADDER_SKY, ink: inkFor(SKY_INK),
      },
      // Navy is the dark palette on a different ground, deliberately — every
      // value below is dark's, and the only entries that exist at all are the
      // class and the tints, so a future edit to the dark palette carries.
      navy: {
        cls: 'th-navy', ground: '#0d1a2d',
        up: '#34d399', down: '#fb7185', flat: '#9aa3b2',
        grid: 'rgba(255,255,255,0.07)', zero: 'rgba(255,255,255,0.2)',
        axis: '#8b95a5',
        legUp: 'rgba(52,211,153,0.55)', legDown: 'rgba(251,113,133,0.55)',
        washUp: 'rgba(52,211,153,0.13)', washDown: 'rgba(251,113,133,0.13)',
        tints: ADV_TINT, ink: inkFor(null),
      },
    };
    // ONE GROUND FOR EVERY CARD (2026-09-30, owner: "Only 3 colors, Dark,
    // Light and Navy... Can you add these all promo cards"). This is the
    // generalisation the spotlight's note predicted.
    //
    // A LEGACY KEY BELONGS TO THE TEMPLATE IT WAS SAVED FOR. The two keys
    // that preceded the shared one are still read, because saved posts carry
    // them and a stored post must not lose its ground to a rename — but read
    // unconditionally they cross-talk: a day post carrying dayTheme opened on
    // the spotlight would colour the spotlight, which is a ground nobody
    // chose for it. Caught by the day suite's own independence checks, which
    // were asserting the previous behaviour and were right to fail.
    const LEGACY_KEY = { spotlight: 'spotTheme', day: 'dayTheme' };
    const themeOf = (tpl, opts) => {
      const o = opts || {};
      const legacy = LEGACY_KEY[tpl];
      return THEMES[o.cardTheme || (legacy && o[legacy])] || THEMES.dark;
    };

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
        grid += `<line x1="${PL}" y1="${y(v).toFixed(1)}" x2="${W - PR}" y2="${y(v).toFixed(1)}" stroke="${pal.grid}" stroke-width="1"/>` +
          `<text x="${PL - 16}" y="${(y(v) + 7).toFixed(1)}" text-anchor="end" font-size="19" fill="${pal.axis}" font-family="Geist Mono, monospace">${v.toFixed(0)}%</text>`;
      }
      if (lo < 0 && hi > 0) {
        grid += `<line x1="${PL}" y1="${y(0).toFixed(1)}" x2="${W - PR}" y2="${y(0).toFixed(1)}" stroke="${pal.zero}" stroke-width="1"/>`;
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
      const strokes = L.map((l) =>
        `<path class="cl" d="${path(l.P)}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${l.dim ? 0.7 : 1}"/>`).join('');
      // TWO END TAGS AT THE SAME HEIGHT PRINT ON TOP OF EACH OTHER, and two
      // stocks finishing a window a point apart is the ordinary case on the
      // two-stock card — where those two numbers are the whole comparison.
      // The leaders card can stack eight. So lay them out in y order against a
      // minimum gap, then pull the stack back inside the plot if it ran past
      // the bottom. A single tag resolves to exactly the old clamp.
      const TAG_GAP = 26;
      const marks = [];
      for (const l of L) {
        let last = null;
        for (let i = l.P.length - 1; i >= 0 && last == null; i--) last = l.P[i];
        if (last != null) marks.push({ v: last, color: l.color, y: y(last) + 7 });
      }
      marks.sort((a, b) => a.y - b.y);
      let floor = PT + 14;
      for (const m of marks) { m.y = Math.max(m.y, floor); floor = m.y + TAG_GAP; }
      const over = marks.length ? marks[marks.length - 1].y - (H - PB) : 0;
      // Shifting the whole stack keeps the gaps; the plot is far taller than
      // eight tags need, so this cannot press them back into the top clamp.
      if (over > 0) for (const m of marks) m.y = Math.max(PT + 14, m.y - over);
      const tags = marks.map((m) =>
        `<text x="${W - PR + 14}" y="${m.y.toFixed(1)}" font-size="24" font-weight="600" fill="${m.color}" font-family="Geist Mono, monospace">${(m.v >= 0 ? '+' : '') + m.v.toFixed(1)}%</text>`).join('');
      const d0 = dates[0], d1 = dates[dates.length - 1];
      const axis = `<text x="${PL}" y="${H - 10}" font-size="18" fill="${pal.axis}" font-family="Geist Mono, monospace">${esc(d0)}</text>` +
        `<text x="${W - PR}" y="${H - 10}" text-anchor="end" font-size="18" fill="${pal.axis}" font-family="Geist Mono, monospace">${esc(d1)}</text>`;
      const mt = opts && opts.mt != null ? opts.mt : 26;
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin-top:${mt}px" role="img" aria-label="chart">` +
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

    // ---- one stock, its own chart, as a post or a story --------------------
    // The stock page asked for the studio's export on the chart it is already
    // showing (2026-09-22, owner's request). It draws through `lineChart`, the
    // SAME function the Chart card uses, rather than a second implementation —
    // which is what makes it survive the PNG export unchanged (presentation
    // attributes, no classes) and animate under Motion for free.
    //
    // REBASED TO THE WINDOW, not plotted in dollars, and the axis says `%`.
    // Two reasons: it is the question a shared chart actually answers ("what
    // did this do"), and it is the one scale that reads the same for a $4
    // stock and a $1,000 one. The dollar price is not lost — it sits in the
    // header, where a reader looks for it.
    function tplStock() {
      const c = chartOne;
      const closes = (c && c.closes) || [];
      const first = closes.findIndex((v) => v > 0);
      if (!c || first < 0 || closes.length < 2) {
        return chromeTop() + '<div class="s-body"><div><p class="s-empty">' +
          'No stored history to draw for ' + esc((c && c.symbol) || 'this stock') + '.' +
          '</p></div></div>' + chromeFoot();
      }
      const base = closes[first];
      const S = closes.map((v) => (v > 0 ? v / base : null));
      const last = closes[closes.length - 1];
      const move = (last / base - 1) * 100;
      // Green up, red down — a single line about a single stock, where the
      // direction IS the story. The table's sparkline stays neutral for the
      // opposite reason: five coloured columns already sit beside it.
      const colour = move >= 0 ? pal.up : pal.down;
      const win = esc(c.rangeLabel || 'this window');
      const name = esc(c.name || c.symbol);
      const sym = esc(c.symbol);
      // The Chart card is the deliberate exception to labelling by name — a
      // ticker is what fits beside a drawn line — so the title leads with the
      // ticker and the company name rides under it, as tplChart does.
      const head = `<span class="s-kick">${sym} · ${win}</span>` +
        `<h2 class="s-title">${name}` +
        (c.price != null || c.today != null
          ? `<br><span class="dim">${c.price != null ? esc(c.price) : ''}` +
            (c.today != null ? `&nbsp; ${esc(pct(c.today, 2))} today` : '') + '</span>'
          : '') + '</h2>';
      const dir = move >= 0 ? 'Up' : 'Down';
      const note = `${dir} ${Math.abs(move).toFixed(1)}% over the ${win}. ` +
        'Price only — no dividends, no positions.';
      return chromeTop() +
        '<div class="s-body"><div class="stk">' + head +
        lineChart(c.dates || closes.map(() => ''), [{ color: colour, S, width: 4, fill: true }],
          { h: size.id === 'story' ? 1180 : size.id === 'square' ? 470 : 590 }) +
        `<p class="s-sub wide" style="--fs:17px;margin-top:18px">${note}</p>` +
        '</div></div>' + chromeFoot();
    }

    function tplChart() {
      const winKey = O.chtWin;
      const win = CHART_WINDOWS[winKey] || CHART_WINDOWS.m6;
      const [days, winLabel] = win;
      const mode = O.chtMode;
      let d = getBasket(days);
      if (!d || !d.dates || !d.dates.length) {
        return chromeTop() +
          '<div class="s-body"><div><span class="s-kick">Reading the archive</span>' +
          '<h2 class="s-title">Drawing<br><span class="dim">the chart\u2026</span></h2></div></div>' + chromeFoot();
      }
      // ONE SLICE, ABOVE ALL FOUR MODES. Every mode reads `d.dates` and
      // `series` \u2014 the one-stock line, the pair, the leaders and the two
      // averages \u2014 so a calendar window applied here reaches all of them,
      // where four copies could only drift.
      const i0 = winStart(win, d.dates);
      // A one-point window is not a line. Two sessions is the least that can
      // be drawn, and in the first days of January that is what year-to-date
      // honestly holds; before the year's first session it holds nothing.
      if (d.dates.length - i0 < 2) {
        return chromeTop() +
          '<div class="s-body"><div><p class="s-empty">The year has not opened yet \u2014 ' +
          'there is no session since 31 December to chart.</p></div></div>' + chromeFoot();
      }
      d = sliceBasket(d, i0);
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
        // ONE STOCK IS ONE LINE. The whole-screen average used to ride along
        // here and was removed at the owner's request (2026-09-22): on a card
        // about a single company it competed with the subject, and it pulled
        // the y-scale toward the middle so the stock's own shape read flatter
        // than it is. The other two chart modes still carry it, where a
        // comparison is the point.
        lines = [{ color: pal.up, S, width: 4, fill: true }];
        legend = [{ color: pal.up, label: esc(sym) }];
        note = 'Price only, rebased to the start of the window \u2014 no dividends, no positions.';
        const ma = CHART_MAS[O.chtMa];
        if (ma && ma.n) {
          const need = chartHistoryNeed(O);
          const MS = maSeries(getHistory(sym, need ? need.days : days + ma.n), d.dates, ma.n);
          if (MS) {
            const mc = pal.ink(ma.color);
            lines.push({ color: mc, S: MS, width: 2.5 });
            legend.push({ color: mc, label: ma.label });
            // Said out loud, because a reader could reasonably assume the
            // average is computed only from what is on screen \u2014 in which case
            // it would start well to the right of the left edge.
            note += ` The ${ma.n}-day average uses closes from before the window, so it starts at the left edge.`;
          }
          // No branch for "still loading": the host repaints when the fetch
          // lands, and a card that swapped in an apology would flicker.
        }
        kick = `${esc(sym)} \u00b7 ${esc(winLabel)}`;
        title = `${esc(sym)}<br><span class="dim">${esc((row && row.name) || '')}</span>`;
      } else if (mode === 'two') {
        // TWO STOCKS, REBASED \u2014 the one reading two raw price lines cannot
        // give. Both are scaled to the window's first session, exactly as
        // every other line on this card is, so THE GAP BETWEEN THEM IS THE
        // RELATIVE PERFORMANCE. /compare settled this already: two raw prices
        // on one axis press the cheaper stock into the floor and the chart
        // says nothing.
        const symA = O.chtSym || (stocks[0] && stocks[0].symbol);
        const symB = O.chtSym2 || ((stocks.find((r) => r.symbol !== symA) || {}).symbol);
        const empty = (msg) => chromeTop() + `<div class="s-body"><div><p class="s-empty">${msg}</p></div></div>` + chromeFoot();
        // One stock twice is one line drawn over itself, and the whole card
        // would then be a comparison with nothing. Say which half is missing.
        if (!symB || symB === symA) return empty('Pick a second stock to compare against.');
        const SA = series[symA], SB = series[symB];
        // NAME WHICH ONE, rather than a single message for either \u2014 with two
        // subjects "no stored history" does not say whose.
        if (!SA || !SB) return empty(`No stored history for ${esc(!SA ? symA : symB)} in this window.`);
        // BLUE AND ORANGE, MEASURED RATHER THAN CHOSEN BY EYE (2026-10-02,
        // owner: "these two colors look the same"). This shipped as the
        // accent pair \u2014 periwinkle against violet \u2014 which is \u0394E 19 apart in
        // normal vision and **\u0394E 3 under deuteranopia**, i.e. at the
        // just-noticeable threshold: for roughly one man in twelve the two
        // lines were literally one colour. Blue against orange is the one
        // divergence that survives both common dichromacies, and its WORST
        // reading across normal vision, deuteranopia, protanopia and the
        // light ground's darkened values is \u0394E 102.
        //
        // STILL NEVER GREEN AND RED: those mean up and down on every chart
        // here, so colouring each line by its own direction would make a
        // different claim from the one the card is for \u2014 /compare's rule, and
        // the same reason neither line is filled: a fill marks a hero, and
        // here there are two subjects. Orange sits \u0394E 50 from the red, so it
        // cannot be read as "down", and the advice ladder where orange means
        // Avoid is not drawn on this card. Both are already in CHART_PALETTE
        // and already mapped in LIGHT_INK, so the ground sweep covers them.
        const cA = pal.ink('#60a5fa'), cB = pal.ink('#fb923c');
        const eA = endOf(SA), eB = endOf(SB);
        lines = [{ color: cA, S: SA, width: 4 }, { color: cB, S: SB, width: 4 }];
        legend = [{ color: cA, label: `${symA} ${pct(eA)}` }, { color: cB, label: `${symB} ${pct(eB)}` }];
        kick = `${esc(symA)} vs ${esc(symB)} \u00b7 ${esc(winLabel)}`;
        title = `${esc(symA)}<br><span class="dim">vs ${esc(symB)}</span>`;
        note = 'Both rebased to the start of the window, so the gap between the lines is the relative performance.';
        if (eA != null && eB != null) {
          // IN POINTS, never as a percentage of a percentage. Both numbers are
          // already percentages from the same origin, so their difference is a
          // gap in points \u2014 the rule /compare and the refresh email both keep.
          const gap = Math.abs(eA - eB);
          // `over the ${winLabel}` reads as "over the this year" on the
          // calendar window, so the phrase comes from winPhrase. The
          // `.replace(/^Past /, '')` that used to sit here could never fire —
          // every label is lower case — and was residue reading as intent.
          const over = winPhrase(win);
          note = `${eA === eB ? `${esc(symA)} and ${esc(symB)} are level ${over}`
            : `${esc(eA > eB ? symA : symB)} is ahead by ${gap.toFixed(1)} points ${over}`}. ` + note;
        }
        note += ' Price only \u2014 no dividends, no positions.';
      } else if (mode === 'leaders') {
        const scope = chartScopeSymbols();
        const n = Number(O.chtLines) || 5;
        const ranked = scope.syms.filter((x) => series[x])
          .map((x) => ({ sym: x, S: series[x], end: endOf(series[x]) }))
          .filter((r) => r.end != null)
          .sort((a, b) => b.end - a.end)
          .slice(0, n);
        if (!ranked.length) return chromeTop() + `<div class="s-body"><div><p class="s-empty">Nothing in ${esc(scope.label)} has history for this window.</p></div></div>` + chromeFoot();
        const cp = (i) => pal.ink(CHART_PALETTE[i % CHART_PALETTE.length]);
        lines = ranked.map((r, i) => ({ color: cp(i), S: r.S, width: 3 }));
        legend = ranked.map((r, i) => ({ color: cp(i), label: `${r.sym} ${pct(r.end)}` }));
        kick = `${esc(scope.label)} \u00b7 ${esc(winLabel)}`;
        title = `The leaders<br><span class="dim">${esc(scope.label)}</span>`;
        note = 'Each line is one stock, rebased to the start of the window. Ranked on the window, not a forecast.';
      } else {
        const scope = chartScopeSymbols();
        const basket = mean(scope.syms);
        if (!basket) return chromeTop() + `<div class="s-body"><div><p class="s-empty">Nothing in ${esc(scope.label)} has history for this window.</p></div></div>` + chromeFoot();
        const all = mean(stocks.map((r) => r.symbol));
        const same = O.chtScope === 'All';
        const acc = pal.ink('#7c9cff');
        lines = same ? [{ color: pal.up, S: basket, width: 4, fill: true }]
          : [{ color: pal.up, S: basket, width: 4, fill: true }, { color: acc, S: all, width: 2, dim: true }];
        legend = same ? [{ color: pal.up, label: 'All screened' }]
          : [{ color: pal.up, label: esc(scope.label) }, { color: acc, label: 'All screened' }];
        kick = `${esc(scope.label)} \u00b7 ${esc(winLabel)}`;
        title = same ? `The whole<br><span class="dim">screen</span>`
          : `${esc(scope.label)}<br><span class="dim">vs the whole screen</span>`;
        note = 'Equal dollars at the window start, held \u2014 a reading of the list, not an account.';
      }

      // THE CARD NAMES ITS OWN ORIGIN on the calendar window. Every mode's
      // note says "the start of the window", which on a bar count the kicker
      // already pins ("past six months") and on this one it does not — and a
      // posted image has no picker beside it to say where the line begins.
      if (win[2] === 'ytd') note += ` The window opens on the last close of last year, so the line reads as this year's move.`;

      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">${kick}</span>` +
        `<h2 class="s-title">${title}</h2>` +
        lineChart(d.dates, lines, { h: size.id === 'story' ? 1020 : size.id === 'square' ? 470 : 590 }) +
        chartLegend(legend) +
        `<p class="s-sub wide" style="--fs:17px;margin-top:18px">${note}</p>` +
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

    // ---- the disclaimer ----------------------------------------------------
    //
    // THE WORDS ARE /terms's OWN, DISTILLED — not written fresh here. Four
    // surfaces already state this one position (the terms page, the card
    // tagline, /help and the Intro close), and this project's standing rule
    // is that a fact stated in several places must agree everywhere. A card
    // that softened it, or claimed something the terms do not, would be the
    // "every feature live" error wearing legal clothes.
    //
    // FIXED TEXT, SO IT IS NOT OWNER-ONLY. Announcement is the owner's alone
    // because it is free text in the brand's voice; there is nothing here a
    // member could put words into, so every member gets it. That is the
    // whole difference between the two templates.
    //
    // NO SIGNAL COLOUR ANYWHERE ON IT. Green is up, red is down and amber is
    // "notice this, it is old" — a disclaimer makes none of those readings,
    // and a card shouting in amber reads as an alert rather than as the
    // house position. Type and spacing carry it; every value is a token, so
    // all three grounds follow with nothing to override.
    const DISCLAIMER = [
      ['This is not advice',
       'Nothing here is a recommendation, a solicitation, or an offer to buy or sell any '
       + 'security. Tickr Lab applies fixed, published rules to published market data and '
       + 'reports what they produce. It does not know your circumstances, your goals or '
       + 'your tax position.'],
      ['A verdict is a label, not an instruction',
       'Buy, Strong Buy, Avoid and Sell Immediately name the output of a rule. Each one '
       + 'carries the single rule that produced it, precisely so you can judge the rule '
       + 'for yourself.'],
      ['It describes, it does not predict',
       'The rules read what is measurable today. The site publishes its own research '
       + 'showing that most of what has been tested here predicted nothing.'],
      ['The data can be wrong',
       'Prices, fundamentals and earnings dates come from third-party providers. They '
       + 'contain errors, arrive late and are sometimes missing. Verify anything that '
       + 'matters against a primary source.'],
    ];
    const DIS_CLOSE = 'Decisions about your own money are yours.';

    function tplDisclaimer() {
      const full = O.disMode !== 'short';
      // The short card is the carousel closer and the full one is the
      // standalone post, so they differ in DEPTH rather than in claim: the
      // short one keeps every heading and drops the bodies.
      const items = DISCLAIMER.map(([h, b], i) =>
        '<li class="dc-item">'
        + `<span class="dc-n">${String(i + 1).padStart(2, '0')}</span>`
        + `<div><h3 class="dc-h">${esc(h)}</h3>`
        + (full ? `<p class="dc-b">${esc(b)}</p>` : '')
        + '</div></li>').join('');
      return chromeTop()
        + '<div class="s-body"><div class="dc-in">'
        + '<span class="s-kick">Tickr Lab · please read</span>'
        + '<h2 class="s-title">Not investment<br><span class="dim">advice</span></h2>'
        + `<ol class="dc-list${full ? '' : ' dc-short'}">${items}</ol>`
        + `<p class="dc-close">${esc(DIS_CLOSE)}`
        + '<span class="dc-where">tickrlab.com/terms</span></p>'
        + '</div></div>' + chromeFoot();
    }

    // ---- render ------------------------------------------------------------

    // ---- Range -----------------------------------------------------------
    // Where each stock sits between its own 52-week low and high. A ranking
    // of "% from the high" is the obvious card and throws away half the
    // story; a track per stock carries the fall AND the recovery at once,
    // which is why it is the default rather than the ranking.
    function rangeScope() { return scopeOf('rngScope', 'rngSector'); }

    // A card headline is two lines, the second dimmed. Split a screen's name at
    // the word boundary nearest its middle rather than at the first space, so
    // "Reporting in the next 14 days" breaks 3/3 instead of 1/5. One word stays
    // one line — a dimmed empty second line is a gap, not a design.
    function twoLines(s) {
      const w = String(s).trim().split(/\s+/);
      if (w.length < 2) return esc(w[0] || '');
      let best = 1, gap = Infinity;
      const total = w.join(' ').length;
      for (let i = 1; i < w.length; i++) {
        const d = Math.abs(w.slice(0, i).join(' ').length - total / 2);
        if (d < gap) { gap = d; best = i; }
      }
      return `${esc(w.slice(0, best).join(' '))}<br><span class="dim">${esc(w.slice(best).join(' '))}</span>`;
    }

    // WHERE THE STOCK WAS A MONTH AGO, on the same track. The position alone
    // says how far it fell; it cannot say whether it is still falling, and
    // "bouncing off the lows" is a claim about BOTH. The leg between the two
    // markers is the past month, drawn.
    //
    // MEASURED ON TODAY'S RANGE, and the caption says so. A month ago the
    // 52-week window was a different window with a different low and high, so
    // the honest reading is "the price it traded at then, placed on the ruler
    // in front of you" — which is the only way the two marks are comparable at
    // all. Anything else would put two points on two different scales and
    // invite the eye to measure between them.
    function recoveryLeg(x, p) {
      const m = x.oneMonthPct;
      if (m == null || !isFinite(m) || m === 0) return '';
      if (x.price == null || x.pctFromLow == null || x.pctFromHigh == null) return '';
      // Back out the band's ends from the two distances the row already holds.
      const low = x.price / (1 + x.pctFromLow / 100);
      const high = x.price / (1 + x.pctFromHigh / 100);
      const band = high - low;
      if (!(band > 0)) return '';
      const then = x.price / (1 + m / 100);
      // ANCHORED TO THE DRAWN MARKER, not computed from the band on its own.
      // The dot sits at the stored `range52Pos`; deriving the start position
      // independently puts the two marks on different footings the moment
      // those three fields do not perfectly reconcile, and then the leg
      // between them measures nothing. Taking the TRAVEL and subtracting it
      // from the dot keeps them on one ruler whatever the row says.
      const shift = ((x.price - then) / band) * 100;
      const q = Math.max(0, Math.min(100, p - shift));
      const a = Math.min(p, q);
      const w = Math.abs(p - q);
      if (w < 0.6) return '';                       // a hairline is noise, not a move
      // Green when the month was up, red when down — the direction IS the
      // reading, and a single neutral colour would hide half of it.
      const c = m >= 0 ? pal.legUp : pal.legDown;
      return `<span class="tleg" style="left:${a}%;width:${w}%;background:${c}"></span>` +
             `<span class="tthen" style="left:${q}%"></span>`;
    }

    function tplRange() {
      const mode = O.rngMode || 'track';
      const scope = rangeScope();
      const n = Math.min(Number(O.rngCount) || 8, size.id === 'story' ? 14 : 10);
      const has = (x) => x.range52Pos != null && x.pctFromHigh != null && x.pctFromLow != null;
      const rows = scope.rows.filter(has);
      if (!rows.length) {
        // A screen that caught nobody is a fact about today and is postable;
        // a missing 52-week range is a fact about the data and is not the
        // same sentence.
        const empty = scope.screen
          ? `Nothing passed ${scope.screen} today${scope.rows.length ? '' : ' in this scope'}.`
          : `Nothing in ${scope.label} has a 52-week range stored yet.`;
        return chromeTop() + `<div class="s-body"><div><span class="s-kick">${esc(scope.label)}</span>` +
          `<h2 class="s-title">${scope.screen ? 'Nobody<br><span class="dim">qualified</span>' : 'No range<br><span class="dim">to read</span>'}</h2>` +
          `<p class="s-empty">${esc(empty)}</p>` +
          '</div></div>' + chromeFoot();
      }

      // ---- the spread: how the whole list is distributed through its ranges
      if (mode === 'spread') {
        const bands = [
          ['Top fifth \u2014 at the highs', 80, 100, pal.ink('#34d399')],
          ['Upper middle', 60, 80, pal.ink('#a3e635')],
          ['Middle', 40, 60, pal.ink('#9aa3b2')],
          ['Lower middle', 20, 40, pal.ink('#fb923c')],
          ['Bottom fifth \u2014 at the lows', 0, 20, pal.ink('#fb7185')],
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
          `<p class="s-sub wide" style="--fs:19px;margin-top:28px">${counts[0]} of ${total} sit in the top fifth of their own 52-week range, ` +
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
          `<p class="s-sub wide" style="--fs:18px;margin-top:22px">${esc(label[0].toUpperCase() + label.slice(1))}` +
          (wide ? ', bars on a log scale so one outlier does not flatten the rest' : '') +
          '. Each measured against its own year.</p>' +
          '</div></div>' + chromeFoot();
      }

      // ---- the track: the whole year in one row per stock
      const top = O.rngDir !== 'low';
      const list = rows.slice()
        .sort((a, b) => (top ? b.range52Pos - a.range52Pos : a.range52Pos - b.range52Pos))
        .slice(0, n);
      // A CHOSEN SCREEN TITLES THE CARD. "Down at their lows" over the bouncing
      // screen is true and throws away the half that matters \u2014 those stocks are
      // low AND turning, and the screen's own name says both. It is also the
      // name the reader knows the question by from the screener.
      const title = scope.screen ? twoLines(scope.screen)
        : (top ? 'Pressed against<br><span class="dim">their highs</span>'
               : 'Down at<br><span class="dim">their lows</span>');
      // The kicker drops the screen when the TITLE has taken it \u2014 printing the
      // same words twice, one line apart, reads as a mistake.
      return chromeTop() +
        `<div class="s-body"><div><span class="s-kick">` +
        `${esc(scope.screen ? scope.labelSansScreen : scope.label)} \u00b7 52-week range</span>` +
        `<h2 class="s-title">${title}</h2>` +
        `<div class="tracks">${list.map((x) => {
          const p = Math.max(0, Math.min(100, x.range52Pos));
          const tint = p >= 66 ? pal.up : p >= 33 ? pal.ink('#fbbf24') : pal.down;
          const leg = recoveryLeg(x, p);
          return '<div class="trk">' +
            `<span class="ts">${esc(nameOf(x))}</span>` +
            '<span class="trail">' +
            `<span class="tfill" style="width:${p}%;background:linear-gradient(90deg, rgba(255,255,255,0.05), ${tint})"></span>` +
            leg +
            `<span class="tdot" style="left:${p}%;background:${tint}"></span></span>` +
            `<span class="tlo">${pct(x.pctFromLow)}</span>` +
            `<span class="thi">${pct(x.pctFromHigh)}</span>` +
            '</div>';
        }).join('')}</div>` +
        '<div class="tkey"><span>left edge \u00b7 the 52-week low</span><span>right edge \u00b7 the high</span></div>' +
        '<p class="s-sub wide" style="--fs:18px;margin-top:16px">Each track is one stock\u2019s own year: the marker is where it trades now, ' +
        'the first number is how far it has come off its low, the second how far it still sits below its high. ' +
        'The lighter leg behind each marker is the past month, so a stock that has turned shows it.</p>' +
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
        ? `<line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" stroke="${pal.zero}" stroke-width="1"/>` : '';
      // COMPARE AGAINST THE PALETTE, NOT THE LITERAL. This read `color ===
      // '#34d399'`, which is exactly the kind of test that survives routing
      // and quietly stops being true: on the light ground the line is
      // #157a51, so every spark — rising or falling — would have taken the
      // red wash while looking perfectly fine at a glance.
      const wash = color === pal.up ? pal.washUp : pal.washDown;
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` + zero +
        `<path d="${area}" fill="${wash}" stroke="none"/>` +
        `<path class="cl" d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    }

    function tplSparks() {
      const [days, winLabel] = barWin(O.spkWin);
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
        `<div class="spk" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${items.map((it) => {
          const color = it.end >= 0 ? pal.up : pal.down;
          return '<div class="spkt">' +
            `<div class="sh"><span class="ss">${esc(it.label || it.sym)}</span>` +
            `<span class="sv ${it.end >= 0 ? 'pos' : 'neg'}">${pct(it.end)}</span></div>` +
            sparkSvg(it.S, color) + '</div>';
        }).join('')}</div>` +
        '<p class="s-sub wide" style="--fs:18px;margin-top:22px">Each shape is that stock alone, rebased to the start of the window ' +
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
        `<p class="s-sub wide" style="--fs:18px;margin-top:24px">Quality ${r.qualityRating != null ? r.qualityRating + '/10' : 'not scored'} \u00b7 ` +
        'reported figures, not estimates of what comes next.</p>' +
        '</div></div>' + chromeFoot();
    }

    // ---- the shape of the screen
    if (mode === 'shape') {
      const rows = scope.rows;
      const bands = [
        ['Profitable', (x) => x.netIncomeTtm != null && x.netIncomeTtm > 0, 'var(--green)', 'netIncomeTtm'],
        ['Cash generative', (x) => x.fcfTtm != null && x.fcfTtm > 0, pal.ink('#a3e635'), 'fcfTtm'],
        ['More cash than debt', (x) => x.netCash != null && x.netCash > 0, pal.ink('#22d3ee'), 'netCash'],
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
        '<p class="s-sub wide" style="--fs:19px;margin-top:28px">Counted out of the companies that report each figure. Facts about businesses, not opinions about prices.</p>' +
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
        `<p class="s-sub wide" style="--fs:18px;margin-top:20px">${q.gp} of ${pts.length} are growing revenue AND profitable. ` +
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
      `<p class="s-sub wide" style="--fs:18px;margin-top:22px">${esc(label)}${kind === 'money' ? ', trailing twelve months' : ''} \u2014 ` +
      'as reported. A fact about the business, not a view on the price.</p>' +
      '</div></div>' + chromeFoot();
  }

  // The quadrant plot. Axes cover the middle 96% and the strays are pinned to
  // the edge in amber and counted, the same treatment the indicator lab uses:
  // three runaway growth rates would otherwise press every other dot into a
  // band a few pixels tall.
  // The axis arithmetic, shared by every plot on a card — the part that was
  // hard to get right, as opposed to how the marks look.
  //
  // Axes cover the middle 96% and the strays are PINNED to the edge rather than
  // allowed to set the scale, the same treatment the indicator lab uses: three
  // runaway growth rates would otherwise press every other dot into a band a
  // few pixels tall. `includeZero` keeps the origin on the chart, which the
  // quadrant card needs and a market-cap axis does not.
  function plotScales(pts, g) {
    // THE 2% TRIM DOES NOTHING AT SMALL n, which is why `fence` exists. With
    // the ~140 dots the quadrant card plots it drops three at each end and the
    // scale behaves. With the 20 a Bubble card shows, `floor(20 * 0.02)` is 0
    // and `ceil(20 * 0.98) - 1` is the last index — the full range, so one
    // company at 900% growth sets the axis and presses every other circle into
    // a band a few pixels tall, with nothing marked as pinned. Tukey's fence
    // (a quartile either side, 1.5x the spread between them) is robust at any
    // size, so that is what a small plot asks for.
    const quart = (a, p) => {
      const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
      return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
    };
    const span = (vals) => {
      const a = vals.slice().sort((m, n) => m - n);
      let lo, hi;
      if (g.fence === 'iqr') {
        const q1 = quart(a, 0.25), q3 = quart(a, 0.75), iqr = q3 - q1;
        // Clamped to the real data: a fence wider than the values themselves
        // would leave dead space rather than pin anything.
        lo = Math.max(a[0], q1 - iqr * 1.5);
        hi = Math.min(a[a.length - 1], q3 + iqr * 1.5);
        if (!(hi > lo)) { lo = a[0]; hi = a[a.length - 1]; }
      } else {
        lo = a[Math.floor(a.length * 0.02)];
        hi = a[Math.ceil(a.length * 0.98) - 1];
      }
      return g.includeZero === false ? [lo, hi] : [Math.min(lo, 0), Math.max(hi, 0)];
    };
    let [x0, x1] = span(pts.map((p) => p.x));
    let [y0, y1] = span(pts.map((p) => p.y));
    const padX = (x1 - x0) * 0.08 || 1, padY = (y1 - y0) * 0.08 || 1;
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
    const X = (v) => g.PL + (Math.min(Math.max(v, x0), x1) - x0) / (x1 - x0) * (g.W - g.PL - g.PR);
    const Y = (v) => g.PT + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * (g.H - g.PT - g.PB);
    return { X, Y, x0, x1, y0, y1, stray: (p) => p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1 };
  }

  function scatterSvg(pts, q) {
    const W = 952, H = size.id === 'story' ? 1000 : size.id === 'square' ? 470 : 600;
    const PL = 96, PR = 30, PT = 24, PB = 60;
    const sc = plotScales(pts, { W, H, PL, PR, PT, PB });
    const { X, Y, x0, x1, y0, y1, stray } = sc;
    const zx = X(0), zy = Y(0);
    // the eight furthest from the origin carry their name; labelling 140
    // dots is mush
    const named = pts.slice().sort((a, b) =>
      (Math.abs(b.x) / (x1 - x0) + Math.abs(b.y) / (y1 - y0)) -
      (Math.abs(a.x) / (x1 - x0) + Math.abs(a.y) / (y1 - y0))).slice(0, 8);
    const isNamed = new Set(named.map((p) => p.sym));
    const dots = pts.map((p) => {
      const s2 = stray(p);
      const c = s2 ? pal.ink('#fbbf24') : (p.x > 0 && p.y > 0) ? pal.up
        : (p.y <= 0) ? pal.down : pal.ink('#7c9cff');
      return `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${isNamed.has(p.sym) ? 9 : 6.5}" fill="${c}" opacity="${s2 ? 1 : 0.72}"/>`;
    }).join('');
    // A name is many times wider than a ticker, so a label on a dot in the
    // right half is drawn back towards the middle instead of off the edge,
    // and a very long one is clipped rather than allowed to cross the chart.
    const labels = named.map((p) => {
      const cx = X(p.x), right = cx > PL + (W - PL - PR) * 0.55;
      const full = p.label || p.sym;
      const txt = full.length > 22 ? full.slice(0, 21) + '…' : full;
      return `<text x="${(cx + (right ? -13 : 13)).toFixed(1)}" y="${(Y(p.y) + 6).toFixed(1)}" text-anchor="${right ? 'end' : 'start'}" font-size="18" font-weight="600" fill="${pal.ink('#e9ecf2')}" font-family="Geist, sans-serif">${esc(txt)}</text>`;
    }).join('');
    const quad = (tx, ty, anchor, text, tint) =>
      `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="18" font-weight="600" fill="${tint}" font-family="Geist, sans-serif" opacity="0.85">${esc(text)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin-top:26px" role="img" aria-label="growth against margin">` +
      `<rect x="${zx}" y="${PT}" width="${W - PR - zx}" height="${zy - PT}" fill="${pal.washUp}"/>` +
      `<line x1="${PL}" y1="${zy.toFixed(1)}" x2="${W - PR}" y2="${zy.toFixed(1)}" stroke="rgba(255,255,255,0.22)"/>` +
      `<line x1="${zx.toFixed(1)}" y1="${PT}" x2="${zx.toFixed(1)}" y2="${H - PB}" stroke="rgba(255,255,255,0.22)"/>` +
      dots + labels +
      quad(W - PR - 8, PT + 24, 'end', `growing & profitable \u00b7 ${q.gp}`, pal.up) +
      quad(W - PR - 8, H - PB - 12, 'end', `growing & losing \u00b7 ${q.gl}`, pal.down) +
      quad(PL + 8, PT + 24, 'start', `shrinking & profitable \u00b7 ${q.sp}`, pal.ink('#7c9cff')) +
      quad(PL + 8, H - PB - 12, 'start', `shrinking & losing \u00b7 ${q.sl}`, pal.ink('#94a3b8')) +
      `<text x="${W - PR}" y="${H - 16}" text-anchor="end" font-size="18" fill="${pal.axis}" font-family="Geist Mono, monospace">revenue growth \u2192</text>` +
      `<text x="20" y="${PT + 14}" font-size="18" fill="${pal.axis}" font-family="Geist Mono, monospace">\u2191 profit margin</text>` +
      '</svg>';
  }

  // The profile picture: the mark alone, full bleed, no header and no
  // footer — a bio avatar is shown at about a hundred pixels in a circle,
  // where a wordmark is mush and only a shape survives. Everything stays
  // inside the middle 70%, which is what the circle crop keeps.
  // ---- Size: companies as circles, two measures at once ---------------------
  //
  // The owner's brief: compare companies within a theme by size, carry other
  // fundamentals with it, and do it as circles rather than another bar chart —
  // "maybe two concentric circles, each representing a different measure".
  //
  // AREA is the encoding, never radius. A circle of twice the radius is four
  // times the area, so sizing by radius would quadruple the apparent gap — the
  // direction people already misread a bubble chart in.
  //
  // BOTH discs share ONE area scale whenever both are money, which is what
  // makes the pair worth drawing: the second disc's share of the first IS the
  // ratio between the two figures. Revenue inside market cap is price-to-sales
  // drawn rather than stated, and when revenue EXCEEDS the cap the discs simply
  // swap — the company trading under one times sales is the one whose circle
  // breaks out, which is the right thing for an eye to catch.
  const SIZE_MEASURES = {
    cap: ['Market cap', 'marketCap', 'money'],
    rev: ['Revenue', 'revenueTtm', 'money'],
    gp: ['Gross profit', 'grossProfitTtm', 'money'],
    ni: ['Net income', 'netIncomeTtm', 'money'],
    fcf: ['Free cash flow', 'fcfTtm', 'money'],
    cash: ['Net cash', 'netCash', 'money'],
    gm: ['Gross margin', 'grossMargin', 'pct'],
    pm: ['Profit margin', 'profitMargin', 'pct'],
    fm: ['FCF margin', 'fcfMargin', 'pct'],
    growth: ['Revenue growth', 'revenueGrowthYoY', 'pct'],
  };

  // A THIRD measure, as plain text under each circle. Deliberately not a third
  // ring: the card already encodes two things by area, and a valuation
  // multiple is a number you read rather than a magnitude you compare at a
  // glance — three nested circles would be decoration pretending to be data.
  //
  // Every one of these is the provider's own ratio rather than something
  // divided here, which is what keeps it safe for an ADR: computing
  // price-to-sales from a dollar market cap and a won revenue would produce a
  // confident, meaningless number.
  const SIZE_THIRDS = {
    fpe: ['fwd P/E', 'forwardPe', 'x'],
    tpe: ['P/E', 'trailingPe', 'x'],
    ps: ['P/S', 'priceToSales', 'x'],
    pb: ['P/B', 'priceToBook', 'x'],
    ev: ['EV/EBITDA', 'evToEbitda', 'x'],
    peg: ['PEG', 'peg', 'x'],
    cap: ['market cap', 'marketCap', 'money'],
  };

  // The third measure's READER, shared by Size and Bubble so the rules below
  // are stated once. Returns the formatter and the two counts it accumulates;
  // a caller draws the text and prints the counts.
  //
  // A multiple off a loss is arithmetic, not cheapness — the same reason the
  // Quality score refuses a P/E from a loss-maker, and the reason the
  // fundamentals ranking filters them out rather than sorting on them. Shown as
  // a dash, with the count said aloud, so an absent number never reads as a
  // missing one.
  //
  // A dash means two DIFFERENT things and the caption must separate them, the
  // lesson the News column and the data-quality page both record: a company
  // that loses money has no meaningful multiple, and one that simply does not
  // report the figure has no number at all. Drawing them the same and then
  // miscounting one as the other is how a card quietly lies.
  function thirdReader(key) {
    const third = SIZE_THIRDS[key] || null;
    const counts = { noMultiple: 0, notReported: 0 };
    const txt = (r) => {
      if (!third) return '';
      const v = r[third[1]];
      if (v == null || !isFinite(v)) { counts.notReported++; return '—'; }
      if (third[2] === 'money') return fmtMoney(v);
      if (v <= 0) { counts.noMultiple++; return '—'; }
      return v.toFixed(1) + '×';
    };
    // The two sentences, built once so both cards word them identically.
    const note = () => (counts.noMultiple
      ? ' ' + counts.noMultiple + ' had no meaningful multiple: a ratio off a loss is arithmetic, not cheapness.' : '')
      + (counts.notReported ? ' ' + counts.notReported + ' does not report it.' : '');
    return { third, txt, counts, note };
  }

  function tplSize() {
    const scope = scopeOf('sizeScope', 'sizeSector');
    const outerKey = SIZE_MEASURES[O.sizeOuter] ? O.sizeOuter : 'cap';
    const innerKey = O.sizeInner === 'none' ? null
      : (SIZE_MEASURES[O.sizeInner] ? O.sizeInner : 'rev');
    const oM = SIZE_MEASURES[outerKey];
    const oLabel = oM[0], oField = oM[1], oKind = oM[2];
    const inner = innerKey ? SIZE_MEASURES[innerKey] : null;
    // Shared with the Bubble card — see thirdReader for the rules it applies.
    const rd = thirdReader(O.sizeThird);
    const third = rd.third;
    const thirdTxt = rd.txt;

    const n = Number(O.sizeCount) || (size.id === 'story' ? 9 : size.id === 'square' ? 6 : 8);
    let rows = scope.rows.filter((x) => x[oField] != null && isFinite(x[oField]) && x[oField] > 0);
    // Every absolute figure is in the company's OWN reporting currency, so a
    // single foreign reporter would dominate the picture for the wrong reason:
    // Samsung's revenue is in won. The fundamentals ranking already applies
    // this rule, and a card whose whole point is comparing magnitudes needs it
    // more, not less.
    if (oKind === 'money' || (inner && inner[2] === 'money')) {
      rows = rows.filter((x) => !x.currency || x.currency === 'USD');
    }
    // Gross margin and net cash mean nothing for a lender — a bank has no cost
    // of goods, which is why JPM reports exactly 100%.
    if (outerKey === 'gm' || outerKey === 'cash'
      || innerKey === 'gm' || innerKey === 'cash') {
      rows = rows.filter((x) => x.sector !== 'Financial Services');
    }
    rows = rows.sort((a, b) => b[oField] - a[oField]).slice(0, n);

    if (rows.length < 2) {
      return chromeTop() + '<div class="s-body"><div><span class="s-kick">' + esc(scope.label) + '</span>'
        + '<h2 class="s-title">Size</h2><p class="s-empty">Not enough of ' + esc(scope.label)
        + ' reports ' + esc(oLabel.toLowerCase()) + ' yet to compare.</p></div></div>' + chromeFoot();
    }

    const cols = rows.length <= 4 ? 2 : rows.length <= 9 ? 3 : 4;
    // The cell is sized from the artboard's OWN height, not from the column
    // count alone. A card cannot scroll: a grid too tall does not clip, it
    // sits on top of the masthead, because `.s-body` centres its content. The
    // first cut fixed the cell per column count and overflowed the square by
    // 93px at four circles — the shortest artboard with the largest cells.
    const gridRows = Math.ceil(rows.length / cols);
    // What the title, legend, caption and chrome take before the grid gets any.
    //
    // MEASURED IN THE STUDIO, not estimated: everything above the grid is
    // 354-359px and everything below it 156-161px, so the furniture is ~520 —
    // and at 530 the body still spilled 8-13px over the masthead, because the
    // CAPTION GROWS. It gains a sentence whenever circles are floored, and one
    // each for a multiple off a loss and a figure not reported. A single
    // constant is a guess at variable content, so this one carries headroom
    // rather than sitting on the measurement. Reported 2026-09-20 as the kicker
    // printing on top of the brand tagline.
    // Per shape, because the square is the shortest artboard and the furniture
    // eats proportionally more of it. Set from a 135-combination sweep of every
    // shape x count x third x inner in the studio, with the tightest case left
    // ~30px clear rather than sitting on the measurement — see size-fit-test.
    const FURNITURE = size.id === 'story' ? 772 : size.id === 'square' ? 600 : 612;
    const CELL = Math.max(112, Math.min(420, (size.h - FURNITURE) / gridRows));
    // The cell holds the disc AND the lines under it, so the DISC takes what is
    // left rather than the text overflowing the cell it was supposed to sit in.
    // A name can wrap to two lines — "Taiwan Semiconductor Manufacturing" does —
    // so two is what is reserved.
    const NAME_H = size.id === 'story' ? 30 : 26;
    const TEXT_H = NAME_H * 2 + (size.id === 'story' ? 29 : 25) + (O.sizeThird && O.sizeThird !== 'none'
      ? (size.id === 'story' ? 25 : 22) : 0);
    // A DISC IS A SQUARE, so it is bounded by the narrower of its cell's
    // HEIGHT budget and its column's WIDTH — and only the height was ever
    // considered. It shows on the story alone because that artboard is tall
    // enough that the height never binds: measured, a four-column grid drew
    // 326px discs in 232px tracks and spilled 119px off the card. The body's
    // content box is 952px on every shape (the 64px side padding does not
    // vary), and .zgrid's column gap is 8px.
    const COLW = (952 - 8 * (cols - 1)) / cols;
    const MAXR = Math.max(26, Math.min(CELL * 0.39, (CELL - TEXT_H) / 2, (COLW - 6) / 2));
    // The scale is set by the largest company, so everything else is honestly
    // smaller: r = R * sqrt(v / vmax) keeps AREA proportional to the value.
    const big = rows[0][oField];
    const rOf = (v) => MAXR * Math.sqrt(Math.max(0, v) / big);
    // Under this a circle is a dot nobody can read. Floored rather than
    // dropped, and MARKED — a dot drawn at its honest size is still the truth,
    // and silently enlarging it would not be.
    const MINR = 14;
    let floored = 0;

    const body = rows.map((r) => {
      const ov = r[oField];
      let ro = rOf(ov);
      const tiny = ro < MINR;
      if (tiny) { ro = MINR; floored++; }
      let ri = 0, iTxt = '', swapped = false;
      if (inner) {
        const iField = inner[1], iKind = inner[2];
        const iv = r[iField];
        if (iv != null && isFinite(iv)) {
          if (iKind === 'money') {
            // The same absolute scale as the outer disc, so the two compare
            // both within one company and across the card.
            ri = tiny ? ro * 0.5 : rOf(Math.abs(iv));
            swapped = ri > ro;
            iTxt = fmtMoney(iv);
          } else {
            // A ratio has no scale of its own, so it is drawn as a SHARE of the
            // outer area: a 30% margin fills 30% of the disc. Clamped at the
            // edge, since a margin over 100% is a data fault, not a bigger
            // circle.
            const f = Math.max(0, Math.min(1, iv / 100));
            ri = ro * Math.sqrt(f);
            iTxt = fmtMetric(iv, 'pct');
          }
        }
      }
      const outerD = Math.max(ro, ri) * 2;
      const innerD = Math.min(ro, ri) * 2;
      const outerCls = swapped ? 'zin' : 'zout';
      const innerCls = swapped ? 'zout' : 'zin';
      return '<div class="zcell" style="height:' + CELL + 'px">'
        + '<div class="zdisc" style="width:' + outerD + 'px;height:' + outerD + 'px">'
        + '<span class="zc ' + outerCls + '" style="width:' + outerD + 'px;height:' + outerD + 'px"></span>'
        + (ri > 0 ? '<span class="zc ' + innerCls + '" style="width:' + innerD + 'px;height:' + innerD + 'px"></span>' : '')
        + '</div>'
        + '<div class="zname">' + esc(nameOf(r)) + (tiny ? '<span class="zdot">·</span>' : '') + '</div>'
        + '<div class="zval">' + esc(oKind === 'money' ? fmtMoney(ov) : fmtMetric(ov, 'pct'))
        + (iTxt ? '<span class="zi">' + esc(iTxt) + '</span>' : '') + '</div>'
        + (third ? '<div class="zthird">' + esc(thirdTxt(r)) + '</div>' : '')
        + '</div>';
    }).join('');

    const ratio = big / rows[rows.length - 1][oField];
    const legend = '<span class="zkey"><i class="zout"></i>' + esc(oLabel) + '</span>'
      + (inner ? '<span class="zkey"><i class="zin"></i>' + esc(inner[0]) + '</span>' : '')
      // The third measure is named ONCE here rather than beside every circle:
      // twelve repetitions of "fwd P/E" is noise on a poster, and the number
      // under each disc is unambiguous once the label has been said.
      + (third ? '<span class="zkey zkey3"><i class="ztxt"></i>' + esc(third[0]) + '</span>' : '');

    return chromeTop()
      + '<div class="s-body"><div><span class="s-kick">' + esc(scope.label) + ' · reported figures</span>'
      + '<h2 class="s-title">Size<br><span class="dim">' + esc(oLabel.toLowerCase())
      + (inner ? ' and ' + esc(inner[0].toLowerCase()) : '') + '</span></h2>'
      + '<div class="zlegend">' + legend + '</div>'
      + '<div class="zgrid" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + body + '</div>'
      + '<p class="s-sub wide" style="--fs:17px;margin-top:20px">Circle AREA is the measure, not its width. '
      + 'The largest here is ' + (ratio >= 100 ? Math.round(ratio) : ratio.toFixed(1)) + '× the smallest.'
      + (inner && inner[2] === 'money'
        ? ' The second disc shares that scale, so its share of the first is the ratio between them.' : '')
      + (inner && inner[2] !== 'money' ? ' The inner disc fills that share of the area.' : '')
      + (floored ? ' ' + floored + ' shown at a minimum size to stay legible (·).' : '')
      + (third ? ' The figure under each name is ' + esc(third[0]) + '.' : '')
      + rd.note()
      + '</p></div></div>' + chromeFoot();
  }

  // ---- the whole day on one card (2026-09-29, owner's request) ---------
  //
  // Every other data template answers ONE question. This answers "what
  // happened today" — the indexes, the sectors, and the two ends of the
  // move — which is the thing a market account actually posts.
  //
  // THE DENSITY IS THE WHOLE DESIGN PROBLEM. Four indexes, eleven sectors
  // and two lists of ten is 35 data rows, and a card cannot scroll: a list
  // too tall does not clip, it prints over the masthead, because .s-body
  // centres its content. At one row per line that is ~19px a row on the
  // 4:5 — and a 1080px card renders about 400px wide in a feed, so 19px
  // on the artboard is ~7px to the reader. "Smaller type" has a floor, and
  // it is set by where the card is read.
  //
  // So the layout is doing the work rather than the font size: the indexes
  // are a single strip of four chips instead of four rows, the sectors are
  // a two-column bar chart instead of eleven rows, and the movers are two
  // columns instead of twenty rows. 35 rows becomes ~17 lines.
  function tplDay() {
    // ONE PERIOD FOR THE WHOLE CARD. All three blocks read the same window,
    // or the chips would report one thing and the sectors beneath them
    // another, with nothing on the artboard saying so.
    const per = SNAP_PERIODS.some(([k]) => k === O.daySnapPeriod) ? O.daySnapPeriod : 'd';
    const [pctField, perLabel] = MOV_PERIODS[per];
    // VALUE ADDED IS TODAY-ONLY, and that is arithmetic rather than a
    // restriction. `capChangeToday` is cap x todayPct/100, and it is right
    // BECAUSE the stored market cap PREDATES today -- measured, the gap
    // between price x shares and the stored cap regresses on today's move
    // at a slope of 0.795. Over a week or a year the cap already CONTAINS
    // the move, so the same formula double-counts it; the correct one would
    // be cap x r/(1+r), which further assumes a share count that has not
    // changed -- false over a year, with buybacks and issuance. Rather than
    // print an invented figure the metric falls back to percent, the title
    // stops claiming it, and the studio greys the option.
    const byValue = O.dayMetric === 'value' && per === 'd';
    const field = byValue ? 'capChangeToday' : pctField;
    const floor = Number(O.dayFloor) || 0;
    // A card is a fixed artboard: the square cannot hold ten a side beside
    // everything else at any size still legible once a feed has shrunk it.
    const CAP = { portrait: 10, square: 5, story: 15 };
    const want = Number(O.dayCount) || 10;
    const k = Math.min(want, CAP[size.id] || CAP.portrait);

    // The indexes are the HEADLINE, not part of the market they measure.
    const bySym = new Map(stocks.map((x) => [x.symbol, x]));
    const idx = BENCH.map(([sym, label]) => {
      const r = bySym.get(sym);
      return r && r[pctField] != null ? { label, v: r[pctField] } : null;
    }).filter(Boolean);
    // ...and are therefore removed from every aggregate below — and so are
    // the SECTOR funds, for exactly the same reason now that the sector block
    // is drawn from them. A fund listed among the day's movers, directly under
    // a block that already reports it as its sector, is the index-in-its-own-
    // market error twice over. They carry a real market cap (a fund reports
    // AUM) and clear the $1B floor, so nothing else would have excluded them.
    const pool = stocks.filter((x) => x && !IS_BENCH.has(x.symbol) && !IS_SECTOR_ETF.has(x.symbol));

    // ---- sectors: THE FUNDS' OWN RETURNS (owner, 2026-09-30) -------------
    // The sector block used to aggregate our own stocks, cap-weighted. The
    // fund is the better source and it is not close: it needs no weighting
    // choice, it is the published tradeable number, and it sidesteps the two
    // things that made the computed version disagree with it — measured the
    // same day, our Technology ran 44.9 points above XLK over a year, because
    // this pool is 214 names against the fund's ~70 and because our cap
    // weighting is uncapped where a RIC-diversified fund holds nothing near
    // the 52.2% Alphabet reached in Communication Services here.
    //
    // THE COMPUTED AGGREGATE STAYS AS THE FALLBACK, for an instance that does
    // not hold the funds — the card still draws, and the head says WHICH
    // basis is on screen rather than leaving two different numbers looking
    // like one thing.
    const etfSecs = SECTOR_ETF.map(([name, sym]) => {
      const r = bySym.get(sym);
      return (r && r[pctField] != null) ? { name, v: r[pctField] } : null;
    }).filter(Boolean);

    // Two exclusions, and they are different rules. A missing return is
    // ABSENT, never zero — Number(null) is 0 and finite, and a fabricated
    // flat stock drags a mean. A stock with no market cap cannot carry a
    // weight at all, since a fund reports AUM rather than capitalisation;
    // `w > 0` rejects null and zero in one test.
    const agg = new Map();
    if (!etfSecs.length) {
      // ONE COMPANY, ONE LISTING, here too — see foldListings. This branch
      // takes a cap-weighted MEAN rather than a sum, so a dual-class company
      // does not inflate a total; it gets DOUBLE WEIGHT in its own sector,
      // which on Communication Services is Alphabet at ~55% of the sector
      // going to ~71%. Dormant on an instance holding the eleven sector
      // funds (which is the one we run) and silently wrong on one that is
      // not, so it is folded rather than left as a number nobody will check.
      for (const x of foldListings(pool, pctField).rows) {
        if (!x.sector) continue;          // the blank bucket is not a sector
        const w = x.marketCap;
        const v = x[pctField];
        if (!(w > 0) || v == null) continue;
        const a = agg.get(x.sector) || { w: 0, wv: 0, n: 0 };
        a.w += w; a.wv += w * v; a.n++;
        agg.set(x.sector, a);
      }
    }
    const byEtf = etfSecs.length > 0;
    const secs = (byEtf ? etfSecs
      : [...agg.entries()].map(([name, a]) => ({ name, v: a.wv / a.w, n: a.n })))
      .sort((a, b) => b.v - a.v);
    const sMax = Math.max(...secs.map((x) => Math.abs(x.v)), 0.01);
    // Eleven is the whole set; fewer means a fund is not held, and the head
    // says so rather than quietly showing nine sectors as though that were
    // all of them.
    const secHead = byEtf
      ? 'Sectors · sector funds' + (secs.length < SECTOR_ETF.length ? ' (' + secs.length + ' of ' + SECTOR_ETF.length + ')' : '')
      : 'Sectors · cap-weighted';

    // ---- the two ends of the move ---------------------------------------
    // A CAP FLOOR, and the measurement is more modest than the argument for
    // it usually is. I had written "without one the leaders are ten names
    // nobody has heard of"; measured on this universe (1,177 stocks, an
    // ordinary session) the unfiltered top ten is NINE recognisable
    // companies and one $0.2B name — so the floor is not rescuing the list.
    // What it does is keep the ten comparable in scale, and guard against a
    // junk bar: a sub-cent close once printed +56,000,000% on the screener
    // itself. $1B is the default because it keeps 97.5% of the pool (1,147
    // of 1,177) and drops exactly that one name; $10B keeps 67.2%, and is
    // the setting for a poster that should read as mega-caps only.
    //
    // THE S&P CUT NARROWS THE MOVERS AND NOTHING ELSE — the floor's own rule
    // above, and here the only coherent one. It was measured rather than
    // assumed: the other two blocks are ALREADY index readings and have
    // nothing in them to filter. The chips ARE the benchmarks; and the sector
    // block is drawn from the eleven SELECT SECTOR SPDRs, which divide the
    // S&P 500 by construction — the provider's own names say so ("State
    // Street Technology Select Sector SPDR ETF"), so cutting that block would
    // be filtering the index out of itself.
    //
    // The computed fallback is deliberately not cut either. Cutting one path
    // and not the other would make the sectors mean one thing with the funds
    // held and another without, invisibly — the "two different numbers
    // looking like one thing" the head wording above already exists to stop.
    //
    // Through spFilter, so the day card and the eight scoped templates cannot
    // disagree about what a null membership means.
    const spCut = O.daySp500 || 'All';
    const movers = spFilter(pool, spCut)
      .filter((x) => x[field] != null && (!floor || x.marketCap > floor));
    const ups = movers.filter((x) => x[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, k);
    const downs = movers.filter((x) => x[field] < 0).sort((a, b) => a[field] - b[field]).slice(0, k);
    const mMax = Math.max(...ups.concat(downs).map((x) => Math.abs(x[field])), 0.01);
    // A CHANGE takes a sign, whichever unit it is in — the Value added
    // column's rule, where a plain `-$32.0B` beside a green `+3.7%` was
    // distinguished from a gain by its minus sign alone. fmtMoney is the
    // module's own formatter (the Fund card's), so the digits read here
    // exactly as they read on every other card; the sign and the $ are
    // added around it, since it carries neither.
    const money = (v) => (v < 0 ? '-$' : '+$') + fmtMoney(Math.abs(v));
    const mv = (x) => (byValue ? money(x[field]) : pct(x[field]));

    // ---- ONE RHYTHM, and the step-down that was measured away -----------
    // This carried the ranked card's ROOM/RHYTHM machinery — default, then
    // tight, then tighter, then trimming the lists — because a card cannot
    // scroll and that is how tplMovers keeps a long list off the masthead.
    // MEASURED ON THE REAL ARTBOARDS, IT COULD NEVER FIRE. The body has
    // 958px on the 4:5, 688 on the square and ~1460 on the story, and the
    // tallest card the controls can reach — a story at fifteen a side —
    // draws 993px. The step was firing on the square alone, and only because
    // the estimate I had written put its room 108px too low: forcing the
    // default rhythm on all 54 swept combinations overflows NOTHING.
    //
    // So the protection is the per-artboard CAP above, which IS load-bearing
    // (reverting it fails four checks), plus the sweep. Code that cannot be
    // made to fire is residue, and residue reads as intent.

    const chips = idx.length
      ? '<div class="dy-chips">' + idx.map((x) =>
        `<span class="dy-chip"><b>${esc(x.label)}</b>` +
        `<i class="${x.v >= 0 ? 'pos' : 'neg'}">${pct(x.v)}</i></span>`).join('') + '</div>'
      : '';

    const secBlock = secs.length
      ? `<div class="dy-block"><div class="dy-head">${esc(secHead)}</div>` +
        '<div class="dy-grid">' + secs.map((x) => {
          const w = Math.max(4, Math.round(Math.abs(x.v) / sMax * 100));
          return '<div class="dy-row"><span class="dy-lab">' + esc(x.name) + '</span>' +
            '<span class="dy-rail"><span class="dy-bar' + (x.v < 0 ? ' neg' : '') +
            `" style="width:${w}%;display:block"></span></span>` +
            `<span class="dy-val ${x.v >= 0 ? 'pos' : 'neg'}">${pct(x.v)}</span></div>`;
        }).join('') + '</div></div>'
      : '';

    const col = (title, list, neg) =>
      '<div class="dy-col"><div class="dy-head ' + (neg ? 'neg' : 'pos') + '">' +
      esc(title) + '</div>' + (list.length ? list.map((x) => {
        const w = Math.max(5, Math.round(Math.abs(x[field]) / mMax * 100));
        return '<div class="dy-row"><span class="dy-lab">' + esc(nameOf(x)) + '</span>' +
          '<span class="dy-rail"><span class="dy-bar' + (neg ? ' neg' : '') +
          `" style="width:${w}%;display:block"></span></span>` +
          `<span class="dy-val ${neg ? 'neg' : 'pos'}">${mv(x)}</span></div>`;
      }).join('') : '<div class="mnone">nothing moved that way</div>') + '</div>';

    // The heading names what is ACTUALLY shown. A card that says "Top 10"
    // over six rows has made itself untrue, which is the rule the ranked
    // card already follows when it trims.
    const movBlock = (ups.length || downs.length)
      ? '<div class="dy-block"><div class="dy-two">' +
        col('Top ' + ups.length, ups, false) +
        col('Bottom ' + downs.length, downs, true) + '</div></div>'
      : '';

    // The kicker counts the pool the SECTORS are aggregated over, so it says
    // when a floor is narrowing the movers rather than leaving the reader to
    // wonder why a familiar small name is missing.
    // THE KICKER NAMES THE CUT, because a posted card has no picker beside
    // it and nothing else on the artboard could say why a familiar name is
    // missing. It degrades to exactly the old string when the cut is off.
    const movWord = spCut === 'in' ? 'S&P 500 movers'
      : spCut === 'out' ? 'movers outside the S&P 500'
        : 'movers';
    const floorNote = (spCut !== 'All' || floor)
      ? ' · ' + movWord + (floor ? ' over $' + fmtMoney(floor) : '')
      : '';
    // `dy-in` rather than a bare div: the wrapper below has to FILL what the
    // body leaves, and for that its parent needs a height. Every other
    // template's inner block is a plain block whose height is its content,
    // and `.s-body` then centres it — which is what left the two empty bands.
    return chromeTop() +
      '<div class="s-body"><div class="dy-in">' +
      `<span class="s-kick">${pool.length.toLocaleString()} stocks${esc(floorNote)}</span>` +
      // The second line names what the MOVERS are ranked by, not the card:
      // the sectors are cap-weighted percentages whichever metric is chosen
      // (the owner's instruction), so a bare "by value added" over the whole
      // card would describe two of its three blocks wrongly.
      // THE PERIOD IS THE SUBTITLE, because it is now true of all three
      // blocks rather than of the movers alone -- a card reading as today
      // when it is a year is the worst thing this template could do. The
      // metric clause is appended only when it applies, which is Today.
      '<h2 class="s-title">Snapshot<br><span class="dim">' +
      // 'movers by' is dropped from the metric clause and the reason is a
      // MEASUREMENT: with it the subtitle wraps at story/value/15 and the
      // gap between blocks falls to 27px against the sweep's 30px floor.
      // The period has to be stated now that the template is no longer
      // called "The day", so something had to give, and this clause is
      // the half the heads below already carry -- the movers are the only
      // ranked thing on the card, and their columns say "Top 10".
      esc(perLabel + (byValue ? ' · by value added' : '')) +
      '</span></h2>' +
      `<div class="dy-wrap">${chips}${secBlock}${movBlock}</div>` +
      '</div></div>' + chromeFoot();
  }

  // ---- Stock spotlight: one company, the whole picture --------------------
  //
  // "One card for a single stock" (the owner, 2026-09-30). Three templates
  // already answer ONE question about one company — the Chart card in `stock`
  // mode draws its line, the Advice card in `profiles` mode reads the five
  // rule sets against it, the Fundamentals card in `one` mode lists its
  // figures — so the whole picture took three posts. This is the poster: what
  // it is, what it did, what it earns, and what the rules make of it.
  //
  // IT IS NOT `stock` (tplStock). That one is the STOCK PAGE's chart export,
  // fed by ctx.chart — a host that already holds one symbol's own closes —
  // which is why it is deliberately absent from the studio's picker. This
  // reads the basket like every other studio card.
  function tplSpotlight() {
    const sym = O.spotSym || (stocks[0] && stocks[0].symbol);
    const row = stocks.find((r) => r.symbol === sym);
    if (!row) {
      return chromeTop() + '<div class="s-body"><div>' +
        '<span class="s-kick">Nothing to spotlight</span>' +
        '<h2 class="s-title">No row<br><span class="dim">for ' +
        esc(sym || 'that symbol') + '</span></h2>' +
        '<p class="s-empty">That symbol is not on this screen.</p>' +
        '</div></div>' + chromeFoot();
    }
    const [days, winLabel] = barWin(O.spotWin);
    const d = getBasket(days);
    if (!d || !d.dates || !d.dates.length) {
      return chromeTop() +
        '<div class="s-body"><div><span class="s-kick">Reading the archive</span>' +
        '<h2 class="s-title">Drawing<br><span class="dim">the chart\u2026</span></h2>' +
        '</div></div>' + chromeFoot();
    }

    // ---- the line, rebased, coloured by its own direction ----------------
    // Through lineChart, the SAME function the Chart card and the stock
    // page's export use, rather than a second implementation — which is what
    // makes it survive the PNG export unchanged (presentation attributes, no
    // classes). Rebased to % because that is the one scale that reads the
    // same for a $4 stock and a $1,000 one; the dollar price is not lost, it
    // sits in the header where a reader looks for it.
    const S = (d.series || {})[sym] || null;
    const endOf = (A) => {
      for (let i = A.length - 1; i >= 0; i--) if (A[i] != null) return (A[i] - 1) * 100;
      return null;
    };
    const move = S ? endOf(S) : null;
    // Green up, red down. A single line about a single stock is the case
    // where the direction IS the story — the table's sparkline stays neutral
    // for the opposite reason, five coloured columns already beside it.
    const colour = move == null ? pal.flat : move >= 0 ? pal.up : pal.down;
    const H = size.id === 'story' ? 624 : size.id === 'square' ? 176 : 318;
    // A MISSING SERIES DOES NOT EMPTY THE CARD. The Chart card returns a bare
    // "no stored history" card because the chart IS that card; here the
    // figures, the range and the verdict are all still worth posting, so the
    // plot alone stands aside and says why.
    const plot = S
      // mt: 0 — the wrap below is a flex column with its own gap, and the
      // chart's default top margin would be that spacing charged twice. It
      // measured exactly 26px, which is most of what the 4:5 was short by.
      ? lineChart(d.dates, [{ color: colour, S, width: 4, fill: true }], { h: H, mt: 0 })
      : '<p class="s-empty">No stored history for ' + esc(sym) + ' over the ' +
        esc(winLabel) + '.</p>';

    // ---- the header ------------------------------------------------------
    // Sector then industry, coarse to fine, the order every other surface
    // uses. The industry arrives one profile at a time, so a card with only
    // a sector is the common case rather than an edge one.
    const kick = [row.sector, row.industry].filter(Boolean).join(' \u00b7 ')
      || 'One stock, in full';
    // THE PRICE IS IN THE TRADING CURRENCY, which is the one money field on
    // this card where that is the right currency — and for a US-listed
    // universe it is USD, which is what makes the $ safe. The same rule that
    // makes the dollar market cap below safe; it would NOT hold for a foreign
    // listing, which is one more thing "US-listed only" quietly buys.
    const priceStr = row.price != null && isFinite(row.price)
      ? '$' + Number(row.price).toFixed(2) : null;
    // Thresholds measured at the drawn size rather than guessed: the body is
    // 952px wide, and Geist at 800 weight averages a little over half an em,
    // so ~31 characters fill a line at the full size and ~41 at the middle
    // one. A name past that wraps to two lines at the SMALL size, which the
    // sweep has room for; the steps exist so it does not wrap at the big one.
    const nm = nameOf(row);
    // FOUR STEPS, because the provider's names go much further than they
    // look: measured against the live universe, 58 display names pass 28
    // characters, 16 pass 40, 8 pass 60 and the longest is NINETY-NINE
    // ("Brookfield Renewable Corporation Brookfield Renewable Corporation
    // Class A Subordinate Voting Shares"). At three steps that one still
    // took three lines and left the 4:5 card 4px of headroom.
    const tCls = nm.length > 60 ? ' t4' : nm.length > 40 ? ' t3' : nm.length > 28 ? ' t2' : '';
    const head = '<span class="s-kick">' + esc(kick) + '</span>' +
      '<h2 class="s-title' + tCls + '">' + esc(nm) + '</h2>' +
      '<div class="sp-sub">' + esc(sym) +
      (priceStr ? ' \u00b7 ' + esc(priceStr) : '') +
      (row.todayPct != null
        ? ' \u00b7 <span class="' + (row.todayPct >= 0 ? 'sp-up' : 'sp-dn') + '">' +
          esc(pct(row.todayPct, 2)) + ' today</span>'
        : '') +
      '</div>';

    // ---- twelve figures --------------------------------------------------
    // Three rows, and the order is what it did, then where it stands, then
    // what it is.
    //
    // THE SECOND ROW REPLACED THE 52-WEEK TRACK (2026-09-30, owner's
    // request). The track drew the position as a marker on a rail and put
    // the two distances at its ends; four cells say the same thing in
    // numbers and add two readings the card had no room for. What is lost is
    // the RECOVERY LEG — the faint month-ago segment behind the marker,
    // which showed whether a stock near its low was still falling. Nothing
    // here replaces that; it is a shape rather than a figure. Worth knowing
    // before it is missed. `recoveryLeg` itself stays, because the Range
    // card draws it.
    //
    // REVENUE IS DELIBERATELY NOT HERE, though it is the obvious size number
    // beside the cap: an absolute is in the company's own REPORTING currency
    // (Samsung's revenue is in won, Ericsson's in krona), so a card printing
    // it with a $ would be confidently wrong. Margins and growth are ratios
    // and carry the same story with none of that exposure. Market cap is the
    // one absolute that is always USD, verified across eighteen foreign
    // reporters, which is why it alone gets a dollar sign.
    //
    // Gross margin is meaningless for a lender, so the margin shown is the
    // PROFIT margin — true for a bank and for a manufacturer alike.
    const pe = thirdReader('fpe');
    const peTxt = pe.txt(row);
    const CELLS = [
      ['1 week', row.oneWeekPct, 'ret'],
      ['1 month', row.oneMonthPct, 'ret'],
      ['3 months', row.threeMonthPct, 'ret'],
      ['1 year', row.oneYearPct, 'ret'],
      // WHERE IT STANDS. These two are LEVELS, not changes, which is why
      // they take the sign and NOT the colour: "from the high" is always
      // negative and "from the low" always positive, so green and red here
      // would read as good and bad when -1.1% off the high is excellent and
      // +61.5% off the low says nothing on its own. The margin rule, one
      // step further — a margin drops the sign because zero is not a
      // boundary it crosses; these keep it because the sign IS the label's
      // direction.
      ['From 52w high', row.pctFromHigh, 'lvl'],
      ['From 52w low', row.pctFromLow, 'lvl'],
      // RSI is an INDEX, not a percentage, so no % and no sign. Deliberately
      // uncoloured: 70 and 30 mean overbought and oversold, but that is a
      // reading this card does not otherwise make and the verdict below
      // already carries it. The stock page paints RSI violet; violet is not
      // in play here and spending it on one cell would make it mean
      // something new on this surface alone.
      ['RSI', row.rsi, 'idx'],
      // ...and this one IS a direction, so it takes the colour: above the
      // 200-day is the trend gate every rule set reads first.
      ['vs 200-day', row.vs200ma, 'ret'],
      ['Market cap', row.marketCap, 'cap'],
      ['Fwd P/E', peTxt, 'raw'],
      ['Revenue growth', row.revenueGrowthYoY, 'ret'],
      ['Profit margin', row.profitMargin, 'margin'],
    ];
    const cell = (label, v, kind) => {
      let txt = '\u2014', cls = '';
      if (kind === 'raw') txt = v == null ? '\u2014' : String(v);
      else if (kind === 'cap') txt = v != null && isFinite(v) ? '$' + fmtMoney(v) : '\u2014';
      else if (kind === 'lvl') txt = pct(v);            // sign, no colour
      else if (kind === 'idx') {
        // A null is not a zero: a listing too young for a 200-day average,
        // or with no stored range, gets a dash rather than a fabricated 0.
        txt = v == null || !isFinite(v) ? '\u2014' : v.toFixed(1);
      } else if (kind === 'margin') {
        // A MARGIN TAKES NO SIGN and a RETURN DOES. "+25.0%" as a profit
        // margin reads as a change rather than a level; a negative one still
        // takes the colour, because loss-making is the reading.
        txt = fmtMetric(v, 'pct');
        cls = v != null && isFinite(v) && v < 0 ? 'neg' : '';
      } else {
        txt = pct(v);
        cls = v == null || !isFinite(v) ? '' : v >= 0 ? 'pos' : 'neg';
      }
      return '<div class="sp-cell"><span class="sp-cl">' + esc(label) + '</span>' +
        '<span class="sp-cv ' + cls + '">' + esc(txt) + '</span></div>';
    };
    const figs = '<div class="sp-block"><div class="sp-head">Returns, position, and the business</div>' +
      '<div class="sp-grid">' +
      CELLS.map((c) => cell(c[0], c[1], c[2])).join('') + '</div></div>';

    // ---- what the rules read ---------------------------------------------
    // THE VERDICT ALWAYS TRAVELS WITH THE RULE THAT FIRED and with the rule
    // set's name. That is the whole difference between this and a tip sheet,
    // and it is why the attribution is not a setting.
    const profile = O.spotProf || 'Balanced';
    let verdict = '';
    if (profile !== 'off') {
      const a = advScored(profile)[sym] || null;
      const tint = (a && pal.tints[a.action]) || pal.flat;
      verdict = '<div class="sp-block"><div class="sp-head">What the rules read</div>' +
        '<div class="sp-verd" style="border-color:' + tint + '33">' +
        (a && a.action
          ? '<span class="sp-vw" style="color:' + tint + '">' + esc(a.action) + '</span>' +
            '<span class="sp-vr">' + esc(a.flag || '') + '</span>'
          : '<span class="sp-vw" style="color:var(--muted)">Not scored</span>' +
            '<span class="sp-vr">Not enough stored history for the rules to reach a reading.</span>') +
        '<span class="sp-vp">' + esc(profile) + ' rules</span></div></div>';
    }

    const dir = move == null ? ''
      : (move >= 0 ? 'Up ' : 'Down ') + Math.abs(move).toFixed(1) +
        '% over the ' + winLabel + ' \u2014 price only, rebased. ';
    const note = dir +
      (pe.counts.noMultiple
        ? 'Forward P/E is blank: a multiple off a loss is arithmetic, not cheapness. ' : '') +
      (pe.counts.notReported ? 'No forward P/E is reported for it. ' : '') +
      (profile !== 'off'
        ? 'The verdict is the ' + profile + ' rule set\u2019s mechanical reading, with the one rule that fired.'
        : 'Every figure is to the close above.');

    // `sp-in` rather than a bare div: the wrapper below has to FILL what the
    // body leaves, and for that its parent needs a height. Every other
    // template's inner block is a plain block whose height is its content and
    // `.s-body` then centres it — which is what left the day card's two empty
    // bands until it was given the same treatment.
    return chromeTop() +
      '<div class="s-body"><div class="sp-in">' + head +
      '<div class="sp-wrap">' + plot + figs + verdict + '</div>' +
      '<p class="s-sub wide" style="--fs:17px;margin-top:16px">' + esc(note) + '</p>' +
      '</div></div>' + chromeFoot();
  }

  // ---- Evolution: what the business did, and what the market paid for it ---
  //
  // The one card drawn from the company's OWN FILINGS rather than from the
  // vendor row. Trailing-twelve-month revenue and earnings at every filed
  // quarter — up to eighteen years — with the market's value of the company
  // on the same time axis underneath.
  //
  // TWO PANELS IN DOLLARS, NOT TWO REBASED LINES ON ONE PLOT, and that is a
  // measurement rather than a preference. Rebasing needs a positive base, and
  // earnings routinely are not: TSLA is loss-making for 38 of its 63 filed
  // quarters, PTON for 23 of 28, CRM for 19 of 42. Rebasing a series that
  // starts negative or crosses zero produces a number that means nothing, so
  // the shape every other chart card uses cannot be used here. Each panel
  // keeps its own scale — the stacked-pane convention the stock page's RSI
  // and volume panes already follow — and the note says so, because a reader
  // WILL compare the two shapes and is entitled to know they are not one
  // scale.
  //
  // THE GAP BETWEEN THE TWO PANELS IS THE RE-RATING, which is the reading
  // the card exists for, and the figures row states it as a number so nobody
  // has to infer it from two pictures.
  const EVO_MEASURES = {
    rev: ['revenue', 'Revenue', 'money'],
    ni: ['netIncome', 'Earnings', 'money'],
    margin: ['margin', 'Profit margin', 'pct'],
  };
  const EVO_WINDOWS = { 5: '5 years', 10: '10 years', 0: 'everything filed' };

  // Which stock, over how many years. Asked of the module by BOTH hosts —
  // the studio and the phone's saved-post route — for the reason
  // `basketDays` exists: the pairing was a hardcoded list in each of them
  // once, and that is how the spotlight shipped drawing nothing at all.
  function evolutionNeed(tpl, opts) {
    if (tpl !== 'evolution') return null;
    const o = opts || {};
    const years = EVO_WINDOWS[o.evoWin] != null ? Number(o.evoWin) : 10;
    return { symbol: o.evoSym || null, years };
  }

  // A raw-value chart with its OWN axis — a sibling of `lineChart` rather
  // than a flag on it. That one rebases every series to a percentage, which
  // is right for comparing two stocks and useless for a dollar figure; a
  // function that draws "everything except" is harder to follow than two
  // small ones, which is the same reason `sparkSVG` sits beside `chartSVG`.
  //
  // A ZERO LINE IS DRAWN ONLY WHERE THE DATA SPANS ZERO, and that is the
  // whole difference between a revenue panel and an earnings one: profitable
  // or not is the reading, and a line with no zero on it cannot say which
  // side it is on. The range is the DATA'S OWN, padded in pixels rather than
  // in value — padding in value put a zero line on a revenue chart once,
  // implying a crossing that cannot happen.
  let evoFillN = 0;
  function valueChart(dates, vals, o) {
    // A UNIQUE GRADIENT ID PER CHART. Two panels are two <svg> elements in
    // ONE document, so a shared id makes url(#...) resolve to whichever came
    // first -- the market-value panel painted the business panel's lime
    // gradient, which is visible, wrong, and throws nothing.
    const fid = 'evofill' + (++evoFillN);
    const W = 952, H = (o && o.h) || 300, PL = 118, PR = 128, PT = 16, PB = 40;
    const seen = vals.filter((v) => v != null && isFinite(v));
    if (seen.length < 2 || dates.length < 2) {
      return '<p class="s-empty">' + esc((o && o.empty) || 'Not enough filed quarters to draw.') + '</p>';
    }
    const fmt = (o && o.fmt) || ((v) => String(v));
    let lo = Math.min(...seen), hi = Math.max(...seen);
    if (lo === hi) { lo -= 1; hi += 1; }
    // Zero belongs on the axis only when the series actually reaches it.
    if (lo > 0 && lo < (hi - lo)) lo = 0;
    if (hi < 0 && -hi < (hi - lo)) hi = 0;
    const PADPX = 14;
    const x = (i) => PL + (i / (dates.length - 1)) * (W - PL - PR);
    const span = (H - PT - PB);
    const y = (v) => PT + PADPX + (1 - (v - lo) / (hi - lo)) * (span - PADPX * 2);
    let d = '', pen = false, first = -1, last = -1;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v == null || !isFinite(v)) { pen = false; continue; }
      if (first < 0) first = i;
      last = i;
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      pen = true;
    }
    const col = (o && o.color) || pal.ink(EVO_VAL);
    let grid = '';
    for (let g = 0; g <= 3; g++) {
      const v = lo + (g / 3) * (hi - lo);
      grid += '<line x1="' + PL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - PR)
        + '" y2="' + y(v).toFixed(1) + '" stroke="' + pal.grid + '" stroke-width="1"/>'
        + '<text x="' + (PL - 14) + '" y="' + (y(v) + 7).toFixed(1) + '" text-anchor="end"'
        + ' font-size="18" fill="' + pal.axis + '" font-family="Geist Mono, monospace">'
        + esc(fmt(v)) + '</text>';
    }
    // A ZERO LINE WITH NO LABEL, on a chart whose whole point is whether
    // the company crossed it. The gridlines are evenly spaced VALUES, so
    // zero is almost never one of them -- the label has to be its own, and
    // is dropped where it would land on a gridline's.
    if (lo < 0 && hi > 0) {
      const yz = y(0);
      grid += '<line x1="' + PL + '" y1="' + yz.toFixed(1) + '" x2="' + (W - PR)
        + '" y2="' + yz.toFixed(1) + '" stroke="' + pal.zero + '" stroke-width="1.5"/>';
      let clear = true;
      for (let g = 0; g <= 3; g++) {
        if (Math.abs(y(lo + (g / 3) * (hi - lo)) - yz) < 22) clear = false;
      }
      if (clear) {
        grid += '<text x="' + (PL - 14) + '" y="' + (yz + 7).toFixed(1) + '" text-anchor="end"'
          + ' font-size="18" fill="' + pal.axis + '" font-family="Geist Mono, monospace">'
          + esc(fmt(0)) + '</text>';
      }
    }
    // The fill is closed to the FLOOR of the plot, never back to the line's
    // own start — `fill` on the stroke path closes it to its first point and
    // paints a wedge, which this project has shipped once.
    //
    // THE FILL'S STRENGTH FOLLOWS THE BASELINE, and that is a decision about
    // what the card CLAIMS rather than a style choice. A filled area is read
    // as a QUANTITY measured from the baseline; a bare line is read as a
    // shape. So where zero genuinely sits on the axis the area is a true
    // quantity and earns a solid fill, and where the axis is truncated it
    // stays the faint wash it has always been -- a solid fill there would be
    // the misleading bar axis this project already recorded on the
    // short-interest strip, with the invisible mass below the floor doing the
    // lying. Measured over 99 series (12 symbols x 3 windows): 62 are already
    // zero-based and 11 cross zero, so 73 of 99 take the solid fill; forcing
    // zero on the other 26 would put PG's five-year revenue in the top 10% of
    // the panel. A reader is never left guessing which they have -- the
    // bottom gridline is LABELLED, so a solid fill always sits above a $0.
    let area = '';
    if (first >= 0 && last > first) {
      // ZERO IS ON THE AXIS WHEREVER THE RANGE REACHES IT, which is three
      // cases and not one: a series that crosses zero, one whose floor the
      // rule above pulled to zero, and an all-negative one whose CEILING it
      // pulled to zero. That last was closing to the plot FLOOR, so a
      // company loss-making across the whole window had its mass drawn
      // hanging off the bottom of the panel while zero sat at the top --
      // upside down, and invisible at 0.26 alpha. It hangs from zero now.
      const zeroBase = lo <= 0 && hi >= 0;
      const base = zeroBase ? y(0) : (H - PB);
      const a0 = zeroBase ? '0.42' : '0.26';
      const a1 = zeroBase ? '0.05' : '0';
      area = '<defs><linearGradient id="' + fid + '" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0%" stop-color="' + col + '" stop-opacity="' + a0 + '"/>'
        + '<stop offset="100%" stop-color="' + col + '" stop-opacity="' + a1 + '"/></linearGradient></defs>'
        + '<path d="' + d + 'L' + x(last).toFixed(1) + ' ' + base.toFixed(1)
        + 'L' + x(first).toFixed(1) + ' ' + base.toFixed(1) + 'Z" fill="url(#' + fid + ')" stroke="none"/>';
    }
    const endV = last >= 0 ? vals[last] : null;
    const tag = endV == null ? '' :
      '<text x="' + (W - PR + 12) + '" y="' + (y(endV) + 8).toFixed(1) + '" font-size="25"'
      + ' font-weight="600" fill="' + col + '" font-family="Geist Mono, monospace">'
      + esc(fmt(endV)) + '</text>';
    const axis = '<text x="' + PL + '" y="' + (H - 8) + '" font-size="17" fill="' + pal.axis
      + '" font-family="Geist Mono, monospace">' + esc(dates[0]) + '</text>'
      + '<text x="' + (W - PR) + '" y="' + (H - 8) + '" text-anchor="end" font-size="17" fill="'
      + pal.axis + '" font-family="Geist Mono, monospace">' + esc(dates[dates.length - 1]) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block" role="img"'
      + ' aria-label="' + esc((o && o.label) || 'chart') + '">'
      + area + grid
      + '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.6"'
      + ' stroke-linejoin="round" stroke-linecap="round"/>'
      + tag + axis + '</svg>';
  }

  // then -> now, said the way a person would say it. A multiple reads better
  // than a four-digit percentage past about 3x ("revenue grew 42 times", not
  // "+4,135%"), and a sign change is worded rather than percentaged — the
  // refresh report's own rule, because a company going from a -200 loss to a
  // -50 one has cut its losses by three quarters and the arithmetic calls
  // that -75%.
  function evoChange(a, b) {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return null;
    if (a < 0 && b >= 0) return { t: 'to profit', c: 'pos' };
    if (a >= 0 && b < 0) return { t: 'to a loss', c: 'neg' };
    if (a < 0 && b < 0) {
      const w = Math.abs(b) > Math.abs(a);
      return { t: w ? 'deeper loss' : 'smaller loss', c: w ? 'neg' : 'pos' };
    }
    if (a === 0) return null;
    const r = b / a;
    if (r >= 3) return { t: '\u00d7' + (r >= 10 ? r.toFixed(0) : r.toFixed(1)), c: 'pos' };
    const p = (r - 1) * 100;
    return { t: (p >= 0 ? '+' : '') + p.toFixed(0) + '%', c: p >= 0 ? 'pos' : 'neg' };
  }

  // The two panels' colours, named once. Both are in LIGHT_INK, so
  // `pal.ink` has a value to give them on the light ground — an unmapped
  // hex stays dark there and the line vanishes into the page, which is the
  // failure that reads as an empty card rather than a broken one.
  const EVO_BIZ = '#a3e635';
  const EVO_VAL = '#60a5fa';

  function tplEvolution() {
    const sym = O.evoSym || (stocks[0] && stocks[0].symbol);
    const row = stocks.find((r) => r.symbol === sym);
    const need = evolutionNeed('evolution', O);
    const ev = getEvolution(sym, need ? need.years : 10);

    if (!row) {
      return chromeTop() + '<div class="s-body"><div>'
        + '<span class="s-kick">Nothing to chart</span>'
        + '<h2 class="s-title">No row<br><span class="dim">for ' + esc(sym || 'that symbol') + '</span></h2>'
        + '<p class="s-empty">That symbol is not on this screen.</p>'
        + '</div></div>' + chromeFoot();
    }
    if (!ev) {
      return chromeTop() + '<div class="s-body"><div>'
        + '<span class="s-kick">Reading the filings</span>'
        + '<h2 class="s-title">Drawing<br><span class="dim">the history\u2026</span></h2>'
        + '</div></div>' + chromeFoot();
    }
    const pts = (ev.points || []).filter((p) => p && p.d);
    // A COMPANY THAT FILES NOTHING WE CAN READ GETS A REASON, NOT AN EMPTY
    // CHART. Measured: XOM has 0 usable trailing years, because the majors
    // use a revenue tag `secfacts.js` does not map, and a fund files no
    // statements at all. Both are ordinary here rather than edge cases.
    if (pts.length < 3) {
      return chromeTop() + '<div class="s-body"><div>'
        + '<span class="s-kick">' + esc(nameOf(row)) + '</span>'
        + '<h2 class="s-title">Too little<br><span class="dim">filed history</span></h2>'
        + '<p class="s-sub wide">A trailing year needs four consecutive filed quarters, and '
        + esc(nameOf(row)) + ' has too few stored to draw a line. A fund files no statements '
        + 'at all, and a few large filers use tags this reader does not map.</p>'
        + '</div></div>' + chromeFoot();
    }

    const mKey = EVO_MEASURES[O.evoMeasure] ? O.evoMeasure : 'rev';
    const [field, mLabel, mKind] = EVO_MEASURES[mKey];
    const dates = pts.map((p) => p.d);
    const series = pts.map((p) => p[field]);
    const caps = pts.map((p) => p.cap);
    const money = (v) => (v == null ? '\u2014' : (v < 0 ? '-$' : '$') + fmtMoney(Math.abs(v)));
    const fmtM = mKind === 'money' ? money : ((v) => (v == null ? '\u2014' : v.toFixed(0) + '%'));

    // ONE "THEN" AND ONE "NOW" FOR ALL FOUR FIGURES -- the window's own ends,
    // never each series' first non-null value. A row labelled "then -> now"
    // whose four "then"s are four different dates is wrong in a way nothing on
    // the card could say: a loss-making start has no multiple, and reaching
    // forward for the first quarter that did reported a later one as though it
    // were the start of the window.
    const A = pts[0], Z = pts[pts.length - 1];
    const at = (p, k) => {
      const v = p ? p[k] : null;
      return (v == null || !isFinite(v)) ? null : v;
    };

    // THE VALUE PANEL RUNS TO TODAY AND THE BUSINESS PANEL CANNOT, which is
    // the one asymmetry on this card and the reason the figures row now names
    // two dates. Prices exist for every session; there is no filing after the
    // last filed quarter, so revenue and earnings stop where the record does.
    // `live` is null where the filings are too stale for one more segment to
    // be honest — see LIVE_MAX_DAYS in adjusted.js.
    const live = (ev.live && ev.live.d > Z.d) ? ev.live : null;
    const vDates = live ? dates.concat(live.d) : dates;
    const vCaps = live ? caps.concat(live.cap) : caps;
    const V = live || Z;

    // `plain` drops the colour. A MULTIPLE RISING IS GOOD FOR A HOLDER AND
    // BAD FOR A BUYER, so green or red on it is an implied verdict -- the
    // one thing this card must not make. Revenue, earnings and market value
    // keep theirs: those are facts that have a direction.
    const figure = (label, a, b, fmt, plain) => {
      const ch = evoChange(a, b);
      const cls = (ch && !plain) ? ' ' + ch.c : '';
      return '<div class="evo-f"><span class="evo-fl">' + esc(label) + '</span>'
        + '<span class="evo-fv">' + esc(fmt(a)) + ' <i>\u2192</i> ' + esc(fmt(b)) + '</span>'
        + '<span class="evo-fc' + cls + '">' + esc(ch ? ch.t : '\u2014') + '</span></div>';
    };
    // A MULTIPLE IS NOT A MONEY FIGURE and has its own formatter: a P/E of
    // 8,014 is what CRM's multiple really was in a quarter whose earnings
    // were a rounding error, so it is printed rather than filtered — but it
    // is printed compactly, and `trailingPe` has already refused the ones
    // taken off a loss, which are arithmetic rather than cheapness.
    const peF = (v) => (v == null ? '\u2014' : (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + '\u00d7');

    const span = dates[0] + ' \u2192 ' + dates[dates.length - 1];
    const whole = ev.total != null && pts.length >= ev.total;
    const kick = [row.sector, row.industry].filter(Boolean).join(' \u00b7 ') || 'From the filings';
    const nm = nameOf(row);
    const tClass = nm.length > 60 ? ' t4' : nm.length > 40 ? ' t3' : nm.length > 28 ? ' t2' : '';

    // MEASURED against the real artboards at the WORST name length each one
    // has (evo-budget.js), never chosen: the two charts plus two headings plus
    // the figures row plus the gap have to fit the wrap, and the wrap is what
    // the headline leaves. The square alone was retuned when the as-of line
    // was added (measured: it costs ~30px, and the square had 31px spare).
    const tall = size.id === 'square' ? 180 : size.id === 'story' ? 537 : 330;
    const shortH = size.id === 'square' ? 127 : size.id === 'story' ? 374 : 232;

    const valuePanel = ev.hasValue
      ? '<div class="evo-p"><span class="evo-h">What the market paid for it</span>'
        + valueChart(vDates, vCaps, { h: shortH, color: pal.ink(EVO_VAL), fmt: money,
          label: 'market value' }) + '</div>'
      // NO SHARE COUNT, NO PANEL — never a fallback to the filed count, which
      // is the forty-fold error `evolutionSeries` exists to avoid.
      : '<div class="evo-p"><span class="evo-h">What the market paid for it</span>'
        + '<p class="s-empty">No current share count for ' + esc(row.symbol)
        + ', so no market value is drawn.</p></div>';

    return chromeTop() + '<div class="s-body"><div class="evo-in">'
      + '<span class="s-kick">' + esc(kick) + '</span>'
      + '<h2 class="s-title' + tClass + '">' + esc(nm) + '</h2>'
      + '<p class="evo-lab">' + esc(row.symbol) + ' \u00b7 ' + pts.length + ' filed quarters \u00b7 '
      + esc(span) + (whole ? ' \u00b7 all of it' : '') + '</p>'
      + '<div class="evo-wrap">'
      + '<div class="evo-p"><span class="evo-h">' + esc(mLabel)
      + ', trailing twelve months</span>'
      + valueChart(dates, series, { h: tall, color: pal.ink(EVO_BIZ), fmt: fmtM,
        label: mLabel }) + '</div>'
      + valuePanel
      + '<div class="evo-foot"><div class="evo-figs">'
      + figure('Revenue', at(A, 'revenue'), at(Z, 'revenue'), money)
      + figure('Earnings', at(A, 'netIncome'), at(Z, 'netIncome'), money)
      + figure('Market value', at(A, 'cap'), at(V, 'cap'), money)
      + figure('P/E', at(A, 'pe'), at(V, 'pe'), peF, true)
      + '</div>'
      // THE ROW HAD NO DATES AND THAT IS WHAT MISLED A READER: "$2.77T" was
      // taken for the market value NOW when it was the value at the end of
      // June, and the same card was read as ending on 30 June for the same
      // reason. Two of these four figures are as filed and two are as priced,
      // and a posted image has no picker beside it to say so.
      + '<p class="evo-asof">' + (live
          ? 'Revenue and earnings to ' + esc(Z.d) + ' · market value and P/E at the '
            + esc(live.d) + ' close'
          : 'All four as of ' + esc(Z.d) + ', the last filed quarter')
      + '</p></div></div>'
      + '<p class="s-sub wide">Trailing twelve months at every filed quarter, from the '
      + 'company\u2019s own SEC filings. The two panels keep their own scales. '
      + 'Market value is today\u2019s share count at each day\u2019s split-adjusted close, so it '
      + 'does not restate past share counts \u2014 a buyback makes the earlier multiple read low. '
      + 'A multiple is not shown where the company lost money.</p>'
      + '</div></div>' + chromeFoot();
  }

  function tplAvatar() {
    return '<div class="avatarFull">' +
      '<div class="avGlow"></div>' +
      '<svg viewBox="0 0 24 24" class="avMark" aria-hidden="true">' +
      '<path d="M3 17.4 8.6 12l3.6 2.7L20 6.4"/><path d="M14.6 6.4H20v5.4"/></svg>' +
      '</div>';
  }

  // ---- Bubble: three measures at once, positioned ---------------------------
  //
  // The owner asked for "a bubble instead of concentric circles". A single
  // circle per company already exists — Size with the inner measure set to
  // none — so the reading worth building is the other one: a chart where
  // POSITION carries meaning. Size ranks magnitudes in a grid; this asks how
  // two measures relate, and lets a third set the weight of each answer.
  //
  // It is also NOT the quadrant card (`fund` mode `quad`), which plots one
  // fixed pair — revenue growth against profit margin — with every dot the same
  // size. Here both axes AND the area are chosen, which makes it a different
  // question rather than a restyling.
  //
  // Axes, spans and stray-pinning come from `plotScales`, shared with that card,
  // so the arithmetic that was hard to get right is not written twice.
  const BUB_SECTOR_TINTS = ['#34d399', '#7c9cff', '#a78bfa', '#fbbf24', '#22d3ee', '#f472b6',
    '#fb7185', '#a3e635', '#94a3b8', '#f0abfc', '#fb923c'];

  function tplBubble() {
    const scope = scopeOf('bubScope', 'bubSector');
    const pick = (id, dflt) => (FUND_METRICS[O[id]] ? O[id] : dflt);
    const xk = pick('bubX', 'rg'), yk = pick('bubY', 'pm'), sk = pick('bubSize', 'cap');
    const xm = FUND_METRICS[xk], ym = FUND_METRICS[yk], sm = FUND_METRICS[sk];
    const xf = xm[0], xl = xm[1], xkind = xm[2];
    const yf = ym[0], yl = ym[1], ykind = ym[2];
    const sf = sm[0], sl = sm[1], skind = sm[2];
    const colorBy = O.bubColor === 'advice' ? 'advice' : O.bubColor === 'none' ? 'none' : 'sector';
    const n = Number(O.bubCount) || 20;
    // The Size card's third measure, on the same catalogue and the same rules —
    // see thirdReader. It rides the NAME rather than sitting under every circle:
    // twenty positioned, overlapping circles cannot each carry two lines of
    // text without the collisions the labelling rules below exist to prevent.
    // So it appears on the companies that are named, and the caption says so.
    const rd = thirdReader(O.bubThird);

    let rows = scope.rows.filter((r) =>
      r[xf] != null && isFinite(r[xf]) && r[yf] != null && isFinite(r[yf]));
    // Every absolute figure is in the company's OWN reporting currency, so one
    // foreign reporter would dominate for the wrong reason — Samsung's revenue
    // is in won. The guard Size and the fundamentals ranking already apply, and
    // it matters MORE here: an axis is a comparison by construction.
    if ([xkind, ykind, skind].indexOf('money') >= 0) {
      rows = rows.filter((r) => !r.currency || r.currency === 'USD');
    }
    // Gross margin and net cash mean nothing for a lender — a bank has no cost
    // of goods, which is why JPM reports exactly 100%.
    if ([xk, yk, sk].some((k) => k === 'gm' || k === 'cash' || k === 'ncp')) {
      rows = rows.filter((r) => r.sector !== 'Financial Services');
    }
    // A multiple off a loss is arithmetic, not cheapness — the rule the Quality
    // score, the fundamentals ranking and the Size card all follow.
    [xk, yk, sk].forEach((k, i) => {
      if (k !== 'pe' && k !== 'peg') return;
      const f = [xf, yf, sf][i];
      rows = rows.filter((r) => r[f] > 0);
    });
    // The biggest by the AREA measure, because those are the circles a reader
    // actually sees; blanks fall to the end.
    rows = rows.slice()
      .sort((a, b) => (Number(b[sf]) || -Infinity) - (Number(a[sf]) || -Infinity))
      .slice(0, n);

    if (rows.length < 3) {
      return chromeTop() + '<div class="s-body"><div><span class="s-kick">' + esc(scope.label) + '</span>'
        + '<h2 class="s-title">Bubble</h2><p class="s-empty">Not enough of ' + esc(scope.label)
        + ' reports both ' + esc(xl.toLowerCase()) + ' and ' + esc(yl.toLowerCase())
        + ' to plot.</p></div></div>' + chromeFoot();
    }

    const pts = rows.map((r) => ({
      sym: r.symbol, label: nameOf(r), x: Number(r[xf]), y: Number(r[yf]),
      v: Number(r[sf]), sector: r.sector || '—', action: r.action || null,
      row: r,
    }));

    const W = 952, H = size.id === 'story' ? 1080 : size.id === 'square' ? 520 : 660;
    const PL = 92, PR = 40, PT = 30, PB = 64;
    // `fence: 'iqr'` because this card plots tens of circles, not hundreds —
    // see plotScales for why the percentile trim cannot bite at that size.
    const sc = plotScales(pts, { W, H, PL, PR, PT, PB, includeZero: false, fence: 'iqr' });
    const X = sc.X, Y = sc.Y, stray = sc.stray;

    // AREA is the encoding, never radius. A circle of twice the radius is four
    // times the area, so sizing by radius quadruples the apparent gap — in the
    // direction people already misread a bubble chart. The card says so on its
    // own face, because the misreading is the default.
    const big = pts.reduce((m, p) => (p.v > 0 && p.v > m ? p.v : m), 0);
    const MAXR = size.id === 'square' ? 52 : 66, MINR = 9;
    const rOf = (v) => (big > 0 && v > 0 ? Math.max(MINR, MAXR * Math.sqrt(v / big)) : MINR);
    // A company with no positive area measure is drawn as a RING at the floor
    // size and COUNTED: it still has a place on both axes, and either inventing
    // an area for it or dropping it silently would misreport the screen.
    const ringed = pts.filter((p) => !(p.v > 0)).length;

    const sectors = [...new Set(pts.map((p) => p.sector))].sort();
    const colorOf = (p) => {
      if (colorBy === 'none') return pal.ink('#7c9cff');
      if (colorBy === 'advice') return (p.action && pal.tints[p.action]) || pal.flat;
      return pal.ink(BUB_SECTOR_TINTS[sectors.indexOf(p.sector) % BUB_SECTOR_TINTS.length]);
    };

    // A CIRCLE IS NOT A DOT: it has a radius, and pinning a stray puts its
    // CENTRE on the axis edge, which hangs half the circle off the artboard —
    // the biggest company on the card, sliced in two, because it was the
    // furthest out. The centre is kept a radius inside the plot on every side.
    // A scatter never needed this; every plot of sized marks does.
    const cxOf = (p) => {
      const r = rOf(p.v);
      return Math.min(Math.max(X(p.x), PL + r + 2), W - PR - r - 2);
    };
    const cyOf = (p) => {
      const r = rOf(p.v);
      return Math.min(Math.max(Y(p.y), PT + r + 2), H - PB - r - 2);
    };

    // Drawn largest first so a small circle is never buried under a big one —
    // the point of the size channel is that the small ones stay findable.
    const order = pts.slice().sort((a, b) => rOf(b.v) - rOf(a.v));
    const circles = order.map((p) => {
      const r = rOf(p.v), cx = cxOf(p).toFixed(1), cy = cyOf(p).toFixed(1), c = colorOf(p);
      const edge = stray(p);
      if (!(p.v > 0)) {
        return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1)
          + '" fill="none" stroke="' + c + '" stroke-width="1.75" stroke-dasharray="3 3"/>';
      }
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1)
        + '" fill="' + c + '" fill-opacity="0.26" stroke="' + c
        + '" stroke-width="' + (edge ? 3 : 1.75) + '"'
        + (edge ? ' stroke-dasharray="5 4"' : '') + '/>';
    }).join('');

    // A name sits INSIDE its circle when the circle is big enough to hold it,
    // which is the advantage a bubble has over a scatter. The rest of the
    // largest few are labelled beside the mark, anchored back towards the middle
    // on the right-hand side so a long name cannot run off the artboard — the
    // same rule the quadrant card learned.
    // A LABEL BESIDE A CIRCLE LANDS ON THE NEXT CIRCLE. The first cut anchored
    // ten names left or right of their marks, the way the quadrant card does
    // with its uniform 7px dots — and on a chart of 66px circles they collided
    // with everything: "JPMorgan Chase" printed across Microsoft, "Broadcom"
    // across AMD. A screenshot found it; no assertion would have.
    //
    // So: a name goes INSIDE its circle when the circle can hold it — the one
    // thing a bubble chart can do that a scatter cannot — and otherwise sits
    // CENTRED BELOW the mark, where a neighbour has to be almost exactly
    // underneath to clash rather than merely nearby. Fewer names, placed well,
    // beat ten placed badly on something that goes out as a poster.
    const INSIDE = 34;
    const labelled = order.filter((p) => rOf(p.v) >= INSIDE).concat(
      order.filter((p) => rOf(p.v) < INSIDE).slice(0, 3));
    // A NAME THAT WOULD LAND ON ONE ALREADY PLACED IS DROPPED. Circles overlap
    // — that is the chart — so two labels can be drawn in nearly the same spot
    // and print over each other, which is worse than one of them being absent:
    // an unreadable name is noise AND it hides the mark underneath. Boxes are
    // approximated from the character count at this weight, which is enough to
    // catch the real collisions without laying out text properly.
    const placed = [];
    const fits = (x, y, w) => {
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - 15, y1: y + 6 };
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return false;
      placed.push(box);
      return true;
    };
    const labels = labelled.map((p) => {
      const r = rOf(p.v), cx = cxOf(p), cy = cyOf(p);
      const full = p.label || p.sym;
      if (r >= INSIDE) {
        // Roughly 0.5em a character at this weight, so the name fits the chord
        // it is drawn across rather than spilling past the edge.
        const fit = Math.max(6, Math.floor(r / 4.9));
        const txt = full.length > fit ? full.slice(0, fit - 1) + '…' : full;
        const val = rd.third ? rd.txt(p.row) : '';
        // Two lines inside a circle need room for both, so the pair is raised
        // by half a line rather than the name staying put and the figure
        // hanging out of the bottom of the disc.
        const dy = val ? -3 : 6;
        if (!fits(cx, cy + dy, Math.max(txt.length * 10, val.length * 9))) return '';
        return '<text x="' + cx.toFixed(1) + '" y="' + (cy + dy).toFixed(1) + '" text-anchor="middle" '
          + 'font-size="19" font-weight="600" fill="' + pal.ink('#e9ecf2') + '" font-family="Geist, sans-serif">'
          + esc(txt) + '</text>'
          + (val ? '<text x="' + cx.toFixed(1) + '" y="' + (cy + dy + 21).toFixed(1)
            + '" text-anchor="middle" font-size="17" fill="' + pal.ink('#cfd6e2') + '" '
            + 'font-family="Geist Mono, monospace">' + esc(val) + '</text>' : '');
      }
      const txt = full.length > 18 ? full.slice(0, 17) + '…' : full;
      // Below, unless that would run off the foot, in which case above.
      const val = rd.third ? rd.txt(p.row) : '';
      // Below needs room for BOTH lines before it is chosen, or the figure
      // lands on the axis.
      const need = val ? 40 : 21;
      const below = cy + r + need < H - PB;
      const ly = below ? cy + r + 21 : cy - r - 10 - (val ? 20 : 0);
      if (!fits(cx, ly, Math.max(txt.length * 9, val.length * 9))) return '';
      return '<text x="' + cx.toFixed(1) + '" y="' + ly.toFixed(1)
        + '" text-anchor="middle" font-size="17" font-weight="600" '
        + 'fill="' + pal.ink('#cfd6e2') + '" font-family="Geist, sans-serif">' + esc(txt) + '</text>'
        + (val ? '<text x="' + cx.toFixed(1) + '" y="' + (ly + 20).toFixed(1)
          + '" text-anchor="middle" font-size="16" fill="' + pal.ink('#9aa3b2') + '" '
          + 'font-family="Geist Mono, monospace">' + esc(val) + '</text>' : '');
    }).join('');

    const axis = (t, x, y, anchor) => '<text x="' + x + '" y="' + y + '" text-anchor="' + anchor
      + '" font-size="18" fill="' + pal.axis + '" font-family="Geist Mono, monospace">' + esc(t) + '</text>';
    const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" '
      + 'style="display:block;margin-top:20px" role="img" aria-label="'
      + esc(xl + ' against ' + yl) + '">'
      + '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB)
      + '" stroke="rgba(255,255,255,0.18)"/>'
      + '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB)
      + '" stroke="rgba(255,255,255,0.18)"/>'
      + circles + labels
      + axis(xl.toLowerCase() + ' →', W - PR, H - 18, 'end')
      + axis('↑ ' + yl.toLowerCase(), 16, PT + 12, 'start')
      + '</svg>';

    // Three channels is two more than a reader can guess at, so the legend is
    // not optional.
    const swatch = colorBy === 'none' ? ''
      : (colorBy === 'advice'
        ? '<span class="bkey">colour: the Balanced verdict</span>'
        : sectors.slice(0, 6).map((s, i) =>
          '<span class="bkey"><i style="background:'
          + pal.ink(BUB_SECTOR_TINTS[i % BUB_SECTOR_TINTS.length]) + '"></i>' + esc(s) + '</span>').join(''));

    return chromeTop()
      + '<div class="s-body"><div><span class="s-kick">' + esc(scope.label) + ' · reported figures</span>'
      + '<h2 class="s-title">' + esc(xl) + '<br><span class="dim">against ' + esc(yl.toLowerCase()) + '</span></h2>'
      + '<div class="blegend"><span class="bkey bsz">circle area: ' + esc(sl.toLowerCase()) + '</span>'
      + swatch
      + (rd.third ? '<span class="bkey btx">text: ' + esc(rd.third[0]) + '</span>' : '')
      + '</div>'
      + svg
      + '<p class="s-sub wide" style="--fs:17px;margin-top:16px">Each circle is one company. '
      + 'Circle AREA is ' + esc(sl.toLowerCase()) + ', not its width.'
      + (ringed ? ' ' + ringed + ' with no positive ' + esc(sl.toLowerCase())
        + ' are drawn as rings at the smallest size.' : '')
      + ' A dashed edge sits outside the axis range and is pinned to it.'
      // The counts can only describe the companies the figure was drawn for —
      // it rides the name, and not every circle is named. Saying "of the
      // companies named" is the difference between a count and a claim about
      // the whole screen.
      + (rd.third ? ' The figure under each name is ' + esc(rd.third[0])
        + '. Of the companies named,' + (rd.note() || ' all report it.') : '')
      + '</p></div></div>' + chromeFoot();
  }

  // ---- Flow: where the value sits, and how each sector has done ----------
  //
  // "I like the Sankey... Left side show the Composition of S&P by Industry,
  // Right side show the YTD Performance of that Industry" (the owner,
  // 2026-10-05), then "Just sector at the moment". Time is deliberately
  // dropped, so this is a ONE-STEP ALLUVIAL rather than the reference's
  // two-date Sankey -- which is also the only version this data supports:
  // the holdings table holds TWO days, so a composition-over-time chart has
  // nothing to flow between.
  //
  // PERFORMANCE IS THE DESTINATION, NEVER THE WIDTH, and that one decision
  // is the whole design. The tempting version starts a ribbon at share of
  // value and ends it at share of the GAIN, fanning wider or narrower -- and
  // it cannot be drawn: measured at industry grain, 50 of 112 industries have
  // a NEGATIVE contribution this year, the positives sum to +16.8% against a
  // basket of +13.5%, and a ribbon has no negative width, so 3.3 points would
  // have to be hidden. Market cap flows (always positive) and the return only
  // decides WHERE it lands. The chart is then conserved by construction:
  // every band is exactly the sum of the ribbons entering it.
  //
  // SECTOR, NOT INDUSTRY, and the owner chose that after the measurement.
  // At industry grain the top twelve are 63% of the index, so the "Other"
  // ribbon would be 37% -- the biggest element on the chart, and the one
  // that says least. Eleven sectors cover 100% with nothing pooled.
  const FLOW_BANDS = [
    ['ahead', 'Ahead of the index'],
    ['behind', 'Behind the index'],
    ['down', 'Down over the window'],
  ];
  // The artboard is always 1080 wide and its body 952 (less the 64px
  // gutters), so each row of three tracks sums to 952.
  //
  // THE LEFT TRACK IS SIZED BY THE LONGEST SECTOR NAME, measured rather than
  // chosen: there are exactly ELEVEN sector names, the set is fixed, and the
  // longest -- "Communication Services" -- DRAWS 197px at the label's own
  // 17px. So an ellipsis here is a width bug rather than the unavoidable
  // thing it is on a company name, which is arbitrarily long. The track has
  // to hold that 197 plus the return beside it; the story's bigger type
  // needs more, which is why these follow the artboard.
  // MEASURED on the real card with the real faces, not estimated: an
  // off-page probe that copies a computed cssText onto a bare span does not
  // carry the font, which this project has been caught by once already.
  //   left  = "Communication Services" (197px at 17px) + 10 gap + the return
  //           (57px) + 4 padding + the 16px offset = 284, so 292.
  //   right = the sub "N sectors - NN% of the value" (220px at 15px), which
  //           is the WIDER of the two lines -- "Down over the window" needs
  //           211 -- plus 16 + 4 = 240, so 252. At 240 the box was 220 dead
  //           on and every band's sub wrapped mid-phrase ("of the / value").
  const FLOW_TRACKS = {
    portrait: { lw: 292, rw: 252 },
    square: { lw: 292, rw: 252 },
    story: { lw: 316, rw: 264 },
  };
  // DRILLED, THE LEFT TRACK HAS TO HOLD AN INDUSTRY NAME, and those are
  // nearly twice as long as a sector's: 40 characters at the top
  // ("Drug Manufacturers - Specialty & Generic", "Utilities - Independent
  // Power Producers") against "Communication Services"' 22. So the drill
  // gets its own tracks and its own type size -- the svg narrows, which an
  // alluvial can afford far more easily than a clipped label can.
  // ONE SET FOR ALL THREE ARTBOARDS, and the story does NOT get bigger type
  // here as it does in the sector view. Measured: at the story's own sizes
  // the two tracks need 417 + 292 = 709 of the body's 952, leaving 243px of
  // horizontal run for a 1120px-tall drawing -- ribbons so steep the chart
  // stops reading. Nothing requires the type to grow with the height, and
  // the drawing is the card.
  //   left  = longest industry name at 15px (289px, "Drug Manufacturers -
  //           Specialty & Generic") + 10 gap + the return (57) + 4 + 16 = 376
  //   right = the sub "N industries - NN% of value" (239px at 15px), which
  //           is wider than "Down over the window" (211) -- and wider than
  //           the sector view's own sub, because "industries" is four
  //           characters longer than "sectors". 239 + 20 = 259.
  const FLOW_TRACKS_DRILL = {
    portrait: { lw: 380, rw: 268 },
    square: { lw: 380, rw: 268 },
    story: { lw: 380, rw: 268 },
  };
  // FOURTEEN, and both halves of it are measured -- see the note in the
  // builder. Named here because it is the number the artboard arithmetic
  // depends on, not a display preference.
  const FLOW_MAX_ROWS = 14;
  const FLOW_NW = 13;    // the node bar itself
  // Measured per artboard by the fit sweep, not chosen: everything above the
  // drawing (kicker, two-line title) and below it (the note) is variable, so
  // a single constant is a guess at variable content.
  const FLOW_H = { portrait: 660, square: 402, story: 1120 };
  const FLOW_GAP = 6;    // between sector nodes
  const FLOW_MIN = 18;   // the floor a node is drawn at, however small it is

  function tplFlow() {
    const per = SNAP_PERIODS.some(([k]) => k === O.flowPeriod) ? O.flowPeriod : 'ytd';
    const [field, perLabel] = MOV_PERIODS[per];
    // "has done past week" is not English. The catalogue's labels already
    // carry their own determiner, so only the rolling ones need a preposition.
    const phrase = /^past /.test(perLabel) ? 'over the ' + perLabel : perLabel;
    const cut = SP_CUTS.some(([k]) => k === O.flowSp500) ? O.flowSp500 : 'in';
    // THE DRILL IS SECTOR-SCOPED AND THE SECTOR IS MANDATORY (the owner,
    // 2026-10-05: "do the industry drill down, Sector has to be mandatory
    // selection"). One control, so there is no invalid state to guard: the
    // industry view is simply unreachable without naming a sector.
    //
    // A FLAT INDUSTRY VIEW IS NOT OFFERED AND COULD NOT BE DRAWN. Measured:
    // 138 industries, of which the top twelve are 63% of the index -- so the
    // pooled tail would be 37% and the biggest element on the chart. Inside
    // ONE sector the same pooling is a genuine tail (see FLOW_MAX_ROWS).
    //
    // NOT CHECKED AGAINST A LIST, deliberately -- unlike the period and the
    // S&P cut, which are enums this module owns. A sector name is the
    // PROVIDER's taxonomy arriving as free text on the row, so eleven
    // hardcoded names would refuse a twelfth the day one was added. A name
    // that matches no row falls through to the empty state, which says so
    // by name; silently drawing the eleven-sector card instead would be the
    // quiet wrong answer.
    const drillSec = (O.flowSector && O.flowSector !== 'All') ? String(O.flowSector) : null;

    // The index funds and the eleven sector funds come out FIRST. A fund that
    // IS a sector, sitting inside that sector's own aggregate, double-counts
    // it -- the trap /consolidated and the Snapshot card both record. They
    // carry a real market cap (a fund reports AUM), so nothing else here
    // would have excluded them.
    let pool = spFilter(
      stocks.filter((x) => x && !IS_BENCH.has(x.symbol) && !IS_SECTOR_ETF.has(x.symbol)), cut);
    if (drillSec) pool = pool.filter((x) => x.sector === drillSec);
    // ONE COMPANY, ONE LISTING, and before anything is weighted — see
    // foldListings. Both classes sit in the same sector, so an unfolded
    // Alphabet inflates Communication Services' share of the value AND its
    // cap-weighted return: measured, the sector reads 2.05 points high.
    const folded0 = foldListings(pool, field);
    pool = folded0.rows;
    const capOf = (x) => (Number(x.marketCap) > 0 ? Number(x.marketCap) : 0);
    // Two exclusions and they are DIFFERENT rules. A missing return is
    // ABSENT, never zero -- Number(null) is 0 and finite, and a fabricated
    // flat company drags a weighted mean. A company with no market cap
    // carries no weight at all; `> 0` rejects null and zero in one test.
    // The -99 floor keeps a total wipeout out of the begin-weight divide.
    const scored = pool.filter((x) => capOf(x) > 0 && x[field] != null && x[field] > -99);
    // A BLANK GROUP IS NOT A GROUP, and it has to leave before the reference
    // is struck rather than after. A stock whose profile has not been pulled
    // yet belongs in no band -- the rule /pivot and /consolidated both keep
    // -- so if it still counted toward the reference return the card would
    // be measuring N parts against a basket that holds N+1 things. Measured
    // on the sectors, that is a gap of up to 0.10pt; it is zero this way,
    // and the parts then sum to the whole EXACTLY. The dropped rows are
    // named in the note rather than disappearing.
    //
    // DRILLED, THE KEY IS THE INDUSTRY -- and a stock can have a sector and
    // no industry yet, since both arrive with the same profile but the
    // taxonomy has been filled at different times. So the test is the key
    // this card is actually grouping by, never `sector` twice.
    const gkey = drillSec ? 'industry' : 'sector';
    const live = scored.filter((x) => x[gkey]);
    const nosec = scored.length - live.length;

    // BEGINNING WEIGHTS, so the parts sum to the basket's own return. Today's
    // weight times the window's return does NOT, and that is not a rounding
    // difference: measured on the index's own members, the end-weighted
    // parts overstate the basket by 24.6 points over the year and 15.7 this
    // year, because a winner has already grown into the weight being applied
    // to it. The start weight is reconstructed as cap / (1 + r/100), which
    // assumes an unchanged share count -- an approximation worth stating and
    // the only one available, since no share count is stored per date.
    const capEnd = live.reduce((a, x) => a + capOf(x), 0);
    const capBeg = live.reduce((a, x) => a + capOf(x) / (1 + x[field] / 100), 0);
    // THE REFERENCE IS WHATEVER THE CARD IS DIVIDING UP, which when drilled
    // is the SECTOR and not the index. The left column is then share of
    // Technology's value, so a right half measured against the S&P would
    // join two ends of one ribbon that describe different wholes -- exactly
    // the inconsistency that rules out reading the sector funds. It also
    // keeps the identity: the industries' begin-weighted returns sum to the
    // sector's own return, as the sectors' sum to the index's.
    const index = capBeg ? (capEnd / capBeg - 1) * 100 : 0;

    const agg = new Map();
    for (const x of live) {
      const beg = capOf(x) / (1 + x[field] / 100);
      const a = agg.get(x[gkey]) || { n: 0, end: 0, beg: 0, wr: 0 };
      a.n++; a.end += capOf(x); a.beg += beg; a.wr += beg * x[field];
      agg.set(x[gkey], a);
    }
    const total = [...agg.values()].reduce((a, s) => a + s.end, 0);
    let secs = [...agg.entries()].map(([name, a]) => ({
      name, n: a.n, cap: a.end, beg: a.beg, wr: a.wr,
      wt: a.end / total * 100, ret: a.beg ? a.wr / a.beg : 0,
    })).sort((a, b) => b.cap - a.cap);

    // ---- the tail, drilled only -------------------------------------------
    // FOURTEEN ROWS, measured rather than chosen. Two things set it:
    //   * the SQUARE's column is 402px, and 19 rows cannot even be drawn at
    //     the 18px floor (19 x 18 = 342 against 294 available), so the chart
    //     would overflow its own artboard;
    //   * at 14, NINE of the eleven sectors show every industry they have,
    //     and the two that do not pool 4.1% (Industrials, 6 industries) and
    //     1.7% (Consumer Cyclical, 5). That is a genuine tail. At 10 it is
    //     14.6% and 6.8%, which is a chart hiding its own content.
    // The pooled row is a real basket with a real cap-weighted return, so it
    // is banded like any other and conservation still holds exactly.
    let pooled = 0;
    if (drillSec && secs.length > FLOW_MAX_ROWS) {
      const keep = secs.slice(0, FLOW_MAX_ROWS - 1);
      const rest = secs.slice(FLOW_MAX_ROWS - 1);
      pooled = rest.length;
      const e = rest.reduce((a, s) => a + s.cap, 0);
      const b = rest.reduce((a, s) => a + s.beg, 0);
      const wr = rest.reduce((a, s) => a + s.wr, 0);
      secs = keep.concat([{
        name: pooled + ' smaller industries', pooledRow: true,
        n: rest.reduce((a, s) => a + s.n, 0),
        cap: e, beg: b, wr, wt: e / total * 100, ret: b ? wr / b : 0,
      }]);
    }

    const cutWord = cut === 'in' ? 'The S&P 500'
      : cut === 'out' ? 'Outside the S&P 500' : 'The whole screen';
    // Drilled, the reference is the sector -- named generically rather than
    // by name, because the title and the kicker already say which sector and
    // "Ahead of Communication Services" would not fit the band's own track.
    const refWord = drillSec ? 'the sector' : cut === 'in' ? 'the index' : 'the screen';
    const partWord = drillSec ? 'industry' : 'sector';
    const partsWord = drillSec ? 'industries' : 'sectors';
    // "A industry that fell" -- caught by eye on the drilled card, not by an
    // assertion. The article has to follow the word it precedes.
    const aPart = (drillSec ? 'An ' : 'A ') + partWord;

    if (!secs.length || !total) {
      // FOUR DIFFERENT REASONS TO BE EMPTY, and a card that names the wrong
      // one is worse than one that says nothing: a posted picture has no
      // picker beside it, so this sentence is the reader's only explanation.
      // The first draft branched on the CUT rather than the CAUSE and told
      // somebody whose holdings file was perfectly fine that it had never
      // been imported. Found by looking at the rendered card; every
      // assertion had passed.
      const why = !pool.length
        ? (drillSec
          ? 'No stock in ' + esc(drillSec) + ' is ' + (cut === 'out' ? 'outside the index' : 'in this cut') + '.'
          : cut === 'in'
            ? 'No stock here has been matched against the index yet — no holdings file has been imported.'
            : cut === 'out'
              ? 'Every stock on the screen is in the index.'
              : 'There is nothing on the screen to draw.')
        : !live.length
          ? 'No stock here has a reading ' + esc(phrase) + ' yet.'
          : 'No stock here has ' + (drillSec ? 'an industry' : 'a sector') + ' recorded yet.';
      return chromeTop() + '<div class="s-body"><div class="fl-in">' +
        `<span class="s-kick">${esc(drillSec || cutWord)}</span>` +
        '<h2 class="s-title">Where the value sits</h2>' +
        `<p class="s-empty">${why}</p></div></div>` + chromeFoot();
    }

    // THE ORDER OF THESE THREE TESTS IS WHAT KEEPS THE PALETTE HONEST, and it
    // is not label hygiene. `r < 0` is asked FIRST, so every part in Ahead or
    // Behind is non-negative BY CONSTRUCTION -- which is what makes green
    // always mark a part that rose and red always one that fell, exactly the
    // meanings those two colours carry on every other surface here. Ask
    // "ahead" first instead and a window with a negative reference paints a
    // sector that lost money green.
    //
    // RELATIVE TO THE WHOLE RATHER THAN FIXED BANDS, measured over all five
    // windows the picker offers. Fixed cuts (>30 / 15-30 / 0-15 / down)
    // COLLAPSE: on a single day they put TEN OF ELEVEN sectors in one band
    // holding 98% of the value, which is a chart that says nothing. The
    // relative split never degenerates -- 3 bands today, 3 over a week, 2
    // over a month, 3 this year, 3 over a year -- and it needs no threshold
    // that goes stale.
    const bandOf = (r) => (r < 0 ? 'down' : r > index ? 'ahead' : 'behind');
    secs.forEach((s) => { s.band = bandOf(s.ret); });

    const H = FLOW_H[size.id] || FLOW_H.portrait;
    const TRS = drillSec ? FLOW_TRACKS_DRILL : FLOW_TRACKS;
    const TR = TRS[size.id] || TRS.portrait;
    const W = 952 - TR.lw - TR.rw;
    const n = secs.length;
    const avail = H - FLOW_GAP * (n - 1);

    // A SMALL PART STILL HAS TO BE VISIBLE, and the floor is marked rather
    // than silent -- the Size card's rule, where a disc under 14px is drawn
    // at the floor and says so. Basic Materials is 1.4% of the index, which
    // on this column is seven pixels: thinner than the label beside it, and
    // too thin for a ribbon to be followed. The shortfall is taken back from
    // the slack ABOVE the floor in proportion, so the distortion lands on the
    // big nodes, where it is a few percent, rather than on the small ones,
    // where it would be everything.
    //
    // THE FLOOR ITSELF HAS A CEILING, because n x FLOW_MIN can exceed the
    // column: 19 industries at 18px is 342 against the square's 294, and
    // the card would have overflowed its own artboard rather than merely
    // looked cramped. FLOW_MAX_ROWS keeps that unreachable today; this is
    // the guard that makes it unreachable at any row count.
    const floor = Math.min(FLOW_MIN, avail / n);
    let hs = secs.map((s) => s.wt / 100 * avail);
    const need = hs.reduce((a, h) => a + Math.max(0, floor - h), 0);
    const floored = hs.filter((h) => h < floor).length;
    if (need > 0) {
      const slack = hs.reduce((a, h) => a + Math.max(0, h - floor), 0);
      hs = hs.map((h) => (h < floor ? floor
        : slack > need ? h - (h - floor) * (need / slack) : floor));
    }
    secs.forEach((s, i) => { s.h = hs[i]; });

    // LEFT: cap descending, which is what composition is read as. The pooled
    // row is already last by construction and stays there even though its
    // combined cap can exceed a named one above it -- it is the tail, and
    // sorting it up into the middle would read as an industry.
    let y = 0;
    secs.forEach((s) => { s.y = y; y += s.h + FLOW_GAP; });

    // RIGHT: the bands in order, each the exact sum of the ribbons entering
    // it, with the gaps opened so both columns span the same H. A band keeps
    // its parts in the LEFT column's order, which is what stops the ribbons
    // crossing each other more than the data makes them.
    const bands = FLOW_BANDS
      .map(([key, label]) => {
        const mine = secs.filter((s) => s.band === key);
        return {
          key, label: drillSec ? label.replace('the index', 'the sector') : label,
          mine, h: mine.reduce((a, s) => a + s.h, 0),
          wt: mine.reduce((a, s) => a + s.wt, 0),
        };
      })
      .filter((b) => b.mine.length);
    const bodyH = bands.reduce((a, b) => a + b.h, 0);
    const bGap = bands.length > 1 ? Math.max(FLOW_GAP, (H - bodyH) / (bands.length - 1)) : 0;
    let by = 0;
    bands.forEach((b) => {
      b.y = by;
      let inner = by;
      b.mine.forEach((s) => { s.ry = inner; inner += s.h; });
      by += b.h + bGap;
    });

    const colOf = { ahead: pal.up, behind: pal.flat, down: pal.down };
    const x0 = FLOW_NW;
    const x1 = W - FLOW_NW;
    const xc = (x0 + x1) / 2;
    const f1 = (v) => v.toFixed(1);
    const ribbon = (s) => `M${x0},${f1(s.y)} C${xc},${f1(s.y)} ${xc},${f1(s.ry)} ${x1},${f1(s.ry)}`
      + ` L${x1},${f1(s.ry + s.h)} C${xc},${f1(s.ry + s.h)} ${xc},${f1(s.y + s.h)} ${x0},${f1(s.y + s.h)} Z`;

    // Biggest first, so a thin ribbon is never buried under a thick one it
    // crosses.
    const paths = secs.slice().sort((a, b) => b.h - a.h).map((s) =>
      `<path d="${ribbon(s)}" fill="${colOf[s.band]}" fill-opacity="0.32"></path>`).join('');
    const lNodes = secs.map((s) =>
      `<rect x="0" y="${f1(s.y)}" width="${FLOW_NW}" height="${f1(s.h)}" rx="2" fill="${colOf[s.band]}"></rect>`).join('');
    const rNodes = bands.map((b) =>
      `<rect x="${x1}" y="${f1(b.y)}" width="${FLOW_NW}" height="${f1(b.h)}" rx="2" fill="${colOf[b.key]}"></rect>`).join('');

    // HTML LABELS OVER THE DRAWING, NEVER SVG TEXT -- the rule every chart in
    // this module follows, because the artboard is scaled to the window and
    // a glyph inside a stretched svg is distorted with it.
    const lLabs = secs.map((s) =>
      `<span class="fl-lab${s.pooledRow ? ' fl-rest' : ''}" style="top:${f1(s.y + s.h / 2)}px">` +
      `<b>${esc(s.name)}</b><i class="${s.ret >= 0 ? 'up' : 'dn'}">${pct(s.ret)}</i></span>`).join('');
    const rLabs = bands.map((b) =>
      `<span class="fl-lab fl-blab" style="top:${f1(b.y + b.h / 2)}px">` +
      `<b class="fl-${b.key}">${esc(b.label)}</b>` +
      `<i>${b.mine.length} ${b.mine.length === 1 ? partWord : partsWord} · ` +
      `${b.wt.toFixed(0)}% of value</i></span>`).join('');

    // NO COUNT IS WRITTEN DOWN HERE. The first draft said "the eleven parts
    // add up to the whole" -- true of the index and wrong of every other cut,
    // and the sort of thing that reads perfectly well while being false.
    //
    // Nor does it claim they DO add up, which they do: that is an identity a
    // reader cannot check off this card, because the weights it would need
    // are the START weights and the percentages drawn are today's share --
    // the SEC ratio card's rule, that a figure on screen has to be checkable
    // against another figure on screen. So the note explains the choice.
    const note = 'Each ribbon is one ' + partWord + ', as thick as its share of market value, and it '
      + 'lands in the band its own cap-weighted return ' + esc(phrase) + ' puts it in — against '
      + esc(refWord) + '’s ' + pct(index) + '. ' + aPart + ' that fell is Down whatever '
      + esc(refWord) + ' did. Returns weight each company by what it was worth at the START of the '
      + 'window rather than today, since a winner has already grown into today’s weight; they are '
      + 'computed over the companies here rather than taken from the sector funds, which hold a '
      + 'different basket.'
      + (pooled ? ' The ' + pooled + ' smaller industries are pooled into one ribbon, together '
        + secs[secs.length - 1].wt.toFixed(1) + '% of the sector.' : '')
      + (nosec ? ' ' + (nosec === 1 ? 'One company has' : nosec + ' companies have')
        + ' no ' + partWord + ' recorded and so sit' + (nosec === 1 ? 's' : '') + ' in no band.' : '')
      + (floored ? ' The ' + (floored === 1 ? 'smallest ribbon carries' : floored + ' smallest ribbons carry')
        + ' a minimum thickness, so ' + (floored === 1 ? 'it can' : 'they can') + ' still be followed.' : '')
      + foldNote(folded0.folded).replace(/ $/, '');

    return chromeTop() +
      '<div class="s-body"><div class="fl-in">' +
      `<span class="s-kick">${esc(drillSec ? drillSec + ' · ' + cutWord : cutWord)}` +
      ` · ${live.length.toLocaleString()} companies · $${fmtMoney(total)}</span>` +
      '<h2 class="s-title">Where the value sits<br><span class="dim">' +
      esc('and how each ' + partWord + ' has done ' + phrase) + '</span></h2>' +
      `<div class="fl-wrap${drillSec ? ' fl-drill' : ''}" style="height:${H}px">` +
      `<div class="fl-side" style="width:${TR.lw}px">${lLabs}</div>` +
      `<svg class="fl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      paths + lNodes + rNodes + '</svg>' +
      `<div class="fl-side fl-r" style="width:${TR.rw}px">${rLabs}</div>` +
      '</div>' +
      `<p class="s-sub wide" style="--fs:18px">${note}</p>` +
      '</div></div>' + chromeFoot();
  }

  // ---- the histogram: the shape of the whole screen on one measure ------
  //
  // THE ONE SHAPE THIS STUDIO COULD NOT DRAW. Every other data card is a
  // ranking (movers), a relationship (bubble, fund), a time series (chart,
  // evolution) or a composition (flow, size). None answers "what does the
  // whole screen look like on this measure" -- which is also what makes a
  // single stock's reading mean anything, and is why the two modes are one
  // template: `stock` is `screen` with a subject marked on it.
  //
  // THE BINNING IS PER MEASURE AND FIXED, never derived from the data. A
  // range taken from today's own percentiles moves every time the card is
  // drawn, so two posts a week apart would not be comparable -- and the
  // range is most of what a histogram asserts. Each entry was set against
  // the live distribution rather than guessed.
  //
  // `openLo` / `openHi` mark an END BIN THAT COLLECTS EVERYTHING BEYOND IT.
  // That is the trap specific to this chart: drawn without saying so, the
  // overflow piles against the edge and reads as a real mode. Measured on
  // the live screen, forward P/E has 125 values outside a 0-60 window and
  // revenue growth 81. An open end is labelled with a sign and counted in
  // the note.
  //
  // `signed` colours the bars by which side of zero they are on, and is
  // TRUE only where zero is a direction a reader already reads that way --
  // returns, margins, growth. It is false for everything whose values are
  // all one sign (a column negative on every row says nothing by being
  // red -- the Bad day rule) and false for `peerPe`, because this project
  // measured that cheap-against-peers is not good: the cheapest third of
  // each industry has the worse growth, margin, ROE and Quality, so a green
  // bar there would be the card asserting the opposite of its own data.
  const HIST_MEASURES = [
    ['pctFromAth', 'How far below its own record', 'the record being the highest close since the archive begins',
      { lo: -95, hi: 0, bins: 19, unit: '%', dp: 1, openLo: true }],
    ['badDay', 'What a bad day looks like', 'the worst 5% of its own daily moves, over the past year',
      { lo: -14, hi: 0, bins: 14, unit: '%', dp: 1, openLo: true }],
    ['range52Pos', 'Where each one sits in its 52-week range', '0 is the low, 100 is the high',
      { lo: 0, hi: 100, bins: 20, unit: '', dp: 0 }],
    // Binned against the live distribution like every entry here, not
    // guessed: the whole screen runs p5 -29.6, p25 -12.1, median -2.8,
    // p75 +7.8, p95 +36.7, so +/-50 in 4-point bins holds about 96% of it
    // and the peak lands just below zero. SIGNED, because the sign IS the
    // reading -- above or below its own average is the whole question, and
    // this is the one measure here where zero is a named line rather than
    // an arbitrary point.
    ['vs200ma', 'How far above or below its 200-day',
      'the latest close against the average of the last 200 sessions',
      { lo: -50, hi: 50, bins: 25, unit: '%', dp: 1, openLo: true, openHi: true, signed: true }],
    ['qualityRating', 'The Quality score', 'company fundamentals, 1 to 10',
      { lo: 1, hi: 11, bins: 10, unit: '', dp: 0, discrete: true }],
    ['peerPe', 'Price against its own industry', '1.00 is what the typical company in that industry costs',
      { lo: 0, hi: 2.5, bins: 25, unit: '×', dp: 2, openHi: true }],
    ['todayPct', "Today's move", 'close to close, every company on the screen',
      { lo: -6, hi: 6, bins: 24, unit: '%', dp: 1, openLo: true, openHi: true, signed: true }],
    ['oneWeekPct', 'The past week', 'five sessions, close to close',
      { lo: -12, hi: 12, bins: 24, unit: '%', dp: 1, openLo: true, openHi: true, signed: true }],
    ['ytdPct', 'The year so far', 'since last year’s close',
      { lo: -60, hi: 120, bins: 24, unit: '%', dp: 1, openLo: true, openHi: true, signed: true }],
    ['oneYearPct', 'The past year', 'about 253 sessions, close to close',
      { lo: -60, hi: 150, bins: 21, unit: '%', dp: 1, openLo: true, openHi: true, signed: true }],
    ['profitMargin', 'Profit margin', 'what reaches the bottom line',
      { lo: -40, hi: 60, bins: 25, unit: '%', dp: 1, openLo: true, openHi: true, signed: true }],
    ['revenueGrowthYoY', 'Revenue growth', 'the latest quarter against a year earlier',
      { lo: -40, hi: 80, bins: 24, unit: '%', dp: 1, openLo: true, openHi: true, signed: true }],
    ['rsi', 'RSI', 'the 14-day reading, 30 and 70 being the usual marks',
      { lo: 10, hi: 90, bins: 20, unit: '', dp: 0, openLo: true, openHi: true }],
    // POSITIONING, which is neither a return nor a fundamental, so the two
    // sit at the end rather than among either. Binned against the live
    // distribution like every entry here: short % of float runs p10 1.4,
    // median 4.7, p90 14.2, and 1.4% of the screen is past 30 -- so 30 with
    // an open top, in 2-point bins, and the peak lands at 2-4%. Days to
    // cover runs p10 2.1, median 4.2, p90 8.2 with 0.6% past 15, and the
    // bins are whole days because that is the unit it is read in.
    //
    // UNCOLOURED, both of them. `signed` is for a measure whose zero is a
    // direction; these are all one sign, and red on a column that is
    // negative nowhere says nothing by being red -- the Bad day rule. It
    // would also be the card taking a view on whether being shorted is bad,
    // which is the one thing this template must not do.
    //
    // A SHARE CLASS CAN REPORT MORE SHORTS THAN ITS FLOAT HOLDS, and the
    // read path withholds those (SHORT_PCT_MAX in server.js) -- so what
    // reaches this card is already sane, and the long tail here is real.
    ['shortPctFloat', 'How much of each one is sold short',
      'as a share of the float, reported about every fortnight',
      { lo: 0, hi: 30, bins: 15, unit: '%', dp: 0, openHi: true }],
    ['shortRatio', 'How long the shorts would take to cover',
      'short interest against one normal day of volume',
      { lo: 0, hi: 15, bins: 15, unit: '', dp: 0, openHi: true, unitWord: 'day' }],
  ];
  const HIST_BY = {};
  for (const [k, t, s, c] of HIST_MEASURES) HIST_BY[k] = { key: k, title: t, sub: s, cfg: c };

  // The plot's own height per artboard, measured rather than chosen, the way
  // the flow card's is. Everything else on the card is fixed furniture.
  const HG_H = { portrait: 520, square: 330, story: 980 };
  // A distribution over a handful of rows is not a distribution. Below this
  // the card says so rather than drawing a row of single-count spikes.
  const HG_MIN = 30;

  function tplHistogram() {
    const m = HIST_BY[O.histMeasure] || HIST_BY.pctFromAth;
    const C = m.cfg;
    const mode = O.histMode === 'stock' ? 'stock' : 'screen';
    const sc = scopeOf('histScope', 'histSector');

    // A fund has no fundamentals and reports AUM as a market cap, so it is
    // not a company and does not belong in a distribution OF companies --
    // the rule /consolidated, the Snapshot card and the flow card all keep.
    const pool = sc.rows.filter((x) => x && !IS_BENCH.has(x.symbol) && !IS_SECTOR_ETF.has(x.symbol));
    const val = (r) => {
      const v = Number(r && r[m.key]);
      return r && r[m.key] != null && isFinite(v) ? v : null;
    };
    const vals = [];
    for (const r of pool) { const v = val(r); if (v != null) vals.push(v); }
    const blank = pool.length - vals.length;

    if (vals.length < HG_MIN) {
      return chromeTop() + '<div class="s-body"><div class="hg-in">' +
        `<span class="s-kick">${esc(sc.label)}</span>` +
        `<h2 class="s-title">${esc(m.title)}</h2>` +
        `<p class="s-sub wide" style="--fs:20px">${esc(
          vals.length ? 'Only ' + vals.length + ' of these ' + pool.length
            + ' companies have a reading for this, which is too few to show a shape. '
            + 'A distribution needs at least ' + HG_MIN + '.'
            : 'None of these ' + pool.length + ' companies has a reading for this yet.')}</p>` +
        '</div></div>' + chromeFoot();
    }

    const sorted = vals.slice().sort((a, b) => a - b);
    const qt = (p) => {
      const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
      return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
    };
    const med = qt(0.5);

    const step = (C.hi - C.lo) / C.bins;
    const counts = new Array(C.bins).fill(0);
    let belowLo = 0, aboveHi = 0;
    for (const v of vals) {
      if (v < C.lo) belowLo++;
      if (v > C.hi) aboveHi++;
      let k = Math.floor((v - C.lo) / step);
      if (k < 0) k = 0;
      if (k >= C.bins) k = C.bins - 1;
      counts[k]++;
    }
    const top = Math.max(...counts) || 1;

    // The subject, in `stock` mode. Its percentile is the payload -- "where
    // does it sit" is a question about rank, not about the value, which the
    // row already carries. Worded NEUTRALLY: higher than N% of the screen is
    // a fact, and whether higher is better is the reader's to decide.
    let subj = null;
    if (mode === 'stock') {
      const want = String(O.histSym || '').toUpperCase();
      const row = pool.find((x) => x.symbol === want) || stocks.find((x) => x.symbol === want) || null;
      const v = row ? val(row) : null;
      if (row && v != null) {
        let under = 0;
        for (const x of vals) if (x < v) under++;
        subj = {
          sym: row.symbol, name: nameOf(row), v,
          pct: Math.round(under / vals.length * 100),
          // where the pin sits along the axis, clamped into the drawn range
          at: Math.min(100, Math.max(0, (v - C.lo) / (C.hi - C.lo) * 100)),
          off: v < C.lo || v > C.hi,
          inPool: pool.indexOf(row) >= 0,
        };
      } else if (row) {
        subj = { sym: row.symbol, name: nameOf(row), v: null };
      }
    }

    const fmt = (v) => (v == null ? '—'
      : (C.signed && v > 0 ? '+' : '') + v.toFixed(C.dp) + C.unit);

    // Bars. HTML rather than SVG, deliberately: the artboard is scaled to the
    // window, and a stretched SVG distorts every glyph inside it -- which is
    // why every chart in this module keeps its labels in HTML. A histogram is
    // rectangles and text, so it needs no SVG at all.
    //
    // THE AXIS IS ZERO-BASED, AND THAT IS THE OPPOSITE OF THE EVOLUTION
    // CARD'S RULE. A bar is read as a quantity measured from the baseline, so
    // a truncated one is the classic misleading chart; a LINE carries no such
    // claim, which is why that card may use its data's own range and this one
    // may not. Do not "fix" this to match it.
    const bw = 100 / C.bins;
    const bars = counts.map((n, i) => {
      const a = C.lo + i * step, b = a + step;
      const mid = (a + b) / 2;
      const h = n / top * 100;
      const cls = C.signed ? (b <= 0 ? ' dn' : a >= 0 ? ' up' : '') : '';
      const hit = subj && subj.v != null && !subj.off
        && subj.v >= a && (i === C.bins - 1 ? subj.v <= b : subj.v < b);
      const lab = (C.openLo && i === 0 ? '≤' + (C.lo + step).toFixed(0)
        : C.openHi && i === C.bins - 1 ? '≥' + C.hi.toFixed(0)
          : C.discrete ? String(Math.round(a)) : mid.toFixed(0));
      return `<div class="hg-b${cls}${hit ? ' hit' : ''}" style="width:${bw}%">` +
        `<span class="hg-f" style="height:${h.toFixed(2)}%"></span></div>`;
    }).join('');

    // One label every few bars, or they collide. The ends are always named,
    // because an open end that is not labelled is the trap above.
    const every = C.bins > 20 ? 4 : C.bins > 12 ? 3 : 2;
    const ticks = counts.map((n, i) => {
      const show = i === 0 || i === C.bins - 1 || i % every === 0;
      if (!show) return `<span class="hg-t" style="width:${bw}%"></span>`;
      const a = C.lo + i * step;
      const t = C.openLo && i === 0 ? '≤' + Math.round(C.lo + step)
        : C.openHi && i === C.bins - 1 ? '≥' + Math.round(C.hi - step)
          : String(Math.round(a));
      return `<span class="hg-t" style="width:${bw}%">${esc(t + (C.unit === '%' ? '' : ''))}</span>`;
    }).join('');

    const medAt = Math.min(100, Math.max(0, (med - C.lo) / (C.hi - C.lo) * 100));

    const kick = [sc.label, vals.length.toLocaleString() + ' companies'].join(' · ');
    const title = mode === 'stock' && subj
      ? 'Where ' + subj.name + ' sits'
      : m.title;
    const subtitle = mode === 'stock' && subj
      ? m.title.charAt(0).toLowerCase() + m.title.slice(1) + ', against ' + sc.label
      : m.sub;

    const stats = mode === 'stock' && subj && subj.v != null
      ? [[subj.sym, fmt(subj.v)],
         ['higher than', subj.pct + '% of them'],
         ['the middle one', fmt(med)]]
      : [['the middle one', fmt(med)],
         ['one in ten below', fmt(qt(0.10))],
         ['one in ten above', fmt(qt(0.90))]];

    const ends = [];
    if (C.openLo && belowLo) ends.push(belowLo + ' beyond the left edge');
    if (C.openHi && aboveHi) ends.push(aboveHi + ' beyond the right');

    // A UNIT PLURALISED UNCONDITIONALLY reads "Each bar is 1 points",
    // which is the bin width most of these measures use.
    //
    // AND "point" WAS HARDCODED IN THE step === 1 BRANCH, which no measure
    // reached until days-to-cover arrived with whole-day bins: it read
    // "Each bar is 1 point" for a count of days. The Flow card's "a industry
    // that fell", in a third place. `unitWord` is the measure's own noun;
    // without one the wording is exactly what it was, which is asserted
    // rather than assumed -- every existing entry is checked unchanged.
    const w = C.unitWord || 'point';
    const wide = C.discrete ? 'one point'
      : step === 1 ? '1 ' + w
        : step.toFixed(step < 1 ? 1 : 0)
          + ((C.unit === '%' || C.unitWord) ? ' ' + w + 's' : ' wide');
    const note = 'Each bar is ' + wide
      + ' and counts the companies whose reading falls in it; the axis starts at zero, as a '
      + 'count of things must.'
      + (ends.length ? ' ' + ends.join(' and ') + ' ' + (ends.length > 1 || (belowLo + aboveHi) > 1
        ? 'are' : 'is') + ' drawn in the end ' + (ends.length > 1 ? 'bars' : 'bar') + '.' : '')
      + (blank ? ' ' + blank.toLocaleString() + ' of these ' + pool.length.toLocaleString()
        + ' have no reading for it yet.' : '')
      + (subj && subj.v == null ? ' ' + esc(subj.sym) + ' has no reading for this, so nothing is marked.' : '')
      + (subj && subj.off ? ' ' + esc(subj.sym) + ' sits beyond the drawn range, so the mark is at the edge.' : '')
      + (subj && subj.inPool === false ? ' ' + esc(subj.sym) + ' is not itself in this group.' : '')
      + ' A distribution describes the screen as it is today. It is not a forecast.';

    const H = HG_H[size.id] || HG_H.portrait;

    return chromeTop() +
      '<div class="s-body"><div class="hg-in">' +
      `<span class="s-kick">${esc(kick)}</span>` +
      `<h2 class="s-title">${esc(title)}<span class="dim">${esc(subtitle)}</span></h2>` +
      '<div class="hg-wrap">' +
      `<div class="hg-plot" style="height:${H}px">` +
        `<span class="hg-med" style="left:${medAt.toFixed(2)}%"></span>` +
        `<span class="hg-medlab" style="left:${medAt.toFixed(2)}%">middle</span>` +
        (subj && subj.v != null
          ? `<span class="hg-pin" style="left:${subj.at.toFixed(2)}%"></span>` +
            `<span class="hg-flag${subj.at > 82 ? ' rt' : subj.at < 18 ? ' lf' : ''}"
              style="left:${subj.at.toFixed(2)}%">` +
            `${esc(subj.sym)} <b>${esc(fmt(subj.v))}</b></span>`
          : '') +
        `<div class="hg-bars">${bars}</div>` +
      '</div>' +
      `<div class="hg-axis">${ticks}</div>` +
      `<div class="hg-stats">${stats.map(([k, v]) =>
        `<div class="hg-s"><span class="hg-k">${esc(k)}</span>` +
        `<span class="hg-v">${esc(v)}</span></div>`).join('')}</div>` +
      '</div>' +
      `<p class="s-sub wide" style="--fs:18px">${note}</p>` +
      '</div></div>' + chromeFoot();
  }

  // ---- the index, broken into the parts that made its move --------------
  //
  // SHARED BY THE TREEMAP AND THE WATERFALL, because they are two readings
  // of one arithmetic and two copies would drift the first time either was
  // tuned. The treemap wants the pool, the sectors and the index return; the
  // waterfall wants the per-name contributions as well.
  //
  // CONTRIBUTION IS BEGIN-WEIGHTED. The Flow card settled this: today's
  // weight times the window's return overstates the basket by 24.6 points
  // over a year and 15.7 this year, because a winner has already grown into
  // the weight being applied to it. The begin weight is reconstructed as
  // cap / (1 + r/100), which assumes an unchanged share count -- the only
  // approximation available, since no share count is stored per date.
  // Measured on the live index: the parts then sum to its own return with a
  // gap of 0.0000 at every window.
  //
  // SIZED BY OUR OWN MARKET CAP, NEVER THE FUND'S PUBLISHED WEIGHT. A
  // weighted constituent list is the issuer's dataset -- which is why
  // /holdings is admin-only and why the screener carries only a Yes/No. A
  // promo card is the most public surface in this app, so it uses the
  // provider's market cap, which is our own data and visually identical at
  // the sizes a tile is drawn at.
  // ONE COMPANY, ONE LISTING — and it has to be a MERGE rather than a drop.
  //
  // THE PROVIDER REPEATS EVERY COMPANY-LEVEL FIGURE AGAINST EACH SHARE CLASS
  // and varies only the price. Measured on the live screen: GOOGL and GOOG
  // carry the SAME 12,229.9M shares and the same 10,879.4M float, and BRK.B
  // carries a cap/share of 748,362 against a $506 price — which is BRK.A's.
  // So a class's market cap is the WHOLE company's share count times THAT
  // class's own price, and neither class's figure is its own value.
  //
  // THEREFORE THE MEAN, NEVER THE SUM. cap is W x price_now and the begin
  // weight is W x price_then, so the mean across the classes is W x the mean
  // class price: the company itself, exactly when the classes are equally
  // sized and inside the bracket always. Summing is the double count that
  // put Alphabet on the waterfall twice and $4.2T of phantom value into the
  // S&P's total. A float-weighted mean would be better and is NOT available
  // — the float is the whole company's on every class too, measured.
  //
  // THE KEY IS THE FILER ID AND NOT THE DISPLAY NAME. OWL and OBDC are both
  // "Blue Owl Capital" and are two different companies (CIK 1823945 against
  // 1655888), so a name key merges a real holding away — the same judgement
  // /adjustedbacktest's btOneEach made, on this same data.
  //
  // btOneEach DROPS a class, which is right for a book you hold and wrong
  // here: these cards must still sum to the index.
  function foldListings(rows, field) {
    const groups = new Map();
    const order = [];
    for (const r of rows) {
      const cik = r && r.symbol != null ? filers[String(r.symbol).toUpperCase()] : null;
      // No filer id, never folded. An under-catch, which is the safe
      // direction, and why the two dead renamed tickers (SQ/XYZ, FI/FISV —
      // neither dead half has a CIK stored) are left as they are.
      if (!cik) { order.push([r]); continue; }
      const k = 'c' + cik;
      const g = groups.get(k);
      if (g) g.push(r);
      else { const fresh = [r]; groups.set(k, fresh); order.push(fresh); }
    }
    let folded = 0;
    const out = order.map((g) => {
      if (g.length < 2) return g[0];
      folded += g.length - 1;
      return mergeListings(g, field);
    });
    return { rows: out, folded };
  }

  // ONE SENTENCE, THREE CARDS. The fold is the same fact wherever it
  // happens, and a reader who knows Alphabet has two tickers is owed the
  // reason the card shows one. Silent would be the wrong answer twice over:
  // it looks like a missing company, and it hides the approximation.
  const foldNote = (n) => (n ? ' Share classes are combined: '
    + (n === 1 ? 'one company here reports' : n + ' companies here report')
    + ' the whole company’s value against each class, so both would count it '
    + 'twice. ' : '');

  function mergeListings(rs, field) {
    // THE SYMBOL IS THE ALPHABETICALLY FIRST, which is deterministic and
    // stable. Largest cap is the obvious pick and is NOT stable: the caps
    // are struck at different price vintages, so GOOG leads GOOGL today on
    // a day when GOOGL is the higher-priced of the two. Only the waterfall
    // shows a ticker at all; the treemap tile carries the company name,
    // which both classes already share.
    const alpha = (list) => list.slice().sort((a, b) => (String(a.symbol) < String(b.symbol) ? -1
      : String(a.symbol) > String(b.symbol) ? 1 : 0))[0];
    const usable = [];
    let cap = 0, beg = 0;
    for (const r of rs) {
      const c = Number(r.marketCap);
      const v = Number(r[field]);
      if (!(c > 0) || r[field] == null || !(v > -99)) continue;
      const b = c / (1 + v / 100);
      if (!(b > 0) || !isFinite(b)) continue;
      cap += c; beg += b; usable.push(r);
    }
    // A class with no usable reading is CONSUMED rather than counted: it
    // must not return as a second row, and it must not drag the mean. It
    // does not get to name the bar either -- the ticker on the axis should
    // be one whose own figures are the ones drawn.
    if (!usable.length) return alpha(rs);
    const lead = alpha(usable);
    const n = usable.length;
    const mc = cap / n;
    const mb = beg / n;
    return Object.assign({}, lead, { marketCap: mc, [field]: (mc / mb - 1) * 100 });
  }

  function marketParts(rows, field) {
    // Folded BEFORE anything is summed, or the index itself double-counts.
    const fold = foldListings(rows, field);
    const list = [];
    let beg = 0, end = 0, noCap = 0, noRet = 0;
    for (const r of fold.rows) {
      const cap = Number(r && r.marketCap);
      // Two exclusions, and they are DIFFERENT rules. A missing return is
      // ABSENT, never zero -- Number(null) is 0 and finite, and a fabricated
      // flat company drags a weighted mean. A company with no market cap
      // carries no weight at all; `> 0` rejects null and zero in one test.
      if (!(cap > 0)) { noCap++; continue; }
      if (r[field] == null || !(Number(r[field]) > -99)) { noRet++; continue; }
      const ret = Number(r[field]);
      // The -99 floor keeps a total wipeout out of the begin-weight divide:
      // at -100% the reconstruction is a division by zero and at -99.9 it is
      // a thousand times the company's own value. The MIN_VOL lesson, where
      // a near-zero divisor produced a 3,227,535x position.
      const b = cap / (1 + ret / 100);
      if (!(b > 0) || !isFinite(b)) { noRet++; continue; }
      beg += b; end += cap;
      list.push({ sym: r.symbol, name: nameOf(r), sector: r.sector || null,
        industry: r.industry || null, cap, ret, b });
    }
    if (!list.length) {
      return { list: [], index: null, beg: 0, end: 0, noCap, noRet, total: 0, folded: fold.folded };
    }
    for (const x of list) x.c = (x.b / beg) * x.ret;
    return { list, index: (end / beg - 1) * 100, beg, end, noCap, noRet, total: end,
      folded: fold.folded };
  }

  // The pool every market card starts from. The index funds and the eleven
  // sector funds come out FIRST: a fund that IS a slice of the market,
  // sitting inside that market's own aggregate, double-counts it -- the trap
  // /consolidated, the Snapshot and the Flow card all record. They carry a
  // real market cap (a fund reports AUM), so nothing else here would have
  // excluded them.
  function marketPool(cut) {
    return spFilter(stocks.filter((x) => x && !x.error
      && !IS_BENCH.has(x.symbol) && !IS_SECTOR_ETF.has(x.symbol)), cut);
  }
  // Prose, as against SP_CUT_LABEL, which titles a kicker.
  const cutWords = (cut) => (cut === 'in' ? 'the S&P 500'
    : cut === 'out' ? 'the stocks outside the S&P 500' : 'the whole screen');
  const cutKick = (cut) => SP_CUT_LABEL[cut] || 'The whole screen';

  // HOW STRONG A COLOUR A RETURN EARNS, PER WINDOW -- and it is FIXED rather
  // than taken from the day's own spread, for the histogram's reason: a
  // scale that moves with the data makes two posts a week apart
  // incomparable, and on a coloured map the scale is most of what the card
  // asserts. Beyond it the colour clamps and the note counts how many.
  const HEAT = { d: 4, w1: 8, m1: 15, ytd: 50, y1: 60 };

  // ---- the treemap -------------------------------------------------------
  //
  // AREA IS SIZE AND COLOUR IS RETURN, and that is forced rather than
  // chosen. The obvious encoding -- area = contribution -- CANNOT BE DRAWN:
  // measured on the index over the past month, 365 of 503 members contribute
  // NEGATIVELY, and area has no sign. Taking the absolute value instead
  // makes the tiles sum to 6.8 points against an index of 1.4, a five-fold
  // overstatement with nothing on the card to say so. The Flow card met the
  // same wall and answered it the same way: the signed quantity becomes the
  // colour, never the extent.
  //
  // Contribution is then area TIMES colour, which is exactly what makes
  // narrowness visible -- a handful of enormous bright tiles in a field of
  // red. The waterfall is the card that can add that up; this is the card
  // that can show its shape.
  // MEASURED AGAINST PRODUCTION’S OWN 502 ROWS, not chosen: the story
  // was 17px over at 1180. 1148 leaves ~15px against a floor of 20 that
  // the note’s own length can move, so the suite asserts the overflow
  // rather than the number.
  const TM_H = { portrait: 700, square: 468, story: 1148 };
  // Below these a tile cannot carry a ticker or a number legibly, so it is
  // drawn and left unlabelled rather than labelled illegibly. The note says
  // how many, because a map whose small tiles are blank should say that is a
  // property of the space rather than of the data.
  const TM_LABEL = 30, TM_VAL = 52;

  // Squarified treemap (Bruls, Huizing and van Wijk, 2000). A row is grown
  // while the WORST aspect ratio in it keeps improving, which is what stops
  // a treemap of 500 tiles degenerating into slivers -- a naive
  // slice-and-dice is unreadable at this count.
  function squarify(items, X, Y, W, H, out) {
    if (!items.length || !(W > 0) || !(H > 0)) return;
    const sum = items.reduce((a, it) => a + it.v, 0);
    if (!(sum > 0)) return;
    const scale = (W * H) / sum;
    const v = items.map((it) => Math.max(0, it.v) * scale);
    const worst = (row, side) => {
      const s = row.reduce((a, q) => a + q, 0);
      if (!(s > 0) || !(side > 0)) return Infinity;
      const mx = Math.max.apply(null, row), mn = Math.min.apply(null, row);
      if (!(mn > 0)) return Infinity;
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    let i = 0, x = X, y = Y, w = W, h = H;
    while (i < v.length && w > 0.5 && h > 0.5) {
      const vert = w >= h;              // a row runs down the shorter side
      const side = Math.min(w, h);
      let row = [v[i]], j = i + 1, best = worst(row, side);
      while (j < v.length) {
        const next = row.concat([v[j]]);
        const r = worst(next, side);
        if (r > best) break;
        row = next; best = r; j++;
      }
      const s = row.reduce((a, q) => a + q, 0);
      const thick = s / side;
      if (!(thick > 0)) break;
      let p = vert ? y : x;
      for (let k = 0; k < row.length; k++) {
        const len = row[k] / thick;
        if (vert) out.push({ it: items[i + k], x, y: p, w: thick, h: len });
        else out.push({ it: items[i + k], x: p, y, w: len, h: thick });
        p += len;
      }
      if (vert) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      i = j;
    }
    // A degenerate remainder is DROPPED rather than stacked at zero size,
    // which would pile tiles on top of each other in one corner and read as
    // a drawing fault. The count on the card is what is drawn.
  }

  function tplTreemap() {
    const per = SNAP_PERIODS.some(([k]) => k === O.tmapPeriod) ? O.tmapPeriod : 'ytd';
    const [field, perLabel] = MOV_PERIODS[per];
    const phrase = /^past /.test(perLabel) ? 'over the ' + perLabel : perLabel;
    const cut = SP_CUTS.some(([k]) => k === O.tmapSp500) ? O.tmapSp500 : 'in';
    // NOT CHECKED AGAINST A LIST, the Flow card's rule: a sector name is the
    // PROVIDER's taxonomy arriving as free text on the row, so a hardcoded
    // set would refuse a twelfth the day one was added. A name matching no
    // row falls through to the empty state, which says so by name.
    const drill = (O.tmapSector && O.tmapSector !== 'All') ? String(O.tmapSector) : null;

    let pool = marketPool(cut);
    if (drill) pool = pool.filter((x) => x.sector === drill);
    const P = marketParts(pool, field);
    const H = TM_H[size.id] || TM_H.portrait;
    const W = 952;

    if (!P.list.length) {
      const why = !pool.length
        ? (drill
          ? 'No stock in ' + drill + ' is in this cut.'
          : cut === 'in'
            ? 'No stock here has been matched against the index yet — no holdings '
              + 'file has been imported.'
            : cut === 'out' ? 'Every stock on the screen is in the index.'
              : 'There is nothing on the screen to draw.')
        : 'Nothing here has both a market value and a reading ' + phrase + '.';
      return chromeTop() + '<div class="s-body"><div class="tm-in">' +
        `<span class="s-kick">${esc(drill || cutKick(cut))}</span>` +
        '<h2 class="s-title">The market, by size</h2>' +
        `<p class="s-empty">${esc(why)}</p></div></div>` + chromeFoot();
    }

    // ---- two levels: sectors, then the companies inside each -------------
    // A FLAT MAP OF 500 TILES HAS NO ORDER A READER CAN USE, and nesting is
    // also what removes the tail problem. Measured: pooling everything
    // outside the top 40 would make "the rest" 37% of the area and the
    // biggest single thing on the chart -- the Flow card's own measurement,
    // and the reason it refuses a flat industry view. Nested, every member
    // is drawn and nothing is pooled.
    //
    // DRILLED, THE GROUPING IS THE INDUSTRY. A stock can carry a sector and
    // no industry yet, since both arrive with the same profile and the
    // taxonomy has been filled at different times -- so the blank bucket is
    // kept rather than dropped, and named with an em-dash.
    const gkey = drill ? 'industry' : 'sector';
    const bySec = new Map();
    for (const x of P.list) {
      const k = x[gkey] || '—';
      if (!bySec.has(k)) bySec.set(k, []);
      bySec.get(k).push(x);
    }
    const secs = [...bySec.entries()].map(([name, xs]) => ({
      name, xs: xs.slice().sort((a, b) => b.cap - a.cap),
      v: xs.reduce((a, x) => a + x.cap, 0),
    })).sort((a, b) => b.v - a.v);

    const HEAD = size.id === 'square' ? 19 : size.id === 'story' ? 28 : 23;
    const blocks = [];
    squarify(secs.map((s) => ({ v: s.v, s })), 0, 0, W, H, blocks);

    const tiles = [];
    for (const b of blocks) {
      const s = b.it.s;
      // A HEADER STRIP IS ONLY DRAWN WHERE IT LEAVES ROOM FOR THE COMPANIES
      // UNDER IT. Basic Materials is 1.4% of the index, so on the square its
      // block is barely taller than the strip itself -- a header there would
      // BE the sector, and the tiles it is labelling would be invisible.
      const strip = (b.h >= HEAD * 2.4 && b.w >= 90) ? HEAD : 0;
      const kids = [];
      squarify(s.xs.map((x) => ({ v: x.cap, x })), b.x + 1, b.y + strip,
        Math.max(0, b.w - 2), Math.max(0, b.h - strip - 1), kids);
      tiles.push({ sec: s, box: b, strip, kids });
    }

    const heat = HEAT[per] || 20;
    let clamped = 0, labelled = 0, drawn = 0;
    const cell = (k) => {
      const x = k.it.x;
      const t = Math.max(-1, Math.min(1, x.ret / heat));
      if (Math.abs(x.ret) > heat) clamped++;
      drawn++;
      // A TINT OVER THE GROUND, never a solid colour -- and that is what
      // makes one label rule serve all four grounds. A tint keeps the tile
      // on its own ground's side of the lightness range, so --text reads on
      // every one of them: near-white on a dark green over black, near-black
      // on a light green over white. A solid fill would need a second
      // palette and a per-tile contrast decision.
      const a = (10 + Math.abs(t) * 42).toFixed(1);
      const col = t >= 0 ? pal.up : pal.down;
      const lab = k.w >= TM_LABEL && k.h >= TM_LABEL;
      const val = k.w >= TM_VAL && k.h >= TM_VAL;
      if (lab) labelled++;
      return `<div class="tm-c" style="left:${k.x.toFixed(1)}px;top:${k.y.toFixed(1)}px;`
        + `width:${Math.max(0, k.w - 1).toFixed(1)}px;`
        + `height:${Math.max(0, k.h - 1).toFixed(1)}px;`
        + `background:color-mix(in srgb, ${col} ${a}%, transparent)">`
        + (lab ? `<span class="tm-s">${esc(x.sym)}</span>` : '')
        + (val ? `<span class="tm-r">${esc(pct(x.ret, 1))}</span>` : '')
        + '</div>';
    };

    const body = tiles.map((t) => {
      const b = t.box;
      return `<div class="tm-sec" style="left:${b.x.toFixed(1)}px;top:${b.y.toFixed(1)}px;`
        + `width:${Math.max(0, b.w - 1).toFixed(1)}px;`
        + `height:${Math.max(0, b.h - 1).toFixed(1)}px">`
        + (t.strip ? `<span class="tm-h" style="height:${t.strip}px;`
          + `line-height:${t.strip}px">${esc(t.sec.name)}</span>` : '')
        + '</div>' + t.kids.map(cell).join('');
    }).join('');

    const note = 'Every tile is one company: the area is its market value and the '
      + 'colour is what it did ' + phrase + '. Contribution is the two together, '
      + 'which is why a few bright tiles can carry an index while most of it is '
      + 'red — area alone cannot show that, because a fall has no negative '
      + 'size. Sized by market value rather than by index weight, and the colour '
      + 'scale is fixed at ±' + heat + '% so two of these are comparable. '
      + (clamped ? clamped + ' moved further and are drawn at full strength. ' : '')
      + (drawn - labelled > 0 ? (drawn - labelled) + ' of ' + drawn
        + ' are too small to name. ' : '')
      // A TILE UNDER HALF A PIXEL IS NOT DRAWN AT ALL, and until the
      // fixture grew a company worth a two-thousandth of its map that
      // went UNSAID: the kicker counts members and the map counts tiles,
      // so a reader was told 502 companies and shown 500. It cannot be
      // floored -- a minimum size would distort the one thing the card
      // encodes -- so it is counted instead, the Size card's bargain.
      + (P.list.length - drawn > 0 ? (P.list.length - drawn)
        + ' are too small to draw at all. ' : '')
      + (P.noCap ? P.noCap + ' have no market value and are left out. ' : '')
      + foldNote(P.folded).replace(/^ /, '')
      + 'Not a forecast.';

    return chromeTop() +
      '<div class="s-body"><div class="tm-in">' +
      `<span class="s-kick">${esc((drill || cutKick(cut))
        + ' · ' + P.list.length.toLocaleString() + ' companies · $'
        + fmtMoney(P.total))}</span>` +
      `<h2 class="s-title">${esc(drill ? drill + ', by size' : 'The market, by size')}` +
      `<span class="dim">${esc('area is market value, colour is ' + phrase
        + ' · ' + (drill ? 'the sector ' : 'the index ') + pct(P.index, 1))}</span></h2>` +
      `<div class="tm-wrap" style="height:${H}px">${body}</div>` +
      '<div class="tm-key">' +
      `<span class="tm-kl">${esc('−' + heat + '%')}</span>` +
      '<span class="tm-kb" style="background:linear-gradient(to right,'
      + ` color-mix(in srgb, ${pal.down} 52%, transparent),`
      + ` color-mix(in srgb, ${pal.down} 10%, transparent),`
      + ` color-mix(in srgb, ${pal.up} 10%, transparent),`
      + ` color-mix(in srgb, ${pal.up} 52%, transparent))"></span>` +
      `<span class="tm-kl">${esc('+' + heat + '%')}</span></div>` +
      `<p class="s-sub wide" style="--fs:17px">${esc(note)}</p>` +
      '</div></div>' + chromeFoot();
  }

  // ---- the waterfall -----------------------------------------------------
  //
  // THE SHAPE THE TREEMAP CANNOT BE, and the reason both exist. Narrowness
  // is a claim about CONTRIBUTION, contribution is signed, and a waterfall
  // is the one chart that takes signed parts and still closes: the steps run
  // from zero, the pooled remainder absorbs everything not named, and the
  // last bar is the index's own return. The parts add up to the whole on the
  // card, where a reader can check them.
  // MEASURED, not chosen -- and the story was 9px over at 1050, which the
  // card suite caught and neither sweep could: the ground sweep measures
  // colour and the width sweep measures the horizontal. 1020 leaves ~39px,
  // against a floor of 20 (half a text line, the how-to deck’s standard).
  // 4px of room is luck rather than headroom.
  // RE-MEASURED when the fold added a sentence to the note: a FIXED chart
  // height against a VARIABLE note is the fault, and this card's note is
  // the module's longest. At 392/1020 the square ran 22px past the artboard
  // and the story 63px — onto the tagline, found by eye on the live card
  // because no fixture passed a filer map and so no sweep could see the
  // sentence. The chart is the free parameter, and 8% of a story's plot is
  // invisible where a note printed over the brand is not. Clearance now
  // 20px+, the half-a-text-line floor the how-to deck already holds.
  //
  // MEASURED AGAINST PRODUCTION'S OWN SECTORS, NOT THE FIT SWEEP'S FIXTURE.
  // The fixture's note is shorter than the real ones -- 346/934 passed the
  // sweep and the LIVE portrait card still ran 15px over. The worst real cut
  // is Communication Services at 3 a side (a 614-character note), and these
  // are its overflow plus the 20px floor.
  const WF_H = { portrait: 565, square: 308, story: 851 };

  function tplWaterfall() {
    const per = SNAP_PERIODS.some(([k]) => k === O.wfallPeriod) ? O.wfallPeriod : 'ytd';
    const [field, perLabel] = MOV_PERIODS[per];
    const phrase = /^past /.test(perLabel) ? 'over the ' + perLabel : perLabel;
    const cut = SP_CUTS.some(([k]) => k === O.wfallSp500) ? O.wfallSp500 : 'in';
    const drill = (O.wfallSector && O.wfallSector !== 'All') ? String(O.wfallSector) : null;
    const K = Math.max(3, Math.min(10, parseInt(O.wfallCount, 10) || 6));

    let pool = marketPool(cut);
    if (drill) pool = pool.filter((x) => x.sector === drill);
    const P = marketParts(pool, field);
    const H = WF_H[size.id] || WF_H.portrait;

    if (!P.list.length || P.index == null) {
      const why = !pool.length
        ? (drill ? 'No stock in ' + drill + ' is in this cut.'
          : cut === 'in'
            ? 'No stock here has been matched against the index yet — no holdings '
              + 'file has been imported.'
            : cut === 'out' ? 'Every stock on the screen is in the index.'
              : 'There is nothing on the screen to draw.')
        : 'Nothing here has both a market value and a reading ' + phrase + '.';
      return chromeTop() + '<div class="s-body"><div class="wf-in">' +
        `<span class="s-kick">${esc(drill || cutKick(cut))}</span>` +
        '<h2 class="s-title">What moved the index</h2>' +
        `<p class="s-empty">${esc(why)}</p></div></div>` + chromeFoot();
    }

    const up = P.list.filter((x) => x.c > 0).sort((a, b) => b.c - a.c);
    const dn = P.list.filter((x) => x.c < 0).sort((a, b) => a.c - b.c);
    // TOP K EACH SIDE, never top 2K by magnitude. Ordered by |contribution|
    // the two signs interleave and the chart is a jagged fence; this way it
    // rises, then falls, then closes, which is the shape the reader is meant
    // to take off it.
    const picked = up.slice(0, K).concat(dn.slice(0, K));
    const named = new Set(picked.map((x) => x.sym));
    const rest = P.list.filter((x) => !named.has(x.sym));
    const restC = rest.reduce((a, x) => a + x.c, 0);

    const steps = picked.map((x) => ({ k: x.sym, v: x.c }));
    if (rest.length) steps.push({ k: 'REST', v: restC, pool: true, n: rest.length });

    // THE TOTAL IS NOT A STEP. It is drawn from zero, because it is the
    // thing the steps add up TO -- drawn as one more step it would read as
    // another contributor and the chart would not close. It gets no outgoing
    // connector for the same reason.
    let run = 0;
    const laid = steps.map((s) => { const a = run; run += s.v; return { s, a, b: run }; });
    // The scale has to cover the running path AND the total, or the closing
    // bar runs off the top of a chart the path itself fits inside.
    const lo = Math.min(0, P.index, ...laid.map((l) => Math.min(l.a, l.b)));
    const hi = Math.max(0, P.index, ...laid.map((l) => Math.max(l.a, l.b)));
    const span = (hi - lo) || 1;
    const Y = (v) => ((hi - v) / span) * H;

    const n = steps.length + 1;
    const cw = 952 / n;                       // one column, in px
    // The ticker and the value are sized FROM THE COLUMN rather than fixed,
    // because K moves between 3 and 10 and the column halves across that
    // range. A five-character ticker at 15px needs ~50px; below that it is
    // set smaller, and below 40px the value is dropped rather than
    // overlapping its neighbour -- the treemap's own labelling rule.
    const kFs = Math.max(9, Math.min(16, Math.round(cw * 0.26)));
    const vFs = Math.max(10, Math.min(15, Math.round(cw * 0.23)));
    const showV = cw >= 40;
    const pcw = 100 / n;

    const col = (i, inner) =>
      `<div class="wf-col" style="left:${(i * pcw).toFixed(4)}%;`
      + `width:${pcw.toFixed(4)}%">${inner}</div>`;

    const bar = (l, i) => {
      const top = Y(Math.max(l.a, l.b)), bot = Y(Math.min(l.a, l.b));
      const cls = l.s.pool ? 'pool' : l.s.v >= 0 ? 'up' : 'dn';
      // THE CONNECTOR IS THE PROOF THE CHART CLOSES, not decoration: it runs
      // at the level the running total has reached, and the one leaving the
      // last step lands exactly on the top of the total bar. If the
      // arithmetic were wrong, that line would miss.
      const con = `<span class="wf-con" style="top:${Y(l.b).toFixed(1)}px"></span>`;
      return col(i,
        (showV ? `<span class="wf-v" style="bottom:${(H - top + 7).toFixed(1)}px;`
          + `font-size:${vFs}px">${esc(pct(l.s.v, 2))}</span>` : '')
        + `<span class="wf-b ${cls}" style="top:${top.toFixed(1)}px;`
        + `height:${Math.max(3, bot - top).toFixed(1)}px"></span>`
        + con
        + `<span class="wf-k" style="font-size:${kFs}px">${esc(l.s.k)}</span>`);
    };

    const tTop = Y(Math.max(0, P.index)), tBot = Y(Math.min(0, P.index));
    const total = col(n - 1,
      (showV ? `<span class="wf-v tot" style="bottom:${(H - tTop + 7).toFixed(1)}px;`
        + `font-size:${vFs}px">${esc(pct(P.index, 2))}</span>` : '')
      + `<span class="wf-b tot ${P.index >= 0 ? 'up' : 'dn'}" `
      + `style="top:${tTop.toFixed(1)}px;height:${Math.max(3, tBot - tTop).toFixed(1)}px">`
      + '</span>'
      + `<span class="wf-k tot" style="font-size:${kFs}px">INDEX</span>`);

    // THE NARROWNESS NUMBER, which is what the card is for: how many of the
    // risers it takes before their contributions alone cover the whole net
    // move, everything below them cancelling out. Measured on the live index
    // over the past month that is FOUR, out of 503.
    let acc = 0, need = 0;
    if (P.index > 0) { for (const x of up) { acc += x.c; need++; if (acc >= P.index) break; } }

    const stats = [
      [drill ? 'the sector' : cut === 'in' ? 'the index' : 'the screen', pct(P.index, 2)],
      ['top ' + up.slice(0, K).length + ' added',
        pct(up.slice(0, K).reduce((a, x) => a + x.c, 0), 2)],
      ['fell', dn.length.toLocaleString() + ' of ' + P.list.length.toLocaleString()],
    ];
    if (P.index > 0 && need) stats.push(['carry the whole move', need.toLocaleString()]);

    const note = 'Each step is one company’s contribution: its share of the '
      + 'market at the start of the window, times what it did. They run from zero '
      + 'and the last bar is the index itself, so the parts add up to the whole '
      + '— which is the thing a treemap cannot do, because a fall has no '
      + 'negative area. '
      + (P.index > 0 && need
        ? (need === 1 ? 'The biggest alone covers the whole net move; everything '
            + 'below it cancels out. '
          : 'The ' + need + ' biggest alone cover the whole net move; everything below '
            + 'them cancels out. ') : '')
      + (rest.length ? 'REST is the other ' + rest.length.toLocaleString()
        + ' together. ' : '')
      + 'Begin-of-window weights, so a company is not credited with the size it '
      + 'grew into. '
      + foldNote(P.folded).replace(/^ /, '')
      + 'Not a forecast.';

    return chromeTop() +
      '<div class="s-body"><div class="wf-in">' +
      `<span class="s-kick">${esc((drill || cutKick(cut))
        + ' · ' + P.list.length.toLocaleString() + ' companies')}</span>` +
      `<h2 class="s-title">${esc('What moved ' + (drill || cutWords(cut)))}` +
      `<span class="dim">${esc('every company’s contribution ' + phrase
        + ', in points of the ' + (drill ? 'sector' : 'index'))}</span></h2>` +
      `<div class="wf-wrap" style="height:${H}px">` +
        `<span class="wf-zero" style="top:${Y(0).toFixed(1)}px"></span>` +
        laid.map(bar).join('') + total +
      '</div>' +
      `<div class="wf-stats">${stats.map(([k, v]) =>
        `<div class="wf-s"><span class="wf-sk">${esc(k)}</span>`
        + `<span class="wf-sv">${esc(v)}</span></div>`).join('')}</div>` +
      `<p class="s-sub wide" style="--fs:17px">${esc(note)}</p>` +
      '</div></div>' + chromeFoot();
  }

  // WHERE THE SHORTS MOVED — the fortnight's biggest builds and covers.
  //
  // THE ONE THING THE APP COULD NOT SHOW. Every other short-interest surface
  // is a LEVEL: the Ownership column, the /stock card, the two histogram
  // measures. This is the CHANGE, which is the half that is news, and it is
  // the only card here fed by the FINRA archive rather than the snapshot.
  //
  // A FACT ABOUT POSITIONING, NEVER A VERDICT. Heavy short interest is a
  // bearish bet and also the fuel for a squeeze, so the card reports what
  // moved and says in as many words that it is not a forecast — the line
  // /terms draws, and the one this dataset makes easiest to cross.
  const SMOV_METRICS = {
    dv: 'by what the change is worth',
    pct: 'by how much each position changed',
  };
  const SMOV_FLOORS = { 0: 'any size', 1e8: '$100M+', 2.5e8: '$250M+',
    5e8: '$500M+', 1e9: '$1B+' };

  // Asked of the module by BOTH hosts, for the reason `basketDays` and
  // `evolutionNeed` exist: the pairing was a hardcoded list in each of them
  // once, and that is how the spotlight shipped drawing nothing at all.
  function shortMovesNeed(tpl) {
    return tpl === 'shortmoves';
  }

  function tplShortMoves() {
    const d = getShortMoves();
    if (!d) {
      return chromeTop() + '<div class="s-body"><div class="s-empty">'
        + 'Reading the short-interest archive…</div></div>' + chromeFoot();
    }

    const metric = SMOV_METRICS[O.smovMetric] ? O.smovMetric : 'dv';
    const cut = SP_CUTS.some(([k]) => k === O.smovSp500) ? O.smovSp500 : 'All';
    const floor = SMOV_FLOORS[O.smovFloor] != null ? Number(O.smovFloor) : 2.5e8;
    const K = Math.max(3, Math.min(12, Number(O.smovCount) || 8));
    // THE CAP IS PER ARTBOARD, measured rather than chosen: a card cannot
    // scroll, and eight a side ran the SQUARE 66px past its own artboard
    // and the note 61px onto the tagline. The Snapshot card’s own rule,
    // and the control stays honest because these are the top N of a
    // ranking — trimming the seventh and eighth biggest is not the
    // misstatement a dropped treemap tile would be.
    //
    // MEASURED COUNT BY COUNT, one row inside each artboard’s own limit:
    // the portrait fits 9 and leaves 9px, which is under the 20px floor
    // this module holds everywhere; the square fits exactly 6 (a seventh
    // row costs 59px against 51 left); and the story fits 11 and is 4px
    // over at 12. The story’s band cannot be read as headroom because
    // its rows spread to fill -- there the honest test is the overflow.
    const CAP = { portrait: 8, square: 6, story: 10 }[size.id] || 8;
    const N = Math.min(K, CAP);

    // The index and sector funds come out, the rule every market card here
    // keeps. It matters most on THIS one: measured on the live fortnight the
    // dollar ranking is led by SPY at $13.7B and IWM at $5.1B, which is a
    // statement about hedging the whole market rather than about a company,
    // and it would crowd out every real name on the card.
    const pool = spFilter(stocks.filter((x) => x && !x.error
      && !IS_BENCH.has(x.symbol) && !IS_SECTOR_ETF.has(x.symbol)), cut);

    const rows = [];
    let added = 0, removed = 0, built = 0, covered = 0, tooSmall = 0;
    for (const r of pool) {
      const m = d.moves && d.moves[r.symbol];
      if (!m) continue;
      const a = Number(m[0]), b = Number(m[1]), px = Number(r.price);
      if (!(a > 0) || !(b > 0) || !(px > 0)) continue;
      // THE FLOOR IS ON THE POSITION, NOT ON THE MOVE. A percentage change
      // in a tiny position is enormous and says nothing; measured, the
      // dollar ranking is self-flooring (its top and bottom eight all sit
      // above $4.3B) and the percentage one is not — which is why one
      // control serves both rather than the floor being wired to a metric.
      if (b * px < floor) { tooSmall++; continue; }
      const dv = (b - a) * px;
      if (dv >= 0) { added += dv; built++; } else { removed += -dv; covered++; }
      rows.push({ sym: r.symbol, name: nameOf(r), pct: (b / a - 1) * 100, dv });
    }

    if (rows.length < 4) {
      return chromeTop() + '<div class="s-body"><div class="s-empty">' + esc(!d.to
        ? 'No short-interest readings are stored yet.'
        : rows.length + ' of ' + pool.length + ' companies in this cut hold a position over $'
          + fmtMoney(floor) + '. Widen the cut or drop the floor.')
        + '</div></div>' + chromeFoot();
    }

    const key = metric === 'pct' ? 'pct' : 'dv';
    const up = rows.filter((x) => x[key] > 0).sort((x, y) => y[key] - x[key]).slice(0, N);
    const dn = rows.filter((x) => x[key] < 0).sort((x, y) => x[key] - y[key]).slice(0, N);
    const scale = Math.max(1e-9,
      ...up.map((x) => Math.abs(x[key])), ...dn.map((x) => Math.abs(x[key])));

    // BLUE AND ORANGE, NEVER GREEN AND RED — and the precedent is this very
    // dataset. /stock's short-interest strip is neutral because "short
    // interest rose is not a direction the price went", and on a card green
    // would be asserting that being shorted is bad, which is a verdict and
    // also only half true: a build is a bearish bet AND the fuel for a
    // squeeze. This pair is the one the two-stock Chart card measured as the
    // only divergence that survives both common dichromacies (ΔE 102 at its
    // worst against the accent pair's 3), and neither hue carries a meaning
    // on this surface. Emitted INLINE through pal.ink rather than set in
    // CSS, which is what makes all four grounds resolve with no override.
    const CUP = pal.ink('#60a5fa');
    const CDN = pal.ink('#fb923c');

    const SZ = { portrait: { n: 19, f: 26, bar: 9, gap: 32 },
      square: { n: 16, f: 21, bar: 7, gap: 24 },
      story: { n: 26, f: 35, bar: 12, gap: 44 } }[size.id]
      || { n: 19, f: 26, bar: 9, gap: 32 };
    const fig = (x) => (metric === 'pct'
      ? (x.pct >= 0 ? '+' : '−') + Math.abs(x.pct).toFixed(0) + '%'
      : (x.dv >= 0 ? '+' : '−') + '$' + fmtMoney(Math.abs(x.dv)));
    const row = (x, c) => '<div class="sm-r">'
      + `<span class="sm-t" style="font-size:${SZ.n}px">${esc(x.sym)}</span>`
      + `<span class="sm-n" style="font-size:${SZ.n}px">${esc(x.name)}</span>`
      + `<span class="sm-v" style="font-size:${SZ.f}px;color:${c}">${esc(fig(x))}</span>`
      + `<span class="sm-bar" style="height:${SZ.bar}px">`
      + `<span class="sm-f" style="width:${(Math.abs(x[key]) / scale * 100).toFixed(1)}%;`
      + `background:${c}"></span></span>`
      + '</div>';
    const col = (list, c, head) => '<div class="sm-c">'
      + `<span class="sm-h" style="color:${c}">${esc(head)}</span>`
      + (list.length ? list.map((x) => row(x, c)).join('')
        : '<div class="sm-none">none this fortnight</div>')
      + '</div>';

    const net = added - removed;
    const stats = [
      ['added', '$' + fmtMoney(added)],
      ['taken off', '$' + fmtMoney(removed)],
      ['net', (net >= 0 ? '+' : '−') + '$' + fmtMoney(Math.abs(net))],
      ['built / covered', built + ' / ' + covered],
    ];

    // LOCAL NOON, never `new Date(iso)` — that is UTC midnight and renders a
    // day early west of Greenwich. The card-dating lesson, which `dateStr`
    // above already follows.
    const dayStr = (iso) => {
      if (!iso) return '';
      const t = new Date(iso + 'T12:00:00');
      return isNaN(t.getTime()) ? iso
        : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // THE WINDOW IS ON THE CARD'S FACE. This data is fortnightly and about
    // eight business days old when FINRA publishes it, so a card that does
    // not date itself implies a currency it does not have.
    const win = (d.from && d.to) ? dayStr(d.from) + ' to ' + dayStr(d.to) : 'the latest fortnight';
    const note = 'FINRA publishes short interest twice a month and it reaches us about eight '
      + 'business days after it settles, so this is the fortnight to ' + dayStr(d.to)
      + ' rather than today. '
      + (metric === 'pct'
        ? 'Ranked by how much each position changed, among those worth $' + fmtMoney(floor)
          + ' or more: a percentage of a tiny position says nothing. '
        : 'Ranked by what the change is worth at today’s price, which is a different question '
          + 'from how much it changed and gives different names. ')
      + ((d.counts && d.counts.splits)
        ? d.counts.splits + ' skipped over a split, FINRA not restating for one. ' : '')
      + 'A short position is a bet against, and also the fuel for a squeeze. Not a forecast.';

    return chromeTop()
      + '<div class="s-body"><div class="sm-in">'
      + `<span class="s-kick">${esc(cutKick(cut) + ' · ' + rows.length.toLocaleString()
        + ' companies · ' + win)}</span>`
      + '<h2 class="s-title">Where the shorts moved<span class="dim">'
      + esc('the fortnight’s biggest builds and covers, ' + SMOV_METRICS[metric])
      + '</span></h2>'
      + `<div class="sm-wrap" style="gap:${SZ.gap}px">`
        + col(up, CUP, 'BUILT') + col(dn, CDN, 'COVERED')
      + '</div>'
      + `<div class="sm-stats">${stats.map(([k, v]) =>
        `<div class="sm-s"><span class="sm-sk">${esc(k)}</span>`
        + `<span class="sm-sv">${esc(v)}</span></div>`).join('')}</div>`
      + `<p class="s-sub wide" style="--fs:17px">${esc(note)}</p>`
      + '</div></div>' + chromeFoot();
  }

  // ---- Most shorted: the level as last reported, beside the year so far ---
  //
  // THE SIBLING OF shortmoves, AND DELIBERATELY NOT A MODE OF IT. That card
  // is the fortnight's CHANGE; this is the LEVEL. Two different questions,
  // and the measurement says so twice over: ranked by % of float the S&P's
  // top eight are SWKS NCLH ECHO SMCI KMB PSKY LYV IT, and by days to cover
  // TROW SNA LNT LYV TPL KMB UNP IFF -- two names of eight in common.
  // Neither ranking stands for the other, which is why the metric is a
  // control rather than a decision taken once in here.
  const SHRT_METRICS = {
    pct: ['shortPctFloat', '% of float'],
    d2c: ['shortRatio', 'days to cover'],
  };
  const shrtFig = (v, k) => (v == null ? '—'
    : v.toFixed(1) + (k === 'pct' ? '%' : 'd'));

  // THE CAP IS PER ARTBOARD and MEASURED COUNT BY COUNT, with the note at
  // its LONGEST -- a row with no year of its own adds a sentence, and the
  // note is what the headroom is measured against. The portrait fits 8 and
  // leaves 75px while 10 runs 26px over; the square fits 6 with 42px and 8
  // runs 66px over; the story fits 10 with 50px and 12 runs 46px over. All
  // three clear the 20px floor this module holds everywhere -- 4px of
  // clearance is luck, not headroom. My own guess for the square was 5 and
  // the measurement said 6.
  //
  // Named rather than inline because an inline literal would be
  // BYTE-IDENTICAL to tplShortMoves', so a revert anchored on it hits twice
  // and is refused -- which reads as a broken harness rather than as the
  // one guard it is.
  const SHRT_CAP = { portrait: 8, square: 6, story: 10 };

  // WHY THE YEAR RIDES BESIDE IT -- the owner's ask, and also the finding.
  // Measured on the live screen: the S&P's eight most-shorted carry a median
  // YTD of -6.1% against +3.9% for the index itself, and the top twenty
  // -12.3%; across the whole screen the eight sit at -39.9% against +2.1%.
  // A 10- to 42-point gap, which is what earns the reference its place in
  // the strip -- a comparison whose two halves coincided would say nothing.
  //
  // AND IT IS NOT ONE-DIRECTIONAL, which is the half worth seeing: three of
  // those eight are UP, SWKS +30.0% and SMCI +48.3%. Heavily shorted and
  // falling is the shorts being right so far; heavily shorted and RISING is
  // them under water. The card draws both and forecasts neither -- the line
  // /terms draws, and the one this dataset makes easiest to cross.
  function tplShorted() {
    const mk = SHRT_METRICS[O.shrtMetric] ? O.shrtMetric : 'pct';
    const [field, mName] = SHRT_METRICS[mk];
    const ok2 = mk === 'pct' ? 'd2c' : 'pct';
    const [field2, mName2] = SHRT_METRICS[ok2];
    const sc = scopeOf('shrtScope', 'shrtSector');
    const K = Math.max(3, Math.min(12, Number(O.shrtCount) || 8));
    // A card cannot scroll, and a row here is two lines -- a text line and a
    // pair of bars -- so it is taller than a short-moves row. The control
    // stays honest because these are the top N of a ranking: trimming the
    // ninth is not the misstatement a dropped treemap tile would be. The
    // measurement behind SHRT_CAP is recorded where it is declared.
    const N = Math.min(K, SHRT_CAP[size.id] || 8);

    // Benchmarks and the eleven sector funds come out, the rule every market
    // card here keeps. BELT AND BRACES on this one, and measured rather than
    // assumed: 0 of the 24 funds on the screen carry EITHER reading, because
    // the vendor reports no float and no short ratio for a fund. It stays
    // because ONE upstream change flips it on -- a float for SPY would make
    // it the most-shorted thing on the screen by a distance, which is the
    // index-in-its-own-market error -- so its revert proving nothing today
    // is recorded rather than read as a guard that never mattered.
    const pool = sc.rows.filter((x) => x && !x.error
      && !IS_BENCH.has(x.symbol) && !IS_SECTOR_ETF.has(x.symbol));

    const num = (r, k) => {
      const v = Number(r && r[k]);
      return r && r[k] != null && isFinite(v) ? v : null;
    };

    // A NULL IS NOT A ZERO, and on this field that is the load-bearing guard
    // rather than a nicety: the read path NULLS a reading above
    // SHORT_PCT_MAX, which is how Berkshire's 966% of float leaves the
    // screen. Coerced, every unread company would sort to the bottom of the
    // ranking instead of out of it -- and the one bad row would sort to the
    // top of it.
    const rows = [];
    for (const r of pool) {
      const v = num(r, field);
      if (!(v > 0)) continue;
      rows.push({ sym: r.symbol, name: nameOf(r), v,
        o: num(r, field2), y: num(r, 'ytdPct') });
    }
    rows.sort((a, b) => b.v - a.v);

    if (rows.length < 3) {
      return chromeTop() + '<div class="s-body"><div class="hs-in">'
        + '<span class="s-kick">' + esc(sc.label) + '</span>'
        + '<h2 class="s-title">Most shorted</h2>'
        + '<p class="s-sub wide" style="--fs:20px">' + esc(
          'Too few short-interest readings here to rank — ' + rows.length
          + ' of ' + pool.length + '. Widen the cut.')
        + '</p></div></div>' + chromeFoot();
    }

    const top = rows.slice(0, N);
    const median = (a) => {
      if (!a.length) return null;
      const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) / 2;
      return s.length % 2 ? s[i] : (s[i - 0.5] + s[i + 0.5]) / 2;
    };
    // The reference is the WHOLE cut, not the ranked slice -- that is the
    // comparison the strip exists to make, and it is why the pool is the
    // thing reduced here rather than `rows`.
    const groupY = top.map((x) => x.y).filter((v) => v != null);
    const cutY = pool.map((r) => num(r, 'ytdPct')).filter((v) => v != null);
    const up = groupY.filter((v) => v >= 0).length;
    const noY = top.length - groupY.length;

    const mxV = Math.max(1e-9, ...top.map((x) => x.v));
    const mxY = Math.max(1e-9, ...top.map((x) => Math.abs(x.y == null ? 0 : x.y)));

    // A flat stock reads as positive, exactly as pctCell does, so it cannot
    // read one way here and another on the row it came from.
    const figY = (v) => (v == null ? '—'
      : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%');

    const SZ = { portrait: { n: 19, f: 25, bar: 8 },
      square: { n: 16, f: 20, bar: 6 },
      story: { n: 26, f: 34, bar: 11 } }[size.id]
      || { n: 19, f: 25, bar: 8 };

    const row = (x) => {
      const w = Math.max(2, x.v / mxV * 100);
      const cls = x.y == null ? '' : (x.y >= 0 ? ' hs-up' : ' hs-dn');
      // ZERO AT THE CENTRE of the year's track, so a fall grows left and a
      // rise grows right. That is the whole reading of this card -- shorted
      // and falling against shorted and RISING -- and a bar growing from the
      // left in two colours would draw a 30% fall and a 30% rise as the same
      // picture. /compare's own rule wherever a value can be negative.
      const half = x.y == null ? 0 : Math.max(1.2, Math.abs(x.y) / mxY * 50);
      const left = x.y == null ? 50 : (x.y >= 0 ? 50 : 50 - half);
      return '<div class="hs-r">'
        + '<span class="hs-t" style="font-size:' + SZ.n + 'px">' + esc(x.sym) + '</span>'
        + '<span class="hs-n" style="font-size:' + SZ.n + 'px">' + esc(x.name) + '</span>'
        + '<span class="hs-v" style="font-size:' + SZ.f + 'px">'
        + esc(shrtFig(x.v, mk)) + '</span>'
        + '<span class="hs-y' + cls + '" style="font-size:' + SZ.f + 'px">'
        + esc(figY(x.y)) + '</span>'
        + '<span class="hs-bars" style="height:' + SZ.bar + 'px">'
        + '<span class="hs-b"><span class="hs-f" style="width:' + w.toFixed(1) + '%"></span></span>'
        + '<span class="hs-b"><span class="hs-z"></span>'
        + (x.y == null ? ''
          : '<span class="hs-yf' + cls + '" style="left:' + left.toFixed(1)
            + '%;width:' + half.toFixed(1) + '%"></span>')
        + '</span></span>'
        + '</div>';
    };

    // The fourth stat is the OTHER metric, so the strip always adds the
    // reading the rows are not ranked by -- the two are measurably
    // different populations, which is the same evidence that makes the
    // metric a control.
    const stats = [
      ['median year, these ' + top.length, figY(median(groupY))],
      ['median year, the cut', figY(median(cutY))],
      ['up / down this year', up + ' / ' + (groupY.length - up)],
      ['median ' + mName2, shrtFig(median(top.map((x) => x.o).filter((v) => v != null)), ok2)],
    ];

    const note = 'Short interest is published twice a month and reaches us about eight '
      + 'business days after it settles, so this is the latest reported position rather '
      + 'than today. '
      + (mk === 'pct'
        ? 'Ranked by how much of the free float is sold short. '
        : 'Ranked by days to cover — the position divided by average daily volume, '
          + 'so it is how crowded the exit is rather than how large the bet is. ')
      + 'The two bars are two scales: the left is ' + mName
      + ', the right is the year so far with zero at its centre. '
      + (noY ? noY + ' of these have no reading for the year yet and sit outside the '
        + 'medians. ' : '')
      + 'A short position is a bet against and also the fuel for a squeeze, which is why '
      + 'the year is beside it rather than a verdict. One window, not a forecast.';

    return chromeTop()
      + '<div class="s-body"><div class="hs-in">'
      + '<span class="s-kick">' + esc(sc.label + ' · '
        + rows.length.toLocaleString() + ' with a reading') + '</span>'
      + '<h2 class="s-title">Most shorted<span class="dim">'
      + esc('ranked by ' + mName + ', with what each has done this year')
      + '</span></h2>'
      + '<div class="hs-wrap">'
        + '<div class="hs-hd">'
          + '<span class="hs-hk">' + esc(mName) + '</span>'
          + '<span class="hs-hk">year to date</span>'
        + '</div>'
        + top.map(row).join('')
      + '</div>'
      + '<div class="hs-stats">' + stats.map(([k, v]) =>
        '<div class="hs-s"><span class="hs-sk">' + esc(k) + '</span>'
        + '<span class="hs-sv">' + esc(v) + '</span></div>').join('') + '</div>'
      + '<p class="s-sub wide" style="--fs:17px">' + esc(note) + '</p>'
      + '</div></div>' + chromeFoot();
  }

  // ---- Narrow or broad ---------------------------------------------------
  //
  // THE CARD IS ONE COMPARISON: how many companies sit above their 200-day
  // moving average, against how much of the VALUE does. Measured on the live
  // index the day it was built, 45.2% by count against 75.6% by value -- a
  // 30-point gap, which is narrowness quantified and is the one reading no
  // other surface here gives. The breakdown beneath is the same fact at a
  // second grain, and the size ladder is almost perfectly monotonic:
  // Mega 75.9, Large 55.3, Mid-Large 33.3, Mid 12.5.
  //
  // IT ADDS NO FIELD. vs200ma is already on every row and is already an
  // Advice input (trend_gate), so this is display over something the engine
  // has always read -- there is nothing new for a verdict to see, and the
  // three-way scoring proof the instrumentType and S&P columns had to give
  // does not apply. The boundary that matters here is the other way round:
  // nothing on this card may become a rule.
  const BRD_MODES = [['size', 'by size'], ['sector', 'by sector'],
    ['names', 'by company']];
  // How many a side the name list shows, per artboard. The counts are
  // measured, like every cap in this module: two columns of names is the
  // tallest block this card draws after the sector list.
  const BRD_NAME_CAP = { portrait: 9, square: 4, story: 12 };
  // Filters.CAP_ORDER restated, the BENCHMARKS bargain: this module has no
  // requires and no DOM, which is what lets a card render identically in
  // Node and the browser. Exported as Cards.capBands() so a test asserts the
  // two lists agree rather than hoping they do.
  const BRD_CAP_ORDER = ['Mega', 'Large', 'Mid-Large', 'Mid', 'Small', 'Micro'];
  // A share computed over four companies is not a breadth reading. The
  // Flow card's own floor, and the sector mode is where it bites.
  const BRD_MIN_GROUP = 5;

  function tplBreadth() {
    const cut = SP_CUTS.some(([k]) => k === O.brdSp500) ? O.brdSp500 : 'in';
    const mode = BRD_MODES.some(([k]) => k === O.brdMode) ? O.brdMode : 'size';

    // The index funds and the eleven sector funds come out FIRST, the rule
    // every market card here keeps -- and it bites harder on this one than
    // most: SPY IS the index, so counting whether it is above its own
    // 200-day inside a breadth reading OF that index is the
    // index-in-its-own-market error in its purest form.
    const notFund = (x) => x && !x.error && !IS_BENCH.has(x.symbol) && !IS_SECTOR_ETF.has(x.symbol);
    const pool = spFilter(stocks.filter(notFund), cut);

    // ONE COMPANY, ONE LISTING, and before anything is counted OR weighted.
    // A dual-class pair would count twice in the headcount and carry the
    // whole company's value twice in the weighted one -- the fold is inert
    // on today's universe (the nine pairs were removed on 2026-10-07) and is
    // exactly what stops the next arrival being a silent double.
    const fold = foldListings(pool, 'vs200ma');
    const rows = fold.rows;

    const num = (r, k) => {
      const v = Number(r && r[k]);
      return r && r[k] != null && isFinite(v) ? v : null;
    };
    const capOf = (r) => { const c = Number(r && r.marketCap); return c > 0 ? c : 0; };

    // A STOCK WITH NO 200-DAY READING IS EXCLUDED AND COUNTED, never counted
    // as below. A company that has not existed for 200 sessions is not
    // trading under its average -- it has no average. 24 of 1,274 live.
    const has = rows.filter((r) => num(r, 'vs200ma') !== null);
    const noRead = rows.length - has.length;
    const isUp = (r) => num(r, 'vs200ma') > 0;

    if (has.length < 20) {
      return chromeTop() + '<div class="s-body"><div class="brd-in">'
        + '<span class="s-kick">' + esc(SP_CUT_LABEL[cut] || 'the whole screen') + '</span>'
        + '<h2 class="s-title">Narrow or broad</h2>'
        + '<p class="s-sub wide" style="--fs:20px">' + esc(
          'Too few 200-day readings here to measure breadth — ' + has.length
          + ' of ' + rows.length + '. A 200-day average needs 200 sessions, '
          + 'so a cut of recent listings has nothing to count.')
        + '</p></div></div>' + chromeFoot();
    }

    const up = has.filter(isUp);
    // Two exclusions and they are DIFFERENT rules, the marketParts bargain.
    // A missing reading is absent (above); a company with no market cap
    // carries no weight at all -- Number(null) is 0 and finite, so "> 0"
    // rejects null and zero in one test.
    const wAll = has.reduce((a, r) => a + capOf(r), 0);
    const wUp = up.reduce((a, r) => a + capOf(r), 0);
    const noCap = has.filter((r) => !capOf(r)).length;

    const byCount = 100 * up.length / has.length;
    const byValue = wAll > 0 ? 100 * wUp / wAll : null;
    const gap = byValue == null ? null : byValue - byCount;

    // ---- the breakdown ---------------------------------------------------
    // ONE floor, ONE anchor. It was written twice, and a revert of either
    // half left the other quietly holding the line -- the duplicated-guard
    // trap this project keeps meeting.
    const bigEnough = (g) => g.length >= BRD_MIN_GROUP;
    const groups = [];
    if (mode === 'names') { /* no groups: the breakdown is a name list */ }
    else if (mode === 'size') {
      for (const b of BRD_CAP_ORDER) {
        const g = has.filter((r) => r.capBand === b);
        if (bigEnough(g)) {
          groups.push({ k: b, n: g.length, up: g.filter(isUp).length });
        }
      }
      // DELIBERATELY NOT SORTED: a size ladder read out of order is not a
      // ladder, and the monotonic fall from Mega to Micro IS the finding.
    } else {
      const seen = new Map();
      for (const r of has) {
        const k = r.sector || null;
        if (!k) continue;          // no sector yet is no sector, never a bucket
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push(r);
      }
      for (const [k, g] of seen) {
        if (bigEnough(g)) {
          groups.push({ k, n: g.length, up: g.filter(isUp).length });
        }
      }
      groups.sort((a, b) => b.up / b.n - a.up / a.n);
    }
    const thin = mode === 'names' ? 0 : (mode === 'sector'
      ? new Set(has.map((r) => r.sector).filter(Boolean)).size
      : BRD_CAP_ORDER.filter((b) => has.some((r) => r.capBand === b)).length) - groups.length;

    // ---- the strip -------------------------------------------------------
    const med = (a) => {
      if (!a.length) return null;
      const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) / 2;
      return s.length % 2 ? s[i] : (s[i - 0.5] + s[i + 0.5]) / 2;
    };
    const dists = has.map((r) => num(r, 'vs200ma'));
    const far = has.slice().sort((a, b) => num(b, 'vs200ma') - num(a, 'vs200ma'));
    const sg = (v) => (v == null ? '—'
      : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%');
    // The render escapes these, so a helper must NOT: esc(esc(x)) turns an
    // ampersand into &amp;amp;. No symbol here carries one today, which is
    // the only reason the first version looked right.
    const nameAt = (r) => (r ? r.symbol + ' ' + sg(num(r, 'vs200ma')) : '—');
    // IN NAMES MODE THE TWO 'FURTHEST' STATS WOULD REPEAT THE FIRST ROW OF
    // EACH COLUMN, word for word, a hundred pixels above them -- the
    // duplication this project has already been pulled up on once, where the
    // blog's image caption restated the post title. The biggest company on
    // each side is the reading the lists CANNOT give, because they are
    // ranked by DISTANCE and the mega-caps are therefore absent from both;
    // and it is this card's own thesis said in two names, since the value
    // half is whatever the largest companies happen to be doing.
    const byCap = (list) => list.filter((r) => num(r, 'marketCap') > 0)
      .sort((a, b) => num(b, 'marketCap') - num(a, 'marketCap'))[0] || null;
    const capAt = (r) => (r ? r.symbol + ' $' + fmtMoney(num(r, 'marketCap')) : '—');
    const stats = mode === 'names'
      ? [['the middle one sits', sg(med(dists))],
        ['biggest above', capAt(byCap(has.filter(isUp)))],
        ['biggest below', capAt(byCap(has.filter((r) => !isUp(r))))],
        ['no 200-day yet', String(noRead)]]
      : [['the middle one sits', sg(med(dists))],
        ['furthest above', nameAt(far[0])],
        ['furthest below', nameAt(far[far.length - 1])],
        ['no 200-day yet', String(noRead)]];

    // THE SQUARE IS THE SHORTEST ARTBOARD AND THIS CARD HAS THE MOST BLOCKS
    // -- a pair, a sentence, up to six rows, a four-stat strip and the note.
    // Measured at the first sizing it ran 9px past the body with no headroom
    // at all, so its figure and rows are a size down from the portrait's
    // rather than a scaled copy of them.
    const SZ = { portrait: { big: 92, lab: 17, row: 20, bar: 10 },
      square: { big: 62, lab: 14, row: 16, bar: 7 },
      story: { big: 124, lab: 23, row: 27, bar: 13 } }[size.id]
      || { big: 92, lab: 17, row: 20, bar: 10 };

    const pcTxt = (v) => (v == null ? '—' : v.toFixed(1) + '%');
    const half = (lab, v, sub) => '<div class="brd-h">'
      + '<span class="brd-hk" style="font-size:' + SZ.lab + 'px">' + esc(lab) + '</span>'
      + '<span class="brd-hv" style="font-size:' + SZ.big + 'px">' + esc(pcTxt(v)) + '</span>'
      + '<span class="brd-ht"><span class="brd-hf" style="width:'
        + (v == null ? 0 : Math.max(1.5, Math.min(100, v))).toFixed(1) + '%"></span></span>'
      + '<span class="brd-hs">' + esc(sub) + '</span>'
      + '</div>';

    // THE GAP IS THE READING, so it is a sentence rather than a fourth
    // figure -- and it is worded for BOTH directions. A card that only knew
    // how to say "narrow" would be asserting its own premise on the day the
    // small companies are the ones carrying it.
    const gapLine = gap == null ? ''
      : (Math.abs(gap) < 4
        ? 'Count and value agree to within ' + Math.abs(gap).toFixed(1)
          + ' points, so the move is about as broad as it looks.'
        : gap > 0
          ? 'NARROW — ' + gap.toFixed(1) + ' points more of the value is above its '
            + 'average than of the companies, so the larger ones are carrying it.'
          : 'BROAD — ' + Math.abs(gap).toFixed(1) + ' points more of the companies are '
            + 'above their average than of the value, so the smaller ones are leading.');

    // ---- the names, which is what a count cannot give you -------------
    // BOTH ENDS, side by side, because the question is 'above OR below'
    // and a single ranked list answers only half of it. The furthest
    // either way is what a card can show; the middle of 496 companies
    // is not a card.
    const NC = BRD_NAME_CAP[size.id] || 9;
    const sorted = has.slice().sort((a, b) => num(b, 'vs200ma') - num(a, 'vs200ma'));
    const aboveList = sorted.filter(isUp).slice(0, NC);
    const belowList = sorted.filter((r) => !isUp(r)).reverse().slice(0, NC);
    const nameRow = (r) => '<div class="brd-nr">'
      + '<span class="brd-nt">' + esc(r.symbol) + '</span>'
      + '<span class="brd-nn">' + esc(nameOf(r)) + '</span>'
      + '<span class="brd-nv ' + (isUp(r) ? 'brd-up' : 'brd-dn') + '">'
      + esc(sg(num(r, 'vs200ma'))) + '</span></div>';
    const nameCol = (lab, list, n) => '<div class="brd-nc">'
      + '<div class="brd-nh">' + esc(lab) + '<span class="brd-nhn">'
      + esc(n.toLocaleString()) + '</span></div>'
      + (list.length ? list.map(nameRow).join('')
        : '<div class="brd-nr brd-none">' + esc('none in this cut') + '</div>')
      + '</div>';

    const mx = Math.max(1, ...groups.map((g) => 100 * g.up / g.n));
    const grpRow = (g) => {
      const p = 100 * g.up / g.n;
      return '<div class="brd-r" style="font-size:' + SZ.row + 'px">'
        + '<span class="brd-rk">' + esc(g.k) + '</span>'
        + '<span class="brd-rb" style="height:' + SZ.bar + 'px">'
          + '<span class="brd-rf" style="width:' + (p / mx * 100).toFixed(1) + '%"></span></span>'
        + '<span class="brd-rv">' + esc(p.toFixed(1) + '%') + '</span>'
        + '<span class="brd-rn">' + esc(String(g.n)) + '</span>'
        + '</div>';
    };

    const scopeWord = cut === 'in' ? 'the S&P 500'
      : cut === 'out' ? 'the stocks outside the index' : 'the whole screen';
    const note = 'Above the 200-day means the latest close is above the average of the '
      + 'last 200 sessions. By count every company weighs the same; by value each weighs '
      + 'its market capitalisation, which is why the two can differ so widely. '
      + (noRead ? noRead + ' here have no 200-day yet and are counted in neither — '
        + 'a company that has not traded 200 sessions has no average rather than a '
        + 'low one. ' : '')
      + (noCap ? noCap + ' have no market capitalisation and carry no weight. ' : '')
      + (mode === 'names' ? 'The ends of the list, not the middle: '
        + 'these are the furthest either way, and the counts beside each heading '
        + 'are how many there are in all. ' : '')
      + (thin > 0 ? thin + (thin === 1 ? ' group holds' : ' groups hold') + ' fewer than '
        + BRD_MIN_GROUP + ' and is left out. ' : '')
      + foldNote(fold.folded)
      + 'Index funds and the sector funds are excluded: a fund that IS the index cannot '
      + 'be counted inside a reading of it. One day’s position, not a forecast.';

    return chromeTop()
      + '<div class="s-body"><div class="brd-in' + (mode === 'sector' ? ' brd-secm' : '') + '">'
      + '<span class="s-kick">' + esc((SP_CUT_LABEL[cut] || 'The whole screen')
        + ' · ' + has.length.toLocaleString() + ' with a 200-day') + '</span>'
      + '<h2 class="s-title">Narrow or broad<span class="dim">'
      // 58 CHARACTERS, inside the 54-59 this module's subtitles measure at.
      // The first wording ran to 69 and the existing letter-spacing simply
      // crushed it -- the Flow card's own lesson, where the longest
      // subtitle reads as the most squeezed rather than as a wrap.
      + esc('how many are above their 200-day, and how much of the value')
      + '</span></h2>'
      + '<div class="brd-fill">'
      + '<div class="brd-pair">'
        + half('by company', byCount, up.length.toLocaleString() + ' of ' + has.length.toLocaleString())
        + half('by value', byValue, '$' + fmtMoney(wUp) + ' of $' + fmtMoney(wAll))
      + '</div>'
      + (gapLine ? '<p class="brd-gap">' + esc(gapLine) + '</p>' : '')
      + (mode === 'names'
        ? '<div class="brd-names">'
            + nameCol('furthest above', aboveList, up.length)
            + nameCol('furthest below', belowList, has.length - up.length)
          + '</div>'
        : '<div class="brd-wrap' + (mode === 'sector' ? ' brd-sec' : '') + '">'
            + '<div class="brd-hd"><span class="brd-hdk">'
              + esc(mode === 'size' ? 'by size' : 'by sector')
            + '</span><span class="brd-hdv">above</span>'
            + '<span class="brd-hdn">n</span></div>'
            + groups.map(grpRow).join('')
          + '</div>')
      + '<div class="brd-stats">' + stats.map(([k, v]) =>
        '<div class="brd-s"><span class="brd-sk">' + esc(k) + '</span>'
        + '<span class="brd-sv">' + esc(v) + '</span></div>').join('') + '</div>'
      + '</div>'
      + '<p class="s-sub wide" style="--fs:17px">' + esc(note) + '</p>'
      + '</div></div>' + chromeFoot();
  }

  const BUILDERS = {
    movers: tplMovers, chart: tplChart, advboard: tplAdvBoard,
    intro: tplIntro, announce: tplAnnounce,
    fund: tplFund, sparks: tplSparks, range: tplRange, size: tplSize, avatar: tplAvatar,
    bubble: tplBubble, stock: tplStock, day: tplDay, spotlight: tplSpotlight,
    disclaimer: tplDisclaimer, howto: tplHowTo, evolution: tplEvolution,
    flow: tplFlow, histogram: tplHistogram,
    treemap: tplTreemap, waterfall: tplWaterfall, shortmoves: tplShortMoves,
    shorted: tplShorted, breadth: tplBreadth,
  };

  // The card styles travel WITH the builders: a new grammar added to one
  // page and styled in the other is exactly the drift this module prevents.
  const STYLE = `
    /* ---- Where the shorts moved: builds against covers ------------------
       NO HEX LITERAL AND NO BACKTICK ANYWHERE IN HERE. Every value is a
       token, so all four grounds resolve with no override block; and a
       backtick inside this block ends the STYLE template literal, which
       node --check PASSES because it is valid syntax and merely the wrong
       program. That has taken this module down three times.

       The two direction colours are NOT here: they are emitted inline by
       the builder through pal.ink, which is what makes them resolve on the
       light and sky grounds without a second palette. */
    .sm-in { display: flex; flex-direction: column; height: 100%; }
    /* A .dim span inside .s-title inherits the 66px display size, which on
       a sentence of explanation sets three lines of headline. The Evolution
       card met this first and the fix is per card, because .s-title is
       shared. */
    .sm-in .s-title .dim { display: block; font-size: 29px; line-height: 1.25;
                           letter-spacing: -0.015em; margin-top: 10px; }
    .sz-square .sm-in .s-title .dim { font-size: 24px; }
    .sz-story .sm-in .s-title .dim { font-size: 38px; }
    /* The note is pinned to the foot and the columns do not stretch, so the
       free space collects in ONE band rather than splitting at both ends --
       the fault the day card had to be rebuilt for. */
    .sm-in .s-sub { margin-top: auto; padding-top: 18px; }
    /* minmax(0, 1fr), never 1fr: that is minmax(auto, 1fr), whose auto floor
       is the item's MIN-CONTENT, so one long company name holds its column
       open and the pair runs past the artboard. The trap the sparks grid,
       the trade log and the saved-name field have all met. */
    .sm-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
               margin-top: 28px; }
    .sm-c { display: flex; flex-direction: column; min-width: 0; }
    .sm-h { font-family: var(--mono); font-size: 14px; letter-spacing: .14em;
            margin-bottom: 14px; }
    .sz-story .sm-h { font-size: 19px; }
    .sm-r { display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
            column-gap: 10px; align-items: baseline; margin-bottom: 13px; }
    .sz-story .sm-r { margin-bottom: 18px; }
    .sm-t { font-family: var(--mono); font-weight: 700; color: var(--text); }
    /* Clipped, never wrapped: one wrapped name makes its row twice as tall
       and there are up to twelve a side. The email log's rule. */
    .sm-n { color: var(--muted); min-width: 0; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
    .sm-v { font-family: var(--mono); font-weight: 700; text-align: right;
            font-variant-numeric: tabular-nums; }
    .sm-bar { grid-column: 1 / -1; display: block; margin-top: 7px;
              background: var(--hair); border-radius: 2px; overflow: hidden; }
    /* display: block on the fill too -- a percentage width on an INLINE span
       draws nothing, and the style attribute reads as perfectly correct
       while it does. The /quality lesson. */
    .sm-f { display: block; height: 100%; border-radius: 2px; min-width: 2px; }
    /* THE STORY SPREADS ITS ROWS, and only the story. Measured against
       the siblings, the band above the note is 77px on the portrait and
       51 on the square -- in line with the waterfall (62) and the
       treemap (63) -- and 354px on the STORY, a fifth of the frame. That
       is the Movers card’s own fault, recorded there as five rows
       reading as lines floating in a frame, and spreading is the fix it
       already settled on. The margin stays as a FLOOR so a short list
       does not fly apart -- the Flow card’s gap bargain. */
    .sz-story .sm-wrap { flex: 1; }
    .sz-story .sm-c { justify-content: space-evenly; }
    .sm-none { color: var(--faint); font-size: 18px; }
    .sm-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 14px; margin-top: 26px; }
    .sm-s { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .sm-sk { font-family: var(--mono); font-size: 13px; letter-spacing: .1em;
             text-transform: uppercase; color: var(--faint); }
    .sm-sv { font-family: var(--mono); font-size: 29px; font-weight: 700;
             color: var(--text); font-variant-numeric: tabular-nums; }
    .sz-square .sm-sv { font-size: 23px; }
    .sz-story .sm-sv { font-size: 38px; }
    .sz-story .sm-sk { font-size: 17px; }
    /* ---- Most shorted: the level, beside the year so far -----------------
       NO HEX LITERAL AND NO BACKTICK ANYWHERE IN HERE. Every colour is a
       token, which is what makes all four grounds resolve with no override
       block; and a backtick inside this block ends the STYLE template
       literal, which node --check PASSES because it is valid syntax and
       merely the wrong program. That has taken this module down three times.

       Unlike the short-moves card the two direction colours ARE tokens here
       -- green and red mean up and down on every surface in this app, and a
       year-to-date return is exactly that -- so they sit in CSS rather than
       being emitted inline through pal.ink. The LEVEL takes no colour at
       all: short interest is one sign throughout, and a bar negative nowhere
       says nothing by being red. */
    .hs-in { display: flex; flex-direction: column; height: 100%; }
    /* A .dim span inside .s-title inherits the 66px display size, which on a
       sentence of explanation sets three lines of headline. The Evolution
       card met this first and the fix is per card, because .s-title is
       shared. */
    .hs-in .s-title .dim { display: block; font-size: 29px; line-height: 1.25;
                           letter-spacing: -0.015em; margin-top: 10px; }
    .sz-square .hs-in .s-title .dim { font-size: 23px; }
    .sz-story .hs-in .s-title .dim { font-size: 38px; }
    /* The note is pinned to the foot so the free space collects in ONE band
       rather than splitting at both ends -- the fault the day card had to be
       rebuilt for. */
    .hs-in .s-sub { margin-top: auto; padding-top: 18px; }
    /* NO BACKTICKS IN THIS COMMENT, OR ANY OTHER IN HERE: Cards.STYLE is
       itself a template literal, so one inside a CSS comment ends the string.
       The fourth time on this project.

       THE TWO VALUE COLUMNS ARE A FIXED WIDTH, SHARED BY THE HEAD ROW AND
       EVERY STOCK ROW, and that is the only thing that makes them line up.
       Each .hs-r is its OWN grid, so an auto column is sized by that row's
       own content and nothing aligns between grids: the head used to be a
       2-column grid matched to the BARS, which put "% OF FLOAT" over the
       left bar while its number sat at the far right -- the two were never
       over each other. It also drifted row to row, because a minus-45.2%
       and a plus-1.8% are different widths, and a narrower last column
       pushes the one before it right.
       Fixed widths fix both at once: columns 3 and 4 are measured in from
       the right edge, which every grid here shares, so what columns 1 and 2
       hold cannot move them.
       THE WIDTHS ARE THE HEADINGS', MEASURED, not the values'. At 13px mono
       with .12em tracking "days to cover" is 122px against the widest value
       it can sit over at 89 (story: 159 against 122), so the head is the
       binding constraint in every case and the values are the comfortable
       ones. ~6px of slack for a value longer than any the read path can
       currently produce. */
    .hs-wrap { margin-top: 26px; --hv: 128px; --hy: 118px; }
    .sz-story .hs-wrap { --hv: 166px; --hy: 154px; }
    /* The two column heads LABEL THE TWO VALUE COLUMNS, placed into tracks 3
       and 4 so each sits directly over its own numbers; the second head
       auto-flows into track 4. The BARS are labelled by the note instead --
       it is the one thing a reader could otherwise get wrong about this
       card, since the two bars are not comparable with one another. */
    .hs-hd { display: grid;
             grid-template-columns: auto minmax(0, 1fr) var(--hv) var(--hy);
             column-gap: 10px; margin-bottom: 12px; }
    .hs-hk { font-family: var(--mono); font-size: 13px; letter-spacing: .12em;
             text-transform: uppercase; color: var(--faint); text-align: right; }
    .hs-hd .hs-hk:first-child { grid-column: 3; }
    .sz-story .hs-hk { font-size: 17px; }
    /* minmax(0, 1fr), never 1fr: that is minmax(auto, 1fr), whose auto floor
       is the item's MIN-CONTENT, so one long company name holds its column
       open and the row runs past the artboard. The trap the sparks grid, the
       trade log and the saved-name field have all met. */
    .hs-r { display: grid;
            grid-template-columns: auto minmax(0, 1fr) var(--hv) var(--hy);
            column-gap: 10px; align-items: baseline; margin-bottom: 14px; }
    .sz-story .hs-r { margin-bottom: 20px; }
    .hs-t { font-family: var(--mono); font-weight: 700; color: var(--text); }
    /* Clipped, never wrapped: one wrapped name makes its row twice as tall
       and there are up to ten of them. The email log's rule. */
    .hs-n { color: var(--muted); min-width: 0; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
    .hs-v { font-family: var(--mono); font-weight: 700; color: var(--text);
            text-align: right; font-variant-numeric: tabular-nums; }
    .hs-y { font-family: var(--mono); font-weight: 700; text-align: right;
            font-variant-numeric: tabular-nums; color: var(--muted); }
    .hs-y.hs-up { color: var(--green); }
    .hs-y.hs-dn { color: var(--red); }
    .hs-bars { grid-column: 1 / -1; display: grid;
               grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
               gap: 16px; margin-top: 7px; }
    .hs-b { position: relative; display: block; height: 100%;
            background: var(--hair); border-radius: 2px; overflow: hidden; }
    /* display: block on the fill too -- a percentage width on an INLINE span
       draws nothing, and the style attribute reads as perfectly correct
       while it does. The /quality lesson. */
    .hs-f { display: block; height: 100%; border-radius: 2px; min-width: 2px;
            background: var(--text); }
    /* The zero of the year's own track, drawn so a reader can see which side
       of it each bar sits on. */
    .hs-z { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px;
            background: var(--hair-2); }
    .hs-yf { position: absolute; top: 0; bottom: 0; border-radius: 2px; }
    .hs-yf.hs-up { background: var(--green); }
    .hs-yf.hs-dn { background: var(--red); }

    /* ---- Narrow or broad ------------------------------------------- */
    /* NO BACKTICKS IN THIS COMMENT: Cards.STYLE is itself a template
       literal, so one inside a CSS comment ends the string. */
    .brd-in { display: flex; flex-direction: column; height: 100%; }
    .brd-in .s-title .dim { display: block; font-size: 29px; line-height: 1.25;
             font-weight: 600; color: var(--muted); margin-top: 10px; }
    .sz-square .brd-in .s-title .dim { font-size: 23px; }
    .sz-story .brd-in .s-title .dim { font-size: 38px; }
    .brd-in .s-sub { margin-top: auto; padding-top: 18px; }
    /* THE SPARE HEIGHT IS SPREAD BETWEEN THE BLOCKS, not left in one band
       above the note. The size ladder is four rows where the sector list is
       eleven, so on a post that mode left ~180px of nothing between the
       strip and the note while the note itself sat pinned to the foot --
       the Snapshot card's own fault, with its own fix. The margins below
       stay as FLOORS: free space is distributed after they are allocated,
       so a full card keeps its rhythm and a sparse one opens up rather
       than stranding the room at one end. */
    .brd-fill { display: flex; flex-direction: column; flex: 1;
                justify-content: space-evenly; min-height: 0; }
    /* THE PAIR IS THE CARD. Two equal halves, so neither reads as the
       headline and the other as a footnote -- the comparison IS the
       reading, and an unequal pair would assert which half matters. */
    .brd-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 34px; margin-top: 26px; }
    .brd-h { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
    .brd-hk { font-family: var(--mono); letter-spacing: .12em;
              text-transform: uppercase; color: var(--faint); }
    .brd-hv { font-family: var(--mono); font-weight: 700; color: var(--text);
              line-height: 1; font-variant-numeric: tabular-nums;
              letter-spacing: -.02em; }
    /* display: block on the fill too -- a percentage width on an INLINE
       span draws nothing, and the style attribute reads as perfectly
       correct while it does. The /quality lesson. */
    .brd-ht { display: block; height: 10px; border-radius: 3px;
              background: var(--hair); overflow: hidden; }
    .brd-hf { display: block; height: 100%; border-radius: 3px; min-width: 3px;
              background: var(--text); }
    .brd-hs { font-family: var(--mono); font-size: 16px; color: var(--muted);
              font-variant-numeric: tabular-nums; }
    .sz-story .brd-hs { font-size: 21px; }
    /* The gap is the finding, so it is set apart from both the figures
       above it and the breakdown below. Neutral: narrow is not bad and
       broad is not good, and green and red mean a direction here. */
    .brd-gap { font-family: var(--mono); font-size: 19px; line-height: 1.45;
               color: var(--text); margin: 22px 0 0;
               padding: 14px 0 0; border-top: 1px solid var(--hair-2); }
    .sz-square .brd-gap { font-size: 16px; margin-top: 16px; padding-top: 11px; }
    .sz-square .brd-pair { margin-top: 18px; gap: 24px; }
    .sz-square .brd-wrap { margin-top: 16px; }
    .sz-square .brd-r { margin-bottom: 9px; }
    .sz-square .brd-stats { margin-top: 18px; gap: 14px; }
    /* THE SQUARE TAKES THE SECTOR LIST IN TWO COLUMNS, and it is the only
       artboard that does. 858px against the post's 1128, and eleven rows
       is the tallest thing this card draws: measured, one column ran 152px
       past the body there and no amount of tightening the margins closed
       it -- 11 rows become 6, which does. The head spans both.
       The post and the story keep one column, where it fits and reads
       better; a layout that differs by artboard is how this module already
       works (the Movers card's story, the Most shorted card's caps). */
    .sz-square .brd-secm .brd-wrap { display: grid; column-gap: 26px;
             grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .sz-square .brd-secm .brd-hd { grid-column: 1 / -1; }
    /* The post needs ~20px rather than a column: trimmed from the gaps
       between blocks, which is where it is least missed. */
    .brd-secm .brd-pair { margin-top: 20px; }
    .brd-secm .brd-gap { margin-top: 16px; padding-top: 11px; }
    .brd-secm .brd-wrap { margin-top: 16px; }
    .brd-secm .brd-stats { margin-top: 14px; }
    .sz-story .brd-gap { font-size: 25px; }
    .brd-wrap { margin-top: 22px; }
    /* The head and the rows share ONE column template, so the figures sit
       under their own heading -- the Most shorted lesson, where two grids
       with auto columns could never line up. */
    .brd-hd, .brd-r { display: grid;
              grid-template-columns: var(--bk) minmax(0, 1fr) 86px 54px;
              column-gap: 12px; align-items: center; }
    .brd-wrap { --bk: 128px; }
    .sz-story .brd-wrap { --bk: 168px; }
    /* THE SECTOR NAMES NEED A WIDER TRACK THAN THE BANDS, measured rather
       than guessed: the longest band is Mid-Large at 97px, the longest
       sector is Communication Services at 235 on a post, 188 on a square
       and 319 on a story. At the bands' 128 the live card truncated FOUR
       sectors and showed 'Consumer ...' twice, which is unreadable rather
       than merely tight -- found on a screenshot of production, because
       the fixture then had three sectors and none of them long. */
    .brd-sec { --bk: 240px; }
    .sz-square .brd-sec { --bk: 192px; }
    .sz-story .brd-sec { --bk: 324px; }
    /* ELEVEN ROWS RATHER THAN FOUR, so the sector breakdown gets its own
       rhythm. At the ladder's spacing it ran 50px past the body on a post
       and 152 on a square -- and the fit check passed, because the fixture
       held three sectors where production holds eleven. */
    .brd-sec .brd-r { margin-bottom: 3px; }
    .sz-square .brd-sec .brd-r { margin-bottom: 2px; }
    .sz-story .brd-sec .brd-r { margin-bottom: 9px; }
    .brd-hd { font-family: var(--mono); font-size: 13px; letter-spacing: .12em;
              text-transform: uppercase; color: var(--faint); margin-bottom: 11px; }
    .sz-story .brd-hd { font-size: 17px; }
    .brd-hdv, .brd-hdn { text-align: right; }
    .brd-r { margin-bottom: 11px; }
    .sz-story .brd-r { margin-bottom: 15px; }
    .brd-rk { color: var(--text); font-weight: 600; min-width: 0;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .brd-rb { display: block; background: var(--hair); border-radius: 2px;
              overflow: hidden; }
    .brd-rf { display: block; height: 100%; border-radius: 2px; min-width: 2px;
              background: var(--text); }
    .brd-rv { font-family: var(--mono); font-weight: 700; color: var(--text);
              text-align: right; font-variant-numeric: tabular-nums; }
    .brd-rn { font-family: var(--mono); color: var(--faint); text-align: right;
              font-variant-numeric: tabular-nums; }
    /* NO BACKTICKS IN THIS COMMENT -- Cards.STYLE is a template literal.
       THE NAMES, IN TWO COLUMNS, because the question is above OR below
       and one ranked list answers half of it. A share and a count say
       how many; only this says which, which is what the card was
       missing. */
    .brd-names { display: grid; column-gap: 30px;
                 grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .sz-square .brd-names { column-gap: 20px; }
    .brd-nh { font-family: var(--mono); font-size: 13px; letter-spacing: .12em;
              text-transform: uppercase; color: var(--faint); margin-bottom: 10px;
              display: flex; justify-content: space-between; align-items: baseline; }
    .sz-story .brd-nh { font-size: 17px; }
    .brd-nhn { font-family: var(--mono); color: var(--muted); letter-spacing: 0; }
    /* minmax(0, 1fr) on the name, never 1fr: that is minmax(auto, 1fr),
       whose auto floor is the item's MIN-CONTENT, so one long company
       name holds its column open and the row runs past the artboard.
       The trap the sparks grid, the trade log and the saved-name field
       have all met. */
    .brd-nr { display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
              column-gap: 9px; align-items: baseline; font-size: 19px;
              margin-bottom: 9px; }
    .sz-square .brd-nr { font-size: 16px; margin-bottom: 7px; }
    .sz-story .brd-nr { font-size: 26px; margin-bottom: 13px; }
    .brd-nt { font-family: var(--mono); font-weight: 700; color: var(--text); }
    /* Clipped, never wrapped: one wrapped name makes its row twice as
       tall and there are up to thirteen of them. The email log's rule. */
    .brd-nn { color: var(--muted); min-width: 0; overflow: hidden;
              text-overflow: ellipsis; white-space: nowrap; }
    .brd-nv { font-family: var(--mono); font-weight: 700; text-align: right;
              font-variant-numeric: tabular-nums; }
    /* The ONLY colour on this card, and it earns it: here the sign is a
       direction about one company rather than a share of a population,
       which is exactly what green and red mean everywhere else here. */
    .brd-nv.brd-up { color: var(--green); }
    .brd-nv.brd-dn { color: var(--red); }
    .brd-none { color: var(--faint); font-style: italic; }
    .brd-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
                 gap: 18px; margin-top: 24px; }
    .brd-s { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .brd-sk { font-family: var(--mono); font-size: 13px; letter-spacing: .1em;
              text-transform: uppercase; color: var(--faint); }
    .sz-story .brd-sk { font-size: 17px; }
    .brd-sv { font-family: var(--mono); font-weight: 700; font-size: 25px;
              color: var(--text); white-space: nowrap; overflow: hidden;
              text-overflow: ellipsis; }
    .sz-square .brd-sv { font-size: 20px; }
    .sz-story .brd-sv { font-size: 34px; }
    .hs-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 14px; margin-top: 24px; }
    .hs-s { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .hs-sk { font-family: var(--mono); font-size: 13px; letter-spacing: .1em;
             text-transform: uppercase; color: var(--faint); }
    .hs-sv { font-family: var(--mono); font-size: 29px; font-weight: 700;
             color: var(--text); font-variant-numeric: tabular-nums; }
    .sz-square .hs-sv { font-size: 22px; }
    .sz-square .hs-sk { font-size: 11px; }
    .sz-story .hs-sv { font-size: 38px; }
    .sz-story .hs-sk { font-size: 17px; }
    /* ---- Treemap: the market as area, the move as colour -----------------
       NO HEX LITERAL AND NO BACKTICK ANYWHERE IN HERE. Every value is a
       token, so all four grounds resolve with no override block; and a
       backtick inside this block ends the STYLE template literal, which
       node --check PASSES because it is valid syntax and merely the wrong
       program. That has taken this module down three times. */
    .tm-in { display: flex; flex-direction: column; height: 100%; }
    /* A .dim span inside .s-title inherits the 66px display size, which on a
       sentence of explanation sets three lines of headline. The Evolution
       card met this first and the fix is per card, because .s-title is
       shared -- and its own step classes were scoped to one container, which
       is the same trap from the other side. */
    .tm-in .s-title .dim { display: block; font-size: 29px; line-height: 1.25;
                           letter-spacing: -0.015em; margin-top: 10px; }
    .sz-square .tm-in .s-title .dim { font-size: 24px; }
    .sz-story .tm-in .s-title .dim { font-size: 38px; }
    /* THE NOTE IS PINNED TO THE FOOT and the map does not stretch. .s-body
       centres its content, so a block whose height is its own content gets
       the leftover room split evenly at its ends -- which is how the day
       card ended up with two empty bands and nothing in the middle. */
    .tm-in .s-sub { margin-top: auto; padding-top: 18px; }
    .tm-wrap { position: relative; flex: none; margin-top: 26px; }
    /* The sector outline sits ABOVE its tiles so its border and its name
       are never painted over by one. It draws no background of its own --
       the tiles are the drawing. */
    .tm-sec { position: absolute; border: 1px solid var(--hair-2);
              pointer-events: none; z-index: 2; overflow: hidden; }
    .tm-h { display: block; font: 700 11px var(--sans); letter-spacing: 0.06em;
            text-transform: uppercase; color: var(--muted); padding: 0 6px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sz-story .tm-h { font-size: 14px; }
    .sz-square .tm-h { font-size: 10px; }
    /* A tile. The background is set inline, because it is the datum. */
    .tm-c { position: absolute; overflow: hidden; padding: 3px 4px;
            box-sizing: border-box; display: flex; flex-direction: column;
            justify-content: center; align-items: center; gap: 1px;
            border-radius: 1px; }
    .tm-s { font: 700 11px var(--mono); letter-spacing: -0.01em;
            color: var(--text); white-space: nowrap; line-height: 1.05; }
    .tm-r { font: 500 10px var(--mono); font-variant-numeric: tabular-nums;
            color: var(--text); opacity: 0.78; white-space: nowrap;
            line-height: 1.05; }
    .sz-story .tm-s { font-size: 14px; } .sz-story .tm-r { font-size: 12px; }
    /* The key says what the colour MEANS, which on a card nobody can hover
       is the only place it can be said. The gradient is built inline from
       the theme's own up and down, so it cannot drift from the tiles. */
    .tm-key { display: flex; align-items: center; gap: 10px; margin-top: 14px;
              flex: none; }
    .tm-kb { flex: 1; height: 8px; border-radius: 4px; display: block;
             border: 1px solid var(--hair); }
    .tm-kl { font: 600 13px var(--mono); font-variant-numeric: tabular-nums;
             color: var(--muted); flex: none; }
    .sz-story .tm-kl { font-size: 16px; } .sz-story .tm-kb { height: 10px; }

    /* ---- Waterfall: the parts, adding up to the whole -------------------- */
    .wf-in { display: flex; flex-direction: column; height: 100%; }
    .wf-in .s-title .dim { display: block; font-size: 29px; line-height: 1.25;
                           letter-spacing: -0.015em; margin-top: 10px; }
    .sz-square .wf-in .s-title .dim { font-size: 24px; }
    .sz-story .wf-in .s-title .dim { font-size: 38px; }
    .wf-in .s-sub { margin-top: auto; padding-top: 18px; }
    /* The ticker band hangs BELOW the plot, so the wrap reserves it as a
       margin rather than inside its own height -- the height passed inline is
       the plot's, and the scale is struck against it. */
    /* THE BOTTOM MARGIN IS THE TICKER BAND PLUS CLEAR AIR. At 34 the
       tickers sat 12px above the figures row and the two read as one
       block of text -- found by looking at the rendered card, not by any
       assertion, which is where every layout fault on this project has
       come from. 54 leaves ~30px. */
    .wf-wrap { position: relative; flex: none; margin-top: 30px;
               margin-bottom: 54px; }
    .wf-zero { position: absolute; left: 0; right: 0; height: 1px;
               background: var(--hair-2); z-index: 1; }
    .wf-col { position: absolute; top: 0; height: 100%; }
    /* 14% gutters either side, which is what leaves room for the connector
       to cross between two columns. */
    .wf-b { position: absolute; left: 14%; right: 14%; border-radius: 2px;
            z-index: 2; }
    .wf-b.up { background: color-mix(in srgb, var(--green) 52%, transparent); }
    .wf-b.dn { background: color-mix(in srgb, var(--red) 52%, transparent); }
    /* The pooled remainder is a real basket and is not dimmed -- it is
       NEUTRAL, because it is the one bar that is not a company and its sign
       is whatever hundreds of names net to. */
    .wf-b.pool { background: color-mix(in srgb, var(--muted) 42%, transparent); }
    /* The total is the only bar drawn from zero. SOLID rather than a tint, so
       it reads as a different kind of thing while keeping its own direction
       -- the Flow card's rule, that green always marks something that rose. */
    .wf-b.tot.up { background: var(--green); }
    .wf-b.tot.dn { background: var(--red); }
    /* THE CONNECTOR IS THE PROOF THE CHART CLOSES. It runs from this bar's
       right edge to the next bar's left edge -- 86% to 114% of a column --
       so it crosses the gutter and lands on the next step. Overflowing the
       column is deliberate and nothing clips it. */
    .wf-con { position: absolute; left: 86%; width: 28%; height: 1px;
              background: var(--hair-2); z-index: 1; }
    /* -2%, not -6%: the labels are centred on their own column and may
       overhang it, but at 6% two adjacent ones nearly met on the 4:5
       ("+0.16%" beside "-0.10%"). A value is allowed a little overhang
       and is dropped entirely below 40px of column. */
    .wf-v { position: absolute; left: -2%; right: -2%; text-align: center;
            font: 600 13px var(--mono); font-variant-numeric: tabular-nums;
            color: var(--muted); white-space: nowrap; z-index: 3; }
    .wf-v.tot { color: var(--text); font-weight: 700; }
    .wf-k { position: absolute; top: 100%; margin-top: 9px; left: -8%;
            right: -8%; text-align: center; font: 600 13px var(--mono);
            letter-spacing: -0.01em; color: var(--muted); white-space: nowrap;
            overflow: hidden; text-overflow: ellipsis; }
    .wf-k.tot { color: var(--text); font-weight: 700; }
    /* The figures row, the day card's shape: the key above its value, so the
       four read as a set rather than as boxes sized by their own text. */
    .wf-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
                gap: 14px; flex: none; }
    .wf-s { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .wf-sk { font: 700 11px var(--sans); letter-spacing: 0.07em;
             text-transform: uppercase; color: var(--faint); white-space: nowrap;
             overflow: hidden; text-overflow: ellipsis; }
    .wf-sv { font: 700 27px var(--mono); font-variant-numeric: tabular-nums;
             color: var(--text); letter-spacing: -0.02em; }
    .sz-square .wf-sv { font-size: 22px; }
    .sz-story .wf-sv { font-size: 34px; }
    .sz-story .wf-sk { font-size: 13px; }
    /* ---- Histogram: the shape of the screen on one measure --------------
       NO HEX LITERAL ANYWHERE IN HERE. Every value is a token, so all four
       grounds resolve with no override block -- the lesson the four unmapped
       dark literals taught on 2026-10-06, applied before the fact.

       The wrapper FILLS what the body leaves and its blocks spread through
       it. That is the day card's rule: a block whose height is its content
       gets the leftover room split evenly at its ends, which is how a card
       ends up with two empty bands and nothing in the middle. */
    .hg-in { display: flex; flex-direction: column; height: 100%; }
    /* A .dim span inside .s-title inherits the display size, which on a
       sentence of explanation sets three lines of headline. The Evolution
       card met this first; the fix is per card because .s-title is shared. */
    .hg-in .s-title .dim { display: block; font-size: 30px; line-height: 1.25; }
    .sz-square .hg-in .s-title .dim { font-size: 25px; }
    .sz-story .hg-in .s-title .dim { font-size: 40px; }

    .hg-wrap { flex: 1; display: flex; flex-direction: column;
               justify-content: space-evenly; gap: 10px; min-height: 0; }

    .hg-plot { position: relative; width: 100%; }
    /* A FLEX ITEM FLOOR IS min-content, so a bar with a count label in it
       would refuse to shrink past the label and the row would overflow. The
       width is set INLINE per bar as a percentage, which needs no flex
       basis at all -- the trap the trade log, the sparks grid and the flow
       tracks have each met. */
    .hg-bars { position: absolute; inset: 48px 0 0 0; display: flex;
               align-items: flex-end; z-index: 0; }

    .sz-square .hg-bars { top: 38px; }
    .sz-story .hg-bars { top: 64px; }

    .hg-b { position: relative; height: 100%; display: flex;
            align-items: flex-end; justify-content: center; }
    .hg-f { display: block; width: calc(100% - 3px); min-height: 2px;
            background: var(--muted); border-radius: 2px 2px 0 0; }
    /* A SMALL BAR DRAWN AT ITS HONEST SIZE STILL HAS TO BE VISIBLE -- the
       Size card's rule. min-height is 2px rather than a floor on the value,
       so the number is never overstated, only made findable. */
    .hg-b.up .hg-f { background: var(--green); }
    .hg-b.dn .hg-f { background: var(--red); }
    .hg-b.hit .hg-f { background: var(--accent); }

    /* The median is a reference, so it is quiet and dashed; the subject is
       the point of the card, so it is solid and in the accent. */
    /* ON TOP OF THE BARS, both of them. Drawn under, the rule appears
       only in the gap above the tallest bar and the word not at all --
       which is a reference point the reader cannot find or name. */
    .hg-med { position: absolute; top: 0; bottom: 0; width: 0; z-index: 2;
              border-left: 2px dashed var(--hair-2); }

    .hg-pin { position: absolute; top: 0; bottom: 0; width: 0; z-index: 3;
              border-left: 3px solid var(--accent); }

    .hg-flag { position: absolute; top: 0; transform: translateX(-50%); z-index: 4;


               background: var(--accent); color: var(--card-ground);
               font: 600 19px/1 var(--sans); letter-spacing: .01em;
               padding: 7px 12px; border-radius: 8px; white-space: nowrap; }
    .hg-flag b { font-family: var(--mono); font-weight: 700; }
    .hg-flag.lf { transform: none; }
    .hg-flag.rt { transform: translateX(-100%); }
    /* A dashed rule a reader cannot name is furniture. The word sits at
       the BOTTOM so it can never collide with the subject's flag. */
    .hg-medlab { position: absolute; bottom: 4px; transform: translateX(-50%); z-index: 2;

                 font: 600 14px/1 var(--sans); letter-spacing: .06em;
                 text-transform: uppercase; color: var(--faint);
                 background: var(--card-ground); padding: 0 6px; }
    .sz-story .hg-medlab { font-size: 18px; }


    .hg-axis { display: flex; margin-top: 10px; }
    .hg-t { text-align: center; font: 500 16px/1.2 var(--mono); color: var(--faint);
            overflow: hidden; white-space: nowrap; }

    .hg-stats { display: flex; gap: 14px; margin-top: 18px; }
    .hg-s { flex: 1 1 0; min-width: 0; padding: 14px 16px; border-radius: 12px;
            background: color-mix(in srgb, var(--text) 5%, transparent);
            border: 1px solid var(--hair); }
    .hg-k { display: block; font: 600 15px/1.2 var(--sans); color: var(--muted);
            letter-spacing: .04em; text-transform: uppercase; }
    .hg-v { display: block; margin-top: 5px; font: 700 30px/1.1 var(--mono); color: var(--text);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .sz-square .hg-flag { font-size: 17px; padding: 6px 10px; }
    .sz-square .hg-t { font-size: 14px; }
    .sz-square .hg-v { font-size: 25px; }
    .sz-story .hg-flag { font-size: 24px; padding: 9px 15px; }
    .sz-story .hg-t { font-size: 20px; }
    .sz-story .hg-k { font-size: 18px; }
    .sz-story .hg-v { font-size: 38px; }
    /* ---- Evolution: the business, then what the market paid for it -------
       Two stacked panels on one time axis plus a figures row. The wrapper
       FILLS what the body leaves and the blocks spread through it, which is
       the day card's rule: a block whose height is its content gets the
       leftover room split evenly at its ends, and that is how a card ends up
       with two empty bands and nothing in the middle.
       EVERY VALUE IS A TOKEN. A hex literal here is invisible on the light
       ground rather than wrong, which is the harder failure to spot. */
    .evo-in { display: flex; flex-direction: column; height: 100%; }
    .evo-lab { margin: 10px 0 0; font: 500 21px var(--mono); color: var(--faint);
               letter-spacing: 0.01em; }
    .evo-wrap { flex: 1; display: flex; flex-direction: column;
                justify-content: space-evenly; gap: 10px; min-height: 0; }
    .evo-p { min-width: 0; }
    .evo-h { display: block; font: 600 20px var(--sans); letter-spacing: 0.08em;
             text-transform: uppercase; color: var(--faint); margin: 0 0 4px; }
    /* A GRID, so the four cells are equal whatever is in them, with a
       minmax(0,1fr) floor: a plain 1fr is minmax(auto,1fr) and one long
       figure would hold its column open and push the row past the artboard,
       which this project has shipped twice. */
    .evo-figs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 12px; margin: 4px 0 0; }
    .evo-f { min-width: 0; border-top: 1px solid var(--hair-2); padding: 12px 0 0; }
    .evo-fl { display: block; font: 600 17px var(--sans); letter-spacing: 0.08em;
              text-transform: uppercase; color: var(--faint); }
    /* A QUARTER OF 952px IS 227px, and "$310.6B -> $466.6B" is seventeen
       monospace characters -- which does not fit at 25px, and WAS CLIPPED on
       the 4:5 on the one figure the card is most about. Found by screenshot;
       there is a check that no figure's text overflows its own cell. */
    /* NO PER-ARTBOARD SIZE ON THIS ONE. Every artboard is 1080px wide, so a
       quarter of the figures row is the same 227px on all three -- the story
       carried 30px and clipped all four figures. */
    .evo-fv { display: block; margin: 5px 0 0; font: 600 21px var(--mono);
              color: var(--text); white-space: nowrap; overflow: hidden;
              text-overflow: ellipsis; }
    .evo-fv i { font-style: normal; color: var(--faint); padding: 0 2px; }
    .evo-fc { display: block; margin: 3px 0 0; font: 600 21px var(--mono);
              color: var(--muted); }
    .evo-fc.pos { color: var(--green); }
    .evo-fc.neg { color: var(--red); }
    /* The as-of line. Tokens only, no literal, so all three grounds resolve
       with no override block. It is one line by construction -- the two dates
       are fixed-width -- and it is deliberately quiet: it qualifies the row
       above it rather than competing with it. */
    /* THE FIGURES AND THEIR AS-OF LINE ARE ONE FLEX CHILD, not two. The wrap
       is a space-evenly column, so a second child buys a whole extra gap on
       top of its own height -- measured, the line alone cost 70px on the
       square and overflowed the artboard. Wrapped, it costs its own height. */
    .evo-foot { min-width: 0; }
    .evo-asof { margin: 9px 0 0; font: 500 16px var(--sans); color: var(--faint); }
    .sz-story .evo-asof { font-size: 20px; }
    .sz-square .evo-lab { font-size: 19px; }
    .sz-square .evo-fc { font-size: 18px; }
    .sz-story .evo-lab { font-size: 26px; }
    .sz-story .evo-h { font-size: 24px; }
    .sz-story .evo-fl { font-size: 20px; }
    .sz-story .evo-fc { font-size: 25px; }

    /* ---- the artboard ---------------------------------------------------
       The board the card is drawn on: 1080 wide, its own ground and aura, and
       the padding every card lays out inside. It lived in promo.html AND in
       the since-deleted cards.html as two copies until the phone needed a
       third (2026-09-16) — so it moved here, beside the cards it holds. Only
       the studio and the phone host it now. A host sets the height,
       which is the one thing that follows the chosen size. */
    .s-art { width: 1080px; position: relative; overflow: hidden;
             --card-ground: #050505; background: var(--card-ground);
             transform-origin: top left; font-family: var(--sans); color: var(--text); }
    .s-art .s-aura { position: absolute; inset: 0; pointer-events: none;
      background:
        radial-gradient(70% 52% at 8% -6%, rgba(52, 211, 153, 0.16), transparent 62%),
        radial-gradient(76% 55% at 100% 2%, rgba(124, 156, 255, 0.14), transparent 64%),
        radial-gradient(60% 40% at 50% 110%, rgba(167, 139, 250, 0.12), transparent 70%); }
    .s-art .s-in { position: relative; display: flex; flex-direction: column;
                   height: 100%; padding: 56px 64px 48px; box-sizing: border-box; }
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
    .s-lock { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .s-word { font-size: 44px; font-weight: 700; letter-spacing: -0.035em; line-height: 1; }
    /* line-height 1 on BOTH, or the lockup measures 71px against the glyph's 68
       and every card's body starts three pixels lower. Measured, not assumed. */
    .s-tag { font-size: 16px; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase;
             color: var(--green); white-space: nowrap; line-height: 1; }
    .s-date { margin-left: auto; font: 500 24px var(--mono); color: var(--muted);
              padding: 11px 24px; border: 1px solid var(--hair-2); border-radius: 999px; }
    .s-kick { margin: 44px 0 0; font-size: 17px; font-weight: 600; letter-spacing: 0.24em;
              text-transform: uppercase; color: var(--green); }
    .s-title { margin: 10px 0 0; font-size: 66px; font-weight: 800; line-height: 1.02;
               letter-spacing: -0.045em; }
    .s-title .dim { color: var(--faint); }
    /* A note's size is --fs, NOT an inline font-size. Twenty of the
       twenty-three notes used to carry style="font-size:18px" and the like,
       and an inline declaration beats a class rule — so
       ".sz-story .s-sub { font-size: 25px }" below was DEAD for all of them
       and every story card printed its footnote at post size. Setting the
       variable instead keeps each card's own relative choice (17 / 18 / 19 /
       26) while letting the artboard scale the lot.
       1.25 is the ratio already chosen for a story note: the default 20px
       became 25px, so an 18px note becomes 22.5px and stays proportionally
       what its card asked for. */
    .s-sub { margin: 16px 0 0; font-size: var(--fs, 20px); color: var(--muted);
             line-height: 1.5; max-width: 40ch; }
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
    /* ---- the two alternate grounds -------------------------------------
       The token block is most of the work: ~35 var() uses in this stylesheet
       resolve against whatever the theme declares, so the chrome, the type
       and every hairline follow from it. What a token CANNOT reach is
       rgba(255,255,255,.0x) — 25 of them, and on a light ground they are
       invisible rather than wrong, which is the failure that looks like an
       empty card rather than a broken one. Each one the SPOTLIGHT draws is
       overridden below; the other templates keep their dark ground until
       they are done one at a time.
       (No backticks in here. STYLE is a template literal and one inside a
       CSS comment ends the string.) */
    /* Every value here clears 4.5:1 against a FILLED TILE (the 0.05 ink
       tint), not merely against the artboard. The first cut was tuned on the
       bare page at 4.68-4.99 and the sweep then caught --faint at 4.28 inside
       a spotlight cell: a token that is safe on the ground and marginal on the
       furniture is a token that fails wherever a card happens to put it. */
    .s-art.th-light {
      --card-ground: #f7f8fa;
      --text: #0d1017; --muted: #5b6675; --faint: #606b7a;
      --green: #157a51; --red: #c81e37; --amber: #9d5a07;
      --accent: #2e5fe8; --accent-2: #6d3fd4;
      --hair: rgba(13, 16, 23, 0.10); --hair-2: rgba(13, 16, 23, 0.17);
      background: var(--card-ground); color: #0d1017; }
    /* Three blooms of coloured light are atmosphere on black and stains on
       white, so the light ground gets two at a tenth of the alpha. */
    .s-art.th-light .s-aura {
      background:
        radial-gradient(80% 55% at 6% -8%, rgba(21, 122, 81, 0.07), transparent 66%),
        radial-gradient(70% 50% at 100% 0%, rgba(48, 96, 232, 0.06), transparent 68%); }
    .s-art.th-light .s-glyph {
      background: linear-gradient(160deg, rgba(21, 122, 81, 0.16), rgba(21, 122, 81, 0.05));
      border-color: rgba(21, 122, 81, 0.34); color: #157a51; }
    .s-art.th-light .sp-head { border-bottom-color: rgba(13, 16, 23, 0.14); }
    .s-art.th-light .sp-cell { background: rgba(13, 16, 23, 0.05); }
    .s-art.th-light .sp-verd { background: rgba(13, 16, 23, 0.035); }
    /* EVERY OTHER CARD'S white-alpha furniture (2026-09-30, owner: "add
       these all promo cards"). Found by sweeping all thirteen templates on
       the light ground and flagging any surface that composites to within a
       hair of it — an un-overridden one is INVISIBLE rather than wrong, so
       the eye finds it only by noticing an absence. The .trail rule is the
       one deleted when the spotlight lost its 52-week track; the Range card
       draws it, so it comes back for that card rather than on a hunch.
       (NO BACKTICKS IN HERE. This comment had a pair round a class name and
       they ended the STYLE template literal — the third time this trap has
       bitten, and node --check passes every time because it is valid syntax,
       just an interpolation.) */
    .s-art.th-light .bar-rail { background: rgba(13, 16, 23, 0.06); }
    .s-art.th-light .arail { background: rgba(13, 16, 23, 0.06); }
    .s-art.th-light .trail { background: rgba(13, 16, 23, 0.07); }
    .s-art.th-light .chipL { background: rgba(13, 16, 23, 0.05); }
    .s-art.th-light .spkt { background: rgba(13, 16, 23, 0.045); }
    /* The tile fills, at 0.022-0.03 on dark. They read on a light ground only
       because each also carries a --hair border, which the token already
       flips — but a fill nobody can see is still a fill nobody can see. */
    .s-art.th-light .frule,
    .s-art.th-light .pcard,
    .s-art.th-light .vrow,
    .s-art.th-light .stmt,
    .s-art.th-light .hwho,
    /* .feat was missed when this list was written — five of its siblings
       are here and it is the same 2.8% white tile, invisible on a light
       ground. Found by the ground sweep once the Intro's and the how-to's
       STEP slides were swept at all; the sweep had only ever visited each
       template's default slide, which for the Intro is a cover with no
       .feat on it. */
    .s-art.th-light .feat,
    .s-art.th-light .ftile { background: rgba(13, 16, 23, 0.035); }
    .s-art.th-light .mock { background: rgba(13, 16, 23, 0.04); }
    .s-art.th-light .mockrow { background: rgba(13, 16, 23, 0.045); }
    .s-art.th-light .flowrow .fv { background: rgba(13, 16, 23, 0.055); }
    /* A pale dot on a pale ground is not a dot. */
    .s-art.th-light .dots i { background: rgba(13, 16, 23, 0.20); }

    /* The day card's own white-alpha furniture. Three surfaces and two bar
       gradients: invisible rather than wrong on a light ground, which is the
       failure that reads as an empty card. The gradient's soft end is the
       LIGHT green and red, or the bar fades into the page instead of into
       its own colour. */
    .s-art.th-light .dy-head { border-bottom-color: rgba(13, 16, 23, 0.14); }
    .s-art.th-light .dy-chip { background: rgba(13, 16, 23, 0.05); }
    .s-art.th-light .dy-rail { background: rgba(13, 16, 23, 0.06); }
    .s-art.th-light .dy-bar {
      background: linear-gradient(90deg, rgba(21, 122, 81, 0.30), var(--green)); }
    .s-art.th-light .dy-bar.neg {
      background: linear-gradient(90deg, rgba(200, 30, 55, 0.30), var(--red)); }
    /* The .trk override that sat here went with the 52-week track: the
       spotlight was its only themed consumer, and a rule nothing can reach
       reads as intent. */

    /* NAVY IS A GROUND AND AN AURA, and that is the whole theme. Measured on
       #0d1a2d the dark palette still clears 4.5:1 everywhere (green 9.1, red
       6.5, amber 10.5), so nothing else has to move and the white-alpha
       furniture keeps working. --faint alone is lifted: it landed at 4.81,
       the closest to the floor, and it paints the smallest text on the card. */
    /* The blue ground, over the light block above. Same specificity, so it
       has to come AFTER it -- and it only needs what the bluer, darker
       ground actually changes. Measured: #d1ecff is luminance 0.808
       against light's 0.938, a gap of 0.130, which puts light's own green,
       faint and amber under the 4.5:1 floor -- and further under it once
       the 0.05 card-tile tint (#c7e1f3) darkens the surface a card
       actually puts text on -- so each is darkened a notch. After, on that
       tile: green 4.82, red 4.67, amber 4.84, flat 4.69, muted 5.23,
       faint 5.08. The VERDICT LADDER needed the same treatment and is
       LADDER_SKY, in the palette above: reusing light's put all six
       entries under the floor. */
    .s-art.th-sky {
      --card-ground: #d1ecff;
      --green: #126b46; --red: #bb1b33; --amber: #8a4f06;
      --muted: #4f5968; --faint: #515b69;
      --hair: rgba(13, 16, 23, 0.11); --hair-2: rgba(13, 16, 23, 0.19);
      background: var(--card-ground); }
    /* Blue blooms rather than light's green-and-blue: a green wash on a
       blue ground reads as a stain. */
    .s-art.th-sky .s-aura {
      background:
        radial-gradient(82% 56% at 6% -8%, rgba(30, 78, 200, 0.11), transparent 66%),
        radial-gradient(70% 50% at 100% 0%, rgba(18, 107, 70, 0.05), transparent 68%); }
    .s-art.th-sky .s-glyph {
      background: linear-gradient(160deg, rgba(18, 107, 70, 0.17), rgba(18, 107, 70, 0.05));
      border-color: rgba(18, 107, 70, 0.36); color: #126b46; }
    .s-art.th-navy { --faint: #8b95a5; --card-ground: #0d1a2d;
                     background: var(--card-ground); }
    .s-art.th-navy .s-aura {
      background:
        radial-gradient(72% 52% at 6% -6%, rgba(52, 211, 153, 0.13), transparent 64%),
        radial-gradient(78% 56% at 100% 2%, rgba(124, 156, 255, 0.17), transparent 66%),
        radial-gradient(62% 42% at 50% 110%, rgba(34, 211, 238, 0.10), transparent 72%); }

    /* ---- the stock spotlight ------------------------------------------
       One company on one artboard: the line, its year, eight figures and the
       verdict. The blocks spread through whatever the body leaves, the day
       card's treatment, so the card fills every shape rather than stranding
       the slack at the two ends.
       (NO BACKTICKS IN HERE. STYLE is itself a template literal and one
       inside a CSS comment ends the string — three times on the day card
       alone, and node --check passes every time, because it is valid
       interpolation rather than a syntax error.) */
    .sp-in { height: 100%; display: flex; flex-direction: column; }
    .sp-wrap { flex: 1; display: flex; flex-direction: column;
               justify-content: space-evenly; gap: 18px; }
    .sp-up { color: var(--green); } .sp-dn { color: var(--red); }
    /* The ticker, the price and today's move: the subject's LABEL, not a
       second headline. Mono, because all three are figures, and muted so the
       company name stays the loudest thing above the chart. */
    .sp-sub { margin-top: 10px; font: 600 33px var(--mono); color: var(--muted);
              letter-spacing: -0.02em; }
    /* A company name is arbitrarily long and this card sets it alone on a
       line, so 66px is the wrong default here: "Norwegian Cruise Line
       Holdings" takes three lines at that size and two at this one, and the
       room a third line costs comes straight out of the chart. */
    .sp-in .s-title { font-size: 58px; }
    .sp-in .s-title.t2, .evo-in .s-title.t2 { font-size: 46px; letter-spacing: -0.04em; }
    .sp-in .s-title.t3, .evo-in .s-title.t3 { font-size: 38px; letter-spacing: -0.035em; }
    .sp-in .s-title.t4, .evo-in .s-title.t4 { font-size: 30px; letter-spacing: -0.03em; line-height: 1.12; }
    .sp-block { min-width: 0; }
    .sp-head { font: 600 16px var(--mono); text-transform: uppercase;
               letter-spacing: 0.16em; color: var(--muted);
               border-bottom: 1px solid rgba(255, 255, 255, 0.12);
               padding-bottom: 8px; margin-bottom: 14px; }
    /* The track comes from the Range card, whose own rules assume it is the
       body of the card: a top margin, and flex:1 on a story so several rows
       spread down the frame. Here it is one row inside a block, so both are
       undone rather than the markup being copied and altered. */
    .sp-block .tracks { margin-top: 0; flex: none; gap: 0; }
    .sp-block .tkey { margin-top: 12px; }
    /* Eight cells, four across: two rows on every shape, so the returns read
       as one line and the business as another. */
    .sp-grid { display: grid; grid-template-columns: repeat(4, 1fr);
               gap: 12px; }
    .sp-cell { min-width: 0; border-radius: 14px; padding: 13px 16px;
               background: rgba(255, 255, 255, 0.05);
               display: flex; flex-direction: column; gap: 4px; }
    .sp-cl { font: 600 14px var(--mono); text-transform: uppercase;
             letter-spacing: 0.1em; color: var(--faint); white-space: nowrap;
             overflow: hidden; text-overflow: ellipsis; }
    .sp-cv { font: 600 30px var(--mono); letter-spacing: -0.02em;
             font-variant-numeric: tabular-nums; }
    .sp-cv.pos { color: var(--green); } .sp-cv.neg { color: var(--red); }
    /* The verdict is the loudest thing under the chart, which is what a
       spotlight is for — and the rule beside it is what keeps it a reading
       rather than a tip. */
    .sp-verd { display: flex; align-items: baseline; flex-wrap: wrap;
               gap: 8px 18px; border: 1px solid var(--hair-2);
               border-radius: 18px; padding: 16px 22px;
               background: rgba(255, 255, 255, 0.035); }
    .sp-vw { font: 800 40px var(--sans); letter-spacing: -0.035em;
             line-height: 1.05; }
    .sp-vr { font: 500 21px var(--sans); color: var(--muted); flex: 1;
             min-width: 0; line-height: 1.25; }
    .sp-vp { font: 600 14px var(--mono); text-transform: uppercase;
             letter-spacing: 0.14em; color: var(--faint); white-space: nowrap; }

    /* The 4:5 has the most room once the chart is sized for it, so part of
       it goes into the figures rather than all of it into the gaps. */
    .sz-portrait .sp-cv { font-size: 31px; }
    .sz-portrait .sp-vw { font-size: 42px; }

    /* A SQUARE IS THE SHORT ARTBOARD and this is the densest card here, so
       the chart gives up most of what has to be given up (the builder drops
       it to 212 against the post's 392) and every block tightens with it.
       Measured on the sweep rather than guessed. */
    .sz-square .sp-in .s-title { font-size: 50px; }
    .sz-square .sp-in .s-title.t2, .sz-square .evo-in .s-title.t2 { font-size: 41px; }
    .sz-square .sp-in .s-title.t3, .sz-square .evo-in .s-title.t3 { font-size: 34px; }
    .sz-square .sp-in .s-title.t4, .sz-square .evo-in .s-title.t4 { font-size: 27px; }
    .sz-square .sp-sub { font-size: 27px; margin-top: 7px; }
    .sz-square .sp-wrap { gap: 12px; }
    .sz-square .sp-head { margin-bottom: 10px; padding-bottom: 6px; font-size: 15px; }
    .sz-square .sp-cell { padding: 9px 13px; }
    .sz-square .sp-cv { font-size: 25px; }
    .sz-square .sp-verd { padding: 12px 18px; border-radius: 15px; }
    .sz-square .sp-vw { font-size: 31px; }
    .sz-square .sp-vr { font-size: 18px; }
    .sz-square .trk .ts { font-size: 20px; }
    .sz-square .trk .tlo, .sz-square .trk .thi { font-size: 18px; }

    /* A story is twice as tall and read at arm's length, so it takes the room
       back rather than staying at the post's rhythm — the fault the day card
       records for its own first cut, where 993px of content sat in a 1920px
       frame and the bottom half was empty. */
    .sz-story .sp-in .s-title { font-size: 74px; }
    .sz-story .sp-in .s-title.t2, .sz-story .evo-in .s-title.t2 { font-size: 58px; }
    .sz-story .sp-in .s-title.t3, .sz-story .evo-in .s-title.t3 { font-size: 48px; }
    .sz-story .sp-in .s-title.t4, .sz-story .evo-in .s-title.t4 { font-size: 38px; }
    .sz-story .sp-sub { font-size: 42px; margin-top: 14px; }
    .sz-story .sp-wrap { gap: 26px; }
    .sz-story .sp-head { font-size: 19px; padding-bottom: 11px; margin-bottom: 18px; }
    .sz-story .sp-grid { gap: 16px; }
    .sz-story .sp-cell { padding: 18px 20px; }
    .sz-story .sp-cl { font-size: 16px; }
    .sz-story .sp-cv { font-size: 38px; }
    .sz-story .sp-verd { padding: 22px 28px; }
    .sz-story .sp-vw { font-size: 52px; }
    .sz-story .sp-vr { font-size: 26px; }
    .sz-story .sp-vp { font-size: 16px; }

    /* ---- the day card -------------------------------------------------
       Three blocks in one body, so the rhythm is set once on the wrapper and
       every row inside it follows. Sizes here are the DEFAULT rhythm; the
       two tighter steps below override them, and tplDay picks the step by
       estimating the height against the artboard. */
    .dy-chips { display: flex; gap: 14px; }
    .dy-chip { flex: 1; min-width: 0; border-radius: 14px; padding: 13px 16px;
               background: rgba(255, 255, 255, 0.05); display: flex;
               flex-direction: column; gap: 3px; }
    .dy-chip b { font: 600 15px var(--mono); text-transform: uppercase;
                 letter-spacing: 0.1em; color: var(--muted); white-space: nowrap;
                 overflow: hidden; text-overflow: ellipsis; }
    .dy-chip i { font: 600 30px var(--mono); font-style: normal; }
    .dy-chip i.pos { color: var(--green); } .dy-chip i.neg { color: var(--red); }
    /* ---- the card FILLS its artboard, on every shape ------------------
       Measured after the first cut, and the owner marked both bands on a
       screenshot: the 4:5 left 164px unused (82 above the kicker, 81 under
       the movers) and the square 74px. They are one slack, split in two by
       the centring on .s-body, so neither can be fixed on its own. The three
       blocks spread through what the body leaves instead — the treatment
       the story already had, applied to all three shapes rather than kept
       as a special case.
       The gap is a FLOOR, not the spacing: free space is distributed after
       gaps are allocated, so a full card keeps 22px between blocks and a
       sparse one opens up instead of stranding the room at the ends.
       (No backticks in here. STYLE is a template literal and one inside a
       CSS comment ends the string; this is the THIRD time on this card,
       and node --check passes it every time because it is valid
       interpolation rather than a syntax error.) */
    .dy-in { height: 100%; display: flex; flex-direction: column; }
    .dy-wrap { flex: 1; display: flex; flex-direction: column;
               justify-content: space-evenly; gap: 22px; }
    .dy-block { margin-top: 0; }
    /* No nowrap here, deliberately. I had added one and called it
       load-bearing; reverting it wrapped NOTHING, because every head this
       card writes is short by construction ("Sectors · cap-weighted",
       "Top 10"). A declaration that cannot be made to matter is residue, and
       the sweep asserts no head wraps — so a longer one added later fails a
       check rather than being silently absorbed by a rule nobody remembers. */
    .dy-head { font: 600 16px var(--mono); text-transform: uppercase;
               letter-spacing: 0.16em; color: var(--muted);
               border-bottom: 1px solid rgba(255, 255, 255, 0.12);
               padding-bottom: 8px; margin-bottom: 10px; }
    .dy-head.pos { color: var(--green); } .dy-head.neg { color: var(--red); }
    /* Eleven sectors down one column is 11 lines; in two it is six. */
    .dy-grid { display: grid; grid-template-columns: 1fr 1fr;
               column-gap: 34px; row-gap: 0; }
    /* The sector column is wider than the movers' one, and that is measured
       rather than a preference: there are exactly eleven sector names and
       the longest, "Communication Services", DRAWS 197px against the 150 the
       shared label had — so two of eleven printed with an ellipsis, which a
       screenshot caught and no assertion did. A company name is arbitrarily
       long and truncating one is correct, which is why the width is scoped
       to the grid. (An off-page probe said it needed 156px and was wrong:
       copying a computed cssText onto a bare span does not carry the font.
       The honest measure is the element's own scrollWidth.) */
    .dy-grid .dy-lab { width: 202px; }
    .dy-two { display: flex; gap: 34px; }
    .dy-col { flex: 1; min-width: 0; }
    .dy-row { display: flex; align-items: center; gap: 10px; height: 36px; }
    .dy-lab { font: 600 17px var(--sans); width: 150px; flex: none;
              letter-spacing: -0.015em; white-space: nowrap; overflow: hidden;
              text-overflow: ellipsis; }
    .dy-rail { flex: 1; min-width: 0; height: 18px; border-radius: 6px;
               background: rgba(255, 255, 255, 0.045); overflow: hidden; }
    .dy-bar { height: 100%; border-radius: 6px;
              background: linear-gradient(90deg, rgba(52, 211, 153, 0.35), var(--green)); }
    .dy-bar.neg { background: linear-gradient(90deg, rgba(251, 113, 133, 0.35), var(--red)); }
    .dy-val { font: 600 18px var(--mono); width: 92px; flex: none; text-align: right; }
    .dy-val.pos { color: var(--green); } .dy-val.neg { color: var(--red); }

    /* There were two tighter steps here, and tplDay's own note records why
       they are gone: measured against the real artboards the default rhythm
       fits every card the controls can reach, so nothing could ever select
       them. */

    /* The 4:5 has the most room of the three once the bands were reclaimed,
       so part of it goes into the rows rather than all of it into the gaps.
       A 1080px card renders about 400px wide in a feed, so a 36px row is
       ~13px to the reader and a 40px one is ~15px — which is the whole
       density argument this card was designed around. The square keeps 36:
       measured, it had 74px of slack against the post's 164, and eleven
       rows would eat 66 of it.
       40 rather than 42, which also fit: the worst reachable card is the
       4:5 at ten a side (sixteen rows), and at 42 the gap between blocks
       lands on 29px against the 22px floor — seven pixels from capacity.
       At 40 it is 37, which is a third of a row of headroom. */
    .sz-portrait .dy-row { height: 40px; }
    .sz-portrait .dy-rail { height: 20px; }
    .sz-portrait .dy-lab { font-size: 18px; }
    .sz-portrait .dy-val { font-size: 19px; }
    .sz-portrait .dy-chip i { font-size: 33px; }
    /* The taller rows came with a bigger label, and "Communication Services"
       stopped fitting the 202px the sector column had — caught by the
       no-truncation check rather than by eye this time. */
    .sz-portrait .dy-grid .dy-lab { width: 216px; }

    /* A story is twice as tall and read at arm's length, so it gets the room
       back rather than staying at the post's rhythm. FOUND BY SCREENSHOT,
       not by an assertion: with only the type scaled up the card drew 993px
       of content in a 1920px frame and the bottom half was empty — which is
       the fault tplMovers already records for its own story layout, "five
       rows spread through a story read as lines floating in a frame". The
       rows are taller AND the three blocks spread through what is left, the
       treatment that card settled on. The rule .sz-story .s-body > div
       already makes every template's inner block a full-height flex column,
       so the wrapper only has to take the room.
       (No backticks anywhere in here: STYLE is itself a template literal and
       one inside a CSS comment ends the string. It cost a round of debugging
       on the Size card and it cost another one here.) */
    .sz-story .dy-chips { gap: 18px; }
    .sz-story .dy-chip { padding: 17px 20px; }
    .sz-story .dy-chip b { font-size: 17px; }
    .sz-story .dy-chip i { font-size: 38px; }
    .sz-story .dy-lab { font-size: 21px; width: 214px; }
    .sz-story .dy-val { font-size: 22px; width: 112px; }
    .sz-story .dy-head { font-size: 19px; padding-bottom: 11px; margin-bottom: 14px; }
    .sz-story .dy-row { height: 52px; gap: 14px; }
    .sz-story .dy-rail { height: 22px; border-radius: 8px; }
    /* On a story the label scales with everything else and the longest name
       draws 243px, which would leave the bar 91px of a 459px column. The
       sector labels therefore stay a size behind the movers' — the bar is
       what makes eleven rows readable at a glance, and a sector name is
       read once. */
    .sz-story .dy-grid .dy-lab { width: 228px; font-size: 19px; }
    .sz-story .dy-grid .dy-val { width: 92px; }

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
    /* The how-to's step number, in the Intro icon square so it inherits a box
       already proved on all three grounds. Tokens only — no literal — so the
       light and navy palettes resolve it without an override block. */
    /* 18%, not the Intro chip's 9%. The ground sweep holds a sub-35% fill to
       the VISIBILITY rule (ΔL* ≥ 1.5 against what is behind it) and a 9% tint
       The Intro's step chips, at 9% and 40%, which is what this matches so
       the two decks read as one family. It was briefly raised to 18% on a
       ground-sweep failure that turned out to be the SWEEP misreading
       color-mix output as near-black; measured properly the 9% tint is
       dL* 5.5 against its tile, comfortably over the 1.5 floor.
       NO BACKTICKS IN THIS BLOCK: STYLE is itself a template literal, so one
       inside a CSS comment ends the string and the module stops parsing —
       and node --check passes it, because it is valid syntax. */
    .fi.hnum { font: 700 28px var(--mono); color: var(--accent);
               border-color: color-mix(in srgb, var(--accent) 40%, transparent);
               background: color-mix(in srgb, var(--accent) 9%, transparent); }
    .hwho { margin-top: 30px; padding: 18px 24px; border-radius: 15px;
            border: 1px solid var(--hair); background: rgba(255, 255, 255, 0.028); }
    .hwho b { display: block; font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase;
              color: var(--faint); margin-bottom: 6px; }
    .hwho span { font-size: 20px; color: var(--muted); line-height: 1.45; }
    /* The screen catalogue. Two newspaper columns with each group kept whole,
       so a heading is never orphaned from the names under it. Tokens only, no
       literal: all three grounds resolve with no override block.
       NO BACKTICKS IN THIS BLOCK — STYLE is itself a template literal. */
    .hcat { column-count: 2; column-gap: 36px; margin-top: 28px; }
    .hg { break-inside: avoid; margin: 0 0 20px; }
    .hg b { display: block; font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase;
            color: var(--faint); margin-bottom: 7px; }
    .hg span { display: block; font-size: 20.5px; line-height: 1.42; color: var(--text);
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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
    /* ---- the disclaimer ------------------------------------------------
       Every colour here is a TOKEN and there is not one hex literal, so all
       three grounds resolve with no override block — which is the whole
       lesson of the 76 literals the light ground had to chase down. No
       signal colour either: this card makes no up/down/notice reading. */
    .dc-in { display: flex; flex-direction: column; height: 100%; }
    .dc-list { list-style: none; margin: 38px 0 0; padding: 0; flex: 1;
               display: flex; flex-direction: column; justify-content: space-evenly; gap: 26px; }
    /* The short card is the carousel closer: headings only. It has the whole
       body to itself, so the type GROWS into it rather than four small lines
       floating in a frame — the story layout's lesson, and it matters most
       here because a 1080px card renders about 400px wide in a feed. */
    .dc-short { gap: 30px; justify-content: space-evenly; }
    .dc-short .dc-h { font-size: 42px; }
    .dc-short .dc-n { font-size: 25px; padding-top: 9px; }
    .sz-square .dc-short .dc-h { font-size: 34px; }
    .sz-story .dc-short .dc-h { font-size: 56px; }
    .sz-story .dc-short .dc-n { font-size: 30px; padding-top: 12px; }
    .dc-item { display: grid; grid-template-columns: 62px minmax(0, 1fr);
               align-items: start; gap: 4px; }
    .dc-n { font: 600 21px var(--mono); color: var(--faint);
            font-variant-numeric: tabular-nums; padding-top: 6px; }
    .dc-h { margin: 0; font: 700 31px var(--sans); line-height: 1.22;
            letter-spacing: -0.01em; color: var(--text); }
    .dc-b { margin: 9px 0 0; font: 400 21px/1.5 var(--sans); color: var(--muted); }
    .dc-close { margin: 34px 0 0; padding-top: 22px; border-top: 1px solid var(--hair);
                font: 600 23px var(--sans); color: var(--text);
                display: flex; justify-content: space-between; align-items: baseline; gap: 20px; }
    .dc-where { font: 500 20px var(--mono); color: var(--faint); white-space: nowrap; }
    .sz-square .dc-h { font-size: 27px; }
    .sz-square .dc-b { font-size: 19px; }
    .sz-square .dc-list { gap: 18px; margin-top: 26px; }
    .sz-story .dc-h { font-size: 38px; }
    .sz-story .dc-b { font-size: 26px; margin-top: 12px; }
    .sz-story .dc-n { font-size: 26px; }
    .sz-story .dc-item { grid-template-columns: 76px minmax(0, 1fr); }
    .sz-story .dc-close { font-size: 28px; }
    .sz-story .dc-where { font-size: 24px; }

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
    /* A STORY HAS TO FILL ITS FRAME, the lesson the side-by-side Movers card
       already learned: 1020px of drawing in a 1920px artboard left a band of
       dead black at the foot. The chart is taller here AND the slack is spread
       rather than pooled at the bottom, which is what makes it hold for a long
       company name (whose title wraps to two lines and eats 172px) as well as
       a short one. No constant is asked to know both. */
    .sz-story .s-body > .stk { justify-content: space-between; }
    .sz-story .s-kick { font-size: 21px; margin-top: 30px; }
    .sz-story .s-title { font-size: 84px; }
    .sz-story .s-sub { font-size: calc(var(--fs, 20px) * 1.25); max-width: 34ch; }
    .sz-story .s-foot { font-size: 20px; }
    .sz-story .s-tag { font-size: 18px; }
    .sz-story .s-empty { font-size: 36px; }

    /* the lists spread through the space rather than bunching at the top */
    .sz-story .rows, .sz-story .atally, .sz-story .stmts, .sz-story .flow,
    .sz-story .rungs { flex: 1; justify-content: space-evenly; }
    .sz-story .twocol { flex: 1; }
    /* Side by side on a story: the columns take the height, each row is two
       lines — name and move above, the bar full width beneath — so a name
       gets the column's whole width instead of 92px, and the rows spread
       down the space. The dense post rhythm is overridden: it exists because
       a post has no height to spare, and a story has 570px more. */
    .sz-story .twocol, .sz-story .twocol.dense { gap: 46px; margin-top: 40px; }
    .sz-story .mcol { display: flex; flex-direction: column; }
    .sz-story .mlist { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; }
    .sz-story .twocol .mch, .sz-story .twocol.dense .mch { font-size: 19px; padding-bottom: 12px; margin-bottom: 4px; }
    .sz-story .twocol .mrow, .sz-story .twocol.dense .mrow { flex-wrap: wrap; gap: 9px 12px; margin-bottom: 0; }
    .sz-story .twocol .mrow .ms, .sz-story .twocol.dense .mrow .ms { order: 1; flex: 1 1 0; width: auto; font-size: 28px; }
    .sz-story .twocol .mrow .mv, .sz-story .twocol.dense .mrow .mv { order: 2; width: auto; font-size: 28px; }
    .sz-story .twocol .mrow .bar-rail, .sz-story .twocol.dense .mrow .bar-rail { order: 3; flex: 0 0 100%; height: 16px; border-radius: 6px; }
    .sz-story .twocol.dense .mrow .ms, .sz-story .twocol.dense .mrow .mv { font-size: 25px; }
    .sz-story .twocol.dense .mrow .bar-rail { height: 13px; }
    /* a short list on a story: bigger rows, so five of them read as a card
       rather than five lines floating in a tall frame */
    .sz-story .twocol.few .mrow { gap: 14px 14px; }
    .sz-story .twocol.few .mrow .ms, .sz-story .twocol.few .mrow .mv { font-size: 40px; }
    .sz-story .twocol.few .mrow .bar-rail { height: 30px; border-radius: 9px; }
    .sz-story .twocol.few .mlist { justify-content: space-around; }
    .mpad { visibility: hidden; }
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
    /* The past month, behind the marker: the leg it travelled and a faint tick
       where it started. Both sit UNDER .tdot in source order so today's marker
       is never obscured by its own history. */
    .trk .tleg { position: absolute; top: 3px; bottom: 3px; border-radius: 999px; }
    .trk .tthen { position: absolute; top: 50%; width: 3px; height: 16px;
                  transform: translate(-50%, -50%); border-radius: 2px;
                  background: rgba(255, 255, 255, 0.5); }
    .trk .tdot { position: absolute; top: 50%; width: 22px; height: 22px; border-radius: 50%;
                 transform: translate(-50%, -50%); border: 3px solid var(--card-ground, #050505); }
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
    /* A 1fr TRACK IS minmax(auto, 1fr), AND THAT AUTO FLOOR IS THE
       ITEM'S MIN-CONTENT — so one long company name held its column open and
       the tracks summed PAST the grid, which keeps its own width while its
       tracks spill. Measured before the fix: three tracks of 321/349/455 in
       a 952px body, the third column drawn 142px off a square artboard and
       400px off a story. Reported from a screenshot; every fit sweep here
       measures HEIGHT, so nothing could have caught it.
       ONE MECHANISM, NOT TWO. A min-width:0 on the tile and its header
       fixes this equally well, and shipping both meant each revert came
       back clean while the other quietly held the line — which reads
       exactly like a guard that was never load-bearing. The floor goes on
       the TRACK, inline, where the column count is known. */
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
    /* ---- Size: companies as concentric discs --------------------------
       The discs are laid out by the grid and CENTRED in a square cell, so a
       circle's position never encodes anything — only its area does. Both
       discs are absolutely positioned about the same centre, which is what
       makes them concentric at any pair of sizes. */
    /* The same 1fr floor as the sparks grid, and far worse here: measured
       at 1,607px of spill on a post and 3,060px on a story, because a long
       name under a disc has no ellipsis to shrink into. */
    .zgrid { display: grid; gap: 10px 8px; margin-top: 26px; }
    .zcell { display: flex; flex-direction: column; align-items: center;
             justify-content: flex-end; }
    .zdisc { position: relative; margin: auto auto 12px; }
    .zc { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          border-radius: 50%; display: block; }
    /* The outer disc is a wash with a hairline so a small inner one still
       reads against it; the inner is solid, because the thing being compared
       twice should not be the fainter of the two. */
    .zc.zout { background: rgba(124, 156, 255, 0.20); box-shadow: inset 0 0 0 2px rgba(124, 156, 255, 0.55); }
    .zc.zin { background: var(--green); opacity: .92; }
    .zname { font: 600 21px/1.15 var(--sans); text-align: center; letter-spacing: -0.01em;
             max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .zdot { color: var(--faint); margin-left: 4px; }
    .zval { font: 500 19px/1.3 var(--mono); color: var(--muted); text-align: center; margin-top: 3px; }
    .zval .zi { color: var(--green); margin-left: 9px; }
    /* The third measure is TEXT, in the mono face and quieter than the two
       the circles encode — it is read one company at a time, not compared at
       a glance, and giving it equal weight would suggest otherwise. */
    .zthird { font: 500 17px var(--mono); color: var(--faint); text-align: center; margin-top: 2px; }
    .zkey3 i.ztxt { background: none; box-shadow: none; width: 13px; height: 2px;
                    border-radius: 1px; background: var(--faint); }
    .zlegend { display: flex; gap: 22px; margin-top: 22px; font: 500 19px var(--sans); color: var(--muted); }
    .zkey { display: inline-flex; align-items: center; gap: 9px; }
    .zkey i { width: 16px; height: 16px; border-radius: 50%; display: inline-block; }
    .zkey i.zout { background: rgba(124, 156, 255, 0.20); box-shadow: inset 0 0 0 2px rgba(124, 156, 255, 0.55); }
    .zkey i.zin { background: var(--green); }

    /* ---- Bubble ----------------------------------------------------------
       Three channels — two axes and the area — so the legend is not optional.
       It wraps, because a sector legend on a narrow artboard is otherwise a
       row that runs off the side. NO BACKTICKS IN HERE; see the note below. */
    .blegend { display: flex; flex-wrap: wrap; gap: 10px 20px; margin-top: 18px;
               font: 500 18px var(--sans); color: var(--muted); }
    .bkey { display: inline-flex; align-items: center; gap: 8px; }
    .bkey i { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
    .bkey.bsz { color: var(--text); }
    .bkey.bsz::before { content: ""; width: 17px; height: 17px; border-radius: 50%;
                        border: 2px solid rgba(255, 255, 255, 0.5); display: inline-block; }
    /* The third measure is TEXT, so its key is set in the face it is drawn in
       rather than given a swatch — a colour chip beside it would suggest the
       card encodes it by colour, which is exactly what it does not do. */
    .bkey.btx { font-family: var(--mono); font-size: 16px; }
    /* .s-sub is capped at 40ch, which is right for the templates that set a
       sentence BESIDE a chart. A note that runs UNDER full-width content wants
       the full width too, or it reads as a narrow column stranded in the
       corner with empty space to its right.
       Opt-in per card rather than lifting the cap for everyone: the 40ch
       measure is what keeps the beside-a-chart notes readable.
       Compound with .s-sub on purpose. A bare .wide in this stylesheet would
       be the seventh unscoped class on this project to capture later markup,
       and STYLE is injected into whatever page hosts a card.
       !important because .sz-story .s-sub carries its own max-width at the
       same specificity, and order alone is a fragile way to win that.
       NO BACKTICKS ANYWHERE IN HERE: STYLE is itself a template literal, so
       one inside a comment ends the string and the whole module stops
       parsing. */
    .s-sub.wide { max-width: none !important; }
    .sz-story .zname { font-size: 25px; }
    .sz-story .zval { font-size: 22px; }
    .sz-story .zthird { font-size: 19px; }
    .sz-story .zlegend { font-size: 22px; }
    .sz-square .zname { font-size: 19px; }
    .sz-square .zval { font-size: 17px; }

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
    /* THE MARK IS THE ONE HARDCODED SIGNAL COLOUR IN THIS STYLESHEET, and a
       token override cannot reach a literal: #34d399 is 1.8:1 on the light
       ground, so the whole card was a faint smudge there. It is the token
       now, which is byte-identical on dark and navy (both #34d399) and the
       darkened #157a51 on light. The sweep could not see it either — that
       instrument reads backgrounds and borders, and this is a STROKE. */
    .avMark { position: relative; width: 46%; height: 46%; stroke: var(--green); fill: none;
              stroke-width: 1.45; stroke-linecap: round; stroke-linejoin: round;
              filter: drop-shadow(0 0 26px rgba(52, 211, 153, 0.5)); }

    /* ---- Flow: the one-step alluvial -------------------------------------
       (No backticks in here. STYLE is a template literal and one inside a
       CSS comment ends the string -- the FOURTH time on this file, and
       node --check passes it every time, because it is valid interpolation
       rather than a syntax error.)

       fl-in fills the body the way dy-in does, and the note takes
       margin-top: auto so the slack collects in ONE place, between the
       drawing and the footnote, instead of the body centring a short block
       and stranding half the room above the kicker -- the two empty bands
       the day card had to be rebuilt for.

       The wrap is a plain flex ROW of three tracks summing to the body's
       own 952px. Each takes its width INLINE, from the same map the svg's
       own width comes from, so the three cannot sum to anything else -- and
       with flex: none beside it the item never shrinks, so the min-width:
       auto content floor cannot bind and one 22-character sector name
       cannot push the drawing off the artboard. (min-width: 0 was here as
       well and reverted to NOTHING: two mechanisms for one thing, which is
       the trap this file records elsewhere. The floor HAS bitten the trade
       log, the sparks grid and the saved-name field -- it is disarmed here
       by the explicit width, not by luck, and anything that makes these
       tracks flexible has to put it back.) */
    .fl-in { height: 100%; display: flex; flex-direction: column; }
    /* THE SUBTITLE IS A SUBTITLE. Inside .s-title a .dim span inherits the
       66px display size, which is right for the Snapshot's one-word period
       and wrong here: "and how each sector has done this year" WRAPS at that
       size, so the heading took THREE lines and 202px of a card whose whole
       content is a drawing. Measured, not guessed. */
    .fl-in .s-title .dim { display: block; font-size: 32px; letter-spacing: -0.02em;
                           margin-top: 12px; line-height: 1.15; }
    .sz-square .fl-in .s-title .dim { font-size: 29px; }
    .sz-story .fl-in .s-title .dim { font-size: 40px; }
    .fl-in .s-sub { margin-top: auto; padding-top: 24px; }
    .fl-wrap { display: flex; align-items: stretch; margin-top: 30px; flex: none; }
    .fl-side { position: relative; flex: none; }
    .fl-svg { flex: none; display: block; }
    /* A label is positioned on its node's CENTRE and pulled back half its own
       height, so a node and its name cannot drift apart as the column is
       re-proportioned. Absolute, because the nodes are spaced by market value
       and no flow layout can reproduce that. */
    .fl-lab { position: absolute; right: 16px; transform: translateY(-50%);
              display: flex; align-items: baseline; gap: 10px; left: 0;
              justify-content: flex-end; padding-left: 4px; }
    .fl-lab b { font: 600 17px var(--sans); letter-spacing: -0.015em;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                min-width: 0; }
    .fl-lab i { font: 600 16px var(--mono); font-style: normal; flex: none;
                font-variant-numeric: tabular-nums; color: var(--muted); }
    .fl-lab i.up { color: var(--green); } .fl-lab i.dn { color: var(--red); }
    /* The pooled tail is a real basket with a real return and is banded like
       any other, so it is not dimmed -- only italicised, because it is the
       one row that is not an industry. */
    .fl-rest b { font-style: italic; font-weight: 500; }
    /* The right column reads the other way: the band name first, its share
       under it, both left-aligned off the node. */
    .fl-r .fl-lab { right: auto; left: 16px; justify-content: flex-start;
                    flex-direction: column; align-items: flex-start; gap: 3px;
                    padding-left: 0; padding-right: 4px; }
    .fl-r .fl-lab b { white-space: normal; font-size: 20px; }
    .fl-r .fl-lab i { font-size: 15px; color: var(--faint); }
    /* SCOPED. Nine unscoped class names on this project have captured
       later markup -- .warn, .card, input[type=text], .mk, .sub, .news-when,
       .fav, .bezel > .core and the Evolution card's title steps, which was
       the same trap from the other side. These are only ever on the band
       name, so that is what they name. */
    .fl-r .fl-lab b.fl-ahead { color: var(--green); }
    .fl-r .fl-lab b.fl-down { color: var(--red); }
    .fl-r .fl-lab b.fl-behind { color: var(--muted); }
    /* The drill's names run to 40 characters, so they are set smaller and
       given a wider track. Measured, and the clip check in the suite is
       what holds it: the 138 industry names are a FIXED SET, so an ellipsis
       here is a width bug rather than the unavoidable thing it is on a
       company name.
       THE CLASS IS ON THE WRAP, not the left side -- .fl-r is a SIBLING of
       that side, so a class there cannot reach the band labels, and the
       drill's longer sub ("N industries" against "N sectors") is exactly
       what needs them.
       The .sz-story rules below are UNDOING that artboard's own bumps, not
       adding any: they have to be at (0,3,1) and (0,4,1) to beat the
       .sz-story rules further down, which tie with a bare .fl-drill. */
    .fl-drill .fl-lab b { font-size: 15px; }
    .sz-story .fl-drill .fl-lab b { font-size: 15px; }
    .sz-story .fl-drill .fl-lab i { font-size: 16px; }
    .sz-story .fl-drill .fl-r .fl-lab b { font-size: 20px; }
    .sz-story .fl-drill .fl-r .fl-lab i { font-size: 15px; }
    .sz-square .fl-lab b { font-size: 15px; }
    .sz-square .fl-lab i { font-size: 14px; }
    .sz-square .fl-r .fl-lab b { font-size: 18px; }
    .sz-square .fl-wrap { margin-top: 22px; }
    .sz-story .fl-lab b { font-size: 19px; }
    .sz-story .fl-lab i { font-size: 17px; }
    /* 22, not 25: at 25px "Down over the window" needs 232px and the story's
       own track cannot hold it beside a left column wide enough for a
       22-character sector name at 20px. Measured both ways. */
    .sz-story .fl-r .fl-lab b { font-size: 22px; }
    .sz-story .fl-r .fl-lab i { font-size: 17px; }
    .sz-story .fl-wrap { margin-top: 44px; }

    .s-empty { margin-top: 60px; font-size: 30px; color: var(--muted); line-height: 1.5; max-width: 30ch; }`;

  function injectStyle() {
    if (document.getElementById('cards-style')) return;
    const el = document.createElement('style');
    el.id = 'cards-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  global.Cards = {
    STYLE, injectStyle,
    // The moving averages the chart card offers, and what the host must
    // fetch for one — both exported so the studio's picker and the
    // server's saved-post builder read the SAME catalogue rather than
    // restating it, the way CHART_WINDOWS already is.
    CHART_MAS, chartHistoryNeed,
    // Which stock and how many years the Evolution card wants. Asked of the
    // module by the studio AND by the phone's saved-post route, so the two
    // cannot ask for different things — the pairing `basketDays` records.
    evolutionNeed,
    shortMovesNeed,
    // The floors, so the studio's picker has no copy of them to drift from.
    shortMoveFloors: () => Object.keys(SMOV_FLOORS)
      .map(Number).sort((a, b) => a - b).map((v) => [v, SMOV_FLOORS[v]]),
    // The two level metrics, so the studio builds its picker from the
    // catalogue the CARD reads rather than from a copy in the markup: a
    // host sending a key the module does not know would fall back to
    // "% of float" in SILENCE, which is the quiet-fallback class this
    // module exists to keep out.
    shortedMetrics: () => Object.keys(SHRT_METRICS)
      .map((k) => [k, SHRT_METRICS[k][1]]),
    EVO_WINDOWS,
    EVO_MEASURES,
    // Which classes the artboard needs for the chosen ground. Three hosts
    // draw an .s-art and none of them holds the palette; see themeOf.
    // Takes the TEMPLATE as well as the options, because which control
    // holds the ground depends on which card is being drawn.
    themeClass: (tpl, opts) => themeOf(tpl, opts).cls,
    sectorEtfs: () => SECTOR_ETF.map((s) => s.slice()),
    // The S&P 500 cut as [value, label] pairs, for the studio's pickers.
    spCuts: () => SP_CUTS.map((c) => c.slice()),
    breadthModes: () => BRD_MODES.map((x) => x.slice()),
    capBands: () => BRD_CAP_ORDER.slice(),
    // The Snapshot's periods as [value, label] pairs. Exported for the
    // reason spCuts is: a copy in the markup could offer a key tplDay does
    // not know, which falls back to Today and filters nothing -- a picker
    // that silently draws the wrong window.
    snapPeriods: () => SNAP_PERIODS.map((p) => p.slice()),
    // ...and which templates want the basket at all, with the window each
    // one asks for. Exported for the same reason: two hosts, one pairing.
    basketDays,
    // The studio builds its measure picker from this, so a key the
    // module does not know can never reach the card -- where it would
    // fall back and draw a DIFFERENT measure under the chosen heading,
    // which is the silent-fallback hazard CHART_WINDOWS records.
    histMeasures: () => HIST_MEASURES.map(([k, t, s]) => [k, t, s]),
    ids: Object.keys(BUILDERS),
    ADV_PROFILES,
    MOV_PERIODS,
    // The measures the Bubble card can put on an axis or in the area, as
    // [key, label] pairs. Exported so the studio builds its three pickers from
    // the SAME catalogue the card reads — a copy in the markup would drift the
    // first time a measure was added, which is the drift this module exists to
    // prevent. Money measures are marked so a host can say so if it wants to.
    bubbleMeasures: () => Object.keys(FUND_METRICS)
      .map((k) => ({ key: k, label: FUND_METRICS[k][1], kind: FUND_METRICS[k][2] })),
    // the sectors actually present, so a picker can never offer an empty one
    sectors: (rows) => [...new Set((rows || []).map((x) => x.sector).filter(Boolean))].sort(),
    // the industries present, inside one sector when one is given
    industries: (rows, sector) => [...new Set((rows || [])
      .filter((x) => !sector || sector === 'All' || x.sector === sector)
      .map((x) => x.industry).filter(Boolean))].sort(),
    CHART_WINDOWS,
    // The four index funds as [symbol, label]. Exported so a test can assert
    // this list is the same set server.js guards, rather than the two copies
    // drifting in silence.
    benchmarks: () => BENCH.map((b) => b.slice()),
    // shape only — the host builds its own slide picker from this
    topics: () => TOPICS.map((t) => ({ id: t.id, name: t.name, slides: t.slides.map((sl) => sl.kind) })),
    // The studio builds its two pickers from this, so a topic or a slide
    // added above appears there with no second edit.
    // THE SLIDE CARRIES ITS OWN LABEL, so the studio's picker needs no
    // kind-to-label map of its own. It had one, with a bare `: kind` fallback
    // — which means a slide kind added here reads as `4. hnames` in the
    // dropdown until somebody remembers to edit a second file. The module
    // defines the slides, so the module names them.
    howtos: () => HOWTOS.map((t) => ({
      id: t.id, name: t.name,
      slides: t.slides.map((sl) => ({ kind: sl.kind, label: sl.label || HOW_SLIDE_LABEL[sl.kind] || sl.kind })),
    })),
    build(id, ctx) {
      const c = ctx || {};
      stocks = c.stocks || [];
      // The freshest bar anyone has: what the numbers on the card describe.
      marketDay = stocks.reduce((m, x) => (x && x.latestDate && x.latestDate > m ? x.latestDate : m), '') || null;
      // When those prices were pulled. A host that does not know says nothing,
      // rather than the card inventing a time.
      pulledAt = c.updatedAt || null;
      myLists = c.myLists || {};
      screens = Array.isArray(c.screens) ? c.screens : [];
      filers = (c.filers && typeof c.filers === 'object') ? c.filers : {};
      size = c.size || { id: 'portrait', w: 1080, h: 1350 };
      O = c.opts || {};
      pal = themeOf(id, O);
      getBasket = c.getBasket || (() => null);
      getHistory = c.getHistory || (() => null);
      getEvolution = c.getEvolution || (() => null);
      getShortMoves = c.getShortMoves || (() => null);
      chartOne = c.chart || null;
      const fn = BUILDERS[id] || BUILDERS.movers;
      return fn();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
// Loadable in Node as well as the browser (2026-09-16): the server builds a
// saved preset's card the same way it builds a phone row, so the phone gets
// finished markup instead of the whole snapshot. Nothing at load time touches
// the DOM — only injectStyle() does, and only a browser host calls it.
