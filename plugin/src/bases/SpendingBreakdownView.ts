import { BasesView, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { AccountsList } from '@/entities/AccountsList'
import { renderBarChart, BarChartItem } from './svgChart'
import { toRaw } from 'vue'
import dayjs from 'dayjs'

export const SPENDING_BREAKDOWN_VIEW_ID = 'abele-spending-breakdown'

export class SpendingBreakdownView extends BasesView {
  type = SPENDING_BREAKDOWN_VIEW_ID
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
    const al = toRaw(store.accountsList.value) as AccountsList | null
    if (!bi || !al) {
      this.containerEl.empty()
      this.containerEl.createEl('div', {
        text: 'Finance data not ready',
        cls: 'abele-bases-chart__empty',
      })
      return
    }

    // Period: current month by default, or configured days back
    const daysBack = (this.config.get('daysBack') as number) || 0
    const endDate = dayjs()
    const startDate = daysBack > 0 ? endDate.subtract(daysBack, 'day') : endDate.startOf('month')

    // Sum expenses per expense account (each expense account acts as a category of spending)
    const items: BarChartItem[] = []

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
          label: account.accountName || account.title || path.split('/').pop() || path,
          value: total,
        })
      }
    }

    items.sort((a, b) => b.value - a.value)

    // Header with total
    this.containerEl.empty()
    const total = items.reduce((sum, i) => sum + i.value, 0)
    const header = this.containerEl.createDiv({ cls: 'abele-bases-chart__header' })
    header.createSpan({
      text: `Total: ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    })
    header.createSpan({
      text: ` (${startDate.format('MMM D')} – ${endDate.format('MMM D')})`,
      cls: 'abele-bases-chart__header-sub',
    })

    const chartContainer = this.containerEl.createDiv()
    renderBarChart(chartContainer, items)
  }
}
