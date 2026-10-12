import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { QueryController } from 'obsidian'
import { ChartView } from '@/bases/ChartView'

const chart = vi.hoisted(() => ({ setOption: vi.fn(), dispose: vi.fn() }))
vi.mock('@/bases/echarts', () => ({
  echartsInit: () => chart,
  themePalette: () => ['sample-accent', 'sample-green'],
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ themeVersion: ref(0) }) },
}))
vi.mock('obsidian', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  NullValue: class {},
}))

let view: ChartView
afterEach(() => view?.onunload())

function fixture(properties: string[], entries: Record<string, string | number>[], options = {}) {
  const host = document.createElement('div')
  view = new ChartView({} as QueryController, host)
  Object.assign(view, {
    config: {
      get: (key: string) => (options as Record<string, unknown>)[key],
      getOrder: () => properties,
      getAsPropertyId: (key: string) => (key === 'groupProperty' ? 'group' : null),
      getDisplayName: (key: string) => key,
    },
    data: {
      data: entries.map((values, i) => ({
        file: { basename: `sample-${i}` },
        getValue: (key: string) => values[key],
      })),
    },
  })
  return host
}

describe('Bases chart states', () => {
  it.each([
    [[], [], 'Nothing to draw', 'Properties'],
    [['amount'], [], 'No notes', 'filters'],
    [['amount'], [{ amount: 'sample-text' }], 'No numbers', 'hold no numbers'],
  ])('explains missing chart input', (properties, entries, title, hint) => {
    const host = fixture(properties as string[], entries as Record<string, string | number>[])
    view.onDataUpdated()
    expect(host.textContent).toContain(title)
    expect(host.textContent).toContain(hint)
    expect(host.querySelector('.abele-bases-echart')).toBeNull()
  })

  it.each(['line', 'scatter'])(
    'names single-property %s series by group and keeps labels level',
    (chartType) => {
      fixture(
        ['amount'],
        [
          { amount: 2, group: 'Sample group' },
          { amount: 3, group: 'Other group' },
        ],
        { chartType }
      )
      view.onDataUpdated()
      const option = chart.setOption.mock.calls.at(-1)?.[0]
      expect(option.series.map((series: { name: string }) => series.name)).toEqual([
        'Other group',
        'Sample group',
      ])
      expect(option.xAxis.axisLabel).toEqual({ interval: 'auto', hideOverlap: true })
    }
  )

  it('uses each series palette colour for its scale', () => {
    fixture(['amount', 'count'], [{ amount: 2, count: 3 }], {
      dualAxis: true,
    })
    view.onDataUpdated()
    const option = chart.setOption.mock.calls.at(-1)?.[0]
    expect(option.series.map((series: { name: string }) => series.name)).toEqual([
      'amount',
      'count',
    ])
    expect(
      option.yAxis.map((axis: { axisLabel: { color: string } }) => axis.axisLabel.color)
    ).toEqual(['sample-accent', 'sample-green'])
  })

  it.each(['line', 'scatter'])(
    'draws %s numbers when a group filter leaves one group',
    (chartType) => {
      const host = fixture(['amount'], [{ amount: 2, group: 'Sample group' }], { chartType })
      view.onDataUpdated()
      expect(host.querySelector('.abele-bases-echart')).not.toBeNull()
      const option = chart.setOption.mock.calls.at(-1)?.[0]
      expect(option.series[0].name).toBe('amount')
      expect(option.series[0].data).toEqual(chartType === 'scatter' ? [[0, 2]] : [2])
    }
  )
})
