<template>
  <!-- One message of a node chat: the regular chat's message, with what the node adds under it
       (a failed turn's way to send it again, where a queued input stands) and beside a call
       (what allowed it). -->
  <AiChatMessage
    :message="message"
    :read-only-history="true"
    :can-reply="canReply"
    :compact-tool-details="true"
    :resource-opener="openResource"
    @reply="emit('reply', $event)"
    @show-reply="emit('show-reply', $event)"
    @open-session="emit('open-session', $event)"
  >
    <template #tool-note
      ><span v-if="message.content" class="abele-node-message-note" :title="message.content">{{
        message.content === 'Allowed by your Claude settings' ? 'Claude settings' : message.content
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
      <div v-if="queueState" class="abele-node-queue-state" role="status">
        <Icon icon="clock" no-hover />
        <span>{{ queueState.label }}</span>
        <Icon
          v-if="queueState.inputId"
          icon="x"
          role="button"
          tabindex="0"
          aria-label="Cancel queued input"
          tooltip="Cancel queued input"
          :disabled="offline"
          @click="emit('cancel', queueState.inputId!)"
          @keydown.enter.prevent="!offline && emit('cancel', queueState.inputId!)"
          @keydown.space.prevent="!offline && emit('cancel', queueState.inputId!)"
        />
      </div>
    </template>
  </AiChatMessage>
</template>
<script setup lang="ts">
import type { ChatMessage, ChatReplyTo } from '@/ai/types'
import type { QueueState } from '@/node/presentation'
import AiChatMessage from './AiChatMessage.vue'
import Icon from './obsidian/Icon.vue'
defineProps<{
  message: ChatMessage
  openResource: (path: string) => void
  queueState?: QueueState
  offline?: boolean
  canReply?: boolean
}>()
const emit = defineEmits<{
  (e: 'cancel', inputId: string): void
  (e: 'retry', messageId: string): void
  (e: 'reply', to: ChatReplyTo): void
  (e: 'show-reply', to: ChatReplyTo): void
  (e: 'open-session', sessionId: string): void
}>()
</script>
