<template>
  <!-- Another agent at work on this one's behalf, told like a run of tools: a quiet tree line
       with who and how many tasks, a dot for how it goes, and a way to its own tab. Open while it
       works, so what it does is in sight; folded once it is done. -->
  <TreeItem
    class="abele-chat-run abele-run"
    :class="[`abele-chat-run_${state}`, `abele-run_${run.status}`]"
    :icon="run.status === 'running' ? 'loader' : 'bot'"
    :text="summary"
    collapsible
    :collapsed="!expanded"
    @click="toggle"
  >
    <template #end>
      <span class="abele-chat-run__codes">
        <span
          ref="dot"
          class="abele-chat-run__dot"
          :class="state !== 'done' && `abele-chat-run__dot_${state}`"
          :role="state !== 'done' ? 'img' : undefined"
          :aria-label="state !== 'done' ? STATE_LABEL[state] : undefined"
        />
      </span>
    </template>
    <template #actions>
      <Icon
        icon="external-link"
        class="abele-run__open"
        size="xs"
        tooltip="Open this run in its own tab"
        @click.stop="openInTab"
      />
    </template>

    <div class="abele-run__body">
      <EmptyState v-if="loading" text="Loading the transcript…" />
      <EmptyState v-else-if="!branches.length" text="Nothing was recorded for this run." />

      <template v-else>
        <!-- One task: straight to its messages, with no list to click through. -->
        <AiRunBranch
          v-if="branches.length === 1"
          :branch="branches[0]"
          :show-item="false"
          :depth="depth"
        />

        <template v-else>
          <AiRunBranch
            v-for="(branch, idx) in visibleBranches"
            :key="idx"
            :branch="branch"
            :show-item="true"
            :depth="depth"
          />
          <div v-if="hasMore" ref="sentinel" class="abele-run__sentinel" />
        </template>
      </template>
    </div>
  </TreeItem>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue'
import { Notice, setTooltip } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import TreeItem from './obsidian/TreeItem.vue'
import EmptyState from './obsidian/EmptyState.vue'
import AiRunBranch from './AiRunBranch.vue'
import { ChatService } from '@/ai/ChatService'
import { RunStorage, type RunBranch } from '@/ai/RunStorage'
import { usePagedList } from '@/composables/usePagedList'
import type { SubAgentRunRef } from '@/ai/types'

/** Branches shown at once before scrolling loads more — they can each hold a conversation. */
const PAGE_SIZE = 5

const props = withDefaults(defineProps<{ run: SubAgentRunRef; depth?: number }>(), { depth: 0 })

const expanded = ref(props.run.status === 'running')
const loading = ref(false)
const branches = ref<RunBranch[]>([])

const {
  visible: visibleBranches,
  hasMore,
  sentinel,
} = usePagedList(() => branches.value, PAGE_SIZE)

type State = 'running' | 'failed' | 'aborted' | 'done'
const STATE_LABEL: Record<State, string> = {
  running: 'Working on it',
  failed: 'Finished with errors',
  aborted: 'Interrupted',
  done: '',
}
const state = computed<State>(
  () =>
    (({ running: 'running', error: 'failed', aborted: 'aborted' }) as Record<string, State>)[
      props.run.status
    ] ?? 'done'
)
const summary = computed(() => {
  const count = props.run.branchCount
  return `${props.run.agentName} · ${count === 1 ? '1 task' : `${count} tasks`}`
})
const dot = ref<HTMLElement>()
watchEffect(() => dot.value && setTooltip(dot.value, STATE_LABEL[state.value]))
onMounted(() => {
  if (expanded.value) void load()
})

async function toggle(): Promise<void> {
  expanded.value = !expanded.value
  if (expanded.value && !branches.value.length) await load()
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const file = await RunStorage.getInstance().load(props.run.runId)
    branches.value = file?.branches ?? []
  } finally {
    loading.value = false
  }
}

// A run that finishes has more to show than when it was opened; it folds, as thinking does.
watch(
  () => props.run.status,
  async (status, before) => {
    if (before === 'running' && status !== 'running') {
      expanded.value = false
      branches.value = []
    } else if (expanded.value) await load()
  }
)

async function openInTab(): Promise<void> {
  const opened = await ChatService.getInstance().openRun(props.run.runId)
  if (!opened) new Notice('That run is no longer stored in this vault.')
}
</script>

<style lang="scss">
.abele-run__body {
  padding-inline-start: var(--size-4-4);
}
.abele-chat-run__dot_aborted {
  background-color: var(--text-faint);
}
.abele-run__sentinel {
  height: 1px;
}
</style>
