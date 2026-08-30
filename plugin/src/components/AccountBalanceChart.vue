<template>
  <div class="abele-account-balance-chart">
    <div class="abele-account-balance-chart__header">
      <div class="abele-account-balance-chart__header-text">
        {{ isExpenseRevenue ? 'Spending' : 'Balance' }}
      </div>
      <div
        v-if="isExpenseRevenue && monthTotals.length"
        class="abele-account-balance-chart__totals"
      >
        <span v-for="t in monthTotals" :key="t.currency">
          {{ t.formatted }}
          <span class="abele-account-balance-chart__currency">{{ t.currency }}</span>
        </span>
      </div>
    </div>
    <PeriodSelector v-model:start="periodStart" v-model:end="periodEnd" />
    <div ref="chartEl" class="abele-account-balance-chart__chart" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { AccountsList } from '@/entities/AccountsList'
import { TransactionsList } from '@/entities/TransactionsList'
import { echartsInit, EChartsType } from '@/bases/echarts'
import { wikilinkToPath } from '@/helpers/pathsHelpers'
import { DATE_FORMAT } from '@/constants/dates'
import PeriodSelector from './obsidian/PeriodSelector.vue'
import dayjs from 'dayjs'
import { toRaw, unref } from 'vue'
import { formatAmount } from '@/helpers/moneyFormat'

const props = defineProps<{
  accountPath: string
}>()

const emit = defineEmits<{
  (e: 'periodChange', start: dayjs.Dayjs, end: dayjs.Dayjs): void
}>()

const store = GlobalStore.getInstance()

const periodStart = ref<dayjs.Dayjs>(dayjs().startOf('month'))
const periodEnd = ref<dayjs.Dayjs>(dayjs().endOf('month'))

interface ChartSeries {
  name: string
  data: number[]
}

const isExpenseRevenue = computed(() => {
  const al = unref(store.accountsList) as AccountsList | null
  const account = al?.accounts.get(props.accountPath)
  const t = account?.accountType
  return t === 'expense' || t === 'revenue'
})

const isComputed = computed(() => {
  const al = unref(store.accountsList) as AccountsList | null
  const account = al?.accounts.get(props.accountPath)
  return account?.accountType === 'computed'
})

const chartData = computed(() => {
  const bi = toRaw(unref(store.balanceIndex)) as BalanceIndex | null
  const al = unref(store.accountsList) as AccountsList | null
  if (!bi || !al)
    return { dates: [] as string[], seriesList: [] as ChartSeries[], chartType: 'line' as const }
  bi.version.value // track reactivity

  const account = al.accounts.get(props.accountPath)
  const start = periodStart.value
  const end = periodEnd.value

  const dates: string[] = []
  let d = start
  while (d.isBefore(end) || d.isSame(end, 'day')) {
    dates.push(d.format('MMM D'))
    d = d.add(1, 'day')
  }

  const seriesList: ChartSeries[] = []

  if (isExpenseRevenue.value) {
    const tl = toRaw(unref(store.transactionsList)) as TransactionsList | null
    if (!tl) return { dates, seriesList, chartType: 'bar' as const }

    const startStr = start.format(DATE_FORMAT)
    const endStr = end.format(DATE_FORMAT)
    const { app } = store

    const dailyByCurrency = new Map<string, Map<string, number>>()

    for (const tx of tl.transactions.values()) {
      const raw = toRaw(tx)
      if (!raw.loaded || !raw.date || raw.amount == null || !raw.currency) continue

      const dateStr = raw.date.format(DATE_FORMAT)
      if (dateStr < startStr || dateStr > endStr) continue

      const fromPath = raw.from
        ? (() => {
            const lp = wikilinkToPath(raw.from!)
            return lp ? (app.metadataCache.getFirstLinkpathDest(lp, '')?.path ?? null) : null
          })()
        : null
      const toPath = raw.to
        ? (() => {
            const lp = wikilinkToPath(raw.to!)
            return lp ? (app.metadataCache.getFirstLinkpathDest(lp, '')?.path ?? null) : null
          })()
        : null

      if (fromPath !== props.accountPath && toPath !== props.accountPath) continue

      const cur = raw.currency
      if (!dailyByCurrency.has(cur)) dailyByCurrency.set(cur, new Map())
      const daily = dailyByCurrency.get(cur)!
      daily.set(dateStr, (daily.get(dateStr) || 0) + raw.amount)
    }

    for (const [cur, daily] of dailyByCurrency) {
      const data: number[] = []
      let dd = start
      for (let i = 0; i < dates.length; i++) {
        data.push(Math.round((daily.get(dd.format(DATE_FORMAT)) || 0) * 100) / 100)
        dd = dd.add(1, 'day')
      }
      seriesList.push({ name: cur, data })
    }

    return { dates, seriesList, chartType: 'bar' as const }
  }

  if (isComputed.value && account?.sourceAccounts.length) {
    const { app } = store
    const sourcePaths: string[] = []
    for (const wikilink of account.sourceAccounts) {
      const linkPath = wikilinkToPath(wikilink)
      if (!linkPath) continue
      const file = app.metadataCache.getFirstLinkpathDest(linkPath, '')
      if (file) sourcePaths.push(file.path)
    }

    if (sourcePaths.length) {
      const data: number[] = []
      let dd = start
      for (let i = 0; i < dates.length; i++) {
        let sum = 0
        for (const sp of sourcePaths) {
          sum += bi.getBalanceAtDate(sp, dd)
        }
        data.push(Math.round(sum * 100) / 100)
        dd = dd.add(1, 'day')
      }
      seriesList.push({ name: account.currency || '', data })
    }

    return { dates, seriesList, chartType: 'line' as const }
  }

  if (account?.currency) {
    const series = bi.getBalanceSeries(props.accountPath, start, end)
    seriesList.push({
      name: account.currency,
      data: series.map((s) => Math.round(s.balance * 100) / 100),
    })
  } else {
    const currencies = bi.getCurrenciesForAccount(props.accountPath)
    for (const cur of currencies) {
      const series = bi.getBalanceSeriesByCurrency(props.accountPath, start, end, cur)
      seriesList.push({
        name: cur,
        data: series.map((s) => Math.round(s.balance * 100) / 100),
      })
    }
  }

  return { dates, seriesList, chartType: 'line' as const }
})

const monthTotals = computed(() => {
  const { seriesList } = chartData.value
  const fmt = formatAmount

  return seriesList.map((s) => ({
    currency: s.name,
    formatted: fmt(s.data.reduce((a, b) => a + b, 0)),
  }))
})

const chartEl = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let chartObserver: ResizeObserver | null = null

function renderChart() {
  if (!chartEl.value) {
    chart?.dispose()
    chart = null
    chartObserver?.disconnect()
    chartObserver = null
    return
  }

  if (!chart || chart.isDisposed()) {
    chart = echartsInit(chartEl.value)
    chartObserver = new ResizeObserver(() => chart?.resize())
    chartObserver.observe(chartEl.value)
  }

  const { dates, seriesList, chartType } = chartData.value

  if (!dates.length || !seriesList.length) {
    chart.clear()
    return
  }

  const hasLegend = seriesList.length > 1
  const isBar = chartType === 'bar'

  chart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) => formatAmount(v),
      },
      legend: hasLegend
        ? { data: seriesList.map((s) => s.name), bottom: 0, type: 'scroll' }
        : undefined,
      grid: {
        left: 12,
        right: 12,
        top: 12,
        bottom: hasLegend ? 40 : 24,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: isBar,
        axisLabel: {
          interval: Math.max(Math.floor(dates.length / 6) - 1, 0),
          hideOverlap: true,
          ...(dates.length > 8 ? { rotate: 45 } : {}),
        },
      },
      yAxis: { type: 'value' },
      series: seriesList.map((s) => ({
        name: s.name,
        type: chartType,
        data: s.data,
        emphasis: { disabled: true },
        ...(isBar ? { stack: 'total' } : {}),
      })),
    },
    true
  )
}

watch([chartData, chartEl], () => nextTick(renderChart), { immediate: true })

watch(
  [periodStart, periodEnd],
  () => {
    emit('periodChange', periodStart.value, periodEnd.value)
  },
  { immediate: true }
)

onUnmounted(() => {
  chart?.dispose()
  chartObserver?.disconnect()
})

watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    chart?.dispose()
    chart = null
    nextTick(renderChart)
  }
)
</script>

<style lang="scss">
.abele-account-balance-chart__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: var(--p-spacing);

  .abele-account-balance-chart__header-text {
    font-weight: bold;
  }
}

.abele-account-balance-chart__totals {
  display: flex;
  gap: var(--size-4-3);
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.abele-account-balance-chart__currency {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

.abele-account-balance-chart__chart {
  width: 100%;
  max-width: 100%;
  height: 200px;

  canvas {
    max-width: 100% !important;
  }
}
</style>
