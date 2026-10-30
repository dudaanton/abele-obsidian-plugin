import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildEchartsOption, type ChartConfig } from '@/editor/chartOption'
import { catalogs } from '@/i18n/catalogs'
import ledger from '@/i18n/streamC-extra-ledger.json'
import { initializeLocale } from '../helpers/i18n'

afterEach(() => initializeLocale('en'))

const formulaConfig = (x: unknown): ChartConfig =>
  ({ x, series: [{ formula: 'x' }] }) as ChartConfig

describe('formula chart sampling', () => {
  it('rejects a zero step instead of blocking the renderer', () => {
    expect(() => buildEchartsOption(formulaConfig([0, 1, 0]))).toThrow()
  })

  it.each([
    [0, 0],
    [0, 1, -1],
    [1, 0, 1],
    [0, Infinity, 1],
    [-Infinity, 1, 1],
    [0, 1, NaN],
    [0, 1, Infinity],
    [0, 1, -Infinity],
    [0, Number.MAX_VALUE, -Number.MAX_VALUE],
    [-Number.MAX_VALUE, Number.MAX_VALUE],
    ['0', 1, 0.1],
    [0, '1', 0.1],
    [0, 1, '0'],
    [0],
    [],
    'bad range',
  ])('rejects invalid range %j', (...x) => {
    expect(() => buildEchartsOption(formulaConfig(x))).toThrow()
  })

  it.each([
    [0, 1, 1e-20],
    [1e20, 2e20, 1],
  ])('bounds work even when the step is tiny or cannot advance x: %j', (...x) => {
    expect(() => buildEchartsOption(formulaConfig(x))).toThrow(/10.?000/)
  })

  it('counts attempted samples even when the formula produces no finite points', () => {
    expect(() =>
      buildEchartsOption({ x: [0, 1, 1e-20], series: [{ formula: 'sqrt(-1)' }] })
    ).toThrow(/10.?000/)
  })

  it('allows exactly 10 000 points and rejects one more', () => {
    expect(buildEchartsOption(formulaConfig([0, 9999, 1])).series[0].data).toHaveLength(10000)
    expect(() => buildEchartsOption(formulaConfig([0, 10000, 1]))).toThrow(/10.?000/)
  })

  it('shares the work limit across formula series', () => {
    expect(() =>
      buildEchartsOption({
        x: [0, 5000, 1],
        series: [{ formula: 'x' }, { formula: 'x + 1' }],
      })
    ).toThrow(/10.?000/)
  })

  it('preserves ascending points, rounding, defaults and formula results', () => {
    const config: ChartConfig = { x: [0, 1], series: [{ formula: 'x * x' }] }
    const expected: number[][] = []
    for (let x = 0; x <= 1; x += 1 / 200) expected.push([Math.round(x * 1e10) / 1e10, x * x])
    expect(buildEchartsOption(config).series[0]).toEqual({
      name: 'x * x',
      type: 'line',
      data: expected,
      smooth: true,
      showSymbol: false,
      emphasis: { disabled: true },
    })
  })

  it('samples descending ranges with a step towards the endpoint', () => {
    expect(buildEchartsOption(formulaConfig([2, 0, -1])).series[0].data).toEqual([
      [2, 2],
      [1, 1],
      [0, 0],
    ])
  })

  it('allows a finite step larger than the range', () => {
    expect(buildEchartsOption(formulaConfig([0, 1, Number.MAX_VALUE])).series[0].data).toEqual([
      [0, 0],
    ])
  })

  it('has reviewed range and limit errors in all five languages', () => {
    for (const key of ['chart.invalidRange', 'chart.sampleLimit'] as const) {
      expect(createHash('sha256').update(JSON.stringify(catalogs.en[key])).digest('hex')).toBe(
        ledger[key].englishHash
      )
      for (const language of ['en', 'ru', 'lv', 'es', 'de'] as const) {
        initializeLocale(language)
        const x = key === 'chart.invalidRange' ? [0, 1, 0] : [0, 10000, 1]
        expect(() => buildEchartsOption(formulaConfig(x))).toThrow(
          catalogs[language][key].replace('{limit}', '10000')
        )
      }
    }
  })
})
