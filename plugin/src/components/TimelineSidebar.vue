<template>
  <SidebarPanel class="abele-timeline-sidebar" @element="container = $event">
    <Calendar
      :selected-date="selectedJournal?.date"
      :view="calendarView"
      show-tasks
      :journal="journal"
      class="abele-timeline-sidebar__calendar"
      @view-changed="rememberCalendarView"
      @date-selected="selectDate"
      @date-right-clicked="onDateRightClick"
    >
      <template #lead><DrawerViewSwitch icon="chart-gantt" name="Abele timeline" /></template>
    </Calendar>
    <Timeline :tasks="timelineTasks" :events="upcomingEvents" show-add-button />
  </SidebarPanel>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import { TasksList } from '@/entities/TasksList'
import Timeline from './Timeline.vue'
import SidebarPanel from './obsidian/SidebarPanel.vue'
import Calendar from './Calendar.vue'
import { computed, ref, toRef, unref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { Menu, Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { createTask } from '@/commands/createTask'
import dayjs from 'dayjs'
import { useCalendarDays } from '@/composables/useCalendarDays'
import { useOwnerVisibility } from '@/composables/useOwnerVisibility'
import { useDate } from '@/composables/useDate'
import { DATE_FORMAT } from '@/constants/dates'

import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'
import { providePanelActive } from '@/composables/usePanelComputed'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const active = toRef(props, 'active')
providePanelActive(active)
const calendarViewKey = 'abele-sidebar-calendar-view'
const calendarApp = GlobalStore.getInstance().app
const calendarView = ref<'month' | 'year'>(
  calendarApp.loadLocalStorage(calendarViewKey) === 'year' ? 'year' : 'month'
)
const rememberCalendarView = (view: 'month' | 'year') => {
  calendarView.value = view
  calendarApp.saveLocalStorage(calendarViewKey, view)
}
const { selectedJournal } = GlobalStore.getInstance()

const tasks = pausedWhileHidden(active, () => {
  const { tasksList: tasksListRef } = GlobalStore.getInstance()

  const tasksList = unref(tasksListRef) as TasksList

  if (!tasksList) return []

  // Vault enumeration order can reverse on reload. Keep equal-time sidebar rows stable
  // so hiding history chooses the same nearest replacement, without reordering note lists.
  return Array.from(tasksList.tasks.entries())
    .sort(
      ([pathA, a], [pathB, b]) =>
        b.getSortTimestamp() - a.getSortTimestamp() || pathA.localeCompare(pathB)
    )
    .map(([, task]) => task)
})

const journal = computed(() => {
  return AbeleConfig.getInstance().journals.find((j) => {
    return j.isDefaultDailyJournal
  })
})

const selectDate = (date: dayjs.Dayjs) => {
  if (!journal.value) {
    new Notice(t('area.noDailyJournalFoundPleaseCheckYourSettings'))

    return
  }

  journal.value.createJournalNote(date)
}

const onDateRightClick = (date: dayjs.Dayjs, event: MouseEvent) => {
  event.preventDefault()
  const menu = new Menu()
  menu.setUseNativeMenu(false)
  menu.addItem((item) => {
    item.setTitle(t('area.eventDate'))
    item.setIcon('calendar-days')
    item.onClick(() => createTask({ date }))
  })
  menu.addItem((item) => {
    item.setTitle(t('area.dueDate'))
    item.setIcon('calendar-clock')
    item.onClick(() => createTask({ due: date }))
  })
  menu.showAtMouseEvent(event)
}

const container = ref<HTMLElement>()
const visible = useOwnerVisibility(container)
const { now } = useDate(visible, () => container.value?.ownerDocument ?? document)
// The past is in the list while it shows done tasks; a day there reads whole, with its meetings
// beside what was done in it. A month back is as far as that history goes.
const calendarDays = useCalendarDays(
  (day) => day >= now.value.subtract(30, 'day').format(DATE_FORMAT)
)
const upcomingEvents = pausedWhileHidden(active, () => calendarDays.value)

// const todoTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && !t.dates.length))
const timelineTasks = pausedWhileHidden(active, () =>
  tasks.value.filter((t) => !t.taskNotFound && t.dates.length)
)
</script>

<style lang="scss">
.abele-timeline-sidebar {
  p {
    margin: 0;
  }
}

.abele-timeline-sidebar__calendar {
  margin-bottom: calc(var(--p-spacing) * 2);
}
</style>
