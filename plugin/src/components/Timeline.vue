<template>
  <div ref="clockEl" class="abele-timeline" data-abele-anchor="section:calendar">
    <ListSectionHeader
      class-prefix="abele-timeline"
      :text="title ?? 'Timeline'"
      :count="shownTasks.length"
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
          role="switch"
          :aria-checked="!hideCompleted"
          :label="hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'"
          @click="hideCompleted = !hideCompleted"
        />
      </template>
    </ListSectionHeader>
    <template v-if="!fold.collapsed.value">
      <div
        v-if="past.length && !search.terms.value.length"
        ref="historyEl"
        class="abele-timeline__history"
        :class="{ 'abele-timeline__history_overdue': pastUnfinished > 0 }"
        role="button"
        tabindex="0"
        :aria-label="pastRevealed ? 'Hide all past days' : 'Show all past days'"
        :aria-expanded="pastRevealed"
        @click="togglePast"
        @keydown.enter.prevent="togglePast"
        @keydown.space.prevent="togglePast"
      >
        <!-- Left undone is said first and in red, with the flame the overdue days carry; with
             nothing left undone it is only the quiet way back to the days before. -->
        <ObsidianIcon
          v-if="pastUnfinished > 0"
          class="abele-timeline__history-flame"
          icon="flame"
          no-hover
        />
        <span class="abele-timeline__history-text">{{
          pastUnfinished > 0 ? 'Overdue' : 'Past days'
        }}</span>
        <span
          v-if="pastUnfinished > 0"
          class="abele-timeline__history-count"
          :aria-label="`${pastUnfinished} unfinished`"
          >{{ pastUnfinished }}</span
        >
        <!-- The fold at the end, so the row starts on the same edge as the days under it. -->
        <ObsidianIcon
          class="abele-timeline__history-glyph"
          :icon="pastRevealed ? 'chevron-down' : 'chevron-right'"
          no-hover
        />
      </div>
      <div ref="itemsEl" class="abele-timeline__blocks">
        <div
          v-for="[date, dateItems] in visible"
          :key="date"
          class="abele-timeline__date-block"
          :class="{ 'abele-timeline__drop-target': drag.targetDay.value === date }"
          :data-abele-anchor="'date:' + date"
        >
          <div class="abele-timeline__block-content">
            <!-- The day as a quiet heading; overdue says so in red, with a flame. -->
            <div
              class="abele-timeline__date-indicator"
              :class="{
                'abele-timeline__date-indicator_overdue':
                  dayjs(date).isBefore(now, 'day') && dateItems.some((item) => !!item.task),
                'abele-timeline__date-indicator_today': dayjs(date).isSame(now, 'day'),
              }"
            >
              <ObsidianIcon
                v-if="dayjs(date).isBefore(now, 'day') && dateItems.some((item) => !!item.task)"
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

const shownTasks = computed(() =>
  props.tasks.filter((task) => {
    if (task.taskNotFound) return false
    if (!hideCompleted.value || !task.completedAt) return true
    // Completed tasks remain in their past days, including while history is folded.
    return task.dates.some((day) => day < now.value.format(DATE_FORMAT))
  })
)

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
  const datesSet = new Map<string, DayItem[]>()
  const itemsOf = (date: string) => {
    let items = datesSet.get(date)
    if (!items) datesSet.set(date, (items = []))
    return items
  }

  for (const task of search.results.value) {
    for (const date of task.dates) {
      // The completed switch applies from today onward; history keeps the whole day.
      if (task.completedAt && hideCompleted.value && date >= now.value.format(DATE_FORMAT)) continue
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

const {
  visible: pagedVisible,
  past,
  pastRevealed,
  hasMore,
  sentinel,
  reset,
  togglePast,
} = useTimelineDays(
  () => dates.value,
  () => now.value.format(DATE_FORMAT),
  () => search.terms.value,
  PAGE_SIZE,
  useFooterTimeline(),
  () => !fold.collapsed.value
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
// Past events are history, not overdue work. Keep the existing indication for task days.
const pastUnfinished = computed(() => {
  const keys = new Set<string>()
  for (const [, items] of past.value)
    for (const item of items) if (item.task && !item.task.completedAt) keys.add(item.key)
  return keys.size
})
const historyEl = ref<HTMLElement | null>(null)
const anchorSpaceEl = ref<HTMLElement | null>(null)
const retainedRows = computed(
  () =>
    new Set(
      visible.value.flatMap(([date, items]) => items.map((item) => 'date:' + date + ':' + item.key))
    )
)
const scroll = useTimelineScroll(
  itemsEl,
  historyEl,
  anchorSpaceEl,
  () => visible.value,
  (key, day) => retainedRows.value.has(day + ':' + key),
  () => drag.anchor.value,
  () => !!drag.range.value
)
watch(labelSelection, reset)
watch([labelSelection, hideCompleted, search.terms, pastRevealed], () => {
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

.abele-timeline__history {
  position: sticky;
  top: var(--abele-timeline-sticky-top, 0);
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-2) var(--size-2-3);
  margin-bottom: var(--size-4-2);
  border-radius: var(--radius-s);
  // A quiet row like the list's own, not an accent banner: opaque, since it sticks over the days.
  background-color: var(--background-primary);
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

.abele-timeline__history_overdue {
  color: var(--color-red);
  font-weight: var(--font-semibold);

  .abele-obsidian-icon {
    color: inherit;
  }
}

.abele-timeline__history-flame svg {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

// A glyph is drawn inside its box with a margin; a flame leading a line is pulled by that margin
// so its ink, not its box, starts on the edge the words under it start on.
.abele-timeline__history-flame,
.abele-timeline__date-icon {
  margin-inline-start: calc(var(--icon-xs) * -4 / 24);
}

.abele-timeline__history-count {
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
  // A day's heading sits close over its own rows; the rows keep Obsidian's 2px between them.
  margin-top: var(--size-2-1);
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
