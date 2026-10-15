<template>
  <!-- Words saved from a reply that has changed since: where they were found, on one quiet line;
       the words; and, when they belong to an earlier version, that version with them lit. -->
  <ObsidianModal title="Saved selection" size="tall" @close="emit('close')">
    <div class="abele-anchor-history">
      <p class="abele-anchor-history__state">
        <Icon :icon="historical ? 'history' : 'search-x'" size="xs" no-hover />
        {{
          historical
            ? 'From an earlier version of this reply'
            : 'Could not find it in the reply as it is now'
        }}
      </p>
      <Quote :text="anchor.snapshot.text" />
      <Markdown
        v-if="resolution.status === 'historical'"
        ref="retained"
        :text="resolution.revision.content"
        @rendered="onRendered"
      />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Markdown from './obsidian/Markdown.vue'
import Icon from './obsidian/Icon.vue'
import Quote from './obsidian/Quote.vue'
import type { ChatAnchor, ChatAnchorResolution } from '@/selection/types'
import { flashExactSelection } from '@/ai/messageComments'
const props = defineProps<{ anchor: ChatAnchor; resolution: ChatAnchorResolution }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const historical = computed(() => props.resolution.status === 'historical')
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

<style lang="scss">
.abele-anchor-history {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-anchor-history__state {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
</style>
