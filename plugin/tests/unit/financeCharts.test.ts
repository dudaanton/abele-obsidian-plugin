import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import dayjs from 'dayjs'
import { useFinanceCharts } from '@/composables/useFinanceCharts'
import type { EChartsType } from '@/bases/echarts'

vi.mock('@/bases/echarts', () => ({
  getThemeColors: () => ({ text: '#000', textFaint: '#888', income: '#0f0', expense: '#f00' }),
}))

describe('finance chart callbacks', () => {
  it('clears empty pies and reads the current slice when a chart click arrives', () => {
    const pieData = ref<Array<{ name: string; value: number; path?: string }>>([])
    const openFile = vi.fn()
    const callbacks = useFinanceCharts({
      pieData,
      calendarData: ref(new Map()),
      periodStart: ref(dayjs('2030-01-01')),
      periodEnd: ref(dayjs('2030-01-31')),
      weekStartsOnMonday: ref(true),
      networthLegendSelected: ref({}),
      networthData: ref({ dates: [], series: [] }),
      openFile,
    })
    const chart = { clear: vi.fn(), setOption: vi.fn(), on: vi.fn() }
    callbacks.renderPieChart(chart as unknown as EChartsType)
    expect(chart.clear).toHaveBeenCalledOnce()
    expect(chart.setOption).not.toHaveBeenCalled()
    callbacks.createPieChart(chart as unknown as EChartsType)
    const listener = chart.on.mock.calls[0][1]
    pieData.value = [{ name: 'Sample', value: 5, path: 'sample.md' }]
    listener({ dataIndex: 0 })
    expect(openFile).toHaveBeenCalledWith('sample.md')
    listener({ dataIndex: 5 })
    expect(openFile).toHaveBeenCalledOnce()
  })
})
