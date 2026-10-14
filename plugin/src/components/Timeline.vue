<template>
  <div ref="clockEl" class="abele-timeline" data-abele-anchor="section:calendar">
    <!-- Pinned while the days scroll under it, so the search, the label filter and the completed
         switch are always at hand; its count is what the list shows now. -->
    <div ref="headerEl" class="abele-timeline__pinned">
      <ListSectionHeader
        class-prefix="abele-timeline"
        :text="title ?? 'Timeline'"
        :count="shownCount"
        :fold="fold"
        :search="search"
        search-tooltip="Search tasks by title and description"
        placeholder="Search tasks…"
        group-actions
      >
        <template #leading
          ><ObsidianIcon v-if="showAddButton" icon="calendar-plus" @click="createTask()"
        /></template>
        <template #actions>
          <ObsidianIcon
            v-if="labelOptions.length"
            class="abele-task-label-filter"
            icon="tag"
            :text-right="labelText || undefined"
            tooltip="Filter by label"
            @click="openLabelMenu"
          />
          <ObsidianIcon
            class="abele-timeline__completed-toggle"
            :icon="hideCompleted ? 'list-checks' : 'list-todo'"
            :active="!hideCompleted"
            role="switch"
            :aria-checked="!hideCompleted"
            :label="hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'"
            @click="hideCompleted = !hideCompleted"
          />
        </template>
      </ListSectionHeader>
    </div>
    <template v-if="!fold.collapsed.value">
      <div ref="itemsEl" class="abele-timeline__blocks">
        <template v-for="group in groups" :key="group.id">
          <!-- Above today there is one fold, what was left undone, said in red with the flame the
               overdue days carry. What was done in the past is no fold: the days with it stand
               above this row while the completed switch shows done tasks, and are gone while it
               hides them. -->
          <div
            v-if="group.id === 'overdue-row'"
            class="abele-timeline__fold abele-timeline__overdue"
            role="button"
            tabindex="0"
            :aria-label="overdueOpen ? 'Hide overdue tasks' : 'Show overdue tasks'"
            :aria-expanded="overdueOpen"
            @click="toggleOverdue"
            @keydown.enter.prevent="toggleOverdue"
            @keydown.space.prevent="toggleOverdue"
          >
            <ObsidianIcon class="abele-timeline__overdue-flame" icon="flame" no-hover />
            <span class="abele-timeline__fold-text">Overdue</span>
            <span
              class="abele-timeline__overdue-count"
              :aria-label="`${overdueCount} unfinished`"
              >{{ overdueCount }}</span
            >
            <ObsidianIcon
              class="abele-timeline__fold-glyph"
              :icon="overdueOpen ? 'chevron-down' : 'chevron-right'"
              no-hover
            />
          </div>
          <div
            v-for="[date, dateItems] in group.days"
            v-else
            :key="group.id + date"
            class="abele-timeline__date-block"
            :class="{ 'abele-timeline__drop-target': drag.targetDay.value === date }"
            :data-abele-anchor="'date:' + date"
            :data-timeline-group="group.id"
          >
            <div class="abele-timeline__block-content">
              <!-- The day as a quiet heading; overdue says so in red, with a flame. -->
              <div
                class="abele-timeline__date-indicator"
                :class="{
                  'abele-timeline__date-indicator_overdue': group.id === 'overdue',
                  'abele-timeline__date-indicator_today': dayjs(date).isSame(now, 'day'),
                }"
              >
                <ObsidianIcon
                  v-if="group.id === 'overdue'"
                  class="abele-timeline__date-icon"
                  icon="flame"
                  label="Overdue"
                  no-hover
                />
                <ObsidianMarkdown trusted class="timeline__date" :text="getDateWikilink(date)" />
              </div>
              <div class="abele-timeline__tasks">
                <template v-for="item in dateItems" :key="item.key">
                  <CalendarEventView
                    v-if="item.shown"
                    :event="item.shown.event"
                    :feed="item.shown.feed"
                    :day="date"
                    :data-timeline-item="item.key"
                  />
                  <TaskView
                    v-else
                    class="abele-timeline__task"
                    :task="item.task!"
                    :data-timeline-item="item.key"
                    at-timeline
                  />
                </template>
              </div>
            </div>
          </div>
        </template>
      </div>
      <div ref="anchorSpaceEl" class="abele-timeline__anchor-space" aria-hidden="true" />
      <div v-if="hasMore" ref="sentinel" class="abele-timeline__sentinel" />
      <div v-if="!dates.length" class="abele-timeline__no-tasks">
        {{ search.terms.value.length ? 'Nothing matches the search.' : 'No tasks to show.' }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Task } from '@/entities/Task'
import TaskView from './Task.vue'
import CalendarEventView from './CalendarEvent.vue'
import { calendars, type ShownEvent } from '@/calendars/CalendarService'
import { matchesTerms } from '@/helpers/listSearch'
import { ref, watch } from 'vue'
import { panelComputed as computed } from '@/composables/usePanelComputed'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import { useOwnerVisibility } from '@/composables/useOwnerVisibility'
import { useDate } from '@/composables/useDate'
import { useTimelineDays } from '@/composables/useTimelineDays'
import { useTimelineScroll } from '@/composables/useTimelineScroll'
import { useTimelineDrag } from '@/composables/useTimelineDrag'
import { useFooterTimeline } from '@/composables/useFooterView'
import { createTask } from '@/commands/createTask'
import { useLabelFilter } from '@/composables/useLabelFilter'
import { taskSearch, useListSearch } from '@/composables/useListSearch'
import { useSearchHighlight } from '@/composables/useSearchHighlight'
import { useFooterFold } from '@/composables/useFooterFold'

/**
 * Pages by date block rather than by task: a task that spans several days is deliberately
 * repeated in every day of its range, so slicing the flat task list would tear a day in half.
 */
const PAGE_SIZE = 20

const props = defineProps<{
  showAddButton?: boolean
  tasks: Task[]
  title?: string
  /**
   * Events of the external calendars, by day, to show among the tasks. Read only; left out
   * while the list is narrowed to a label, since an event has none.
   */
  events?: Map<string, ShownEvent[]>
}>()

const clockEl = ref<HTMLElement>()
const clockVisible = useOwnerVisibility(clockEl)
const { now } = useDate(clockVisible, () => clockEl.value?.ownerDocument ?? document)

const fold = useFooterFold('calendar')

const hideCompleted = ref(true)
const itemsEl = ref<HTMLElement | null>(null)
const drag = useTimelineDrag(
  itemsEl,
  () => props.tasks,
  () => scroll.captureDragLayout()
)

// Completed tasks follow the switch everywhere, past days included: hidden, they are nowhere.
const shownTasks = computed(() => props.tasks.filter((task) => !task.taskNotFound))
const {
  options: labelOptions,
  filtered,
  selectedText: labelText,
  selected: labelSelection,
  openMenu: openLabelMenu,
} = useLabelFilter(() => shownTasks.value)

const search = useListSearch(() => filtered.value, taskSearch)

useSearchHighlight(itemsEl, search.terms)

/** One row of a day: a task, or an event of an external calendar. */
interface DayItem {
  key: string
  /** Milliseconds, for the order within the day. */
  at: number
  task?: Task
  shown?: ShownEvent
}

const dates = computed(() => {
  // A folded footer must not build the date ranges, even as tasks arrive in separate batches.
  if (fold.collapsed.value) return []
  const datesSet = new Map<string, DayItem[]>()
  const itemsOf = (date: string) => {
    let items = datesSet.get(date)
    if (!items) datesSet.set(date, (items = []))
    return items
  }

  for (const task of search.results.value) {
    for (const date of task.dates) {
      if (task.completedAt && hideCompleted.value) continue
      // A task with no time sorts to the end of its day, as it always has.
      itemsOf(date).push({ key: `task:${task.id}`, at: task.getSortTimestamp() * 1000, task })
    }
  }

  if (props.events && labelSelection.value.kind === 'all') {
    const words = search.terms.value
    for (const [date, shown] of props.events) {
      for (const item of shown) {
        const { event } = item
        if (hideCompleted.value && calendars().isDone(event)) continue
        if (words.length && !matchesTerms(`${event.title} ${event.location}`.toLowerCase(), words))
          continue
        // A day-long event heads its day; a timed one that began earlier is there from its start.
        const at = event.allDay ? 0 : Math.max(event.start, dayjs(date).valueOf())
        itemsOf(date).push({ key: `event:${event.id}`, at, shown: item })
      }
    }
  }

  for (const [, items] of datesSet) items.sort((a, b) => a.at - b.at)

  return Array.from(datesSet.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))
})

const today = () => now.value.format(DATE_FORMAT)
const unfinished = (item: DayItem) => !!item.task && !item.task.completedAt
/**
 * Past days with what was done in them and their events, in the list only while the completed
 * switch shows done tasks: hiding them leaves nothing of the past but the overdue fold.
 */
const history = computed(() =>
  dates.value
    .filter(([day]) => !hideCompleted.value && day < today())
    .map(([day, items]) => [day, items.filter((item) => !unfinished(item))] as [string, DayItem[]])
    .filter(([, items]) => items.length)
)
/** Past days with only what was left undone in them: the overdue fold. */
const overdue = computed(() =>
  dates.value
    .filter(([day]) => day < today())
    .map(([day, items]) => [day, items.filter(unfinished)] as [string, DayItem[]])
    .filter(([, items]) => items.length)
)
const forward = computed(() => dates.value.filter(([day]) => day >= today()))
const memory = useFooterTimeline()
// Remembered like the past days, so a saved place on an overdue row can be drawn again.
const overdueOpen = ref(memory.overdueOpen ?? false)
const toggleOverdue = () => {
  overdueOpen.value = !overdueOpen.value
  memory.recordOverdue?.(overdueOpen.value)
}

const {
  visible: pagedVisible,
  hasMore,
  sentinel,
  reset,
} = useTimelineDays(
  // Searching finds a task in any day; otherwise the past is its done days, while they are shown.
  () => (search.terms.value.length ? dates.value : [...history.value, ...forward.value]),
  () => now.value.format(DATE_FORMAT),
  () => search.terms.value,
  PAGE_SIZE,
  memory,
  () => !fold.collapsed.value,
  () => !hideCompleted.value
)
// Gesture dates never change pagination/history memory. Only this rendered window expands.
const visible = computed(() => {
  const range = drag.range.value
  const landed = drag.landing.value
  if (!range && !landed) return pagedVisible.value
  const window = new Map(pagedVisible.value)
  if (range) {
    const all = new Map(dates.value)
    for (
      let day = dayjs(range.first);
      day.format(DATE_FORMAT) <= range.last;
      day = day.add(1, 'day')
    ) {
      const date = day.format(DATE_FORMAT)
      window.set(date, all.get(date) ?? [])
    }
  } else if (landed && !window.get(landed.day)?.some((item) => item.key === landed.key)) {
    // A drop into hidden history or beyond the current page must still leave its card
    // visible. Retain that one row, not the temporary month or other hidden tasks.
    const task = props.tasks.find((task) => `task:${task.id}` === landed.key && !task.taskNotFound)
    if (task && task.dates.includes(landed.day))
      window.set(landed.day, [
        ...(window.get(landed.day) ?? []),
        { key: landed.key, at: task.getSortTimestamp() * 1000, task },
      ])
  }
  return [...window].sort(([a], [b]) => a.localeCompare(b))
})
/** What the list draws, fold by fold, in the order it draws them. */
const groups = computed(() => {
  if (search.terms.value.length) return [{ id: 'found', days: visible.value }]
  const list: { id: string; days: [string, DayItem[]][] }[] = [
    { id: 'history', days: visible.value.filter(([day]) => day < today()) },
  ]
  if (overdue.value.length) {
    list.push({ id: 'overdue-row', days: [] })
    if (overdueOpen.value) list.push({ id: 'overdue', days: overdue.value })
  }
  list.push({ id: 'days', days: visible.value.filter(([day]) => day >= today()) })
  return list
})
const tasksIn = (days: readonly [string, DayItem[]][]) => {
  const keys = new Set<string>()
  for (const [, items] of days) for (const item of items) if (item.task) keys.add(item.key)
  return keys
}
const overdueCount = computed(() => tasksIn(overdue.value).size)
/**
 * What is shown is what is counted: the days from today on, all of them, not only the page
 * drawn so far; what was left undone while Overdue is open; what was done in the past while the
 * switch shows done tasks. A task over several days counts once.
 */
const shownCount = computed(() => {
  // Folded, the heading still says how many are ahead, read off each task's last day rather than
  // the ranges a folded footer does not build.
  if (fold.collapsed.value)
    return filtered.value.filter((task) => {
      if (task.completedAt && hideCompleted.value) return false
      const last = task.due ?? task.date
      return !!last && last.format(DATE_FORMAT) >= today()
    }).length
  if (search.terms.value.length) return tasksIn(dates.value).size
  const keys = tasksIn(forward.value)
  for (const key of tasksIn(history.value)) keys.add(key)
  if (overdueOpen.value) for (const key of tasksIn(overdue.value)) keys.add(key)
  return keys.size
})
const headerEl = ref<HTMLElement | null>(null)
const anchorSpaceEl = ref<HTMLElement | null>(null)
// Every drawn row, the open overdue fold's included: opening or closing a fold above the reader is
// a layout change the scroll hold has to see, and an overdue row is as good an anchor as any.
const retainedRows = computed(
  () =>
    new Set(
      groups.value.flatMap(({ days }) =>
        days.flatMap(([date, items]) => items.map((item) => 'date:' + date + ':' + item.key))
      )
    )
)
const scroll = useTimelineScroll(
  itemsEl,
  headerEl,
  anchorSpaceEl,
  () => groups.value,
  (key, day) => retainedRows.value.has(day + ':' + key),
  () => drag.anchor.value,
  () => !!drag.range.value
)
watch(labelSelection, () => {
  // A label folds the overdue fold away again; the completed switch is left as it was.
  reset()
  if (overdueOpen.value) toggleOverdue()
})
watch([labelSelection, hideCompleted, search.terms, overdueOpen], () => {
  drag.landing.value = null
})

const getDateWikilink = (dateStr: string) => {
  const date = dayjs(dateStr, DATE_FORMAT)
  const diff = date.startOf('day').diff(now.value.startOf('day'), 'day')

  const near = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ''
  const short = date.format(date.isSame(now.value, 'year') ? 'ddd DD.MM' : 'ddd DD.MM.YYYY')
  // TODO: handle user defined daily note format and location
  return `[[${dateStr}|${near ? `${near} · ${short}` : short}]]`
}
</script>

<style lang="scss">
.abele-timeline__drag-card {
  position: fixed;
  z-index: var(--layer-popover);
  pointer-events: none;
  background: var(--background-primary);
  box-shadow: var(--shadow-s);
}

.abele-timeline__drag-source {
  opacity: 0;
}

.abele-timeline__dragging {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.abele-timeline__drop-target {
  border-radius: var(--radius-s);
  outline: 1px solid var(--interactive-accent);
  background: var(--background-modifier-hover);
}

// Only while a layout patch is anchored; native input removes this class immediately.
.abele-timeline__scroll-hold {
  overflow-anchor: none !important;
}

.abele-timeline {
  // What the pinned header stands on, so the days passing under it do not show through: a note,
  // or the side panel, which lays the same ground under its lists.
  --abele-timeline-ground: var(--background-primary);
}

// The header with its search and switches stays at the top while the days scroll under it.
.abele-timeline__pinned {
  position: sticky;
  top: var(--abele-timeline-sticky-top, 0);
  z-index: 2;
  // Pinned, it keeps the header's own room above its words and part of the room below, both on
  // its own ground, so a row passing under it is cut off clear of the header rather than at it.
  padding-block: var(--size-4-3) var(--size-4-2);
  margin-bottom: var(--size-4-2);
  background-color: var(--abele-timeline-ground);

  > .abele-list-section-header {
    margin-block: 0;
  }
}

// A fold above today is a quiet row of the list's own: its own box, lit as a row is, and never
// over a task — it scrolls with the days rather than sticking above them.
.abele-timeline__fold {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-2) var(--size-2-3);
  margin-bottom: var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  &:focus-visible {
    box-shadow: var(--input-shadow);
  }

  .abele-obsidian-icon {
    height: auto;
    padding: 0;
    color: var(--text-faint);
  }
}

.abele-timeline__overdue {
  color: var(--color-red);
  font-weight: var(--font-semibold);

  .abele-obsidian-icon {
    color: inherit;
  }
}

.abele-timeline__overdue-flame svg {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

// A glyph is drawn inside its box with a margin; a flame leading a line is pulled by that margin
// so its ink, not its box, starts on the edge the words under it start on.
.abele-timeline__overdue-flame,
.abele-timeline__date-icon {
  margin-inline-start: calc(var(--icon-xs) * -4 / 24);
}

.abele-timeline__overdue-count {
  font-variant-numeric: tabular-nums;
}

.abele-timeline__search {
  margin-bottom: var(--p-spacing);
}

.abele-timeline__sentinel {
  height: 1px;
}

.abele-timeline__header-right {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
  min-width: 0;
}

.abele-timeline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--p-spacing);

  .abele-timeline__header-text {
    font-weight: bold;
  }
}

// A phone's glyphs carry their own wide tap boxes; the gap on top of them pushed the third one
// onto a line of its own under the title.
.is-phone .abele-timeline__header-right {
  gap: 0;
}

.abele-timeline__header-left {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-timeline__date-block {
  // Days stand well apart, further than a heading from its rows.
  margin-bottom: var(--size-4-5);
}

// A day reads as a quiet heading over its rows, like a group in Obsidian's search results.
.abele-timeline__date-indicator {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  // In line with the words of the rows under it, which keep their inset for the light.
  padding-inline: var(--size-2-3);
  color: var(--text-muted);

  .internal-link {
    color: inherit;
    font-size: var(--font-ui-small);
    // Not bold, as every group heading: a bold line fought the rows' names for the eye.
    font-weight: var(--font-normal);
    text-decoration: none;
  }

  &_today {
    color: var(--text-normal);
  }

  // Overdue is a warning, said in Obsidian's red, not in the accent that means "selected".
  &_overdue {
    color: var(--color-red);
  }
}

.abele-timeline__date-icon {
  height: auto;
  padding: 0;
  color: inherit;

  svg {
    width: var(--icon-xs);
    height: var(--icon-xs);
  }
}

.abele-timeline__block-content {
  flex: 1;
  // Otherwise the column is as wide as the longest word under it — a link, an event's title
  // with no spaces — and pushes the whole list past the sidebar's edge.
  min-width: 0;
}

.abele-timeline__tasks {
  // A day's heading is as far from the words of its first row as the rows' words are apart.
  margin-top: var(--abele-entry-heading-gap);
  display: flex;
  flex-direction: column;
}

.abele-timeline__no-tasks {
  font-style: italic;
  color: var(--text-muted);
}

.abele-timeline__completed-toggle {
  font-size: var(--font-small);
}
</style>
