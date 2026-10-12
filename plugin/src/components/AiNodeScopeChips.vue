<template>
  <div
    v-if="(!errorsOnly && entries.length) || !parsed.success || error"
    class="abele-node-scope-chips"
    aria-label="Chat node access"
  >
    <div
      v-for="entry in errorsOnly ? [] : entries"
      :key="nodeScopeKey(entry)"
      class="abele-node-scope-chips__entry"
      :title="label(entry)"
    >
      <Badge :text="label(entry)" />
      <Icon
        icon="x"
        with-bg
        :tooltip="`Remove ${label(entry)} from chat access`"
        @click="remove(entry)"
      />
    </div>
    <Badge v-if="selected && !errorsOnly" :text="`Current: ${nodeTargetId(selected.target)}`" />
    <EmptyState
      v-if="!parsed.success"
      variant="error"
      text="Invalid node scope. Review this chat's scope settings."
    />
    <EmptyState v-if="error" variant="error" :text="error" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatSession } from '@/ai/ChatSession'
import {
  NodeScopeEntriesSchema,
  NodeScopeTargetSchema,
  nodeScopeKey,
  nodeTargetId,
  type NodeScopeEntry,
} from '@/ai/nodeScope'
import { nodeAgentHost, removeObsidianChatNodeAccess } from '@/ai/tools/node/owner'
import Badge from './obsidian/Badge.vue'
import Icon from './obsidian/Icon.vue'
import EmptyState from './obsidian/EmptyState.vue'
const props = defineProps<{
  session: ChatSession
  /** Only what is wrong with the access; the entries themselves are shown elsewhere. */
  errorsOnly?: boolean
}>()
const parsed = computed(() =>
  NodeScopeEntriesSchema.safeParse(props.session.overrides?.value.nodeScope ?? [])
)
const entries = computed(() => (parsed.value.success ? parsed.value.data : []))
const selected = computed(() => {
  const target = NodeScopeTargetSchema.safeParse(props.session.overrides?.value.nodeTarget)
  return target.success ? target.data : undefined
})
const nodes = ref<{ id: string; label: string; node_id?: string }[]>([])
const error = ref('')
function label(entry: NodeScopeEntry) {
  const parts = [
    nodes.value.find((node) => node.id === entry.node_id || node.node_id === entry.node_id)
      ?.label ?? entry.node_id,
  ]
  if (entry.kind !== 'node') parts.push(entry.project_id)
  if (entry.kind === 'target') parts.push(nodeTargetId(entry.target))
  return `${parts.join(' / ')} · ${entry.access}`
}
async function remove(entry: NodeScopeEntry) {
  const chat = props.session
  try {
    await removeObsidianChatNodeAccess(chat, entry)
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Could not remove node access'
  }
}
watch(
  () => entries.value.length,
  async (length) => {
    if (!length) return
    try {
      nodes.value = (await nodeAgentHost()).nodes()
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : 'Could not load node labels'
    }
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-node-scope-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
  padding: 0 var(--size-4-2) var(--size-4-1);
  min-width: 0;
}
.abele-node-scope-chips__entry {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  max-width: 100%;
  min-width: 0;
  .abele-badge {
    flex-shrink: 1;
  }
}
</style>
