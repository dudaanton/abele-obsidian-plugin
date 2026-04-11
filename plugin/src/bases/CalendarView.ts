import { BasesView, QueryController, setIcon } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { TransactionsList } from '@/entities/TransactionsList'
import { AccountsList } from '@/entities/AccountsList'
import { DATE_FORMAT } from '@/constants/dates'
import { wikilinkToPath } from '@/helpers/pathsHelpers'
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

  private computeDayTotals(): Map<string, DayData> {
    const store = GlobalStore.getInstance()
    const tl = toRaw(store.transactionsList.value) as TransactionsList | null
    const al = toRaw(store.accountsList.value) as AccountsList | null
    if (!tl || !al) return new Map()

    // Build set of expense and revenue account paths
    const expensePaths = new Set<string>()
    const revenuePaths = new Set<string>()
    for (const [path, account] of al.accounts) {
      if (account.accountType === 'expense') expensePaths.add(path)
      if (account.accountType === 'revenue') revenuePaths.add(path)
    }

    // Resolve wikilink → path cache
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

    // Single pass through all transactions
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

      if (toPath && expensePaths.has(toPath)) {
        day.expense += raw.amount
      }
      if (fromPath && revenuePaths.has(fromPath)) {
        day.income += raw.amount
      }
    }

    return dayMap
  }

  private render(): void {
    this.containerEl.empty()

    const dayTotals = this.computeDayTotals()
    const wrapper = this.containerEl.createDiv({ cls: 'abele-bases-cal' })

    // Header with month/year and navigation
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

    // Weekday headers
    const weekStartMonday = GlobalStore.getInstance().weekStartsOnMonday.value
    const weekdays = wrapper.createDiv({ cls: 'abele-bases-cal__weekdays' })
    for (let i = weekStartMonday ? 1 : 0; i < (weekStartMonday ? 8 : 7); i++) {
      const wd = weekdays.createDiv({ cls: 'abele-bases-cal__weekday' })
      wd.textContent = dayjs().day(i).format('dd')
    }

    // Days grid
    const grid = wrapper.createDiv({ cls: 'abele-bases-cal__days' })
    const firstDay = dayjs().year(this.currentYear).month(this.currentMonth).date(1)
    const weekStart = weekStartMonday ? 1 : 0
    const paddingDays = (firstDay.day() - weekStart + 7) % 7
    const daysInMonth = firstDay.daysInMonth()
    const today = dayjs()

    // Padding days from previous month
    for (let i = paddingDays; i > 0; i--) {
      const d = firstDay.subtract(i, 'day')
      this.renderDay(grid, d, dayTotals, today, true)
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const d = firstDay.date(i)
      this.renderDay(grid, d, dayTotals, today, false)
    }

    // Trailing days
    const lastDay = firstDay.date(daysInMonth)
    const trailingDays = (weekStart + 6 - lastDay.day()) % 7
    for (let i = 1; i <= trailingDays; i++) {
      const d = lastDay.add(i, 'day')
      this.renderDay(grid, d, dayTotals, today, true)
    }

    // Month summary
    const monthStart = firstDay.format(DATE_FORMAT)
    const monthEnd = firstDay.date(daysInMonth).format(DATE_FORMAT)
    let monthExpense = 0
    let monthIncome = 0
    for (const [dateStr, data] of dayTotals) {
      if (dateStr >= monthStart && dateStr <= monthEnd) {
        monthExpense += data.expense
        monthIncome += data.income
      }
    }

    const summary = wrapper.createDiv({ cls: 'abele-bases-cal__summary' })
    const incomeEl = summary.createSpan({ cls: 'abele-bases-cal__summary-income' })
    incomeEl.textContent = `+${fmt(monthIncome)}`
    const expenseEl = summary.createSpan({ cls: 'abele-bases-cal__summary-expense' })
    expenseEl.textContent = `-${fmt(monthExpense)}`
    const savingsVal = monthIncome - monthExpense
    const savingsEl = summary.createSpan({
      cls: `abele-bases-cal__summary-savings ${savingsVal >= 0 ? 'abele-bases-cal__summary-income' : 'abele-bases-cal__summary-expense'}`,
    })
    savingsEl.textContent = `= ${fmt(savingsVal)}`
  }

  private renderDay(
    grid: HTMLElement,
    date: dayjs.Dayjs,
    dayTotals: Map<string, DayData>,
    today: dayjs.Dayjs,
    otherMonth: boolean
  ): void {
    const dateStr = date.format(DATE_FORMAT)
    const data = dayTotals.get(dateStr)
    const isToday = date.isSame(today, 'day')

    const cell = grid.createDiv({ cls: 'abele-bases-cal__day' })
    if (otherMonth) cell.addClass('abele-bases-cal__day--other')
    if (isToday) cell.addClass('abele-bases-cal__day--today')

    const num = cell.createDiv({ cls: 'abele-bases-cal__day-num' })
    num.textContent = String(date.date())

    if (data) {
      if (data.income > 0) {
        const inc = cell.createDiv({ cls: 'abele-bases-cal__day-income' })
        inc.textContent = `+${fmtShort(data.income)}`
      }
      if (data.expense > 0) {
        const exp = cell.createDiv({ cls: 'abele-bases-cal__day-expense' })
        exp.textContent = `-${fmtShort(data.expense)}`
      }
    }
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
