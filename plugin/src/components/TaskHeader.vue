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
      @click="openDatePicker"
    />
    <Icon
      v-if="showEditDate && task.date"
      text-right="Edit Event Date"
      with-bg
      icon="calendar-days"
      @click="openDatePickerForMode('event')"
    />
    <Icon
      v-if="showEditDate && task.due"
      text-right="Edit Due Date"
      with-bg
      icon="calendar-clock"
      @click="openDatePickerForMode('due')"
    />
    <Icon
      ref="recurrenceButton"
      text-right="Recurrence"
      icon="repeat"
      with-bg
      @click="recurrenceMenu.open"
    />
    <Icon text-right="Clear" with-bg @click="clear" />

    <DateTimePickerModal
      v-if="datePickerOpen"
      :mode="datePickerMode"
      :initial-date="datePickerMode === 'event' ? task.date : task.due"
      :initial-time="
        datePickerMode === 'event' ? formatTime(task.dateTime) : formatTime(task.dueTime)
      "
      @confirm="onDateTimeConfirm"
      @clear="onDateTimeClear"
      @cancel="datePickerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { TaskHeader } from '@/entities/TaskHeader'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Menu } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import DateTimePickerModal from './DateTimePickerModal.vue'
import { useMenu, type Choice } from '@/composables/useMenu'

const props = defineProps<{ task: TaskHeader }>()

const addDateButton = ref<InstanceType<typeof Icon> | null>(null)
const recurrenceButton = ref<InstanceType<typeof Icon> | null>(null)

const datePickerOpen = ref(false)
const datePickerMode = ref<'event' | 'due'>('event')

const toggleText = computed(() => (props.task.completedAt ? 'Undone' : 'Complete'))
const toggleIcon = computed(() => (props.task.completedAt ? 'check-square' : 'square'))

const showAddDate = computed(() => !props.task.due || !props.task.date)
const showEditDate = computed(() => props.task.due || props.task.date)
const addDateText = computed(() => {
  if (!props.task.due && !props.task.date) return 'Add Date'
  return props.task.due ? 'Add Event Date' : 'Add Due Date'
})

const formatTime = (time: dayjs.Dayjs | null): string | null => {
  if (!time) return null
  return time.format('HH:mm')
}

const openDatePickerForMode = (mode: 'event' | 'due') => {
  datePickerMode.value = mode
  datePickerOpen.value = true
}

const openDatePicker = () => {
  if (!props.task.due && !props.task.date) {
    const menu = new Menu()
    menu.setUseNativeMenu(false)
    menu.addItem((item) => {
      item.setTitle('Event date')
      item.setIcon('calendar-days')
      item.onClick(() => openDatePickerForMode('event'))
    })
    menu.addItem((item) => {
      item.setTitle('Due date')
      item.setIcon('calendar-clock')
      item.onClick(() => openDatePickerForMode('due'))
    })
    const el = addDateButton.value?.$el
    if (el) {
      const rect = el.getBoundingClientRect()
      menu.showAtPosition({ x: rect.left, y: rect.bottom })
    } else {
      menu.showAtMouseEvent(new MouseEvent('click'))
    }
    return
  }
  datePickerMode.value = props.task.due ? 'event' : 'due'
  datePickerOpen.value = true
}

const onDateTimeConfirm = (result: { date: dayjs.Dayjs; time: string | null }) => {
  if (datePickerMode.value === 'event') {
    props.task.setEventDate(result.date, result.time)
  } else {
    props.task.setDueDate(result.date, result.time)
  }
  datePickerOpen.value = false
}

const onDateTimeClear = () => {
  if (datePickerMode.value === 'event') {
    props.task.removeEventDate()
  } else {
    props.task.removeDueDate()
  }
  datePickerOpen.value = false
}

const config = AbeleConfig.getInstance()

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
  if (event === 'set_recurrence') {
    props.task.addRecurrence(value)
  }
}

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
