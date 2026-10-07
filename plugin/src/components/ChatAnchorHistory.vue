<template>
  <ObsidianModal title="Saved selection" @close="emit('close')">
    <div class="abele-anchor-history">
      <p v-if="resolution.status === 'historical'">
        This selection belongs to an earlier version of the message. The saved version below is
        read-only; the current reply is unchanged.
      </p>
      <p v-else>
        The exact placement cannot be verified. The original selected words are kept below; no
        occurrence in the current message has been highlighted.
      </p>
      <blockquote>{{ anchor.snapshot.text }}</blockquote>
      <Markdown
        v-if="resolution.status === 'historical'"
        ref="retained"
        :text="resolution.revision.content"
        @rendered="onRendered"
      />
    </div>
    <template #footer><Button text="Close" @click="emit('close')" /></template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Markdown from './obsidian/Markdown.vue'
import Button from './obsidian/Button.vue'
import type { ChatAnchor, ChatAnchorResolution } from '@/selection/types'
import { flashExactSelection } from '@/ai/messageComments'
const props = defineProps<{ anchor: ChatAnchor; resolution: ChatAnchorResolution }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const retained = ref<InstanceType<typeof Markdown>>()
function onRendered() {
  const root = retained.value?.$el as HTMLElement | undefined
  if (root && props.resolution.status === 'historical')
    flashExactSelection(
      root,
      props.resolution.revision.projection,
      props.resolution.placement.range
    )
}
</script>

<style>
.abele-anchor-source__choice {
  white-space: normal;
  overflow-wrap: anywhere;
  height: auto;
}
</style>
