<template>
  <div v-if="entry.entryNotFound" class="abele-time-entry-item">
    <em class="abele-time-entry-item__content">Time entry not found</em>
  </div>
  <div
    v-else-if="entry.loaded"
    class="abele-time-entry-item"
    @click="onCardClick"
    @contextmenu.prevent="onContextMenu"
  >
    <div class="abele-time-entry-item__content">
      <span class="abele-time-entry-item__groups">
        <template v-for="(group, idx) in entry.groups" :key="idx">
          <ObsidianMarkdown
            :text="ensureWikilinkAlias(group)"
            :file-path="entry.entryPath"
            class="abele-time-entry-item__link"
          />
          <span v-if="idx < entry.groups.length - 1">, </span>
        </template>
        <span v-if="!entry.groups.length" class="abele-time-entry-item__no-groups">Timer</span>
      </span>
    </div>
    <div class="abele-time-entry-item__right">
      <span
        class="abele-time-entry-item__duration"
        :class="{ 'abele-time-entry-item__duration--active': entry.isActive }"
      >
        {{ entry.isActive ? elapsedText : durationText }}
      </span>
      <span class="abele-time-entry-item__time-range">{{ timeRange }}</span>
    </div>
    <ObsidianIcon
      v-if="entry.isActive"
      icon="timer-off"
      tooltip="Stop timer"
      @click.stop="stopTimer"
    />
    <ObsidianIcon v-else icon="timer-reset" tooltip="Start new" @click.stop="startNew" />
  </div>
</template>

<script setup lang="ts">
import { TimeEntry } from '@/entities/TimeEntry'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { ensureWikilinkAlias } from '@/helpers/pathsHelpers'
import { openFile } from '@/helpers/vaultUtils'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { Menu } from 'obsidian'
import dayjs from 'dayjs'

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
    interval = setInterval(updateElapsed, 1000)
  }
})

onUnmounted(() => {
  if (interval) clearInterval(interval)
})

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h > 0) return `${h}h ${pad(m)}m`
  return `${m}m`
}

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
      .onClick(() => {
        if (confirm('Are you sure you want to delete this time entry?')) {
          props.entry.remove()
        }
      })
  })
  menu.showAtPosition({ x: e.clientX, y: e.clientY })
}
</script>

<style lang="scss">
.abele-time-entry-item {
  display: flex;
  align-items: center;
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
}

.abele-time-entry-item__content {
  flex: 1;
  min-width: 0;
}

.abele-time-entry-item__groups {
  min-width: 0;
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

  .internal-link {
    color: var(--text-accent);
    cursor: pointer;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}

.abele-time-entry-item__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
}

.abele-time-entry-item__duration {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--text-muted);

  &--active {
    color: var(--text-success);
    font-weight: var(--font-semibold);
  }
}

.abele-time-entry-item__time-range {
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--text-faint);
}
</style>
