<template>
  <div v-for="message in messages" :key="message.id">
    <AiChatMessage
      :message="message"
      :read-only-history="true"
      :compact-tool-details="true"
      :resource-opener="openResource"
    >
      <template #tool-note
        ><span v-if="message.content" class="abele-node-message-note" :title="message.content">{{
          message.content === 'Allowed by your Claude settings'
            ? 'Claude settings'
            : message.content
        }}</span></template
      >
      <template #metadata>
        <div v-if="message.error" class="abele-ai-chat__error" role="alert">
          <div class="abele-ai-chat__error-line">
            <span class="abele-node-error-text">{{ message.error }}</span>
            <button
              v-if="message.retryInputId"
              class="clickable-icon"
              type="button"
              aria-label="Send again"
              :disabled="offline"
              @click="emit('retry', message.id)"
            >
              <Icon icon="rotate-cw" tooltip="Send again" no-hover />
            </button>
          </div>
        </div>
        <div v-if="queueStates[message.id]" class="abele-node-queue-state" role="status">
          <Icon icon="clock" no-hover />
          <span>{{ queueStates[message.id].label }}</span>
          <Icon
            v-if="queueStates[message.id].inputId"
            icon="x"
            role="button"
            tabindex="0"
            aria-label="Cancel queued input"
            tooltip="Cancel queued input"
            :disabled="offline"
            @click="emit('cancel', queueStates[message.id].inputId!)"
            @keydown.enter.prevent="!offline && emit('cancel', queueStates[message.id].inputId!)"
            @keydown.space.prevent="!offline && emit('cancel', queueStates[message.id].inputId!)"
          />
        </div>
      </template>
    </AiChatMessage>
    <details v-if="children[message.id]?.length" class="abele-node-child-work">
      <summary>
        Nested agent work · {{ children[message.id].length }}
        {{ children[message.id].length === 1 ? 'record' : 'records' }}
      </summary>
      <NodeMessageTree
        v-if="depth < 12"
        :messages="children[message.id]"
        :children="children"
        :depth="depth + 1"
        :open-resource="openResource"
        :queue-states="queueStates"
        :offline="offline"
        @cancel="emit('cancel', $event)"
        @retry="emit('retry', $event)"
      />
      <pre v-else>{{ JSON.stringify(children[message.id], null, 2) }}</pre>
    </details>
  </div>
</template>
<script setup lang="ts">
import type { ChatMessage } from '@/ai/types'
import type { QueueState } from '@/node/presentation'
import AiChatMessage from './AiChatMessage.vue'
import Icon from './obsidian/Icon.vue'
withDefaults(
  defineProps<{
    messages: ChatMessage[]
    children: Record<string, ChatMessage[]>
    depth?: number
    openResource: (path: string) => void
    queueStates?: Record<string, QueueState>
    offline?: boolean
  }>(),
  { depth: 0, queueStates: () => ({}) }
)
const emit = defineEmits<{
  (e: 'cancel', inputId: string): void
  (e: 'retry', messageId: string): void
}>()
</script>
<style lang="scss">
.abele-node-error-text {
  flex: 1;
  min-width: 0;
}
.abele-node-child-work {
  margin-inline-start: var(--size-4-3);
  padding-inline-start: var(--size-4-2);
  border-inline-start: var(--border-width) solid var(--background-modifier-border);
}
.abele-node-message-note {
  color: var(--text-muted);
}
.abele-node-queue-state {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--text-muted);
}
</style>
