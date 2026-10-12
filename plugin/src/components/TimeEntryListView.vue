<template>
  <div class="abele-time-entries-list" data-abele-anchor="section:time">
    <ListSectionHeader
      class-prefix="abele-time-entries-list"
      text="Time Entries"
      :count="timeEntries.length"
      :fold="fold"
      actions-when-collapsed
    >
      <template #actions
        ><div class="abele-time-entries-list__header-total">{{ totalText }}</div></template
      >
    </ListSectionHeader>
    <template v-if="!fold.collapsed.value">
      <PeriodSelector v-model:start="periodStart" v-model:end="periodEnd" />
      <Chart
        v-if="dailyChartData.some((d) => d.hours > 0)"
        :source="dailyChartData"
        :render="renderChart"
        class="abele-time-entries-list__chart"
      />
      <div v-if="visible.length" class="abele-time-entries-list__items">
        <template v-for="(entry, idx) in visible" :key="entry.id">
          <!-- The day's total only when it adds something: one entry already says it. -->
          <DateDivider v-if="showDateBefore(idx)" :date="entryDate(entry)">
            <template v-if="entriesOn(entryDate(entry)) > 1">{{
              dayDuration(entryDate(entry))
            }}</template>
          </DateDivider>
          <TimeEntryItem :entry="entry" :data-abele-anchor="'time:' + entry.id" />
        </template>
        <div ref="scrollSentinel" class="abele-time-entries-list__sentinel" />
      </div>
      <EmptyState
        v-if="!filtered.length"
        class="abele-time-entries-list__empty"
        text="No time entries."
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { formatDuration } from '@/helpers/displayFormat'
import { escapeHtml } from '@/helpers/escapeHtml'
import { TimeEntry } from '@/entities/TimeEntry'
import { DATE_FORMAT } from '@/constants/dates'
import Chart from './obsidian/Chart.vue'
import EmptyState from './obsidian/EmptyState.vue'
import { getThemeColors, EChartsType } from '@/bases/echarts'
import TimeEntryItem from './TimeEntryItem.vue'
import DateDivider from './obsidian/DateDivider.vue'
import PeriodSelector from './obsidian/PeriodSelector.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import { useFooterFold } from '@/composables/useFooterFold'
import { useFooterPages } from '@/composables/useFooterView'
import { computed, ref, watch } from 'vue'
import { usePagedList } from '@/composables/usePagedList'
import dayjs from 'dayjs'

const PAGE_SIZE = 20

const props = defineProps<{
  timeEntries: TimeEntry[]
}>()

const fold = useFooterFold('time')

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
  return filtered.value
    .map((entry) => ({ entry, start: entry.start?.valueOf() ?? 0 }))
    .sort((a, b) => b.start - a.start)
    .map(({ entry }) => entry)
})

const {
  visible,
  sentinel: scrollSentinel,
  reset,
} = usePagedList(() => sorted.value, PAGE_SIZE, useFooterPages('time'))
watch(periodEnd, reset)

const entryDate = (entry: TimeEntry): string => {
  return entry.start?.format(DATE_FORMAT) ?? ''
}

const showDateBefore = (idx: number): boolean => {
  if (idx === 0) return true
  return entryDate(visible.value[idx]) !== entryDate(visible.value[idx - 1])
}

const durations = computed(() => {
  const byDay = new Map<string, number>()
  const countByDay = new Map<string, number>()
  let total = 0
  for (const entry of filtered.value) {
    const day = entryDate(entry)
    const seconds = entry.duration
    total += seconds
    byDay.set(day, (byDay.get(day) || 0) + seconds)
    countByDay.set(day, (countByDay.get(day) || 0) + 1)
  }
  return { byDay, countByDay, total }
})

const dayDuration = (date: string): string => formatDuration(durations.value.byDay.get(date) ?? 0)
const totalText = computed(() => formatDuration(durations.value.total))

/** How many of the listed entries fall on a day, from the same buckets as the totals. */
const entriesOn = (date: string) => durations.value.countByDay.get(date) ?? 0

// --- Daily bar chart ---

const dailyChartData = computed(() => {
  const { byDay } = durations.value

  const result: { date: string; hours: number }[] = []
  let d = periodStart.value.startOf('day')
  const end = periodEnd.value.startOf('day')

  while (d.isBefore(end) || d.isSame(end, 'day')) {
    const key = d.format(DATE_FORMAT)
    const secs = byDay.get(key) || 0
    // Every day of the period, the empty ones too: the month reads as a calendar, a gap is a
    // day off, and a single entry does not swell into a slab across the width.
    result.push({ date: key, hours: Math.round((secs / 3600) * 100) / 100 })
    d = d.add(1, 'day')
  }

  return result
})

function renderChart(chart: EChartsType) {
  const colors = getThemeColors(chart.getDom?.())
  const data = dailyChartData.value

  if (!data.some((d) => d.hours > 0)) {
    chart.clear()
    return
  }
  const today = dayjs().format(DATE_FORMAT)

  chart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        enterable: false,
        confine: true,
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          const day = data[p.dataIndex]?.date
          return `${escapeHtml(day ? dayjs(day).format('ddd D MMM') : p.name)}<br/>${formatDuration(Math.round(p.value * 3600))}`
        },
      },
      // A strip of the period's days: thin bars on a baseline, the hours only in the tooltip
      // and the total in the heading, the day numbers under a few of them.
      grid: { left: 0, right: 0, top: 4, bottom: 18, containLabel: false },
      xAxis: {
        type: 'category',
        data: data.map((d) => dayjs(d.date).format('D')),
        axisTick: { show: false },
        axisLabel: {
          color: colors.textMuted,
          interval: (i: number) => i % 7 === 0 || i === data.length - 1,
        },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'bar',
          barMaxWidth: 6,
          data: data.map((d) => ({
            value: d.hours,
            itemStyle: { color: colors.accent, opacity: d.date === today ? 1 : 0.7 },
          })),
          itemStyle: { borderRadius: [2, 2, 0, 0] },
          emphasis: { disabled: true },
        },
      ],
    },
    true
  )
}
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
  height: calc(var(--size-4-12) + var(--size-4-8));
  // Apart from the days under it by more than a day's heading is from its entries.
  margin-bottom: var(--size-4-8);
}

.abele-time-entries-list__items {
  display: flex;
  flex-direction: column;
}

.abele-time-entries-list__sentinel {
  height: 1px;
}
</style>
