<template>
  <TreeItem
    :text="chat.title"
    icon="message-square"
    :active="active"
    class="abele-chat-row"
    :class="{ 'abele-chat-row_unseen': chat.unseen }"
    @click="emit('click')"
  >
    <template #end>
      <StatusDot
        v-if="chat.running || chat.unseen"
        tone="accent"
        :pulse="chat.running"
        :label="chat.running ? 'The agent is working' : `New since you looked · ${chat.when}`"
      />
    </template>
  </TreeItem>
</template>

<script setup lang="ts">
// A chat of the node agent under the worktree it works in. A pulsing dot while the agent answers,
// a still one when there is something you have not read; the title is stronger then too.
import TreeItem from '../obsidian/TreeItem.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import type { ChatSummary } from './types'

defineProps<{ chat: ChatSummary; active?: boolean }>()
const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<style lang="scss">
.abele-chat-row_unseen > .tree-item-self .abele-tree-item__text {
  font-weight: var(--font-semibold);
}
</style>
