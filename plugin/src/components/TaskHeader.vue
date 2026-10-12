<template>
  <div v-if="task.taskNotFound" class="abele-task-header-view">
    <em class="abele-task-header-view__content">Task not found</em>
  </div>
  <div v-else-if="task.loaded" class="abele-task-header-view abele-glyph-row">
    <!-- One row of glyphs, as Obsidian's own navigation: a set value is a code beside its glyph,
         the words are in the tooltips. -->
    <Icon
      class="abele-task-header-view__toggle"
      :icon="toggleIcon"
      :label="task.completedAt ? 'Mark not done' : 'Mark done'"
      role="switch"
      :aria-checked="!!task.completedAt"
      @click="task.toggle()"
    />
    <Icon
      class="abele-task-header-view__date"
      icon="calendar-days"
      :text-right="dateCode"
      :label="task.date ? 'Change date' : 'Set date'"
      :tooltip="task.date ? `Date ${fullDate(task.date, task.dateTime)}` : 'Set date'"
      @click="openDatePickerForMode('event')"
    />
    <Icon
      class="abele-task-header-view__due"
      icon="calendar-clock"
      :text-right="dueCode"
      :color="isOverdue ? 'red' : undefined"
      :label="task.due ? 'Change due date' : 'Set due date'"
      :tooltip="task.due ? `Due ${fullDate(task.due, task.dueTime)}` : 'Set due date'"
      @click="openDatePickerForMode('due')"
    />
    <Icon
      class="abele-task-header-view__recurrence"
      icon="repeat"
      :text-right="task.recurrence || undefined"
      :label="task.recurrence ? 'Change repeat' : 'Set repeat'"
      @click="recurrencePickerOpen = true"
    />
    <!-- Its subtasks: done of all beside the glyph, and pressed, a new one under this task. -->
    <Icon
      class="abele-task-header-view__subtasks"
      icon="list-plus"
      :text-right="subtasks ? `${subtasks.done}/${subtasks.total}` : undefined"
      label="Add subtask"
      :tooltip="
        subtasks
          ? `${subtasks.done} of ${subtasks.total} subtasks done · Add subtask`
          : 'Add subtask'
      "
      @click="addSubtask(task.filePath)"
    />
    <Icon
      v-if="hasAnything"
      class="abele-task-header-view__clear"
      icon="eraser"
      label="Clear dates, repeat and done"
      @click="clear"
    />
    <Icon
      v-for="button in scriptButtons"
      :key="button.id"
      :icon="button.icon || 'play'"
      :text-right="button.iconOnly ? undefined : button.name"
      :tooltip="button.iconOnly ? button.name : `Run ${button.scriptName}`"
      @click="runButton(button)"
    />
    <Icon
      v-if="showTimerButton"
      :icon="isTimerActiveForNote ? 'timer-off' : 'timer'"
      :text-right="isTimerActiveForNote ? timerElapsedText : undefined"
      :label="isTimerActiveForNote ? 'Stop timer' : 'Start timer for this note'"
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
import { GlobalStore } from '@/stores/GlobalStore'
import { addSubtask, subtasksOfPath } from '@/commands/subtasks'
import dayjs from 'dayjs'
import { TaskHeader } from '@/entities/TaskHeader'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { compactDate } from '@/helpers/datesHelper'
import Icon from './obsidian/Icon.vue'
import DateTimePickerModal from './DateTimePickerModal.vue'
import RecurrencePickerModal from './RecurrencePickerModal.vue'
import { useTimerButton } from '@/composables/useTimerButton'
import { useScriptButtons } from '@/composables/useScriptButtons'

const props = defineProps<{ task: TaskHeader }>()
const subtasks = computed(() =>
  subtasksOfPath(props.task.filePath, [
    ...(GlobalStore.getInstance().tasksList.value?.tasks.values() ?? []),
  ])
)

// --- Timer ---
const taskFilePath = computed(() => props.task.filePath)
const taskType = computed(() => 'task')
const { showTimerButton, isTimerActiveForNote, timerElapsedText, toggleTimer } = useTimerButton(
  taskFilePath,
  taskType
)

// Script buttons configured for tasks — or for every note, or for the task's folder.
const { scriptButtons, runButton } = useScriptButtons(taskFilePath, taskType)

const datePickerOpen = ref(false)
const datePickerMode = ref<'event' | 'due'>('event')

const toggleIcon = computed(() => (props.task.completedAt ? 'check-square' : 'square'))

const formatTime = (time: dayjs.Dayjs | null): string | null => {
  if (!time) return null
  return time.format('HH:mm')
}

// The date as a code beside its glyph: the near days by name, the rest as a short date.
const dayCode = (date: dayjs.Dayjs | null, time: dayjs.Dayjs | null) => {
  if (!date) return undefined
  const diff = date.startOf('day').diff(dayjs().startOf('day'), 'day')
  const day =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : compactDate(date)
  return time ? `${day} ${time.format('HH:mm')}` : day
}

const fullDate = (date: dayjs.Dayjs, time: dayjs.Dayjs | null) =>
  `${date.format(DISPLAY_DATE_FORMAT)}${time ? ' ' + time.format('HH:mm') : ''}`

const dateCode = computed(() => dayCode(props.task.date, props.task.dateTime))
const dueCode = computed(() => dayCode(props.task.due, props.task.dueTime))
const isOverdue = computed(
  () =>
    !!props.task.due &&
    !props.task.completedAt &&
    props.task.due.startOf('day').isBefore(dayjs().startOf('day'))
)
const hasAnything = computed(
  () => !!(props.task.date || props.task.due || props.task.recurrence || props.task.completedAt)
)

const openDatePickerForMode = (mode: 'event' | 'due') => {
  datePickerMode.value = mode
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
  align-items: center;
  gap: var(--size-2-2);
  margin-bottom: var(--p-spacing);
  padding-bottom: var(--size-4-2);
  flex-wrap: wrap;
  color: var(--text-muted);

  p {
    margin: 0;
  }
}

// A phone keeps the row to one line: the repeat rule is in its tooltip and its window there.
.is-phone .abele-task-header-view {
  gap: 0;

  .abele-obsidian-icon {
    padding-inline: var(--size-2-3);
  }

  .abele-task-header-view__recurrence .abele-obsidian-icon__text {
    display: none;
  }
}

.abele-task-header-view__content {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-top: 1px;
}
</style>
