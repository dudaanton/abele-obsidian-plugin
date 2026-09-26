<template>
  <div class="abele-timeline">
    <div class="abele-timeline__header">
      <div class="abele-timeline__header-left">
        <div class="abele-timeline__header-text">{{ title ?? 'Timeline' }}</div>
        <ObsidianIcon v-if="showAddButton" icon="calendar-plus" @click="openTaskForm()" />
      </div>
      <div class="abele-timeline__header-right">
        <ObsidianIcon
          class="abele-timeline__search-toggle"
          icon="search"
          :active="search.open.value"
          :tooltip="
            search.open.value ? 'Close the search' : 'Search tasks by title and description'
          "
          @click="search.toggle"
        />
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
          :text-right="hideCompleted ? 'Show completed' : 'Hide completed'"
          @click="hideCompleted = !hideCompleted"
        />
      </div>
    </div>
    <ObsidianSearch
      v-if="search.open.value"
      v-model="search.query.value"
      class="abele-timeline__search"
      placeholder="Search tasks…"
      autofocus
      @keydown.escape.stop.prevent="search.close"
    />
    <div ref="itemsEl" class="abele-timeline__blocks">
      <div v-for="[date, dateItems] in visible" :key="date" class="abele-timeline__date-block">
        <div
          class="abele-timeline__date-indicator"
          :class="{ 'abele-timeline__date-indicator_overdue': dayjs(date).isBefore(now, 'day') }"
        >
          <div class="abele-timeline__date-icon abele-timeline__date-icon_overdue">
            <ObsidianIcon icon="flame" no-hover />
          </div>
          <div class="abele-timeline__date-icon abele-timeline__date-icon_upcoming">
            <ObsidianIcon icon="calendar" no-hover />
          </div>
          <div class="abele-timeline__date-line" />
        </div>
        <div class="abele-timeline__block-content">
          <ObsidianMarkdown class="timeline__date" :text="getDateWikilink(date)" />
          <div class="abele-timeline__tasks">
            <template v-for="item in dateItems" :key="item.key">
              <CalendarEventView
                v-if="item.shown"
                :event="item.shown.event"
                :feed="item.shown.feed"
                :day="date"
              />
              <TaskView v-else class="abele-timeline__task" :task="item.task!" at-timeline />
            </template>
          </div>
        </div>
      </div>
    </div>
    <div v-if="hasMore" ref="sentinel" class="abele-timeline__sentinel" />
    <div v-if="!dates.length" class="abele-timeline__no-tasks">
      {{ search.terms.value.length ? 'Nothing matches the search.' : 'No tasks to show.' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { Task } from '@/entities/Task'
import TaskView from './Task.vue'
import CalendarEventView from './CalendarEvent.vue'
import type { ShownEvent } from '@/calendars/CalendarService'
import { matchesTerms } from '@/helpers/listSearch'
import { computed, ref, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import ObsidianSearch from './obsidian/Search.vue'
import dayjs from 'dayjs'
import { DATE_FORMAT, DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { useDate } from '@/composables/useDate'
import { usePagedList } from '@/composables/usePagedList'
import { openTaskForm } from '@/commands/taskForm'
import { useLabelFilter } from '@/composables/useLabelFilter'
import { taskSearch, useListSearch } from '@/composables/useListSearch'
import { useSearchHighlight } from '@/composables/useSearchHighlight'

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

const { now } = useDate()

const hideCompleted = ref(true)

const shownTasks = computed(() =>
  hideCompleted.value
    ? props.tasks.filter((t) => !t.completedAt && !t.taskNotFound)
    : props.tasks.filter((t) => !t.taskNotFound)
)

const {
  options: labelOptions,
  filtered,
  selectedText: labelText,
  selected: labelSelection,
  openMenu: openLabelMenu,
} = useLabelFilter(() => shownTasks.value)

const search = useListSearch(() => filtered.value, taskSearch)

const itemsEl = ref<HTMLElement | null>(null)
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
      // A task with no time sorts to the end of its day, as it always has.
      itemsOf(date).push({ key: `task:${task.id}`, at: task.getSortTimestamp() * 1000, task })
    }
  }

  if (props.events && labelSelection.value.kind === 'all') {
    const words = search.terms.value
    for (const [date, shown] of props.events) {
      for (const item of shown) {
        const { event } = item
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

const { visible, hasMore, sentinel, reset } = usePagedList(() => dates.value, PAGE_SIZE)

// Completed tasks reappear throughout the timeline, not at its end, so the previously
// expanded window no longer matches what the reader has actually scrolled through.
watch(hideCompleted, reset)
watch(labelSelection, reset)
watch(search.terms, reset)

const getDateWikilink = (dateStr: string) => {
  const date = dayjs(dateStr, DATE_FORMAT)
  const diff = date.startOf('day').diff(now.value.startOf('day'), 'day')

  let suffix = ''
  if (diff === 0) suffix = '(Today)'
  if (diff === 1) suffix = '(Tomorrow)'
  if (diff === -1) suffix = '(Yesterday)'
  if (diff > 1) suffix = `(${diff} days left)`
  if (diff < -1) suffix = `(${Math.abs(diff)} days ago)`

  const dateToShow = date.format(DISPLAY_DATE_FORMAT)
  // TODO: handle user defined daily note format and location
  return `[[${dateStr}|${dateToShow} ${suffix}]]`
}
</script>

<style lang="scss">
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

.timeline__date {
  margin-left: calc(var(--checkbox-margin-inline-start) - 0.25em);
  margin-top: calc(var(--icon-size) / 4 + (var(--icon-size) - var(--font-text-size)) / 2);
  margin-bottom: calc(var(--p-spacing) / 2);
  .internal-link {
    color: var(--text-faint);
    font-size: var(--font-small);
  }
}

.abele-timeline__date-block {
  display: flex;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-timeline__date-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-2-2);

  &_overdue {
    .abele-timeline__date-icon {
      background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
      .abele-obsidian-icon {
        color: var(--background-primary);
      }
      &_upcoming {
        display: none;
      }
      &_overdue {
        display: flex;
      }
    }
    .abele-timeline__date-line {
      background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
    }
  }

  &:not(.abele-timeline__date-indicator_overdue) {
    .abele-timeline__date-icon {
      &_overdue {
        display: none;
      }
    }
    .abele-timeline__date-line {
      background-color: var(--background-secondary);
    }
  }
}

.abele-timeline__date-icon {
  width: calc(var(--icon-size) * 1.7);
  height: calc(var(--icon-size) * 1.7);
  border-radius: 50%;
  background-color: var(--background-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  .abele-obsidian-icon {
    color: var(--text-faint);
  }
}

.abele-timeline__date-line {
  width: 2px;
  height: 100%;
  border-radius: 1px;
  margin-top: var(--size-2-2);
}

.abele-timeline__block-content {
  flex: 1;
}

.abele-timeline__tasks {
  margin-top: var(--size-2-2);
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  margin-bottom: calc(var(--p-spacing) / 2);
}

.abele-timeline__no-tasks {
  font-style: italic;
  color: var(--text-muted);
}

.abele-timeline__completed-toggle {
  font-size: var(--font-small);
}
</style>
