<template>
  <div v-if="chats.length" class="abele-file-chats">
    <ChatsList :chats="chats" subject="script" />
  </div>
</template>

<script setup lang="ts">
import ChatsList from './ChatsList.vue'
import { useChatLinks } from '@/composables/useChatLinks'
import type { FileChatsModel } from '@/views/codeViewChats'

const props = defineProps<{
  model: FileChatsModel
}>()

// A getter over the reactive model: the code view rewrites `path` when its tab is given
// another file or the script is renamed, and the list follows.
const chats = useChatLinks(() => props.model.path)
</script>

<style lang="scss">
/* Under the code, set in as far as the code's own text is from the pane's edge. */
.abele-file-chats {
  padding: calc(var(--p-spacing) * 1.5) var(--size-4-4);
  border-top: 1px solid var(--background-modifier-border);
}
</style>
