<template>
  <div ref="clockEl" class="abele-calendar" :class="{ 'abele-calendar_marks': marks }">
    <div class="abele-calendar__header">
      <slot name="lead" />
      <!-- The title is the way between the month and its year: pressed on a month, the year;
           pressed on a year, back to the month it came from. -->
      <div
        ref="titleEl"
        class="abele-calendar__header-month-year"
        role="button"
        tabindex="0"
        :aria-label="titleTip"
        @click="toggleView()"
        @keydown.enter.prevent="toggleView()"
      >
        {{ view === 'year' ? selectedYear : areaDate(dayjs().month(selectedMonth), 'MMMM') }}
        <template v-if="view === 'month'">{{ selectedYear }}</template>
      </div>
      <div class="abele-calendar__header-controls">
        <ObsidianIcon
          icon="chevron-left"
          :tooltip="view === 'year' ? t('area.previousYear') : t('area.previousMonth')"
          @click="view === 'year' ? selectedYear-- : previousMonth()"
        />
        <!-- In a note's log month the keyboard moves through the controls and the days alike. -->
        <ObsidianIcon
          v-if="marks"
          :text-right="t('area.today')"
          :tooltip="t('area.selectToday')"
          @click="todayClick()"
        />
        <div v-else class="abele-calendar__header-today" @click="todayClick()">
          {{ t('area.today') }}
        </div>
        <ObsidianIcon
          :tooltip="view === 'year' ? t('area.nextYear') : t('area.nextMonth')"
          icon="chevron-right"
          @click="view === 'year' ? selectedYear++ : nextMonth()"
        />
      </div>
    </div>
    <!-- The year: twelve small months, each day tinted by what is on it, as the base calendar's
         year is. A day is chosen as in the month; a month's name opens that month. -->
    <CalendarYear
      v-if="view === 'year'"
      compact
      :year="selectedYear"
      :monday-first="GlobalStore.getInstance().weekStartsOnMonday.value"
      :items="[]"
      :levels="yearLevels"
      :today="today.format(DATE_FORMAT)"
      :selected="props.selectedDate?.format(DATE_FORMAT) ?? null"
      @day="(d) => emit('date-selected', dayjs(d))"
      @month="openMonth"
    />
    <div v-else class="abele-calendar__body">
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
import { areaDate } from '@/helpers/areaDateFormat'
import { t } from '@/i18n'
import { useOwnerVisibility } from '@/composables/useOwnerVisibility'
import { useDate } from '@/composables/useDate'
import dayjs from 'dayjs'
import { ref, unref, watch } from 'vue'
import { panelComputed as computed } from '@/composables/usePanelComputed'
import ObsidianIcon from './obsidian/Icon.vue'
import CalendarYear from './calendarBase/CalendarYear.vue'
import { levelsOfCounts, levelsOfMarks } from './calendarYearLevels'
import { setTooltip } from 'obsidian'
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
  /** What the marks stand for, read out with each day: a note's logs or its calendar tasks. */
  marksOf?: 'logs' | 'tasks'
  /** Shown as a month or its year; each place keeps what its user left. */
  view?: 'month' | 'year'
}>()
/** What a log month's day says when read out: its date, and what its mark shows. */
const dayLabel = (date: dayjs.Dayjs, key: string): string => {
  const mark = props.marks?.get(key)
  const words =
    props.marksOf === 'tasks'
      ? {
          done: t('area.Alltasksdone'),
          open: t('area.Taskstodo'),
          entry: t('area.Events'),
          none: t('area.Nothingplanned'),
        }
      : {
          done: t('area.Checkedlog'),
          open: t('area.Uncheckedlog'),
          entry: t('area.Logentry'),
          none: t('area.Nologentries'),
        }
  const status = mark ? words[mark] : words.none
  return `${areaDate(date, 'ddd D MMMM YYYY')}: ${status}`
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
    days.push(areaDate(dayjs().day(i), 'dd'))
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
  /** Switched between the month and its year. */
  (e: 'view-changed', view: 'month' | 'year'): void
}>()

const view = ref<'month' | 'year'>(props.view ?? 'month')
watch(
  () => props.view,
  (v) => v && (view.value = v)
)
const titleEl = ref<HTMLElement>()
const titleTip = computed(() =>
  view.value === 'year'
    ? t('area.backToMonth', { month: areaDate(dayjs().month(selectedMonth.value), 'MMMM') })
    : t('area.showTheWholeYear')
)
watch([titleEl, titleTip], ([el, tip]) => el && setTooltip(el, tip))
function toggleView() {
  view.value = view.value === 'year' ? 'month' : 'year'
  emit('view-changed', view.value)
}
function openMonth(month: number) {
  selectedMonth.value = month
  view.value = 'month'
  emit('view-changed', 'month')
}

/** What the year view tints: a note's marks, or how much the sidebar's day carries. */
const yearLevels = computed(() => {
  if (view.value !== 'year') return new Map()
  if (props.marks) return levelsOfMarks(props.marks)
  const counts = new Map<string, number>()
  const add = (day: string, n: number) => n && counts.set(day, (counts.get(day) ?? 0) + n)
  for (const [day, tasks] of tasksDateMap.value) add(day, tasks.length)
  for (const [day, shown] of calendarDays.value) add(day, shown.length)
  if (props.journal) {
    const first = dayjs().year(selectedYear.value).startOf('year')
    for (let d = first; d.year() === selectedYear.value; d = d.add(1, 'day'))
      if (props.journal.isJournalNoteCreated(d)) add(d.format(DATE_FORMAT), 1)
  }
  return levelsOfCounts(counts)
})

watch([selectedMonth, selectedYear], () =>
  emit('month-changed', dayjs().date(1).year(selectedYear.value).month(selectedMonth.value))
)
</script>

<style lang="scss" src="./calendarSmall.scss"></style>
