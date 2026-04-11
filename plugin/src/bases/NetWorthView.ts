import { BasesView, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { echartsInit, EChartsType } from './echarts'
import { toRaw } from 'vue'
import dayjs from 'dayjs'

export const NET_WORTH_VIEW_ID = 'abele-net-worth'

export class NetWorthView extends BasesView {
  type = NET_WORTH_VIEW_ID
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

    const today = dayjs()
    const netWorth = bi.getNetWorthAtDate(today)
    const daysBack = (this.config.get('daysBack') as number) || 90

    // Build daily series
    const dates: string[] = []
    const values: number[] = []
    for (let i = daysBack; i >= 0; i--) {
      const date = today.subtract(i, 'day')
      dates.push(date.format('MMM D'))
      values.push(bi.getNetWorthAtDate(date))
    }

    this.containerEl.empty()

    // Stat number
    const statEl = this.containerEl.createDiv({ cls: 'abele-bases-stat' })
    const labelEl = statEl.createDiv({ cls: 'abele-bases-stat__label' })
    labelEl.textContent = 'Net Worth'
    const valueEl = statEl.createDiv({ cls: 'abele-bases-stat__value' })
    valueEl.textContent = netWorth.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    // Area chart below
    const chartDiv = this.containerEl.createDiv({ cls: 'abele-bases-echart' })
    chartDiv.style.width = '100%'
    chartDiv.style.height = '200px'

    this.chart?.dispose()
    this.chart = echartsInit(chartDiv)

    this.chart.setOption({
      tooltip: {
        trigger: 'axis',
      },
      grid: {
        left: 12,
        right: 12,
        top: 8,
        bottom: 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLabel: {
          interval: Math.max(Math.floor(dates.length / 6) - 1, 0),
        },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { opacity: 0.3 } },
      },
      series: [
        {
          type: 'line',
          data: values,
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.15 },
        },
      ],
    })

    const observer = new ResizeObserver(() => this.chart?.resize())
    observer.observe(chartDiv)
    this.register(() => observer.disconnect())
  }
}
