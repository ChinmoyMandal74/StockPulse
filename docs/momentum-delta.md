# Momentum over time — retired 2026-09-15

**Read this only if momentum comes up again.** It is parked here deliberately so it
is not carrying weight in every session.

## What was retired, and what was kept

The owner's line, and it is the right one: **keep what measures, drop what forecasts.**

| | |
|---|---|
| **Kept, still live** | The momentum score and 1-10 rating, computed from bars on every refresh by . The eight factors, the logistic curves and their measured centres. The Overall score (65% momentum + 35% quality), which is still the screener's default sort. The weight lens and its presets. |
| **Retired** | Everything about momentum over TIME: the stored series, the delta, and every study built on them. |

Retired in full: the  table and its  view, the
 table,  /  fingerprinting and the drift
detection hung off them, ,  and ,
the Past Mom. and Mom. Delta columns and the Past picker, the direction arrow
( / ), the "Momentum improving" and "Momentum fading"
analysis screens and their section in the nightly email, the momentum pane on the
stock page chart, the  study and , the lab's
"momentum score slope" indicator, and the momentum, past/delta and Signal parts of
the Excel model.

## Why

Five framings were tested against the full archive and all five came back flat —
the table below is the evidence, and it is the reason this is an archive rather
than a backlog item. The delta in particular is **r = -0.003** against the next
fortnight across 264,290 stock-fortnights. The score's apparent edge lives
entirely after 2020, and a regime-dependent effect is not a tradeable one.

The product's differentiator became Advice, which never read the momentum
composite in the first place ( in every default profile), so
none of this was load-bearing.

## How to bring it back

**The data was never a measurement.** Every row of  was a pure
function of bars that are still stored, which is why dropping it costs nothing
permanent — unlike , where an unrecorded day is gone forever.

1.  — the tag on the last commit before the removal.
   Everything below existed and worked at that commit.
2. Restore 's history writer, 's momentum tables and the
    view, and .
3. momentum_history        : 303,848 rows, 270 symbols, 2007-11-13 to 2026-09-14
running model           : version 2, fingerprint b358765420f9
stored history built by : version 2, fingerprint b358765420f9 on 2026-09-09
status                  : current - the stored history is what this code produces.
mode                    : COMMIT - this writes

  AAPL      4737 days  2007-11-13 → 2026-09-14
  ABNB        27 days  2026-08-06 → 2026-09-14
  ADBE        28 days  2026-08-05 → 2026-09-14
  ADI         28 days  2026-08-05 → 2026-09-14
  ADSK        28 days  2026-08-05 → 2026-09-14
  ADYEY       28 days  2026-08-05 → 2026-09-14
  AFRM      1150 days  2022-02-11 → 2026-09-14
  ALAB        27 days  2026-08-06 → 2026-09-14
  ALB         28 days  2026-08-05 → 2026-09-14
  AMAT      4734 days  2007-11-16 → 2026-09-14
  AMD       4737 days  2007-11-13 → 2026-09-14
  AMGN        27 days  2026-08-06 → 2026-09-14
  AMT         27 days  2026-08-06 → 2026-09-14
  AMZN      4737 days  2007-11-13 → 2026-09-14
  ANET        27 days  2026-08-06 → 2026-09-14
  ANF         27 days  2026-08-06 → 2026-09-14
  AON         27 days  2026-08-06 → 2026-09-14
  APP       1087 days  2022-05-13 → 2026-09-14
  APTV        27 days  2026-08-06 → 2026-09-14
  AVAV      4669 days  2008-02-22 → 2026-09-14
  AVB         27 days  2026-07-17 → 2026-08-24
  AVGO      4029 days  2010-09-07 → 2026-09-14
  AXON      4737 days  2007-11-13 → 2026-09-14
  AXP         27 days  2026-08-06 → 2026-09-14
  AZN         27 days  2026-08-06 → 2026-09-14
  BA        4730 days  2007-11-23 → 2026-09-14
  BABA      2740 days  2015-10-20 → 2026-09-14
  BAC         27 days  2026-08-06 → 2026-09-14
  BDX         27 days  2026-08-06 → 2026-09-14
  BE        1772 days  2019-08-26 → 2026-09-14
  BIIB        27 days  2026-08-06 → 2026-09-14
  BKNG        27 days  2026-08-06 → 2026-09-14
  BKR         27 days  2026-08-06 → 2026-09-14
  BLK         27 days  2026-08-06 → 2026-09-14
  BPF      0 bars — too short to score, skipped
  BRK.A       28 days  2026-08-05 → 2026-09-14
  BUG       1451 days  2020-12-02 → 2026-09-14
  C           27 days  2026-08-06 → 2026-09-14
  CAT         27 days  2026-08-06 → 2026-09-14
  CAVA       540 days  2024-07-19 → 2026-09-14
  CB          27 days  2026-08-06 → 2026-09-14
  CBRE        27 days  2026-08-06 → 2026-09-14
  CBRS     84 bars — too short to score, skipped
  CCL         27 days  2026-08-06 → 2026-09-14
  CDNS        28 days  2026-08-05 → 2026-09-14
  CDW         27 days  2026-08-06 → 2026-09-14
  CEG        894 days  2023-02-21 → 2026-09-14
  CHKP        28 days  2026-08-05 → 2026-09-14
  CHTR        27 days  2026-08-06 → 2026-09-14
  CIEN        27 days  2026-08-06 → 2026-09-14
  CMCSA       27 days  2026-08-06 → 2026-09-14
  CMG         27 days  2026-08-06 → 2026-09-14
  COF         27 days  2026-08-06 → 2026-09-14
  COST        27 days  2026-08-06 → 2026-09-14
  CPRT        27 days  2026-08-06 → 2026-09-14
  CRM       4737 days  2007-11-13 → 2026-09-14
  CRWD      1551 days  2020-07-13 → 2026-09-14
  CRWV        94 days  2026-04-30 → 2026-09-14
  CSCO        27 days  2026-08-06 → 2026-09-14
  CSGP        27 days  2026-08-06 → 2026-09-14
  CSX         27 days  2026-08-06 → 2026-09-14
  CTAS        27 days  2026-08-06 → 2026-09-14
  CTSH        27 days  2026-08-06 → 2026-09-14
  CVNA      2084 days  2018-05-30 → 2026-09-14
  CYBR        28 days  2026-08-05 → 2026-09-14
  DASH        27 days  2026-08-06 → 2026-09-14
  DDOG      1482 days  2020-10-19 → 2026-09-14
  DE          28 days  2026-08-05 → 2026-09-14
  DECK        27 days  2026-08-06 → 2026-09-14
  DELL      2259 days  2017-09-18 → 2026-09-14
  DFS         27 days  2026-08-06 → 2026-09-14
  DIS       4730 days  2007-11-23 → 2026-09-14
  DKNG        27 days  2026-08-06 → 2026-09-14
  DLR         27 days  2026-08-06 → 2026-09-14
  DLTR        27 days  2026-08-06 → 2026-09-14
  DOCU        28 days  2026-08-05 → 2026-09-14
  DRAM     113 bars — too short to score, skipped
  DXCM        27 days  2026-08-06 → 2026-09-14
  EBAY        27 days  2026-08-06 → 2026-09-14
  EL        4730 days  2007-11-23 → 2026-09-14
  EMR         28 days  2026-08-05 → 2026-09-14
  EQIX        27 days  2026-08-06 → 2026-09-14
  ERIC      4730 days  2007-11-23 → 2026-09-14
  ETN       4737 days  2007-11-13 → 2026-09-14
  EXC         27 days  2026-08-06 → 2026-09-14
  F           27 days  2026-08-06 → 2026-09-14
  FANG        27 days  2026-08-06 → 2026-09-14
  FI          28 days  2026-08-05 → 2026-09-14
  FIS         27 days  2026-08-06 → 2026-09-14
  FIX         27 days  2026-08-06 → 2026-09-14
  FLEX      4734 days  2007-11-16 → 2026-09-14
  FTAI        32 days  2026-07-30 → 2026-09-14
  FTNT        28 days  2026-08-05 → 2026-09-14
  GE        4730 days  2007-11-23 → 2026-09-14
  GEHC        27 days  2026-08-06 → 2026-09-14
  GILD        27 days  2026-08-06 → 2026-09-14
  GLD       4737 days  2007-11-13 → 2026-09-14
  GLW         27 days  2026-08-06 → 2026-09-14
  GM          27 days  2026-08-06 → 2026-09-14
  GOOGL     4737 days  2007-11-13 → 2026-09-14
  GPN         27 days  2026-08-06 → 2026-09-14
  GS          27 days  2026-08-06 → 2026-09-14
  HD          27 days  2026-08-06 → 2026-09-14
  HLT         27 days  2026-08-06 → 2026-09-14
  HON       4737 days  2007-11-13 → 2026-09-14
  HOOD      1014 days  2022-08-29 → 2026-09-14
  HPE         27 days  2026-08-06 → 2026-09-14
  HPQ       4730 days  2007-11-23 → 2026-09-14
  HUBS        28 days  2026-08-05 → 2026-09-14
  IBM       4730 days  2007-11-23 → 2026-09-14
  IDXX        27 days  2026-08-06 → 2026-09-14
  ILMN        27 days  2026-08-06 → 2026-09-14
  INTC      4737 days  2007-11-13 → 2026-09-14
  INTU        28 days  2026-08-05 → 2026-09-14
  IPX         28 days  2026-08-05 → 2026-09-14
  IR          28 days  2026-08-05 → 2026-09-14
  IREN        28 days  2026-08-05 → 2026-09-14
  ISRG        28 days  2026-08-05 → 2026-09-14
  ITA       4734 days  2007-11-16 → 2026-09-14
  JOBY      1194 days  2021-12-09 → 2026-09-14
  JPM       4737 days  2007-11-13 → 2026-09-14
  KDP         27 days  2026-08-06 → 2026-09-14
  KHC         27 days  2026-08-06 → 2026-09-14
  KKR       3793 days  2011-08-12 → 2026-09-14
  KLAC      4737 days  2007-11-13 → 2026-09-14
  KRE         27 days  2026-08-06 → 2026-09-14
  KSS       4730 days  2007-11-23 → 2026-09-14
  KWEB      3026 days  2014-09-02 → 2026-09-14
  LITE      2529 days  2016-08-22 → 2026-09-14
  LLY       4737 days  2007-11-13 → 2026-09-14
  LOW         27 days  2026-08-06 → 2026-09-14
  LRCX      4737 days  2007-11-13 → 2026-09-14
  LSCC        28 days  2026-08-05 → 2026-09-14
  LULU        27 days  2026-08-06 → 2026-09-14
  LUMN      4730 days  2007-11-23 → 2026-09-14
  LYSDY       28 days  2026-08-05 → 2026-09-14
  MA          27 days  2026-08-06 → 2026-09-14
  MAR         27 days  2026-08-06 → 2026-09-14
  MCD         27 days  2026-08-06 → 2026-09-14
  MCO         27 days  2026-08-06 → 2026-09-14
  MDB       1963 days  2018-11-19 → 2026-09-14
  MDLZ        27 days  2026-08-06 → 2026-09-14
  MELI        27 days  2026-08-06 → 2026-09-14
  MET         27 days  2026-08-06 → 2026-09-14
  META      3327 days  2013-06-21 → 2026-09-14
  METC        28 days  2026-08-05 → 2026-09-14
  MMC         28 days  2026-08-05 → 2026-09-14
  MP          28 days  2026-08-05 → 2026-09-14
  MPC         27 days  2026-08-06 → 2026-09-14
  MRNA        27 days  2026-08-06 → 2026-09-14
  MRVL      4737 days  2007-11-13 → 2026-09-14
  MS          27 days  2026-08-06 → 2026-09-14
  MSFT      4737 days  2007-11-13 → 2026-09-14
  MSTR      4737 days  2007-11-13 → 2026-09-14
  MTUM      3099 days  2014-05-19 → 2026-09-14
  MU        4737 days  2007-11-13 → 2026-09-14
  NB          28 days  2026-08-05 → 2026-09-14
  NEE       4737 days  2007-11-13 → 2026-09-14
  NET         28 days  2026-08-05 → 2026-09-14
  NFLX        27 days  2026-08-06 → 2026-09-14
  NKE         27 days  2026-08-06 → 2026-09-14
  NNDM        28 days  2026-08-05 → 2026-09-14
  NOW       3298 days  2013-08-02 → 2026-09-14
  NSK         28 days  2026-08-06 → 2026-09-14
  NTAP        27 days  2026-08-06 → 2026-09-14
  NVDA      4737 days  2007-11-13 → 2026-09-14
  NXPI        28 days  2026-08-05 → 2026-09-14
  ODFL        27 days  2026-08-06 → 2026-09-14
  OKTA        28 days  2026-08-05 → 2026-09-14
  ON          28 days  2026-08-05 → 2026-09-14
  ORCL      4737 days  2007-11-13 → 2026-09-14
  ORLY        27 days  2026-08-06 → 2026-09-14
  OUST        28 days  2026-08-05 → 2026-09-14
  P           27 days  2026-08-06 → 2026-09-14
  PANW      3284 days  2013-08-22 → 2026-09-14
  PAYX        27 days  2026-08-06 → 2026-09-14
  PCAR        27 days  2026-08-06 → 2026-09-14
  PD          27 days  2026-08-06 → 2026-09-14
  PDD       1771 days  2019-08-27 → 2026-09-14
  PFE       4730 days  2007-11-23 → 2026-09-14
  PGR         27 days  2026-08-06 → 2026-09-14
  PH          28 days  2026-08-05 → 2026-09-14
  PINS        27 days  2026-08-06 → 2026-09-14
  PLD         27 days  2026-08-06 → 2026-09-14
  PLTR      1222 days  2021-10-29 → 2026-09-14
  PNC         27 days  2026-08-06 → 2026-09-14
  PRU         27 days  2026-08-06 → 2026-09-14
  PTON      1477 days  2020-10-26 → 2026-09-14
  PYPL        27 days  2026-08-06 → 2026-09-14
  QCOM      4737 days  2007-11-13 → 2026-09-14
  QQQ       4734 days  2007-11-16 → 2026-09-14
  QRVO        28 days  2026-08-05 → 2026-09-14
  QSR         27 days  2026-08-06 → 2026-09-14
  RBLX        27 days  2026-08-06 → 2026-09-14
  RBRK        28 days  2026-08-05 → 2026-09-14
  RCL         27 days  2026-08-06 → 2026-09-14
  REGN        27 days  2026-08-06 → 2026-09-14
  RL          27 days  2026-08-06 → 2026-09-14
  ROK         28 days  2026-08-05 → 2026-09-14
  ROKU        27 days  2026-08-06 → 2026-09-14
  ROP         27 days  2026-08-06 → 2026-09-14
  ROST        27 days  2026-08-06 → 2026-09-14
  RRX         28 days  2026-08-05 → 2026-09-14
  S           27 days  2026-08-06 → 2026-09-14
  SBUX      4730 days  2007-11-23 → 2026-09-14
  SCHW        27 days  2026-08-06 → 2026-09-14
  SG         935 days  2022-12-20 → 2026-09-14
  SHAK      2649 days  2016-03-02 → 2026-09-14
  SHOP      2573 days  2016-06-20 → 2026-09-14
  SKF         28 days  2026-08-05 → 2026-09-14
  SKHY     46 bars — too short to score, skipped
  SMCI      4623 days  2008-04-29 → 2026-09-14
  SMH       4737 days  2007-11-13 → 2026-09-14
  SNAP        27 days  2026-08-06 → 2026-09-14
  SNDK       124 days  2026-03-18 → 2026-09-14
  SNOW      1232 days  2021-10-15 → 2026-09-14
  SNPS        28 days  2026-08-05 → 2026-09-14
  SOFI      1157 days  2022-02-02 → 2026-09-14
  SOXX      4734 days  2007-11-16 → 2026-09-14
  SPCX     65 bars — too short to score, skipped
  SPG         27 days  2026-08-06 → 2026-09-14
  SPGI        27 days  2026-08-06 → 2026-09-14
  SPOT        27 days  2026-08-06 → 2026-09-14
  SQ          28 days  2026-08-05 → 2026-09-14
  STM         28 days  2026-08-05 → 2026-09-14
  STX       4737 days  2007-11-13 → 2026-09-14
  SWKS        28 days  2026-08-05 → 2026-09-14
  SYM         28 days  2026-08-05 → 2026-09-14
  T           27 days  2026-08-06 → 2026-09-14
  TE          28 days  2026-08-05 → 2026-09-14
  TEAM      2432 days  2017-01-10 → 2026-09-14
  TER         28 days  2026-08-05 → 2026-09-14
  TJX         27 days  2026-08-06 → 2026-09-14
  TKR         28 days  2026-08-05 → 2026-09-14
  TLN         28 days  2026-08-05 → 2026-09-14
  TM          27 days  2026-08-06 → 2026-09-14
  TMUS        27 days  2026-08-06 → 2026-09-14
  TPR         27 days  2026-08-06 → 2026-09-14
  TRV         27 days  2026-08-06 → 2026-09-14
  TSLA      3804 days  2011-07-28 → 2026-09-14
  TSM       4737 days  2007-11-13 → 2026-09-14
  TTD         27 days  2026-08-06 → 2026-09-14
  TTWO        27 days  2026-08-06 → 2026-09-14
  TWLO      2297 days  2017-07-25 → 2026-09-14
  TXN         28 days  2026-08-05 → 2026-09-14
  UBER      1573 days  2020-06-10 → 2026-09-14
  ULTA        27 days  2026-08-06 → 2026-09-14
  USAR        28 days  2026-08-05 → 2026-09-14
  USB         27 days  2026-08-06 → 2026-09-14
  UUUU        28 days  2026-08-05 → 2026-09-14
  V           27 days  2026-08-06 → 2026-09-14
  VFC       4730 days  2007-11-23 → 2026-09-14
  VLO         27 days  2026-08-06 → 2026-09-14
  VRSK        27 days  2026-08-06 → 2026-09-14
  VRT       1766 days  2019-09-04 → 2026-09-14
  VRTX        27 days  2026-08-06 → 2026-09-14
  VST       2225 days  2017-11-03 → 2026-09-14
  VZ          27 days  2026-08-06 → 2026-09-14
  WDAY        28 days  2026-08-05 → 2026-09-14
  WDC       4737 days  2007-11-13 → 2026-09-14
  WELL        27 days  2026-08-06 → 2026-09-14
  WFC         27 days  2026-08-06 → 2026-09-14
  WSM         27 days  2026-08-06 → 2026-09-14
  XEL         27 days  2026-08-06 → 2026-09-14
  XLE       4737 days  2007-11-13 → 2026-09-14
  XLF         27 days  2026-08-06 → 2026-09-14
  XLI       4737 days  2007-11-13 → 2026-09-14
  XOM       4737 days  2007-11-13 → 2026-09-14
  YUM         27 days  2026-08-06 → 2026-09-14
  ZBRA        28 days  2026-08-05 → 2026-09-14
  ZM        1588 days  2020-05-19 → 2026-09-14
  ZS          28 days  2026-08-05 → 2026-09-14

267 symbols scored, 5 too short, 308,499 rows written in 267.0s
stamped momentum_model  : version 2, fingerprint b358765420f9

momentum_history        : 308,508 rows, 270 symbols, 2007-11-13 to 2026-09-14
running model           : version 2, fingerprint b358765420f9
stored history built by : version 2, fingerprint b358765420f9 on 2026-09-15
status                  : current - the stored history is what this code produces. rebuilds the series from
   the bar archive. Measured at the time: **265,890 rows across 80 symbols in
   272.7s**, so roughly fifteen minutes at 270 symbols.

**The one reason it might be worth doing.** The research log's own conclusion is
that the binding constraint was never the signal, it was the universe: *"93 large,
heavily-covered, correlated names is the most arbitraged corner of the market...
Changing this would do more than any signal."* The universe is being taken toward
1,000. If breadth revives anything, this is the instrument to measure it with, and
it is fifteen minutes away.

---

# The mechanics, as they stood


## Momentum history
`momentum_history` keeps one row per symbol per trading day — the momentum score plus all eight sub-scores, stamped with the `model` that produced it, keyed on `(symbol, d)`. **Currently 308,516 rows across 91 symbols, 2007-07-02 → today** (91 not 93: SKHY and SPCX have fewer than `MIN_BARS` sessions).

**It is a cache, not a record.** Every value is a pure function of bars already stored, so if the model changes the right move is to throw the rows away and recompute — nothing is lost, because nothing here was ever a measurement of its own. That is the opposite of `fundamentals_history`, where the API only ever returns *today* and an unrecorded day is gone forever.

- **The backfill takes its symbol list from the PORTFOLIOS, not the snapshot.** It read the snapshot until Sep 2026, which is a cache of the last refresh — so the day 33 tickers were added it skipped every one of them and reported a clean "80 symbols scored" while doing it. The portfolios are the definition of what the screener covers; the snapshot is one rendering of it.
- **`momentum.js` holds the scoring, and it is the only copy.** It was extracted from `server.js` precisely so the live refresh, the backfill and any later analysis cannot drift into three slightly different models. Verified on extraction against the live app: worst gap **0.100** across 81 symbols, none over 0.15.
### Past momentum and delta — the `momentum_deltas` view
**They are not stored, because they are already stored.** Past momentum at a horizon *is* the score N trading days back, and `momentum_history` holds every trading day since 2007. Verified against the app's own numbers across **72 symbol-horizon pairs, gap 0.000** — including `delta_2w` against the `momentumChange` the screener ships. Materialising them would put ten copies of a number beside the number itself on 270,000 rows, free to drift from it and needing a rewrite on every model change.

The view gives them the shape of a table without the duplication: `symbol, d, model, score, close, past_1w…past_6m, delta_1w…delta_6m, ret_2w, fwd_ret_2w`.

**`ret_2w` and `fwd_ret_2w` answer different questions and are easy to conflate.** `ret_2w` covers the *same* fortnight as `delta_2w`, so the two move together largely by construction — the score is built out of returns. `fwd_ret_2w` is the *next* fortnight, which nothing in the score has seen, and is the only one of the pair a backtest can honestly use. Measured across 264,290 stock-fortnights: **delta_2w vs ret_2w = 0.554, delta_2w vs fwd_ret_2w = −0.003**, with forward return flat at about +1% across every delta decile. Two caveats on that number — the universe is today's tickers back-filled, so it is survivorship-biased, and daily observations of a 10-day forward return overlap heavily, so the decile flatness is the trustworthy read rather than any significance test.

- **The view joins `bars` for the close.** `momentum_history` holds no price, and both returns need one. The join is one-to-one: momentum rows are derived from bars, so every scoreable date has exactly one.
- **The view is dropped and recreated on every init**, so its definition can never lag the code documenting it. A view carries no data, so this is free. **The drop-then-create is a race under Vercel, and it took the site down on 2026-09-14**: one request per instance means a page load cold-starts several instances initializing at once, every loser's CREATE VIEW hits "already exists", and `init()` cached the rejected promise — so losing instances answered 500 to everything until recycled, while a local boot (one process, same code, same database) worked perfectly. `init()` now treats "already exists" as the desired state and never caches a failed init, so a losing instance retries on its next request. Diagnosed from `npx vercel logs` (the ops path in **Deploys**), which named the statement.

- **`LAG` counts rows, and there is one row per symbol per trading day**, so an offset of 10 rows is the fortnight the app means — the same thing `pastMomentum()` gets by slicing 10 bars. That is why the two agree exactly rather than approximately.
- **Partitioned by `(symbol, model)`, not just symbol**, so a window can never step across a scoring change and subtract two different models.
- **`readMomentumDeltas()` deliberately does not read the view.** A window function is computed before the outer filter, so pulling one symbol out of it windowed all 270,000 rows to keep 4,700 — 1.6s against **64ms** for the same answer. It windows a single partition instead. The date filter sits *outside* the window in a subquery, or the first row asked for would have no run-up behind it and its past scores would come back null.
- **Cross-sectional queries go through the view and take ~3.8s** ("who improved most on this date"), because there is no way to push a date predicate into a window. Fine for analysis, which is what the view is for; anything on the hot path should use the accessor.
- `idx_momentum_d` was added with it — the primary key is `(symbol, d)`, so a date-first query had no index at all, and that is the shape every cross-sectional question takes.

### Changing the model
**Bump `MODEL_VERSION` in `momentum.js`, then run `node --use-system-ca backfill-momentum.js --commit`. That is the whole procedure.**

- **Nothing needs wiping first.** Rows are keyed on `(symbol, d)` and the write is an upsert, so a plain re-run overwrites every date in place. `--rebuild` exists to drop symbols that have left the universe; it blanks the table for the ten minutes the run takes, so it is the *worse* default, not the safe one.
- **The app stays up throughout.** Reads filter on `MODEL_VERSION`, so once it is bumped the charts show a series filling in symbol by symbol rather than one quietly mixing two models.
- **The model fingerprints itself, because `MODEL_VERSION` is a human decision and humans forget to bump it.** `MODEL_ID` is a hash of the weights, the curves, `MIN_BARS`, the factor list and the normalised source of every scoring function. Comments and whitespace are stripped before hashing, so rewording prose does not demand a ten-minute recompute; a changed weight, a moved curve centre or an edited breakpoint buried inside `rsiScore` all change it. Verified against eight mutations: prose, a blank line and reordering the `WEIGHTS` literal leave it alone; every numeric change moves it.
- **`momentum_model` records which version and fingerprint built the stored rows** — one row, ever. `momentumModelStatus()` compares it with the running model and returns `current`, `drifted`, `unstamped` or `empty`. `versionBumped` separates the safe case (the version was raised, so reads already exclude the old rows and the app is merely short of history) from the dangerous one (the maths changed under an unchanged version, so stale rows are still served as current).
- **The stamp is only written by a run that covered the whole universe.** A `--only` or `--from` run leaves it deliberately, so an interrupted rebuild keeps reporting as out of date rather than claiming to be finished.
- **Drift is reported without anyone having to ask.** `backfill-momentum.js --check` prints the status and exits non-zero when something needs doing; `server.js` runs the same check once at boot; and the refresh report email carries a note when it fires, since the boot warning only reaches a log nobody reads on a deployed instance. The unbumped-version case is worded as a warning and the bumped one as a note — only the first silently serves wrong numbers.
- **`--rebuild` is not needed to clear departed symbols any more** — dropping a ticker purges it, see **Dropping a symbol**. It remains the way to force every row to be rewritten from scratch.
- Measured: a full recompute is **265,890 rows across 80 symbols in 272.7s**.

- **`MODEL_VERSION` is stored on every row** (`2` = absolute logistic curves; `1` was the cross-sectional percentiles and was never stored). `readMomentum()` filters on it and defaults to the current version — it did not at first, which would have let a half-finished re-backfill serve a chart mixing two models. Filtering so a half-migrated table returns a short series rather than a series that silently mixes two scoring regimes. Bump it whenever a change makes old rows incomparable, then re-run the backfill with `--rebuild`.
- **The sub-scores are stored, not just the composite**, so a different weighting can be replayed over history without recomputing from bars — which is what makes the weight presets answerable over time rather than only for today. `composite(subs, weights)` is the same function the live path uses.
- **Written on every refresh**, plain or Refresh all, from `finishLiveRefresh()`. Unlike the fundamentals write beside it there is no Refresh-all gate: momentum comes from bars, and every refresh re-pulls those. What is stored is the score the page is showing, not a second opinion recomputed from the archive.
- **A history write never fails a refresh** — the same rule the bar archive follows.
- **`MIN_BARS` is 274** — a year of bars, plus the month 12-1 skips, plus the bar it measures against. Shorter series score `null` rather than a partial number.
- **Writes are multi-row `INSERT … ON CONFLICT`, chunked at `MOMENTUM_CHUNK` (60).** A `db.batch` of 400 separate statements drew an ECONNRESET from Turso; 12 columns × 60 rows also keeps the statement under SQLite's 999-parameter ceiling.
- Backfill cost, measured: **0.31 ms per stock-day**, 270,620 rows in **559.6s**. Recomputing every factor from scratch at each date is wasteful in principle and irrelevant at this size, so the factors stay the plain implementations the rest of the app uses rather than rolling variants that could drift from them.

---

# The signal study, as it stood

## The signal study
`/signal/<SYMBOL>` puts a momentum reading against what the price did next, one stock at a time. Reached from **Signal study** beside the Momentum model download on `/stock/<SYMBOL>` — both are "go deeper on this stock's momentum", so the row already existed.

**The signal is fixed and the horizon varies** — `Momentum delta (2W)` or `Momentum score` against the next 2 weeks, month or 3 months. The other way round (fix the horizon, try signals until one works) is fishing, and the page should not make that the easy path.

- **`signal.js` holds the arithmetic**, apart from the page for the same reason `momentum.js` is apart from the server: this is what decides whether a chart says "signal" or "noise", so it has to be checkable alone. Verified against hand-computed values and a textbook r of 0.7746, and `/api/signal`'s answer for DELL re-derived straight from the view — **r 0.031897 both ways, hit 63.8%, base 60.2%**.
- **Three things make a weak relationship look strong, and each has an answer in the module.** A trend line through a round cloud — so `fit` returns r² beside the slope and the page draws the line faint. Overlapping windows — 2,235 daily observations of a 10-day return carry ~223 observations' worth of evidence, which the page prints beside the raw n, with a **Non-overlapping** toggle that samples every 10th session. A hit rate with no baseline — so `quadrants` returns the base rate and the **lift** between them, which is the only one of the three worth reading.
- **A level is split at its median, not at zero.** `quadrants(pairs, xSplit)` exists because splitting the 0-100 momentum score at zero put every row on the high side and reported a lift of exactly `+0.0 pts` for every horizon — a number that looked like a finding and was an artefact. `SIGNAL_XS` carries `split`, plus the words (`rose`/`fell` against `was high`/`was low`) so the labels cannot describe a median as "up".
- **The scatter scales uniformly**, unlike the price chart — no `preserveAspectRatio="none"` — so a dot stays a dot and this chart can label itself in SVG where the price chart must use HTML overlays.
- **Axes cover the middle 99%, and the strays are pinned to the edge in amber and counted**, not dropped. DELL has fortnights past +100%; letting them set the scale pressed the other 2,200 points into a band a few pixels tall, and the shape of the cloud is the whole point of the panel.
- **Each dot carries a tooltip at the cursor** — date, close, momentum, the score a lookback ago, the delta, RSI, and the forward return below a rule, because that last one is the answer the chart is asking after rather than another condition. It attaches to the nearest dot within 11px, so an empty patch says nothing instead of volunteering whichever point is closest across the chart, and it is clamped inside the panel so a dot near an edge does not push the card out of it. `score` and `close` are shipped for it; the earlier value is `score − delta`, so it costs nothing extra.
- **`dotNodes` is captured once per render.** The first version ran `querySelectorAll('.dot')` and `indexOf` on every pointer move, which is 2,235 elements a mousemove and made the chart feel sticky.
- **The decile panel draws the overall mean as a dashed line**, because "flat at the mean" is what no signal looks like and bars against zero cannot show it.
- **The RSI filter and the matrix.** Bands are Any / <30 / 30–45 / 45–55 / 55–70 / >70, half-open so a reading falls in exactly one, with the session count on each pill because a band that filters down to nothing should say so before you read a mean off it. The matrix panel crosses those bands with the direction of the signal, since a filter alone makes you click through combinations and hold numbers in your head.
- **Raw RSI is computed per request, not stored.** `momentum_history` keeps the rsi *sub-score*, which is a non-monotonic curve — 25 and 85 both score low — so it cannot be inverted back to a reading. `Momentum.rsiSeriesAt()` does one Wilder pass over the bars instead; verified to reproduce `rsi()` exactly at 61 sampled dates (gap 0) and to match the screener's own RSI column to four decimals. It is outside `FNS`, so adding it left `MODEL_ID` unchanged and the stored history untouched.
- **The page recomputes every statistic itself**, through the same module the server used — a round trip per band would make a control that should feel instant feel like a query. The payload's `x`/`y` are rounded to 2dp for size, and **the server now summarises those same rounded arrays**: computing its own numbers at full precision left the page and the payload disagreeing in the sixth decimal, which means nothing and would cost somebody an afternoon.
- **On the hypothesis the filter was built to test** — low RSI plus a positive momentum delta. Across 264,290 stock-fortnights that cell returns **+3.57% against a +1.02% baseline**, the best of the twenty-five. But it is **811 sessions, ~81 independent, t = 1.71** against everything else, and the setup occurs 0.31% of the time. Suggestive, not established. Splitting it further, oversold alone gives +1.74% and a positive delta alone gives +0.99% — so what little there is comes from the RSI side, not the delta.
- **What it currently says**: DELL, delta vs the next fortnight, **r 0.032 over 2,235 sessions (~223 independent), lift +3.5 pts** — no usable relationship, matching the universe-wide −0.003.

---

# The findings — why this was retired

The momentum-specific half of the research log. The method section and the
non-momentum findings (range position, the 50-day trend rule, volume
confirmation) stayed in CLAUDE.md, because they still apply.

## Does any of this predict anything? — the research log
**Read this before designing another backtest.** Four framings have been tested against the full archive and all four came back flat. The point of writing them down is so the next session tries something new rather than rediscovering the same negatives.

**The owner's constraint: a maximum holding period of one to two months.** That is the hardest horizon there is — short-term reversal has faded and momentum has not started — and it rules out most of what the literature offers. Anything proposed should be judged against it.

### What has been tested, and what came back

| test | result |
|---|---|
| **delta_2w → next fortnight**, pooled, 264,290 stock-fortnights | **r = −0.003.** Deciles flat at ~+1% |
| delta_2w → *same* fortnight | r = 0.554 — it mostly restates the move that just happened |
| **delta_2w cross-sectionally**, long-short | **−0.02%, t −0.15.** Nothing |
| **score (level) → next fortnight**, pooled | **r = 0.0008.** Swapping level for delta in the same framing changes nothing |
| **score cross-sectionally**, top decile | +0.51% excess per fortnight — but see the split below |
| **the hold-out split** on that | **2008–2019 t 0.13; 2020–2026 t 2.47.** Twelve years of nothing, then everything |
| **all eight sub-scores individually**, 1m and 3m, cross-sectional | Return factors repeat the composite exactly. `revers1m`, `rsi`, `consistency` are noise. `trend` has the largest single t (−3.3) and flips sign after 2020 |
| **range position → next month**, three definitions (60d z-score, 252d and 120d high-low band), cross-sectional | **Flat, and mildly the wrong way.** Bottom band −0.00% to +0.53%, top band +0.23% to +0.27%; largest \|t\| anywhere 1.2 in one thin cell. The *top* of the range does slightly better than the bottom |
| **the two falling-knife filters** on the bottom band — idiosyncratic vs market-wide fall, and "has it turned" | Neither helps; both point slightly the wrong way. Stacking trend + idiosyncratic + turned leaves **under 500 observations in nineteen years**, ~26 a year — unusable even if it worked |
| **RSI**, 40 settings, cross-sectional at one month | **Best top-decile t: 1.76** on the 116-symbol universe, **2.73** on the 93-symbol one — see the universe section; the pool changed, not the indicator. |
| | Pre-2020 t 0.1, post-2020 t 2.2. Pre-2020 t 0.1, post-2020 t 2.2. On a single stock the deciles are visibly non-flat while the correlation reads 0.044 — which is the lesson, not a finding |
| **momentum score slope**, 48 settings, cross-sectional at one month | **Best top-decile t: 0.80.** Weaker than velocity and weaker than nothing useful. Pre-2020 t −1.3, post-2020 t +2.0 — a better estimator of the delta is still flat |
| **risk-adjusted velocity**, 144 parameter settings, cross-sectional at one month | **Best top-decile t anywhere on the grid: 1.73.** With 144 tests that is noise. Pre-2020 t 0.2–0.6, post-2020 t 1.6–2.1 — the same split as everything else |
| **a 50-day-only trend rule**, raw and with 2/3-close persistence filters, vs the 200-day rule, 90 symbols | **Worse than the 200D at every cost level, in both eras.** Median 158 round trips vs 62 (persistence trims to 68 but does not rescue returns); beats the 200D on 30/90 stocks at zero cost, 19/90 at 20 bps; identical drawdown medians, so it buys nothing on risk either. The faster re-boarding is real (PTON: −12% vs the 200D's −62%) and swamped by churn everywhere else (NVDA: +4,446% vs +47,355%). Measured 2026-09-12; do not build a 50D mode without a new reason |
| **low RSI + rising delta** (the owner's hypothesis) | +3.57% against a +1.02% baseline — but 811 sessions, ~81 independent, **t = 1.71**, occurring 0.31% of the time. Oversold alone gives +1.74%, a positive delta alone +0.99%, so what little is there comes from the RSI side |
| **volume confirmation on breakouts** (2026-09-14; three definitions × vol/20d-avg at 1.25/1.5/2.0×, benchmark-relative 1M/2M excess) | **The first result whose sign survives the 2020 split.** Fresh 3M-high crosses on ≥1.5× volume beat quiet ones in BOTH eras (pre-2020 +0.36%/1M t 2.56, +0.56%/2M t 2.52; post +0.88% t 2.43, +1.39% t 2.54; pooled t 3.4–3.6 on 32k events); 52W-high crosses agree, strongest pre-2020 (t 3.2–3.5). Event clustering means the honest t is nearer 2–2.5. **The 200D upcross gets nothing from volume in either era** — the engine's trend gate has no volume story. Effect is real-looking but small (+½–1% per event over 1–2 months) and not monotone (2× is weaker than 1.5× — blowoff days). Suggestive; fit for a descriptive marker, not a gate |

### The conclusions

- **The delta is not predictive in any framing** — pooled, per-stock, or cross-sectional. It stays in the product as the table's arrow, which is a descriptive job it does well. Do not test it again without a new reason.
- **The level is the better-founded variable** and is the right input to a cross-sectional test, but its apparent edge lives entirely after 2020. A regime-dependent effect is not a tradeable one.
- **The range hypothesis does not hold here.** "Stocks trade in ranges, buy the lower side, avoid the falling knife" was tested with three range definitions and both knife filters. Every cell sits inside noise, and the faint direction runs *toward* momentum rather than reversion. The one cell that looked interesting — bottom band, trend intact, not falling worse than the market — reads **−0.03% before 2020 against +1.59% after, t 0.6**: the same regime split as everything else.
- **The trend filter (above/below the 200-day) is the only thing that keeps reappearing**, positive in four of five range bands and negative below the line in four of five. It is never significant (|t| ≤ 0.8) and `from_high` looked this promising once too, so treat it as a lead and not a finding.
- **Nothing yet clears a bar worth acting on**, least of all at a one-to-two-month horizon. The nearest miss is volume-confirmed momentum breakouts (above), the only line whose sign held through the 2020 split — worth showing as a fact beside the Entry state, not worth gating a rule on.
- **The screener is descriptive rather than predictive**, and that is a legitimate thing for it to be: a consistent way to see where every stock in the universe stands and how each got there.

### The method, which matters more than any single result

Four ways to make a weak relationship look strong, each of which has caught something real here:

- **Hold out a period before looking.** `from_high` looked like the one factor with a consistent sign across the whole archive until it was re-run on the widened universe, where it fell from t −2.2 to −1.4 and lost half its magnitude. It was a universe artefact.
- **Discount for overlapping windows.** Daily observations of a 10-day forward return carry about one observation's worth of evidence per ten. A level is far more autocorrelated than a delta, so its effective sample is smaller still — a per-stock test of the level has almost no power, whatever its n says.
- **Rank within the day, not across the pool.** Both legs then live through the same fortnight, so the market subtracts out and the baseline becomes zero by construction. This is the only framing that has shown anything at all.
- **Give a hit rate its base rate.** A stock that rises most fortnights hands a high hit rate to a signal that knows nothing. Only the lift is worth reading. Splitting a 0-100 score at zero once reported a lift of exactly `+0.0 pts` for every horizon — an artefact that looked like a finding.

### What would actually change the answer

Five hypotheses have now come back flat, which starts to say something about the search space rather than the hypotheses. The binding constraints, in order:

- **The universe.** 93 large, heavily-covered, correlated names is the most arbitraged corner of the market, and at a one-month horizon most of their variance is common. Mean reversion in particular works better in higher-volatility, less-followed stocks. Changing this would do more than any signal.
- **The data.** Everything tested comes from daily bars. Earnings revisions, short interest, options positioning and intraday behaviour are all absent, and they are where the remaining short-horizon effects live.
- **The horizon.** One to two months is the gap between reversal and momentum. Nothing much lives there.

### Untested, and worth doing

- **Post-earnings announcement drift** is the best fit for a one-to-two-month hold that exists — right timescale, durable literature, and there is already a "Drifting after a beat" screen built on the idea. **Recording began 2026-09-13**: `next_earnings_date`, `next_earnings_estimated`, `last_earnings_date` and `last_surprise` now ride every Refresh-all row of `fundamentals_history` (via `FUND_EXTRAS` in db.js — written beside `FUND_FIELDS`, deliberately outside the email's numeric moved-fields pipeline). The study becomes answerable a couple of quarters after that date; nothing before it is recoverable.
- **Benchmark-relative returns everywhere** — subtract the universe's equal-weight return that day. It turns "did it go up" into "did it beat its peers", which is the only version that survives the remaining bias.
- **Longer horizons, 6m and 12m.** The model is built around 12-1 momentum and has never been tested at the horizon it was designed for. Two more `LEAD`s in the view.
- **A per-factor sign.** `cleanWeights()` clamps weights to `0…MAX_WEIGHT` as integers, so a factor can be zeroed but not inverted. Expressing a reversion model needs a sign. Build that as a second model, not as a preset — a momentum model with its momentum inverted is a different thing wearing the same name.

### Where the analysis actually runs

**On the owner's machine, in throwaway scripts, leaving no trace.** None of the numbers above can be reproduced from the product; there is no button for any of it. If a result starts mattering, precompute it nightly into its own table the way `momentum_history` is — a page that recomputes a universe-wide statistic per request would be the 3.8s cross-sectional query on every load.

**The wall is a duration, not a size.** An early note here said "~36 MB in one round trip" and that was wrong — measured properly:

| query | result |
|---|---|
| `readBarsFor`-shaped, 650 days x universe — **the biggest the app issues** | **50,036 rows, 2.0s** |
| one symbol's full momentum history | 4,734 rows, 0.2s |
| the snapshot `/api/stocks` serves | 0.34 MB |
| all bars, `close` only | 441,483 rows, **82.6s — ok** |
| all bars, every column | 441,483 rows, **158.1s — ok** |
| all `momentum_history`, every column | **fails at 261.1s**, having read 83.3 MB |
| both of those in parallel | **fails at 215.8s**, having read 36.2 MB |
| `ntile()` deciles aggregated server-side, returning 10 rows | **ok, but 159.7s** |

So a single query has carried 441k full rows fine, and the failure came after **83 MB**. The boundary sits between **158s and 216s** — a response timeout of roughly three minutes somewhere in the stack. Parallel queries fail *sooner in bytes* only because they share wall-clock, which is what made it look like a size cap.

- **Production is nowhere near it.** The largest query any route issues is 50k rows in 2.0s — about eighty times inside the wall. This constrains ad-hoc analysis, nothing else.
- **Pushing the work into SQL is not the escape hatch it looks like.** The `ntile()` aggregation returns ten rows and still took 159.7s: for whole-archive work Turso is compute-bound too, and that query is itself close to timing out.
- **For repeated analysis, use the local copy — `analysis-db.js`.** `node:sqlite` ships with Node 24, so it adds no dependency. **Full build 48.6s for 852,706 rows; incremental sync 4.7s.** Verified faithful on creation: every table's count matched and 726 spot-checked values differed by exactly zero.
  - **The gain is not marginal.** The `ntile()` decile query takes **0.53s locally against 159.7s on Turso — 300x**, and the whole momentum table loads into memory in 0.39s against 41s chunked over the network. Research that was minutes-per-iteration is now instant, and costs no rows against the Turso account.
  - **It deliberately omits `users`, `sessions` and `password_resets`** — password hashes and live session tokens have no business in an unencrypted file on a laptop — and `visitors`, `prefs`, `chat_usage` as personal and useless here. **It is not a backup.**
  - The schema is copied from `sqlite_master` rather than restated, so a column added upstream arrives without this file knowing about it. Dated tables re-pull `OVERLAP_DAYS` (10) on top of what is local, because the archive rewrites recent bars — a provisional close for a session still in progress is not final. A split rewrites a symbol's whole history, so **`--full` after a split**, the same repair path `backfill-bars.js --only` is for.
- A full momentum backfill is **500.3s for 113 symbols**. The whole-universe cross-sectional query through `momentum_deltas` is **~3.8s**.
