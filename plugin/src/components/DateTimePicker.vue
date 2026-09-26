<template>
  <div class="abele-datetime-picker">
    <Calendar :selected-date="selectedDate" show-tasks @date-selected="onDateSelected" />

    <div v-if="selectedDate && tasksForDay.length" class="abele-datetime-picker__tasks-preview">
      <div class="abele-datetime-picker__tasks-header">Scheduled tasks</div>
      <div v-for="task in tasksForDay" :key="task.id" class="abele-datetime-picker__task-item">
        <span v-if="getTaskTimeForDay(task)" class="abele-datetime-picker__task-time">
          {{ getTaskTimeForDay(task) }}
        </span>
        <span class="abele-datetime-picker__task-title">{{ task.title || task.taskName }}</span>
      </div>
    </div>

    <div class="abele-datetime-picker__time">
      <div class="abele-datetime-picker__time-label">Time (optional)</div>
      <div class="abele-datetime-picker__time-input-row">
        <input
          type="text"
          placeholder="HH:mm"
          maxlength="5"
          :value="timeDisplay"
          @beforeinput="onTimeBeforeInput"
          @input="timeDisplay = ($event.target as HTMLInputElement).value"
        />
        <ObsidianIcon icon="clock" @click="nativeTimeInput?.showPicker()" />
        <input
          ref="nativeTimeInput"
          type="time"
          class="abele-datetime-picker__time-native"
          :value="parseTime(timeDisplay) ?? ''"
          @input="setTime(($event.target as HTMLInputElement).value || null)"
        />
      </div>
      <div class="abele-datetime-picker__time-choices">
        <ObsidianIcon
          v-for="time in timeChoices"
          :key="time"
          :text-right="time"
          with-bg
          :class="{ 'abele-datetime-picker__time-choice_active': timeDisplay === time }"
          @click="setTime(timeDisplay === time ? null : time)"
        />
      </div>
    </div>

    <div class="abele-datetime-picker__buttons">
      <ObsidianButton text="Confirm" accent :disabled="!selectedDate" @click="confirm" />
      <ObsidianButton text="Clear" @click="emit('clear')" />
      <ObsidianButton text="Cancel" @click="emit('cancel')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, unref } from 'vue'
import dayjs from 'dayjs'
import Calendar from './Calendar.vue'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Task } from '@/entities/Task'
import { TasksList } from '@/entities/TasksList'
import { DATE_FORMAT } from '@/constants/dates'

const props = defineProps<{
  initialDate?: dayjs.Dayjs
  initialTime?: string | null
}>()

const emit = defineEmits<{
  (e: 'confirm', result: { date: dayjs.Dayjs; time: string | null }): void
  (e: 'clear'): void
  (e: 'cancel'): void
}>()

const selectedDate = ref<dayjs.Dayjs | undefined>(props.initialDate ?? dayjs())
const timeDisplay = ref<string>(props.initialTime ?? '')
const nativeTimeInput = ref<HTMLInputElement | null>(null)

const timeChoices = AbeleConfig.getInstance().tasksTimeChoices

const onDateSelected = (date: dayjs.Dayjs) => {
  selectedDate.value = date
}

const setTime = (time: string | null) => {
  timeDisplay.value = time ?? ''
}

const parseTime = (value: string): string | null => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  if (hours > 23 || minutes > 59) return null
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0')
}

// TODO: consider proper mask
const onTimeBeforeInput = (e: InputEvent) => {
  const el = e.target as HTMLInputElement

  // Allow deletion
  if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') return

  // Block non-digit input
  if (e.data && !/^\d+$/.test(e.data)) {
    e.preventDefault()
    return
  }

  // Auto-insert colon after 2nd digit
  if (e.data && /^\d$/.test(e.data)) {
    const pos = el.selectionStart ?? 0
    const current = el.value
    const before = current.slice(0, pos)
    const after = current.slice(pos)
    const next = before + e.data + after

    // Auto-insert colon when typing produces 3+ digits without one
    const digitsInNext = next.replace(/[^\d]/g, '')
    if (digitsInNext.length >= 3 && !next.includes(':')) {
      e.preventDefault()
      const newVal = digitsInNext.slice(0, 2) + ':' + digitsInNext.slice(2, 4)
      el.value = newVal.slice(0, 5)
      timeDisplay.value = el.value
      el.setSelectionRange(pos + 2, pos + 2) // +2 for the inserted colon + typed digit
      return
    }

    // If we just typed the 2nd digit and there's no colon yet
    if (pos === 1 && !next.includes(':') && next.length >= 2) {
      e.preventDefault()
      const newVal = next.slice(0, 2) + ':' + next.slice(2, 4)
      el.value = newVal.slice(0, 5)
      timeDisplay.value = el.value
      el.setSelectionRange(3, 3)
      return
    }

    // If cursor is at position 2 and next char is colon, skip over it
    if (pos === 2 && current[2] === ':') {
      e.preventDefault()
      el.setSelectionRange(3, 3)
      // Re-dispatch as if typed at position 3
      const newVal = current.slice(0, 3) + e.data + current.slice(4)
      el.value = newVal.slice(0, 5)
      timeDisplay.value = el.value
      el.setSelectionRange(4, 4)
      return
    }
  }
}

const getTaskTimeForDay = (task: Task): string | null => {
  if (!selectedDate.value) return null
  if (task.dateTime && task.date?.isSame(selectedDate.value, 'day')) {
    return task.dateTime.format('HH:mm')
  }
  if (task.dueTime && task.due?.isSame(selectedDate.value, 'day')) {
    return task.dueTime.format('HH:mm')
  }
  return null
}

const tasksForDay = computed(() => {
  if (!selectedDate.value) return []

  const { tasksList: tasksListRef } = GlobalStore.getInstance()
  const tasksList = unref(tasksListRef) as TasksList
  if (!tasksList) return []

  const dateStr = selectedDate.value.format(DATE_FORMAT)

  return Array.from(tasksList.tasks.values())
    .filter((t) => !t.taskNotFound && !t.completedAt && t.dates.includes(dateStr))
    .sort((a, b) => {
      const aTime = getTaskTimeForDay(a)
      const bTime = getTaskTimeForDay(b)
      if (aTime && bTime) return aTime.localeCompare(bTime)
      if (aTime) return -1
      if (bTime) return 1
      return 0
    })
})

const confirm = () => {
  if (!selectedDate.value) return
  const time = timeDisplay.value ? parseTime(timeDisplay.value) : null
  emit('confirm', { date: selectedDate.value, time })
}
</script>

<style lang="scss">
.abele-datetime-picker {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
  padding-top: var(--p-spacing);
}

.abele-datetime-picker__tasks-preview {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 4);
  padding: calc(var(--p-spacing) / 2);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  max-height: 120px;
  overflow-y: auto;
}

.abele-datetime-picker__tasks-header {
  font-size: var(--font-small);
  color: var(--text-muted);
  font-weight: bold;
  margin-bottom: calc(var(--p-spacing) / 4);
}

.abele-datetime-picker__task-item {
  display: flex;
  gap: calc(var(--p-spacing) / 2);
  font-size: var(--font-small);
}

.abele-datetime-picker__task-time {
  color: var(--text-muted);
  white-space: nowrap;
}

.abele-datetime-picker__task-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-datetime-picker__time {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
}

.abele-datetime-picker__time-label {
  font-size: var(--font-small);
  color: var(--text-muted);
}

.abele-datetime-picker__time-input-row {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);

  input {
    width: 80px;
    min-width: 80px;
  }
}

.abele-datetime-picker__time-native {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.abele-datetime-picker__time-choices {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
  flex-wrap: wrap;
}

.abele-datetime-picker__time-choice_active {
  background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l)) !important;
  color: var(--text-on-accent) !important;
}

.abele-datetime-picker__buttons {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
}
</style>
