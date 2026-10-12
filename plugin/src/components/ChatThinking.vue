<template>
  <!-- The agent's reasoning as one quiet line: open while the agent thinks, its glyph breathing,
       so the work is seen as it goes; folded once the answer comes, unless the reader chose. -->
  <TreeItem
    class="abele-chat-thinking"
    :class="{ 'abele-chat-thinking_live': streaming }"
    icon="brain"
    :text="streaming ? 'Thinking' : 'Thought'"
    :collapsible="!!text"
    :collapsed="!open"
    :plain="!text"
    @click="open = !open"
  >
    <div class="abele-chat-thinking__text">
      <Markdown
        :text="text ?? ''"
        :streaming="streaming"
        :resource-opener="resourceOpener"
        data-find-part="thinking"
      />
    </div>
  </TreeItem>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import TreeItem from './obsidian/TreeItem.vue'
import Markdown from './obsidian/Markdown.vue'

const props = defineProps<{
  /** What the agent thought; absent when its reasoning is kept out of sight. */
  text?: string
  streaming?: boolean
  /** The turn it belongs to is still running: it stays open until the answer is done. */
  live?: boolean
  resourceOpener?: (path: string) => void
}>()

/** What the reader chose; until then it is open while the agent works and folded after. */
const chosen = ref<boolean | null>(null)
const open = computed({
  get: () => chosen.value ?? !!(props.streaming || props.live),
  set: (value: boolean) => (chosen.value = value),
})

/** Opens the reasoning, for a match found in it. */
defineExpose({ reveal: () => (chosen.value = true) })
</script>

<style lang="scss">
.abele-chat-thinking {
  margin-block: var(--size-2-1);
}
.abele-chat-thinking > .tree-item-self {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-chat-thinking_live > .tree-item-self .abele-tree-item__glyph svg {
  animation: abele-chat-thinking-breathe 1.6s ease-in-out infinite;
}
@keyframes abele-chat-thinking-breathe {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .abele-chat-thinking_live > .tree-item-self .abele-tree-item__glyph svg {
    animation: none;
  }
}
.abele-chat-thinking__text {
  padding-inline-start: var(--size-4-6);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  overflow-wrap: break-word;
}
</style>
