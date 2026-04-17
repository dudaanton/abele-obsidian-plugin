<template>
  <div v-if="entry.entryNotFound" class="abele-time-entry-item">
    <em class="abele-time-entry-item__content">Time entry not found</em>
  </div>
  <div v-else-if="entry.loaded" class="abele-time-entry-item">
    <div class="abele-time-entry-item__content">
      <div class="abele-time-entry-item__main">
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
        <span
          class="abele-time-entry-item__duration"
          :class="{ 'abele-time-entry-item__duration--active': entry.isActive }"
        >
          {{ entry.isActive ? elapsedText : durationText }}
        </span>
      </div>
      <div class="abele-time-entry-item__info">
        <span>{{ timeRange }}</span>
        <span>{{ dateText }}</span>
      </div>
    </div>
    <div class="abele-time-entry-item__buttons">
      <ObsidianIcon
        v-if="entry.isActive"
        icon="timer-off"
        tooltip="Stop timer"
        @click.stop="stopTimer"
      />
      <ObsidianIcon
        v-else
        icon="timer-reset"
        tooltip="Start new timer with same groups"
        @click.stop="startNew"
      />
      <ObsidianIcon ref="menuButton" icon="edit" @click.stop="menu.open" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { TimeEntry } from '@/entities/TimeEntry'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import Icon from './obsidian/Icon.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { ensureWikilinkAlias } from '@/helpers/pathsHelpers'
import { openFile } from '@/helpers/vaultUtils'
import { createTimeEntry, stopActiveTimeEntry } from '@/commands/createTimeEntry'
import { Choice, useMenu } from '@/composables/useMenu'
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

const dateText = computed(() => {
  if (!props.entry.start) return ''
  return props.entry.start.format(DISPLAY_DATE_FORMAT)
})

const timeRange = computed(() => {
  if (!props.entry.start) return ''
  const start = props.entry.start.format('HH:mm')
  if (props.entry.end) {
    const end = props.entry.end.format('HH:mm')
    return `${start} — ${end}`
  }
  return `${start} — ...`
})

const edit = () => openFile(props.entry.entryPath)

const stopTimer = () => stopActiveTimeEntry()

const startNew = () => {
  createTimeEntry({ groups: [...props.entry.groups] }, false)
}

const promptRemove = () => {
  if (confirm('Are you sure you want to delete this time entry?')) {
    props.entry.remove()
  }
}

const menuButton = ref<InstanceType<typeof Icon> | null>(null)
const menuChoices = computed<Choice[]>(() => [
  { title: 'Edit', event: 'edit' },
  { title: 'Delete', event: 'delete' },
])
const handleMenuSelect = (event: string) => {
  if (event === 'edit') edit()
  else if (event === 'delete') promptRemove()
}
const menu = useMenu(menuButton, menuChoices, handleMenuSelect)
</script>

<style lang="scss">
.abele-time-entry-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
  margin-bottom: 0.25em;
  padding: 0.25em 0;

  p {
    margin: 0;
    word-break: break-word;
  }
}

.abele-time-entry-item__content {
  flex: 1;
  overflow-wrap: break-word;
  padding-top: 1px;
  min-width: 0;
}

.abele-time-entry-item__main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5em;
}

.abele-time-entry-item__groups {
  flex: 1;
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

.abele-time-entry-item__duration {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--text-muted);

  &--active {
    color: var(--text-success);
    font-weight: var(--font-semibold);
  }
}

.abele-time-entry-item__info {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 0.25em;
  font-size: 0.85em;
  gap: 0.25em;
  color: var(--text-muted);
}

.abele-time-entry-item__buttons {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
}
</style>
