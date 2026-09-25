<template>
  <div class="abele-finance-sidebar">
    <div class="abele-finance-sidebar__header">
      <div class="abele-finance-sidebar__header-left">
        <div class="abele-finance-sidebar__header-text">Transactions</div>
        <ObsidianIcon icon="banknote-arrow-down" @click="openTransactionForm()" />
        <ObsidianIcon
          icon="landmark"
          tooltip="Show every account and its balance"
          @click="showAccounts"
        />
      </div>
    </div>

    <PeriodSelector
      v-model:start="periodStart"
      v-model:end="periodEnd"
      @custom-applied="onCustomApplied"
    />

    <!-- Currency Balance Cards -->
    <div v-if="currencyCards.length" class="abele-finance-sidebar__cards">
      <div v-for="card in currencyCards" :key="card.currency" class="abele-finance-sidebar__card">
        <div class="abele-finance-sidebar__card-balance">
          {{ formatAmount(card.assets) }}
          <span class="abele-finance-sidebar__card-currency">{{ card.currency }}</span>
        </div>
        <!-- Both directions share one row, told apart by sign and colour; the words for each
             are on hover. The net is only worth a row when it differs from the balance. -->
        <div
          v-if="card.debt > 0 || card.owed > 0"
          class="abele-finance-sidebar__card-details abele-finance-sidebar__dashed"
        >
          <div class="abele-finance-sidebar__card-row">
            <span class="abele-finance-sidebar__summary-label">Debts</span>
            <span class="abele-finance-sidebar__card-debts">
              <span
                v-if="card.owed > 0"
                class="abele-finance-sidebar__card-debt-amount abele-finance-sidebar__summary-value--income"
                aria-label="Owed to me"
                >+{{ formatAmount(card.owed) }}</span
              >
              <span
                v-if="card.debt > 0"
                class="abele-finance-sidebar__card-debt-amount abele-finance-sidebar__summary-value--expense"
                aria-label="I owe"
                >-{{ formatAmount(card.debt) }}</span
              >
            </span>
          </div>
          <div class="abele-finance-sidebar__card-row">
            <span class="abele-finance-sidebar__summary-label">Net</span>
            <span class="abele-finance-sidebar__card-net">{{ formatAmount(card.net) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Period Summary -->
    <section class="abele-finance-sidebar__section">
      <Tabs
        v-if="periodCurrencies.length > 1"
        v-model="selectedPeriodCurrency"
        :tabs="currencyTabs"
        level="secondary"
        class="abele-finance-sidebar__currency-tabs"
      />
      <div class="abele-finance-sidebar__summary">
        <div class="abele-finance-sidebar__summary-row">
          <span class="abele-finance-sidebar__summary-label">Income</span>
          <span
            class="abele-finance-sidebar__summary-value abele-finance-sidebar__summary-value--income"
          >
            {{ formatAmount(periodIncome) }}
          </span>
        </div>
        <div class="abele-finance-sidebar__summary-row">
          <span class="abele-finance-sidebar__summary-label">Expenses</span>
          <span
            class="abele-finance-sidebar__summary-value abele-finance-sidebar__summary-value--expense"
          >
            {{ formatAmount(periodExpenses) }}
          </span>
        </div>
        <div class="abele-finance-sidebar__summary-row abele-finance-sidebar__summary-row--total">
          <span class="abele-finance-sidebar__summary-label">Savings</span>
          <span
            class="abele-finance-sidebar__summary-value"
            :class="{
              'abele-finance-sidebar__summary-value--income': periodSavings >= 0,
              'abele-finance-sidebar__summary-value--expense': periodSavings < 0,
            }"
          >
            {{ formatAmount(periodSavings) }}
          </span>
        </div>
      </div>
      <div
        v-if="periodLent > 0 || periodReturned > 0"
        class="abele-finance-sidebar__summary abele-finance-sidebar__summary--debt abele-finance-sidebar__dashed"
      >
        <div v-if="periodLent > 0" class="abele-finance-sidebar__summary-row">
          <span class="abele-finance-sidebar__summary-label">Lent</span>
          <span
            class="abele-finance-sidebar__summary-value abele-finance-sidebar__summary-value--income"
          >
            {{ formatAmount(periodLent) }}
          </span>
        </div>
        <div v-if="periodReturned > 0" class="abele-finance-sidebar__summary-row">
          <span class="abele-finance-sidebar__summary-label">Returned</span>
          <span
            class="abele-finance-sidebar__summary-value abele-finance-sidebar__summary-value--expense"
          >
            {{ formatAmount(periodReturned) }}
          </span>
        </div>
      </div>
      <Tabs
        v-model="chartTab"
        :tabs="chartTabs"
        level="secondary"
        class="abele-finance-sidebar__chart-tabs"
      />
      <template v-if="chartTab === 'expenses' || chartTab === 'income'">
        <div v-if="pieData.length" ref="pieChartEl" class="abele-finance-sidebar__pie-chart" />
        <div v-else class="abele-finance-sidebar__pie-empty">No data</div>
      </template>
      <template v-else-if="chartTab === 'calendar'">
        <div ref="calendarChartEl" class="abele-finance-sidebar__calendar-chart" />
      </template>
      <template v-else-if="chartTab === 'networth'">
        <div ref="networthChartEl" class="abele-finance-sidebar__networth-chart" />
      </template>
    </section>

    <!-- Recent Transactions -->
    <section class="abele-finance-sidebar__section">
      <h3 class="abele-finance-sidebar__section-title">Recent Transactions</h3>
      <div v-if="visibleTransactions.length" class="abele-finance-sidebar__transactions">
        <template v-for="(entry, idx) in visibleTransactions" :key="entry.id">
          <DateDivider v-if="showTxDateBefore(idx)" :date="entry.date">
            <span v-for="s in dayTotals.get(entry.date) ?? []" :key="s">{{ s }}</span>
          </DateDivider>
          <TransactionItem :transaction="entry.tx" :tx-type="transactionType(entry)" />
        </template>
        <div ref="scrollSentinel" class="abele-finance-sidebar__sentinel" />
      </div>
      <div v-else class="abele-finance-sidebar__empty">No transactions found</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, unref, watch, nextTick, onUnmounted, toRef } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { GlobalStore } from '@/stores/GlobalStore'
import { AccountsList } from '@/entities/AccountsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { openTransactionForm } from '@/commands/transactionForm'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DATE_FORMAT } from '@/constants/dates'
import { echartsInit, getThemeColors, EChartsType } from '@/bases/echarts'
import { openFile } from '@/helpers/vaultUtils'
import ObsidianIcon from './obsidian/Icon.vue'
import Tabs from './obsidian/Tabs.vue'
import PeriodSelector from './obsidian/PeriodSelector.vue'
import DateDivider from './obsidian/DateDivider.vue'
import TransactionItem from './TransactionItem.vue'
import dayjs from 'dayjs'
import { toRaw } from 'vue'
import { formatAmount } from '@/helpers/moneyFormat'
import { currencyCard, type CurrencyCard } from '@/helpers/financeTotals'
import { useFinanceLedger, type LedgerEntry } from '@/composables/useFinanceLedger'
import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'
import { revealSidebarView } from '@/views/revealSidebarView'
import { ACCOUNTS_SIDEBAR_VIEW_TYPE } from '@/views/AccountsSidebarView'

const props = withDefaults(
  defineProps<{
    /**
     * Whether the panel can be seen. A sidebar tab behind another one, or a sidebar folded
     * away, keeps its component alive; while it is hidden nothing here recalculates, and it
     * catches up once when it is shown again.
     */
    active?: boolean
  }>(),
  { active: true }
)

const PAGE_SIZE = 20
const visibleCount = ref(PAGE_SIZE)

const store = GlobalStore.getInstance()
const active = toRef(props, 'active')

const accountsList = computed(() => unref(store.accountsList) as AccountsList | null)
const balanceIndex = computed(() => unref(store.balanceIndex) as BalanceIndex | null)
const { entries: ledger } = useFinanceLedger(active)

const showAccounts = () => void revealSidebarView(store.app, ACCOUNTS_SIDEBAR_VIEW_TYPE)

// --- Currency Balance Cards ---

const pinnedCurrenciesList = computed(() =>
  AbeleConfig.getInstance()
    .pinnedCurrencies.split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
)

const currencyCards = pausedWhileHidden(active, (): CurrencyCard[] => {
  const al = accountsList.value
  const bi = toRaw(balanceIndex.value) as BalanceIndex | null
  if (!al || !bi) return []
  bi.version.value // track reactivity

  const asOfDate = periodEnd.value
  return pinnedCurrenciesList.value.map((currency) =>
    currencyCard(currency, al.accounts, (path) => bi.getBalanceAtDate(path, asOfDate))
  )
})

onUnmounted(() => {
  pieChart?.dispose()
  pieObserver?.disconnect()
  calendarChart?.dispose()
  calendarObserver?.disconnect()
  networthChart?.dispose()
  networthObserver?.disconnect()
})

// Re-render charts on theme change
watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    pieChart?.dispose()
    pieChart = null
    calendarChart?.dispose()
    calendarChart = null
    networthChart?.dispose()
    networthChart = null
    nextTick(() => {
      renderPieChart()
      renderCalendarChart()
      renderNetworthChart()
    })
  }
)

// --- Period Summary ---

const periodStart = ref<dayjs.Dayjs>(dayjs().startOf('month'))
const periodEnd = ref<dayjs.Dayjs>(dayjs().endOf('month'))

const isCustomRange = computed(
  () =>
    !periodStart.value.isSame(periodStart.value.startOf('month'), 'day') ||
    !periodEnd.value.isSame(periodEnd.value.endOf('month'), 'day') ||
    !periodStart.value.isSame(periodEnd.value, 'month')
)

function onCustomApplied() {
  if (chartTab.value === 'calendar') chartTab.value = 'expenses'
}

interface PieItem {
  name: string
  value: number
  path?: string
}

interface CurrencyPeriodData {
  income: number
  expenses: number
  lent: number
  returned: number
  expenseBreakdown: PieItem[]
  incomeBreakdown: PieItem[]
}

const periodByCurrency = computed(() => {
  const al = accountsList.value
  const result = new Map<string, CurrencyPeriodData>()
  if (!al) return result

  const startStr = periodStart.value.format(DATE_FORMAT)
  const endStr = periodEnd.value.format(DATE_FORMAT)

  const expensePaths = new Set<string>()
  const revenuePaths = new Set<string>()
  const liabilityPaths = new Set<string>()
  const accountNames = new Map<string, string>()
  for (const [path, account] of al.accounts) {
    if (account.accountType === 'expense') expensePaths.add(path)
    if (account.accountType === 'revenue') revenuePaths.add(path)
    if (account.accountType === 'liability') liabilityPaths.add(path)
    accountNames.set(path, account.accountName || account.title || path.split('/').pop() || path)
  }

  // key: "currency|accountPath"
  const expenseMap = new Map<string, number>()
  const incomeMap = new Map<string, number>()

  const getOrCreate = (cur: string): CurrencyPeriodData => {
    if (!result.has(cur)) {
      result.set(cur, {
        income: 0,
        expenses: 0,
        lent: 0,
        returned: 0,
        expenseBreakdown: [],
        incomeBreakdown: [],
      })
    }
    return result.get(cur)!
  }

  for (const entry of ledger.value) {
    if (entry.amount == null || !entry.currency) continue
    if (entry.date < startStr || entry.date > endStr) continue

    const cur = entry.currency
    const { from: fromPath, to: toPath, amount } = entry

    if (toPath && expensePaths.has(toPath)) {
      const key = `${cur}|${toPath}`
      expenseMap.set(key, (expenseMap.get(key) || 0) + amount)
    }
    if (toPath && liabilityPaths.has(toPath)) {
      getOrCreate(cur).lent += amount
    }

    if (fromPath && revenuePaths.has(fromPath)) {
      const key = `${cur}|${fromPath}`
      incomeMap.set(key, (incomeMap.get(key) || 0) + amount)
    }
    if (fromPath && liabilityPaths.has(fromPath)) {
      getOrCreate(cur).returned += amount
    }
  }

  for (const [key, total] of expenseMap) {
    const [cur, path] = key.split('|')
    const data = getOrCreate(cur)
    data.expenses += total
    if (total > 0) {
      data.expenseBreakdown.push({
        name: accountNames.get(path) || path,
        value: Math.round(total * 100) / 100,
        path,
      })
    }
  }

  for (const [key, total] of incomeMap) {
    const [cur, path] = key.split('|')
    const data = getOrCreate(cur)
    data.income += total
    if (total > 0) {
      data.incomeBreakdown.push({
        name: accountNames.get(path) || path,
        value: Math.round(total * 100) / 100,
        path,
      })
    }
  }

  for (const data of result.values()) {
    data.expenseBreakdown.sort((a, b) => b.value - a.value)
    data.incomeBreakdown.sort((a, b) => b.value - a.value)
  }

  return result
})

const periodCurrencies = computed(() => {
  const pinned = pinnedCurrenciesList.value
  const all = Array.from(periodByCurrency.value.keys())
  // Pinned first, then the rest
  const ordered = pinned.filter((c) => all.includes(c))
  for (const c of all) {
    if (!ordered.includes(c)) ordered.push(c)
  }
  return ordered
})

const selectedPeriodCurrency = ref(
  AbeleConfig.getInstance().pinnedCurrencies.split(',')[0]?.trim().toUpperCase() || 'EUR'
)

const currencyTabs = computed(() => periodCurrencies.value.map((c) => ({ id: c, label: c })))

// Auto-select first available currency if current selection has no data
watch(periodCurrencies, (currencies) => {
  if (
    currencies.length &&
    !currencies.includes(selectedPeriodCurrency.value) &&
    !pinnedCurrenciesList.value.includes(selectedPeriodCurrency.value)
  ) {
    selectedPeriodCurrency.value = currencies[0]
  }
})

const emptyPeriodData: CurrencyPeriodData = {
  income: 0,
  expenses: 0,
  lent: 0,
  returned: 0,
  expenseBreakdown: [],
  incomeBreakdown: [],
}

const periodTotals = computed((): CurrencyPeriodData => {
  return periodByCurrency.value.get(selectedPeriodCurrency.value) || emptyPeriodData
})

const periodIncome = computed(() => periodTotals.value.income)
const periodExpenses = computed(() => periodTotals.value.expenses)
const periodLent = computed(() => periodTotals.value.lent)
const periodReturned = computed(() => periodTotals.value.returned)
const periodSavings = computed(() => periodIncome.value - periodExpenses.value)

// --- Account Type Lookup ---

const accountTypeSets = computed(() => {
  const al = accountsList.value
  const asset = new Set<string>()
  const expense = new Set<string>()
  const revenue = new Set<string>()
  if (!al) return { asset, expense, revenue }

  for (const [path, account] of al.accounts) {
    if (account.accountType === 'asset') asset.add(path)
    if (account.accountType === 'expense') expense.add(path)
    if (account.accountType === 'revenue') revenue.add(path)
  }
  return { asset, expense, revenue }
})

// --- Charts ---

type ChartTab = 'expenses' | 'income' | 'calendar' | 'networth'
const chartTab = ref<ChartTab>('expenses')
const allChartTabs = [
  { id: 'expenses' as ChartTab, label: 'Expenses' },
  { id: 'income' as ChartTab, label: 'Income' },
  { id: 'calendar' as ChartTab, label: 'Calendar' },
  { id: 'networth' as ChartTab, label: 'Net Worth' },
]

const chartTabs = computed(() =>
  isCustomRange.value ? allChartTabs.filter((t) => t.id !== 'calendar') : allChartTabs
)

// Keep pieTab in sync for backward compat
const pieTab = computed(() => (chartTab.value === 'income' ? 'income' : 'expenses'))

// --- Pie Chart ---

const pieChartEl = ref<HTMLElement | null>(null)
let pieChart: EChartsType | null = null
let pieObserver: ResizeObserver | null = null

const pieData = computed(() =>
  pieTab.value === 'expenses'
    ? periodTotals.value.expenseBreakdown
    : periodTotals.value.incomeBreakdown
)

function renderPieChart() {
  if (!pieChartEl.value) {
    pieChart?.dispose()
    pieChart = null
    pieObserver?.disconnect()
    pieObserver = null
    return
  }

  if (!pieChart || pieChart.isDisposed()) {
    pieChart = echartsInit(pieChartEl.value)
    pieObserver = new ResizeObserver(() => pieChart?.resize())
    pieObserver.observe(pieChartEl.value)
    pieChart.on('click', (params: any) => {
      const item = pieData.value[params.dataIndex]
      if (item?.path) {
        openFile(item.path)
      }
    })
  }

  const colors = getThemeColors()
  const data = pieData.value

  if (!data.length) {
    pieChart.clear()
    return
  }

  pieChart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'item',
        enterable: false,
        confine: true,
        formatter: (p: any) => `${p.marker} ${p.name}: ${formatAmount(p.value)} (${p.percent}%)`,
      },
      series: [
        {
          type: 'pie',
          radius: ['32%', '52%'],
          center: ['50%', '50%'],
          itemStyle: {
            borderWidth: 2,
            borderColor: getComputedStyle(document.body)
              .getPropertyValue('--background-primary')
              .trim(),
          },
          emphasis: { disabled: true },
          // The labels stand against the chart's edges rather than at the end of a fixed-length
          // line, so a category's name has all the room beside the ring. Left free, a label
          // was cut wherever the line happened to end — to "Ho..." at a sidebar's width.
          label: {
            color: colors.text,
            formatter: '{b}',
            alignTo: 'edge',
            edgeDistance: 0,
          },
          labelLine: { length: 8, length2: 0 },
          data,
        },
      ],
    },
    true
  )
}

watch([pieData, pieChartEl], () => nextTick(renderPieChart), { immediate: true })

// --- Calendar Heatmap ---

const calendarChartEl = ref<HTMLElement | null>(null)
let calendarChart: EChartsType | null = null
let calendarObserver: ResizeObserver | null = null

const calendarData = computed(() => {
  const { expense: expPaths, revenue: revPaths } = accountTypeSets.value
  const startStr = periodStart.value.format(DATE_FORMAT)
  const endStr = periodEnd.value.format(DATE_FORMAT)
  const dayMap = new Map<string, { expense: number; income: number }>()

  for (const entry of ledger.value) {
    if (entry.amount == null || entry.currency !== selectedPeriodCurrency.value) continue
    if (entry.date < startStr || entry.date > endStr) continue

    if (!dayMap.has(entry.date)) dayMap.set(entry.date, { expense: 0, income: 0 })
    const day = dayMap.get(entry.date)!

    if (entry.to && expPaths.has(entry.to)) day.expense += entry.amount
    if (entry.from && revPaths.has(entry.from)) day.income += entry.amount
  }

  return dayMap
})

function renderCalendarChart() {
  if (!calendarChartEl.value) {
    calendarChart?.dispose()
    calendarChart = null
    calendarObserver?.disconnect()
    calendarObserver = null
    return
  }

  if (!calendarChart || calendarChart.isDisposed()) {
    calendarChart = echartsInit(calendarChartEl.value)
    calendarObserver = new ResizeObserver(() => calendarChart?.resize())
    calendarObserver.observe(calendarChartEl.value)
  }

  const colors = getThemeColors()
  const rangeStart = periodStart.value.format(DATE_FORMAT)
  const rangeEnd = periodEnd.value.format(DATE_FORMAT)
  const dayTotals = calendarData.value

  const expenseData: Array<[string, number]> = []
  let d = periodStart.value
  while (d.isBefore(periodEnd.value) || d.isSame(periodEnd.value, 'day')) {
    const dateStr = d.format(DATE_FORMAT)
    const data = dayTotals.get(dateStr)
    expenseData.push([dateStr, data?.expense || 0])
    d = d.add(1, 'day')
  }

  const maxExpense = Math.max(...expenseData.map((e) => e[1]), 1)
  const bgPrimary = getComputedStyle(document.body).getPropertyValue('--background-primary').trim()
  const isDark = document.body.classList.contains('theme-dark')
  const emptyColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'

  const fmtShort = (n: number): string => {
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k'
    return n.toFixed(0)
  }

  calendarChart.setOption(
    {
      animation: false,
      tooltip: {
        formatter: (params: any) => {
          const dateStr = params.data[0]
          const data = dayTotals.get(dateStr)
          if (!data || (data.expense === 0 && data.income === 0))
            return `${dateStr}<br/>No transactions`
          let html = `<b>${dateStr}</b>`
          if (data.income > 0)
            html += `<br/><span style="color:${colors.income}">+${formatAmount(data.income)}</span>`
          if (data.expense > 0)
            html += `<br/><span style="color:${colors.expense}">-${formatAmount(data.expense)}</span>`
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
          firstDay: store.weekStartsOnMonday.value ? 1 : 0,
          nameMap: 'en',
          color: colors.textFaint,
        },
        monthLabel: { show: false },
        yearLabel: { show: false },
        splitLine: { lineStyle: { color: 'transparent' } },
        itemStyle: { borderWidth: 2, borderColor: bgPrimary, borderRadius: 4 },
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
    },
    true
  )
}

watch([calendarData, calendarChartEl], () => nextTick(renderCalendarChart), { immediate: true })

// --- Net Worth Chart ---

const networthChartEl = ref<HTMLElement | null>(null)
let networthChart: EChartsType | null = null
let networthObserver: ResizeObserver | null = null
const networthLegendSelected = ref<Record<string, boolean>>({})

interface NetworthSeries {
  name: string
  data: number[]
}

const networthData = pausedWhileHidden(active, () => {
  const bi = toRaw(balanceIndex.value) as BalanceIndex | null
  if (!bi) return { dates: [] as string[], series: [] as NetworthSeries[] }
  bi.version.value // track reactivity

  const dates: string[] = []
  let d = periodStart.value
  while (d.isBefore(periodEnd.value) || d.isSame(periodEnd.value, 'day')) {
    dates.push(d.format('MMM D'))
    d = d.add(1, 'day')
  }

  const series: NetworthSeries[] = []
  for (const currency of pinnedCurrenciesList.value) {
    const data: number[] = []
    let dd = periodStart.value
    for (let i = 0; i < dates.length; i++) {
      data.push(Math.round(bi.getNetWorthAtDateByCurrency(dd, currency) * 100) / 100)
      dd = dd.add(1, 'day')
    }
    series.push({ name: currency, data })
  }

  return { dates, series }
})

function renderNetworthChart() {
  if (!networthChartEl.value) {
    networthChart?.dispose()
    networthChart = null
    networthObserver?.disconnect()
    networthObserver = null
    return
  }

  if (!networthChart || networthChart.isDisposed()) {
    networthChart = echartsInit(networthChartEl.value)
    networthObserver = new ResizeObserver(() => networthChart?.resize())
    networthObserver.observe(networthChartEl.value)
    networthChart.on('legendselectchanged', (params: any) => {
      networthLegendSelected.value = { ...params.selected }
    })
  }

  const { dates, series } = networthData.value

  if (!dates.length || !series.length) {
    networthChart.clear()
    return
  }

  networthChart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) => formatAmount(v),
      },
      legend: {
        data: series.map((s) => s.name),
        selected: Object.keys(networthLegendSelected.value).length
          ? networthLegendSelected.value
          : undefined,
        bottom: 0,
        type: 'scroll',
      },
      grid: {
        left: 12,
        right: 12,
        top: 12,
        bottom: series.length > 1 ? 40 : 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLabel: {
          interval: Math.max(Math.floor(dates.length / 6) - 1, 0),
          hideOverlap: true,
          ...(dates.length > 8 ? { rotate: 45 } : {}),
        },
      },
      yAxis: { type: 'value' },
      series: series.map((s) => ({
        name: s.name,
        type: 'line',
        data: s.data,
        emphasis: { disabled: true },
      })),
    },
    true
  )
}

watch([networthData, networthChartEl], () => nextTick(renderNetworthChart), { immediate: true })

// --- Recent Transactions ---

// The ledger is already newest first.
const sortedTransactions = computed(() => {
  const endStr = periodEnd.value.format(DATE_FORMAT)
  const entries = ledger.value
  let first = 0
  while (first < entries.length && entries[first].date > endStr) first++
  return first === 0 ? entries : entries.slice(first)
})

function transactionType(entry: LedgerEntry): 'income' | 'expense' | 'transfer' {
  const { expense, revenue } = accountTypeSets.value
  if (entry.to && expense.has(entry.to)) return 'expense'
  if (entry.from && revenue.has(entry.from)) return 'income'
  return 'transfer'
}

watch(periodEnd, () => {
  visibleCount.value = PAGE_SIZE
})

const visibleTransactions = computed(() => sortedTransactions.value.slice(0, visibleCount.value))

const scrollSentinel = ref<HTMLElement | null>(null)
useIntersectionObserver(scrollSentinel, ([entry]) => {
  if (entry?.isIntersecting && sortedTransactions.value.length > visibleCount.value) {
    visibleCount.value += PAGE_SIZE
  }
})

const showTxDateBefore = (idx: number): boolean => {
  if (idx === 0) return true
  return visibleTransactions.value[idx].date !== visibleTransactions.value[idx - 1].date
}

const isAssetToAsset = (entry: LedgerEntry): boolean => {
  const { asset } = accountTypeSets.value
  return !!(entry.to && asset.has(entry.to) && entry.from && asset.has(entry.from))
}

/**
 * The per-currency sum beside each date heading, for the days on screen. One pass over the
 * days shown — the entries of a day sit next to each other — instead of a pass over every
 * transaction per heading.
 */
const dayTotals = computed(() => {
  const shown = visibleTransactions.value
  const totals = new Map<string, string[]>()
  if (!shown.length) return totals

  const lastDay = shown[shown.length - 1].date
  const byDay = new Map<string, Map<string, number>>()
  for (const entry of sortedTransactions.value) {
    if (entry.date < lastDay) break
    if (isAssetToAsset(entry)) continue
    let byCurrency = byDay.get(entry.date)
    if (!byCurrency) byDay.set(entry.date, (byCurrency = new Map()))
    const cur = entry.currency || '?'
    const sign = transactionType(entry) === 'income' ? 1 : -1
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + sign * (entry.amount || 0))
  }

  for (const [day, byCurrency] of byDay) {
    totals.set(
      day,
      Array.from(byCurrency.entries()).map(
        ([cur, amount]) => `${amount >= 0 ? '+' : ''}${formatAmount(amount)} ${cur}`
      )
    )
  }
  return totals
})
</script>

<style lang="scss">
.abele-finance-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--background-primary);

  padding: calc(var(--p-spacing) * 2);
  padding-top: calc(var(--size-4-2) * 2 + var(--icon-size));
}

@media (max-width: 600px) {
  .abele-finance-sidebar {
    padding: calc(var(--size-4-4));
    padding-top: calc(var(--size-4-2) + var(--icon-size));
  }
}

.abele-finance-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--size-4-2);
}

.abele-finance-sidebar__header-left {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-finance-sidebar__header-text {
  font-weight: bold;
}

// Three distances, used the same way all through the sidebar: --size-4-1 between rows that
// belong together, --size-4-4 between one currency's card and the next, and --size-4-6
// between the blocks — the cards, the period summary, the transactions.

// --- Currency Cards ---

.abele-finance-sidebar__cards {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  margin-top: var(--size-4-2);
  margin-bottom: var(--size-4-6);
}

.abele-finance-sidebar__card {
  display: flex;
  flex-direction: column;
}

// A rule over rows that qualify the figure above them: the debts under a balance, the money
// lent and returned under the period's savings. Solid is kept for the total it closes.
.abele-finance-sidebar__dashed {
  margin-top: var(--size-4-1);
  padding-top: var(--size-4-1);
  border-top: 1px dashed var(--background-modifier-border);
}

.abele-finance-sidebar__card-balance {
  font-size: var(--font-ui-large);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.abele-finance-sidebar__card-currency {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-weight: normal;
}

// Label on the left, amount on the right, as in the period summary below — one size smaller,
// because these belong to the balance above them rather than standing on their own.
.abele-finance-sidebar__card-details {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}

.abele-finance-sidebar__card-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--size-4-2);
}

.abele-finance-sidebar__card-debts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  column-gap: var(--size-4-2);
}

.abele-finance-sidebar__card-net {
  font-weight: var(--font-medium);
}

// --- Section ---

.abele-finance-sidebar__section {
  margin-bottom: var(--size-4-6);
}

.abele-finance-sidebar__section-title {
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 var(--size-4-2) 0;
}

// --- Tabs ---

.abele-finance-sidebar__currency-tabs {
  margin-bottom: var(--size-4-2);
}

.abele-finance-sidebar__chart-tabs {
  margin-top: var(--size-4-4);
}

// --- Summary ---

.abele-finance-sidebar__summary {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-finance-sidebar__summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-ui-small);
}

.abele-finance-sidebar__summary-row--total {
  border-top: 1px solid var(--background-modifier-border);
  padding-top: var(--size-4-1);
  font-weight: var(--font-semibold);
}

.abele-finance-sidebar__summary-label {
  color: var(--text-muted);
}

.abele-finance-sidebar__summary-value {
  font-variant-numeric: tabular-nums;
}

.abele-finance-sidebar__summary-value--income {
  color: var(--text-success);
}

.abele-finance-sidebar__summary-value--expense {
  color: var(--text-error);
}

// --- Charts ---

.abele-finance-sidebar__pie-empty {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: var(--font-ui-small);
  font-style: italic;
}

.abele-finance-sidebar__pie-chart,
.abele-finance-sidebar__calendar-chart,
.abele-finance-sidebar__networth-chart {
  width: 100%;
  max-width: 100%;
  height: 220px;
  margin-top: var(--size-4-2);

  canvas {
    max-width: 100% !important;
  }
}

// --- Transactions ---

.abele-finance-sidebar__transactions {
  display: flex;
  flex-direction: column;
}

.abele-finance-sidebar__sentinel {
  height: 1px;
}

// --- Empty ---

.abele-finance-sidebar__empty {
  font-size: var(--font-ui-small);
  color: var(--text-faint);
  font-style: italic;
}
</style>
