<template>
  <SidebarPanel class="abele-finance-sidebar">
    <div class="abele-finance-sidebar__header">
      <div class="abele-finance-sidebar__header-left">
        <div class="abele-finance-sidebar__header-text">Transactions</div>
        <ObsidianIcon icon="banknote-arrow-down" @click="createTransaction()" />
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
        <Chart
          v-if="pieData.length"
          :active="active"
          :source="pieData"
          :render="renderPieChart"
          :created="createPieChart"
          class="abele-finance-sidebar__pie-chart"
        />
        <EmptyState v-else class="abele-finance-sidebar__pie-empty" text="No data" />
      </template>
      <template v-else-if="chartTab === 'calendar'">
        <Chart
          :active="active"
          :source="[calendarData, store.weekStartsOnMonday.value]"
          :render="renderCalendarChart"
          class="abele-finance-sidebar__calendar-chart"
        />
      </template>
      <template v-else-if="chartTab === 'networth'">
        <Chart
          :active="active"
          :source="networthData"
          :render="renderNetworthChart"
          :created="createNetworthChart"
          class="abele-finance-sidebar__networth-chart"
        />
      </template>
    </section>

    <!-- Recent Transactions -->
    <Section title="Recent Transactions" class="abele-finance-sidebar__section">
      <template #actions>
        <ObsidianIcon
          class="abele-finance-sidebar__search-toggle"
          icon="search"
          :active="search.open.value"
          :tooltip="search.open.value ? 'Close the search' : 'Search all transactions'"
          @click="search.toggle"
        />
      </template>
      <ObsidianSearch
        v-if="search.open.value"
        v-model="search.query.value"
        class="abele-finance-sidebar__search"
        placeholder="Search transactions…"
        autofocus
        @keydown.escape.stop.prevent="search.close"
      />
      <div
        v-if="visibleTransactions.length"
        ref="transactionsEl"
        class="abele-finance-sidebar__transactions"
      >
        <template v-for="(entry, idx) in visibleTransactions" :key="entry.id">
          <DateDivider v-if="showTxDateBefore(idx)" :date="entry.date">
            <span v-for="s in dayTotals.get(entry.date) ?? []" :key="s">{{ s }}</span>
          </DateDivider>
          <TransactionItem :transaction="entry.tx" :tx-type="transactionType(entry)" />
        </template>
        <div ref="scrollSentinel" class="abele-finance-sidebar__sentinel" />
      </div>
      <EmptyState
        v-else
        :variant="search.terms.value.length ? 'no-matches' : 'empty'"
        :text="search.terms.value.length ? 'Nothing matches the search.' : 'No transactions found'"
      />
    </Section>
  </SidebarPanel>
</template>

<script setup lang="ts">
import { useFinanceCharts } from '@/composables/useFinanceCharts'
import { useFinancePeriodSummary } from '@/composables/useFinancePeriodSummary'
import { addMoney } from '@/helpers/moneySum'
import { ref, unref, watch, toRef } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { GlobalStore } from '@/stores/GlobalStore'
import { AccountsList } from '@/entities/AccountsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { createTransaction } from '@/commands/createTransaction'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DATE_FORMAT } from '@/constants/dates'
import Chart from './obsidian/Chart.vue'
import SidebarPanel from './obsidian/SidebarPanel.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Section from './obsidian/Section.vue'
import { openFile } from '@/helpers/vaultUtils'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianSearch from './obsidian/Search.vue'
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
import { transactionSearch, useListSearch } from '@/composables/useListSearch'
import { useSearchHighlight } from '@/composables/useSearchHighlight'
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
const computed = <T,>(getter: () => T) => pausedWhileHidden(active, getter)

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
  const bi = toRaw(balanceIndex.value)
  if (!al || !bi) return []
  bi.version.value // track reactivity

  const asOfDate = periodEnd.value
  return pinnedCurrenciesList.value.map((currency) =>
    currencyCard(currency, al.accounts, (path) => bi.getBalanceAtDate(path, asOfDate))
  )
})

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

const {
  periodCurrencies,
  selectedPeriodCurrency,
  currencyTabs,
  periodTotals,
  periodIncome,
  periodExpenses,
  periodLent,
  periodReturned,
  periodSavings,
} = useFinancePeriodSummary({
  active,
  accountsList,
  ledger,
  pinnedCurrenciesList,
  periodStart,
  periodEnd,
})

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

const pieData = computed(() =>
  pieTab.value === 'expenses'
    ? periodTotals.value.expenseBreakdown
    : periodTotals.value.incomeBreakdown
)

// --- Calendar Heatmap ---

const calendarData = computed(() => {
  const { expense: expPaths, revenue: revPaths } = accountTypeSets.value
  const startStr = periodStart.value.format(DATE_FORMAT)
  const endStr = periodEnd.value.format(DATE_FORMAT)
  const dayMap = new Map<string, { expense: number; income: number }>()

  for (const entry of ledger.value) {
    if (entry.amount == null || entry.currency !== selectedPeriodCurrency.value) continue
    if (entry.date < startStr || entry.date > endStr) continue

    if (!dayMap.has(entry.date)) dayMap.set(entry.date, { expense: 0, income: 0 })
    const day = dayMap.get(entry.date)

    if (entry.to && expPaths.has(entry.to)) day.expense = addMoney(day.expense, entry.amount)
    if (entry.from && revPaths.has(entry.from)) day.income = addMoney(day.income, entry.amount)
  }

  return dayMap
})

// --- Net Worth Chart ---

const networthLegendSelected = ref<Record<string, boolean>>({})

interface NetworthSeries {
  name: string
  data: number[]
}

const networthData = pausedWhileHidden(active, () => {
  const bi = toRaw(balanceIndex.value)
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

const {
  createPieChart,
  renderPieChart,
  renderCalendarChart,
  createNetworthChart,
  renderNetworthChart,
} = useFinanceCharts({
  pieData,
  calendarData,
  periodStart,
  periodEnd,
  weekStartsOnMonday: store.weekStartsOnMonday,
  networthData,
  networthLegendSelected,
  openFile,
})

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

/**
 * The search covers every transaction in the vault, not only those up to the period's end: this
 * is the general list, and what is searched for may be from any time. Results stay newest first.
 */
const ledgerTransactions = computed(() => ledger.value.map((entry) => entry.tx))
const search = useListSearch(() => ledgerTransactions.value, transactionSearch)

const transactionsEl = ref<HTMLElement | null>(null)
useSearchHighlight(transactionsEl, search.terms)

const listedTransactions = computed(() => {
  if (!search.terms.value.length) return sortedTransactions.value
  const found = new Set(search.results.value.map((tx) => toRaw(tx)))
  return ledger.value.filter((entry) => found.has(toRaw(entry.tx)))
})

watch([periodEnd, search.terms], () => {
  visibleCount.value = PAGE_SIZE
})

const visibleTransactions = computed(() => listedTransactions.value.slice(0, visibleCount.value))

const scrollSentinel = ref<HTMLElement | null>(null)
useIntersectionObserver(scrollSentinel, ([entry]) => {
  if (entry?.isIntersecting && listedTransactions.value.length > visibleCount.value) {
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
  for (const entry of listedTransactions.value) {
    if (entry.date < lastDay) break
    if (isAssetToAsset(entry)) continue
    let byCurrency = byDay.get(entry.date)
    if (!byCurrency) byDay.set(entry.date, (byCurrency = new Map()))
    const cur = entry.currency || '?'
    const sign = transactionType(entry) === 'income' ? 1 : -1
    byCurrency.set(cur, addMoney(byCurrency.get(cur) || 0, sign * (entry.amount || 0)))
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

<style lang="scss" src="./finance/sidebar.scss"></style>
