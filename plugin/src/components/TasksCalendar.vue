<template>
  <div class="abele-tasks-calendar">
    <!-- The month and the chosen day's tasks, laid out as the logs' month is. -->
    <div
      class="abele-tasks-calendar__grid"
      :class="{ 'abele-tasks-calendar__grid_year': view === 'year' }"
    >
      <Calendar
        class="abele-tasks-calendar__month"
        :selected-date="selected"
        :marks="marks"
        marks-of="tasks"
        :view="view"
        @view-changed="record"
        @date-selected="choose"
        @month-changed="turn"
      />
      <section class="abele-tasks-calendar__day" :aria-label="dayLabel">
        <div class="abele-tasks-calendar__day-title">{{ dayLabel }}</div>
        <div v-if="dayItems.length" class="abele-tasks-calendar__items">
          <template v-for="item in dayItems" :key="item.key">
            <CalendarEventView
              v-if="item.shown"
              :event="item.shown.event"
              :feed="item.shown.feed"
              :day="selectedKey"
            />
            <TaskView v-else :task="item.task!" at-timeline />
          </template>
        </div>
        <div v-else class="abele-tasks-calendar__none">
          {{
            emptyMonth
              ? t('area.nothingPlannedMonth', { month: areaDate(month, 'MMMM') })
              : t('area.nothingPlannedThisDay')
          }}
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { areaDate } from '@/helpers/areaDateFormat'
import { t } from '@/i18n'
/**
 * A note's calendar tasks as a month: under every day with a task a small box, ticked once every
 * task of the day is done and left open while one is not; a dot where only an event of the
 * calendars stands. The chosen day's tasks and events beside the month on a wide page, under it on
 * a narrow one. The same codes the logs' month uses (`helpers/tasksMonth.ts`).
 */
import { computed, shallowRef, watch } from 'vue'
import dayjs from '@/helpers/dateLibrary'
import Calendar from './Calendar.vue'
import { useFooterCalendarView } from '@/composables/useFooterView'
import TaskView from './Task.vue'
import CalendarEventView from './CalendarEvent.vue'
import { Task } from '@/entities/Task'
import type { ShownEvent } from '@/calendars/CalendarService'
import { DATE_FORMAT } from '@/constants/dates'
import { dayInMonth, monthDays, monthMarks, openingDay } from '@/helpers/tasksMonth'

const props = defineProps<{
  /** The tasks as the list would show them: filtered by label, done ones left out if hidden. */
  tasks: Task[]
  /** The events as the list would show them, or none while a label is chosen. */
  events?: Map<string, ShownEvent[]>
}>()

const days = computed(() =>
  monthDays(props.tasks, props.events, (day) => dayjs(day, DATE_FORMAT).valueOf())
)
const marks = computed(() => monthMarks(days.value))

const todayKey = () => dayjs().format(DATE_FORMAT)
const selected = shallowRef(dayjs(openingDay(days.value.keys(), todayKey()), DATE_FORMAT))
const month = shallowRef(selected.value.startOf('month'))
/** Until a day is chosen, the month follows the tasks as they arrive, in batches as they do. */
let chosen = false

watch(
  () => [...days.value.keys()].sort().join(),
  () => {
    if (chosen) return
    const opening = dayjs(openingDay(days.value.keys(), todayKey()), DATE_FORMAT)
    if (opening.isSame(selected.value, 'day')) return
    selected.value = opening
    month.value = opening.startOf('month')
  }
)

const choose = (day: dayjs.Dayjs) => {
  chosen = true
  selected.value = day
}

/** Turning the month moves the chosen day into it: its first planned day, else today or the 1st. */
const turn = (shown: dayjs.Dayjs) => {
  month.value = shown.startOf('month')
  const key = dayInMonth(
    days.value.keys(),
    shown.format('YYYY-MM'),
    selected.value.format(DATE_FORMAT),
    todayKey()
  )
  if (key === selected.value.format(DATE_FORMAT)) return
  chosen = true
  selected.value = dayjs(key, DATE_FORMAT)
}

const selectedKey = computed(() => selected.value.format(DATE_FORMAT))
const dayItems = computed(() => days.value.get(selectedKey.value) ?? [])
const emptyMonth = computed(
  () => ![...days.value.keys()].some((key) => key.startsWith(month.value.format('YYYY-MM')))
)
const dayLabel = computed(() => areaDate(selected.value, 'ddd D MMMM YYYY'))

/** The year takes the whole width; the chosen day stands under it. */
const { view, record } = useFooterCalendarView('tasks')
</script>

<style lang="scss">
.abele-tasks-calendar {
  container-type: inline-size;
}

.abele-tasks-calendar__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--size-4-4);
}

@container (min-width: 36em) {
  .abele-tasks-calendar__grid {
    grid-template-columns: minmax(0, 18em) minmax(0, 1fr);
    align-items: start;
  }
}

.abele-tasks-calendar__day {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

// The day as a quiet heading over its rows, as far from the first as the rows are apart.
.abele-tasks-calendar__day-title {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
}

.abele-tasks-calendar__items {
  margin-top: var(--abele-entry-heading-gap);
  display: flex;
  flex-direction: column;
}

.abele-tasks-calendar__none {
  margin-top: var(--p-spacing);
  color: var(--text-muted);
}

// The year is twelve months across the note: the chosen day goes under it.
.abele-tasks-calendar__grid.abele-tasks-calendar__grid_year {
  grid-template-columns: minmax(0, 1fr);
}
</style>
