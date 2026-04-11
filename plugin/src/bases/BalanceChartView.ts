import { BasesView, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { renderLineChart, LineChartSeries } from './svgChart'
import { toRaw } from 'vue'
import dayjs from 'dayjs'

export const BALANCE_CHART_VIEW_ID = 'abele-balance-chart'

export class BalanceChartView extends BasesView {
  type = BALANCE_CHART_VIEW_ID
  private containerEl: HTMLElement

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    this.containerEl = containerEl
  }

  onDataUpdated(): void {
    this.render()
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

    // Get period from config or default to last 90 days
    const daysBack = (this.config.get('daysBack') as number) || 90
    const endDate = dayjs()
    const startDate = endDate.subtract(daysBack, 'day')

    // Build series from queried account entries
    const seriesList: LineChartSeries[] = []

    for (const entry of this.data.data) {
      const file = entry.file
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
      if (fm?.type !== 'account') continue
      if (fm.accountType !== 'asset' && fm.accountType !== 'liability') continue

      const series = bi.getBalanceSeries(file.path, startDate, endDate)
      if (!series.length) continue

      seriesList.push({
        label: file.basename,
        data: series.map((s) => ({ x: s.date, y: s.balance })),
      })
    }

    renderLineChart(this.containerEl, seriesList, { height: 280 })
  }
}
