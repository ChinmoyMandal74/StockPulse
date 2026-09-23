# The momentum score and the Overall composite — removed 2026-09-23

Both were deleted from the product at the owner's instruction: *"Delete overall
as well … I do not want any reference to momentum except the backup taken."*

**Everything is in git.** The tag **`momentum-scoring`** marks the last commit
where all of it worked (`268536b`). This file is the part git cannot hold: what
the model was, where its numbers came from, and what was already known about
whether it worked. Read this before rebuilding any of it — as with
[momentum-delta.md](momentum-delta.md), do not reconstruct it from memory.

```
git show momentum-scoring:momentum.js          the model
git show momentum-scoring:momentum-model.js    the Excel workbook
git worktree add /tmp/mom momentum-scoring     the whole app, running
```

## What existed

Three composite scores per stock, 1–10, computed in `computeScores()` in
server.js from `scoreBars()` in `momentum.js`:

- **Momentum** — price strength, eight factors, described below
- **Quality** — company fundamentals (**kept**; it is the one composite that
  never depended on momentum)
- **Overall** — `0.65 × momentum + 0.35 × quality`, and the table's default sort

`MIN_BARS` was **274**: a year of bars, plus the month 12-1 skips, plus the bar
it measures against. A stock with less history simply had no score, which is
what `/quality`'s "too short to score" flag counted.

## The model

`MODEL_VERSION 2` — absolute logistic curves, Sep 2026. Version 1 was
cross-sectional percentiles and was never stored.

| factor | weight | notes |
|---|---|---|
| `mom121` | 20 | 12-month return **skipping the last month**, risk-adjusted |
| `ret6m` | 18 | risk-adjusted |
| `ret3m` | 17 | risk-adjusted |
| `fromHigh` | 10 | % from the 52-week high |
| `trend` | 10 | 200D side + cross freshness; categorical, not curved |
| `consistency` | 10 | share of the last 12 months that closed up |
| `revers1m` | 8 | 1-month reversal, **inverted** — biggest recent movers score lowest |
| `rsi` | 7 | non-monotonic, peaks at 70–75 |

Every input came from the daily bars a refresh already fetched, so the whole
score cost **no API credits**. 12-1 and consistency need ~260 of the ~300 bars
a pull returns.

### Why a logistic curve, and where the centres came from

`curve(v, centre, scale)` is `0.5 + 0.5·tanh((v − centre) / scale)`.

The first absolute model used clamped straight lines and pinned **33–51% of
stocks** at a floor or ceiling on every major factor. A factor that is constant
across half the list cannot order anything — that is what had sent the model to
percentiles in the first place. The tanh is asymptotic, so ordering survives at
the extremes: measured after the change, **3.4% of sub-scores** landed within
0.005 of an end, and that is an upper bound because the stored breakdown rounds
to two decimals.

**The centres are measured, not chosen.** Each is the median of that factor
across the bar archive at six dates spanning 2011–2026, with the scale roughly
the interquartile spread:

```
mom121      0.70 / 1.30        fromHigh      -12 / 14
ret6m       0.55 / 0.90        consistency    58 / 15
ret3m       0.25 / 0.45        revers1m      1.0 / 10   (inverted)
```

The risk-adjusted returns are dimensionless — a return over its own volatility —
which is what makes a fixed scale meaningful for them at all. **They are
constants deliberately**: deriving them from the current universe would be
percentiles under another name, and a "mid" score would stop meaning the same
thing next year.

### Four factors were removed before this, each for a measured reason

Worth keeping, because any rebuild will be tempted by the same four:

- **RS vs S&P** was `threeMonthPct` minus a constant identical for every stock.
  Correlation with 3M return was exactly **1.000** — it could not reorder
  anything while consuming a quarter of the weight.
- **MACD** was binary (0.8/0.2), discarding magnitude. Correlation with the
  composite: **0.022**.
- **Vol trend** was unsigned, so a crash on heavy volume scored like a breakout.
  **51%** of the universe sat at its floor and none reached the ceiling. If it
  ever returns, sign it: `volTrend × sign(1M)`.
- **Short squeeze** rewarded heavy short interest, which predicts *weaker*
  returns. It correlated **−0.223** with the composite, pulling against
  everything else.

### What switching to the absolute model cost, measured before it shipped

Median order change **2 places**, worst 11; **no stock's 1–10 rating moved by
more than one point**, 48 of 82 unchanged. The list barely moved; what changed
is that the numbers meant something fixed.

## Did it predict anything?

**No, and that is measured rather than assumed.** The research log in CLAUDE.md
records seven framings that came back flat. Specifically for the score and its
delta, [momentum-delta.md](momentum-delta.md) records five, the strongest
reading **r = −0.003** against the next fortnight; momentum-over-time was
retired on 2026-09-15 for that reason (tag `momentum-retired`).

The live score survived that cull as a *description* of where a stock stood
rather than a claim about where it was going. This removal ends that too.

**The advice engine never used it.** Every default profile carries
`use_momentum: false`, which is what made both removals safe — the verdicts,
the trend ribbon, the backtests and `tech_history` are untouched by this.

## What the removal had to preserve

`momentum.js` held the score **and** generic bar maths that other things depend
on. The generic half survives as **`barmath.js`**:

| kept | used by |
|---|---|
| `rsiSeriesAt`, `rsi` | `techrow.js` → the advice engine, `tech_history`, both backtests |
| `realisedVol` | the **Cushion** column (`drop ÷ (realisedVol ÷ √12)`) |
| `smaAt`, `maCross` | the technical row builder |
| `pctChange`, `windowReturn` | the return columns |

RSI in particular feeds `tech_history` and the advice verdicts, so it was
checked as **byte-identical across the move** rather than assumed.

Deleted with the score: `subScores`, `composite`, `scoreBars`, `curve`,
`riskAdj`, `trendSub`, `rsiScore`, `positiveMonths`, `pctFromHigh`, `FACTORS`,
`WEIGHTS`, `CURVES`, `MODEL_VERSION`, `MODEL_ID`, `MIN_BARS`.

## Everything else that went

- **Overall**, and with it the table's default sort — now **Market cap**.
- The **Momentum** and **Overall** columns, their cells, the score tooltip's
  `overall` / `momentum` / `rank` kinds, and their rows in the hover card,
  the tiles and the phone.
- **The momentum weight lens** — the presets (Default / Trend / Steady /
  Custom), `cleanWeights()`, the sliders in the admin console's Scoring
  section, `prefs.weights`, and `#lensChip`.
- **`momentum-model.js`** and `GET /api/model` — the three-sheet Excel workbook
  in which every cell was a live formula over the bars, so changing a close
  moved the score. Verified against the app at **72.1 against 72.1** on CRWD.
- Starter screens and column views that sorted or filtered on the two scores.
- The help page's scoring sections, and the landing page's mentions.

## If you ever rebuild it

Start from `git show momentum-scoring:momentum.js` — not from this file, and
not from memory. Then read the research log in CLAUDE.md and
[momentum-delta.md](momentum-delta.md) **before** deciding it is worth
shipping: the honest summary is that eight years of archive could not find a
horizon at which this score predicted anything, and the one-to-two-month hold
the owner works to is the hardest horizon there is.
