<template>
  <div v-if="task.taskNotFound" class="abele-task-view">
    <em class="abele-task-view__content">Task not found</em>
    <ObsidianIcon icon="trash" @click="removeOrphaned" />
  </div>
  <div
    v-else-if="task.loaded"
    ref="taskEl"
    class="abele-task-view"
    :class="{ 'is-done': !!checked }"
    :data-abele-anchor="'task:' + task.taskPath"
    role="link"
    tabindex="0"
    @click="onCardClick"
    @keydown.enter.self="openFile(task.taskPath)"
    @contextmenu.prevent="onContextMenu"
  >
    <label class="task-list-label" contenteditable="false"
      ><input
        class="task-list-item-checkbox"
        type="checkbox"
        :checked="!!checked"
        @click.stop="task.toggle"
    /></label>
    <div class="abele-task-view__content">
      <div class="abele-task-view__line">
        <div class="abele-task-view__title">
          <ObsidianMarkdown
            v-if="contentLoaded"
            trusted
            :text="task.title ?? ''"
            :file-path="task.filePath"
          />
          <span
            v-for="label in labels"
            :key="label.text"
            class="abele-task-view__label"
            :class="`abele-task-view__label_${label.color}`"
            >{{ label.text }}</span
          >
        </div>
        <!-- State as codes on the first line, the words in each one's tooltip. -->
        <div class="abele-task-view__codes">
          <ObsidianIcon
            v-if="priorityMark"
            class="abele-task-view__priority"
            :icon="priorityMark.icon"
            :color="priorityMark.color"
            :tooltip="priorityMark.label"
            no-hover
          />
          <template v-if="atTimeline">
            <ObsidianIcon
              v-if="dateTimeText"
              class="abele-task-view__code"
              :text-right="dateTimeText"
              :tooltip="timeLeftText ? `Starts ${timeLeftText}` : 'Starts'"
              no-hover
            />
            <span v-if="timeLeftText" class="abele-task-view__time-left">{{ timeLeftText }}</span>
            <ObsidianIcon
              v-if="dueTimeText"
              class="abele-task-view__code"
              icon="calendar-clock"
              :text-right="dueTimeText"
              tooltip="Due"
              no-hover
            />
          </template>
          <template v-else-if="completedText">
            <ObsidianIcon
              class="abele-task-view__code"
              icon="check"
              :text-right="completedCode"
              :tooltip="`Completed ${completedText}`"
              no-hover
            />
          </template>
          <template v-else>
            <ObsidianIcon
              v-if="dateText"
              class="abele-task-view__code"
              :text-right="dateCode"
              :tooltip="`Date ${dateText} ${dateTimeText}`.trim() + diffWords(diffDateText)"
              no-hover
            />
            <ObsidianIcon
              v-if="dueText"
              class="abele-task-view__code"
              icon="calendar-clock"
              :text-right="dueCode"
              :color="isOverdue ? 'red' : undefined"
              :tooltip="`Due ${dueText} ${dueTimeText}`.trim() + diffWords(diffDueText)"
              no-hover
            />
          </template>
          <ObsidianIcon
            v-if="task.recurrence && !atTimeline"
            class="abele-task-view__code"
            icon="repeat"
            :tooltip="`Repeats ${task.recurrence}`"
            no-hover
          />
          <ObsidianIcon
            v-if="task.description"
            class="abele-task-view__more"
            :icon="showDescription ? 'chevron-up' : 'chevron-down'"
            :label="showDescription ? 'Hide description' : 'Show description'"
            @click.stop="toggleDescription"
          />
        </div>
      </div>
      <ObsidianMarkdown
        v-if="task.description && showDescription && contentLoaded"
        trusted
        :text="task.description"
        :file-path="task.filePath"
        class="abele-task-view__description"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { compactDate } from '@/helpers/datesHelper'
import { Task } from '@/entities/Task'
import dayjs from 'dayjs'
import { computed, onMounted, ref, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { labelColor, type TaskPriority } from '@/helpers/taskMeta'
import type { KitColor } from '@/constants/colors'
import { openFile } from '@/helpers/vaultUtils'
import { useOwnerVisibility } from '@/composables/useOwnerVisibility'
import { useDisplayClock } from '@/composables/useDisplayClock'
import { useDate } from '@/composables/useDate'
import { Menu } from 'obsidian'
import { useFooterTaskOpen } from '@/composables/useFooterView'

const props = defineProps<{
  task: Task
  atTimeline?: boolean
}>()

const taskEl = ref<HTMLElement | null>(null)
const clockVisible = ref(true)
const isVisible = useOwnerVisibility(taskEl, (visible) => {
  clockVisible.value = visible
})
const contentLoaded = ref(false)

watch(
  isVisible,
  () => {
    if (isVisible.value && !contentLoaded.value) {
      props.task.loadContent()
      contentLoaded.value = true
    }
  },
  {
    immediate: true,
  }
)

const PRIORITY_MARKS: Record<TaskPriority, { icon: string; color: KitColor; label: string }> = {
  high: { icon: 'chevron-up', color: 'red', label: 'High priority' },
  medium: { icon: 'equal', color: 'orange', label: 'Medium priority' },
  low: { icon: 'chevron-down', color: 'blue', label: 'Low priority' },
}

// Only on tasks without a date: the calendar orders by when, and a priority there would be a
// second order the list does not follow.
const priorityMark = computed(() =>
  props.task.priority && !props.task.dates.length ? PRIORITY_MARKS[props.task.priority] : null
)

const labels = computed(() => {
  const config = AbeleConfig.getInstance()
  void config.version.value
  return props.task.labels.map((text) => ({
    text,
    color: labelColor(text, config.taskLabelColors),
  }))
})

const checked = ref(props.task.completedAt)
watch(
  () => props.task.completedAt,
  (newVal) => {
    checked.value = newVal
  }
)

// Under a note, a task opened stays open when the note is opened again, so the rows under it
// come back where they were.
const openMemory = useFooterTaskOpen(() => props.task.taskPath)
const showDescription = ref(openMemory.initial)
const toggleDescription = () => {
  showDescription.value = !showDescription.value
  openMemory.record(showDescription.value)
}

const dueText = computed(() => {
  if (!props.task.due) return ''

  return props.task.due.format(DISPLAY_DATE_FORMAT)
})

const dueTimeText = computed(() => {
  if (!props.task.dueTime) return ''

  return props.task.dueTime.format('HH:mm')
})

const dateText = computed(() => {
  if (!props.task.date) return ''

  return props.task.date.format(DISPLAY_DATE_FORMAT)
})

const dateTimeText = computed(() => {
  if (!props.task.dateTime) return ''

  return props.task.dateTime.format('HH:mm')
})

// Until the first intersection report, keep the already visible date labels live. Content
// loading still waits for a positive report above; an explicit hidden report pauses both clocks.
const owner = () => taskEl.value?.ownerDocument ?? document
const { now: today } = useDate(clockVisible, owner)
const clock = useDisplayClock(
  'minute',
  () =>
    clockVisible.value && !!props.task.dateTime && !!props.atTimeline && !props.task.completedAt,
  owner,
  // Flooring the remaining minutes changes one second after the exact minute. Preserve
  // that display boundary without waking every task on every second.
  () => (props.task.dateTime?.valueOf() ?? 0) + 1000
)
const now = computed(() => dayjs(clock.value))

const timeLeftText = computed(() => {
  if (!props.task.dateTime || !props.atTimeline) return ''
  if (props.task.completedAt) return ''

  const target = props.task.dateTime
  const diff = target.diff(now.value)

  if (diff <= 0) return ''

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  return `(in ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')})`
})

const getDiffText = (date: dayjs.Dayjs | null) => {
  if (!date) return ''

  const diff = date.startOf('day').diff(today.value.startOf('day'), 'day')

  if (diff === 0) return '(Today)'
  if (diff === 1) return '(Tomorrow)'
  if (diff === -1) return '(Yesterday)'
  if (diff > 1) return `(${diff} days left)`
  if (diff < -1) return `(${Math.abs(diff)} days ago)`

  return ''
}

const diffDueText = computed(() => {
  return getDiffText(props.task.due)
})

const diffDateText = computed(() => {
  return getDiffText(props.task.date)
})

// A date as a code: the near days by name, the rest as the short date the other lists use.
const dayCode = (date: dayjs.Dayjs | null, time: dayjs.Dayjs | null) => {
  if (!date) return ''
  const diff = date.startOf('day').diff(today.value.startOf('day'), 'day')
  const day =
    diff === 0
      ? 'Today'
      : diff === 1
        ? 'Tomorrow'
        : diff === -1
          ? 'Yesterday'
          : compactDate(date, today.value)
  return time ? `${day} ${time.format('HH:mm')}` : day
}

const dateCode = computed(() => dayCode(props.task.date, props.task.dateTime))
const dueCode = computed(() => dayCode(props.task.due, props.task.dueTime))
const completedCode = computed(() =>
  props.task.completedAt ? dayCode(props.task.completedAt, null) : ''
)

const diffWords = (diff: string) => (diff ? `, ${diff.replace(/[()]/g, '').toLowerCase()}` : '')

const completedText = computed(() => {
  if (!props.task.completedAt) return ''

  return props.task.completedAt.format(DISPLAY_DATE_FORMAT)
})

const isOverdue = computed(() => {
  if (!props.task.due) return false
  if (props.task.completedAt) return false

  const due = props.task.due

  return due.startOf('day').isBefore(today.value.startOf('day'))
})

const onCardClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (
    target.closest('a.internal-link') ||
    target.closest('.abele-obsidian-icon') ||
    target.closest('label')
  )
    return
  // A drag across the words to select them ends in a click too; it is not a request to open.
  const selection = target.ownerDocument.getSelection()
  if (selection && !selection.isCollapsed && taskEl.value?.contains(selection.anchorNode)) return
  openFile(props.task.taskPath)
}

const onContextMenu = (e: MouseEvent) => {
  const menu = new Menu()
  menu.addItem((item) => {
    item
      .setTitle('Delete')
      .setIcon('trash')
      .onClick(async () => {
        if (
          await confirmAction(GlobalStore.getInstance().app, {
            title: 'Delete task',
            message: 'Are you sure you want to delete this task?',
          })
        ) {
          props.task.remove()
        }
      })
  })
  menu.showAtPosition({ x: e.clientX, y: e.clientY })
}

const removeOrphaned = () => {
  props.task.removeOrphanedLink()
}

onMounted(() => {
  props.task.load()
})
</script>

<style lang="scss">
.abele-task-view {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  padding: var(--size-2-2) var(--size-2-1);
  cursor: pointer;
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  p {
    margin: 0;
    word-break: break-word;
  }

  .task-list-label {
    padding: 0;
    margin-inline-start: -0.25em;

    input {
      top: -0.1em;
      vertical-align: middle;
      margin-inline-start: var(--checkbox-margin-inline-start);
      margin-inline-end: 0.25em;
    }
  }

  // Done reads the way Obsidian draws a ticked list item.
  &.is-done .abele-task-view__title p {
    color: var(--checklist-done-color, var(--text-muted));
    text-decoration: var(--checklist-done-decoration, line-through);
  }
}

.abele-task-view__content {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-top: 1px;
}

.abele-task-view__line {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
}

// The labels follow the words in the same flow of text, as quiet words with a dot of their colour.
.abele-task-view__title {
  flex: 1;
  min-width: 0;

  div,
  p {
    display: inline;
  }
}

.abele-task-view__label {
  margin-inline-start: var(--size-4-2);
  font-size: var(--font-smallest);
  color: var(--text-muted);
  white-space: nowrap;

  &::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-inline-end: var(--size-2-2);
    border-radius: 50%;
    vertical-align: middle;
    background-color: var(--abele-task-label-color, var(--text-faint));
  }
}

@each $name in red, orange, yellow, green, cyan, blue, purple, pink {
  .abele-task-view__label_#{$name} {
    --abele-task-label-color: var(--color-#{$name});
  }
}

// Codes stay on the first line at the end, however long the words get.
.abele-task-view__codes {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  // As tall as the first line of words, so the codes sit level with it.
  height: calc(var(--line-height-normal) * 1em);
  gap: var(--size-2-2);

  > * {
    font-size: var(--font-smallest);
  }

  color: var(--text-muted);
  white-space: nowrap;

  .abele-obsidian-icon {
    height: auto;
    padding: 0;
  }

  .abele-obsidian-icon__icon {
    height: auto;
  }

  svg {
    width: var(--icon-xs);
    height: var(--icon-xs);
  }
}

.abele-task-view__more {
  color: var(--text-faint);
}

.abele-task-view__time-left {
  color: var(--text-faint);
}

.abele-task-view__description {
  margin-top: var(--size-2-1);

  p {
    color: var(--text-muted);
  }
}
</style>
