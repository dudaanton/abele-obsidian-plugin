import { BasesView, QueryController } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { renderStatCard } from './svgChart'
import { toRaw } from 'vue'
import dayjs from 'dayjs'

export const NET_WORTH_VIEW_ID = 'abele-net-worth'

export class NetWorthView extends BasesView {
  type = NET_WORTH_VIEW_ID
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

    const today = dayjs()
    const netWorth = bi.getNetWorthAtDate(today)

    // Build trend: last 90 days, sampled weekly
    const daysBack = (this.config.get('daysBack') as number) || 90
    const trend: Array<{ x: string; y: number }> = []
    for (let i = daysBack; i >= 0; i -= 7) {
      const date = today.subtract(i, 'day')
      trend.push({
        x: date.format('YYYY-MM-DD'),
        y: bi.getNetWorthAtDate(date),
      })
    }
    // Always include today
    if (trend.length === 0 || trend[trend.length - 1].x !== today.format('YYYY-MM-DD')) {
      trend.push({ x: today.format('YYYY-MM-DD'), y: netWorth })
    }

    renderStatCard(this.containerEl, 'Net Worth', netWorth, undefined, trend)
  }
}
