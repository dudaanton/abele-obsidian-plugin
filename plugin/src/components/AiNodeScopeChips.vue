<template>
  <div
    v-if="(!errorsOnly && entries.length) || !parsed.success || error"
    class="abele-node-scope-chips"
    aria-label="Chat node access"
  >
    <!-- Each place by its names, folder and branch; reading or editing by its glyph, the node
         and the words in the tooltip. -->
    <div
      v-for="entry in errorsOnly ? [] : entries"
      :key="nodeScopeKey(entry)"
      class="abele-node-scope-chips__entry"
    >
      <Icon
        class="abele-node-scope-chips__place"
        :icon="entry.access === 'edit' ? 'folder-pen' : 'folder-search'"
        :text-right="title(entry)"
        :tooltip="sentence(entry)"
        @click="emit('open')"
      />
      <Icon
        icon="x"
        with-bg
        :tooltip="`Take ${title(entry)} out of this chat's access`"
        @click="remove(entry)"
      />
    </div>
    <Icon
      v-if="selected && !errorsOnly"
      class="abele-node-scope-chips__place"
      icon="crosshair"
      :text-right="selectedTitle"
      :tooltip="`The agent works in ${selectedTitle} now. Change it in this chat's access.`"
      @click="emit('open')"
    />
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
import { removeObsidianChatNodeAccess } from '@/ai/tools/node/owner'
import {
  nodeScopeNames,
  nodeScopeSentence,
  nodeScopeTitle,
  type NodeScopeNames,
} from '@/ai/tools/node/scopeNames'
import Icon from './obsidian/Icon.vue'
import EmptyState from './obsidian/EmptyState.vue'
const props = defineProps<{
  session: ChatSession
  /** Only what is wrong with the access; the entries themselves are shown elsewhere. */
  errorsOnly?: boolean
}>()
const emit = defineEmits<{
  /** A place was pressed: this chat's access, to change it. */
  (e: 'open'): void
}>()
const parsed = computed(() =>
  NodeScopeEntriesSchema.safeParse(props.session.overrides?.value.nodeScope ?? [])
)
const entries = computed(() => (parsed.value.success ? parsed.value.data : []))
const selected = computed(() => {
  const target = NodeScopeTargetSchema.safeParse(props.session.overrides?.value.nodeTarget)
  return target.success ? target.data : undefined
})
const error = ref('')
const names = ref<Record<string, NodeScopeNames>>({})
const selectedNames = ref<NodeScopeNames>()
watch(
  [entries, selected],
  async ([list, current]) => {
    const found = await Promise.all(
      list.map(async (e) => [nodeScopeKey(e), await nodeScopeNames(e)] as const)
    )
    names.value = Object.fromEntries(found)
    selectedNames.value = current ? await nodeScopeNames(current) : undefined
  },
  { immediate: true }
)
const fallback = (entry: NodeScopeEntry): NodeScopeNames => ({ node: entry.node_id })
const title = (entry: NodeScopeEntry) =>
  nodeScopeTitle(names.value[nodeScopeKey(entry)] ?? fallback(entry))
const sentence = (entry: NodeScopeEntry) =>
  `${nodeScopeSentence(names.value[nodeScopeKey(entry)] ?? fallback(entry), entry.access)}. Change it in this chat's access.`
const selectedTitle = computed(() =>
  selectedNames.value
    ? nodeScopeTitle(selectedNames.value)
    : selected.value
      ? nodeTargetId(selected.value.target)
      : ''
)
async function remove(entry: NodeScopeEntry) {
  const chat = props.session
  try {
    await removeObsidianChatNodeAccess(chat, entry)
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : 'Could not remove node access'
  }
}
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
  .abele-node-scope-chips__place {
    min-width: 0;
    flex-shrink: 1;
  }
}
</style>
