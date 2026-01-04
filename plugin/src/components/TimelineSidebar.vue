<template>
  <div ref="container" class="abele-timeline-sidebar">
    <Calendar
      :selected-date="selectedJournal?.date"
      show-tasks
      :journal="journal"
      class="abele-timeline-sidebar__calendar"
      @date-selected="selectDate"
    />
    <Timeline :tasks="timelineTasks" show-add-button />
  </div>
</template>

<script setup lang="ts">
import { TasksList } from '@/entities/TasksList'
import Timeline from './Timeline.vue'
import Calendar from './Calendar.vue'
import { computed, unref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import dayjs from 'dayjs'

const { selectedJournal } = GlobalStore.getInstance()

const tasks = computed(() => {
  const { tasksList: tasksListRef } = GlobalStore.getInstance()

  const tasksList = unref(tasksListRef) as TasksList

  if (!tasksList) return []

  return Array.from(tasksList.tasks.values()).sort(
    (a, b) => b.getTaskDateOrToday().unix() - a.getTaskDateOrToday().unix()
  )
})

const journal = computed(() => {
  return AbeleConfig.getInstance().journals.find((j) => {
    return j.isDefaultDailyJournal
  })
})

const selectDate = (date: dayjs.Dayjs) => {
  if (!journal.value) {
    new Notice('No daily journal found. Please check your settings.')

    return
  }

  journal.value.createJournalNote(date)
}

// const todoTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && !t.dates.length))
const timelineTasks = computed(() => tasks.value.filter((t) => !t.taskNotFound && t.dates.length))
</script>

<style lang="scss">
.abele-timeline-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--background-primary);

  padding: calc(var(--p-spacing) * 2);
  padding-top: calc(var(--size-4-2) * 2 + var(--icon-size));

  p {
    margin: 0;
  }
}

@media (max-width: 600px) {
  .abele-timeline-sidebar {
    padding: calc(var(--size-4-4));
    padding-top: calc(var(--size-4-2) + var(--icon-size));
  }
}

.abele-timeline-sidebar__calendar {
  margin-bottom: calc(var(--p-spacing) * 2);
}
</style>
