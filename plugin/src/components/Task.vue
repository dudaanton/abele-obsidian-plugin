<template>
  <div v-if="task.taskNotFound" class="abele-task-view">
    <em class="abele-task-view__content">Task not found</em>
    <ObsidianIcon icon="trash" @click="removeOrphaned" />
  </div>
  <div
    v-else-if="task.loaded"
    ref="taskEl"
    class="abele-task-view"
    @click="onCardClick"
    @contextmenu.prevent="onContextMenu"
  >
    <div v-if="isOverdue && !atTimeline" class="abele-task-view__indicator" />
    <label class="task-list-label" contenteditable="false"
      ><input
        class="task-list-item-checkbox"
        type="checkbox"
        :checked="!!checked"
        @click.stop="task.toggle"
    /></label>
    <div class="abele-task-view__content">
      <ObsidianMarkdown v-if="contentLoaded" :text="task.title ?? ''" :file-path="task.filePath" />
      <div v-if="labels.length || priorityMark" class="abele-task-view__labels">
        <ObsidianIcon
          v-if="priorityMark"
          class="abele-task-view__priority"
          :icon="priorityMark.icon"
          :color="priorityMark.color"
          :tooltip="priorityMark.label"
          no-hover
        />
        <Badge v-for="label in labels" :key="label.text" :text="label.text" :color="label.color" />
      </div>
      <ObsidianMarkdown
        v-if="task.description && showDescription && contentLoaded"
        :text="task.description"
        :file-path="task.filePath"
        class="abele-task-view__description"
      />
      <div v-if="atTimeline" class="abele-task-view__info">
        <span v-if="dateTimeText"
          >at <b>{{ dateTimeText }}</b></span
        >
        <span v-if="timeLeftText" class="abele-task-view__time-left">{{ timeLeftText }}</span>
        <span v-if="dueTimeText"
          >due <b>{{ dueTimeText }}</b></span
        >
      </div>
      <div v-else>
        <div v-if="dateText" class="abele-task-view__info">
          Date: <b>{{ dateText }} {{ dateTimeText }}</b>
          <span v-if="diffDateText && !completedText">{{ diffDateText }}</span>
        </div>
        <div v-if="dueText" class="abele-task-view__info">
          Due: <b>{{ dueText }} {{ dueTimeText }}</b>
          <span v-if="diffDueText && !completedText">{{ diffDueText }}</span>
        </div>
        <div v-if="completedText" class="abele-task-view__info">
          <b>Completed: </b>{{ completedText }}
        </div>
      </div>
    </div>
    <ObsidianIcon
      v-if="task.description"
      :icon="showDescription ? 'chevron-up' : 'chevron-down'"
      @click.stop="toggleDescription"
    />
  </div>
</template>

<script setup lang="ts">
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { Task } from '@/entities/Task'
import dayjs from 'dayjs'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import Badge from './obsidian/Badge.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { labelColor, type TaskPriority } from '@/helpers/taskMeta'
import type { KitColor } from '@/constants/colors'
import { openFile } from '@/helpers/vaultUtils'
import { useElementVisibility, useIntervalFn } from '@vueuse/core'
import { Menu } from 'obsidian'

const props = defineProps<{
  task: Task
  atTimeline?: boolean
}>()

const taskEl = ref(null)
const isVisible = useElementVisibility(taskEl)
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

const showDescription = ref(false)
const toggleDescription = () => {
  showDescription.value = !showDescription.value
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

const now = ref(dayjs())
const { pause: pauseTimer } = useIntervalFn(() => {
  now.value = dayjs()
}, 1000)

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

onUnmounted(() => {
  pauseTimer()
})

const getDiffText = (date: dayjs.Dayjs | null) => {
  if (!date) return ''

  const now = dayjs()
  const diff = date.startOf('day').diff(now.startOf('day'), 'day')

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

const completedText = computed(() => {
  if (!props.task.completedAt) return ''

  return props.task.completedAt.format(DISPLAY_DATE_FORMAT)
})

const isOverdue = computed(() => {
  if (!props.task.due) return false
  if (props.task.completedAt) return false

  const now = dayjs()
  const due = props.task.due

  return due.startOf('day').isBefore(now.startOf('day'))
})

const onCardClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (
    target.closest('a.internal-link') ||
    target.closest('.abele-obsidian-icon') ||
    target.closest('label')
  )
    return
  openFile(props.task.taskPath)
}

const onContextMenu = (e: MouseEvent) => {
  const menu = new Menu()
  menu.addItem((item) => {
    item
      .setTitle('Delete')
      .setIcon('trash')
      .onClick(() => {
        if (confirm('Are you sure you want to delete this task?')) {
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
  gap: 0.5em;
  margin-bottom: 0.25em;
  padding: 0.25em 0;
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
}

.abele-task-view__content {
  flex: 1;
  overflow-wrap: break-word;
  padding-top: 1px;
}

.abele-task-view__labels {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-2);
  margin-top: var(--size-2-1);
}

// Sized to the chips beside it, so a row with a glyph is no taller than one without.
.abele-task-view__labels .abele-task-view__priority {
  flex: 0 0 auto;
  height: auto;
  padding: 0;

  .abele-obsidian-icon__icon {
    height: auto;
  }

  svg {
    width: var(--icon-xs);
    height: var(--icon-xs);
  }
}

.abele-task-view__indicator {
  width: 3px;
  background-color: var(--background-modifier-error);
  border-radius: 2px;
  align-self: stretch;
}

.abele-task-view__info {
  display: flex;
  flex-wrap: wrap;
  margin-top: 0.25em;
  font-size: 0.85em;
  gap: 0.25em;
  color: var(--text-muted);

  b {
    font-weight: 700;
  }
}

.abele-task-view__description {
  p {
    color: var(--text-muted);
  }
}
</style>
