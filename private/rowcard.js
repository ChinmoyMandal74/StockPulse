// Shared "every column for one row" hover card.
//
// Used by the screener (index.html) and the analysis page (analysis.html). The
// screener's card originally read the row's own <td>s, which guaranteed it
// matched the table — but the analysis tables only carry a handful of columns,
// so that trick does not port. Rather than write a second implementation and
// let the two drift, the card is built from the stock object here, once, and
// both pages use it. FIELD_SPEC below is the single description of what a row
// contains and how each value is rendered; it must stay in step with the
// screener's own cell renderers.

(function (global) {
  'use strict';

  const CUR = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', KRW:'₩', HKD:'HK$', CNY:'¥', INR:'₹',
                CAD:'C$', AUD:'A$', CHF:'CHF ', TWD:'NT$', BRL:'R$', SGD:'S$' };
  const curSym = (c) => (c ? (CUR[c] || c + ' ') : '$');
  const ok = (n) => n != null && isFinite(n);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function fmtMktCap(n, code) {
    if (!ok(n)) return null;
    const c = curSym(code);
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1e12) return sign + c + (a / 1e12).toFixed(1) + 'T';
    if (a >= 1e9) return sign + c + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return sign + c + (a / 1e6).toFixed(1) + 'M';
    return sign + c + a.toLocaleString();
  }

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // How far the SEC filing date must lead the vendor's announcement date
  // before we call the earnings feed BEHIND rather than merely lagging.
  //
  // THE DATA CHOSE THIS NUMBER, not judgement. Measured across 1,094
  // comparable symbols on 2026-10-01, the gap is bimodal with an EMPTY
  // BUCKET between 36 and 45 days: 950 symbols inside a week (a company
  // announces, then files the 10-Q days later), 117 at 8-20, 11 at 21-35 —
  // banks and retailers that announce in mid-July and file in early August —
  // then nothing at all until 46, and 16 symbols beyond it, every one a
  // genuinely missing quarter. 40 sits in the gap.
  //
  // A LOWER THRESHOLD FLAGS NORMAL BEHAVIOUR: at 20 it marked BLK, PNC, USB
  // and UNH, whose feeds are perfectly current. Shared because /stock's
  // caption and the screener's Reported column must agree about what
  // "behind" means; two copies would drift the first time one was tuned.
  const SEC_BEHIND_DAYS = 40;

  function shortDate(iso) {
    const p = String(iso).split('-');
    return p.length === 3 ? `${MON[+p[1] - 1]} ${+p[2]}` : iso;
  }

  // THE SAME 40 FOR THE OTHER DIRECTION, and deliberately a SEPARATE
  // constant. `SEC_BEHIND_DAYS` has to clear a structural announce-to-file
  // lag of up to 35 days; these two dates describe the SAME event — the
  // announcement — so in sync they are the same day, and the threshold only
  // has to clear same-day noise. Tuning one must not silently move the other.
  //
  // Shared for the reason its neighbour is: the screener's Announced (SEC)
  // column and /stock's Announced (SEC) row must agree about what "ahead"
  // means, and two copies drift the first time one is tuned.
  const ANN_AHEAD_DAYS = 40;

  // ---- Announced (SEC): the Item 2.02 8-K date ------------------------------
  //
  // ONE DECISION, TWO SURFACES — the screener's cell and /stock's row. It was
  // the screener's alone until 2026-10-04, and the moment the stock page
  // wanted it the whole thing had to be shared rather than restated: the
  // wrong-channel rule below is the kind of judgement that silently diverges,
  // and a /stock row printing "2016" for a company that announces under Item
  // 7.01 would be wrong in exactly the way the screener learned not to be.
  //
  // Returns `{t, c, title}` — the caller wraps it in whatever a cell or a row
  // is on its page. `pending` is for a surface that has not fetched the
  // filings yet: a dash is right either way, but "no Item 2.02 recorded" is a
  // false statement about a company that has one, so the tooltip says it is
  // still reading rather than claiming an absence it has not established.
  function announcedSec(s, opts) {
    const o = opts || {};
    // A fund files no Item 2.02 — measured, XLK has none and has no CIK at
    // all. NA rather than an em-dash, the rule the Size and Ownership groups
    // follow. It needs no fetch, so it is answered before `pending`.
    if (isFund(s)) return { t: 'NA', c: 'na', title: 'Not applicable — this is a fund' };
    const iso = s && s.secLastResults;
    if (!iso) {
      return o.pending
        ? { t: '—', c: 'na', title: 'Reading the filings from EDGAR…' }
        : { t: '—', c: 'na', title: 'No Item 2.02 filing recorded. These dates are loaded locally by'
            + ' sec-results-load.js; 102 of 1,168 companies have none in their recent filings.' };
    }
    const d = new Date(iso + 'T12:00:00');   // local noon, the card-dating rule
    const vend = s.lastEarningsDate;
    const gap = vend ? Math.round((d - new Date(vend + 'T12:00:00')) / 86400000) : 0;
    // ITEM 2.02 IS NOT EVERY COMPANY'S RESULTS CHANNEL, which the measurement
    // found rather than the design anticipating it: 51 of 1,062 have a 2.02
    // date that PREDATES the feed's own by more than a quarter. Energy Fuels
    // is the clear case — it announces under Items 7.01 and 8.01 and has
    // exactly one 2.02 ever, from 2016. Printing that beside a current
    // Reported value would read as "last reported 2016", so it says it cannot
    // answer and the tooltip says why. Widening to 7.01/8.01 was rejected:
    // 8.01 is the catch-all "other events" and would put a director's
    // resignation in a results column.
    if (gap < -ANN_AHEAD_DAYS) {
      return { t: '—', c: 'na',
        title: `This company's newest Item 2.02 is ${iso}, which predates the earnings feed's own date (${vend}).`
          + ' It announces results under a different 8-K item — 7.01 or 8.01 — so Item 2.02 cannot answer for it.'
          + ' Read Reported instead. 51 of 1,062 companies are like this.' };
    }
    const thisYear = d.getFullYear() === new Date().getFullYear();
    const t = shortDate(iso) + (thisYear ? '' : ` '${String(d.getFullYear()).slice(2)}`);
    // AHEAD OF THE VENDOR IS THE SIGNAL. Both dates describe the same event,
    // so in sync they are the same day: measured, NVDA reads 2026-08-26 from
    // EDGAR and Aug 26 from the feed.
    const miss = gap > ANN_AHEAD_DAYS;
    return { t, c: miss ? 'warn' : '',
      title: `Announced ${iso} — the newest 8-K carrying Item 2.02, from EDGAR`
        + (miss ? `\n\nTHE EARNINGS FEED HAS MISSED THIS: it still shows ${vend}, ${gap} days earlier.`
            + ' Every fundamental figure here is the feed’s, so they predate this announcement.'
          : vend ? '' : '\n\nNo vendor date to compare against.') };
  }

  // --- value renderers, mirroring the screener's cell renderers ---------------
  //
  // EACH ONE ALSO REPORTS ITS RAW NUMBER (`n`) AND ITS UNIT (`u`), which is what
  // lets /compare put a difference beside two values without a second list of
  // fields saying what kind of number each one is. Deriving it from the renderer
  // is the point: a field added to FIELD_SPEC gets a correct difference for
  // free, and one can never drift from how it is drawn. The units are what the
  // number IS, not how it is compared — the page decides that:
  //   pct   a percentage        -> difference in POINTS
  //   score a bounded score     -> difference in points (a rating, RSI)
  //   money the company's own reporting currency -> relative, and only when
  //         both sides report in the same one (Samsung's revenue is in won)
  //   num   a plain number or multiple -> relative
  //   count a share count       -> relative
  // A renderer with no `u` (text, dates, verdicts) gets no difference at all,
  // which is the right default and covers most of the card.
  const V = {
    // a change: signed, green up / red down
    pct: (n) => ok(n) ? { t: (n >= 0 ? '+' : '') + n.toFixed(1) + '%', c: n >= 0 ? 'pos' : 'neg', n, u: 'pct' } : null,
    // a level: no leading +, red only when negative
    lvl: (n) => ok(n) ? { t: n.toFixed(1) + '%', c: n < 0 ? 'neg' : '', n, u: 'pct' } : null,
    // A MAGNITUDE IN PERCENT: the sign is part of the number, the colour is
    // not. For a reading that is negative on EVERY row -- a bad day -- the
    // up/down colour paints the whole column red and so says nothing; worse,
    // red means "the price fell" everywhere else here, and a 5th percentile
    // of the last year is not a thing that just happened. The spotlight
    // card's rule, where "% from the high" takes the same treatment.
    mag: (n) => ok(n) ? { t: n.toFixed(1) + '%', c: '', n, u: 'pct' } : null,
    num: (n, d = 1) => ok(n) ? { t: n.toFixed(d), c: '', n, u: 'num' } : null,
    money: (n, code) => ok(n) ? { t: fmtMktCap(n, code), c: n < 0 ? 'neg' : '', n, u: 'money' } : null,
    signedMoney: (n, code) => ok(n) ? { t: fmtMktCap(n, code), c: n >= 0 ? 'pos' : 'neg', n, u: 'money' } : null,
    rating: (n) => ok(n) ? { t: String(n), c: n >= 8 ? 'pos' : n <= 4 ? 'neg' : 'warn', b: 1, n, u: 'score' } : null,
    rsi: (n) => ok(n) ? { t: n.toFixed(0), c: n >= 70 ? 'neg' : n <= 30 ? 'pos' : '', n, u: 'score' } : null,
    peg: (n) => ok(n) ? { t: n.toFixed(2), c: (n > 0 && n <= 1) ? 'pos' : n >= 2 ? 'neg' : '', n, u: 'num' } : null,
    ratio: (n) => ok(n) ? { t: n.toFixed(2) + '×', c: '', n, u: 'num' } : null,
    short: (n) => ok(n) ? { t: n.toFixed(1) + '%', c: n >= 20 ? 'neg' : n >= 10 ? 'warn' : '', n, u: 'pct' } : null,
    macd: (n) => ok(n) ? { t: n.toFixed(2), c: n >= 0 ? 'pos' : 'neg', n, u: 'num' } : null,
    count: (n) => {
      if (!ok(n)) return null;
      const a = Math.abs(n);
      const t = a >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
        : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n).toLocaleString();
      return { t, c: '', n, u: 'count' };
    },
    text: (t) => (t ? { t: String(t), c: '' } : null),
  };

  // --- what a row contains, in table order -----------------------------------
  const FIELD_SPEC = [
    ['info',  'Portfolios',     (s) => V.text((s.portfolios || []).join(', '))],
    ['info',  'Price',          (s) => ok(s.price) ? { t: curSym(s.currency) + s.price.toFixed(1), c: '' } : null],
    ['info',  'Sector',         (s) => V.text(s.sector)],
    ['info',  'Industry',       (s) => V.text(s.industry)],
    ['info',  'Exchange',       (s) => (s.exchange
      ? { t: s.exchange + (s.micCode ? ' · ' + s.micCode : ''), c: '' } : null)],
    // What the instrument IS, off the provider's free reference list. A FACT
    // about the security, not a reading of it — so it carries no colour and
    // nothing in the engine reads it.
    ['info',  'Instrument',     (s) => V.text(s.instrumentType)],
    // Boolean only. The index WEIGHT is deliberately not here: it stays on
    // the admin /holdings page, which is the licensing line the owner drew.
    // ONE row for both indexes. Blank where neither is known, or where
    // "neither" cannot be said because one file has not been imported.
    ['info',  'Index',          (s) => {
      const sp = s.spMember, nd = s.ndxMember;
      const t = sp === true && nd === true ? 'S&P 500 · Nasdaq 100' : sp === true ? 'S&P 500'
        : nd === true ? 'Nasdaq 100' : (sp === false && nd === false) ? 'Neither'
          : (sp === false && nd == null) ? 'Not in the S&P 500' : null;
      return t ? V.text(t) : null;
    }],
    ['info',  'Market Cap',     (s) => V.money(s.marketCap, s.currency)],
    // The band the cap falls in. One entry here puts it in the hover card, the
    // tiles, the phone and the tile/mobile field pickers at once.
    //
    // V.text, NOT the bare string it was until 2026-09-23. Every other getter
    // returns {t, c} and both readers take `.t` off it, so returning 'Large'
    // gave `undefined` and the row rendered with a LABEL AND NO VALUE on all
    // four surfaces — present in the catalogue, offered by both field pickers,
    // and blank wherever it was actually drawn. It passed every structural
    // check for two days; /compare found it by putting an empty cell next to a
    // full one. `field-shape-test.js` now sweeps all of them for this.
    ['info',  'Size',           (s) => V.text(s.capBand)],
    ['info',  'News',           (s) => {
                                  const n = s.newsLatest;
                                  if (!n || !n.headline) return null;
                                  const days = Math.floor((Date.now() - Date.parse(n.published_at)) / 86400000);
                                  const age = !isFinite(days) ? '' : days <= 0 ? 'today' : days + 'd';
                                  const h = n.headline.length > 64 ? n.headline.slice(0, 63) + '…' : n.headline;
                                  return { t: (age ? age + ' · ' : '') + h, c: '' };
                                }],
    ['info',  'Next Earn',      (s) => s.nextEarningsDate
                                  ? { t: (s.nextEarningsEstimated ? '~' : '') + shortDate(s.nextEarningsDate), c: '' } : null],
    ['rank',  'Qual.',          (s) => V.rating(s.qualityRating)],
    ['act',   'Type',           (s) => V.text(s.companyType)],
    ['act',   'Trend',          (s) => V.text(s.actionTrend)],
    ['act',   'Entry',          (s) => V.text(s.actionEntry)],
    ['act',   'Fundamentals',   (s) => V.text(s.actionFund)],
    ['act',   'Guards',         (s) => V.text(s.actionGuards)],
    ['act',   'Signal',         (s) => s.action
                                  ? { t: s.action, c: /Strong/.test(s.action) ? 'up' : /Weak/.test(s.action) ? 'down' : '' } : null],
    ['act',   'Why',            (s) => V.text(s.actionFlag)],
    ['act',   'Yesterday',      (s) => (s.advicePrev && s.advicePrev !== s.action ? V.text(s.advicePrev) : null)],
    // How far the Balanced rules let it fall before they exit. NOT a measure of
    // safety, which is what it reads as: over the archive the roomiest half of
    // a tier is the more EXTENDED and more volatile half, and its tail is
    // fatter. Cushion below is the same distance in the stock's own volatility,
    // and that one does order the tail correctly.
    ['act',   'To exit',        (s) => (s.actionRisk == null ? null
                                  : s.actionRisk.drop === 0
                                    ? { t: 'technicals at ' + s.actionRisk.action, c: 'warn' }
                                    : { t: '−' + s.actionRisk.drop.toFixed(1) + '% to ' + s.actionRisk.action, c: '' })],
    // The same distance in monthly sigmas. Ranks TAIL SIZE inside a tier, not
    // return: measured thinner at p10 and p25 in 6 of 6 era/horizon cells,
    // while every mean difference stayed noise.
    ['act',   'Cushion',        (s) => (s.actionCushion == null ? null
                                  : { t: s.actionCushion.toFixed(1) + 'σ',
                                      c: s.actionCushion >= 2 ? 'pos' : s.actionCushion < 1 ? 'warn' : '',
                                      // Already in the stock's OWN volatility, so two of them
                                      // compare directly — which is the whole reason this
                                      // figure exists rather than the raw distance beside it.
                                      n: s.actionCushion, u: 'score' })],
    // Market days the Balanced verdict has stood. "At least" until the row has
    // been watched changing — the run before that is unknowable, not zero.
    ['act',   'Days held',      (s) => (s.adviceDays == null ? null
                                  : { t: (s.adviceExact ? '' : '\u2265') + s.adviceDays
                                        + ' session' + (s.adviceDays === 1 ? '' : 's'),
                                      c: '' })],
    // Only on the day it happens; >=1.5x is the study's confirmed kind.
    ['act',   'Breakout',       (s) => (!s.fresh3mHigh ? null
                                  : { t: '3M high' + (s.volX != null ? ' \u00b7 ' + s.volX + '\u00d7 avg volume' : ''),
                                      c: s.volX != null && s.volX >= 1.5 ? 'pos' : '' })],
    // The card has no horizon picker, so it shows the default and says so
    // rather than borrowing whatever the table happens to be set to.
    ['short', 'Price pulled',   (s) => (s.pricedAt == null || !isFinite(s.pricedAt) ? null
                                  : { t: new Date(s.pricedAt).toLocaleString([], { day: 'numeric',
                                        month: 'short', hour: 'numeric', minute: '2-digit' }),
                                      c: Date.now() - s.pricedAt > 86400000 ? 'warn' : '' })],
    ['short', 'Today', (s) => V.pct(s.todayPct)],
    // Beside Today for the reason the column is: it is what says whether
    // today's move is unusual for this stock.
    ['short', 'Bad day',        (s) => V.mag(s.badDay)],
    // Beside the percentage it is derived from, which is where the table has
    // kept it all along — it sat in the Volume group here only because that
    // was where the other money readings were, and that group has gone.
    // signedMoney, not money: this is a CHANGE, so it takes the up/down colour
    // the percentage above it takes, and a zero reads positive in both for the
    // same reason.
    ['short', 'Value added',    (s) => V.signedMoney(s.capChangeToday, s.currency || 'USD')],
    ['short', 'YDAY',           (s) => V.pct(s.yesterdayPct)],
    ['short', '1W',             (s) => V.pct(s.oneWeekPct)],
    ['short', '2W',             (s) => V.pct(s.twoWeekPct)],
    ['short', '1M',             (s) => V.pct(s.oneMonthPct)],
    ['long',  '3M',             (s) => V.pct(s.threeMonthPct)],
    ['long',  '6M',             (s) => V.pct(s.sixMonthPct)],
    // Between 6M and 1Y. The one return here that is NOT a fixed window: it
    // runs from the last close before 1 January, so it covers days in January
    // and nearly a year in December. One entry puts it in the hover card, the
    // stock page, the tiles, the phone and /compare at once.
    ['long',  'YTD',            (s) => V.pct(s.ytdPct)],
    ['long',  '1Y',             (s) => V.pct(s.oneYearPct)],
    ['long',  '5Y',             (s) => V.pct(s.fiveYearPct)],
    ['fwd',   '+1M',            (s) => V.pct(s.fwd1M)],
    ['fwd',   '+3M',            (s) => V.pct(s.fwd3M)],
    ['fwd',   '+6M',            (s) => V.pct(s.fwd6M)],
    ['fwd',   'Since',          (s) => V.pct(s.fwdSince)],
    ['rel',   'RS vs S&P',      (s) => V.pct(s.relStrength)],
    ['rel',   'Chip selloff',   (s) => V.pct(s.chipSelloff)],
    ['rel',   '% from 52W lo',  (s) => V.lvl(s.pctFromLow)],
    ['rel',   '% from 52W hi',  (s) => V.pct(s.pctFromHigh)],
    // Distance below the highest CLOSE on record. Deliberately not called an
    // all-time high: measured 2026-10-02, 718 of 1,282 archives start in 2006
    // at the provider's 5,000-bar ceiling, so the window differs by symbol and
    // the next row names it rather than letting the label overclaim.
    ['rel',   '% from record',  (s) => V.pct(s.pctFromAth)],
    ['rel',   'Record set',     (s) => (s.pctFromAth == null ? null
      : { t: s.athIsRecord ? 'today' : (s.athDate || '—'), c: '' })],
    ['rel',   'Record since',   (s) => (s.athWindowFrom ? { t: s.athWindowFrom, c: '' } : null)],
    ['rel',   '52W high set',   (s) => (ok(s.daysSince52wHigh) ? { t: s.daysSince52wHigh === 0 ? 'today' : s.daysSince52wHigh + ' sessions ago', c: '' } : null)],
    ['rel',   '52W low set',    (s) => (ok(s.daysSince52wLow) ? { t: s.daysSince52wLow === 0 ? 'today' : s.daysSince52wLow + ' sessions ago', c: '' } : null)],
    ['rel',   '52W range',      (s) => V.num(s.range52Pos, 0)],
    // How straight the year's path was, and how much of it was spent below the
    // running high. Descriptive, like Cushion: neither has been shown to
    // predict anything, and consistency as a PREDICTOR was measured and came
    // back noise (see docs/momentum-delta.md).
    ['rel',   'Steadiness',     (s) => V.num(s.steadiness, 0)],
    ['rel',   'Ulcer',          (s) => V.num(s.ulcer, 1)],
    ['rel',   'Crossings',      (s) => V.count(s.crossings)],
    ['rel',   'Band',           (s) => V.num(s.bandPct, 0)],
    ['rel',   'RSI',            (s) => V.rsi(s.rsi)],
    // Volume used to be a group of its own. Both of these are a volume read
    // against the stock's OWN recent average — a relative reading by
    // construction, which is why Relative is where they belong rather than a
    // banner over them; $ volume comes along because it is the same column
    // block on the table.
    ['rel',   'Vol trend',      (s) => V.pct(s.volTrend)],
    ['rel',   'Rel. volume',    (s) => (ok(s.volX) ? { t: s.volX.toFixed(2) + '×', c: s.volX >= 1.5 ? 'warn' : '', n: s.volX, u: 'num' } : null)],
    ['rel',   '$ volume',       (s) => V.money(s.dollarVolume, s.currency || 'USD')],
    ['trend', 'vs 50D MA',      (s) => V.pct(s.vs50ma)],
    ['trend', 'vs 200D MA',     (s) => V.pct(s.vs200ma)],
    ['trend', 'MA cross',       (s) => {
      if (s.maBullish == null) return null;
      const fresh = s.maCrossDays != null && s.maCrossDays <= 20;
      const t = s.maBullish
        ? (fresh ? `Golden ▲ ${s.maCrossDays}d` : 'Bullish')
        : (fresh ? `Death ▼ ${s.maCrossDays}d` : 'Bearish');
      return { t, c: s.maBullish ? 'pos' : 'neg' };
    }],
    ['trend', 'MACD',           (s) => V.macd(s.macdHist)],
    // The two halves the histogram is the difference of. Computed on every row
    // since the MACD column was built and shown nowhere until now; the
    // histogram is the reading, these say where it came from. Neutral, because
    // a MACD line above zero is not by itself good news — the sign that means
    // something is on the histogram above.
    ['trend', 'MACD line',      (s) => V.num(s.macdLine, 2)],
    ['trend', 'MACD signal',    (s) => V.num(s.macdSignal, 2)],
    // Awesome Oscillator as a share of the price, so a $900 stock and a $9 one
    // can be read against each other; the raw figure is in dollars and would
    // rank by share price. The sign is the reading here (the fast average of
    // the midpoint above or below the slow one), unlike the chart pane, whose
    // bars are coloured by rising or falling.
    ['trend', 'Awesome osc.',   (s) => V.pct(s.aoPct)],
    ['size',  'Revenue TTM',    (s) => V.money(s.revenueTtm, s.currency)],
    ['size',  'Gross profit',   (s) => V.money(s.grossProfitTtm, s.currency)],
    ['size',  'Gross margin',   (s) => V.lvl(s.grossMargin)],
    ['size',  'Net income',     (s) => V.money(s.netIncomeTtm, s.currency)],
    ['size',  'FCF TTM',        (s) => V.money(s.fcfTtm, s.currency)],
    ['size',  'FCF margin',     (s) => V.lvl(s.fcfMargin)],
    ['size',  'Net cash',       (s) => V.signedMoney(s.netCash, s.currency)],
    ['size',  'Cash',           (s) => V.money(s.totalCash, s.currency)],
    ['size',  'Debt',           (s) => V.money(s.totalDebt, s.currency)],
    ['size',  'EBITDA',         (s) => V.money(s.ebitda, s.currency)],
    ['size',  'Operating cash', (s) => V.money(s.operatingCashFlowTtm, s.currency)],
    // Market cap plus debt, less cash — what the whole business costs rather
    // than what the equity costs. Stored since the profile call started being
    // kept in full and never surfaced.
    ['size',  'Enterprise value',(s) => V.money(s.enterpriseValue, s.currency)],
    // FIRST in the group because it dates everything under it: these figures
    // were struck at that announcement, and a reader scanning margins and
    // multiples should see how old they are before reading them. The DATE
    // only -- the time of day lives in earnings_history, which a snapshot row
    // does not carry; /stock's caption has it because that page reads it.
    ['fund',  'Period',         (s) => (s.mostRecentQuarter
      ? { t: shortDate(s.mostRecentQuarter), c: '' } : null)],
    ['fund',  'Reported',       (s) => (s.lastEarningsDate
      ? { t: shortDate(s.lastEarningsDate), c: '' } : null)],
    ['fund',  'Earn grth Q YoY',(s) => V.pct(s.earningsGrowthYoY)],
    ['fund',  'Rev grth Q YoY', (s) => V.pct(s.revenueGrowthYoY)],
    ['fund',  'Profit margin',  (s) => V.pct(s.profitMargin)],
    ['fund',  'ROE',            (s) => V.pct(s.roe)],
    // PEG leads the three P/E rows rather than sitting between them, the
    // screener's own column order since 2026-10-04: a PEG is a P/E with
    // growth divided into it, so it reads beside the multiples and not
    // through the middle of them.
    ['fund',  'PEG',            (s) => V.peg(s.peg)],
    ['fund',  'Fwd P/E',        (s) => V.num(s.forwardPe)],
    ['fund',  'Trailing P/E',   (s) => V.num(s.trailingPe)],
    // Deliberately NOT in FUND_HAS: a fund's EPS is not something we hold, so
    // this is NA there even though the provider's Trail P/E above it is real.
    ['fund',  'Live P/E',       (s) => V.num(s.peLive)],
    // UNCOLOURED, and that is a measurement rather than restraint. Over this
    // universe the cheapest third of each industry grow more slowly (revenue
    // 7.2% against 15.4%), earn thinner margins and score lower on Quality
    // (5 against 6) than the dearest third -- monotonically. A green cell
    // would be the screener asserting the opposite of what its own data says.
    // Not in FUND_HAS either: a fund has no industry and no peer group.
    ['fund',  'P/E vs peers',   (s) => V.ratio(s.peerPe)],
    ['fund',  'P/B',            (s) => V.num(s.priceToBook)],
    ['fund',  'P/S',            (s) => V.num(s.priceToSales)],
    ['fund',  'EV/EBITDA',      (s) => V.num(s.evToEbitda)],
    ['fund',  'Operating margin',(s) => V.pct(s.operatingMargin)],
    ['fund',  'ROA',            (s) => V.pct(s.roa)],
    ['fund',  'EPS TTM',        (s) => V.num(s.dilutedEpsTtm, 2)],
    ['fund',  'Debt / equity',  (s) => V.num(s.debtToEquity)],
    ['fund',  'Current ratio',  (s) => V.num(s.currentRatio)],
    // Both are price-divided, so they move with the price every day — the
    // reason the refresh email excludes them from its moved-fields list. Fine
    // to read, misleading to watch for changes.
    ['fund',  'FCF yield',      (s) => V.lvl(s.fcfYield)],
    ['fund',  'Net cash %',     (s) => V.lvl(s.netCashPct)],
    ['fund',  'Dividend yield', (s) => V.lvl(s.divYield)],
    // The cash amount behind the yield, per share and in the trading currency.
    // Not V.money: that abbreviates for market caps and renders a $1.00
    // dividend as "$1".
    ['fund',  'Dividend rate',  (s) => (ok(s.divRate)
      ? { t: curSym(s.currency) + s.divRate.toFixed(2), c: '' } : null)],
    ['fund',  'Payout ratio',   (s) => V.lvl(s.payoutRatio)],
    ['fund',  'Ex-dividend',    (s) => (s.exDivDate ? { t: shortDate(s.exDivDate), c: '' } : null)],
    // Beside the dividend figures they qualify. A row with no value is
    // omitted rather than drawn empty, so a non-payer and a company whose
    // profile predates these fields both simply show fewer rows.
    ['fund',  'Dividend paid',  (s) => (s.divPayDate ? { t: shortDate(s.divPayDate), c: '' } : null)],
    // Every per-share figure on the row — EPS, book value, the share count —
    // is stated after this split, which is the one thing that explains a
    // discontinuity in them.
    ['fund',  'Last split',     (s) => (s.lastSplitDate ? { t: shortDate(s.lastSplitDate), c: '' } : null)],
    ['own',   'Shares out',     (s) => V.count(s.sharesOutstanding)],
    ['own',   'Float',          (s) => V.count(s.floatShares)],
    ['own',   'Book value/share',(s) => V.num(s.bookValuePerShare, 2)],
    ['own',   'Short ratio',    (s) => V.num(s.shortRatio)],
    // It was in Fundamentals and is not a fact about the business: it is the
    // share register, and the Float it divides by is two rows up. Its two
    // siblings were already here.
    ['own',   'Short % float',  (s) => V.short(s.shortPctFloat)],
    ['own',   'Short % out',    (s) => V.short(s.shortPctOutstanding)],
    ['own',   'Insiders',       (s) => V.lvl(s.insiderPct)],
    ['own',   'Institutions',   (s) => V.lvl(s.institutionPct)],
  ];

  const GROUP_ORDER = ['info', 'rank', 'act', 'short', 'long', 'fwd', 'rel', 'trend', 'size', 'fund', 'own'];
  // The palette lives here because this file already owns GROUP_ORDER and
  // FIELD_SPEC. index.html keeps its own copy — it also colours the table's
  // group banners and the columns menu — so those two must stay in step.
  const GROUP_COLORS = {
    info: '#7c9cff', rank: '#a3e635', act: '#5eead4', short: '#34d399', long: '#a78bfa', fwd: '#fb923c',
    rel: '#22d3ee', trend: '#fbbf24', size: '#94a3b8', fund: '#fb7185', own: '#f0abfc',
  };
  // `size` is labelled Scale because there is a Size COLUMN in Info (the cap
  // band). The group ID is unchanged, so every saved key that names it still
  // resolves — a label is free to change in a way a group id is not.
  const GROUP_LABELS = {
    info: 'Info', rank: 'Scores', act: 'Signal', short: 'Short-term %', long: 'Long-term %', fwd: 'Forward',
    rel: 'Relative', trend: 'Trend', size: 'Scale', fund: 'Fundamentals', own: 'Ownership',
  };

  // ---- price history -------------------------------------------------------
  // Cached per symbol for the life of the page: the same row gets hovered over
  // and over while scanning, and the archive only changes on a refresh.
  // Exactly the window computeStocks() calls ONE_YEAR. Anything else and the
  // chart's headline change disagrees with the 1Y row a few centimetres below
  // it, which reads as a bug even though both numbers are right.
  // 253 bars, not 252: the change is measured across the gaps between bars, so
  // matching pctChange(values, ONE_YEAR) — which compares bar 0 against bar 252
  // — needs one more bar than there are intervals. One short and the headline
  // disagreed with the 1Y row by 27 points on a name that gapped on earnings a
  // year ago.
  const HISTORY_DAYS = 253;
  const histCache = new Map();

  function loadHistory(symbol, days) {
    const n = days || HISTORY_DAYS;
    const key = symbol + '|' + n;
    if (histCache.has(key)) return histCache.get(key);
    const pr = fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${n}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    histCache.set(key, pr);
    return pr;
  }

  // A plain line with a soft fill, coloured by the period's direction, and a
  // dashed line at the opening price so the shape reads against a baseline
  // rather than floating.
  // Simple moving average. Returns an array the same length as the input, with
  // null for the first n-1 points where the window is not yet full — the caller
  // fetches extra history so those nulls fall outside the visible window.
  function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  // ---- a quarterly figure onto a daily axis ---------------------------------
  //
  // The chart's x axis is an INDEX into the drawn sessions, so a filed figure
  // has to be laid onto that axis before it can be a pane. `points` is
  // oldest-first `{d, <key>}`; the answer is one value per session, null where
  // there is nothing to say.
  //
  // CARRIED FORWARD, NOT INTERPOLATED. A filed figure stands until the next
  // filing replaces it, which is a step; a value invented for the days between
  // two quarters would be a number no company ever stated.
  //
  // AND THE CARRY IS BOUNDED, because without a bound a company that stopped
  // filing draws a flat line all the way to today — which reads as "revenue
  // held steady" when the truth is "the record stops here". 400 days is a
  // little over one trailing window, so an ordinary quarterly cadence never
  // trips it and a genuine hole always does.
  const CARRY_DAYS = 400;
  function stepSeries(dates, points, key) {
    const ds = Array.isArray(dates) ? dates : [];
    const out = new Array(ds.length).fill(null);
    const ps = (Array.isArray(points) ? points : [])
      .filter((p) => p && p.d && p[key] != null)
      .sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!ps.length) return out;
    let j = -1;
    for (let i = 0; i < ds.length; i++) {
      while (j + 1 < ps.length && ps[j + 1].d <= ds[i]) j++;
      if (j < 0) continue;
      const age = (Date.parse(ds[i]) - Date.parse(ps[j].d)) / 86400000;
      if (age >= 0 && age <= CARRY_DAYS) out[i] = ps[j][key];
    }
    return out;
  }

  // RSI at every point, oldest-first, with Wilder smoothing — the same method
  // rsi() uses in server.js, so the last visible value matches the screener's
  // RSI column. Null until the window is full; the caller over-fetches so those
  // nulls fall outside the visible range.
  //
  // Wilder is an exponential average, so it converges slowly: a value computed
  // from 15 bars differs materially from one computed over 250 and read at the
  // same point. The padding is not decoration.
  function rsiSeries(closes, period) {
    const n = period || 14;
    const out = new Array(closes.length).fill(null);
    if (closes.length < n + 1) return out;
    let gains = 0, losses = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    let avgGain = gains / n, avgLoss = losses / n;
    const val = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    out[n] = val();
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
      avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
      out[i] = val();
    }
    return out;
  }

  // Awesome Oscillator at every point, oldest-first: the 5-session average of
  // each session midpoint, (high + low) / 2, less the 34-session average.
  // Null until 34 sessions exist; the caller over-fetches so those nulls fall
  // outside the visible range. Plain averages, so unlike RSI there is no
  // warm-up beyond the window itself.
  const AO_FAST = 5, AO_SLOW = 34;
  function aoSeries(mids) {
    const f = sma(mids, AO_FAST), s = sma(mids, AO_SLOW);
    return mids.map((_, k) => (f[k] == null || s[k] == null ? null : f[k] - s[k]));
  }

  // Prices at even steps along whichever scale is in use, each rounded to a
  // readable precision. Even spacing beats round numbers here: on a log axis
  // round values land unevenly and the gridlines look accidental.
  function priceTicks(lo, hi, useLog, n) {
    const t = useLog ? Math.log : (v) => v;
    const inv = useLog ? Math.exp : (v) => v;
    const a = t(lo), b = t(hi);
    const out = [];
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0.5 : k / (n - 1);
      const v = inv(a + f * (b - a));
      // significant-figure rounding, so $1.69 and $932 both read sensibly
      const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1)) - 1);
      out.push({ v: Math.round(v / mag) * mag, f: 1 - f });   // f: 0 = top
    }
    return out;
  }

  // A sparkline: the line and nothing else. Deliberately not chartSVG with
  // flags — at 72x20 there is no room for a baseline, an end dot or padding,
  // and a function that draws "everything except" is harder to reason about
  // than two small ones.
  // opts.h draws it taller — the tiles ask for 44-110 where the table's column
  // asks for 32. The viewBox height is the height in PIXELS the caller will
  // give it, so the vertical scale stays 1:1 and a tall chart is a taller
  // drawing rather than the 32-unit one stretched (which thickens the stroke
  // unevenly, since preserveAspectRatio is none).
  //
  // opts.area closes the path to the floor for a soft fill: worth it on a tile,
  // which is a picture, and deliberately not in the table, which is a table.
  function sparkSVG(closes, opts) {
    if (!closes || closes.length < 2) return '';
    const o = opts || {};
    const W = o.w || 120, H = o.h || 32, PAD = o.pad == null ? 3 : o.pad;
    const lo = Math.min.apply(null, closes);
    const hi = Math.max.apply(null, closes);
    const span = (hi - lo) || 1;
    let d = '';
    for (let i = 0; i < closes.length; i++) {
      const x = (i / (closes.length - 1)) * W;
      const y = PAD + (1 - (closes[i] - lo) / span) * (H - PAD * 2);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    const area = o.area
      ? `<path class="spark-area" d="${d}L${W} ${H}L0 ${H}Z" stroke="none"/>` : '';
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
           area + `<path d="${d}"/></svg>`;
  }

  // Returns { svg, log, ticks }. The caller labels the chart when the scale is
  // logarithmic, because an unmarked log axis misleads.
  //
  // opts.volumes draws bars beneath the price, each coloured by whether that
  // session closed up or down. The hover card passes none — at 104px tall
  // there is no room — so it stays a plain price line.
  function chartSVG(closes, opts) {
    const o = opts || {};
    const vols = o.volumes && o.volumes.length === closes.length ? o.volumes : null;
    const rsis = o.rsi && o.rsi.length === closes.length ? o.rsi : null;
    const aos = o.ao && o.ao.length === closes.length && o.ao.some((v) => v != null) ? o.ao : null;
    const W = 600;

    // Indicator panes stack below the price, in the order RSI then volume, each
    // with its own scale and a gap so none of them reads as part of another.
    // Turning one on grows the chart rather than squeezing the price, which is
    // the panel that matters.
    // The RSI band is the taller of the two: it carries threshold lines with
    // words above and below them, where volume only needs bars.
    const PANE_GAP = 13;
    const PANE_H = 44;
    const RSI_H = 58;
    const anyPane = vols || rsis || aos;
    // The price panel is taller than the panes under it, twice over at the
    // owner's request (2026-09-21): 150 -> 195 -> 254 viewBox units, each step
    // 30% on the one before and the volume and RSI bands left alone both times.
    // 254/150 is 69% above where it started.
    //
    // THE CSS HEIGHT HAS TO MOVE WITH IT. The svg stretches with
    // preserveAspectRatio="none", so growing the viewBox alone does not make
    // the price panel taller — it squashes every band, price included, into
    // the same box. What must stay constant is PIXELS PER VIEWBOX UNIT, which
    // is what keeps the volume and RSI bands exactly the height they were;
    // `#chart.rc-chart` in stock.html carries the matching numbers and says so.
    //
    // ONLY the paned case changes. The 104 branch is the hover card and the
    // tile/phone stock card, which pass no panes and were not asked about.
    const PRICE_H = anyPane ? 254 : 104;
    let cursor = PRICE_H;
    let rsiTop = 0, rsiBot = 0, volTop = 0, volBot = 0, aoTop = 0, aoBot = 0;
    if (rsis) { cursor += PANE_GAP; rsiTop = cursor; rsiBot = cursor + RSI_H; cursor = rsiBot; }
    // The oscillator sits between RSI and volume, at the RSI band height: it
    // needs room either side of a zero line.
    if (aos) { cursor += PANE_GAP; aoTop = cursor; aoBot = cursor + RSI_H; cursor = aoBot; }
    if (vols) { cursor += PANE_GAP; volTop = cursor; volBot = cursor + PANE_H; cursor = volBot; }
    const H = anyPane ? cursor + 6 : 104;
    const PT = 12, PB = anyPane ? 8 : 12;
    // Overlays are folded into the range: a moving average sits above a falling
    // price and below a rising one, so scaling to the price alone clips it.
    const overlays = (o.overlays || []).filter((ov) => ov && ov.values);
    const scaleVals = closes.concat(
      overlays.reduce((acc, ov) => acc.concat(ov.values.filter((v) => v != null)), []));
    const lo = Math.min.apply(null, scaleVals);
    const hi = Math.max.apply(null, scaleVals);
    // Over a long span a linear axis is useless: MU ran from $1.69 to $932, so
    // nineteen of twenty years flatten onto the floor and only the last month
    // is visible. Above a 4x range the axis goes logarithmic, which is what
    // makes a 20-year price chart readable at all. A single year almost never
    // trips it, so the default view stays linear and literal.
    const useLog = lo > 0 && hi / lo > 4;
    const t = useLog ? Math.log : (v) => v;
    const tLo = t(lo), tSpan = (t(hi) - tLo) || 1;
    const x = (i) => (closes.length === 1 ? W / 2 : (i / (closes.length - 1)) * W);
    const y = (v) => PT + (1 - (t(v) - tLo) / tSpan) * (PRICE_H - PT - PB);

    let d = '';
    for (let i = 0; i < closes.length; i++) d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(closes[i]).toFixed(1);
    const baseY = y(closes[0]).toFixed(1);

    // Gridlines at the price ticks. Returned alongside so the caller can put
    // HTML labels at the same heights — SVG text would distort, since the
    // chart stretches with preserveAspectRatio="none".
    // Overlay paths. A null breaks the line rather than joining across the gap.
    let overlayPaths = '';
    for (const ov of overlays) {
      let od = '', pen = false;
      for (let i = 0; i < ov.values.length; i++) {
        const v = ov.values[i];
        if (v == null) { pen = false; continue; }
        od += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        pen = true;
      }
      if (od) overlayPaths += `<path class="ov ${ov.cls || ''}" d="${od}"/>`;
    }

    // RSI pane: 0-100 on its own scale, with the 30 and 70 lines that make the
    // reading mean anything, and a faint 50 midline.
    let rsiPane = '';
    if (rsis) {
      const ry = (v) => rsiBot - (Math.max(0, Math.min(100, v)) / 100) * (rsiBot - rsiTop);
      // A band of its own, so the indicator reads as a separate instrument
      // rather than as more of the price chart.
      rsiPane += `<rect class="pane-bg" x="0" y="${rsiTop}" width="${W}" height="${(rsiBot - rsiTop).toFixed(1)}"/>`;
      // Overbought and oversold carry the colours they mean; 50 is only an
      // anchor for the eye and stays neutral.
      for (const [lvl, cls] of [[70, 'hi'], [50, 'mid'], [30, 'lo']]) {
        rsiPane += `<line class="rsi-gl ${cls}" x1="0" y1="${ry(lvl).toFixed(1)}" ` +
                   `x2="${W}" y2="${ry(lvl).toFixed(1)}"/>`;
      }
      let rd = '', pen = false;
      for (let i = 0; i < rsis.length; i++) {
        const v = rsis[i];
        if (v == null) { pen = false; continue; }
        rd += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + ry(v).toFixed(1);
        pen = true;
      }
      if (rd) rsiPane += `<path class="rsi-ln" d="${rd}"/>`;
    }

    // Awesome Oscillator pane: bars from a zero line, scaled to the largest
    // reading in view. THE COLOUR IS NOT THE SIGN: a bar is green where it is
    // higher than the bar before it and red where it is lower, which is the
    // convention the indicator is read by, so a green bar can sit below zero.
    // The caller says so beside the pane, because everywhere else on this
    // chart green and red mean the price rose or fell.
    let aoPane = '', aoZero = 0, aoAt = null;
    if (aos) {
      const seen = aos.filter((v) => v != null);
      const aLo = Math.min(0, Math.min.apply(null, seen)), aHi = Math.max(0, Math.max.apply(null, seen));
      const aSpan = (aHi - aLo) || 1;
      const pad = 3;
      const ay = (v) => aoTop + pad + (1 - (v - aLo) / aSpan) * (aoBot - aoTop - pad * 2);
      aoAt = ay; aoZero = ay(0);
      aoPane += `<rect class="pane-bg" x="0" y="${aoTop}" width="${W}" height="${(aoBot - aoTop).toFixed(1)}"/>`;
      aoPane += `<line class="ao-zero" x1="0" y1="${aoZero.toFixed(1)}" x2="${W}" y2="${aoZero.toFixed(1)}"/>`;
      const slot = W / aos.length;
      const bw = Math.max(0.6, Math.min(slot * 0.72, 7));
      let prev = o.aoPrev == null ? null : o.aoPrev;
      for (let k = 0; k < aos.length; k++) {
        const v = aos[k];
        if (v == null) continue;
        const cx = aos.length === 1 ? W / 2 : (k / (aos.length - 1)) * (W - bw) + bw / 2;
        const top = Math.min(ay(v), aoZero), h = Math.max(0.5, Math.abs(ay(v) - aoZero));
        const up = prev == null ? v >= 0 : v >= prev;
        aoPane += `<rect class="aob ${up ? 'au' : 'ad'}" x="${(cx - bw / 2).toFixed(2)}" ` +
                  `y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}"/>`;
        prev = v;
      }
    }

    const wantTicks = o.ticks || 0;
    const ticks = wantTicks ? priceTicks(lo, hi, useLog, wantTicks) : [];
    let grid = '';
    for (const tk of ticks) {
      const gy = y(tk.v);
      // A tick outside the band gets no line — and `drawn` says so, because a
      // caller labelling every tick would hang a price beside nothing (on a
      // card it landed on top of the header).
      tk.drawn = !(gy < PT - 1 || gy > PRICE_H);
      if (!tk.drawn) continue;
      grid += `<line class="grid" x1="0" y1="${gy.toFixed(1)}" x2="${W}" y2="${gy.toFixed(1)}"/>`;
    }
    // Where each label sits as a fraction of the whole viewBox, not of the
    // price band, since the caller positions against the rendered svg.
    for (const tk of ticks) tk.top = y(tk.v) / H;

    // Fractions of the viewBox, so the caller can place HTML labels against
    // each pane without knowing the geometry.
    const panes = {
      // `at` maps a price to its height, through whichever scale is in use, so a
      // crosshair can sit on the line without knowing about the log switch.
      price: { top: 0, bottom: PRICE_H / H, at: (v) => y(v) / H, lo, hi },
      rsi: rsis ? { top: rsiTop / H, bottom: rsiBot / H,
                    at: (v) => (rsiBot - (v / 100) * (rsiBot - rsiTop)) / H } : null,
      ao: aos ? { top: aoTop / H, bottom: aoBot / H, zero: aoZero / H, at: (v) => aoAt(v) / H } : null,
      volume: vols ? { top: volTop / H, bottom: volBot / H } : null,
    };

    // Volume bars. Scaled to the largest bar in view rather than an absolute,
    // so a quiet stretch still shows its own shape.
    let bars = '';
    if (vols) {
      const vMax = Math.max.apply(null, vols) || 1;
      const slot = W / vols.length;
      const bw = Math.max(0.6, Math.min(slot * 0.72, 7));
      const band = volBot - volTop;
      for (let i = 0; i < vols.length; i++) {
        const h = Math.max(0.5, (vols[i] / vMax) * band);
        const cx = vols.length === 1 ? W / 2 : (i / (vols.length - 1)) * (W - bw) + bw / 2;
        // Green when the session closed up on the one before it, matching the
        // convention every other charting tool uses.
        const up = i === 0 ? closes[i] <= closes[Math.min(1, closes.length - 1)] : closes[i] >= closes[i - 1];
        bars += `<rect class="vb ${up ? 'vu' : 'vd'}" x="${(cx - bw / 2).toFixed(2)}" ` +
                `y="${(volBot - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}"/>`;
      }
    }

    // A tint under the line, as its OWN path — never a fill on `.ln`, which
    // would close the line back to its start and paint a wedge (see the note
    // on the stroke and fill rules being deliberately ungrouped).
    const area = o.area
      ? `<path class="ch-area" d="${d}L${x(closes.length - 1).toFixed(1)} ${PRICE_H}L0 ${PRICE_H}Z" stroke="none"/>`
      : '';

    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      grid + area +
      `<line class="base" x1="0" y1="${baseY}" x2="${W}" y2="${baseY}"/>` +
      `<path class="ln" d="${d}"/>` +
      overlayPaths +
      rsiPane +
      aoPane +
      `<circle class="dot" cx="${x(closes.length - 1).toFixed(1)}" cy="${y(closes[closes.length - 1]).toFixed(1)}" r="2.6"/>` +
      bars +
      '</svg>';
    return { svg, log: useLog, ticks, panes };
  }

  // ---- the stock card -------------------------------------------------------
  // One card, drawn at two sizes: the screener's Tiles view and the phone page
  // draw from THIS, so a card cannot come to mean different things on the two
  // surfaces. Everything is handed in already formatted — the caller knows
  // whether it is a snapshot row (desktop) or a row the server has already
  // rendered (phone), and this knows only how to lay a card out.
  //
  // data: { symbol, name, price, change, up, fields: [{k,t,c}],
  //         closes, from, to, rangeLabel, verdict, chips }
  // opts: { size: 'tile' | 'phone', chartH, cols }
  function stockCard(data, opts) {
    const o = opts || {};
    const d = data || {};
    const phone = o.size === 'phone';
    const e = (t) => String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const head = '<div class="sc-head">' +
      `<div class="sc-id"><span class="sc-sym">${e(d.symbol)}</span>` +
      (d.name && d.name !== d.symbol ? `<span class="sc-nm">${e(d.name)}</span>` : '') + '</div>' +
      '<div class="sc-quote">' +
      `<span class="sc-px">${e(d.price == null ? '—' : d.price)}</span>` +
      (d.change ? `<span class="sc-chg ${d.up ? 'up' : 'dn'}">${e(d.change)}</span>` : '') +
      '</div></div>';

    // The chart, with the gridlines and price labels the references have. The
    // labels are HTML positioned against the returned tick fractions, never
    // SVG text — the chart stretches with preserveAspectRatio="none".
    let chart = '';
    const closes = d.closes;
    if (closes && closes.length > 1) {
      const art = chartSVG(closes, { ticks: phone ? 3 : 4, area: true });
      // An axis wants round numbers, not prices: "937", not "936.44", and "88"
      // rather than "88.0" — priceTicks already lands on round-ish values.
      const axis = (v) => (Math.abs(v) >= 100 ? v.toFixed(0)
        : (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$/, ''));
      const labels = art.ticks.filter((tk) => tk.drawn).map((tk) =>
        `<span class="sc-yt" style="top:${(tk.top * 100).toFixed(2)}%">${e(axis(tk.v))}</span>`).join('');
      const move = (closes[closes.length - 1] / closes[0] - 1) * 100;
      const movTxt = (move >= 0 ? '+' : '') + (Math.abs(move) >= 100 ? move.toFixed(0) : move.toFixed(1)) + '%';
      const up = move >= 0;
      chart =
        `<div class="sc-chart ${up ? 'up' : 'dn'}"${o.chartH ? ` style="--sc-h:${Number(o.chartH)}px"` : ''}>` +
        art.svg + labels + '</div>' +
        '<div class="sc-axis">' +
        `<span class="sc-xt">${e(d.from ? shortDate(d.from) : '')}</span>` +
        `<span class="sc-win"><span class="sc-wl">${e(d.rangeLabel || '')}</span>` +
        `<b class="${up ? 'up' : 'dn'}">${movTxt}</b></span>` +
        `<span class="sc-xt">${e(d.to ? shortDate(d.to) : '')}</span>` +
        '</div>';
    }

    const fields = (d.fields || []).filter(Boolean);
    const cols = Math.max(1, Math.min(3, o.cols || (phone ? 2 : 3)));
    const grid = fields.length
      ? `<div class="sc-fields c${cols}">` + fields.map((f) =>
        `<span class="sc-f"><span class="k">${e(f.k)}</span>` +
        `<span class="v ${e(f.c === 'na' ? 'na' : f.c || '')}">${e(f.t)}</span></span>`).join('') + '</div>'
      : '';

    const v = d.verdict;
    const verdict = v && v.word
      ? `<div class="sc-verdict"><span class="sc-v ${e(v.cls || '')}">${e(v.word)}</span>` +
        (v.why ? `<span class="sc-why">${e(v.why)}</span>` : '') + '</div>'
      : '';
    const chips = (d.chips || []).length
      ? '<div class="sc-chips">' + d.chips.map((c) =>
        `<span class="sc-chip">${e(c.k)}${c.v == null ? '' : ` <b>${e(c.v)}</b>`}</span>`).join('') + '</div>'
      : '';

    return head + chart + grid + verdict + chips;
  }

  const fmtPrice = (n) => (n >= 1000 ? n.toFixed(0) : n.toFixed(2));
  const shortDay = (iso) => {
    const p = String(iso).split('-');
    return p.length === 3 ? MON[+p[1] - 1] + " '" + p[0].slice(2) : iso;
  };

  // Called after the card is already on screen. Bails if the pointer has moved
  // on to a different row in the meantime.
  function paintChart(el, symbol) {
    const box = el.querySelector('.rc-chart');
    if (!box) return;
    loadHistory(symbol).then((data) => {
      if (!box.isConnected || box.dataset.sym !== symbol) return;
      const closes = (data && data.closes) || [];
      if (closes.length < 2) {
        box.innerHTML = '<div class="msg">No price history stored yet</div>';
        return;
      }
      const first = closes[0], last = closes[closes.length - 1];
      const chg = ((last - first) / first) * 100;
      box.classList.add(chg >= 0 ? 'up' : 'down');
      const c = chartSVG(closes);
      box.innerHTML = c.svg +
        `<span class="cap chg">${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</span>` +
        `<span class="cap hi">${fmtPrice(Math.max.apply(null, closes))}${c.log ? ' · log' : ''}</span>` +
        `<span class="cap lo">${fmtPrice(Math.min.apply(null, closes))}</span>` +
        `<span class="cap from">${esc(shortDay(data.from))} → now</span>`;
    });
  }

  // Every field of a row, grouped and coloured. Shared by the hover card and
  // the stock page so FIELD_SPEC stays the single description of a row —
  // the same reason the card exists rather than a second copy of the table.

  // ---- score breakdown tooltip ---------------------------------------------
  // Lives here rather than in index.html because the stock page explains the
  // same three numbers and a second copy would drift — the reason this module
  // exists at all. Only the markup is shared; each page owns its own hover
  // wiring, since one hovers table cells and the other a chip and a card row.

  function factorRow(b) {
    if (b.sub == null) {
      return `<div class="tip-row off"><span class="lbl">${esc(b.label)} <em>${b.weight}%</em></span>` +
             '<span class="val">n/a</span></div>';
    }
    const pct = Math.round(b.sub * 100);
    return `<div class="tip-row"><span class="lbl">${esc(b.label)} <em>${b.weight}%</em></span>` +
      `<span class="tip-bar"><i style="width:${pct}%"></i></span><span class="val">${pct}</span></div>`;
  }

  // kind: 'quality' — the only composite left. Overall and Momentum were
  // removed on 2026-09-23 (docs/momentum-scoring.md); the parameter stays so
  // callers read as they did and an unknown kind simply explains nothing.
  // Returns null when there is nothing to explain, so a caller can skip showing.
  function scoreTip(s, kind, opts) {
    const o = opts || {};
    const foot = o.pulled ? ` · pulled ${esc(o.pulled)}` : '';
    if (kind !== 'quality') return null;
    const bd = s.qualityBreakdown;
    if (!bd) return null;
    const totalW = bd.reduce((a, b) => a + b.weight, 0);
    const availW = bd.reduce((a, b) => a + (b.sub != null ? b.weight : 0), 0);
    const conf = totalW ? Math.round((availW / totalW) * 100) : 0;
    return `<div class="tip-head">Quality ${s.qualityRating}/10 ` +
      `<span>· score ${s.qualityScore}/100 · ${conf}% of factors</span></div>` +
      bd.map(factorRow).join('') +
      `<div class="tip-foot">Confidence ${conf}%: share of factor-weight with data ` +
      `(rest excluded &amp; renormalized).${foot}</div>`;
  }

  // Clamp the card beside its anchor and inside the viewport — preferring the
  // right, falling back to the left rather than hanging off the edge.
  function placeTip(tip, el) {
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = r.right + 8;
    if (left + tw > window.innerWidth - 8) left = r.left - tw - 8;
    if (left < 8) left = 8;
    let top = r.top;
    if (top + th > window.innerHeight - 8) top = window.innerHeight - th - 8;
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  // opts: { colors, labels }
  // Which rank-group rows carry a breakdown, when a caller asks for them.
  // Off by default: inside the hover card these rows are already in a tooltip,
  // and a tooltip on a tooltip helps nobody.
  const ROW_TIPS = { 'Qual.': 'quality' };
  // Which groups carry rows that can explain themselves.
  const TIP_GROUPS = ['rank'];

  // ---- a fund has no company fundamentals (2026-10-01, owner's request) ----
  //
  // For an ETF the Size and Ownership groups, and most of Fundamentals, are
  // not merely unknown — they do not apply. And the vendor's answer is WORSE
  // than silence: measured on the 24 funds in the universe, ten of the eleven
  // Size columns come back as a real ZERO, so the screener printed `$0`
  // revenue and `$0` EBITDA for SPY, which reads as a fact about the fund
  // rather than as an absence. FCF yield and net cash % then render `0.0%`
  // off those same zeros. So NA here is a correction, not a cosmetic.
  //
  // KEYED ON `instrumentType`, the vendor's own label for what the security
  // IS — never on classify()'s `companyType`, which is a heuristic ("no
  // Quality and no P/E") that types every loss-maker a fund wherever Quality
  // is withheld; on /adjusted that was 263 of 1,084 rows. Printing NA over a
  // real company's revenue is the expensive direction, and `instrumentType`
  // can only ever UNDER-catch: a fund whose profile predates the field keeps
  // today's blanks. Measured: all 24 carry it, and classify() agrees on
  // exactly the same 24, so nothing is lost by taking the safer field.
  //
  // FIVE FIELDS A FUND REALLY HAS, and they are deliberately not overwritten.
  // Measured on the same 24: a distribution yield (22/24, SPY 0.7%), its rate
  // (22/24, $4.42), the ex-dividend date (22/24), the last split (11/24 —
  // funds do split) and a weighted trailing P/E (23/24, XLE 12.7 against
  // XLK 41.5). A distribution yield is one of the most-read numbers about an
  // ETF; NA there would destroy a true figure to satisfy a rule about the
  // group it happens to sit in.
  const FUND_NA_GROUPS = ['size', 'own', 'fund'];
  const FUND_HAS = new Set([
    'fund|Trailing P/E', 'fund|Dividend yield', 'fund|Dividend rate',
    'fund|Ex-dividend', 'fund|Last split',
  ]);

  function isFund(s) { return !!s && s.instrumentType === 'ETF'; }

  function notApplicable(g, label, s) {
    return isFund(s) && FUND_NA_GROUPS.indexOf(g) >= 0
      && !FUND_HAS.has(g + '|' + label);
  }

  // THE ONE PLACE A GETTER IS EVALUATED, so `buildSections` and `fieldValues`
  // cannot disagree about a fund — the drift this file exists to prevent, and
  // the reason this is a helper rather than the same clause written twice.
  //
  // No `n`, so /compare withholds the difference and draws no bar: an NA
  // against a real number is not a gap of any size. No `b` either — that is
  // the bold flag the ratings use.
  function readField(g, label, get, s, ctx) {
    if (notApplicable(g, label, s)) return { t: 'NA', c: 'na' };
    try { return get(s, ctx); } catch { return null; }
  }

  // Every field a row can show, as a stable key — `group|label`. The tiles pick
  // a SUBSET of these, and reading them from FIELD_SPEC means the tile shows
  // exactly what the hover card shows for the same field, formatted the same
  // way. A second list of "fields a tile can show" is the drift this file
  // exists to prevent.
  function fieldCatalogue() {
    return FIELD_SPEC.map(([g, label]) => ({ group: g, label, key: g + '|' + label }));
  }

  // Which ROW PROPERTIES each field reads, asked of the getters themselves
  // rather than written down again: a recording proxy stands in for the row,
  // so a field that starts using another property says so on its own. The
  // mobile page's payload is built from this.
  function fieldProps() {
    const out = {};
    for (const [g, label, get] of FIELD_SPEC) {
      const seen = new Set();
      const probe = new Proxy({}, { get: (t, k) => { if (typeof k === 'string') seen.add(k); return undefined; } });
      try { get(probe, {}); } catch { /* a getter that needs a real value still recorded its reads */ }
      // `readField` consults `instrumentType` for these groups before the
      // getter is ever called, so a row trimmed to this list would lose the
      // fund test and silently stop saying NA. Nothing trims by this today;
      // it is recorded because that is what this function claims to answer.
      if (FUND_NA_GROUPS.indexOf(g) >= 0 && !FUND_HAS.has(g + '|' + label)) seen.add('instrumentType');
      out[g + '|' + label] = [...seen];
    }
    return out;
  }

  // One row's values under those keys:
  // { t: text, c: colour class, n?: raw number, u?: unit } or null.
  //
  // `n` and `u` ride along for /compare, which needs to subtract two of these
  // and cannot do it from the formatted text. Both server callers (mobileRow
  // and /api/m/stock) pick `t` and `c` off this by name, so the phone payload
  // is not a byte larger for them being here.
  function fieldValues(s) {
    const ctx = {};
    const out = {};
    for (const [g, label, get] of FIELD_SPEC) {
      const v = readField(g, label, get, s, ctx);
      out[g + '|' + label] = v
        ? { t: v.t, c: v.c || '', n: v.n == null ? null : v.n, u: v.u || null }
        : null;
    }
    return out;
  }

  function buildSections(s, opts) {
    const o = opts || {};
    const colors = o.colors || {};
    const labels = o.labels || {};
    const ctx = {};

    // `skip` drops a FIELD_SPEC row on a page that states the same fact
    // better elsewhere. Only /stock passes it, and only for
    // `short|Price pulled` now: the masthead carries that clock under the
    // price it qualifies, built from the same field's own formatter.
    //
    // IT HELD `fund|Reported` UNTIL 2026-10-04 on the reasoning that the
    // caption reads `earnings_history` where the row reads the PROFILE's
    // copy, so the two could disagree by up to the 7-day rotation. MEASURED
    // before undoing it, over 95 symbols including the 40 oldest reporters:
    // they agreed 95 times and differed none, because both come out of the
    // SAME `/earnings` pull in the same round. The claim was wrong.
    const skip = new Set(o.skip || []);

    const byGroup = {};
    for (const [g, label, get] of FIELD_SPEC) {
      if (skip.has(g + '|' + label)) continue;
      const v = readField(g, label, get, s, ctx);
      (byGroup[g] = byGroup[g] || []).push({
        k: label,
        t: v ? v.t : '—',
        c: v ? (v.c || '') : 'na',
        b: v && v.b,
      });
    }

    return GROUP_ORDER
      .filter((g) => (byGroup[g] && byGroup[g].some((r) => r.t !== '—'))
        || ((o.extra && o.extra[g] || []).length > 0))
      .map((g) => {
        const c = colors[g] || 'var(--accent)';
        // `extra` appends rows to a named group. Opt-in, and only the stock page
        // passes it: these values are not in the snapshot, so putting them in
        // FIELD_SPEC would print an em-dash in the hover card on every other page.
        const extras = (o.extra && o.extra[g]) || [];
        // AN EXTRA ROW MAY NAME THE ROW IT BELONGS BESIDE (`after`), and a
        // date is the case that needs it: /stock's Announced (SEC) is read
        // AGAINST Reported — it is marked when it runs ahead of it — and
        // appended it would land twenty-five rows below the only value it
        // can be compared with. Named but not found, and it appends, which
        // is what every row without an `after` does.
        //
        // `|| []` because the filter above admits a group that has ONLY
        // extras, where `byGroup[g]` is undefined and `.concat` threw.
        const rows0 = (byGroup[g] || []).slice();
        for (const x of extras) {
          const i = x.after ? rows0.findIndex((r) => r.k === x.after) : -1;
          if (i >= 0) rows0.splice(i + 1, 0, x); else rows0.push(x);
        }
        const rows = rows0.map((r) => {
          const tip = o.tips && TIP_GROUPS.includes(g) ? ROW_TIPS[r.k] : null;
          // `links` turns a FIELD_SPEC row's value into one or more links —
          // Sector, Industry, Size and Portfolios each name a group with a
          // page of its own. OPT-IN and keyed by label, like `extra` and
          // `tips`: only /stock passes it, so the hover card on the screener
          // is unchanged (a link inside a card that vanishes when the
          // pointer leaves the row is a worse offer than no link).
          //
          // A PART LIST, not one href, because Portfolios is many values in
          // one row: two themes are two links, not one link over both names.
          // Same tab — these are internal, unlike the website row's _blank.
          const parts = (o.links && o.links[r.k] && r.t !== '—') ? o.links[r.k](s) : null;
          const val = (parts && parts.length)
            ? parts.map((p) => `<a class="rc-link go" href="${esc(p.href)}">${esc(p.t)}</a>`).join(', ')
            : r.href
              ? `<a class="rc-link" href="${esc(r.href)}" target="_blank" rel="noopener">${esc(r.t)}</a>`
              : esc(r.t);
          // An extra row may carry a plain `title`, which is where the
          // screener puts the same explanation — on the cell. Only an
          // extra row can have one, so the hover card is unchanged: a
          // tooltip inside a tooltip helps nobody.
          const ttl = r.title ? ` title="${esc(r.title)}"` : '';
          return `<div class="rc-row${tip ? ' has-tip' : ''}"${tip ? ` data-tip="${tip}"` : ''}${ttl}>` +
            `<span class="rc-k">${esc(r.k)}</span>` +
            `<span class="rc-v ${r.c || ''}"${r.b ? ' style="font-weight:600"' : ''}>${val}</span></div>`;
        }).join('');
        // A DATE THAT QUALIFIES EVERY FIGURE IN A SECTION BELONGS ON THE
        // SECTION, not on one row among ninety. `captions` is opt-in and
        // keyed by group, exactly like `extra`, `tips` and `links`, and only
        // /stock passes it — the hover card is 104px of floating panel and
        // has no room for a sentence.
        const cap = (o.captions && o.captions[g]) || '';
        return `<div class="rc-sec"><div class="rc-sec-h" style="color:${c}"><i></i>` +
               `${esc(labels[g] || g)}</div>` +
               (cap ? `<div class="rc-cap">${esc(cap)}</div>` : '') +
               `${rows}</div>`;
      }).join('');
  }

  // opts: { colors, labels, actions }
  function buildHTML(s, opts) {
    const o = opts || {};
    const sections = buildSections(s, o);

    const price = ok(s.price) ? curSym(s.currency) + s.price.toFixed(1) : '';
    let foot = 'Company data not cached yet';
    if (s.profileFetchedAt) {
      try { foot = 'Company data cached ' + new Date(s.profileFetchedAt).toLocaleString(); } catch { /* keep default */ }
    }

    const actions = (o.actions || []).map((a) =>
      `<button class="rc-act${a.danger ? ' danger' : ''}" data-action="${esc(a.id)}">${esc(a.label)}</button>`
    ).join('');

    return '<div class="rc-core">' +
      `<div class="rc-head"><span class="rc-sym">${esc(s.symbol)}</span>` +
      `<span class="rc-name">${esc(s.name || '')}</span>` +
      `<span class="rc-price">${esc(price)}</span></div>` +
      // Filled in asynchronously by paintChart(); the card must not wait on a
      // network round trip to appear, since it opens 140ms after the pointer
      // settles and any further delay reads as broken.
      `<div class="rc-chart" data-sym="${esc(s.symbol)}"><div class="msg">…</div></div>` +
      `<div class="rc-cols">${sections}</div>` +
      `<div class="rc-foot"><span>${esc(foot)}</span>` +
      (actions ? `<span class="rc-acts">${actions}</span>` : '') +
      '</div>' +
      '</div>';
  }

  // --- attach hover behaviour to a container ---------------------------------
  // opts: { root, selector, getStock, colors, labels, onShow, actions, onAction }
  // CAN THE PRIMARY POINTER ACTUALLY HOVER? Asked once, here, so the hover
  // card and the score tooltip cannot disagree about it.
  //
  // WIDTH IS THE WRONG TEST and would fail the exact device this exists for:
  // an iPad Pro in landscape is 1024-1366px wide, so any sane breakpoint
  // leaves hover switched ON there — and a 900px laptop window would lose it
  // while holding a mouse. `(hover: hover) and (pointer: fine)` asks the
  // question directly: a touch screen answers `hover: none, pointer: coarse`,
  // a laptop answers fine even if its screen is also a touch screen, which is
  // right — that person has a mouse.
  //
  // It matters because a touch browser SYNTHESISES mouseover on tap: the card
  // ambushes you as you reach for the link underneath it, and on iOS the first
  // tap is then spent dismissing it.
  function canHover() {
    try {
      return typeof matchMedia !== 'function'
        || matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch { return true; }   // cannot tell → behave exactly as before
  }

  function attach(opts) {
    const el = document.getElementById('rowcard');
    if (!el) return;
    // Nothing is wired at all on a touch device — not wired-then-suppressed,
    // so there is no handler left to fire. The same shape is returned so the
    // caller needs no null check, and tapping the name still opens the stock
    // page, which is the better answer on a phone anyway.
    if (!canHover()) return { hide() {} };
    let timer = null;      // delay before showing
    let hideTimer = null;  // grace period before hiding
    let current = null;    // the stock the open card describes

    function show(target) {
      const s = opts.getStock(target);
      if (!s) return;
      if (opts.onShow) opts.onShow();
      current = s;
      el.innerHTML = buildHTML(s, {
        colors: opts.colors,
        labels: opts.labels,
        actions: opts.actions ? opts.actions(s) : null,
      });
      paintChart(el, s.symbol);
      el.style.display = 'block';
      const r = target.getBoundingClientRect();
      const pad = 10;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = r.right + 12;
      if (left + w > window.innerWidth - pad) left = Math.max(pad, r.left - w - 12);
      let top = r.top - 8;
      if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
      if (top < pad) top = pad;
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    }

    function hide() {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      el.style.display = 'none';
      current = null;
    }

    // The card sits 12px clear of the cell, so leaving the cell must not dismiss
    // it instantly — the pointer needs time to cross the gap and land on it.
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 220);
    }

    opts.root.addEventListener('mouseover', (e) => {
      const t = e.target.closest(opts.selector);
      if (!t || !opts.root.contains(t)) return;
      clearTimeout(timer);
      clearTimeout(hideTimer);
      // A short delay so the card does not fire while scanning down the column.
      timer = setTimeout(() => show(t), 140);
    });
    opts.root.addEventListener('mouseout', (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest(opts.selector)) return;
      if (to && el.contains(to)) return;   // heading into the card
      clearTimeout(timer);
      scheduleHide();
    });
    el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    el.addEventListener('mouseleave', hide);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.rc-act');
      if (!b || !current || !opts.onAction) return;
      const s = current;
      hide();
      opts.onAction(b.dataset.action, s);
    });

    return { hide };
  }

  // ---- Google Finance ------------------------------------------------------
  // MOVED HERE FROM index.html (2026-09-26) rather than copied, when the stock
  // page wanted the same link. Two surfaces deriving the same third-party URL
  // from the same row is exactly the drift this module exists to prevent —
  // and a Google Finance URL is a small pile of venue trivia that would only
  // be corrected in one of the copies.
  //
  // Maps a Twelve Data MIC / exchange to the code Google uses in its quote URL
  // (https://www.google.com/finance/quote/SYMBOL:EXCHANGE). The MIC is
  // authoritative; the free-text exchange is the fallback.
  const GF_MIC = {
    XNGS: 'NASDAQ', XNMS: 'NASDAQ', XNCM: 'NASDAQ', XNAS: 'NASDAQ',
    XNYS: 'NYSE', ARCX: 'NYSEARCA', XASE: 'NYSEAMERICAN',
    BATS: 'BATS', BATY: 'BATS', EDGX: 'BATS', EDGA: 'BATS',
    XKRX: 'KRX', XLON: 'LON', XTKS: 'TYO', XHKG: 'HKG', XTSE: 'TSE',
    XSHG: 'SHA', XSHE: 'SHE', XPAR: 'EPA', XETR: 'ETR', XAMS: 'AMS',
    XSWX: 'SWX', XNSE: 'NSE', XBOM: 'BOM', XASX: 'ASX',
  };
  const GF_EXCH = {
    NASDAQ: 'NASDAQ', NYSE: 'NYSE', 'NYSE ARCA': 'NYSEARCA', ARCA: 'NYSEARCA',
    'NYSE AMERICAN': 'NYSEAMERICAN', AMEX: 'NYSEAMERICAN', CBOE: 'BATS', BATS: 'BATS', KRX: 'KRX',
  };
  function googleExchange(s) {
    const mic = String((s && s.micCode) || '').toUpperCase();
    if (GF_MIC[mic]) return GF_MIC[mic];
    const ex = String((s && s.exchange) || '').toUpperCase();
    return GF_EXCH[ex] || ex || null;
  }
  // Without a venue Google still resolves the bare symbol, so a row whose
  // exchange has not arrived yet (it rides the profile, on a weekly rotation)
  // gets a working link rather than none.
  function gfUrl(s) {
    const sym = encodeURIComponent(String((s && s.symbol) || ''));
    const exch = googleExchange(s);
    return exch
      ? `https://www.google.com/finance/quote/${sym}:${encodeURIComponent(exch)}`
      : `https://www.google.com/finance/quote/${sym}`;
  }

  // ---- Yahoo Finance -------------------------------------------------------
  // Here for the reason gfUrl is here at all: a third-party URL derived from a
  // row belongs in one place, not in whichever pages happen to want it.
  //
  // It needs NO venue — https://finance.yahoo.com/quote/MU/ is the whole
  // thing — which is the one way it is simpler than Google. What it does need
  // is the share-class spelling: Yahoo writes those with a HYPHEN, and this
  // universe holds BRK.A, BRK.B and HEI.A.
  //
  // THE FAILURE IS SILENT, NOT A 404, which is why this is a rule and not a
  // guess. Checked against the live site: `quote/BRK.B/` answers **200** with
  // an empty company name — a quote page with nothing on it — where
  // `quote/BRK-B/` is Berkshire Hathaway. A status-code check would have
  // passed over a link that goes nowhere useful.
  //
  // Nothing else is translated, and that holds only BECAUSE the universe is
  // US-listed only: a foreign listing needs Yahoo's own market suffix
  // (`005930.KS`, `VOD.L`), which is exactly the rule this project keeps.
  function yfUrl(s) {
    const sym = String((s && s.symbol) || '').replace(/\./g, '-');
    return `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/`;
  }

  global.RowCard = {
    buildHTML, attach, fmtMktCap, FIELD_SPEC,
    gfUrl, yfUrl, googleExchange, canHover,
    // used by the stock page
    buildSections, chartSVG, sparkSVG, stockCard, loadHistory, fmtPrice, shortDay, HISTORY_DAYS, sma, rsiSeries, aoSeries, stepSeries, fmtMktCap,
    scoreTip, placeTip,
    GROUP_ORDER, GROUP_COLORS, GROUP_LABELS, SEC_BEHIND_DAYS, ANN_AHEAD_DAYS, announcedSec,
    fieldCatalogue, fieldValues, fieldProps, isFund,
  };
})(typeof window !== 'undefined' ? window : globalThis);
// Loadable in Node as well as the browser (2026-09-16): the server asks
// fieldProps() which row properties a mobile view needs, so it can send a
// phone those and nothing else. Nothing at load time touches the DOM.
