<template>
  <ObsidianModal :title="path ? 'Edit task' : 'New task'" size="tall" @close="onDialogClosed">
    <div class="abele-entry-form" @keydown="onKeydown">
      <div class="abele-entry-form__body">
        <ObsidianInput
          ref="titleInput"
          v-model="values.title"
          class="abele-entry-form__title"
          placeholder="What needs doing"
        />

        <div class="abele-entry-form__row">
          <span class="abele-entry-form__row-name">Date</span>
          <ObsidianButton
            :text="dateText || 'Set date'"
            icon="calendar-days"
            tooltip="Choose the day and time of the task"
            @click="picker = 'event'"
          />
          <ObsidianIcon
            v-if="values.date"
            class="abele-entry-form__clear"
            icon="x"
            tooltip="Remove the date"
            @click="clearDate('event')"
          />
        </div>

        <div class="abele-entry-form__row">
          <span class="abele-entry-form__row-name">Due</span>
          <ObsidianButton
            :text="dueText || 'Set due date'"
            icon="calendar-clock"
            tooltip="Choose the day and time it is due"
            @click="picker = 'due'"
          />
          <ObsidianIcon
            v-if="values.due"
            class="abele-entry-form__clear"
            icon="x"
            tooltip="Remove the due date"
            @click="clearDate('due')"
          />
        </div>

        <div class="abele-entry-form__row">
          <span class="abele-entry-form__row-name">Repeat</span>
          <ObsidianButton
            :text="values.recurrence || 'Does not repeat'"
            icon="repeat"
            tooltip="Choose how the task repeats"
            @click="recurrenceOpen = true"
          />
          <ObsidianIcon
            v-if="values.recurrence"
            class="abele-entry-form__clear"
            icon="x"
            tooltip="Stop repeating"
            @click="values.recurrence = null"
          />
        </div>

        <div class="abele-entry-form__label">Description</div>
        <NoteEditorField
          v-model="values.description"
          placeholder="Details, links, a checklist…"
          @submit="save"
        />
      </div>

      <div class="abele-entry-form__buttons">
        <ObsidianButton
          text="Open as note"
          icon="file-text"
          :disabled="saving"
          tooltip="Save and open the task as a note"
          @click="openAsNote"
        />
        <span class="abele-entry-form__spacer" />
        <ObsidianButton
          class="abele-entry-form__cancel"
          text="Cancel"
          tooltip="Close without saving"
          @click="close"
        />
        <ObsidianButton
          text="Save"
          accent
          :disabled="saving"
          tooltip="Save the task (Ctrl/Cmd+Enter)"
          @click="save"
        />
      </div>
    </div>

    <DateTimePickerModal
      v-if="picker"
      :mode="picker"
      :initial-date="pickerDate"
      :initial-time="picker === 'event' ? values.time : values.dueTime"
      @confirm="onPicked"
      @clear="clearDate(picker)"
      @cancel="picker = null"
    />

    <RecurrencePickerModal
      v-if="recurrenceOpen"
      :initial-pattern="values.recurrence"
      @confirm="onRecurrence"
      @clear="onRecurrence(null)"
      @cancel="recurrenceOpen = false"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * The task dialog: everything a task note holds, in one place, with the description in
 * Obsidian's own note editor. Saving writes the note the same way the plugin always has; "Open
 * as note" saves and goes to the note, for whatever the form does not cover.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianInput from './obsidian/Input.vue'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import NoteEditorField from './NoteEditorField.vue'
import DateTimePickerModal from './DateTimePickerModal.vue'
import RecurrencePickerModal from './RecurrencePickerModal.vue'
import { DATE_FORMAT, DISPLAY_DATE_FORMAT } from '@/constants/dates'
import type { TaskFormValues } from '@/helpers/entryForms'
import { saveTaskForm } from '@/commands/taskFormNote'
import { openFile } from '@/helpers/vaultUtils'
import { Notice } from 'obsidian'

const props = defineProps<{
  /** The note being edited; none for a new task. */
  path?: string
  initial: TaskFormValues
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** The note written, once it has been. */
  (e: 'saved', path: string): void
}>()

const values = reactive<TaskFormValues>({ ...props.initial })
const titleInput = ref<{ $el: HTMLInputElement } | null>(null)
const picker = ref<'event' | 'due' | null>(null)
const recurrenceOpen = ref(false)
const saving = ref(false)
let closed = false

const display = (date: string | null, time: string | null) =>
  date ? `${dayjs(date).format(DISPLAY_DATE_FORMAT)}${time ? ` ${time}` : ''}` : ''

const dateText = computed(() => display(values.date, values.time))
const dueText = computed(() => display(values.due, values.dueTime))

const pickerDate = computed(() => {
  const value = picker.value === 'due' ? values.due : values.date
  return value ? dayjs(value) : undefined
})

const onPicked = (result: { date: dayjs.Dayjs; time: string | null }) => {
  if (picker.value === 'due') {
    values.due = result.date.format(DATE_FORMAT)
    values.dueTime = result.time
  } else {
    values.date = result.date.format(DATE_FORMAT)
    values.time = result.time
  }
  picker.value = null
}

const clearDate = (which: 'event' | 'due' | null) => {
  if (which === 'due') {
    values.due = null
    values.dueTime = null
  } else {
    values.date = null
    values.time = null
  }
  picker.value = null
}

const onRecurrence = (pattern: string | null) => {
  values.recurrence = pattern
  recurrenceOpen.value = false
}

const close = () => {
  if (closed) return
  closed = true
  emit('close')
}

const onDialogClosed = () => close()

/** Writes the form and answers the note's path, or null when that did not work. */
const write = async (): Promise<string | null> => {
  if (saving.value) return null
  saving.value = true
  try {
    const path = await saveTaskForm({ ...values }, props.path)
    if (!path) new Notice('Could not save the task.')
    else emit('saved', path)
    return path
  } finally {
    saving.value = false
  }
}

const save = async () => {
  if (await write()) close()
}

const openAsNote = async () => {
  const path = await write()
  if (!path) return
  close()
  await openFile(path)
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void save()
  }
}

onMounted(() => {
  // A new task starts at its title; an existing one is opened to be looked at first.
  if (!props.path) titleInput.value?.$el?.focus()
})
</script>

<style lang="scss">
/**
 * The entry dialogs — a task, a transaction. The fields scroll; the buttons stay at the bottom,
 * where the keyboard leaves them in reach on a phone.
 */
.abele-entry-form {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: var(--size-4-3);
}

.abele-entry-form__body {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  // Room for a focused field's ring inside the scroller, given back by the margin; on the right
  // a wider lane, so that the scrollbar stands beside the fields rather than over them.
  padding: var(--size-4-1) var(--size-4-3) var(--size-4-1) var(--size-4-1);
  margin: calc(-1 * var(--size-4-1)) calc(-1 * var(--size-4-3)) calc(-1 * var(--size-4-1))
    calc(-1 * var(--size-4-1));

  // A column that scrolls would otherwise squeeze its fields to fit rather than scroll them.
  > * {
    flex-shrink: 0;
  }

  // The description takes whatever height the other fields leave, like the body of a note.
  > .abele-note-editor-field {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
}

.abele-entry-form__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-entry-form__row-name {
  flex: 0 0 5em;
  color: var(--text-muted);
}

/* On a phone the sheet's own close button is Cancel, and the row of buttons needs the room. */
body.is-phone .abele-entry-form__cancel {
  display: none;
}

.abele-entry-form__title {
  font-size: var(--font-ui-large);
}

.abele-entry-form__label {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  margin-top: var(--size-4-2);
}

.abele-entry-form__buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-entry-form__spacer {
  flex: 1 1 auto;
}
</style>
