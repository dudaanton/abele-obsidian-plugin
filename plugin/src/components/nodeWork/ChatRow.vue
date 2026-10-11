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
      <CopyCodes
        :running="chat.running"
        :unseen="chat.unseen ? 1 : 0"
        running-label="The agent is working"
        :unseen-label="`New since you looked · ${chat.when}`"
      />
    </template>
    <template #actions>
      <Icon
        icon="more-horizontal"
        size="xs"
        tooltip="More"
        @click.stop="(e: MouseEvent) => emit('menu', e)"
      />
    </template>
  </TreeItem>
</template>

<script setup lang="ts">
// A chat of the node agent under the worktree it works in. A pulsing dot while the agent answers,
// a still one when there is something you have not read; the title is stronger then too.
import Icon from '../obsidian/Icon.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import CopyCodes from './CopyCodes.vue'
import type { ChatSummary } from './types'

defineProps<{ chat: ChatSummary; active?: boolean }>()
const emit = defineEmits<{ (e: 'click'): void; (e: 'menu', event: MouseEvent): void }>()
</script>

<style lang="scss">
.abele-chat-row_unseen > .tree-item-self .abele-tree-item__text {
  font-weight: var(--font-semibold);
}
</style>
