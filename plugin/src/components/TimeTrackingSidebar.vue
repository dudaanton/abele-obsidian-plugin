<template>
  <div class="abele-time-tracking-sidebar">
    <div class="abele-time-tracking-sidebar__header">
      <div class="abele-time-tracking-sidebar__header-left">
        <div class="abele-time-tracking-sidebar__header-text">Time Tracking</div>
        <ObsidianIcon icon="timer" tooltip="Start empty timer" @click="startEmptyTimer" />
      </div>
    </div>

    <!-- Active Timers -->
    <div
      v-for="active in activeEntries"
      :key="active.id"
      class="abele-time-tracking-sidebar__active"
    >
      <div class="abele-time-tracking-sidebar__active-header">
        <span class="abele-time-tracking-sidebar__active-label">Active Timer</span>
        <ObsidianIcon icon="timer-off" tooltip="Stop timer" @click="stopSingle(active)" />
      </div>
      <div class="abele-time-tracking-sidebar__active-groups">
        <template v-for="(group, idx) in active.groups" :key="idx">
          <ObsidianMarkdown
            :text="ensureWikilinkAlias(group)"
            :file-path="active.entryPath"
            class="abele-time-tracking-sidebar__link"
          />
          <span v-if="idx < active.groups.length - 1">, </span>
        </template>
        <span v-if="!active.groups.length" class="abele-time-tracking-sidebar__no-groups">
          No groups
        </span>
      </div>
      <div class="abele-time-tracking-sidebar__active-elapsed">
        {{ formatDurationLong(activeElapsedMap[active.id] || 0) }}
      </div>
    </div>

    <!-- Period selector -->
    <PeriodSelector v-model:start="periodStart" v-model:end="periodEnd" />

    <!-- Total time for period -->
    <div class="abele-time-tracking-sidebar__summary">
      <div class="abele-time-tracking-sidebar__summary-row">
        <span class="abele-time-tracking-sidebar__summary-label">Total</span>
        <span class="abele-time-tracking-sidebar__summary-value">{{ totalTimeText }}</span>
      </div>
    </div>

    <!-- Charts -->
    <ChartTabs v-model="chartTab" :tabs="chartTabs" />
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
        <template v-for="(entry, idx) in visibleEntries" :key="entry.id">
          <DateDivider v-if="showDateBefore(idx)" :date="entryDate(entry)">
            {{ dayDuration(entryDate(entry)) }}
          </DateDivider>
          <TimeEntryItem :entry="entry" />
        </template>
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
import { TimeEntry, DATETIME_FORMAT } from '@/entities/TimeEntry'
import { createTimeEntry } from '@/commands/createTimeEntry'
import { TFile } from 'obsidian'
import { DATE_FORMAT } from '@/constants/dates'
import { echartsInit, getThemeColors, EChartsType } from '@/bases/echarts'
import {
  ensureWikilinkAlias,
  extractAliasOrNameFromWikilink,
  wikilinkToPath,
} from '@/helpers/pathsHelpers'
import { openFile } from '@/helpers/vaultUtils'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import ChartTabs from './obsidian/ChartTabs.vue'
import PeriodSelector from './obsidian/PeriodSelector.vue'
import DateDivider from './obsidian/DateDivider.vue'
import TimeEntryItem from './TimeEntryItem.vue'
import dayjs from 'dayjs'

type ChartTab = 'daily' | 'groups'

const PAGE_SIZE = 20
const visibleCount = ref(PAGE_SIZE)

const store = GlobalStore.getInstance()

const timeEntryList = computed(() => unref(store.timeEntryList) as TimeEntryList | null)

const activeEntries = computed(
  () => (timeEntryList.value?.activeEntries ?? []) as unknown as TimeEntry[]
)

// Active timers elapsed — one counter per active entry
const activeElapsedMap = ref<Record<string, number>>({})
let activeInterval: ReturnType<typeof setInterval> | null = null

const updateActiveElapsed = () => {
  const map: Record<string, number> = {}
  for (const entry of activeEntries.value) {
    if (entry.start) {
      map[entry.id] = dayjs().diff(entry.start, 'second')
    }
  }
  activeElapsedMap.value = map
}

watch(
  () => activeEntries.value.length,
  (count) => {
    if (activeInterval) clearInterval(activeInterval)
    if (count > 0) {
      updateActiveElapsed()
      activeInterval = setInterval(updateActiveElapsed, 1000)
    } else {
      activeElapsedMap.value = {}
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

const entryDate = (entry: TimeEntry): string => {
  return entry.start?.format(DATE_FORMAT) ?? ''
}

const showDateBefore = (idx: number): boolean => {
  if (idx === 0) return true
  return entryDate(visibleEntries.value[idx]) !== entryDate(visibleEntries.value[idx - 1])
}

const dayDuration = (date: string): string => {
  let total = 0
  for (const e of periodEntries.value) {
    if (e.start?.format(DATE_FORMAT) === date) total += e.duration
  }
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const stopSingle = async (entry: TimeEntry) => {
  const file = store.app.vault.getAbstractFileByPath(entry.entryPath)
  if (file instanceof TFile) {
    await store.app.fileManager.processFrontMatter(file, (fm) => {
      fm.end = dayjs().format(DATETIME_FORMAT)
    })
  }
}

const startEmptyTimer = () => createTimeEntry(undefined, true)

// --- Period ---

const periodStart = ref<dayjs.Dayjs>(dayjs().startOf('month'))
const periodEnd = ref<dayjs.Dayjs>(dayjs().endOf('month'))

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

watch(periodEnd, () => {
  visibleCount.value = PAGE_SIZE
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

const chartTabs: Array<{ key: ChartTab; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'groups', label: 'By Groups' },
]
const chartTab = ref<ChartTab>('daily')

// Daily bar chart
const dailyChartData = computed(() => {
  const byDay = new Map<string, number>()

  for (const entry of periodEntries.value) {
    if (!entry.start) continue
    const day = entry.start.format(DATE_FORMAT)
    byDay.set(day, (byDay.get(day) || 0) + entry.duration)
  }

  const result: [string, number][] = []
  const cursor = periodStart.value.startOf('day')
  const end = periodEnd.value.startOf('day')

  let d = cursor
  while (d.isBefore(end) || d.isSame(end, 'day')) {
    const key = d.format(DATE_FORMAT)
    const secs = byDay.get(key) || 0
    result.push([key, Math.round((secs / 3600) * 100) / 100])
    d = d.add(1, 'day')
  }

  return result
})

const dailyChartEl = ref<HTMLElement | null>(null)
let dailyChart: EChartsType | null = null
let dailyObserver: ResizeObserver | null = null

function renderDailyChart() {
  if (!dailyChartEl.value) {
    dailyChart?.dispose()
    dailyChart = null
    dailyObserver?.disconnect()
    dailyObserver = null
    return
  }

  if (!dailyChart || dailyChart.isDisposed()) {
    dailyChart = echartsInit(dailyChartEl.value)
    dailyObserver = new ResizeObserver(() => dailyChart?.resize())
    dailyObserver.observe(dailyChartEl.value)
  }

  const colors = getThemeColors()
  const data = dailyChartData.value

  if (!data.some(([, v]) => v > 0)) {
    dailyChart.clear()
    return
  }

  dailyChart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'axis',
        enterable: false,
        confine: true,
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          return `${dayjs(p.value[0]).format('MMM D')}<br/>${formatDurationShort(Math.round(p.value[1] * 3600))}`
        },
      },
      grid: { left: 40, right: 12, top: 8, bottom: 24 },
      xAxis: {
        type: 'time',
        min: periodStart.value.valueOf(),
        max: periodEnd.value.valueOf(),
        minInterval: 24 * 3600 * 1000,
        maxInterval: 7 * 24 * 3600 * 1000,
        axisLabel: {
          color: colors.textMuted,
          hideOverlap: true,
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
          data: data,
          itemStyle: { color: colors.accent, borderRadius: [2, 2, 0, 0] },
          emphasis: { disabled: true },
        },
      ],
    },
    true
  )
}

watch([dailyChartData, dailyChartEl], () => nextTick(renderDailyChart), { immediate: true })

// Groups pie chart
interface GroupPieItem {
  name: string
  value: number
  path?: string
}

const groupsPieData = computed<GroupPieItem[]>(() => {
  const { app } = store
  const byGroup = new Map<string, { seconds: number; path?: string }>()

  const resolveCache = new Map<string, string | null>()
  const resolve = (wikilink: string): string | null => {
    if (resolveCache.has(wikilink)) return resolveCache.get(wikilink)!
    const linkPath = wikilinkToPath(wikilink)
    const file = linkPath ? app.metadataCache.getFirstLinkpathDest(linkPath, '') : null
    const resolved = file ? file.path : null
    resolveCache.set(wikilink, resolved)
    return resolved
  }

  for (const entry of periodEntries.value) {
    if (entry.groups.length === 0) {
      const existing = byGroup.get('No groups') || { seconds: 0 }
      byGroup.set('No groups', { seconds: existing.seconds + entry.duration })
    } else {
      for (const g of entry.groups) {
        const label = extractAliasOrNameFromWikilink(g) || g
        const existing = byGroup.get(label) || { seconds: 0, path: resolve(g) ?? undefined }
        byGroup.set(label, { seconds: existing.seconds + entry.duration, path: existing.path })
      }
    }
  }

  return Array.from(byGroup.entries())
    .map(([name, { seconds, path }]) => ({
      name,
      value: Math.round((seconds / 3600) * 100) / 100,
      path,
    }))
    .sort((a, b) => b.value - a.value)
})

const groupsPieChartEl = ref<HTMLElement | null>(null)
let groupsPieChart: EChartsType | null = null
let groupsPieObserver: ResizeObserver | null = null

function renderGroupsPieChart() {
  if (!groupsPieChartEl.value) {
    groupsPieChart?.dispose()
    groupsPieChart = null
    groupsPieObserver?.disconnect()
    groupsPieObserver = null
    return
  }

  if (!groupsPieChart || groupsPieChart.isDisposed()) {
    groupsPieChart = echartsInit(groupsPieChartEl.value)
    groupsPieObserver = new ResizeObserver(() => groupsPieChart?.resize())
    groupsPieObserver.observe(groupsPieChartEl.value)
    groupsPieChart.on('click', (params: any) => {
      const item = groupsPieData.value[params.dataIndex]
      if (item?.path) {
        openFile(item.path)
      }
    })
  }

  const colors = getThemeColors()
  const data = groupsPieData.value

  if (!data.length) {
    groupsPieChart.clear()
    return
  }

  groupsPieChart.setOption(
    {
      animation: false,
      tooltip: {
        trigger: 'item',
        enterable: false,
        confine: true,
        formatter: (params: any) => {
          return `${params.name}<br/>${formatDurationShort(Math.round(params.value * 3600))} (${params.percent}%)`
        },
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

watch([groupsPieData, groupsPieChartEl], () => nextTick(renderGroupsPieChart), { immediate: true })

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
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--background-primary);

  padding: calc(var(--p-spacing) * 2);
  padding-top: calc(var(--size-4-2) * 2 + var(--icon-size));

  > * + * {
    margin-top: var(--size-4-3);
  }
}

@media (max-width: 600px) {
  .abele-time-tracking-sidebar {
    padding: calc(var(--size-4-4));
    padding-top: calc(var(--size-4-2) + var(--icon-size));
  }
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

.abele-time-tracking-sidebar__summary {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  padding: var(--size-4-2) 0;
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-time-tracking-sidebar__summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.abele-time-tracking-sidebar__summary-label {
  color: var(--text-muted);
}

.abele-time-tracking-sidebar__summary-value {
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-semibold);
}

.abele-time-tracking-sidebar__chart {
  width: 100%;
  height: 240px;
  margin-top: var(--size-4-2);
}

.abele-time-tracking-sidebar__chart-empty {
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-style: italic;
  margin-top: var(--size-4-2);
}

.abele-time-tracking-sidebar__section {
  display: flex;
  flex-direction: column;
  margin-top: calc(var(--p-spacing) * 1.5);
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
