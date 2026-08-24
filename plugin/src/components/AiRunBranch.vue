<template>
  <div class="abele-run-branch">
    <div v-if="showItem" class="abele-run-branch__head" @click="open = !open">
      <Icon :icon="open ? 'chevron-down' : 'chevron-right'" no-hover />
      <span class="abele-run-branch__item">{{ branch.item }}</span>
      <span class="abele-run-branch__status" :class="`abele-run-branch__status_${branch.status}`">
        {{ branch.status }}
      </span>
    </div>

    <div v-if="open" class="abele-run-branch__messages">
      <div v-if="branch.error" class="abele-run-branch__error">{{ branch.error }}</div>

      <AiRunMessage
        v-for="message in visible"
        :key="message.id"
        :message="message"
        :depth="depth"
      />
      <div v-if="hasMore" ref="sentinel" class="abele-run-branch__sentinel" />

      <div v-if="!branch.messages.length" class="abele-run-branch__empty">
        This branch recorded no messages.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Icon from './obsidian/Icon.vue'
import AiRunMessage from './AiRunMessage.vue'
import { usePagedList } from '@/composables/usePagedList'
import type { RunBranch } from '@/ai/RunStorage'

/** A sub-agent turn can be long, so the transcript arrives a page at a time. */
const PAGE_SIZE = 20

const props = withDefaults(
  defineProps<{ branch: RunBranch; showItem?: boolean; depth?: number }>(),
  { showItem: true, depth: 0 }
)

/** A single branch has nothing to click through, so it starts open. */
const open = ref(!props.showItem)

const { visible, hasMore, sentinel } = usePagedList(() => props.branch.messages, PAGE_SIZE)
</script>

<style lang="scss">
.abele-run-branch {
  border-top: 1px solid var(--background-modifier-border);
  padding-top: var(--size-2-2);
  margin-top: var(--size-2-2);

  &:first-child {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }
}

.abele-run-branch__head {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  cursor: pointer;
  min-width: 0;
}

.abele-run-branch__item {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-small);
}

.abele-run-branch__status {
  flex: 0 0 auto;
  font-size: var(--font-smallest);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}

.abele-run-branch__status_error {
  color: var(--text-error);
}

.abele-run-branch__messages {
  padding: var(--size-2-2) 0 var(--size-2-2) var(--size-4-2);
}

.abele-run-branch__error {
  color: var(--text-error);
  font-size: var(--font-small);
  margin-bottom: var(--size-2-2);
  overflow-wrap: anywhere;
}

.abele-run-branch__empty {
  color: var(--text-muted);
  font-size: var(--font-small);
}

.abele-run-branch__sentinel {
  height: 1px;
}
</style>
