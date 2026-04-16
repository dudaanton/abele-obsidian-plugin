<template>
  <div class="abele-time-tracking-sidebar">
    <div class="abele-time-tracking-sidebar__header">
      <div class="abele-time-tracking-sidebar__header-left">
        <div class="abele-time-tracking-sidebar__header-text">Time Tracking</div>
        <ObsidianIcon icon="timer" @click="startEmptyTimer" />
      </div>
    </div>

    <!-- Active Timer -->
    <div v-if="activeEntry" class="abele-time-tracking-sidebar__active">
      <div class="abele-time-tracking-sidebar__active-header">
        <span class="abele-time-tracking-sidebar__active-label">Active Timer</span>
        <ObsidianIcon icon="timer-off" @click="stopTimer" />
      </div>
      <div class="abele-time-tracking-sidebar__active-groups">
        <ObsidianMarkdown
          v-for="(group, idx) in activeEntry.groups"
          :key="idx"
          :text="group"
          :file-path="activeEntry.entryPath"
          class="abele-time-tracking-sidebar__link"
        />
        <span v-if="!activeEntry.groups.length" class="abele-time-tracking-sidebar__no-groups">
          No groups
        </span>
      </div>
      <div class="abele-time-tracking-sidebar__active-elapsed">{{ activeElapsedText }}</div>
    </div>

    <!-- Period selector -->
    <div class="abele-time-tracking-sidebar__period-header">
      <ObsidianIcon icon="chevron-left" @click="previousMonth()" />
      <div class="abele-time-tracking-sidebar__period-title" @click="dateRangePickerOpen = true">
        {{ periodLabel }}
      </div>
      <ObsidianIcon icon="chevron-right" @click="nextMonth()" />
    </div>

    <DateRangePickerModal
      v-if="dateRangePickerOpen"
      :initial-from="periodStart"
      :initial-to="periodEnd"
      @apply="onDateRangeApply"
      @reset="onDateRangeReset"
      @cancel="dateRangePickerOpen = false"
    />

    <!-- Total time for period -->
    <div class="abele-time-tracking-sidebar__total">
      <span class="abele-time-tracking-sidebar__total-label">Total</span>
      <span class="abele-time-tracking-sidebar__total-value">{{ totalTimeText }}</span>
    </div>

    <!-- Charts -->
    <div class="abele-time-tracking-sidebar__chart-tabs">
      <div
        v-for="tab in chartTabs"
        :key="tab.key"
        class="abele-time-tracking-sidebar__chart-tab"
        :class="{ 'abele-time-tracking-sidebar__chart-tab--active': chartTab === tab.key }"
        @click="chartTab = tab.key"
      >
        {{ tab.label }}
      </div>
    </div>
    <template v-if="chartTab === 'daily'">
      <div
        v-if="dailyChartData.length"
        ref="dailyChartEl"
        class="abele-time-tracking-sidebar__chart"
      />
      <div v-else class="abele-time-tracking-sidebar__chart-empty">No data</div>
    </template>
    <template v-else-if="chartTab === 'groups'">
      <div
        v-if="groupsPieData.length"
        ref="groupsPieChartEl"
        class="abele-time-tracking-sidebar__chart"
      />
      <div v-else class="abele-time-tracking-sidebar__chart-empty">No data</div>
    </template>

    <!-- Entries list -->
    <section class="abele-time-tracking-sidebar__section">
      <h3 class="abele-time-tracking-sidebar__section-title">Entries</h3>
      <div v-if="visibleEntries.length" class="abele-time-tracking-sidebar__entries">
        <TimeEntryItem v-for="entry in visibleEntries" :key="entry.id" :entry="entry" />
        <div ref="scrollSentinel" class="abele-time-tracking-sidebar__sentinel" />
      </div>
      <div v-else class="abele-time-tracking-sidebar__empty">No entries found</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, unref, watch, nextTick, onUnmounted } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { GlobalStore } from '@/stores/GlobalStore'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { TimeEntry } from '@/entities/TimeEntry'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { DATE_FORMAT } from '@/constants/dates'
import { echartsInit, getThemeColors, EChartsType } from '@/bases/echarts'
import { extractAliasOrNameFromWikilink } from '@/helpers/pathsHelpers'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import DateRangePickerModal from './DateRangePickerModal.vue'
import TimeEntryItem from './TimeEntryItem.vue'
import dayjs from 'dayjs'

const PAGE_SIZE = 20
const visibleCount = ref(PAGE_SIZE)

const store = GlobalStore.getInstance()

const timeEntryList = computed(() => unref(store.timeEntryList) as TimeEntryList | null)

const activeEntry = computed(() => (timeEntryList.value?.activeEntry ?? null) as TimeEntry | null)

// Active timer elapsed
const activeElapsed = ref(0)
let activeInterval: ReturnType<typeof setInterval> | null = null

const updateActiveElapsed = () => {
  const active = activeEntry.value
  if (active?.start) {
    activeElapsed.value = dayjs().diff(active.start, 'second')
  } else {
    activeElapsed.value = 0
  }
}

watch(
  activeEntry,
  (entry) => {
    if (activeInterval) clearInterval(activeInterval)
    if (entry) {
      updateActiveElapsed()
      activeInterval = setInterval(updateActiveElapsed, 1000)
    } else {
      activeElapsed.value = 0
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  if (activeInterval) clearInterval(activeInterval)
  dailyChart?.dispose()
  dailyObserver?.disconnect()
  groupsPieChart?.dispose()
  groupsPieObserver?.disconnect()
})

const formatDurationLong = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

const formatDurationShort = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const activeElapsedText = computed(() => formatDurationLong(activeElapsed.value))

const stopTimer = () => stopActiveTimeEntry()

const startEmptyTimer = () => createTimeEntry(undefined, true)

// --- Period ---

const selectedMonth = ref(dayjs().month())
const selectedYear = ref(dayjs().year())
const customFrom = ref<dayjs.Dayjs | null>(null)
const customTo = ref<dayjs.Dayjs | null>(null)
const dateRangePickerOpen = ref(false)

const isCustomRange = computed(() => customFrom.value !== null && customTo.value !== null)

const periodLabel = computed(() => {
  if (isCustomRange.value) {
    const from = customFrom.value!.format('MMM D, YYYY')
    const to = customTo.value!.format('MMM D, YYYY')
    return `${from} — ${to}`
  }
  return dayjs().year(selectedYear.value).month(selectedMonth.value).format('MMMM YYYY')
})

const periodStart = computed(() =>
  isCustomRange.value
    ? customFrom.value!
    : dayjs().year(selectedYear.value).month(selectedMonth.value).startOf('month')
)
const periodEnd = computed(() =>
  isCustomRange.value
    ? customTo.value!
    : dayjs().year(selectedYear.value).month(selectedMonth.value).endOf('month')
)

function previousMonth() {
  customFrom.value = null
  customTo.value = null
  if (selectedMonth.value === 0) {
    selectedMonth.value = 11
    selectedYear.value -= 1
  } else {
    selectedMonth.value -= 1
  }
}

function nextMonth() {
  customFrom.value = null
  customTo.value = null
  if (selectedMonth.value === 11) {
    selectedMonth.value = 0
    selectedYear.value += 1
  } else {
    selectedMonth.value += 1
  }
}

function onDateRangeApply(range: { from: dayjs.Dayjs; to: dayjs.Dayjs }) {
  customFrom.value = range.from
  customTo.value = range.to
  dateRangePickerOpen.value = false
}

function onDateRangeReset() {
  customFrom.value = null
  customTo.value = null
  selectedMonth.value = dayjs().month()
  selectedYear.value = dayjs().year()
  dateRangePickerOpen.value = false
}

// --- Filtered entries ---

const periodEntries = computed(() => {
  const tl = timeEntryList.value
  if (!tl) return []

  const startStr = periodStart.value.format(DATE_FORMAT)
  const endStr = periodEnd.value.format(DATE_FORMAT)

  const entries: TimeEntry[] = []
  for (const entry of tl.entries.values()) {
    if (entry.entryNotFound || !entry.start) continue
    const dateStr = entry.start.format(DATE_FORMAT)
    if (dateStr >= startStr && dateStr <= endStr) {
      entries.push(entry)
    }
  }

  return entries.sort((a, b) => {
    const da = a.start ? a.start.valueOf() : 0
    const db = b.start ? b.start.valueOf() : 0
    return db - da
  })
})

const visibleEntries = computed(() => periodEntries.value.slice(0, visibleCount.value))

const scrollSentinel = ref<HTMLElement | null>(null)
useIntersectionObserver(scrollSentinel, ([entry]) => {
  if (entry?.isIntersecting && periodEntries.value.length > visibleCount.value) {
    visibleCount.value += PAGE_SIZE
  }
})

// --- Total time ---

const totalSeconds = computed(() => {
  let total = 0
  for (const entry of periodEntries.value) {
    total += entry.duration
  }
  return total
})

const totalTimeText = computed(() => {
  const hours = Math.floor(totalSeconds.value / 3600)
  const minutes = Math.floor((totalSeconds.value % 3600) / 60)
  return `${hours}h ${minutes}m`
})

// --- Charts ---

const chartTabs = [
  { key: 'daily', label: 'Daily' },
  { key: 'groups', label: 'By Groups' },
]
const chartTab = ref('daily')

// Daily bar chart
const dailyChartData = computed(() => {
  const byDay = new Map<string, number>()

  for (const entry of periodEntries.value) {
    if (!entry.start) continue
    const day = entry.start.format(DATE_FORMAT)
    byDay.set(day, (byDay.get(day) || 0) + entry.duration)
  }

  const result: { date: string; hours: number }[] = []
  const cursor = periodStart.value.startOf('day')
  const end = periodEnd.value.startOf('day')

  let d = cursor
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

const dailyChartEl = ref<HTMLElement | null>(null)
let dailyChart: EChartsType | null = null
let dailyObserver: ResizeObserver | null = null

function renderDailyChart() {
  if (!dailyChartEl.value || !dailyChartData.value.length) return
  if (dailyChart) dailyChart.dispose()

  const colors = getThemeColors()
  dailyChart = echartsInit(dailyChartEl.value)

  dailyChart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params
        return `${p.name}<br/>${formatDurationShort(Math.round(p.value * 3600))}`
      },
    },
    grid: { left: 40, right: 12, top: 8, bottom: 24 },
    xAxis: {
      type: 'category',
      data: dailyChartData.value.map((d) => dayjs(d.date).format('D')),
      axisLabel: { color: colors.textMuted },
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
        data: dailyChartData.value.map((d) => d.hours),
        itemStyle: { color: colors.accent, borderRadius: [2, 2, 0, 0] },
      },
    ],
  })

  if (dailyObserver) dailyObserver.disconnect()
  dailyObserver = new ResizeObserver(() => dailyChart?.resize())
  dailyObserver.observe(dailyChartEl.value)
}

watch([dailyChartEl, dailyChartData], () => nextTick(renderDailyChart))

// Groups pie chart
const groupsPieData = computed(() => {
  const byGroup = new Map<string, number>()

  for (const entry of periodEntries.value) {
    if (entry.groups.length === 0) {
      byGroup.set('No groups', (byGroup.get('No groups') || 0) + entry.duration)
    } else {
      for (const g of entry.groups) {
        const label = extractAliasOrNameFromWikilink(g)
        byGroup.set(label, (byGroup.get(label) || 0) + entry.duration)
      }
    }
  }

  return Array.from(byGroup.entries())
    .map(([name, secs]) => ({ name, value: Math.round((secs / 3600) * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
})

const groupsPieChartEl = ref<HTMLElement | null>(null)
let groupsPieChart: EChartsType | null = null
let groupsPieObserver: ResizeObserver | null = null

function renderGroupsPieChart() {
  if (!groupsPieChartEl.value || !groupsPieData.value.length) return
  if (groupsPieChart) groupsPieChart.dispose()

  const colors = getThemeColors()
  groupsPieChart = echartsInit(groupsPieChartEl.value)

  groupsPieChart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        return `${params.name}<br/>${formatDurationShort(Math.round(params.value * 3600))} (${params.percent}%)`
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        label: {
          color: colors.textNormal,
          formatter: '{b}: {d}%',
        },
        data: groupsPieData.value,
      },
    ],
  })

  if (groupsPieObserver) groupsPieObserver.disconnect()
  groupsPieObserver = new ResizeObserver(() => groupsPieChart?.resize())
  groupsPieObserver.observe(groupsPieChartEl.value)
}

watch([groupsPieChartEl, groupsPieData], () => nextTick(renderGroupsPieChart))

// Re-render charts on theme change
watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    dailyChart?.dispose()
    dailyChart = null
    groupsPieChart?.dispose()
    groupsPieChart = null
    nextTick(() => {
      renderDailyChart()
      renderGroupsPieChart()
    })
  }
)
</script>

<style lang="scss">
.abele-time-tracking-sidebar {
  padding: var(--size-4-4);
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-time-tracking-sidebar__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.abele-time-tracking-sidebar__header-left {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-time-tracking-sidebar__header-text {
  font-size: var(--font-ui-large);
  font-weight: var(--font-semibold);
}

.abele-time-tracking-sidebar__active {
  background: var(--background-secondary);
  border-radius: var(--radius-m);
  padding: var(--size-4-3);
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-time-tracking-sidebar__active-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.abele-time-tracking-sidebar__active-label {
  font-weight: var(--font-semibold);
  color: var(--text-success);
  font-size: var(--font-ui-small);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.abele-time-tracking-sidebar__active-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25em;

  p {
    margin: 0;
  }
}

.abele-time-tracking-sidebar__link {
  display: inline;

  p {
    display: inline;
  }

  .internal-link {
    color: var(--text-accent);
    cursor: pointer;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}

.abele-time-tracking-sidebar__no-groups {
  color: var(--text-muted);
  font-style: italic;
}

.abele-time-tracking-sidebar__active-elapsed {
  font-size: var(--h2-size);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--text-success);
}

.abele-time-tracking-sidebar__period-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.abele-time-tracking-sidebar__period-title {
  cursor: pointer;
  font-weight: var(--font-semibold);
  text-align: center;
  flex: 1;

  &:hover {
    color: var(--text-accent);
  }
}

.abele-time-tracking-sidebar__total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--size-4-2) 0;
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-time-tracking-sidebar__total-label {
  font-weight: var(--font-semibold);
}

.abele-time-tracking-sidebar__total-value {
  font-size: var(--font-ui-large);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
}

.abele-time-tracking-sidebar__chart-tabs {
  display: flex;
  gap: var(--size-4-1);
}

.abele-time-tracking-sidebar__chart-tab {
  padding: var(--size-4-1) var(--size-4-3);
  border-radius: var(--radius-s);
  cursor: pointer;
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  &--active {
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
  }
}

.abele-time-tracking-sidebar__chart {
  width: 100%;
  height: 200px;
}

.abele-time-tracking-sidebar__chart-empty {
  color: var(--text-muted);
  font-style: italic;
  padding: var(--size-4-2) 0;
}

.abele-time-tracking-sidebar__section {
  display: flex;
  flex-direction: column;
}

.abele-time-tracking-sidebar__section-title {
  margin: 0 0 var(--size-4-2) 0;
  font-size: var(--font-ui-medium);
}

.abele-time-tracking-sidebar__entries {
  display: flex;
  flex-direction: column;
}

.abele-time-tracking-sidebar__sentinel {
  height: 1px;
}

.abele-time-tracking-sidebar__empty {
  color: var(--text-muted);
  font-style: italic;
}
</style>
