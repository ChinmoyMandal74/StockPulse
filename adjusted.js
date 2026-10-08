// Adjusted Advice — the SAME rules, read off different data.
//
// The live Advice verdict reads one vendor for everything. This assembles the
// engine's inputs from two sources instead — Twelve Data's price bars for
// every technical, the company's own SEC filings for every fundamental — and
// runs `action.js` over the result unchanged. No rule, no threshold and no
// ordering is touched: the only thing that differs is where the numbers came
// from.
//
// WHY IT EXISTS. `/backtest` is capped at two months because
// `fundamentals_history` began 2026-08-30, so anything earlier imputes
// TODAY's fundamentals — a look-ahead. Filings carry a `filed` date, which is
// the day a figure became public, so they are the one source here that can be
// made genuinely point-in-time. Seeing the fields side by side is the step
// before any of that is measured.
//
// THE BOUNDARY IS UNCHANGED AND IS THE WHOLE CONDITION OF THIS EXISTING.
// Nothing here is stamped onto a snapshot row, so it cannot become a screener
// column, then a filter, then a screen, then a promo card. The live verdict on
// the screener, the stock page, the phone, the cards and the alerts is the
// vendor-fed one and is untouched. `adjusted-test.js` asserts that against the
// real `/api/stocks` and the real rendered header.
//
// Pure: no network, no database, no `store`. Orchestration is in server.js,
// the shape `secfacts.js`, `insider.js` and `news.js` already follow.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Adjusted = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ---- what the rules actually read ---------------------------------------
  //
  // Read off action.js rather than remembered: `classify` reads qualityRating,
  // forwardPe, portfolios, marketCap, netIncomeTtm, profitMargin, fcfTtm,
  // fcfMargin and roe; `definitions` reads vs200ma, vs50ma, rsi, oneMonthPct,
  // threeMonthPct, pctFromHigh, volTrend, shortPctFloat, historyDays,
  // nextEarningsDate and latestDate; `fundamentals` reads earningsGrowthYoY,
  // revenueGrowthYoY, fcfMargin, profitMargin, grossMargin, fcfTtm,
  // netIncomeTtm, shortPctFloat and qualityRating.
  //
  // Each column says where its number comes from, because on this page that
  // is the point rather than a footnote. `src` is one of:
  //   price  — Twelve Data daily bars, via the snapshot row
  //   sec    — the company's own filings, via sec_facts
  //   mixed  — needs both (market cap is a filed share count at today's price)
  //   finra  — FINRA's bi-monthly short interest report
  //   vendor — Twelve Data, with no counterpart in a filing
  const FIELDS = [
    // technicals — every one of these derives from bars and nothing else
    { key: 'price', label: 'Price', src: 'price', fmt: 'money' },
    { key: 'vs200ma', label: 'vs 200D', src: 'price', fmt: 'pct' },
    { key: 'vs50ma', label: 'vs 50D', src: 'price', fmt: 'pct' },
    { key: 'rsi', label: 'RSI', src: 'price', fmt: 'num' },
    { key: 'oneMonthPct', label: '1M', src: 'price', fmt: 'pct' },
    { key: 'threeMonthPct', label: '3M', src: 'price', fmt: 'pct' },
    { key: 'pctFromHigh', label: 'From high', src: 'price', fmt: 'pct' },
    { key: 'volTrend', label: 'Vol trend', src: 'price', fmt: 'pct' },
    { key: 'historyDays', label: 'History', src: 'price', fmt: 'int' },
    // fundamentals — all from the filings
    { key: 'revenueGrowthYoY', label: 'Rev YoY', src: 'sec', fmt: 'pct' },
    { key: 'earningsGrowthYoY', label: 'Earn YoY', src: 'sec', fmt: 'pct' },
    { key: 'grossMargin', label: 'Gross mgn', src: 'sec', fmt: 'pct' },
    { key: 'profitMargin', label: 'Profit mgn', src: 'sec', fmt: 'pct' },
    { key: 'fcfMargin', label: 'FCF mgn', src: 'sec', fmt: 'pct' },
    { key: 'netIncomeTtm', label: 'Net income', src: 'sec', fmt: 'money' },
    { key: 'fcfTtm', label: 'FCF', src: 'sec', fmt: 'money' },
    { key: 'roe', label: 'ROE', src: 'sec', fmt: 'pct' },
    { key: 'forwardPe', label: 'P/E (trail)', src: 'sec', fmt: 'num' },
    { key: 'marketCap', label: 'Market cap', src: 'mixed', fmt: 'money' },
    // neither price nor a filing
    { key: 'shortPctFloat', label: 'Short % float', src: 'finra', fmt: 'pct' },
    { key: 'nextEarningsDate', label: 'Next earnings', src: 'vendor', fmt: 'date' },
  ];

  const SOURCES = {
    price: 'Twelve Data daily bars',
    sec: 'SEC EDGAR filings',
    mixed: 'a filed share count at the latest close',
    finra: 'FINRA short interest',
    vendor: 'Twelve Data',
  };

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  // ---- trailing P/E, and why it stands in for the forward one --------------
  //
  // `forwardPe` has exactly two jobs in the engine: one establishment point
  // ("priced on earnings", 0 < pe <= 40), and — with qualityRating — deciding
  // that a row is a fund. Forward estimates are Ultra-plan only and there is
  // no such thing in a filing, so the filings' own trailing figure stands in.
  //
  // This IS a divergence from the live verdict and is named as one on the
  // page, not buried: a trailing P/E is normally the higher of the two, so a
  // company near the 40 line can lose that point here and keep it there.
  //
  // IT IS MARKET CAP OVER TTM NET INCOME, NOT A SUM OF QUARTERLY EPS, and the
  // difference is not cosmetic. Summing `epsDiluted` was the first attempt and
  // it returned null for 96% of the universe: THERE IS NO Q4 IN A FILING, so
  // the fourth quarter is differenced out of the annual ladder — and a
  // per-share figure cannot be differenced, because each quarter's denominator
  // is its own weighted average. `secfacts.js` correctly leaves it blank
  // (`NO_DIFF`), so almost every trailing year is missing exactly one EPS.
  // Cap over earnings is the same quantity by definition and needs no EPS.
  //
  // A MULTIPLE OFF A LOSS IS ARITHMETIC, NOT CHEAPNESS — the fifth place this
  // codebase has needed that sentence. A non-positive net income returns null
  // rather than a negative number that would read as cheap.
  function trailingPe(marketCap, netIncomeTtm) {
    const c = num(marketCap); const e = num(netIncomeTtm);
    if (c == null || e == null || e <= 0 || c <= 0) return null;
    return c / e;
  }

  // ---- the evolution series, for the Evolution promo card ------------------
  //
  // A DISPLAY series and nothing else: it carries no verdict, no rule and no
  // engine state, so the boundary at the top of this file is untouched. It
  // lives here because it needs `trailingPe`, and a second copy of "a
  // multiple off a loss is arithmetic, not cheapness" is the drift this
  // module exists to prevent.
  //
  // MARKET VALUE IS TODAY'S SHARE COUNT AT EACH DAY'S ADJUSTED CLOSE, and
  // that is the whole reason this function exists rather than the obvious
  // `sharesDiluted(t) x close(t)`.
  //
  // MEASURED 2026-10-04, and the naive version is wrong by FORTY TIMES. The
  // bar archive is split-adjusted — `persistBars` detects a split and
  // rewrites the symbol's whole history — while a filing's diluted share
  // count is AS FILED and is never restated. So a 2015 share count against a
  // 2015 adjusted close understates the market cap by the cumulative split
  // factor since. NVDA (4:1 in 2021, 10:1 in 2024) came back with a MEDIAN
  // P/E of 1.0 and a minimum of 0.3 — NVIDIA has never traded at one times
  // earnings, which is the only reason it was caught.
  //
  // RECOVERING THE SPLIT FACTOR FROM THE SHARE SERIES WAS TRIED AND REFUSED.
  // The quarter-on-quarter jumps are not clean: AAPL's 7:1 reads x6.8389 and
  // TSLA's 5:1 reads x5.2090, because an ordinary buyback moves the count in
  // the same quarter and the filed dates straddle the split; and NVDA's trail
  // carries a junk row (564.5M -> 0.5M -> 582.6M, a x1017 "jump") that any
  // threshold would take for a split. A heuristic over junk, producing a
  // money figure on a card people post publicly, is not a thing to ship.
  //
  // An adjusted close is ALREADY expressed in today's share units, so
  // multiplying it by today's share count is dimensionally consistent at
  // every date and the split factor cancels EXACTLY. What is left is net
  // share issuance since t — slow, bounded, and in a knowable direction
  // (a buyback understates the past multiple, dilution overstates it) —
  // against a factor of forty. Verified at the anchor: cap* today reconciles
  // with the vendor's own market cap to within 2% on 11 of 12 symbols.
  //
  // THE CARD SAYS SO IN ITS OWN NOTE. The caveat is stated rather than
  // buried, because "market value" that is not quite the historical market
  // cap is exactly the kind of thing a reader would otherwise never be told.
  //
  //   SecFacts    — passed in, so this module stays loadable in a browser
  //   rows        — one symbol's sec_facts trail
  //   closes      — [{ d, close }] OLDEST FIRST
  //   sharesToday — the CURRENT share count, or null
  // About two quarters, so the one segment that reaches today is never more
  // than twice the length of any other. Measured in `evolutionSeries` below.
  // Declared ABOVE its reader: a const read from a function defined earlier is
  // a temporal-dead-zone throw waiting for the first caller, which this
  // project has shipped twice (/api/db-stats, the pivot's DIMS).
  const LIVE_MAX_DAYS = 200;

  // ---- THE SHARE COUNT EACH QUARTER WAS FILED WITH, ON TODAY'S BASIS ---------
  // (2026-10-08, found on the owner's own Apple card.) `sharesToday x close(t)`
  // cancels splits exactly and ignores BUYBACKS, and for a P/E history that is
  // not a footnote: Apple has retired about 30% of its shares since 2016, so
  // its end-2016 multiple read 9.4x where it was about 14x, and the card's
  // "x4.1" expansion was really about x2.8.
  //
  // The fix is the count the company FILED that quarter, restated for the
  // splits since -- which needs the split history this app did not hold
  // until now.
  //
  // WHICH SPLITS A FILED COUNT STILL NEEDS IS NOT KNOWABLE FROM ITS DATE.
  // `latestFilled` takes the NEWEST filing's version of a period, and a later
  // 10-Q carries prior-year comparatives ALREADY restated for a split -- so a
  // period that ended before a split may be on either basis, and filling can
  // take the number from a third document again. What IS known is the shape
  // of the error: a filing has been restated for every split up to its own
  // date, so the factor it still lacks is the product of the LAST k splits,
  // for some k. So each quarter tries every such k and keeps the one that
  // lands nearest the quarter AFTER it, walking back from today's count.
  // Buybacks move a count a few percent a quarter and a split moves it 25% at
  // the very least, so the nearest candidate is not a close call.
  //
  // A COUNT NO CANDIDATE CAN RECONCILE IS JUNK, AND IS LEFT OUT -- NVIDIA's
  // trail carries 564.5M, 0.5M, 582.6M in consecutive quarters. That quarter
  // takes its neighbour's count and is counted in `mended`.
  //
  //   splits  [{ d, f }], f = new shares per old share (4 for a 4-for-1)
  //   anchor  today's share count, or null
  // Returns { at: { 'YYYY-MM-DD': shares }, filed, mended } or null where
  // fewer than half the quarters carry a usable count.
  const SHARE_STEP_MAX = 1.6;     // a quarter's count this far from its neighbour is not a buyback
  function splitAdjustedShares(SecFacts, rows, dates, splits, anchor) {
    const all = Array.isArray(rows) ? rows : [];
    if (!all.length || !Array.isArray(dates) || !dates.length || !Array.isArray(splits)) return null;
    const filled = SecFacts.latestFilled(all);
    const raw = {};
    // The quarter's own count first; the year's where the quarter has none --
    // a fourth quarter is differenced here, and a share count cannot be.
    for (const t of ['FY', 'Q']) {
      for (const r of filled) {
        if (r.periodType !== t || !r.periodEnd) continue;
        let s = num(r.sharesDiluted);
        // WHERE NO COUNT IS TAGGED, the same filing states it a second way: net
        // income over diluted EPS. Alphabet tags a share count only from 2023
        // (three classes), and without this its whole history fell back to
        // today's count. Only off an EPS large enough that its rounding to a
        // cent is not most of the answer.
        if (!(s > 0)) {
          const ni = num(r.netIncome), eps = num(r.epsDiluted);
          s = (ni != null && eps != null && Math.abs(eps) >= 0.2 && ni / eps > 0) ? ni / eps : null;
        }
        if (s != null && s > 0) raw[r.periodEnd] = s;
      }
    }
    const sp = splits.filter((x) => x && x.d && num(x.f) > 0).slice().sort((a, b) => (a.d < b.d ? -1 : 1));
    const at = {};
    let prev = (num(anchor) != null && num(anchor) > 0) ? num(anchor) : null;
    let filedN = 0, mended = 0;
    const pending = [];                        // quarters waiting for a count to borrow
    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      const s = raw[d];
      let pick = null;
      if (s != null) {
        // every product of the last k splits that fall after this period end
        const after = sp.filter((x) => x.d > d);
        let f = 1; const cands = [s];
        for (let k = after.length - 1; k >= 0; k--) { f *= Number(after[k].f); cands.push(s * f); }
        if (prev == null) {
          // NO ANCHOR AND A SPLIT SINCE THIS QUARTER ENDED: there is nothing
          // to say whether the filing had seen it, and guessing wrong is the
          // whole factor. The series falls back rather than guess.
          if (after.length) return null;
          pick = cands[0];
        }
        else {
          let best = null, bd = Infinity;
          for (const c of cands) { const dist = Math.abs(Math.log(c / prev)); if (dist < bd) { bd = dist; best = c; } }
          if (bd <= Math.log(SHARE_STEP_MAX)) pick = best;
        }
      }
      if (pick != null) {
        at[d] = pick; prev = pick; filedN++;
        while (pending.length) at[pending.pop()] = pick;
      } else if (prev != null && at[dates[i + 1]] != null) { at[d] = prev; mended++; }
      else pending.push(d);
    }
    mended += pending.length;
    if (filedN * 2 < dates.length) return null;
    return { at, filed: filedN, mended };
  }

  function evolutionSeries(SecFacts, rows, closes, sharesToday, splits) {
    const all = Array.isArray(rows) ? rows : [];
    const bars = Array.isArray(closes) ? closes : [];
    // `latestFilled` rather than `latestPerPeriod`, matching the stock page's
    // own FUND strip: filling only ever supplies a figure the winning filing
    // left BLANK, so the two can never disagree about a NUMBER — this merely
    // has points where that one has none. Measured when it was introduced:
    // a full trailing year goes from 65% of filers to 90%.
    const ttm = SecFacts.ttmSeries(all.length
      ? SecFacts.latestFilled(all).filter((r) => r.periodType === 'Q') : []);
    // Reject the empty before coercing: Number(null) is 0 and finite, and a
    // fabricated share count of zero would put every market value at nothing.
    const sh = num(sharesToday);
    const shares = (sh != null && sh > 0) ? sh : null;
    // WHERE THE SPLIT HISTORY IS HELD, each quarter is valued at the count it
    // was FILED with. Without it -- `splits` null, or too few usable counts --
    // the series falls back to today's count throughout, never a mixture: a
    // line that changes basis part-way has a step in it nobody could explain.
    const adj = splitAdjustedShares(SecFacts, all, ttm.map((t) => t.d), splits, shares);
    const basis = adj ? 'filed' : 'today';
    const sharesAt = (d) => (adj ? (adj.at[d] != null ? adj.at[d] : null) : shares);

    // The last close ON OR BEFORE a period end. A quarter end is routinely a
    // weekend — 31 December, 30 June — so an exact-date lookup would drop
    // about two points in seven for no reason.
    let cur = 0;
    const points = [];
    for (const t of ttm) {
      while (cur + 1 < bars.length && bars[cur + 1].d <= t.d) cur++;
      const bar = (bars.length && bars[cur] && bars[cur].d <= t.d) ? bars[cur] : null;
      const close = bar ? num(bar.close) : null;
      const rev = num(t.revenue);
      const ni = num(t.netIncome);
      // MIN_CLOSE is the archive's own bad-bar floor: a sub-cent close is a
      // delisted shell or an unadjusted reverse split, and SOLS printed
      // +56,129,902% on a live page off exactly that shape.
      const px = (close != null && close >= 0.01) ? close : null;
      const shAt = sharesAt(t.d);
      const cap = (shAt != null && px != null) ? shAt * px : null;
      points.push({
        d: t.d,
        revenue: rev,
        netIncome: ni,
        // A margin off no revenue is a division, not a margin.
        margin: (rev != null && rev > 0 && ni != null) ? (ni / rev) * 100 : null,
        cap,
        pe: trailingPe(cap, ni),
      });
    }
    // ---- and one more point at TODAY'S close -----------------------------
    //
    // THE FILINGS STOP AT THE LAST FILED QUARTER AND THE PRICE DOES NOT, and
    // conflating the two is what made the card's own market value read 39%
    // below the one on /adjusted for MSFT (2.77T against 3.85T, which is
    // exactly the price move since 30 June). /adjusted strikes the cap at the
    // LATEST close, so the value panel does too — same assumption, one place
    // it was missing. Revenue and earnings are NOT extended: there is no
    // later filing, and carrying them forward would be inventing a figure.
    //
    // THE P/E HERE IS TODAY'S CAP OVER THE LAST FILED TRAILING YEAR, which is
    // precisely what /adjusted computes. A multiple always pairs a live price
    // with the newest reported earnings; that is what a trailing P/E IS.
    const lastPt = points.length ? points[points.length - 1] : null;
    const newest = bars.length ? bars[bars.length - 1] : null;
    const nClose = newest ? num(newest.close) : null;
    let live = null;
    // On the filed basis today's point takes the NEWEST FILED count, so the
    // line's last segment is a move in price alone and not also a switch
    // from diluted to basic shares.
    const liveShares = (adj && lastPt) ? sharesAt(lastPt.d) : shares;
    if (liveShares != null && lastPt && newest && nClose != null && nClose >= 0.01
        && newest.d > lastPt.d) {
      // BOUNDED, because an unbounded extension draws a straight line across
      // years of unfiled history. Measured across 1,183 symbols: the newest
      // statement filing is a median 61 days old and 98.4% are inside 180,
      // then a thin tail of 19 reaching 5,661 days — JPM's own trail stops in
      // 2014, so one segment would span twelve years of price action it did
      // not touch. 200 days on the PERIOD END is about two quarters, so the
      // new segment is never more than twice the length of any other.
      // UTC ON BOTH ENDS, and this is the one place where local noon -- the
      // rule everywhere a date is RENDERED -- is wrong. A difference taken in
      // local time gains an hour across the daylight-saving change, so a gap
      // of exactly 200 days measured 200.04 and failed its own bound. Caught
      // by probing the threshold on both sides; a one-sided check passes.
      const gap = (Date.parse(newest.d + 'T00:00:00Z')
                 - Date.parse(lastPt.d + 'T00:00:00Z')) / 86400000;
      if (gap > 0 && gap <= LIVE_MAX_DAYS) {
        const cap = liveShares * nClose;
        live = { d: newest.d, close: nClose, cap, pe: trailingPe(cap, lastPt.netIncome) };
      }
    }

    return {
      points,
      live,
      // Whether a market value could be computed AT ALL. A card with no share
      // count draws the business alone and says why, rather than drawing a
      // value panel of nothing or — far worse — falling back to the filed
      // count and reintroducing the forty-fold error above.
      hasValue: points.some((p) => p.cap != null),
      sharesToday: shares,
      // 'filed' or 'today' -- which share count the market values are struck
      // on, so the card can say so rather than describe the wrong one.
      basis,
      sharesMended: adj ? adj.mended : 0,
    };
  }

  // ---- the share count, and the one junk value that would discredit it -----
  //
  // Net income divided by diluted EPS is the SAME QUANTITY read a second way
  // out of the SAME filing, which makes it a free independent check on a
  // number nothing else here can corroborate.
  function impliedShares(r) {
    const ni = num(r && r.netIncome); const eps = num(r && r.epsDiluted);
    if (ni == null || eps == null || eps === 0) return null;
    const s = ni / eps;
    return isFinite(s) && s > 0 ? s : null;
  }

  // Definitionally these two agree, so anything past a small multiple is a
  // units error rather than a disagreement. Measured 2026-09-29: WAT's two
  // newest 10-Qs state 98,204.0M and 82,139.0M diluted shares against 59.7M
  // in its own 10-K and 97.8M implied by its own EPS — a factor of 1,004,
  // which put its market cap at $43,498B and would have been the loudest
  // number on the page. The SOLS lesson: one junk value destroys a column,
  // and the only warning is a figure somebody happens to look at.
  //
  // 10 is chosen to be far outside any honest gap (net income attributable
  // to the parent against total profit can differ, never by an order of
  // magnitude) rather than tuned to WAT.
  const SHARES_BAD_RATIO = 10;

  // A SHARE COUNT IS NOT ALWAYS ON THE NEWEST QUARTER — an annual report
  // carrying the Q4 three-month figures often states the year's average and
  // not that quarter's, and a 20-F filer (CHKP) may state it only on the
  // annual. Rather than lose the market cap — and with it the P/E and the
  // whole company-type decision — walk the quarters newest first and then
  // the annuals. A diluted count moves by a per cent or two a year; a
  // missing one costs the row entirely, so the trade is not close.
  function newestShares(quarters, annuals, within) {
    const q = (Array.isArray(quarters) ? quarters : []).slice(0, within == null ? 6 : within);
    const a = (Array.isArray(annuals) ? annuals : []).slice(0, 2);
    const list = q.concat(a);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const stated = num(r.sharesDiluted);
      const implied = impliedShares(r);
      if (stated != null && stated > 0) {
        if (implied != null && (stated / implied > SHARES_BAD_RATIO
          || implied / stated > SHARES_BAD_RATIO)) {
          // The filing contradicts itself. Its own EPS is the reading to keep.
          return { shares: implied, from: r.periodEnd, back: i, basis: 'eps',
            rejected: stated };
        }
        return { shares: stated, from: r.periodEnd, back: i, basis: 'stated' };
      }
      // Nothing stated, but the filing's own EPS says what it was — XOM and
      // several other majors use a tag `secfacts.js` does not map, and
      // widening that would mean re-fetching 1,167 companies from an address
      // that has already answered 429 once.
      if (implied != null) {
        return { shares: implied, from: r.periodEnd, back: i, basis: 'eps' };
      }
    }
    return null;
  }

  // ---- the fundamentals, out of the filings --------------------------------
  //
  // `rows` is one symbol's sec_facts trail. `SecFacts` is passed in rather
  // than required, so this module stays loadable in a browser.
  //
  // MARGINS ARE TRAILING TWELVE MONTHS AND GROWTH IS THE LATEST QUARTER, which
  // is not an inconsistency — it is what the rules mean. The vendor's margins
  // are TTM and its growth is last-quarter-year-on-year, so matching that is
  // what keeps "the rules remain the same" true. Measured on MU: comparing one
  // quarter's margin against the vendor's manufactured a 33.9-point gap that
  // was entirely period length.
  function fundamentalsFrom(SecFacts, rows) {
    const all = Array.isArray(rows) ? rows : [];
    if (!all.length) return null;
    const latest = SecFacts.latestFilled(all);
    const qRows = latest.filter((r) => r.periodType === 'Q');
    const aRows = latest.filter((r) => r.periodType === 'FY');
    const q = SecFacts.withRatios(qRows);
    const t = SecFacts.ttm(qRows);
    const newest = q[0] || null;
    if (!newest) return null;

    const eq = num(newest.equity);
    const niTtm = t ? num(t.netIncome) : null;
    const sh = newestShares(qRows, aRows);
    return {
      // what the engine reads
      revenueGrowthYoY: newest.revenueGrowthYoY,
      earningsGrowthYoY: newest.earningsGrowthYoY,
      grossMargin: t ? t.grossMargin : null,
      profitMargin: t ? t.profitMargin : null,
      fcfMargin: t ? t.fcfMargin : null,
      netIncomeTtm: niTtm,
      fcfTtm: t ? num(t.freeCashFlow) : null,
      // ROE off a negative or absent equity is not a return on equity.
      // Reject the empty before coercing: Number(null) is 0 and finite.
      roe: (niTtm != null && eq != null && eq > 0) ? (niTtm / eq) * 100 : null,
      sharesDiluted: sh ? sh.shares : null,
      sharesFrom: sh ? sh.from : null,
      sharesBack: sh ? sh.back : null,   // how many periods back it was found
      sharesBasis: sh ? sh.basis : null, // 'stated' or 'eps' (derived / repaired)
      sharesRejected: sh ? (sh.rejected || null) : null,
      // provenance — what makes this the point-in-time source
      periodEnd: newest.periodEnd,
      filed: newest.filed,
      form: newest.form,
      accn: newest.accn,
      yoyAgainst: newest.yoyAgainst || null,
      ttmFrom: t ? t.from : null,
      ttmTo: t ? t.to : null,
      ttmDays: t ? t.days : null,
      quarters: qRows.length,
      // whether any number on this row was borrowed from an older filing
      filled: Object.keys(newest.filledFrom || {}).length,
      derived: !!newest.derived,
    };
  }

  // ---- short interest, out of FINRA ---------------------------------------
  //
  // Neither a price nor a filing. FINRA is the SOURCE the vendor's own
  // `shortPctFloat` is derived from — measured when the card was built, the
  // bi-weekly position reproduces the paid figure to 0.00pt — so taking it
  // first-hand is the more direct reading, not a substitution.
  //
  // The float is still the vendor's: no filing states one. So this field is a
  // hybrid and the page says so.
  function shortPctFloat(shares, floatShares) {
    const s = num(shares); const f = num(floatShares);
    if (s == null || f == null || f <= 0) return null;
    return (s / f) * 100;
  }

  // ---- the fundamental overlay --------------------------------------------
  //
  // EVERY FUNDAMENTAL THE ENGINE READS, SET EXPLICITLY — including the ones
  // the filings could not supply, which are set to null rather than left out.
  // That is the whole contract: both callers layer this over a snapshot row,
  // so a field merely OMITTED would let the vendor's value through and make
  // the result a silent blend of two sources.
  //
  // Shared by `/adjusted` (today) and `/adjustedbacktest` (a date in the
  // past), so the two cannot drift. `price` is whatever close applies —
  // today's on the card, that session's in a backtest — which is the only
  // thing that differs between them.
  function overlayFrom(sec, short, floatShares, price) {
    const f = sec || {};
    const p = num(price);
    const shares = f.sharesDiluted;
    // A FILED SHARE COUNT AT THE RELEVANT CLOSE. Not the vendor's cached
    // weekly capitalisation, and not price x shares OUTSTANDING: the filings
    // state a weighted-average diluted count, which is the one they state.
    const marketCap = (p != null && shares != null && shares > 0) ? p * shares : null;
    return {
      // This company files with the SEC, so it is not a fund — said outright
      // rather than left to classify()'s "no Quality and no P/E" guess, which
      // here would be wrong for every loss-maker (see `verdict`).
      notFund: true,
      revenueGrowthYoY: f.revenueGrowthYoY == null ? null : f.revenueGrowthYoY,
      earningsGrowthYoY: f.earningsGrowthYoY == null ? null : f.earningsGrowthYoY,
      grossMargin: f.grossMargin == null ? null : f.grossMargin,
      profitMargin: f.profitMargin == null ? null : f.profitMargin,
      fcfMargin: f.fcfMargin == null ? null : f.fcfMargin,
      netIncomeTtm: f.netIncomeTtm == null ? null : f.netIncomeTtm,
      fcfTtm: f.fcfTtm == null ? null : f.fcfTtm,
      roe: f.roe == null ? null : f.roe,
      forwardPe: trailingPe(marketCap, f.netIncomeTtm),
      marketCap,
      shortPctFloat: shortPctFloat(short && short.shares, floatShares),
      // NOT READ BY BALANCED (`use_quality: false`), and model output rather
      // than a measurement, so it is withheld rather than carried across.
      // It matters only to classify()'s fund test, which `notFund` answers.
      qualityRating: null,
    };
  }

  // ---- the engine row ------------------------------------------------------
  //
  // `snap` is the stock's snapshot row (price fields and the float), `sec` is
  // what fundamentalsFrom returned, `short` is the newest FINRA reading.
  //
  // Every technical is copied straight across; every fundamental comes from
  // the overlay above.
  function engineRow(snap, sec, short) {
    const s = snap || {};
    const price = num(s.price);
    return Object.assign({
      symbol: s.symbol,
      // the positive ETF test in classify() reads these names; keep it working
      portfolios: s.portfolios,
      latestDate: s.latestDate,
      // --- price, from the bars ---
      price,
      vs200ma: num(s.vs200ma),
      vs50ma: num(s.vs50ma),
      rsi: num(s.rsi),
      oneMonthPct: num(s.oneMonthPct),
      threeMonthPct: num(s.threeMonthPct),
      pctFromHigh: num(s.pctFromHigh),
      volTrend: num(s.volTrend),
      historyDays: num(s.historyDays),
      nextEarningsDate: s.nextEarningsDate || null,
    }, overlayFrom(sec, short, s.floatShares, price));
  }

  // ---- point in time -------------------------------------------------------
  //
  // What the filings said on a given day. `SecFacts.visibleAsOf` does the hard
  // part — keeping only filings public by then AND re-deriving the quarters
  // nobody files from those, because a stored derived quarter carries the
  // filing date of the latest restatement of its year and would otherwise
  // stay invisible for up to two years after it was actually knowable.
  function fundamentalsAsOf(SecFacts, rows, asOf) {
    const seen = SecFacts.visibleAsOf(rows, asOf);
    if (!seen.length) return null;
    return fundamentalsFrom(SecFacts, seen);
  }

  // ---- FINRA's own lag -----------------------------------------------------
  //
  // A short-interest position is dated by SETTLEMENT and published about
  // eight business days later, so a reading settled on the 15th was not
  // knowable on the 16th. Using the settlement date directly would be a
  // look-ahead of a fortnight on a field that gates an Avoid rule.
  //
  // 15 CALENDAR DAYS, deliberately longer than the ~10-12 the schedule
  // implies: erring late means a backtest knows LESS than a reader did,
  // which is the safe direction. It is a constant rather than a measurement
  // because the table stores the settlement date and nothing else — there is
  // no publication date here to measure against, and pinning it against
  // FINRA's own calendar is still owed (docs/backlog.md entry 17).
  const SHORT_LAG_DAYS = 15;

  function shortCutoff(asOf) {
    const t = Date.parse(asOf + 'T00:00:00Z');
    if (!isFinite(t)) return null;
    return new Date(t - SHORT_LAG_DAYS * 86400000).toISOString().slice(0, 10);
  }

  // ---- the verdict ---------------------------------------------------------
  //
  // THE ONE PLACE THIS COULD GO WRONG SILENTLY, which is why it is checked
  // rather than trusted. `classify()` can still call a row an ETF — its theme
  // names may say so — and a company that files with the SEC is not a fund.
  // Were that to happen the row would be scored by the all-technical rulebook
  // and handed a confident verdict from the wrong rules, with nothing on
  // screen looking wrong.
  //
  // `notFund` on the row is what prevents it; this is the assertion that the
  // prevention worked. A blank with a stated cause beats a wrong word.
  //
  // The FIRST cut of this page withheld 263 of 1,084 rows (24%) for exactly
  // this reason, every one of them a loss-maker with no honest P/E. That was
  // the guard earning its place: the alternative was 263 silently wrong rows.
  function verdict(Action, row, cfg, isFiler) {
    const res = Action.evaluate(row, cfg);
    if (isFiler && res.type === 'ETF') {
      return {
        action: null, flag: null, type: null, states: null,
        withheld: 'Classified as a fund though the company files with the SEC',
      };
    }
    return {
      action: res.action, flag: res.flag, type: res.type,
      states: res.states, estScore: res.estScore, withheld: null,
    };
  }

  return {
    FIELDS, SOURCES, SHARES_BAD_RATIO, SHORT_LAG_DAYS,
    trailingPe, impliedShares, newestShares, fundamentalsFrom, fundamentalsAsOf,
    evolutionSeries,
    shortPctFloat, shortCutoff, overlayFrom, engineRow, verdict,
  };
}));
