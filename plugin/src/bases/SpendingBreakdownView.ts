import { BasesView, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { AccountsList } from '@/entities/AccountsList'
import { echartsInit, EChartsType } from './echarts'
import { toRaw } from 'vue'
import dayjs from 'dayjs'

export const SPENDING_BREAKDOWN_VIEW_ID = 'abele-spending-breakdown'

export class SpendingBreakdownView extends BasesView {
  type = SPENDING_BREAKDOWN_VIEW_ID
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
    const al = toRaw(store.accountsList.value) as AccountsList | null
    if (!bi || !al) {
      this.containerEl.empty()
      this.containerEl.createEl('div', {
        text: 'Finance data not ready',
        cls: 'abele-bases-chart__empty',
      })
      return
    }

    const daysBack = (this.config.get('daysBack') as number) || 0
    const endDate = dayjs()
    const startDate = daysBack > 0 ? endDate.subtract(daysBack, 'day') : endDate.startOf('month')

    const items: Array<{ name: string; value: number }> = []

    for (const [path, account] of al.accounts) {
      if (account.accountType !== 'expense') continue
      const total = bi.getTotalForPeriod({
        startDate,
        endDate,
        accountPath: path,
        direction: 'to',
      })
      if (total > 0) {
        items.push({
          name: account.accountName || account.title || path.split('/').pop() || path,
          value: Math.round(total * 100) / 100,
        })
      }
    }

    items.sort((a, b) => b.value - a.value)

    if (!items.length) {
      this.containerEl.empty()
      this.containerEl.createEl('div', {
        text: 'No spending data',
        cls: 'abele-bases-chart__empty',
      })
      return
    }

    this.containerEl.empty()
    const chartDiv = this.containerEl.createDiv({ cls: 'abele-bases-echart' })
    chartDiv.style.width = '100%'
    chartDiv.style.height = `${Math.max(300, items.length * 32 + 80)}px`

    this.chart?.dispose()
    this.chart = echartsInit(chartDiv)

    const total = items.reduce((s, i) => s + i.value, 0)
    const periodLabel = `${startDate.format('MMM D')} – ${endDate.format('MMM D')}`

    this.chart.setOption({
      title: {
        text: `${periodLabel}`,
        subtext: `Total: ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        left: 'center',
        textStyle: { fontSize: 13 },
        subtextStyle: { fontSize: 12 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          const pct = ((p.value / total) * 100).toFixed(1)
          return `${p.name}<br/>${p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${pct}%)`
        },
      },
      grid: {
        left: 12,
        right: 60,
        top: 50,
        bottom: 12,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
      },
      yAxis: {
        type: 'category',
        data: items.map((i) => i.name).reverse(),
        axisLabel: {
          width: 100,
          overflow: 'truncate',
        },
      },
      series: [
        {
          type: 'bar',
          data: items.map((i) => i.value).reverse(),
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
          },
          label: {
            show: true,
            position: 'right',
            formatter: (p: any) =>
              p.value.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              }),
            fontSize: 11,
          },
        },
      ],
    })

    const observer = new ResizeObserver(() => this.chart?.resize())
    observer.observe(chartDiv)
    this.register(() => observer.disconnect())
  }
}
