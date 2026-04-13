<template>
  <div class="abele-finance-sidebar">
    <div class="abele-finance-sidebar__header">
      <div class="abele-finance-sidebar__header-left">
        <div class="abele-finance-sidebar__header-text">Transactions</div>
        <ObsidianIcon icon="banknote-arrow-down" @click="createTransaction()" />
      </div>
    </div>

    <div class="abele-finance-sidebar__period-header">
      <ObsidianIcon icon="chevron-left" @click="previousMonth()" />
      <div class="abele-finance-sidebar__period-title" @click="goToCurrentMonth()">
        {{ periodLabel }}
      </div>
      <ObsidianIcon icon="chevron-right" @click="nextMonth()" />
    </div>

    <!-- Currency Balance Cards -->
    <div v-if="currencyCards.length" class="abele-finance-sidebar__cards">
      <div v-for="card in currencyCards" :key="card.currency" class="abele-finance-sidebar__card">
        <div class="abele-finance-sidebar__card-balance">
          {{ formatAmount(card.assets) }}
          <span class="abele-finance-sidebar__card-currency">{{ card.currency }}</span>
        </div>
        <div class="abele-finance-sidebar__card-details">
          <span v-if="card.liabilities > 0" class="abele-finance-sidebar__card-debt">
            Debt {{ formatAmount(card.liabilities) }}
          </span>
          <span
            v-if="card.liabilities > 0"
            class="abele-finance-sidebar__card-net"
            :class="{
              'abele-finance-sidebar__summary-value--income': card.net >= 0,
              'abele-finance-sidebar__summary-value--expense': card.net < 0,
            }"
          >
            Net {{ formatAmount(card.net) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Period Summary -->
    <section class="abele-finance-sidebar__section">
      <div v-if="periodCurrencies.length > 1" class="abele-finance-sidebar__currency-tabs">
        <div
          v-for="cur in periodCurrencies"
          :key="cur"
          class="abele-finance-sidebar__currency-tab"
          :class="{ 'abele-finance-sidebar__currency-tab--active': selectedPeriodCurrency === cur }"
          @click="selectedPeriodCurrency = cur"
        >
          {{ cur }}
        </div>
      </div>
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
        class="abele-finance-sidebar__summary abele-finance-sidebar__summary--debt"
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
      <div class="abele-finance-sidebar__chart-tabs">
        <div
          v-for="tab in chartTabs"
          :key="tab.key"
          class="abele-finance-sidebar__chart-tab"
          :class="{ 'abele-finance-sidebar__chart-tab--active': chartTab === tab.key }"
          @click="chartTab = tab.key"
        >
          {{ tab.label }}
        </div>
      </div>
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
        <TransactionItem
          v-for="tx in visibleTransactions"
          :key="tx.id"
          :transaction="tx"
          :tx-type="transactionTypes.get(tx.id) || 'transfer'"
        />
        <div ref="scrollSentinel" class="abele-finance-sidebar__sentinel" />
      </div>
      <div v-else class="abele-finance-sidebar__empty">No transactions found</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, unref, watch, nextTick, onUnmounted } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { GlobalStore } from '@/stores/GlobalStore'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { createTransaction } from '@/commands/createTransaction'
import { AbeleConfig } from '@/services/AbeleConfig'
import { wikilinkToPath } from '@/helpers/pathsHelpers'
import { DATE_FORMAT } from '@/constants/dates'
import { echartsInit, getThemeColors, EChartsType } from '@/bases/echarts'
import { openFile } from '@/helpers/vaultUtils'
import ObsidianIcon from './obsidian/Icon.vue'
import TransactionItem from './TransactionItem.vue'
import dayjs from 'dayjs'
import { toRaw } from 'vue'

const PAGE_SIZE = 20
const visibleCount = ref(PAGE_SIZE)

const store = GlobalStore.getInstance()

const accountsList = computed(() => unref(store.accountsList) as AccountsList | null)
const transactionsList = computed(() => unref(store.transactionsList) as TransactionsList | null)
const balanceIndex = computed(() => unref(store.balanceIndex) as BalanceIndex | null)

// --- Currency Balance Cards ---

interface CurrencyCard {
  currency: string
  assets: number
  liabilities: number
  net: number
}

const pinnedCurrenciesList = computed(() =>
  AbeleConfig.getInstance()
    .pinnedCurrencies.split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
)

const currencyCards = computed<CurrencyCard[]>(() => {
  const al = accountsList.value
  const bi = toRaw(balanceIndex.value) as BalanceIndex | null
  if (!al || !bi) return []
  bi.version.value // track reactivity

  const asOfDate = periodEnd.value
  const cards: CurrencyCard[] = []

  for (const currency of pinnedCurrenciesList.value) {
    let assets = 0
    let liabilities = 0

    for (const [path, account] of al.accounts) {
      if (account.currency !== currency) continue
      if (account.excludeFromTotal) continue

      const balance = bi.getBalanceAtDate(path, asOfDate)
      if (account.accountType === 'asset') assets += balance
      else if (account.accountType === 'liability') liabilities += Math.abs(balance)
    }

    cards.push({
      currency,
      assets,
      liabilities,
      net: assets - liabilities,
    })
  }

  return cards
})

onUnmounted(() => {
  pieChart?.dispose()
  pieObserver?.disconnect()
  calendarChart?.dispose()
  calendarObserver?.disconnect()
  networthChart?.dispose()
  networthObserver?.disconnect()
})

// --- Period Summary ---

const selectedMonth = ref(dayjs().month())
const selectedYear = ref(dayjs().year())

const periodLabel = computed(() =>
  dayjs().year(selectedYear.value).month(selectedMonth.value).format('MMMM YYYY')
)

const periodStart = computed(() =>
  dayjs().year(selectedYear.value).month(selectedMonth.value).startOf('month')
)
const periodEnd = computed(() =>
  dayjs().year(selectedYear.value).month(selectedMonth.value).endOf('month')
)

function previousMonth() {
  if (selectedMonth.value === 0) {
    selectedMonth.value = 11
    selectedYear.value -= 1
  } else {
    selectedMonth.value -= 1
  }
}

function nextMonth() {
  if (selectedMonth.value === 11) {
    selectedMonth.value = 0
    selectedYear.value += 1
  } else {
    selectedMonth.value += 1
  }
}

function goToCurrentMonth() {
  selectedMonth.value = dayjs().month()
  selectedYear.value = dayjs().year()
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
  const tl = toRaw(transactionsList.value) as TransactionsList | null
  const al = accountsList.value
  const result = new Map<string, CurrencyPeriodData>()
  if (!tl || !al) return result

  const startStr = periodStart.value.format(DATE_FORMAT)
  const endStr = periodEnd.value.format(DATE_FORMAT)

  const { app } = store
  const resolveCache = new Map<string, string | null>()
  const resolve = (wikilink: string): string | null => {
    if (resolveCache.has(wikilink)) return resolveCache.get(wikilink)!
    const linkPath = wikilinkToPath(wikilink)
    const file = linkPath ? app.metadataCache.getFirstLinkpathDest(linkPath, '') : null
    const resolved = file ? file.path : null
    resolveCache.set(wikilink, resolved)
    return resolved
  }

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

  for (const tx of tl.transactions.values()) {
    const raw = toRaw(tx)
    if (!raw.loaded || !raw.date || raw.amount == null || !raw.currency) continue

    const dateStr = raw.date.format(DATE_FORMAT)
    if (dateStr < startStr || dateStr > endStr) continue

    const cur = raw.currency

    const toPath = raw.to ? resolve(raw.to) : null
    if (toPath && expensePaths.has(toPath)) {
      const key = `${cur}|${toPath}`
      expenseMap.set(key, (expenseMap.get(key) || 0) + raw.amount)
    }
    if (toPath && liabilityPaths.has(toPath)) {
      getOrCreate(cur).returned += raw.amount
    }

    const fromPath = raw.from ? resolve(raw.from) : null
    if (fromPath && revenuePaths.has(fromPath)) {
      const key = `${cur}|${fromPath}`
      incomeMap.set(key, (incomeMap.get(key) || 0) + raw.amount)
    }
    if (fromPath && liabilityPaths.has(fromPath)) {
      getOrCreate(cur).lent += raw.amount
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
  const expense = new Set<string>()
  const revenue = new Set<string>()
  if (!al) return { expense, revenue }

  for (const [path, account] of al.accounts) {
    if (account.accountType === 'expense') expense.add(path)
    if (account.accountType === 'revenue') revenue.add(path)
  }
  return { expense, revenue }
})

function resolveWikilink(wikilink: string): string | null {
  const linkPath = wikilinkToPath(wikilink)
  if (!linkPath) return null
  const file = store.app.metadataCache.getFirstLinkpathDest(linkPath, '')
  return file ? file.path : null
}

// --- Charts ---

type ChartTab = 'expenses' | 'income' | 'calendar' | 'networth'
const chartTab = ref<ChartTab>('expenses')
const chartTabs = [
  { key: 'expenses' as ChartTab, label: 'Expenses' },
  { key: 'income' as ChartTab, label: 'Income' },
  { key: 'calendar' as ChartTab, label: 'Calendar' },
  { key: 'networth' as ChartTab, label: 'Net Worth' },
]

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
        formatter: (p: any) =>
          `${p.marker} ${p.name}: ${p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${p.percent}%)`,
      },
      series: [
        {
          type: 'pie',
          radius: ['35%', '60%'],
          center: ['50%', '50%'],
          itemStyle: {
            borderWidth: 2,
            borderColor: getComputedStyle(document.body)
              .getPropertyValue('--background-primary')
              .trim(),
          },
          emphasis: { disabled: true },
          label: {
            color: colors.text,
            formatter: '{b}',
          },
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
  const tl = toRaw(transactionsList.value) as TransactionsList | null
  if (!tl) return new Map<string, { expense: number; income: number }>()

  const { expense: expPaths, revenue: revPaths } = accountTypeSets.value
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

  const startStr = periodStart.value.format(DATE_FORMAT)
  const endStr = periodEnd.value.format(DATE_FORMAT)
  const dayMap = new Map<string, { expense: number; income: number }>()

  for (const tx of tl.transactions.values()) {
    const raw = toRaw(tx)
    if (!raw.loaded || !raw.date || raw.amount == null || !raw.currency) continue
    if (raw.currency !== selectedPeriodCurrency.value) continue

    const dateStr = raw.date.format(DATE_FORMAT)
    if (dateStr < startStr || dateStr > endStr) continue

    if (!dayMap.has(dateStr)) dayMap.set(dateStr, { expense: 0, income: 0 })
    const day = dayMap.get(dateStr)!

    const toPath = raw.to ? resolve(raw.to) : null
    const fromPath = raw.from ? resolve(raw.from) : null

    if (toPath && expPaths.has(toPath)) day.expense += raw.amount
    if (fromPath && revPaths.has(fromPath)) day.income += raw.amount
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

const networthData = computed(() => {
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

const sortedTransactions = computed(() => {
  const tl = transactionsList.value
  if (!tl) return []

  const { app } = store
  const endStr = periodEnd.value.format('YYYY-MM-DD')
  const txs = [...tl.transactions.values()].filter(
    (tx) => tx.loaded && tx.date && tx.date.format('YYYY-MM-DD') <= endStr
  )
  txs.sort((a, b) => {
    const da = a.date!.format('YYYY-MM-DD')
    const db = b.date!.format('YYYY-MM-DD')
    const dateCmp = db.localeCompare(da)
    if (dateCmp !== 0) return dateCmp

    const fa = app.vault.getAbstractFileByPath(a.transactionPath)
    const fb = app.vault.getAbstractFileByPath(b.transactionPath)
    const ca = (fa as any)?.stat?.ctime ?? 0
    const cb = (fb as any)?.stat?.ctime ?? 0
    return cb - ca
  })

  return txs
})

const transactionTypes = computed(() => {
  const { expense, revenue } = accountTypeSets.value
  const types = new Map<string, 'income' | 'expense' | 'transfer'>()

  for (const tx of sortedTransactions.value) {
    const toPath = tx.to ? resolveWikilink(tx.to) : null
    const fromPath = tx.from ? resolveWikilink(tx.from) : null

    if (toPath && expense.has(toPath)) {
      types.set(tx.id, 'expense')
    } else if (fromPath && revenue.has(fromPath)) {
      types.set(tx.id, 'income')
    } else {
      types.set(tx.id, 'transfer')
    }
  }

  return types
})

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

// --- Formatting ---

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
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
  margin-bottom: var(--p-spacing);
}

.abele-finance-sidebar__header-left {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-finance-sidebar__header-text {
  font-weight: bold;
}

// --- Currency Cards ---

.abele-finance-sidebar__cards {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: calc(var(--p-spacing) * 2);
}

.abele-finance-sidebar__card {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
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

.abele-finance-sidebar__card-details {
  display: flex;
  gap: var(--size-4-2);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.abele-finance-sidebar__card-debt {
  color: var(--text-error);
}

.abele-finance-sidebar__card-net {
  font-weight: var(--font-medium);
}

// --- Section ---

.abele-finance-sidebar__section {
  margin-bottom: calc(var(--p-spacing) * 2);
}

.abele-finance-sidebar__section-title {
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 var(--size-4-2) 0;
}

// --- Period Header ---

.abele-finance-sidebar__period-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--size-4-2);
}

.abele-finance-sidebar__period-title {
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;

  &:hover {
    color: var(--text-accent);
  }
}

// --- Currency Tabs ---

.abele-finance-sidebar__currency-tabs {
  display: flex;
  gap: var(--size-4-1);
  margin-bottom: var(--size-4-2);
}

.abele-finance-sidebar__currency-tab {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--size-2-1) var(--size-4-2);
  border-radius: var(--radius-s);

  &:hover {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
  }

  &--active {
    color: var(--text-normal);
    font-weight: var(--font-semibold);
    background-color: var(--background-modifier-hover);
  }
}

// --- Summary ---

.abele-finance-sidebar__summary {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-finance-sidebar__summary--debt {
  margin-top: var(--size-4-2);
  padding-top: var(--size-4-1);
  border-top: 1px dashed var(--background-modifier-border);
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

.abele-finance-sidebar__chart-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  margin-top: calc(var(--p-spacing) * 1.5);
}

.abele-finance-sidebar__chart-tab {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--size-2-1) var(--size-4-2);
  border-radius: var(--radius-s);

  &:hover {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
  }

  &--active {
    color: var(--text-normal);
    font-weight: var(--font-semibold);
    background-color: var(--background-modifier-hover);
  }
}

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
  margin-top: var(--size-4-1);

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
