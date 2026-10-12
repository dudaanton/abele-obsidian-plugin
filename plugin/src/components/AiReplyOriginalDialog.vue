<template>
  <!-- The reply as it was first written, and what has changed in it since. -->
  <ObsidianModal title="Original reply" size="tall" @close="emit('close')">
    <div class="abele-reply-original">
      <Tabs v-model="tab" level="secondary" :tabs="TABS" />
      <Markdown v-if="tab === 'original'" :text="original" />
      <Diff v-else :text-left="original" :text-right="message.content" />
    </div>
    <template v-if="canUndo" #footer>
      <Button
        text="Undo last change"
        tooltip="Put the reply back as it was before its last change"
        @click="undo"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Markdown from './obsidian/Markdown.vue'
import Button from './obsidian/Button.vue'
import Tabs from './obsidian/Tabs.vue'
import Diff from './Diff.vue'
import type { ChatMessage } from '@/ai/types'
const props = defineProps<{ message: ChatMessage }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'undo'): void }>()
// What changed comes first: a long reply read whole again only hides the few words that moved.
const TABS = [
  { id: 'changes', label: 'Changes' },
  { id: 'original', label: 'Original' },
]
const tab = ref('changes')
const original = computed(() => props.message.revisions?.[0].before ?? props.message.content)
function undo() {
  emit('undo')
  emit('close')
}
const canUndo = computed(() => {
  const last = props.message.revisions?.findLast((r) => !r.undoneAt)
  return last && last.after === props.message.content
})
</script>

<style lang="scss">
.abele-reply-original {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}
</style>
