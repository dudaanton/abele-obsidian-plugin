import { BasesView, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { echartsInit, EChartsType } from './echarts'
import { toRaw } from 'vue'
import dayjs from 'dayjs'

export const BALANCE_CHART_VIEW_ID = 'abele-balance-chart'

export class BalanceChartView extends BasesView {
  type = BALANCE_CHART_VIEW_ID
  private containerEl: HTMLElement
  private chart: EChartsType | null = null

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    this.containerEl = containerEl
  }

  onDataUpdated(): void {
    this.render()
  }

  onunload(): void {
    this.chart?.dispose()
    this.chart = null
  }

  private render(): void {
    const store = GlobalStore.getInstance()
    const bi = toRaw(store.balanceIndex.value) as BalanceIndex | null
    if (!bi) {
      this.containerEl.empty()
      this.containerEl.createEl('div', {
        text: 'Balance index not ready',
        cls: 'abele-bases-chart__empty',
      })
      return
    }

    const daysBack = (this.config.get('daysBack') as number) || 90
    const endDate = dayjs()
    const startDate = endDate.subtract(daysBack, 'day')

    // Build series from queried account entries
    const seriesData: Array<{ name: string; data: number[] }> = []
    const dates: string[] = []

    // Generate date labels
    let d = startDate
    while (d.isBefore(endDate) || d.isSame(endDate, 'day')) {
      dates.push(d.format('MMM D'))
      d = d.add(1, 'day')
    }

    for (const entry of this.data.data) {
      const file = entry.file
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
      if (fm?.type !== 'account') continue
      if (fm.accountType !== 'asset' && fm.accountType !== 'liability') continue

      const series = bi.getBalanceSeries(file.path, startDate, endDate)
      if (!series.length) continue

      seriesData.push({
        name: file.basename,
        data: series.map((s) => s.balance),
      })
    }

    if (!seriesData.length) {
      this.containerEl.empty()
      this.containerEl.createEl('div', { text: 'No account data', cls: 'abele-bases-chart__empty' })
      return
    }

    // Ensure chart container
    this.containerEl.empty()
    const chartDiv = this.containerEl.createDiv({ cls: 'abele-bases-echart' })
    chartDiv.style.width = '100%'
    chartDiv.style.height = '320px'

    this.chart?.dispose()
    this.chart = echartsInit(chartDiv)

    this.chart.setOption({
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        data: seriesData.map((s) => s.name),
        bottom: 0,
        type: 'scroll',
      },
      grid: {
        left: 12,
        right: 12,
        top: 12,
        bottom: 40,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: {
          interval: Math.max(Math.floor(dates.length / 6) - 1, 0),
        },
      },
      yAxis: {
        type: 'value',
      },
      series: seriesData.map((s) => ({
        name: s.name,
        type: 'line',
        data: s.data,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
      })),
    })

    // Handle resize
    const observer = new ResizeObserver(() => this.chart?.resize())
    observer.observe(chartDiv)
    this.register(() => observer.disconnect())
  }
}
