<template>
  <!-- What the panel shows of the place: its files, its changes, its history, its pull requests.
       Glyphs in a row as Obsidian's sidebar tabs are, a count beside the ones that have one; the
       words in the tooltips. Under them, the branch or version the changes are counted against
       when it is not what git has saved. -->
  <div class="abele-node-modes" :class="{ 'abele-node-modes_header': header }">
    <div class="abele-node-modes__row" role="tablist" aria-label="What the panel shows">
      <Icon
        v-for="m in shown"
        :key="m.id"
        class="abele-node-modes__mode"
        :class="{
          'nav-action-button': header,
          'abele-node-modes__mode_waiting': 'waiting' in m && m.waiting,
        }"
        role="tab"
        :icon="m.icon"
        :active="mode === m.id"
        :aria-selected="mode === m.id"
        :text-right="m.count ? String(m.count) : undefined"
        :tooltip="m.tooltip"
        @click="emit('update:mode', m.id)"
      />
    </div>
    <div v-if="against" class="abele-node-modes__against">
      <Icon icon="git-compare" size="xs" :interactive="false" />
      <span
        ref="againstEl"
        class="abele-node-modes__against-name"
        role="button"
        tabindex="0"
        @click="emit('compare')"
        @keydown.enter.prevent="emit('compare')"
        >vs {{ against }}</span
      >
      <Icon
        icon="x"
        size="xs"
        :tooltip="`Stop comparing with ${against}: changes against what git has saved`"
        @click="emit('stop-compare')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The node panel's modes under its place: files, changes, history and pull requests. A folder
 * without git has files only; a folder no git service knows has no pull requests.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'

import type { NodePanelMode as NodeMode } from './types'

const props = defineProps<{
  mode: NodeMode
  git: boolean
  /** The folder lives on a git service, so it can have pull requests. */
  pulls: boolean
  changes?: number
  openPulls?: number
  /** The node's sessions at this place: how many, and how many wait for you. Unset, the panel
   *  has no sessions mode. */
  sessions?: { total: number; waiting: number }
  /** In the panel's header, as the file explorer's buttons: centred, its buttons' look. */
  header?: boolean
  /** The branch, tag or commit changes are counted against; empty is what git has saved. */
  against?: string
}>()
const emit = defineEmits<{
  'update:mode': [NodeMode]
  compare: []
  'stop-compare': []
}>()

const shown = computed(() =>
  [
    { id: 'files' as const, icon: 'folder-tree', tooltip: 'Files', on: true, count: 0 },
    {
      id: 'changes' as const,
      icon: 'file-diff',
      tooltip: props.changes
        ? `Changes: ${props.changes} ${props.changes === 1 ? 'file' : 'files'}${props.against ? ` against ${props.against}` : ''}`
        : 'Changes: none',
      on: props.git,
      count: props.changes ?? 0,
    },
    { id: 'history' as const, icon: 'history', tooltip: 'History', on: props.git, count: 0 },
    {
      id: 'pulls' as const,
      icon: 'git-pull-request',
      tooltip: props.openPulls
        ? `Pull requests: ${props.openPulls} open`
        : 'Pull requests: none open',
      on: props.git && props.pulls,
      count: props.openPulls ?? 0,
    },
    {
      id: 'sessions' as const,
      icon: 'messages-square',
      tooltip: props.sessions?.waiting
        ? `Sessions: ${props.sessions.waiting} waiting for you of ${props.sessions.total}`
        : `Sessions: ${props.sessions?.total ?? 0}`,
      on: !!props.sessions,
      // Only those waiting for you are counted, in orange: the rest are there when you look.
      count: props.sessions?.waiting ?? 0,
      waiting: !!props.sessions?.waiting,
    },
  ].filter((m) => m.on)
)

const againstEl = ref<HTMLElement>()
const tip = () =>
  againstEl.value &&
  setTooltip(againstEl.value, `Changes are counted against ${props.against} · choose another`)
onMounted(tip)
watch(() => props.against, tip, { flush: 'post' })
</script>

<style lang="scss">
.abele-node-modes {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  padding-inline: var(--size-4-2);
}

.abele-node-modes__row {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
}

.abele-node-modes_header {
  padding-inline: 0;

  .abele-node-modes__row {
    justify-content: center;
  }
}

// A count beside a glyph is a code of its own: small and quiet, as the tab's other numbers.
.abele-node-modes__mode {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}
.abele-node-modes__mode_waiting .abele-obsidian-icon__text {
  color: var(--color-orange);
}

.abele-node-modes__against {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding-inline: var(--size-2-3);
  font-size: var(--font-ui-small);
  color: var(--text-muted);

  .abele-icon:first-child {
    color: var(--text-faint);
  }
}

.abele-node-modes__against-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: var(--cursor);

  &:hover {
    color: var(--text-normal);
  }
}
</style>
