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
    <Icon text-right="Recurrence" icon="repeat" with-bg @click="recurrencePickerOpen = true" />
    <Icon text-right="Clear" with-bg @click="clear" />
    <Icon
      v-if="showTimerButton"
      :icon="isTimerActiveForNote ? 'timer-off' : 'timer'"
      :text-right="isTimerActiveForNote ? timerElapsedText : 'Start timer'"
      :tooltip="isTimerActiveForNote ? 'Stop timer' : 'Start timer for this note'"
      with-bg
      @click="toggleTimer"
    />

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

    <RecurrencePickerModal
      v-if="recurrencePickerOpen"
      :initial-pattern="task.recurrence"
      @confirm="onRecurrenceConfirm"
      @clear="onRecurrenceClear"
      @cancel="recurrencePickerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { TaskHeader } from '@/entities/TaskHeader'
import { Menu } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import DateTimePickerModal from './DateTimePickerModal.vue'
import RecurrencePickerModal from './RecurrencePickerModal.vue'
import { useTimerButton } from '@/composables/useTimerButton'

const props = defineProps<{ task: TaskHeader }>()

// --- Timer ---
const taskFilePath = computed(() => props.task.filePath)
const taskType = computed(() => 'task')
const { showTimerButton, isTimerActiveForNote, timerElapsedText, toggleTimer } = useTimerButton(
  taskFilePath,
  taskType
)

const addDateButton = ref<InstanceType<typeof Icon> | null>(null)

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

const recurrencePickerOpen = ref(false)

const onRecurrenceConfirm = (pattern: string) => {
  props.task.addRecurrence(pattern)
  recurrencePickerOpen.value = false
}

const onRecurrenceClear = () => {
  props.task.removeRecurrence()
  recurrencePickerOpen.value = false
}

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
