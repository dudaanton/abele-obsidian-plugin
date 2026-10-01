<template>
  <ObsidianModal title="Original reply" @close="emit('close')">
    <Markdown :text="message.revisions?.[0].before ?? message.content" />
    <template #footer>
      <Button v-if="canUndo" text="Undo last revision" @click="undo" />
      <Button text="Close" @click="emit('close')" />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Markdown from './obsidian/Markdown.vue'
import Button from './obsidian/Button.vue'
import type { ChatMessage } from '@/ai/types'
const props = defineProps<{ message: ChatMessage }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'undo'): void }>()
function undo() {
  emit('undo')
  emit('close')
}
const canUndo = computed(() => {
  const revision = props.message.revisions?.findLast((r) => !r.undoneAt)
  return revision && revision.after === props.message.content
})
</script>
