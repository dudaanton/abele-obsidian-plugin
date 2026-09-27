/**
 * The arithmetic under the analytics tools, checked against small datasets worked by hand.
 * Each expectation carries the working in a comment, so a failing number can be re-derived
 * without trusting the code that produced it.
 */
import { describe, it, expect } from 'vitest'
import { describe as summarize, percentile, mean, median, stdev } from '@/analytics/stats'
import { toUnits, fromUnits, decimalsOf, sumUnits } from '@/analytics/money'
import { periodKey, periodRange, resample, rolling } from '@/analytics/resample'
import { linearFit, trend, seasonality } from '@/analytics/trend'
import { pearson, spearman, correlation } from '@/analytics/correlate'
import { tTwoSidedP, tQuantile } from '@/analytics/tdist'
import { forecast } from '@/analytics/forecast'
import { anomalies } from '@/analytics/anomalies'

describe('descriptive statistics', () => {
  const data = [2, 4, 4, 4, 5, 5, 7, 9]

  it('summarises a known sample', () => {
    const s = summarize(data)
    expect(s.count).toBe(8)
    expect(s.sum).toBe(40)
    expect(s.mean).toBe(5)
    expect(s.median).toBe(4.5) // (4 + 5) / 2
    // Σ(x − 5)² = 9+1+1+1+0+0+4+16 = 32; sample variance 32 / 7
    expect(s.variance).toBeCloseTo(32 / 7, 12)
    expect(s.stdev).toBeCloseTo(Math.sqrt(32 / 7), 12)
    expect(s.min).toBe(2)
    expect(s.max).toBe(9)
    expect(s.p25).toBe(4) // h = 7·0.25 = 1.75 → 4 + 0.75·(4 − 4)
    expect(s.p75).toBe(5.5) // h = 5.25 → 5 + 0.25·(7 − 5)
    expect(s.p90).toBeCloseTo(7.6, 12) // h = 6.3 → 7 + 0.3·(9 − 7)
  })

  it('counts what is missing and leaves it out', () => {
    const s = summarize([1, null, 3, Number.NaN])
    expect(s.count).toBe(2)
    expect(s.missing).toBe(2)
    expect(s.mean).toBe(2)
  })

  it('says nothing it cannot know', () => {
    expect(summarize([]).mean).toBeNull()
    const one = summarize([7])
    expect(one.mean).toBe(7)
    expect(one.stdev).toBeNull() // one value has no sample spread
  })

  it('has the single-number helpers agree', () => {
    expect(mean(data)).toBe(5)
    expect(median([3, 1, 2])).toBe(2)
    expect(stdev([1, 1, 1])).toBe(0)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4], 100)).toBe(4)
  })
})

describe('money in minor units', () => {
  it('adds what floats get wrong', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(fromUnits(sumUnits([toUnits(0.1, 2), toUnits(0.2, 2)]), 2)).toBe(0.3)
    const cents = Array.from({ length: 10000 }, () => toUnits(0.01, 2))
    expect(fromUnits(sumUnits(cents), 2)).toBe(100)
  })

  it('knows how many decimals an amount has', () => {
    expect(decimalsOf(12)).toBe(0)
    expect(decimalsOf(12.5)).toBe(1)
    expect(decimalsOf(0.00012345)).toBe(8)
    expect(decimalsOf(1e-7)).toBe(7)
  })

  it('refuses a sum it could not hold exactly', () => {
    expect(() => sumUnits([Number.MAX_SAFE_INTEGER, 1])).toThrow(/too large/)
  })
})

describe('periods and resampling', () => {
  it('names the period a day falls in', () => {
    // 2026-09-27 is a Sunday
    expect(periodKey('2026-09-27', 'week', true)).toBe('2026-09-21')
    expect(periodKey('2026-09-27', 'week', false)).toBe('2026-09-27')
    expect(periodKey('2026-09-27', 'month')).toBe('2026-09')
    expect(periodKey('2026-09-27', 'quarter')).toBe('2026-Q3')
    expect(periodKey('2026-09-27', 'year')).toBe('2026')
    expect(periodKey('2026-09-27', 'day')).toBe('2026-09-27')
  })

  it('lists every period between two, gaps included', () => {
    expect(periodRange('2025-11', '2026-02', 'month')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
    expect(periodRange('2025-Q4', '2026-Q2', 'quarter')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2'])
    expect(periodRange('2026-09-14', '2026-09-28', 'week', true)).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ])
  })

  const points = [
    { date: '2026-01-05', value: 10 },
    { date: '2026-01-20', value: 5 },
    { date: '2026-03-02', value: 7 },
  ]

  it('sums by month and fills the empty one as asked', () => {
    expect(resample(points, { period: 'month', agg: 'sum', fill: 'zero' })).toEqual([
      { period: '2026-01', value: 15, n: 2 },
      { period: '2026-02', value: 0, n: 0 },
      { period: '2026-03', value: 7, n: 1 },
    ])
    expect(resample(points, { period: 'month', agg: 'sum', fill: 'none' })[1].value).toBeNull()
  })

  it('carries or interpolates a level over a gap', () => {
    // January's mean is 7.5, March's 7
    expect(resample(points, { period: 'month', agg: 'mean', fill: 'previous' })[1].value).toBe(7.5)
    expect(resample(points, { period: 'month', agg: 'mean', fill: 'linear' })[1].value).toBe(7.25)
  })

  it('stretches to a range wider than the data', () => {
    const r = resample(points, { period: 'month', agg: 'sum', fill: 'zero', from: '2025-12-10' })
    expect(r[0]).toEqual({ period: '2025-12', value: 0, n: 0 })
  })

  it('rolls a window and waits until it is full', () => {
    expect(rolling([1, 2, 3, 4, null, 6], 3)).toEqual([null, null, 2, 3, null, null])
    expect(rolling([1, 2, 3, 4], 2, 'sum')).toEqual([null, 3, 5, 7])
  })
})

describe('trend and seasonality', () => {
  it('fits a straight line', () => {
    expect(linearFit([1, 3, 5, 7])).toMatchObject({ slope: 2, intercept: 1, r2: 1, n: 4 })
    // x̄ = 2, ȳ = 4, Sxy = 6, Sxx = 10 → slope 0.6, intercept 2.8, r² = 36/60
    const f = linearFit([2, 4, 5, 4, 5])
    expect(f.slope).toBeCloseTo(0.6, 12)
    expect(f.intercept).toBeCloseTo(2.8, 12)
    expect(f.r2).toBeCloseTo(0.6, 12)
  })

  it('skips gaps but keeps their place on the line', () => {
    const f = linearFit([1, null, 5, 7])
    expect(f.slope).toBeCloseTo(2, 12)
    expect(f.n).toBe(3)
  })

  it('reports change in plain terms', () => {
    const t = trend([
      { period: '2026-01', value: 100 },
      { period: '2026-02', value: 110 },
      { period: '2026-03', value: 125 },
    ])
    expect(t.slopePerPeriod).toBeCloseTo(12.5, 12)
    expect(t.changePct).toBeCloseTo(25, 12)
    expect(t.lastVsPreviousPct).toBeCloseTo((15 / 110) * 100, 12)
    expect(t.direction).toBe('up')
  })

  it('averages by month of the year', () => {
    const s = seasonality(
      [
        { date: '2025-01-10', value: 10 },
        { date: '2026-01-10', value: 20 },
        { date: '2026-02-10', value: 30 },
      ],
      'month'
    )
    // overall mean 20; January 15, February 30
    expect(s.buckets).toEqual([
      { bucket: 'Jan', mean: 15, n: 2, index: 0.75 },
      { bucket: 'Feb', mean: 30, n: 1, index: 1.5 },
    ])
  })
})

describe('the t distribution', () => {
  it('matches the tables', () => {
    expect(tTwoSidedP(2, 10)).toBeCloseTo(0.07339, 4)
    expect(tTwoSidedP(0, 5)).toBeCloseTo(1, 10)
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228139, 4)
    expect(tQuantile(0.975, 3)).toBeCloseTo(3.182446, 4)
    expect(tQuantile(0.9, 3)).toBeCloseTo(1.637744, 4)
  })
})

describe('correlation', () => {
  const x = [1, 2, 3, 4, 5]
  const y = [2, 4, 5, 4, 5]

  it('computes Pearson and Spearman', () => {
    // Sxy = 6, Sxx = 10, Syy = 6 → r = 6/√60
    expect(pearson(x, y).r).toBeCloseTo(6 / Math.sqrt(60), 12)
    // ranks of y with ties averaged: 1, 2.5, 4.5, 2.5, 4.5 → Sxy = 7, Syy = 9 → 7/√90
    expect(spearman(x, y).r).toBeCloseTo(7 / Math.sqrt(90), 12)
  })

  it('pairs only where both sides have a value', () => {
    expect(pearson([1, 2, null, 4], [2, 4, 9, 8]).n).toBe(3)
  })

  it('gives n, p and a hint', () => {
    const c = correlation(x, y, { method: 'pearson' })
    expect(c.n).toBe(5)
    // t = r·√(3/(1 − r²)) ≈ 2.1213, df 3
    expect(c.p).toBeCloseTo(0.124, 3)
    expect(c.hint).toMatch(/too few/i)
  })

  it('says no correlation exists for a constant', () => {
    const c = correlation([1, 2, 3], [5, 5, 5], { method: 'pearson' })
    expect(c.r).toBeNull()
    expect(c.hint).toMatch(/constant/i)
  })

  it('warns when both series only share a trend, and detrends on request', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const b = [3, 2, 5, 4, 7, 6, 9, 8, 11, 10]
    const plain = correlation(a, b, { method: 'pearson' })
    expect(plain.r!).toBeGreaterThan(0.9)
    expect(plain.warning).toMatch(/trend/i)
    const diff = correlation(a, b, { method: 'pearson', detrend: true })
    // differences: a is all 1, so there is nothing to correlate with
    expect(diff.r).toBeNull()
    expect(diff.n).toBe(9)
  })
})

describe('forecasts', () => {
  it('extends a straight line with no error exactly', () => {
    const f = forecast([1, 3, 5, 7], { method: 'linear', horizon: 2 })
    expect(f.points.map((p) => p.value)).toEqual([9, 11])
    expect(f.points[0].lo95).toBeCloseTo(9, 12)
    expect(f.note).toMatch(/rough/i)
  })

  it('widens a linear forecast by the prediction interval', () => {
    // s² = SSE/(n−2) = (6 − 3.6)/3 = 0.8; at x0 = 5: se = s·√(1 + 1/5 + 9/10)
    const f = forecast([2, 4, 5, 4, 5], { method: 'linear', horizon: 1 })
    const se = Math.sqrt(0.8) * Math.sqrt(2.1)
    expect(f.points[0].value).toBeCloseTo(5.8, 12)
    expect(f.points[0].hi95).toBeCloseTo(5.8 + 3.182446 * se, 3)
    expect(f.points[0].lo80).toBeCloseTo(5.8 - 1.637744 * se, 3)
  })

  it('repeats the last season', () => {
    const f = forecast([10, 20, 30, 11, 21, 31], { method: 'seasonal', horizon: 4, season: 3 })
    expect(f.points.map((p) => p.value)).toEqual([11, 21, 31, 11])
    // every seasonal difference is 1, so s = 1; the fourth step is a season further out
    expect(f.points[0].hi95).toBeCloseTo(11 + 1.959964, 4)
    expect(f.points[3].hi95).toBeCloseTo(11 + 1.959964 * Math.SQRT2, 4)
  })

  it('carries a moving average forward', () => {
    const f = forecast([1, 2, 3, 4, 5, 6], { method: 'moving-average', horizon: 2, window: 3 })
    expect(f.points.map((p) => p.value)).toEqual([5, 5])
    expect(f.residualStdev).toBe(2) // each one-step error is 2
  })

  it('refuses to guess from too little', () => {
    expect(() => forecast([1, 2, 3], { method: 'linear', horizon: 1 })).toThrow(/at least 4/)
    expect(() => forecast([1, 2, 3, 4, 5], { method: 'seasonal', horizon: 1, season: 3 })).toThrow(
      /two seasons/
    )
  })
})

describe('anomalies', () => {
  it('finds values past the IQR fences', () => {
    // q1 = 3.25, q3 = 7.75, IQR 4.5 → fences −3.5 and 14.5
    const a = anomalies([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], { method: 'iqr' })
    expect(a.bounds).toEqual({ low: -3.5, high: 14.5 })
    expect(a.items).toEqual([{ index: 9, value: 100, score: expect.any(Number) }])
  })

  it('finds values far from the mean by z-score', () => {
    // mean 14, sample sd √160 ≈ 12.65 → z(50) ≈ 2.85
    const a = anomalies([10, 10, 10, 10, 10, 10, 10, 10, 10, 50], {
      method: 'zscore',
      threshold: 2.5,
    })
    expect(a.items.map((i) => i.index)).toEqual([9])
    expect(a.items[0].score).toBeCloseTo(36 / Math.sqrt(160), 10)
    expect(anomalies([10, 10, 10, 10, 10, 10, 10, 10, 10, 50], { method: 'zscore' }).items).toEqual(
      []
    )
  })
})
