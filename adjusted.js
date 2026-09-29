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

  // ---- the engine row ------------------------------------------------------
  //
  // `snap` is the stock's snapshot row (price fields and the float), `sec` is
  // what fundamentalsFrom returned, `short` is the newest FINRA reading.
  //
  // Every technical is copied straight across. Every fundamental comes from
  // `sec` or is null — deliberately never falling back to the vendor's, which
  // would make the page quietly a blend and the comparison meaningless.
  function engineRow(snap, sec, short) {
    const s = snap || {};
    const f = sec || {};
    const price = num(s.price);
    const shares = f.sharesDiluted;
    const marketCap = (price != null && shares != null && shares > 0)
      ? price * shares : null;
    return {
      symbol: s.symbol,
      // the positive ETF test in classify() reads these names; keep it working
      portfolios: s.portfolios,
      latestDate: s.latestDate,
      // This company files with the SEC, so it is not a fund — said outright
      // rather than left to classify()'s "no Quality and no P/E" guess, which
      // on this page would be wrong for every loss-maker (see `verdict`).
      notFund: true,
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
      // --- fundamentals, from the filings ---
      revenueGrowthYoY: f.revenueGrowthYoY == null ? null : f.revenueGrowthYoY,
      earningsGrowthYoY: f.earningsGrowthYoY == null ? null : f.earningsGrowthYoY,
      grossMargin: f.grossMargin == null ? null : f.grossMargin,
      profitMargin: f.profitMargin == null ? null : f.profitMargin,
      fcfMargin: f.fcfMargin == null ? null : f.fcfMargin,
      netIncomeTtm: f.netIncomeTtm == null ? null : f.netIncomeTtm,
      fcfTtm: f.fcfTtm == null ? null : f.fcfTtm,
      roe: f.roe == null ? null : f.roe,
      forwardPe: trailingPe(marketCap, f.netIncomeTtm),
      // A FILED SHARE COUNT AT TODAY'S CLOSE. Not the vendor's cached weekly
      // capitalisation, and not price x shares OUTSTANDING: the filings state
      // a weighted-average diluted count, which is the one they state.
      marketCap,
      // --- neither ---
      shortPctFloat: shortPctFloat(short && short.shares, s.floatShares),
      nextEarningsDate: s.nextEarningsDate || null,
      // NOT READ BY BALANCED (`use_quality: false`), and model output rather
      // than a measurement, so it is withheld rather than carried across.
      // It matters only to classify()'s fund test — see `verdict` below.
      qualityRating: null,
    };
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
    FIELDS, SOURCES, SHARES_BAD_RATIO,
    trailingPe, impliedShares, newestShares, fundamentalsFrom, shortPctFloat,
    engineRow, verdict,
  };
}));
