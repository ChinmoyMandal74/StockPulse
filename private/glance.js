// At a glance: one stock summed up topic by topic, for the top of /stock/<SYM>.
// Pure and shared (the filters.js shape): server.js builds the cards from the
// snapshot it already holds, because a comparison needs every company's
// figures and the page is sent only one row; the page draws what comes back.
//
// THE OWNER'S BRIEF (2026-10-15): the stock page has grown very big, so a
// highlight section summing up short-term price, long-term price, growth and
// profitability, the short position and so on. "No need of light .. arrows ok".
//
// DESCRIPTIVE, NEVER A VERDICT. An arrow says where the stock SITS: up or
// down for a price, rising or falling for a flow, high or low against a named
// group for a level. It never says good or bad, nothing adds the arrows up,
// and nothing here is read by the Signal. Green and red appear only on the two
// price cards, where they mean what they mean everywhere on this site: the
// price went up or down. Amber is only "this figure is old".
//
// THE COMPARISON GROUP is the company's industry where at least MIN_GROUP
// companies in it carry the figure, otherwise every company tracked; the card
// names which. Funds are never in a group.
(function (root) {
  'use strict';

  const MIN_GROUP = 5;
  const STALE_DAYS = 30;          // a short-interest settlement older than this is flagged
  const TONE_BAND = 0.25;         // Tone 7D's own band (newstone.js BAND)
  const TONE_MIN = 3;             // articles a company needs to count in the comparison

  const ok = (v) => v != null && v !== '' && isFinite(Number(v));
  const num = (v) => (ok(v) ? Number(v) : null);
  const isFund = (r) => !r || r.error || r.instrumentType === 'ETF';

  // ---- wording -------------------------------------------------------------
  const pct = (v, d) => {
    const a = Math.abs(v);
    return (a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(d == null ? (a >= 100 ? 0 : 1) : d)) + '%';
  };
  const move = (v) => (v > 0 ? 'up ' : v < 0 ? 'down ' : 'flat, ') + pct(v);
  const times = (v) => Number(v).toFixed(Number(v) >= 100 ? 0 : 1) + '×';
  function money(v, cur) {
    const a = Math.abs(v), sign = v < 0 ? '−' : '';
    const s = a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(1) + 'B'
      : a >= 1e6 ? (a / 1e6).toFixed(0) + 'M' : Math.round(a).toLocaleString('en-US');
    return sign + (!cur || cur === 'USD' ? '$' : cur + ' ') + s;
  }
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // Local noon, never a bare ISO date (which is UTC midnight, a day early here).
  const day = (iso) => {
    if (!iso) return null;
    const t = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    return isNaN(t.getTime()) ? null : t;
  };
  const shortDay = (iso) => {
    const t = day(iso);
    return t ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  };

  // ---- the comparison -------------------------------------------------------
  // Where `v` falls in the group's values for `field`: the share of the group
  // below it, and the words for that. `keep` filters the values that count
  // (a multiple off a loss is not a cheap multiple).
  function standing(stock, stocks, field, keep) {
    const v = num(stock[field]);
    if (v == null) return null;
    const take = (r) => !isFund(r) && ok(r[field]) && (!keep || keep(Number(r[field])));
    if (keep && !keep(v)) return null;
    let pool = stock.industry ? stocks.filter((r) => r.industry === stock.industry && take(r)) : [];
    let group = stock.industry;
    if (pool.length < MIN_GROUP) { pool = stocks.filter(take); group = null; }
    if (pool.length < MIN_GROUP) return null;
    const below = pool.filter((r) => Number(r[field]) < v).length;
    const same = pool.filter((r) => Number(r[field]) === v).length;
    const p = (below + Math.max(0, same - 1) / 2) / Math.max(1, pool.length - 1);
    const where = p >= 0.75 ? 'top' : p <= 0.25 ? 'bottom' : 'middle';
    const name = group || 'every company tracked';
    const words = where === 'middle' ? `in the middle half of ${name}`
      : `${where === 'top' ? 'higher' : 'lower'} than three quarters of ${name}`;
    return { p, where, words, group: name, n: pool.length };
  }
  const arrowOf = (st) => (!st ? null : st.where === 'top' ? 'up' : st.where === 'bottom' ? 'down' : 'flat');
  const signArrow = (v, band) => (v == null ? null : v > band ? 'up' : v < -band ? 'down' : 'flat');

  // ---- the cards ------------------------------------------------------------
  function build(stock, stocks) {
    const s = stock || {};
    const all = Array.isArray(stocks) ? stocks : [];
    const cards = [];
    const add = (c) => { if (c && c.text) cards.push(c); };
    const join = (parts) => parts.filter(Boolean).join(' ');

    // Short-term price
    {
      const d = num(s.todayPct), w = num(s.oneWeekPct), m = num(s.oneMonthPct);
      const v50 = num(s.vs50ma), rsi = num(s.rsi), vx = num(s.volX);
      const bits = [];
      const runs = [d != null && move(d) + ' today', w != null && move(w) + ' over the week', m != null && move(m) + ' over the month']
        .filter(Boolean);
      if (runs.length) bits.push(cap(runs.join(', ')) + '.');
      if (v50 != null) bits.push(pct(v50) + (v50 >= 0 ? ' above' : ' below') + ' its 50-day average.');
      if (rsi != null) bits.push('RSI ' + rsi.toFixed(0) + (rsi >= 70 ? ', in the range usually called overbought.' : rsi <= 30 ? ', in the range usually called oversold.' : '.'));
      if (vx != null && vx >= 1.5) bits.push('Volume ' + vx.toFixed(1) + '× its 20-day average today.');
      add({ id: 'short', title: 'Short-term price', jump: 'price', tone: 'price',
        arrow: signArrow(m != null ? m : w, 2), text: join(bits) });
    }

    // Long-term price
    {
      const y = num(s.oneYearPct), y5 = num(s.fiveYearPct), ytd = num(s.ytdPct);
      const v200 = num(s.vs200ma), hi = num(s.pctFromHigh);
      const bits = [];
      const runs = [y != null && move(y) + ' over the past year', ytd != null && move(ytd) + ' this year',
        y5 != null && move(y5) + ' over five years'].filter(Boolean);
      if (runs.length) bits.push(cap(runs.join(', ')) + '.');
      if (v200 != null) bits.push(pct(v200) + (v200 >= 0 ? ' above' : ' below') + ' its 200-day average.');
      if (hi != null) bits.push(hi > -0.5 ? 'At its 52-week high.'
        : pct(hi) + ' below its 52-week high' + (s.ddState ? ' (' + String(s.ddState).toLowerCase() + ').' : '.'));
      add({ id: 'long', title: 'Long-term price', jump: 'dd', tone: 'price',
        arrow: signArrow(y, 5), text: join(bits) });
    }

    // Momentum and trend (2026-10-21, the owner: "add one more card on the At
    // a glance section", this topic chosen). The trend reading the Trend
    // column shows, where the 50-day average sits against the 200-day and
    // since when, and the three months against the S&P 500. Plain words, not
    // the MA cross column's Bullish/Bearish. The arrow is ahead of or behind
    // the market: a comparison, so a topic colour, never green or red.
    {
      const tw = s.actionTrend ? String(s.actionTrend) : null;
      const rs = num(s.relStrength), days = num(s.maCrossDays);
      const bits = [];
      if (tw) bits.push('On the trend ladder, from Breakdown to Strong uptrend, it reads ' + tw + '.');
      if (s.maBullish === true || s.maBullish === false) {
        bits.push('The 50-day average is ' + (s.maBullish ? 'above' : 'below') + ' the 200-day'
          + (days != null ? '; it crossed ' + (s.maBullish ? 'above' : 'below') + ' ' + days + ' session' + (days === 1 ? '' : 's') + ' ago.' : '.'));
      }
      if (rs != null) bits.push('Over three months ' + (Math.abs(rs) < 0.5 ? 'about level with' : pct(rs) + (rs > 0 ? ' ahead of' : ' behind')) + ' the S&P 500.');
      add({ id: 'trend', title: 'Momentum and trend', jump: 'price', tone: 'neutral',
        arrow: signArrow(rs, 2), text: join(bits) });
    }

    // Growth
    {
      const rg = num(s.revenueGrowthYoY), eg = num(s.earningsGrowthYoY);
      const st = standing(s, all, 'revenueGrowthYoY');
      const bits = [];
      if (rg != null) bits.push('Revenue ' + move(rg) + ' on the same quarter a year ago' + (eg != null ? '; earnings ' + move(eg) + '.' : '.'));
      else if (eg != null) bits.push('Earnings ' + move(eg) + ' on the same quarter a year ago.');
      if (st) bits.push('Revenue growth is ' + st.words + '.');
      add({ id: 'growth', title: 'Growth', jump: 'perf', tone: 'neutral', arrow: arrowOf(st), text: join(bits),
        basis: st && st.group });
    }

    // Profitability
    {
      const pm = num(s.profitMargin), gm = num(s.grossMargin), om = num(s.operatingMargin), fm = num(s.fcfMargin);
      const chg = num(s.netMarginChg);
      const st = standing(s, all, 'profitMargin');
      const lead = [pm != null && 'Profit margin ' + (pm < 0 ? '−' : '') + pct(pm),
        om != null && 'operating ' + (om < 0 ? '−' : '') + pct(om),
        gm != null && s.sector !== 'Financial Services' && 'gross ' + pct(gm)].filter(Boolean);
      const bits = [];
      if (lead.length) bits.push(lead.join(', ') + '.');
      if (fm != null) bits.push('Free cash flow ' + (fm < 0 ? '−' : '') + pct(fm) + ' of revenue.');
      if (chg != null && Math.abs(chg) >= 0.5) bits.push('Net margin ' + (chg > 0 ? 'up ' : 'down ') + Math.abs(chg).toFixed(1) + ' points on a year earlier.');
      if (st) bits.push('Profit margin is ' + st.words + '.');
      add({ id: 'profit', title: 'Profitability', jump: 'perf', tone: 'neutral', arrow: arrowOf(st), text: join(bits),
        basis: st && st.group });
    }

    // Valuation
    {
      const fpe = num(s.forwardPe), tpe = num(s.trailingPe), rel = num(s.peerPe);
      const ps = num(s.priceToSales), ev = num(s.evToEbitda);
      const pos = (v) => v > 0;
      const st = standing(s, all, 'forwardPe', pos);
      const bits = [];
      if (fpe != null && fpe > 0) bits.push('Forward P/E ' + times(fpe) + (rel != null && rel > 0 ? ', ' + rel.toFixed(2) + '× its industry’s median.' : '.'));
      else if (tpe != null && tpe > 0) bits.push('Trailing P/E ' + times(tpe) + '.');
      else if (fpe != null || tpe != null) bits.push('No P/E: earnings are negative.');
      const more = [ps != null && ps > 0 && 'price to sales ' + times(ps), ev != null && ev > 0 && 'EV/EBITDA ' + times(ev)].filter(Boolean);
      if (more.length) bits.push(cap(more.join(', ')) + '.');
      if (st) bits.push('Its forward P/E is ' + st.words + '.');
      add({ id: 'value', title: 'Valuation', jump: 'peers', tone: 'neutral', arrow: arrowOf(st), text: join(bits),
        basis: st && st.group });
    }

    // Volatility (2026-10-19, the owner: "how do we show individual stock
    // volatility"). How much it moves, against its industry; how much with the
    // market; and whether the last three months were calmer or wilder than its
    // year. The arrow is where the year's volatility sits in the group: up is
    // MORE volatile, which is a description, not a warning. Funds are compared
    // with nobody (standing() leaves them out), so a fund's card has no arrow.
    {
      const v = num(s.vol1y), v3 = num(s.vol3m), b = num(s.beta), bad = num(s.badDay);
      // A fund is compared with nobody: an index fund among companies would
      // read "less volatile than three quarters" for being diversified.
      const st = isFund(s) ? null : standing(s, all, 'vol1y');
      const bits = [];
      if (v != null) bits.push('Moves about ' + pct(v, 0) + ' a year' + (st ? ', ' + st.words.replace(/^higher/, 'more volatile').replace(/^lower/, 'less volatile') : '') + '.');
      if (v != null && v3 != null && v > 0) {
        const r = v3 / v;
        bits.push(r >= 1.25 ? 'Wilder lately: ' + pct(v3, 0) + ' a year over the last three months.'
          : r <= 0.8 ? 'Calmer lately: ' + pct(v3, 0) + ' a year over the last three months.'
          : 'The last three months about the same, at ' + pct(v3, 0) + '.');
      }
      if (b != null) bits.push('Beta ' + b.toFixed(2) + ': on a day the S&P 500 moved 1%, it has tended to move ' + Math.abs(b).toFixed(1) + '%' + (b < 0 ? ', the other way.' : '.'));
      if (bad != null && bad < 0) bits.push('One day in twenty fell ' + pct(Math.abs(bad), 1) + ' or more.');
      add({ id: 'vol', title: 'Volatility', jump: 'price', tone: 'neutral', arrow: arrowOf(st), text: join(bits),
        basis: st && st.group });
    }

    // Balance sheet
    {
      // Net cash means nothing for a lender, whose deposits are its debt: the
      // rule every card on the site keeps for Financial Services.
      const fin = s.sector === 'Financial Services';
      const nc = fin ? null : num(s.netCash), cr = num(s.currentRatio), de = num(s.debtToEquity);
      const bits = [];
      if (nc != null) bits.push(nc >= 0 ? 'Net cash of ' + money(nc, s.currency) + ': more cash than debt.' : 'Net debt of ' + money(-nc, s.currency) + ': more debt than cash.');
      const more = [cr != null && 'current ratio ' + cr.toFixed(1), de != null && 'debt to equity ' + de.toFixed(1)].filter(Boolean);
      if (more.length) bits.push(cap(more.join(', ')) + '.');
      add({ id: 'balance', title: 'Balance sheet', jump: 'stmt', tone: 'neutral',
        arrow: nc == null ? null : nc > 0 ? 'up' : 'down', text: join(bits) });
    }

    // Short position
    {
      const sp = num(s.shortPctFloat), dtc = num(s.shortRatio), sb = num(s.shortBuild);
      const st = standing(s, all, 'shortPctFloat');
      const bits = [];
      if (sp != null) bits.push(pct(sp) + ' of the float is sold short' + (st ? ', ' + st.words : '') + '.');
      if (dtc != null) bits.push(dtc.toFixed(1) + ' days to cover.');
      if (sb != null) bits.push('Shares short ' + (Math.abs(sb) < 0.5 ? 'about unchanged' : (sb > 0 ? 'up ' : 'down ') + pct(sb)) + ' in the latest report'
        + (s.shortBuildTo ? ' (to ' + shortDay(s.shortBuildTo) + ').' : '.'));
      const to = day(s.shortBuildTo);
      const stale = to ? (Date.now() - to.getTime()) / 86400000 > STALE_DAYS : false;
      add({ id: 'shortpos', title: 'Short position', jump: 'sint', tone: 'neutral',
        arrow: signArrow(sb, 2), text: join(bits), stale: stale ? 'The latest short report is over a month old.' : null });
    }

    // Insiders and owners
    {
      const net = num(s.insiderNet), buy = num(s.insiderBuyers), sell = num(s.insiderSellers);
      const inst = num(s.institutionPct), ins = num(s.insiderPct), chg = num(s.instChange);
      const bits = [];
      if (buy || sell) {
        bits.push('Over the last 90 days ' + (buy || 0) + ' insider' + (buy === 1 ? '' : 's') + ' bought and '
          + (sell || 0) + ' sold on the open market' + (net != null ? ', net ' + (net > 0 ? 'buying' : net < 0 ? 'selling' : 'even') + '.' : '.'));
      } else if (net == null && s.insiderSince) {
        // Only where the insider file was read for this row: a row with no
        // insider data at all says nothing, rather than "no trades".
        bits.push('No open-market insider trades since ' + shortDay(s.insiderSince) + '.');
      }
      const own = [inst != null && 'institutions hold ' + pct(inst), ins != null && 'insiders ' + pct(ins, 1)].filter(Boolean);
      if (own.length) bits.push(cap(own.join(', ')) + '.');
      if (chg != null && Math.abs(chg) >= 0.5) bits.push('13F managers ' + (chg > 0 ? 'added ' : 'cut ') + pct(chg) + ' last quarter.');
      add({ id: 'owners', title: 'Insiders and owners', jump: 'ins', tone: 'neutral',
        arrow: net == null ? null : net > 0 ? 'up' : net < 0 ? 'down' : 'flat', text: join(bits) });
    }

    // EARNINGS and GUIDANCE, two cards (2026-10-26, the owner: "Remove signal
    // and seperate Earning and guidance"; one card "Earnings and guidance"
    // from 2026-10-23 before that). From the newest results release (the er-
    // fields /api/stock adds from ReleaseView.fields).
    //   Earnings  when it reported, revenue and EPS on a year ago, the reported
    //             EPS against the estimate in a word (erVsEstWord), the next
    //             date only when it falls after that report. Without a
    //             release, the next date and the last surprise. Arrow: Above
    //             up, Below down, In line level (else the surprise's sign).
    //   Guidance  the change the company states, in its words; the guide's
    //             reading (full-year EPS against the year before, else next
    //             quarter's revenue against this one). Only with a release.
    //             Arrow: raised up, lowered or withdrawn down, reaffirmed level.
    {
      const sur = num(s.lastSurprise);
      const bits = [];
      const rel = s.erFiled ? s : null;
      if (rel) {
        const ch = [];
        if (num(rel.erRevYoY) != null) ch.push('revenue ' + move(num(rel.erRevYoY)));
        const ey = num(rel.erEpsYoY) != null ? num(rel.erEpsYoY) : num(rel.erEpsAdjYoY);
        if (ey != null) ch.push((num(rel.erEpsYoY) != null ? 'EPS ' : 'adjusted EPS ') + move(ey));
        bits.push('Reported ' + (rel.erPeriodLabel ? rel.erPeriodLabel + ' ' : '') + 'on ' + shortDay(rel.erFiled) + (ch.length ? ': ' + ch.join(', ') + ' on a year ago.' : '.'));
        if (rel.erVsEstWord) bits.push('EPS came in ' + (rel.erVsEstWord === 'In line' ? 'in line with' : rel.erVsEstWord.toLowerCase()) + ' the estimate.');
        if (s.nextEarningsDate && s.nextEarningsDate > rel.erFiled) bits.push('Next report ' + shortDay(s.nextEarningsDate) + (s.nextEarningsEstimated ? ' (estimated).' : '.'));
      } else {
        if (s.nextEarningsDate) bits.push('Next report ' + shortDay(s.nextEarningsDate) + (s.nextEarningsEstimated ? ' (estimated).' : '.'));
        if (sur != null) bits.push('Last report ' + (sur > 0 ? 'beat' : sur < 0 ? 'missed' : 'met') + ' the estimate' + (sur ? ' by ' + pct(sur) : '') + '.');
      }
      const vw = rel && rel.erVsEstWord;
      const arrow = vw ? (vw === 'Above' ? 'up' : vw === 'Below' ? 'down' : 'flat')
        : rel ? null : sur == null ? null : sur > 0 ? 'up' : sur < 0 ? 'down' : 'flat';
      add({ id: 'earn', title: 'Earnings', jump: rel ? 'rels' : 'earn', tone: 'neutral', arrow, text: join(bits) });

      if (rel) {
        const gb = [];
        if (rel.erGuideChange) {
          const q = String(rel.erGuideChangeQuote || '');
          const qq = q.length > 140 ? q.slice(0, 137).replace(/\s+\S*$/, '') + '…' : q;
          // No second full stop after a quote that already ends in one.
          gb.push('Guidance ' + rel.erGuideChange.toLowerCase() + (qq ? ': “' + qq + '”' + (/[.!?…]$/.test(qq) ? '' : '.') : '.'));
        } else if (rel.erGuide) gb.push('Guidance given, no change stated.');
        else gb.push('No guidance in the latest results release.');
        if (num(rel.erEpsGuideVsFy) != null) gb.push('Full-year EPS guide ' + move(num(rel.erEpsGuideVsFy)) + ' on the year before.');
        else if (num(rel.erGuideVsQ) != null) gb.push('Next quarter’s revenue guide ' + move(num(rel.erGuideVsQ)) + ' on this quarter.');
        const gc = rel.erGuideChange ? String(rel.erGuideChange).toLowerCase() : null;
        add({ id: 'guide', title: 'Guidance', jump: 'rels', tone: 'neutral',
          arrow: gc ? (gc === 'raised' ? 'up' : gc === 'lowered' || gc === 'withdrawn' ? 'down' : gc === 'reaffirmed' ? 'flat' : null) : null, text: join(gb) });
      }
    }

    // The Signal, as it stands, with the rule that fired. Shown, not judged.
    if (s.action) {
      add({ id: 'signal', title: 'Signal', jump: 'price', tone: 'signal', arrow: null, signal: s.action,
        text: s.action + (s.actionFlag && s.actionFlag !== s.action ? ': ' + String(s.actionFlag).replace(/^[^:]*:\s*/, '') : '') + '.' });
    }

    // Article tone (2026-10-26, the owner: the 13th card). The seven-day
    // average of an AI model's reading of each article mainly about the
    // company (Tone 7D), from the stored figure the host lays on the rows; for
    // members only, so a guest's row carries none and the card is not drawn.
    // The arrow is the reading's own lean (+/-0.25, the band Tone 7D colours
    // by), never good or bad; the comparison is against the industry's
    // companies with at least TONE_MIN articles read.
    {
      const a = num(s.toneAvg), nArt = num(s.toneN);
      if (a != null && nArt != null && nArt > 0) {
        const lean = a >= TONE_BAND ? 'leaning positive' : a <= -TONE_BAND ? 'leaning negative' : 'about neutral';
        const bits = [nArt + ' article' + (nArt === 1 ? '' : 's') + ' read in the last seven days'
          + (num(s.tonePos) != null && num(s.toneNeg) != null ? ': ' + s.tonePos + ' positive, ' + s.toneNeg + ' negative.' : '.')];
        bits.push('Average ' + (a > 0 ? '+' : a < 0 ? '−' : '') + Math.abs(a).toFixed(2) + ' on a scale of −1 to +1, ' + lean + '.');
        const st = nArt >= TONE_MIN ? standing(s, all.filter((r) => num(r.toneN) != null && num(r.toneN) >= TONE_MIN), 'toneAvg') : null;
        if (st) bits.push('The tone is ' + st.words + '.');
        bits.push('What was written, not a forecast.');
        add({ id: 'tone', title: 'Article tone', jump: 'tone', tone: 'neutral', arrow: signArrow(a, TONE_BAND - 1e-9), text: join(bits), basis: st && st.group });
      }
    }

    // Capital returns (2026-10-26): what goes back to shareholders. Dividend
    // yield and its record, the buyback yield, the share count's change on a
    // year earlier, and shareholder yield (dividend plus buyback, worked out
    // here from the two so the comparison rows need nothing else) against the
    // industry. The arrow is the share count: shrinking down, growing up.
    {
      const dy = num(s.divYield), by = num(s.buybackYield), sc = num(s.sharesChg), po = num(s.payoutRatio);
      const sy = dy != null && by != null ? dy + by : null;
      const bits = [];
      if (dy != null && dy > 0) bits.push('Dividend yield ' + pct(dy) + (po != null && po > 0 ? ', ' + pct(po, 0) + ' of earnings paid out' : '')
        + (num(s.divStreak) > 0 ? '; raised ' + s.divStreak + ' year' + (s.divStreak === 1 ? '' : 's') + ' in a row' + (s.divSince ? ' since ' + s.divSince : '') : num(s.divStreak) === 0 ? '; not raised in the latest year' : '') + '.');
      else if (dy != null) bits.push('No dividend.');
      if (by != null) bits.push(by > 0.05 ? 'Buybacks worth ' + pct(by) + ' of its market value over the latest year.' : 'No buybacks to speak of over the latest year.');
      if (sc != null) bits.push('Share count ' + (Math.abs(sc) < 0.5 ? 'about level' : (sc < 0 ? 'down ' : 'up ') + pct(sc)) + ' on a year earlier' + (sc >= 0.5 ? ' (dilution).' : '.'));
      const pool = all.map((r) => (num(r.divYield) != null && num(r.buybackYield) != null ? Object.assign({}, r, { _sy: num(r.divYield) + num(r.buybackYield) }) : r));
      const st = sy != null ? standing(Object.assign({}, s, { _sy: sy }), pool, '_sy') : null;
      if (st) bits.push('Shareholder yield is ' + st.words + '.');
      add({ id: 'capret', title: 'Capital returns', jump: 'capret', tone: 'neutral', arrow: sc == null ? null : signArrow(sc, 0.5), text: join(bits),
        basis: st && st.group, keyRaw: sy });
    }

    // Revenue mix (2026-10-26): where the revenue comes from, from the
    // company's own reports (segments.js), the host laying one compact view on
    // the row as segMix: the breakdown named, its largest parts, and the
    // largest part's share a few years before where the grouping held.
    {
      const m = s.segMix;
      if (m && Array.isArray(m.top) && m.top.length) {
        const bits = [];
        bits.push(m.title + (m.period ? ', ' + m.period : '') + ': ' + m.top.map((x) => x.name + ' ' + pct(x.pct, x.pct >= 10 ? 0 : 1)).join(', ') + (m.more ? ', and ' + m.more + ' more.' : '.'));
        const t0 = m.top[0];
        if (t0.was != null && m.wasYears) bits.push(t0.name + ' was ' + pct(t0.was, 0) + ' of revenue ' + m.wasYears + ' year' + (m.wasYears === 1 ? '' : 's') + ' earlier.');
        if (t0.change != null) bits.push(t0.name + ' revenue ' + move(t0.change) + ' on a year earlier.');
        add({ id: 'mix', title: 'Revenue mix', jump: 'seg', tone: 'neutral', arrow: null, text: join(bits) });
      }
    }

    // How it trades with the market (2026-10-26): its typical move on the S&P
    // 500's worst and best 5% of days in the past year (about thirteen each;
    // the Reactions group's fields), beside the index's own on those days (the
    // SPY row's), and where that sits in its industry; semiconductors also on
    // chip sell-off days. No arrow: how far it moves is not up or down.
    {
      const dn = num(s.marketSelloff), upm = num(s.marketRally);
      const spy = all.find((r) => r && r.symbol === 'SPY') || {};
      const sdn = num(spy.marketSelloff), sup = num(spy.marketRally);
      const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + pct(v);
      const bits = [];
      if (dn != null) bits.push('On the S&P 500’s worst days of the past year it typically moved ' + signed(dn) + (sdn != null ? ' (the index ' + signed(sdn) + ')' : '') + (upm != null ? ', and on its best ' + signed(upm) + (sup != null ? ' (the index ' + signed(sup) + ')' : '') : '') + '.');
      else if (upm != null) bits.push('On the S&P 500’s best days of the past year it typically moved ' + signed(upm) + '.');
      if (dn != null && sdn != null && sdn < 0) {
        const r = dn / sdn;
        bits.push(r >= 1.25 ? 'It fell further than the index on those days.' : r <= 0.75 ? 'It held up better than the index on those days.' : 'It fell about as far as the index on those days.');
      }
      const st = dn != null ? standing(s, all, 'marketSelloff') : null;
      // A higher value on a down day is a shallower fall; worded for that.
      if (st) bits.push('Its move on the worst days is ' + (st.where === 'top' ? 'shallower than three quarters of ' : st.where === 'bottom' ? 'deeper than three quarters of ' : 'in the middle half of ') + st.group + '.');
      if (/Semiconductor/.test(String(s.industry || '')) && num(s.chipSelloff) != null) bits.push('On chip sell-off days ' + signed(num(s.chipSelloff)) + '.');
      add({ id: 'mkt', title: 'How it trades with the market', jump: 'price', tone: 'neutral', arrow: null, text: join(bits), basis: st && st.group });
    }

    // THE HEADLINE FIGURE (2026-10-21, the owner on the At a glance card: "make
    // it bit more eye catching"). One number a topic, set large on the card,
    // taken from the same field and formatted by the same helpers as the
    // sentence beside it, so the two cannot disagree. `dir` is the sign, for a
    // price topic's green or red only; every other topic is a category colour.
    for (const c of cards) c.key = keyOf(c.id, s);
    return { symbol: s.symbol, cards };
  }
  function keyOf(id, s) {
    const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + pct(v);
    const k = (v, label, dir) => ({ v, k: label, dir: dir || null });
    const n = (f) => num(s[f]);
    switch (id) {
      case 'short': { const m = n('oneMonthPct'), w = n('oneWeekPct');
        return m != null ? k(signed(m), 'over the month', m > 0 ? 'up' : m < 0 ? 'down' : null) : w != null ? k(signed(w), 'over the week', w > 0 ? 'up' : w < 0 ? 'down' : null) : null; }
      case 'long': { const y = n('oneYearPct');
        return y != null ? k(signed(y), 'over the year', y > 0 ? 'up' : y < 0 ? 'down' : null) : null; }
      case 'trend': { const rs = n('relStrength');
        return rs != null ? k(signed(rs), 'vs the S&P 500, 3 months') : s.actionTrend ? k(String(s.actionTrend), 'trend reading') : null; }
      case 'growth': { const r = n('revenueGrowthYoY'), e = n('earningsGrowthYoY');
        return r != null ? k(signed(r), 'revenue, year on year') : e != null ? k(signed(e), 'earnings, year on year') : null; }
      case 'profit': { const p = n('profitMargin');
        return p != null ? k((p < 0 ? '−' : '') + pct(p), 'profit margin') : null; }
      case 'value': { const f = n('forwardPe'), t = n('trailingPe');
        return f != null && f > 0 ? k(times(f), 'forward P/E') : t != null && t > 0 ? k(times(t), 'trailing P/E') : null; }
      case 'vol': { const v = n('vol1y');
        return v != null ? k(pct(v, 0), 'moves in a year') : null; }
      case 'balance': { const nc = s.sector === 'Financial Services' ? null : n('netCash'), cr = n('currentRatio');
        return nc != null ? k(money(Math.abs(nc), s.currency), nc >= 0 ? 'net cash' : 'net debt') : cr != null ? k(cr.toFixed(1), 'current ratio') : null; }
      case 'shortpos': { const sp = n('shortPctFloat');
        return sp != null ? k(pct(sp), 'of the float short') : null; }
      case 'owners': { const i = n('institutionPct');
        return i != null ? k(pct(i), 'held by institutions') : null; }
      case 'guide': return s.erGuideChange ? k(String(s.erGuideChange), 'guidance, ' + shortDay(s.erFiled)) : s.erGuide ? k('Given', 'no change stated') : k('None', 'in the latest release');
      case 'earn': {
        // With a release: the EPS against the estimate in a word, else the day it reported.
        if (s.erFiled) return s.erVsEstWord ? k(String(s.erVsEstWord), 'vs the estimate, ' + shortDay(s.erFiled)) : k(shortDay(s.erFiled), 'reported' + (s.erPeriodLabel ? ', ' + s.erPeriodLabel : ''));
        if (s.nextEarningsDate) return k(shortDay(s.nextEarningsDate), s.nextEarningsEstimated ? 'next report, estimated' : 'next report');
        const sur = n('lastSurprise'); return sur != null ? k(signed(sur), 'last surprise') : null; }
      case 'capret': { const dy = n('divYield'), by = n('buybackYield');
        return dy != null && by != null ? k(pct(dy + by), 'shareholder yield') : dy != null ? k(pct(dy), 'dividend yield') : null; }
      case 'mix': { const m = s.segMix; const t = m && m.top && m.top[0];
        return t ? k(pct(t.pct, 0), (t.name.length > 28 ? t.name.slice(0, 27) + '…' : t.name) + ', largest') : null; }
      case 'mkt': { const d = n('marketSelloff');
        return d != null ? k((d > 0 ? '+' : d < 0 ? '−' : '') + pct(d), 'on the S&P’s worst days') : null; }
      case 'tone': { const a = n('toneAvg');
        return a != null ? k((a > 0 ? '+' : a < 0 ? '−' : '') + Math.abs(a).toFixed(2), 'tone, ' + n('toneN') + ' article' + (n('toneN') === 1 ? '' : 's') + ', 7 days') : null; }
      default: return null;
    }
  }

  // ---- drawing ----------------------------------------------------------------
  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const GLYPH = { up: '▲', down: '▼', flat: '●' };
  const SAYS = { up: 'up or high', down: 'down or low', flat: 'about level, or middling' };

  function render(g) {
    if (!g || !g.cards || !g.cards.length) return '';
    return '<div class="gl-grid">' + g.cards.map((c) => {
      const cls = c.tone === 'price' && c.arrow ? ' gl-' + c.arrow : c.tone === 'signal' ? ' gl-sig' : '';
      const sig = c.signal ? ' gl-s-' + String(c.signal).toLowerCase().replace(/[^a-z]+/g, '-') : '';
      // A COLOUR A TOPIC and THE HEADLINE FIGURE (2026-10-21, the owner: "make
      // the At a glance section more colorful here"), as on the promo card. The
      // page's stylesheet maps gl-t-<id> to a theme token; a price figure takes
      // gl-kup / gl-kdown by its sign; the Signal its direction (gl-sd-*).
      const topic = ' gl-t-' + esc(c.id);
      const sd = c.signal ? ' gl-sd-' + (/Risk/.test(c.signal) ? 'risk' : /Strong/.test(c.signal) ? 'up' : /Weak/.test(c.signal) ? 'down' : 'flat') : '';
      const kdir = c.tone === 'price' && c.key && c.key.dir ? ' gl-k' + c.key.dir : '';
      return `<a class="gl-card${cls}${sig}${topic}${sd}${kdir}" href="#${esc(c.jump)}" data-jump-to="${esc(c.jump)}">`
        + '<span class="gl-h">'
        + (c.arrow ? `<span class="gl-a" role="img" aria-label="${esc(SAYS[c.arrow])}">${GLYPH[c.arrow]}</span>` : '<span class="gl-a gl-none" aria-hidden="true">·</span>')
        + `<span class="gl-t">${esc(c.title)}</span></span>`
        + (c.key && c.key.v ? `<span class="gl-k"><b>${esc(c.key.v)}</b><i>${esc(c.key.k)}</i></span>` : '')
        + `<span class="gl-x">${esc(c.text)}</span>`
        + (c.stale ? `<span class="gl-stale">${esc(c.stale)}</span>` : '')
        + '</a>';
    }).join('') + '</div>';
  }

  const api = { build, render, standing, MIN_GROUP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Glance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
