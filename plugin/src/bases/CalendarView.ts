import { BasesView, QueryController, setIcon } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { TransactionsList } from '@/entities/TransactionsList'
import { AccountsList } from '@/entities/AccountsList'
import { DATE_FORMAT } from '@/constants/dates'
import { wikilinkToPath } from '@/helpers/pathsHelpers'
import { echartsInit, getThemeColors, EChartsType } from './echarts'
import { toRaw } from 'vue'
import dayjs from 'dayjs'

export const CALENDAR_VIEW_ID = 'abele-calendar'

interface DayData {
  expense: number
  income: number
}

export class CalendarView extends BasesView {
  type = CALENDAR_VIEW_ID
  private containerEl: HTMLElement
  private chart: EChartsType | null = null
  private currentMonth: number
  private currentYear: number

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    this.containerEl = containerEl
    this.currentMonth = dayjs().month()
    this.currentYear = dayjs().year()
  }

  onDataUpdated(): void {
    this.render()
  }

  onunload(): void {
    this.chart?.dispose()
    this.chart = null
  }

  private computeDayTotals(): Map<string, DayData> {
    const store = GlobalStore.getInstance()
    const tl = toRaw(store.transactionsList.value) as TransactionsList | null
    const al = toRaw(store.accountsList.value) as AccountsList | null
    if (!tl || !al) return new Map()

    const expensePaths = new Set<string>()
    const revenuePaths = new Set<string>()
    for (const [path, account] of al.accounts) {
      if (account.accountType === 'expense') expensePaths.add(path)
      if (account.accountType === 'revenue') revenuePaths.add(path)
    }

    const { app } = store
    const resolveCache = new Map<string, string | null>()
    const resolve = (wikilink: string): string | null => {
      if (resolveCache.has(wikilink)) return resolveCache.get(wikilink)!
      const linkPath = wikilinkToPath(wikilink)
      const file = linkPath ? app.metadataCache.getFirstLinkpathDest(linkPath, '') : null
      const result = file ? file.path : null
      resolveCache.set(wikilink, result)
      return result
    }

    const dayMap = new Map<string, DayData>()

    for (const tx of tl.transactions.values()) {
      const raw = toRaw(tx)
      if (!raw.loaded || !raw.date || raw.amount == null) continue

      const dateStr = raw.date.format(DATE_FORMAT)
      if (!dayMap.has(dateStr)) {
        dayMap.set(dateStr, { expense: 0, income: 0 })
      }
      const day = dayMap.get(dateStr)!

      const toPath = raw.to ? resolve(raw.to) : null
      const fromPath = raw.from ? resolve(raw.from) : null

      if (toPath && expensePaths.has(toPath)) day.expense += raw.amount
      if (fromPath && revenuePaths.has(fromPath)) day.income += raw.amount
    }

    return dayMap
  }

  private render(): void {
    this.containerEl.empty()
    this.chart?.dispose()
    this.chart = null

    const dayTotals = this.computeDayTotals()
    const wrapper = this.containerEl.createDiv({ cls: 'abele-bases-cal' })

    // Header
    const header = wrapper.createDiv({ cls: 'abele-bases-cal__header' })
    const title = header.createDiv({ cls: 'abele-bases-cal__title' })
    title.textContent = dayjs().year(this.currentYear).month(this.currentMonth).format('MMMM YYYY')

    const controls = header.createDiv({ cls: 'abele-bases-cal__controls' })

    const prevBtn = controls.createDiv({ cls: 'abele-bases-cal__nav clickable-icon' })
    setIcon(prevBtn, 'chevron-left')
    prevBtn.addEventListener('click', () => {
      if (this.currentMonth === 0) {
        this.currentMonth = 11
        this.currentYear -= 1
      } else {
        this.currentMonth -= 1
      }
      this.render()
    })

    const todayBtn = controls.createDiv({ cls: 'abele-bases-cal__today' })
    todayBtn.textContent = 'Today'
    todayBtn.addEventListener('click', () => {
      this.currentMonth = dayjs().month()
      this.currentYear = dayjs().year()
      this.render()
    })

    const nextBtn = controls.createDiv({ cls: 'abele-bases-cal__nav clickable-icon' })
    setIcon(nextBtn, 'chevron-right')
    nextBtn.addEventListener('click', () => {
      if (this.currentMonth === 11) {
        this.currentMonth = 0
        this.currentYear += 1
      } else {
        this.currentMonth += 1
      }
      this.render()
    })

    // ECharts calendar heatmap
    const firstDay = dayjs().year(this.currentYear).month(this.currentMonth).date(1)
    const lastDay = firstDay.endOf('month')
    const rangeStart = firstDay.format(DATE_FORMAT)
    const rangeEnd = lastDay.format(DATE_FORMAT)

    // Build heatmap data: [date, expense] for expense layer
    const expenseData: Array<[string, number]> = []
    const incomeData: Array<[string, number]> = []

    let d = firstDay
    while (d.isBefore(lastDay) || d.isSame(lastDay, 'day')) {
      const dateStr = d.format(DATE_FORMAT)
      const data = dayTotals.get(dateStr)
      expenseData.push([dateStr, data?.expense || 0])
      incomeData.push([dateStr, data?.income || 0])
      d = d.add(1, 'day')
    }

    const maxExpense = Math.max(...expenseData.map((d) => d[1]), 1)

    const chartDiv = wrapper.createDiv({ cls: 'abele-bases-echart' })
    chartDiv.style.width = '100%'
    chartDiv.style.height = '220px'

    const colors = getThemeColors()
    const bgPrimary = getComputedStyle(document.body)
      .getPropertyValue('--background-primary')
      .trim()

    // Build a gradient: transparent → expense color with increasing opacity
    const isDark = document.body.classList.contains('theme-dark')
    const emptyColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'

    this.chart = echartsInit(chartDiv)

    this.chart.setOption({
      tooltip: {
        formatter: (params: any) => {
          const dateStr = params.data[0]
          const data = dayTotals.get(dateStr)
          if (!data || (data.expense === 0 && data.income === 0)) {
            return `${dateStr}<br/>No transactions`
          }
          let html = `<b>${dateStr}</b>`
          if (data.income > 0)
            html += `<br/><span style="color:${colors.income}">+${fmt(data.income)}</span>`
          if (data.expense > 0)
            html += `<br/><span style="color:${colors.expense}">-${fmt(data.expense)}</span>`
          return html
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max: maxExpense,
        inRange: {
          color: [emptyColor, colors.expense + '40', colors.expense + '80', colors.expense],
        },
      },
      calendar: {
        top: 8,
        left: 30,
        right: 8,
        bottom: 8,
        range: [rangeStart, rangeEnd],
        cellSize: ['auto', 28],
        dayLabel: {
          firstDay: GlobalStore.getInstance().weekStartsOnMonday.value ? 1 : 0,
          nameMap: 'en',
          color: colors.textFaint,
        },
        monthLabel: { show: false },
        yearLabel: { show: false },
        splitLine: { lineStyle: { color: 'transparent' } },
        itemStyle: {
          borderWidth: 2,
          borderColor: bgPrimary,
          borderRadius: 4,
        },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: expenseData,
          label: {
            show: true,
            color: colors.text,
            formatter: (params: any) => {
              const data = dayTotals.get(params.data[0])
              if (!data) return ''
              const parts: string[] = []
              if (data.income > 0) parts.push(`+${fmtShort(data.income)}`)
              if (data.expense > 0) parts.push(`-${fmtShort(data.expense)}`)
              return parts.join('\n')
            },
            fontSize: 9,
            lineHeight: 11,
          },
        },
      ],
    })

    // Month summary
    let monthExpense = 0
    let monthIncome = 0
    for (const [dateStr, data] of dayTotals) {
      if (dateStr >= rangeStart && dateStr <= rangeEnd) {
        monthExpense += data.expense
        monthIncome += data.income
      }
    }

    const summary = wrapper.createDiv({ cls: 'abele-bases-cal__summary' })
    summary.createSpan({ cls: 'abele-bases-cal__summary-income', text: `+${fmt(monthIncome)}` })
    summary.createSpan({ cls: 'abele-bases-cal__summary-expense', text: `-${fmt(monthExpense)}` })
    const savings = monthIncome - monthExpense
    summary.createSpan({
      cls: savings >= 0 ? 'abele-bases-cal__summary-income' : 'abele-bases-cal__summary-expense',
      text: `= ${fmt(savings)}`,
    })

    const observer = new ResizeObserver(() => this.chart?.resize())
    observer.observe(chartDiv)
    this.register(() => observer.disconnect())
  }
}

function fmt(n: number): string {
  return Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtShort(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toFixed(0)
}
