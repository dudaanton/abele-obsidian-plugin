<template>
  <div class="abele-run" :class="`abele-run_${run.status}`">
    <div class="abele-run__head" @click="toggle">
      <Icon :icon="expanded ? 'chevron-down' : 'chevron-right'" no-hover />
      <Icon :icon="statusIcon" no-hover class="abele-run__status-icon" />

      <span class="abele-run__agent">{{ run.agentName }}</span>
      <span class="abele-run__summary">{{ summary }}</span>

      <Icon
        icon="external-link"
        class="abele-run__open"
        title="Open this run in its own tab"
        @click.stop="openInTab"
      />
    </div>

    <div v-if="expanded" class="abele-run__body">
      <div v-if="loading" class="abele-run__note">Loading the transcript...</div>
      <div v-else-if="!branches.length" class="abele-run__note">
        Nothing was recorded for this run.
      </div>

      <template v-else>
        <!-- One item: straight to its messages, with no list to click through. -->
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import AiRunBranch from './AiRunBranch.vue'
import { ChatService } from '@/ai/ChatService'
import { RunStorage, type RunBranch } from '@/ai/RunStorage'
import { usePagedList } from '@/composables/usePagedList'
import type { SubAgentRunRef } from '@/ai/types'

/** Branches shown at once before scrolling loads more — they can each hold a conversation. */
const PAGE_SIZE = 5

const props = withDefaults(defineProps<{ run: SubAgentRunRef; depth?: number }>(), { depth: 0 })

const expanded = ref(false)
const loading = ref(false)
const branches = ref<RunBranch[]>([])

const {
  visible: visibleBranches,
  hasMore,
  sentinel,
} = usePagedList(() => branches.value, PAGE_SIZE)

const statusIcon = computed(
  () =>
    ({
      running: 'loader',
      done: 'check',
      error: 'alert-triangle',
      aborted: 'ban',
    })[props.run.status] ?? 'bot'
)

const summary = computed(() => {
  const count = props.run.branchCount
  const scale = count > 1 ? `${count} tasks` : '1 task'
  if (props.run.status === 'running') return `${scale} — running`
  if (props.run.status === 'error') return `${scale} — finished with errors`
  if (props.run.status === 'aborted') return `${scale} — interrupted`
  return scale
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

// A run that finishes while expanded has more to show than when it was opened.
watch(
  () => props.run.status,
  async (status) => {
    if (expanded.value && status !== 'running') await load()
  }
)

async function openInTab(): Promise<void> {
  const opened = await ChatService.getInstance().openRun(props.run.runId)
  if (!opened) new Notice('That run is no longer stored in this vault.')
}
</script>

<style lang="scss">
.abele-run {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  margin: var(--size-4-1) 0;
  overflow: hidden;
}

.abele-run__head {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-2) var(--size-4-2);
  cursor: pointer;
  min-width: 0;

  &:hover {
    background: var(--background-modifier-hover);
  }
}

.abele-run__agent {
  font-weight: var(--font-medium);
  white-space: nowrap;
}

.abele-run__summary {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-smallest);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-run__open {
  flex: 0 0 auto;
}

.abele-run_error .abele-run__status-icon {
  color: var(--text-error);
}

.abele-run_running .abele-run__status-icon {
  animation: abele-run-spin 1.4s linear infinite;
}

@keyframes abele-run-spin {
  to {
    transform: rotate(360deg);
  }
}

.abele-run__body {
  border-top: 1px solid var(--background-modifier-border);
  padding: var(--size-4-2);
}

.abele-run__note {
  color: var(--text-muted);
  font-size: var(--font-small);
}

.abele-run__sentinel {
  height: 1px;
}
</style>
