<template>
  <div class="abele-finance-sidebar">
    <div class="abele-finance-sidebar__header">
      <div class="abele-finance-sidebar__header-left">
        <div class="abele-finance-sidebar__header-text">Transactions</div>
        <ObsidianIcon icon="banknote-arrow-down" @click="createTransaction()" />
      </div>
    </div>

    <!-- Currency Balance Cards -->
    <div v-if="currencyCards.length" class="abele-finance-sidebar__cards">
      <div v-for="card in currencyCards" :key="card.currency" class="abele-finance-sidebar__card">
        <div class="abele-finance-sidebar__card-body">
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
        <div
          :ref="(el) => setChartRef(card.currency, el as HTMLElement)"
          class="abele-finance-sidebar__card-chart"
        />
      </div>
    </div>

    <!-- Period Summary -->
    <section class="abele-finance-sidebar__section">
      <h3 class="abele-finance-sidebar__section-title">{{ currentMonthLabel }}</h3>
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
    </section>

    <!-- Recent Transactions -->
    <section class="abele-finance-sidebar__section">
      <h3 class="abele-finance-sidebar__section-title">Recent Transactions</h3>
      <div v-if="visibleTransactions.length" class="abele-finance-sidebar__transactions">
        <div
          v-for="tx in visibleTransactions"
          :key="tx.path"
          class="abele-finance-sidebar__transaction-row"
          @click="openNote(tx.path)"
        >
          <div class="abele-finance-sidebar__transaction-main">
            <span class="abele-finance-sidebar__transaction-title">{{ tx.title }}</span>
            <span class="abele-finance-sidebar__transaction-amount">
              {{ formatAmount(tx.amount) }}
              <span class="abele-finance-sidebar__card-currency">{{ tx.currency }}</span>
            </span>
          </div>
          <div class="abele-finance-sidebar__transaction-meta">
            <span>{{ tx.from }} → {{ tx.to }}</span>
            <span>{{ tx.date }}</span>
          </div>
        </div>
        <button v-if="hasMore" class="abele-finance-sidebar__load-more" @click="loadMore">
          Load more
        </button>
      </div>
      <div v-else class="abele-finance-sidebar__empty">No transactions found</div>
    </section>

    <!-- Links to .base views -->
    <section class="abele-finance-sidebar__section">
      <div class="abele-finance-sidebar__links">
        <a class="abele-finance-sidebar__link" @click="openBaseFile('Finance/Transactions.base')">
          Transactions table
        </a>
        <a class="abele-finance-sidebar__link" @click="openBaseFile('Finance/Accounts.base')">
          Accounts overview
        </a>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, unref, watch, nextTick, onUnmounted } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { createTransaction } from '@/commands/createTransaction'
import { AbeleConfig } from '@/services/AbeleConfig'
import { extractAliasOrNameFromWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { DATE_FORMAT, DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { echartsInit, getThemeColors, EChartsType } from '@/bases/echarts'
import ObsidianIcon from './obsidian/Icon.vue'
import dayjs from 'dayjs'
import { Notice, TFile } from 'obsidian'
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
  dailyExpenses: number[] // last 7 days
  dayLabels: string[]
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
  const tl = toRaw(transactionsList.value) as TransactionsList | null
  if (!al || !bi) return []

  const today = dayjs()
  const cards: CurrencyCard[] = []

  for (const currency of pinnedCurrenciesList.value) {
    let assets = 0
    let liabilities = 0

    for (const [path, account] of al.accounts) {
      if (account.currency !== currency) continue
      if (account.excludeFromTotal) continue

      const balance = bi.getBalanceAtDate(path, today)
      if (account.accountType === 'asset') assets += balance
      else if (account.accountType === 'liability') liabilities += Math.abs(balance)
    }

    // Daily expenses for last 7 days
    const days = 7
    const dailyExpenses = computeDailyExpenses(tl, al, currency, days)
    const dayLabels: string[] = []
    for (let i = days - 1; i >= 0; i--) {
      dayLabels.push(today.subtract(i, 'day').format('dd'))
    }

    cards.push({
      currency,
      assets,
      liabilities,
      net: assets - liabilities,
      dailyExpenses,
      dayLabels,
    })
  }

  return cards
})

function computeDailyExpenses(
  tl: TransactionsList | null,
  al: AccountsList | null,
  currency: string,
  days: number
): number[] {
  if (!tl || !al) return new Array(days).fill(0)

  const { app } = store
  const today = dayjs()
  const result = new Array(days).fill(0)

  // Build expense paths for this currency
  const expensePaths = new Set<string>()
  for (const [path, account] of al.accounts) {
    if (account.accountType === 'expense') expensePaths.add(path)
  }

  // Resolve cache
  const resolveCache = new Map<string, string | null>()
  const resolve = (wikilink: string): string | null => {
    if (resolveCache.has(wikilink)) return resolveCache.get(wikilink)!
    const linkPath = wikilinkToPath(wikilink)
    const file = linkPath ? app.metadataCache.getFirstLinkpathDest(linkPath, '') : null
    const resolved = file ? file.path : null
    resolveCache.set(wikilink, resolved)
    return resolved
  }

  const startDate = today.subtract(days - 1, 'day')
  const startStr = startDate.format(DATE_FORMAT)

  for (const tx of tl.transactions.values()) {
    const raw = toRaw(tx)
    if (!raw.loaded || !raw.date || raw.amount == null) continue
    if (raw.currency !== currency) continue

    const dateStr = raw.date.format(DATE_FORMAT)
    if (dateStr < startStr) continue

    const toPath = raw.to ? resolve(raw.to) : null
    if (!toPath || !expensePaths.has(toPath)) continue

    const dayIndex = raw.date.diff(startDate, 'day')
    if (dayIndex >= 0 && dayIndex < days) {
      result[dayIndex] += raw.amount
    }
  }

  return result
}

// Mini charts
const chartInstances = new Map<string, EChartsType>()
const chartObservers = new Map<string, ResizeObserver>()

function applyMiniChartOption(chart: EChartsType, card: CurrencyCard) {
  const colors = getThemeColors()
  const radius = parseInt(getComputedStyle(document.body).getPropertyValue('--radius-s')) || 4
  chart.setOption({
    grid: { left: 0, right: 0, top: 18, bottom: 16, containLabel: false },
    tooltip: { show: false },
    xAxis: {
      type: 'category',
      data: card.dayLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.textFaint },
    },
    yAxis: { type: 'value', show: false },
    series: [
      {
        type: 'bar',
        data: card.dailyExpenses,
        silent: true,
        itemStyle: { color: colors.accent, borderRadius: radius },
        emphasis: { disabled: true },
        barWidth: '55%',
        label: {
          show: true,
          position: 'top',
          color: colors.textFaint,
          formatter: (p: any) => fmtShort(p.value),
        },
      },
    ],
  })
}

function setChartRef(currency: string, el: HTMLElement | null) {
  if (!el) return

  // Dispose old
  chartInstances.get(currency)?.dispose()
  chartInstances.delete(currency)
  chartObservers.get(currency)?.disconnect()
  chartObservers.delete(currency)

  nextTick(() => {
    const card = currencyCards.value.find((c) => c.currency === currency)
    if (!card || !el.isConnected) return

    const chart = echartsInit(el)
    chartInstances.set(currency, chart)

    applyMiniChartOption(chart, card)

    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(el)
    chartObservers.set(currency, observer)
  })
}

// Re-render charts when data changes
watch(currencyCards, () => {
  for (const [currency, chart] of chartInstances) {
    const card = currencyCards.value.find((c) => c.currency === currency)
    if (!card) continue
    applyMiniChartOption(chart, card)
  }
})

onUnmounted(() => {
  for (const chart of chartInstances.values()) chart.dispose()
  for (const obs of chartObservers.values()) obs.disconnect()
  chartInstances.clear()
  chartObservers.clear()
})

// --- Period Summary ---

const currentMonthLabel = computed(() => dayjs().format('MMMM YYYY'))
const periodStart = computed(() => dayjs().startOf('month'))
const periodEnd = computed(() => dayjs().endOf('month'))

const periodIncome = computed(() => {
  const bi = balanceIndex.value
  const al = accountsList.value
  if (!bi || !al) return 0

  let income = 0
  for (const [path, account] of al.accounts) {
    if (account.accountType === 'revenue') {
      income += bi.getTotalForPeriod({
        startDate: periodStart.value,
        endDate: periodEnd.value,
        accountPath: path,
        direction: 'from',
      })
    }
  }
  return income
})

const periodExpenses = computed(() => {
  const bi = balanceIndex.value
  const al = accountsList.value
  if (!bi || !al) return 0

  let expenses = 0
  for (const [path, account] of al.accounts) {
    if (account.accountType === 'expense') {
      expenses += bi.getTotalForPeriod({
        startDate: periodStart.value,
        endDate: periodEnd.value,
        accountPath: path,
        direction: 'to',
      })
    }
  }
  return expenses
})

const periodSavings = computed(() => periodIncome.value - periodExpenses.value)

// --- Recent Transactions ---

interface TransactionRow {
  path: string
  title: string
  amount: number
  currency: string
  from: string
  to: string
  date: string
  sortDate: string
}

const sortedTransactions = computed<TransactionRow[]>(() => {
  const tl = transactionsList.value
  if (!tl) return []

  const rows: TransactionRow[] = []
  for (const [path, tx] of tl.transactions) {
    if (!tx.loaded || !tx.date) continue
    rows.push({
      path,
      title: tx.title || tx.transactionName || 'Transaction',
      amount: tx.amount ?? 0,
      currency: tx.currency || '',
      from: tx.from ? extractAliasOrNameFromWikilink(tx.from) || tx.from : '',
      to: tx.to ? extractAliasOrNameFromWikilink(tx.to) || tx.to : '',
      date: tx.date.format(DISPLAY_DATE_FORMAT),
      sortDate: tx.date.format('YYYY-MM-DD'),
    })
  }

  return rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate))
})

const visibleTransactions = computed(() => sortedTransactions.value.slice(0, visibleCount.value))
const hasMore = computed(() => sortedTransactions.value.length > visibleCount.value)

function loadMore() {
  visibleCount.value += PAGE_SIZE
}

// --- Navigation ---

function openNote(path: string) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    app.workspace.getLeaf(false).openFile(file)
  }
}

function openBaseFile(path: string) {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    app.workspace.getLeaf(false).openFile(file)
  } else {
    new Notice(`File not found: ${path}`)
  }
}

// --- Formatting ---

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtShort(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toFixed(0)
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

.abele-finance-sidebar__card-body {
  flex: 1;
  min-width: 0;
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

.abele-finance-sidebar__card-chart {
  width: 100%;
  height: 64px;
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

// --- Transactions ---

.abele-finance-sidebar__transactions {
  display: flex;
  flex-direction: column;
}

.abele-finance-sidebar__transaction-row {
  padding: var(--size-4-1) 0;
  cursor: pointer;
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-finance-sidebar__transaction-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-ui-small);
}

.abele-finance-sidebar__transaction-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.abele-finance-sidebar__transaction-amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-left: var(--size-4-2);
}

.abele-finance-sidebar__transaction-meta {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  margin-top: 2px;
}

.abele-finance-sidebar__load-more {
  margin-top: var(--size-4-2);
  padding: var(--size-4-1);
  border: 1px dashed var(--background-modifier-border);
  border-radius: var(--radius-s);
  background: none;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  cursor: pointer;
  text-align: center;

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}

// --- Links ---

.abele-finance-sidebar__links {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-finance-sidebar__link {
  font-size: var(--font-ui-small);
  color: var(--text-accent);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

// --- Empty ---

.abele-finance-sidebar__empty {
  font-size: var(--font-ui-small);
  color: var(--text-faint);
  font-style: italic;
}
</style>
