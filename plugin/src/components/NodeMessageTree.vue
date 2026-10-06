<template>
  <div v-for="message in messages" :key="message.id">
    <AiChatMessage :message="message" :read-only-history="true" :resource-opener="openResource" />
    <p v-if="message.content && message.role === 'tool-call'" class="abele-node-message-note">
      {{ message.content }}
    </p>
    <details v-if="children[message.id]?.length" class="abele-node-child-work">
      <summary>Nested agent work · {{ children[message.id].length }} records</summary>
      <NodeMessageTree
        v-if="depth < 12"
        :messages="children[message.id]"
        :children="children"
        :depth="depth + 1"
        :open-resource="openResource"
      />
      <pre v-else>{{ JSON.stringify(children[message.id], null, 2) }}</pre>
    </details>
  </div>
</template>
<script setup lang="ts">
import type { ChatMessage } from '@/ai/types'
import AiChatMessage from './AiChatMessage.vue'
withDefaults(
  defineProps<{
    messages: ChatMessage[]
    children: Record<string, ChatMessage[]>
    depth?: number
    openResource: (path: string) => void
  }>(),
  { depth: 0 }
)
</script>
<style lang="scss">
.abele-node-child-work {
  margin-inline-start: var(--size-4-3);
  padding-inline-start: var(--size-4-2);
  border-inline-start: var(--border-width) solid var(--background-modifier-border);
}
.abele-node-message-note {
  color: var(--text-muted);
  padding-inline: var(--size-4-2);
}
</style>
