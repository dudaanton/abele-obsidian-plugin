<template>
  <!-- One task handed to the helper: a tree line with a dot for how it went, opening to its
       conversation. A run of one task shows the conversation straight away. -->
  <component
    :is="showItem ? TreeItem : 'div'"
    class="abele-run-branch"
    v-bind="
      showItem
        ? { text: branch.item, icon: 'list-checks', collapsible: true, collapsed: !open }
        : {}
    "
    @click="showItem && (open = !open)"
  >
    <template v-if="showItem && tone" #end>
      <StatusDot :tone="tone.tone" :label="tone.label" :pulse="branch.status === 'running'" />
    </template>
    <div class="abele-run-branch__messages">
      <p v-if="branch.error" class="abele-run-branch__error" role="alert">{{ branch.error }}</p>

      <AiRunMessage
        v-for="message in visible"
        :key="message.id"
        :message="message"
        :depth="depth"
      />
      <div v-if="hasMore" ref="sentinel" class="abele-run-branch__sentinel" />

      <p v-if="!branch.messages.length" class="abele-run-branch__empty">
        {{ t('streamB.thisTaskRecordedNoMessages.171f3b') }}
      </p>
    </div>
  </component>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import TreeItem from './obsidian/TreeItem.vue'
import StatusDot from './obsidian/StatusDot.vue'
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

const tone = computed(
  () =>
    (
      ({
        running: { tone: 'accent', label: t('streamB.workingOnIt.d55b6d') },
        error: { tone: 'red', label: t('streamB.failed.031a8f') },
        aborted: { tone: 'faint', label: t('streamB.interrupted.132d12') },
      }) as const
    )[props.branch.status as 'running' | 'error' | 'aborted']
)

const { visible, hasMore, sentinel } = usePagedList(() => props.branch.messages, PAGE_SIZE)
</script>

<style lang="scss">
.abele-run-branch .abele-run-branch__messages {
  min-width: 0;
}
.abele-run-branch.tree-item .abele-run-branch__messages {
  padding-inline-start: var(--size-4-4);
}
.abele-run-branch__error,
.abele-run-branch__empty {
  margin: var(--size-2-1) 0;
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}
.abele-run-branch__error {
  color: var(--text-error);
}
.abele-run-branch__empty {
  color: var(--text-muted);
}
.abele-run-branch__sentinel {
  height: 1px;
}
</style>
