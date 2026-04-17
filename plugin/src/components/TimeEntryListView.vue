<template>
  <div class="abele-time-entries-list">
    <div class="abele-time-entries-list__header">
      <div class="abele-time-entries-list__header-text">Time Entries</div>
      <div class="abele-time-entries-list__header-total">{{ totalText }}</div>
    </div>
    <PeriodSelector v-model:start="periodStart" v-model:end="periodEnd" />
    <div v-if="dailyChartData.length" ref="chartEl" class="abele-time-entries-list__chart" />
    <div v-if="visible.length" class="abele-time-entries-list__items">
      <template v-for="(entry, idx) in visible" :key="entry.id">
        <DateDivider v-if="showDateBefore(idx)" :date="entryDate(entry)">
          {{ dayDuration(entryDate(entry)) }}
        </DateDivider>
        <TimeEntryItem :entry="entry" />
      </template>
      <div ref="scrollSentinel" class="abele-time-entries-list__sentinel" />
    </div>
    <div v-if="!filtered.length" class="abele-time-entries-list__empty">No time entries.</div>
  </div>
</template>

<script setup lang="ts">
import { TimeEntry } from '@/entities/TimeEntry'
import { DATE_FORMAT } from '@/constants/dates'
import { echartsInit, getThemeColors, EChartsType } from '@/bases/echarts'
import { GlobalStore } from '@/stores/GlobalStore'
import TimeEntryItem from './TimeEntryItem.vue'
import DateDivider from './obsidian/DateDivider.vue'
import PeriodSelector from './obsidian/PeriodSelector.vue'
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import dayjs from 'dayjs'

const PAGE_SIZE = 20

const props = defineProps<{
  timeEntries: TimeEntry[]
}>()

const periodStart = ref<dayjs.Dayjs>(dayjs().startOf('month'))
const periodEnd = ref<dayjs.Dayjs>(dayjs().endOf('month'))

const filtered = computed(() => {
  const startStr = periodStart.value.format(DATE_FORMAT)
  const endStr = periodEnd.value.format(DATE_FORMAT)
  return props.timeEntries.filter((e) => {
    if (!e.start) return false
    const d = e.start.format(DATE_FORMAT)
    return d >= startStr && d <= endStr
  })
})

const sorted = computed(() => {
  return [...filtered.value].sort((a, b) => {
    const da = a.start ? a.start.valueOf() : 0
    const db = b.start ? b.start.valueOf() : 0
    return db - da
  })
})

const visibleCount = ref(PAGE_SIZE)
const visible = computed(() => sorted.value.slice(0, visibleCount.value))

const scrollSentinel = ref<HTMLElement | null>(null)
useIntersectionObserver(scrollSentinel, ([entry]) => {
  if (entry?.isIntersecting && sorted.value.length > visibleCount.value) {
    visibleCount.value += PAGE_SIZE
  }
})

watch(periodEnd, () => {
  visibleCount.value = PAGE_SIZE
})

const entryDate = (entry: TimeEntry): string => {
  return entry.start?.format(DATE_FORMAT) ?? ''
}

const showDateBefore = (idx: number): boolean => {
  if (idx === 0) return true
  return entryDate(visible.value[idx]) !== entryDate(visible.value[idx - 1])
}

const dayDuration = (date: string): string => {
  let total = 0
  for (const e of filtered.value) {
    if (e.start?.format(DATE_FORMAT) === date) total += e.duration
  }
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const totalText = computed(() => {
  let totalSeconds = 0
  for (const entry of filtered.value) {
    totalSeconds += entry.duration
  }
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
})

// --- Daily bar chart ---

const formatDurationShort = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const dailyChartData = computed(() => {
  const byDay = new Map<string, number>()

  for (const entry of filtered.value) {
    if (!entry.start) continue
    const day = entry.start.format(DATE_FORMAT)
    byDay.set(day, (byDay.get(day) || 0) + entry.duration)
  }

  const result: { date: string; hours: number }[] = []
  let d = periodStart.value.startOf('day')
  const end = periodEnd.value.startOf('day')

  while (d.isBefore(end) || d.isSame(end, 'day')) {
    const key = d.format(DATE_FORMAT)
    const secs = byDay.get(key) || 0
    if (secs > 0) {
      result.push({ date: key, hours: Math.round((secs / 3600) * 100) / 100 })
    }
    d = d.add(1, 'day')
  }

  return result
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

  const colors = getThemeColors()
  const data = dailyChartData.value

  if (!data.length) {
    chart.clear()
    return
  }

  chart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        enterable: false,
        confine: true,
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          return `${p.name}<br/>${formatDurationShort(Math.round(p.value * 3600))}`
        },
      },
      grid: { left: 40, right: 12, top: 8, bottom: 24 },
      xAxis: {
        type: 'category',
        data: data.map((d) => dayjs(d.date).format('MMM D')),
        axisLabel: {
          color: colors.textMuted,
          interval: Math.max(Math.floor(data.length / 6) - 1, 0),
        },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: colors.textMuted,
          formatter: (v: number) => `${v}h`,
        },
        splitLine: { lineStyle: { color: colors.border, type: 'dashed' } },
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.hours),
          itemStyle: { color: colors.accent, borderRadius: [2, 2, 0, 0] },
          emphasis: { disabled: true },
        },
      ],
    },
    true
  )
}

watch([dailyChartData, chartEl], () => nextTick(renderChart), { immediate: true })

watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    chart?.dispose()
    chart = null
    nextTick(renderChart)
  }
)

onUnmounted(() => {
  chart?.dispose()
  chartObserver?.disconnect()
})
</script>

<style lang="scss">
.abele-time-entries-list__header {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: var(--p-spacing);

  .abele-time-entries-list__header-text {
    font-weight: bold;
  }
}

.abele-time-entries-list__header-total {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  font-variant-numeric: tabular-nums;
}

.abele-time-entries-list__chart {
  width: 100%;
  height: 200px;
  margin-bottom: var(--size-4-2);
}

.abele-time-entries-list__items {
  display: flex;
  flex-direction: column;
}

.abele-time-entries-list__sentinel {
  height: 1px;
}

.abele-time-entries-list__empty {
  font-style: italic;
  color: var(--text-muted);
}
</style>
