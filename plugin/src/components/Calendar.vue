<template>
  <div class="abele-calendar">
    <div class="abele-calendar__header">
      <div class="abele-calendar__header-month-year">
        {{ dayjs().month(selectedMonth).format('MMMM') }} {{ selectedYear }}
      </div>
      <div class="abele-calendar__header-controls">
        <ObsidianIcon icon="chevron-left" @click="previousMonth()" />
        <div class="abele-calendar__header-today" @click="todayClick()">Today</div>
        <ObsidianIcon icon="chevron-right" @click="nextMonth()" />
      </div>
    </div>
    <div class="abele-calendar__body">
      <div class="abele-calendar__weekdays">
        <div v-for="day in weekdays" :key="day" class="abele-calendar__weekday">
          {{ day }}
        </div>
      </div>
      <div class="abele-calendar__days">
        <div
          v-for="day in days"
          :key="day.day.toString()"
          class="abele-calendar__day"
          :class="{
            'abele-calendar__day_today': day.day.isSame(today, 'day'),
            'abele-calendar__day_other-month': day.day.get('month') !== selectedMonth,
            'abele-calendar__day_selected': props.selectedDate
              ? day.day.isSame(props.selectedDate, 'day')
              : false,
          }"
          @click="emit('date-selected', day.day)"
        >
          <div class="abele-calendar__day-number">{{ day.dayNumber }}</div>
          <div v-if="journal || showTasks" class="abele-calendar__day-marks">
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
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDate } from '@/composables/useDate'
import dayjs from 'dayjs'
import { computed, ref, unref, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DATE_FORMAT } from '@/constants/dates'
import { TasksList } from '@/entities/TasksList'
import { Task } from '@/entities/Task'
import { Journal } from '@/entities/Journal'

const { now: today } = useDate()
const props = defineProps<{
  selectedDate?: dayjs.Dayjs
  journal?: Journal
  showTasks?: boolean
}>()
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

const days = computed(() => {
  const days: { dayNumber: number; day: dayjs.Dayjs; formatedDate: string }[] = []
  const firstDayOfMonth = dayjs().year(selectedYear.value).month(selectedMonth.value).date(1)

  const weekdayOfFirst = firstDayOfMonth.day()

  for (
    let i = GlobalStore.getInstance().weekStartsOnMonday.value ? 1 : 0;
    i < weekdayOfFirst;
    i++
  ) {
    days.push({
      dayNumber: firstDayOfMonth
        .date(1)
        .subtract(weekdayOfFirst - i, 'day')
        .date(),
      day: firstDayOfMonth.date(1).subtract(weekdayOfFirst - i, 'day'),
      formatedDate: firstDayOfMonth
        .date(1)
        .subtract(weekdayOfFirst - i, 'day')
        .format(DATE_FORMAT),
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
  const weekdayOfLast = lastDayOfMonth.day()

  for (
    let i = 1;
    i < 7 - weekdayOfLast + (GlobalStore.getInstance().weekStartsOnMonday.value ? 1 : 0);
    i++
  ) {
    days.push({
      dayNumber: i,
      day: lastDayOfMonth.date(daysInMonth + i),
      formatedDate: lastDayOfMonth.date(daysInMonth + i).format(DATE_FORMAT),
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

const emit = defineEmits<{
  (e: 'date-selected', date: dayjs.Dayjs): void
}>()
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
    font-size: var(--font-large);
    font-weight: bold;
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
  .abele-calendar__weekday {
    text-align: center;
    font-weight: bold;
    color: var(--text-muted);
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
</style>
