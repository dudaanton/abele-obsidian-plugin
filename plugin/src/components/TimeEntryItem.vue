<template>
  <div v-if="entry.entryNotFound" class="abele-time-entry-item">
    <em class="abele-time-entry-item__content">Time entry not found</em>
  </div>
  <EntryRow
    v-else-if="entry.loaded"
    class="abele-time-entry-item"
    role="link"
    tabindex="0"
    @click="onCardClick"
    @keydown.enter.self="openFile(entry.entryPath)"
    @contextmenu.prevent="onContextMenu"
  >
    <span class="abele-time-entry-item__groups">
      <template v-for="(group, idx) in entry.groups" :key="idx">
        <ObsidianMarkdown
          trusted
          :text="ensureWikilinkAlias(group)"
          :file-path="entry.entryPath"
          class="abele-time-entry-item__link"
        />
        <span v-if="idx < entry.groups.length - 1">, </span>
      </template>
      <span v-if="!entry.groups.length" class="abele-time-entry-item__no-groups">Timer</span>
    </span>
    <!-- How long, in the column the day's total stands in. -->
    <template #codes>
      <span
        class="abele-time-entry-item__duration"
        :class="{ 'abele-time-entry-item__duration--active': entry.isActive }"
      >
        {{ entry.isActive ? elapsedText : durationText }}
      </span>
    </template>
    <template #meta>
      <span class="abele-time-entry-item__time-range">{{ timeRange }}</span>
    </template>
    <template v-if="entry.isActive" #actions>
      <ObsidianIcon icon="timer-off" label="Stop timer" @click.stop="stopTimer" />
    </template>
    <template v-else #aside>
      <ObsidianIcon icon="timer-reset" label="Start again" @click.stop="startNew" />
    </template>
  </EntryRow>
</template>

<script setup lang="ts">
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import { TimeEntry } from '@/entities/TimeEntry'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import EntryRow from './obsidian/EntryRow.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { ensureWikilinkAlias } from '@/helpers/pathsHelpers'
import { openFile } from '@/helpers/vaultUtils'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { Menu } from 'obsidian'
import dayjs from 'dayjs'
// One way of saying a duration across the lists, so a day's total and its entries read alike.
import { formatDuration } from '@/helpers/displayFormat'

const props = defineProps<{
  entry: TimeEntry
}>()

const elapsed = ref(0)
let interval: ReturnType<typeof setInterval> | null = null

const updateElapsed = () => {
  if (props.entry.isActive && props.entry.start) {
    elapsed.value = dayjs().diff(props.entry.start, 'second')
  }
}

onMounted(() => {
  props.entry.load()
  if (props.entry.isActive) {
    updateElapsed()
    interval = window.setInterval(updateElapsed, 1000)
  }
})

onUnmounted(() => {
  if (interval) window.clearInterval(interval)
})

const durationText = computed(() => formatDuration(props.entry.duration))
const elapsedText = computed(() => formatDuration(elapsed.value))

const timeRange = computed(() => {
  if (!props.entry.start) return ''
  const start = props.entry.start.format('HH:mm')
  if (props.entry.end) {
    const end = props.entry.end.format('HH:mm')
    return `${start} — ${end}`
  }
  return `${start} — ...`
})

const onCardClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.closest('a.internal-link') || target.closest('.abele-obsidian-icon')) return
  openFile(props.entry.entryPath)
}

const stopTimer = () => stopActiveTimeEntry()

const startNew = () => {
  createTimeEntry({ groups: [...props.entry.groups] }, false)
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
            title: 'Delete time entry',
            message: 'Are you sure you want to delete this time entry?',
          })
        ) {
          props.entry.remove()
        }
      })
  })
  menu.showAtPosition({ x: e.clientX, y: e.clientY })
}
</script>

<style lang="scss">
.abele-time-entry-item {
  p {
    margin: 0;
    word-break: break-word;
  }
}

.abele-time-entry-item__no-groups {
  color: var(--text-muted);
  font-style: italic;
}

.abele-time-entry-item__link {
  display: inline;

  p {
    display: inline;
  }

  // What the time went to reads as the row's title; accent only under the pointer.
  .internal-link {
    color: var(--text-normal);
    cursor: pointer;
    text-decoration: none;

    &:hover {
      color: var(--text-accent);
      text-decoration: underline;
    }
  }
}

.abele-time-entry-item__duration {
  color: var(--text-normal);
  font-variant-numeric: tabular-nums;

  &--active {
    color: var(--color-green);
  }
}

.abele-time-entry-item__time-range {
  font-variant-numeric: tabular-nums;
}
</style>
