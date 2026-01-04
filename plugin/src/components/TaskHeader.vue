<template>
  <div v-if="task.taskNotFound" class="abele-task-header-view">
    <em class="abele-task-header-view__content">Task not found</em>
  </div>
  <div v-else-if="task.loaded" class="abele-task-header-view">
    <Icon :text-right="toggleText" :icon="toggleIcon" with-bg @click="task.toggle()" />
    <Icon
      v-if="showAddDate"
      ref="addDateButton"
      :text-right="addDateText"
      with-bg
      icon="calendar"
      @click="dateMenu.open"
    />
    <Icon
      v-if="showAddTime"
      ref="addTimeButton"
      :text-right="addTimeText"
      with-bg
      icon="clock"
      @click="timeMenu.open"
    />
    <Icon
      ref="recurrenceButton"
      text-right="Recurrence"
      icon="repeat"
      with-bg
      @click="recurrenceMenu.open"
    />
    <Icon text-right="Clear" with-bg @click="clear" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { TaskHeader } from '@/entities/TaskHeader'
import { AbeleConfig } from '@/services/AbeleConfig'
import Icon from './obsidian/Icon.vue'
import { useMenu, type Choice } from '@/composables/useMenu'

const props = defineProps<{ task: TaskHeader }>()

const addDateButton = ref<InstanceType<typeof Icon> | null>(null)
const addTimeButton = ref<InstanceType<typeof Icon> | null>(null)
const recurrenceButton = ref<InstanceType<typeof Icon> | null>(null)

const toggleText = computed(() => (props.task.completedAt ? 'Undone' : 'Complete'))
const toggleIcon = computed(() => (props.task.completedAt ? 'check-square' : 'square'))

const showAddDate = computed(() => !props.task.due || !props.task.date)
const addDateText = computed(() => {
  if (!props.task.due && !props.task.date) return 'Add Date'
  return props.task.due ? 'Add Event Date' : 'Add Due Date'
})

const showAddTime = computed(
  () => (props.task.due && !props.task.dueTime) || (props.task.date && !props.task.dateTime)
)
const addTimeText = computed(() => {
  if (!props.task.dueTime && !props.task.dateTime) return 'Add Time'
  return props.task.due && !props.task.dueTime ? 'Add Due Time' : 'Add Event Time'
})

const config = AbeleConfig.getInstance()

const dateMenuChoices = computed<Choice[]>(() => {
  const dateChoices = config.tasksDateChoices.map((date) => ({
    title: date,
    event: 'set_date',
    value: date,
  }))

  if (showAddDate.value && !props.task.due && !props.task.date) {
    return [
      {
        title: 'Event date',
        icon: 'calendar-days',
        subMenu: dateChoices.map((c) => ({
          ...c,
          event: 'set_event_date',
        })),
      },
      {
        title: 'Due date',
        icon: 'calendar-clock',
        subMenu: dateChoices.map((c) => ({
          ...c,
          event: 'set_due_date',
        })),
      },
    ]
  }
  if (props.task.due) return dateChoices.map((c) => ({ ...c, event: 'set_event_date' }))
  return dateChoices.map((c) => ({ ...c, event: 'set_due_date' }))
})

const timeMenuChoices = computed<Choice[]>(() => {
  if (!showAddTime.value) return []
  const timeChoices = config.tasksTimeChoices.map((time) => ({
    title: time,
    event: 'set_time',
    value: time,
  }))

  if (props.task.due && !props.task.dueTime && props.task.date && !props.task.dateTime) {
    return [
      {
        title: 'Event time',
        icon: 'clock',
        subMenu: timeChoices.map((c) => ({
          ...c,
          event: 'set_event_time',
        })),
      },
      {
        title: 'Due time',
        icon: 'clock',
        subMenu: timeChoices.map((c) => ({
          ...c,
          event: 'set_due_time',
        })),
      },
    ]
  }

  if (props.task.due && !props.task.dueTime)
    return timeChoices.map((c) => ({ ...c, event: c.event.replace('set_time', 'set_due_time') }))
  if (props.task.date && !props.task.dateTime)
    return timeChoices.map((c) => ({ ...c, event: c.event.replace('set_time', 'set_event_time') }))

  return []
})

const recurrenceMenuChoices = computed<Choice[]>(() => {
  return config.tasksRecurrenceChoices.map((rec) => {
    let recurrenceValue: string

    switch (rec) {
      case 'Daily':
        recurrenceValue = 'every day'
        break
      case 'Weekly':
        recurrenceValue = 'every week'
        break
      case 'Monthly':
        recurrenceValue = 'every month'
        break
      case 'Yearly':
        recurrenceValue = 'every year'
        break
    }

    return {
      title: rec,
      event: 'set_recurrence',
      value: recurrenceValue,
    }
  })
})

const handleMenuSelect = (event: string, value: string) => {
  switch (event) {
    case 'set_due_date':
      props.task.addDueDate(value)
      break
    case 'set_event_date':
      props.task.addEventDate(value)
      break
    case 'set_due_time':
      props.task.addDueTime(value)
      break
    case 'set_event_time':
      props.task.addEventTime(value)
      break
    case 'set_recurrence':
      props.task.addRecurrence(value)
      break
  }
}

const dateMenu = useMenu(addDateButton, dateMenuChoices, handleMenuSelect)
const timeMenu = useMenu(addTimeButton, timeMenuChoices, handleMenuSelect)
const recurrenceMenu = useMenu(recurrenceButton, recurrenceMenuChoices, handleMenuSelect)

const clear = () => {
  props.task.removeDueDate()
  props.task.removeEventDate()
  props.task.removeRecurrence()
  if (props.task.completedAt) {
    props.task.toggle()
  }
}

onMounted(() => {
  props.task.load()
})
</script>

<style lang="scss">
.abele-task-header-view {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  margin-bottom: var(--p-spacing);
  padding-bottom: var(--size-4-2);
  flex-wrap: wrap;

  p {
    margin: 0;
  }
}

.abele-task-header-view__content {
  flex: 1;
  overflow-wrap: break-word;
  padding-top: 1px;
}

.abele-task-header-view__indicator {
  width: 3px;
  background-color: var(--background-modifier-error);
  border-radius: 2px;
  height: 100%;
}
</style>
