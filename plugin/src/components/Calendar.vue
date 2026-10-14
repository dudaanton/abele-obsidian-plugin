<template>
  <div ref="clockEl" class="abele-calendar" :class="{ 'abele-calendar_marks': marks }">
    <div class="abele-calendar__header">
      <div class="abele-calendar__header-month-year">
        {{ dayjs().month(selectedMonth).format('MMMM') }} {{ selectedYear }}
      </div>
      <div class="abele-calendar__header-controls">
        <ObsidianIcon icon="chevron-left" tooltip="Previous month" @click="previousMonth()" />
        <!-- In a note's log month the keyboard moves through the controls and the days alike. -->
        <ObsidianIcon
          v-if="marks"
          text-right="Today"
          tooltip="Select today"
          @click="todayClick()"
        />
        <div v-else class="abele-calendar__header-today" @click="todayClick()">Today</div>
        <ObsidianIcon icon="chevron-right" tooltip="Next month" @click="nextMonth()" />
      </div>
    </div>
    <div class="abele-calendar__body">
      <div class="abele-calendar__weekdays">
        <div v-for="day in weekdays" :key="day" class="abele-calendar__weekday">
          {{ day }}
        </div>
      </div>
      <div class="abele-calendar__days">
        <!-- A day of a note's log is a button named by its date and its mark, so it is reached
             and pressed from the keyboard and read out as what it shows. -->
        <component
          :is="marks ? 'button' : 'div'"
          v-for="day in days"
          :key="day.day.toString()"
          class="abele-calendar__day"
          :type="marks ? 'button' : undefined"
          :aria-label="marks ? dayLabel(day.day, day.formatedDate) : undefined"
          :aria-pressed="marks ? !!props.selectedDate?.isSame(day.day, 'day') : undefined"
          :class="{
            'clickable-icon': !!marks,
            'abele-calendar__day_today': day.day.isSame(today, 'day'),
            'abele-calendar__day_other-month': day.day.get('month') !== selectedMonth,
            'abele-calendar__day_selected': props.selectedDate
              ? day.day.isSame(props.selectedDate, 'day')
              : false,
          }"
          @click="onDayClick(day.day)"
          @contextmenu="onContextMenu(day.day, $event)"
          @touchstart="onTouchStart(day.day, $event)"
          @touchend="onTouchEnd"
          @touchmove="onTouchEnd"
        >
          <div class="abele-calendar__day-number">{{ day.dayNumber }}</div>
          <div v-if="journal || showTasks || marks" class="abele-calendar__day-marks">
            <!-- A log's day: a dot for an entry; for a log kept as a checkbox, a small box
                 filled and ticked in the accent like Obsidian's own, or left empty. -->
            <svg
              v-if="marks?.get(day.formatedDate) === 'entry'"
              class="abele-calendar__day-dot abele-calendar__day-log"
              viewBox="0 0 10 10"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle cx="5" cy="5" r="4" fill="currentColor" />
            </svg>
            <svg
              v-else-if="marks?.get(day.formatedDate) === 'done'"
              class="abele-calendar__day-dot abele-calendar__day-log abele-calendar__day-log_done"
              viewBox="0 0 10 10"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect x="0.5" y="0.5" width="9" height="9" rx="2" fill="currentColor" />
              <path
                d="M2.6 5.2 4.3 6.9 7.5 3.3"
                fill="none"
                stroke="var(--checkbox-marker-color)"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <svg
              v-else-if="marks?.get(day.formatedDate) === 'open'"
              class="abele-calendar__day-dot abele-calendar__day-log abele-calendar__day-log_open"
              viewBox="0 0 10 10"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect
                x="1"
                y="1"
                width="8"
                height="8"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
            <svg
              v-if="journal?.isJournalNoteCreated(day.day)"
              class="abele-calendar__day-dot"
              viewBox="0 0 10 10"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="5" cy="5" r="4" fill="currentColor" />
            </svg>
            <svg
              v-if="showTasks && tasksDateMap.get(day.formatedDate)?.length"
              class="abele-calendar__day-dot"
              viewBox="0 0 10 10"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
            <svg
              v-if="showTasks && eventColors.get(day.formatedDate)"
              class="abele-calendar__day-dot abele-calendar__day-event"
              :class="`abele-calendar__day-event_color-${eventColors.get(day.formatedDate)}`"
              viewBox="0 0 10 10"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="0" y="3" width="10" height="4" rx="2" fill="currentColor" />
            </svg>
            <svg
              v-if="
                showTasks &&
                (tasksDateMap.get(day.formatedDate)?.length || 0) >
                  AbeleConfig.getInstance().busyDayThreshold
              "
              class="abele-calendar__day-dot"
              viewBox="0 0 10 10"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </div>
        </component>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useOwnerVisibility } from '@/composables/useOwnerVisibility'
import { useDate } from '@/composables/useDate'
import dayjs from 'dayjs'
import { ref, unref, watch } from 'vue'
import { panelComputed as computed } from '@/composables/usePanelComputed'
import ObsidianIcon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DATE_FORMAT } from '@/constants/dates'
import { TasksList } from '@/entities/TasksList'
import { Task } from '@/entities/Task'
import { Journal } from '@/entities/Journal'
import { useCalendarDays } from '@/composables/useCalendarDays'
import type { KitColor } from '@/constants/colors'
import type { LogDayMark } from '@/logs/logDays'

const clockEl = ref<HTMLElement>()
const visible = useOwnerVisibility(clockEl)
const { now: today } = useDate(visible, () => clockEl.value?.ownerDocument ?? document)
const props = defineProps<{
  selectedDate?: dayjs.Dayjs
  journal?: Journal
  showTasks?: boolean
  /** A mark for each day by `YYYY-MM-DD`: the days a note's log was written on. */
  marks?: Map<string, LogDayMark>
}>()
/** What a log month's day says when read out: its date, and what its mark shows. */
const dayLabel = (date: dayjs.Dayjs, key: string): string => {
  const mark = props.marks?.get(key)
  const status =
    mark === 'done'
      ? 'Checked log'
      : mark === 'open'
        ? 'Unchecked log'
        : mark === 'entry'
          ? 'Log entry'
          : 'No log entries'
  return `${date.format('ddd D MMMM YYYY')}: ${status}`
}
const selectedMonth = ref(
  props.selectedDate ? props.selectedDate.get('month') : today.value.get('month')
)
const selectedYear = ref(
  props.selectedDate ? props.selectedDate.get('year') : today.value.get('year')
)

watch(
  () => props.selectedDate,
  () => {
    if (props.selectedDate) {
      selectedMonth.value = props.selectedDate.get('month')
      selectedYear.value = props.selectedDate.get('year')
    }
  }
)

const nextMonth = () => {
  if (selectedMonth.value === 11) {
    selectedMonth.value = 0
    selectedYear.value += 1
  } else {
    selectedMonth.value += 1
  }
}

const previousMonth = () => {
  if (selectedMonth.value === 0) {
    selectedMonth.value = 11
    selectedYear.value -= 1
  } else {
    selectedMonth.value -= 1
  }
}

const todayClick = () => {
  emit('date-selected', today.value)
}

let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressFired = false

const onDayClick = (date: dayjs.Dayjs) => {
  if (longPressFired) {
    longPressFired = false
    return
  }
  emit('date-selected', date)
}

const onTouchStart = (date: dayjs.Dayjs, event: TouchEvent) => {
  longPressFired = false
  longPressTimer = window.setTimeout(() => {
    longPressFired = true
    const touch = event.touches[0]
    emit(
      'date-right-clicked',
      date,
      new MouseEvent('contextmenu', { clientX: touch.clientX, clientY: touch.clientY })
    )
  }, 500)
}

const onContextMenu = (date: dayjs.Dayjs, event: MouseEvent) => {
  event.preventDefault()
  if (longPressFired) return
  emit('date-right-clicked', date, event)
}

const onTouchEnd = () => {
  if (longPressTimer) {
    window.clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

const days = computed(() => {
  const days: { dayNumber: number; day: dayjs.Dayjs; formatedDate: string }[] = []
  const firstDayOfMonth = dayjs().date(1).year(selectedYear.value).month(selectedMonth.value)
  const weekStart = GlobalStore.getInstance().weekStartsOnMonday.value ? 1 : 0

  const paddingDays = (firstDayOfMonth.day() - weekStart + 7) % 7

  for (let i = paddingDays; i > 0; i--) {
    const day = firstDayOfMonth.subtract(i, 'day')
    days.push({
      dayNumber: day.date(),
      day,
      formatedDate: day.format(DATE_FORMAT),
    })
  }

  const daysInMonth = firstDayOfMonth.daysInMonth()
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({
      dayNumber: i,
      day: firstDayOfMonth.date(i),
      formatedDate: firstDayOfMonth.date(i).format(DATE_FORMAT),
    })
  }

  const lastDayOfMonth = firstDayOfMonth.date(daysInMonth)
  const trailingDays = (weekStart + 6 - lastDayOfMonth.day()) % 7

  for (let i = 1; i <= trailingDays; i++) {
    const day = lastDayOfMonth.add(i, 'day')
    days.push({
      dayNumber: day.date(),
      day,
      formatedDate: day.format(DATE_FORMAT),
    })
  }

  return days
})

const weekdays = computed(() => {
  const days: string[] = []
  for (
    let i = GlobalStore.getInstance().weekStartsOnMonday.value ? 1 : 0;
    i < (GlobalStore.getInstance().weekStartsOnMonday.value ? 8 : 7);
    i++
  ) {
    days.push(dayjs().day(i).format('dd'))
  }
  return days
})

const tasksDateMap = computed(() => {
  const { tasksList: tasksListRef } = GlobalStore.getInstance()

  const tasksList = unref(tasksListRef) as TasksList

  if (!tasksList) return new Map<string, Task[]>()

  const map = new Map<string, Task[]>()

  for (const task of tasksList.tasks.values()) {
    if (task.completedAt) continue

    const taskDate = task.getTaskDate()
    if (taskDate) {
      const dateKey = taskDate.format(DATE_FORMAT)
      if (!map.has(dateKey)) {
        map.set(dateKey, [])
      }
      map.get(dateKey)?.push(task)
    }
  }

  return map
})

const calendarDays = useCalendarDays()

/**
 * The colour of the first calendar with an event on each day: a short bar under the date, so a
 * day with meetings reads apart from a day with tasks (rings) and one with a note (a dot).
 */
const eventColors = computed(() => {
  const colors = new Map<string, KitColor>()
  if (!props.showTasks) return colors
  for (const [day, shown] of calendarDays.value) colors.set(day, shown[0].feed.color)
  return colors
})

const emit = defineEmits<{
  (e: 'date-selected', date: dayjs.Dayjs): void
  (e: 'date-right-clicked', date: dayjs.Dayjs, event: MouseEvent): void
  /** The month shown changed: its first day. */
  (e: 'month-changed', first: dayjs.Dayjs): void
}>()

watch([selectedMonth, selectedYear], () =>
  emit('month-changed', dayjs().date(1).year(selectedYear.value).month(selectedMonth.value))
)
</script>

<style lang="scss">
.abele-calendar {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
}

.abele-calendar__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  .abele-calendar__header-month-year {
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
  }
  .abele-calendar__header-controls {
    display: flex;
    align-items: center;
    align-items: center;
    gap: var(--size-2-2);
    .abele-calendar__header-today {
      cursor: pointer;
      font-size: var(--font-small);
      color: var(--text-accent);
      &:hover {
        text-decoration: underline;
      }
    }
  }
}

.abele-calendar__body {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
}

.abele-calendar__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  // Quiet column labels, as a calendar's weekdays are: the dates are what is read.
  .abele-calendar__weekday {
    text-align: center;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
  }
}

.abele-calendar__days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--size-2-2);
}

.abele-calendar__day {
  padding-bottom: var(--size-4-2);
  padding-top: var(--size-2-2);
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-2-1);
  text-align: center;
  border-radius: var(--radius-s);
  cursor: pointer;
  &:hover {
    background-color: var(--background-modifier-hover);
  }
  &_today {
    color: var(--text-accent);
    background-color: hsl(var(--accent-h), var(--accent-s), 97%);
  }
  &_selected {
    background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
    color: var(--text-on-accent);
    &:hover {
      background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
      color: var(--text-on-accent);
    }
  }
  &_other-month {
    color: var(--text-faint);
  }
}

.theme-dark {
  .abele-calendar__day {
    &_today {
      background-color: hsl(var(--accent-h), calc(var(--accent-s) - 15%), 10%);
    }
  }
}

.abele-calendar__day-marks {
  position: absolute;
  bottom: 4px;
  left: 0;
  right: 0;
  height: 4px;
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  width: 100%;
  justify-content: center;
}

.abele-calendar__day-dot {
  width: 4px;
}

// Twice as wide as a dot, so it reads as a different mark rather than one more dot.
.abele-calendar__day-event {
  width: calc(var(--size-2-1) * 4);
  color: var(--text-faint);
}

// A month of a note's log: the mark is what is read, so it sits under the number in the flow at
// a size a box can be told from a dot by, and the chosen day is lit the way Obsidian lights the
// open file in its list rather than filled with the accent the ticked boxes are drawn in.
.abele-calendar_marks {
  // The day is a button here; Obsidian's button box and shadow give way to the calendar's cell.
  .abele-calendar__day {
    padding: var(--size-2-2) 0;
    height: auto;
    font: inherit;

    &:not(:focus-visible) {
      box-shadow: none;
    }
    gap: var(--size-2-1);
  }

  .abele-calendar__day-marks {
    position: static;
    height: auto;
    min-height: 0.6em;
  }

  .abele-calendar__day_selected,
  .abele-calendar__day_selected:hover {
    background-color: var(--nav-item-background-active);
    color: var(--nav-item-color-active);
    font-weight: var(--font-semibold);
  }
}

// A finger's worth of height for each day on a phone, the cells meeting edge to edge.
body.is-phone .abele-calendar_marks {
  .abele-calendar__days {
    gap: 0;
  }

  .abele-calendar__day {
    min-height: var(--abele-touch-min);
  }
}

.abele-calendar__day-log {
  width: 0.6em;
  height: 0.6em;
  color: var(--text-muted);
}

.abele-calendar__day-log_done {
  color: var(--checkbox-color);
}

.abele-calendar__day-log_open {
  color: var(--text-faint);
}

$event-colors: red, orange, yellow, green, cyan, blue, purple, pink;
@each $name in $event-colors {
  .abele-calendar__day-event_color-#{$name} {
    color: var(--color-#{$name});
  }
}
</style>
