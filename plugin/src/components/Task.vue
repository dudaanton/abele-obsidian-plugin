<template>
  <div v-if="task.taskNotFound" class="abele-task-view">
    <em class="abele-task-view__content">Task not found</em>
    <ObsidianIcon icon="trash" @click="removeOrphaned" />
  </div>
  <div v-else-if="task.loaded" ref="taskEl" class="abele-task-view">
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
      @click="toggleDescription"
    />
    <div class="abele-task-view__buttons abele-task-view__buttons_full">
      <ObsidianIcon icon="edit" @click="edit" />
      <ObsidianIcon icon="trash" @click="promptRemove" />
    </div>
    <div class="abele-task-view__buttons abele-task-view__buttons_small">
      <ObsidianIcon ref="menuButton" icon="edit" @click="menu.open" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { Task } from '@/entities/Task'
import dayjs from 'dayjs'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { openFile } from '@/helpers/vaultUtils'
import { useElementVisibility, useIntervalFn } from '@vueuse/core'
import Icon from './obsidian/Icon.vue'
import { Choice, useMenu } from '@/composables/useMenu'

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

const menuButton = ref<InstanceType<typeof Icon> | null>(null)

const menuChoices = computed<Choice[]>(() => {
  return [
    { title: 'Edit', event: 'edit' },
    { title: 'Delete', event: 'delete' },
  ]
})

const handleMenuSelect = (event: string) => {
  if (event === 'edit') {
    edit()
  } else if (event === 'delete') {
    promptRemove()
  }
}

const menu = useMenu(menuButton, menuChoices, handleMenuSelect)

const edit = () => {
  openFile(props.task.taskPath)
}

const promptRemove = () => {
  if (confirm('Are you sure you want to delete this task?')) {
    props.task.remove()
  }
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

.abele-task-view__buttons {
  align-items: flex-start;
  gap: 0.5em;

  &_full {
    display: flex;
  }

  &_small {
    display: none;
  }
}

@media (max-width: 600px) {
  .abele-task-view__buttons {
    &_full {
      display: none;
    }

    &_small {
      display: flex;
    }
  }
}

.abele-task-view__content {
  flex: 1;
  overflow-wrap: break-word;
  padding-top: 1px;
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
