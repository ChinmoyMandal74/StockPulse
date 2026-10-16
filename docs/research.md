# Research — what has been tested, and what came back

Every backtest run on the Tickr Lab archive, written up the same way: the idea, what was done, the outcome, and what follows from it. **This file is the data behind the members' page at `/research`.** An entry is added or changed by editing this file and pushing; the page reads it.

How every test here is judged, unless an entry says otherwise:

- **Against the average stock, not against zero.** Each result is compared with the equal-weight average of every stock in the archive over the same window. Most stocks rise in most months, so "it went up" says little; "it beat the rest" is the question.
- **Each period on its own.** Results are split before and after 2020. Almost everything that looks good in this archive looks good only after 2020.
- **Events counted once.** A stock that qualifies on twenty days in a row is one event, not twenty.
- **Typical as well as average.** A few very large winners can lift an average that the typical case does not share; the median is reported beside the mean.
- **The archive is today's list of stocks.** Companies that fell away and were delisted are mostly absent, which flatters any test of stocks that have already fallen hard. Every result here carries that bias.

Nothing on this page is investment advice or a recommendation to trade. It records what past prices did, which is not a forecast of what they will do.

<!--
HOW AN ENTRY IS WRITTEN (the page reads these exactly):

## 14. The title — 2026-10-15

*Family: Mean reversion · Verdict: One period only · Horizon: 1 month · Data: Daily prices · Sample: 658 events in 174 stocks, 2009–2026*

### The idea
### What was done
### Outcome
### What follows
### Caveats        (optional)
### Numbers        (optional, tables welcome)

Verdict is one of: Weak lead · One period only · No edge · Wrong way · Used for display · Not yet tested.
The four sections named first become the page's columns; their first paragraph is the summary shown in the row.
-->

## 1. A price-strength score from eight factors — 2026-09-23

*Family: Momentum · Verdict: One period only · Horizon: 2 weeks to 1 month · Data: Daily prices · Sample: The archive, 2007–2026*

### The idea
Stocks that have risen steadily over the past year keep outperforming for a while. A score that blends several measures of that strength should rank tomorrow's leaders.

### What was done
A 1–10 score built from eight measures: the 12-month return skipping the latest month, the 6- and 3-month returns (each adjusted for the stock's own volatility), distance from the 52-week high, the side of the 200-day average, the share of up months, last month's move (inverted) and RSI. It was compared with the following fortnight and month in five different framings.

### Outcome
Any apparent edge lived entirely after 2020; before 2020 the score ranked nothing. An effect that appears in one period and not the other cannot be told apart from that period's market.

### What follows
The score was removed from the product on 2026-09-23. The Quality score, which never depended on it, was kept.

## 2. Whether price strength is rising or fading — 2026-09-15

*Family: Momentum · Verdict: No edge · Horizon: 2 weeks · Data: Daily prices · Sample: 264,290 stock-fortnights*

### The idea
A stock whose strength score is improving should do better than one whose score is fading, whatever the level.

### What was done
The change in the score over time, stored daily from 2007, compared with the next fortnight's return in five framings.

### Outcome
None. The correlation between the change and the next fortnight was **−0.003**, as close to nothing as a measurement gets.

### What follows
Everything about the score's change over time was retired on 2026-09-15: the history, the columns and the screens built on it.

## 3. Buying the bottom of a stock's range

*Family: Mean reversion · Verdict: Wrong way · Horizon: 1 month · Data: Daily prices · Sample: The archive, three range definitions*

### The idea
Stocks trade in ranges. One near the bottom of its range should drift back up; one near the top should stall.

### What was done
Three ways of defining the range (a 60-day z-score, and the 252- and 120-day high-low bands). Each stock was ranked against the others on the same day by where it sat, and the next month's return compared across the bands.

### Outcome
Flat, and faintly the wrong way. The bottom band returned between 0.00% and +0.53% a month and the top band +0.23% to +0.27%. The largest t-statistic anywhere was 1.2, in one thin cell. If anything, the top of the range did slightly better than the bottom: continuation, not reversion.

### What follows
Nothing in the product ranks stocks by their place in the range. The 52W range column shows where a stock sits, as a description.

## 4. Filtering out falling knives

*Family: Mean reversion · Verdict: No edge · Horizon: 1 month · Data: Daily prices · Sample: Under 500 events in nineteen years when combined*

### The idea
The bottom of the range might work once the stocks falling for their own reasons are removed, or once the fall has visibly turned.

### What was done
Two filters on the bottom band: whether the fall was the stock's own or the whole market's, and whether the price had turned up. Then all three together with the trend.

### Outcome
Neither filter helped, and both pointed slightly the wrong way. Stacked together they left under 500 events in nineteen years, about 26 a year: too few to use even if they had worked.

### What follows
No falling-knife filter is used anywhere.

## 7. A 50-day trend rule instead of the 200-day — 2026-09-12

*Family: Trend · Verdict: No edge · Horizon: Holding while the trend lasts · Data: Daily prices · Sample: 90 stocks, both periods*

### The idea
The 200-day average is slow to react. A 50-day rule would get back into a recovering stock sooner and out of a falling one sooner.

### What was done
Above the 50-day held, below it out, compared with the same rule on the 200-day, raw and with filters requiring two or three closes on the new side. Trading costs from zero to 20 basis points a trade.

### Outcome
Worse than the 200-day at every cost level, in both periods. It traded far more often (a median 158 round trips against 62) and did no better on drawdowns. It beat the 200-day on 30 of 90 stocks at zero cost and 19 of 90 at 20 basis points. Getting back in sooner is real on single stocks and is swamped everywhere else by the extra trading.

### What follows
The trend half of the Signal stays on the 200-day.

## 8. Ranking within a Signal tier by room to the exit — 2026-09-17

*Family: Risk · Verdict: Used for display · Horizon: 1 to 3 months · Data: Daily prices · Sample: 307,965 stock-days*

### The idea
Within one Signal tier, a stock with more room before the rules would exit should be the safer one.

### What was done
Inside each tier, stocks were split by the distance to the exit and their returns compared with the average stock on the same day, both as a raw percentage and divided by the stock's own volatility.

### Outcome
The raw distance sorts risk backwards. The roomiest half sat 25.6% above its 200-day on 31.7% volatility, against 13.8% and 24.3%. "More room" mostly means "more stretched", and its bad months were worse in all six period and horizon cells. Divided by the stock's own volatility it behaves: the bad months were milder in six of six cells. Neither version picks better returns; every difference in the average was noise.

### What follows
Shown as the **Cushion** column, labelled as the size of the bad case and not as an expected return.

## 10. Cyclical companies against steady growers — 2026-09-29

*Family: Signal · Verdict: No edge · Horizon: 1 to 3 months · Data: Filings and daily prices · Sample: 1,203,618 stock-days, 127 cyclical and 202 steady*

### The idea
The Signal might work for one kind of company and fail for another, and the two might cancel out in the overall result.

### What was done
Companies were sorted by their own filings into cyclical (frequent revenue declines, wide margin swings) and steady growers, then the eighteen-year Signal replay was run on each group separately.

### Outcome
The split explained nothing. The gap between the tiers was the same in both groups and every tier sat within two points of its own group's average. Very Weak had the highest median in both groups.

### What follows
Not used. Before reaching for another way to split the stocks, this says the flatness is not two effects cancelling.

### Caveats
The steady group's average return was double the cyclical group's, but that is an artefact: a company was labelled steady for having no revenue decline over the same years being tested.

## 11. Double tops and double bottoms — 2026-10-02

*Family: Chart patterns · Verdict: Wrong way · Horizon: 1, 3 and 6 months · Data: Daily prices · Sample: 565 tops and 988 bottoms at the middle setting, 1,147 stocks, 18.7 years*

### The idea
The classic reversal patterns: a double top should be followed by weakness and a double bottom by strength.

### What was done
Patterns found mechanically from closing prices and dated on the day they were confirmed, at eighteen settings. Each was compared with the average stock, with ranges worked out month by month.

### Outcome
The two patterns could not be told apart at any horizon. If either worked they would pull apart; instead the gap between them included zero every time, and its sign flipped between three and six months. The bullish pattern was reliably bad: after six months the double bottom sat between −15.3% and −7.6% against the average stock's −6.2% to −3.4%.

### What follows
Not used. The likely reading is that both patterns pick stocks that have just made a sharp move, and those lag in either direction. Any future pattern will be tested as a pair (the pattern and its opposite).

## 12. A smarter volatility inside Cushion — 2026-10-05

*Family: Risk · Verdict: No edge · Horizon: 1 to 3 months · Data: Daily prices · Sample: 845,008 stock-days, 18 years*

### The idea
Volatility comes in clusters, so a measure that weights recent days more heavily should describe the next month's risk better than a flat six-month average.

### What was done
Cushion recomputed with three decay rates for an exponentially weighted volatility, and each version compared with the flat average on how well it separated milder bad cases from worse ones within each tier.

### Outcome
The flat average won five cells and the weighted one three; every decay rate gave the same verdict. The two versions ranked stocks almost identically (rank correlation 0.984). The clustering fades within days, well before a month is over.

### What follows
Cushion is unchanged.

## 13. Breakouts on heavy volume — 2026-09-14

*Family: Breakouts · Verdict: Weak lead · Horizon: 1 to 2 months · Data: Daily prices and volume · Sample: About 32,000 events*

### The idea
A stock that makes a new three-month high on unusually heavy volume has real demand behind it, and should do better than one that drifts to the same high on light volume.

### What was done
New 3-month and 52-week highs, split by volume against the 20-day average at 1.25, 1.5 and 2 times, compared with the average stock one and two months later.

### Outcome
**The only result here whose direction held in both periods.** New highs on at least 1.5 times average volume beat quiet ones by about +0.4% a month before 2020 and +0.9% after. Small, and not tidy: two times volume did worse than 1.5 times, probably because the very heaviest days are blow-offs. A cross back above the 200-day gained nothing from volume in either period.

### What follows
Shown as the **Breakout** reading beside the Entry state, as a fact about the day. Not used to change the Signal.

### Caveats
Breakouts cluster in the same weeks, so the statistics overstate how independent the 32,000 events are; the honest t-statistic is nearer 2 to 2.5 than the 3.5 measured.

## 14. High fliers that fell 40%, entered near the 200-day — 2026-10-15

*Family: Mean reversion · Verdict: One period only · Horizon: 1 month · Data: Daily prices · Sample: 658 events in 174 stocks, 165 months, 2009–2026*

### The idea
A stock that had doubled, then fell 40% or more from its 52-week high, may find a floor around its 200-day average. Entering there and holding a month should do well.

### What was done
An event was a day when a stock (a) had at least doubled in the year before its 52-week high, (b) closed 40% or more below that high, and (c) closed within 5% of its 200-day average. Returns were measured from the next day's close over 21 trading days and compared with the average stock over the same days. A stock counted at most once a month. Days near a one-day price jump of more than double, the usual sign of an unadjusted split, were left out.

### Outcome
The average event made **+4.8%** in the month, **+3.0%** more than the average stock. But the typical event did slightly worse than the average stock (median −0.7%), and only 48% beat it. Remove the ten best of the 658 and the edge falls to +1.2%. Before 2020 it lagged the average stock by 1.3%; from 2020 to 2024 it led by 2.9%; in 2025–2026 by 5.6%.

### What follows
Not used, and a lottery ticket rather than an edge: a few very large rebounds carry the average, and only in the speculative market of recent years. The 200-day part adds nothing, since the same stocks entered well below the 200-day did about as well.

### Caveats
The archive lacks most of the high fliers that fell and never recovered, which flatters exactly this kind of test. 41% of the events fall in 2025–2026.

### Numbers

| Group | Events | Average | Median | Average vs the average stock | Median vs it | Beat it |
|---|---|---|---|---|---|---|
| High fliers, 40% down, near the 200-day | 658 | +4.8% | +0.9% | +3.0% (+0.5% to +5.6%) | −0.7% | 48% |
| Any stock near its 200-day | 83,181 | +1.2% | +1.1% | −0.3% | −0.5% | 47% |
| High fliers, 40% down, well below the 200-day | 3,155 | +3.5% | +1.8% | +1.9% | +0.3% | 51% |
| 2009–2019 only | 158 | +1.4% | — | −1.3% | −3.3% | 41% |
| 2020–2024 only | 233 | +4.8% | — | +2.9% | −1.9% | — |
| 2025–2026 only | 267 | +6.8% | — | +5.6% | +3.3% | — |

## 15. Drift after an earnings surprise

*Family: Earnings · Verdict: Not yet tested · Horizon: 1 to 2 months · Data: Earnings history and daily prices · Sample: 27,421 reported surprises since 2017*

### The idea
After a company beats or misses expectations, its price keeps drifting the same way for weeks. This is one of the most studied effects in finance, and its timescale matches a holding period of one to two months.

### What was done
Not yet run. The data is in hand: 27,421 reports with a surprise since 2017, and the daily prices after each.

### Outcome
None yet.

### What follows
The next study worth running. Almost every report lands after the close, so the window has to start the following day, or it measures the announcement jump rather than the drift.

## 16. Distance from the 200-day average, and the 200-day z-score — 2026-10-16

*Family: Mean reversion · Verdict: No edge · Horizon: 1 to 2 months · Data: Daily prices · Sample: 4.4 million stock-days and 210,101 monthly readings in 1,280 stocks, 2007–2026*

### The idea
Stocks trade around their 200-day average: one that has run far above it should come back down, and one far below should recover. If so, the distance from the average, or the same distance measured in standard deviations (a z-score), says something about the next month or two.

### What was done
Two measurements. First, over the ten years from October 2016, every stock-day's distance from its 200-day average, and whether a stock far from it was back within 5% of it one and two months later. Second, from 2007, the 200-day z-score: the close less the average of the last 200 closes, divided by their standard deviation. One reading per stock per month (the month's first session, so readings never overlap), compared with the average stock over the following one and two months, before and after 2020.

### Outcome
Stocks are seldom near the average: only a quarter of stock-days were within 5% of it, and the typical day was 10% away. Being far away persisted: of stocks 30% or more above it, 5% were back within 5% two months later, and of stocks 30% or more below it, 6%. And no level of the z-score was followed by a better or worse month than the average stock's. In every band the average difference was under one percentage point, and 45% to 51% of stocks beat the average. Before 2020 the lowest band did slightly better than the highest; from 2020 the order reversed.

### What follows
The z-score is on the screener as a description, in the Trend group beside the distance it divides (200D z-score), and is not an input to the Signal. Read it as where a stock sits, not as a sign that it is due to come back. The stock chart's Bollinger bands are the same arithmetic over 20 days, and are offered on the same terms.

### Caveats
Part of any "return" to the average is the average moving towards the price, not the price moving back, so the first measurement flatters reversion if anything. The archive is today's list of stocks, without most of those that fell and were delisted. The z-score divides by the spread of the last 200 closes, which includes the trend itself: a stock that has risen steadily has a wide spread and so a smaller z-score than its distance alone suggests.

### Numbers

| Distance from the 200-day average, 2016–2026 | Share of stock-days |
|---|---|
| Within ±5% | 25.7% |
| Within ±10% | 48.4% |
| Within ±20% | 77.0% |
| More than 30% away | 10.8% |

Typical (median) distance 10.4%; the price crossed the average 8.6 times a year per stock.

| Starting distance | Back within ±5% after 1 month | After 2 months | Readings |
|---|---|---|---|
| 30% or more above | 2% | 5% | 189,115 |
| 20% to 30% above | 5% | 11% | 202,762 |
| 10% to 20% above | 14% | 20% | 464,207 |
| 10% to 20% below | 19% | 24% | 264,384 |
| 20% to 30% below | 7% | 13% | 109,576 |
| 30% or more below | 2% | 6% | 85,658 |

| 200-day z-score, since 2007 | Share of stock-days |
|---|---|
| Between −1 and +1 | 42.4% |
| Between −2 and +2 | 84.0% |
| Above +2 | 11.3% |
| Below −2 | 4.7% |

| z-score band | Before 2020: next month vs the average stock, mean / median | Beat it | From 2020: mean / median | Beat it |
|---|---|---|---|---|
| −2 or below | +0.43% / +0.11% | 51% | −0.44% / −0.82% | 46% |
| −2 to −1 | +0.19% / −0.22% | 49% | −0.06% / −0.83% | 46% |
| −1 to 0 | +0.04% / −0.39% | 48% | +0.02% / −0.77% | 46% |
| 0 to +1 | −0.09% / −0.26% | 48% | −0.03% / −0.71% | 46% |
| +1 to +2 | −0.05% / −0.27% | 48% | −0.16% / −0.61% | 47% |
| +2 or above | −0.15% / −0.34% | 47% | +0.63% / −0.37% | 48% |

Over two months the picture is the same: every band within 0.6 points of the average stock on the mean, beat rates 45% to 49%. The medians are below zero throughout because a few large winners lift the average stock's mean.

## 17. Bollinger bands: closes outside the band, and the squeeze — 2026-10-16

*Family: Mean reversion · Verdict: No edge · Horizon: 1 to 2 months · Data: Daily prices · Sample: 173,216 events in 1,246 stocks, 2007–2026*

### The idea
Three things technical analysts read from the 20-day Bollinger band. A close below the lower band is stretched and due to recover. A close above the upper band in an uptrend is a stock "walking the band", strength that carries on. And a squeeze, the band at its narrowest in months, comes before a bigger move than usual.

### What was done
The band is the 20-day average plus and minus two standard deviations of the same 20 closes, the arithmetic the stock chart and the promo card draw. Three events: a close below the lower band, a close above the upper band, and the band's width at its lowest in 126 sessions. Each counted at most once a month per stock, and each split by whether the stock was above or below its 200-day average. Entry at the next session's close, held one and two months, against the average stock over the same sessions, before and after 2020. A t-figure from the monthly means, because events in the same month are not independent. Events next to a one-day price move of more than double or half (usually an unadjusted split) were left out, 402 of them. A script check that each event fires on a made-up shape, and not on its opposite, ran before the sweep.

### Outcome
None of the three did better or worse than the average stock by enough to matter. Every cell sat within about 0.3 points of it over a month, and 45% to 49% of events beat it. Closes below the lower band did no better than the average stock, in an uptrend or a downtrend. Closes above the upper band in an uptrend did very slightly worse, not better. And a squeeze was not followed by a bigger move: the next month's move was the same size, relative to the average stock's, as any stock-month's.

### What follows
The band stays on the stock chart and as a promo card, as a picture of recent volatility and where today's price sits in it, and nothing reads more into it. The one cell past a t of 2 (closes above the upper band while below the 200-day average, −0.28% before 2020, t −2.1) is one in twenty-four, about what chance gives; its sign held from 2020 (−0.18%) but at t −0.5.

### Caveats
The archive is today's list of stocks, without most of those that fell and were delisted, which flatters closes below the lower band if anything. The 20 days and two standard deviations are the convention, not fitted; other settings were not tried, and trying many would invite a false finding. The test is of the band alone, as a trader would use it with other evidence it was not.

### Numbers

| Event | Events | 1 month vs the average stock, mean / median | Beat it | t | 2 months, mean / median | t |
|---|---|---|---|---|---|---|
| Lower band, above the 200-day, before 2020 | 19,668 | +0.18% / −0.13% | 49% | −0.7 | +0.09% / −0.43% | −1.2 |
| Lower band, above the 200-day, from 2020 | 13,018 | +0.05% / −0.62% | 47% | −0.1 | +0.01% / −1.25% | −0.1 |
| Lower band, below the 200-day, before 2020 | 18,215 | +0.06% / −0.32% | 48% | 0.3 | +0.12% / −0.42% | 0.3 |
| Lower band, below the 200-day, from 2020 | 14,272 | +0.18% / −0.61% | 47% | 1.5 | +0.26% / −1.23% | 1.6 |
| Upper band, above the 200-day, before 2020 | 31,023 | −0.24% / −0.41% | 47% | −1.7 | −0.23% / −0.59% | −1.5 |
| Upper band, above the 200-day, from 2020 | 19,825 | −0.03% / −0.62% | 47% | 0.5 | −0.12% / −1.32% | −0.2 |
| Upper band, below the 200-day, before 2020 | 11,242 | −0.28% / −0.66% | 46% | −2.1 | −0.38% / −1.07% | −1.5 |
| Upper band, below the 200-day, from 2020 | 9,044 | −0.18% / −0.96% | 45% | −0.5 | −0.44% / −2.00% | −1.0 |
| Squeeze, above the 200-day, before 2020 | 13,036 | −0.07% / −0.28% | 48% | −1.8 | −0.05% / −0.52% | −1.0 |
| Squeeze, above the 200-day, from 2020 | 7,945 | −0.11% / −0.71% | 46% | −0.3 | +0.01% / −1.15% | 0.4 |
| Squeeze, below the 200-day, before 2020 | 4,816 | +0.23% / −0.32% | 48% | 0.5 | +0.58% / −0.47% | 1.4 |
| Squeeze, below the 200-day, from 2020 | 4,049 | −0.08% / −0.94% | 45% | 0.0 | +0.29% / −1.16% | 0.3 |

| Size of the next month's move, either way, against the average stock's that month | Median ratio | Moved more than the average stock |
|---|---|---|
| After a squeeze, before 2020 (18,118) | 0.74 | 36% |
| After a squeeze, from 2020 (12,098) | 0.72 | 35% |
| Every stock-month, for scale | 0.74 | 37% |

The medians sit below zero throughout because a few large winners lift the average stock's mean. A mean with a small positive sign beside a negative t is a month-weighting effect: a few crowded months carry many events.
