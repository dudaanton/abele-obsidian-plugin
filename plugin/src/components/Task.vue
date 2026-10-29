<template>
  <div v-if="task.taskNotFound" class="abele-task-view">
    <em class="abele-task-view__content">{{ t('area.taskNotFound') }}</em>
    <ObsidianIcon icon="trash" @click="removeOrphaned" />
  </div>
  <EntryRow
    v-else-if="task.loaded"
    ref="rowEl"
    class="abele-task-view"
    :class="{ 'is-done': !!checked }"
    :data-abele-anchor="'task:' + task.taskPath"
    role="link"
    tabindex="0"
    :more="task.description ? showDescription : undefined"
    @update:more="toggleDescription"
    @click="onCardClick"
    @keydown.enter.self="openFile(task.taskPath)"
    @contextmenu.prevent="onContextMenu"
  >
    <template #leading>
      <!-- Priority is the colour of the box to tick, the word in its tooltip. -->
      <label
        class="task-list-label"
        :class="priorityMark ? `abele-task-view__check_${priorityMark.color}` : undefined"
        :aria-label="priorityMark?.label"
        contenteditable="false"
        ><input
          class="task-list-item-checkbox"
          type="checkbox"
          :checked="!!checked"
          @click.stop="task.toggle"
      /></label>
    </template>
    <div class="abele-task-view__title">
      <ObsidianMarkdown
        v-if="contentLoaded"
        trusted
        :text="task.title ?? ''"
        :file-path="task.taskPath"
      />
    </div>
    <!-- State as codes, the words in each one's tooltip. -->
    <template #codes>
      <!-- Done of all the subtasks; pressed, they open under the row. -->
      <ObsidianIcon
        v-if="subtasks"
        class="abele-task-view__code abele-task-view__subtasks"
        :class="{ 'is-complete': subtasks.done === subtasks.total }"
        icon="list-tree"
        :text-right="`${subtasks.done}/${subtasks.total}`"
        role="button"
        :aria-expanded="!!subtasksOpen"
        :tooltip="
          t('area.subtasksToggle', {
            done: subtasks.done,
            total: subtasks.total,
            action: subtasksOpen ? t('area.hide') : t('area.show'),
          })
        "
        @click.stop="emit('toggle-subtasks')"
      />
      <ObsidianIcon
        v-if="circular?.length"
        class="abele-task-view__code"
        icon="alert-triangle"
        color="red"
        :tooltip="circularText"
        no-hover
      />
      <template v-if="atTimeline">
        <ObsidianIcon
          v-if="dateTimeText"
          class="abele-task-view__code"
          :text-right="dateTimeText"
          :tooltip="
            timeLeftText
              ? t('area.startsValue', { value: timeLeftText.replace(/[()]/g, '') })
              : t('area.starts')
          "
          no-hover
        />
        <ObsidianIcon
          v-if="dueTimeText"
          class="abele-task-view__code"
          icon="calendar-clock"
          :text-right="dueTimeText"
          :tooltip="t('area.due')"
          no-hover
        />
      </template>
      <template v-else-if="completedText">
        <ObsidianIcon
          class="abele-task-view__code"
          icon="check"
          :text-right="completedCode"
          :tooltip="t('area.completedValue', { value: completedText })"
          no-hover
        />
      </template>
      <template v-else>
        <ObsidianIcon
          v-if="dateText"
          class="abele-task-view__code"
          :text-right="dateCode"
          :tooltip="
            t('area.dateValue', { value: `${dateText} ${dateTimeText}` }).trim() +
            diffWords(diffDateText)
          "
          no-hover
        />
        <ObsidianIcon
          v-if="dueText"
          class="abele-task-view__code"
          icon="calendar-clock"
          :text-right="dueCode"
          :color="isOverdue ? 'red' : undefined"
          :tooltip="
            t('area.dueValue', { value: `${dueText} ${dueTimeText}` }).trim() +
            diffWords(diffDueText)
          "
          no-hover
        />
      </template>
      <ObsidianIcon
        v-if="task.recurrence && !atTimeline"
        class="abele-task-view__code"
        icon="repeat"
        :tooltip="t('area.repeatsValue', { value: task.recurrence })"
        no-hover
      />
    </template>
    <!-- The labels under the name, quiet words each with a dot of its colour. -->
    <template v-if="labels.length || parent?.length" #meta>
      <span v-if="parent?.length" class="abele-task-view__parent">{{
        t('area.inGroup', { name: parent.join(', ') })
      }}</span>
      <LabelDot
        v-for="label in labels"
        :key="label.text"
        class="abele-task-view__label"
        :text="label.text"
        :color="label.color"
      />
    </template>
    <template v-if="task.description && showDescription && contentLoaded" #detail>
      <ObsidianMarkdown
        trusted
        :text="task.description"
        :file-path="task.taskPath"
        class="abele-task-view__description"
      />
    </template>
  </EntryRow>
</template>

<script setup lang="ts">
import { currentLocale } from '@/i18n'
import { relativeDay } from '@/helpers/areaDateFormat'
import { areaDate } from '@/helpers/areaDateFormat'
import { t } from '@/i18n'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { GlobalStore } from '@/stores/GlobalStore'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { areaCompactDate as compactDate } from '@/helpers/areaDateFormat'
import { Task } from '@/entities/Task'
import dayjs from 'dayjs'
import { computed, inject, onMounted, ref, watch } from 'vue'
import { PRINT_MODE } from '@/markdown/printMode'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import EntryRow from './obsidian/EntryRow.vue'
import LabelDot from './obsidian/LabelDot.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { labelColor, type TaskPriority } from '@/helpers/taskMeta'
import type { KitColor } from '@/constants/colors'
import { openFile } from '@/helpers/vaultUtils'
import { useOwnerVisibility } from '@/composables/useOwnerVisibility'
import { useDisplayClock } from '@/composables/useDisplayClock'
import { useDate } from '@/composables/useDate'
import { Menu } from 'obsidian'
import { useFooterTaskOpen } from '@/composables/useFooterView'
import { addSubtask, detachFrom, makeSubtaskOf } from '@/commands/subtasks'

const props = defineProps<{
  task: Task
  atTimeline?: boolean
  /** Done of all its subtasks, when it has any. */
  subtasks?: { done: number; total: number } | null
  subtasksOpen?: boolean
  /** The other tasks in a circle of groups with this one. */
  circular?: string[]
  /** Its parents' names, when the list does not show it under them. */
  parent?: string[]
  /** Its parents, for the menu's way to leave one. */
  parents?: Task[]
}>()
const emit = defineEmits<{ (e: 'toggle-subtasks'): void }>()

const circularText = computed(() => {
  const others = props.circular ?? []
  const me = props.task.title || props.task.taskName
  return others.length === 1 && others[0] === me
    ? t('area.circularSelf', { name: me })
    : t('area.circularOthers', { name: me, others: others.join(', ') })
})

const rowEl = ref<{ $el: HTMLElement } | null>(null)
const taskEl = computed(() => rowEl.value?.$el ?? null)
const clockVisible = ref(true)
const isVisible = useOwnerVisibility(taskEl, (visible) => {
  clockVisible.value = visible
})
const printing = inject(PRINT_MODE, false)
const contentLoaded = ref(printing)

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
  high: { icon: 'chevron-up', color: 'red', label: t('area.highPriority') },
  medium: { icon: 'equal', color: 'orange', label: t('area.mediumPriority') },
  low: { icon: 'chevron-down', color: 'blue', label: t('area.lowPriority') },
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

  return areaDate(props.task.due, DISPLAY_DATE_FORMAT)
})

const dueTimeText = computed(() => {
  if (!props.task.dueTime) return ''

  return props.task.dueTime.format('HH:mm')
})

const dateText = computed(() => {
  if (!props.task.date) return ''

  return areaDate(props.task.date, DISPLAY_DATE_FORMAT)
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

  return t('area.inClock', {
    time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  })
})

const getDiffText = (date: dayjs.Dayjs | null) => {
  if (!date) return ''

  const diff = date.startOf('day').diff(today.value.startOf('day'), 'day')

  if (currentLocale().language !== 'en') return `(${relativeDay(diff)})`
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
      ? relativeDay(0)
      : diff === 1
        ? relativeDay(1)
        : diff === -1
          ? relativeDay(-1)
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

  return areaDate(props.task.completedAt, DISPLAY_DATE_FORMAT)
})

const isOverdue = computed(() => {
  if (!props.task.due) return false
  if (props.task.completedAt) return false

  const due = props.task.due

  return due.startOf('day').isBefore(today.value.startOf('day'))
})

const onCardClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  // A link in the words is followed as it is in a note — a note, a web address, a tag — and
  // leaves the task where it is.
  if (target.closest('a') || target.closest('.abele-obsidian-icon') || target.closest('label'))
    return
  // A drag across the words to select them ends in a click too; it is not a request to open.
  const selection = target.ownerDocument.getSelection()
  if (selection && !selection.isCollapsed && taskEl.value?.contains(selection.anchorNode)) return
  openFile(props.task.taskPath)
}

const onContextMenu = (e: MouseEvent) => {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t('area.addSubtask'))
      .setIcon('list-plus')
      .onClick(() => void addSubtask(props.task.taskPath))
  )
  menu.addItem((item) =>
    item
      .setTitle(t('area.makeSubtaskOf'))
      .setIcon('list-tree')
      .onClick(() => {
        const list = GlobalStore.getInstance().tasksList.value
        makeSubtaskOf(props.task, [...(list?.tasks.values() ?? [])])
      })
  )
  for (const parent of props.parents ?? [])
    menu.addItem((item) =>
      item
        .setTitle(t('area.detachValue', { name: parent.title || parent.taskName }))
        .setIcon('unlink')
        .onClick(() => void detachFrom(props.task, parent))
    )
  menu.addSeparator()
  menu.addItem((item) => {
    item
      .setTitle(t('area.delete'))
      .setIcon('trash')
      .onClick(async () => {
        if (
          await confirmDialog({
            title: t('area.deleteTask'),
            message: t('area.areYouSureYouWantToDeleteThisTask'),
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
  p {
    margin: 0;
    word-break: break-word;
  }

  // Done reads the way Obsidian draws a ticked list item.
  &.is-done .abele-task-view__title p {
    color: var(--checklist-done-color, var(--text-muted));
    text-decoration: var(--checklist-done-decoration, line-through);
  }
}

.abele-task-view__title {
  div,
  p {
    display: inline;
  }
}

// Priority as the colour of the box, the way a list of tasks elsewhere tells them apart.
@each $name in red, orange, blue {
  .abele-task-view__check_#{$name} {
    --checkbox-border-color: var(--color-#{$name});
    --checkbox-border-color-hover: var(--color-#{$name});
  }
}

.abele-task-view__parent {
  color: var(--text-faint);
}

// All its subtasks done: the count says so in the colour of a ticked box.
.abele-task-view__subtasks.is-complete {
  color: var(--color-green);
}

.abele-task-view__description p {
  color: var(--text-muted);
}
</style>
