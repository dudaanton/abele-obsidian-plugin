<template>
  <div class="abele-account-balance-chart">
    <div class="abele-account-balance-chart__header">
      <div class="abele-account-balance-chart__header-text">Balance</div>
    </div>
    <div class="abele-account-balance-chart__period">
      <ObsidianIcon icon="chevron-left" @click="previousMonth()" />
      <div class="abele-account-balance-chart__period-title" @click="goToCurrentMonth()">
        {{ periodLabel }}
      </div>
      <ObsidianIcon icon="chevron-right" @click="nextMonth()" />
    </div>
    <div ref="chartEl" class="abele-account-balance-chart__chart" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { echartsInit, EChartsType } from '@/bases/echarts'
import ObsidianIcon from './obsidian/Icon.vue'
import dayjs from 'dayjs'
import { toRaw, unref } from 'vue'

const props = defineProps<{
  accountPath: string
}>()

const store = GlobalStore.getInstance()

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

const chartData = computed(() => {
  const bi = toRaw(unref(store.balanceIndex)) as BalanceIndex | null
  if (!bi) return { dates: [] as string[], values: [] as number[] }

  const series = bi.getBalanceSeries(props.accountPath, periodStart.value, periodEnd.value)
  return {
    dates: series.map((s) => dayjs(s.date).format('MMM D')),
    values: series.map((s) => Math.round(s.balance * 100) / 100),
  }
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

  const { dates, values } = chartData.value

  if (!dates.length) {
    chart.clear()
    return
  }

  chart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) =>
          v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      },
      grid: {
        left: 12,
        right: 12,
        top: 12,
        bottom: 24,
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
      series: [
        {
          type: 'line',
          data: values,
          emphasis: { disabled: true },
        },
      ],
    },
    true
  )
}

watch([chartData, chartEl], () => nextTick(renderChart), { immediate: true })

onUnmounted(() => {
  chart?.dispose()
  chartObserver?.disconnect()
})
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

.abele-account-balance-chart__period {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--size-4-2);
}

.abele-account-balance-chart__period-title {
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

.abele-account-balance-chart__chart {
  width: 100%;
  max-width: 100%;
  height: 200px;

  canvas {
    max-width: 100% !important;
  }
}
</style>
