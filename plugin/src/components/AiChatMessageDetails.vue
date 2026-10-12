<template>
  <div class="abele-chat-msg__details">
    <div v-if="actions" class="abele-chat-msg__actions" role="group" aria-label="Message actions">
      <button type="button" class="clickable-icon" aria-label="Copy message" @click="emit('copy')">
        <Icon icon="copy" tooltip="Copy message" no-hover />
      </button>
      <template v-if="!readOnlyHistory">
        <button
          v-if="message.role === 'user'"
          type="button"
          class="clickable-icon"
          aria-label="Edit"
          @click="emit('edit-message', message.id)"
        >
          <Icon icon="pencil" tooltip="Edit" no-hover />
        </button>
        <button
          v-if="message.role === 'assistant' || message.role === 'tool-call'"
          type="button"
          class="clickable-icon"
          aria-label="Retry"
          @click="emit('retry-message', message.id)"
        >
          <Icon icon="rotate-cw" tooltip="Retry" no-hover />
        </button>
        <button
          v-if="message.role === 'user' || message.role === 'assistant'"
          type="button"
          class="clickable-icon"
          aria-label="Insert into note"
          @click="emit('insert-into-note', message.id)"
        >
          <Icon icon="file-input" tooltip="Insert into note" no-hover />
        </button>
        <button
          v-if="canComment && (message.role === 'assistant' || message.role === 'user')"
          type="button"
          class="clickable-icon"
          aria-label="Ask here"
          @pointerdown="captureSelection"
          @click="askHere"
        >
          <Icon icon="message-square" tooltip="Ask here" no-hover />
        </button>
        <button
          type="button"
          class="clickable-icon"
          aria-label="More message actions"
          aria-haspopup="menu"
          @click="emit('actions', $event)"
        >
          <Icon icon="ellipsis" tooltip="More message actions" no-hover />
        </button>
      </template>
    </div>
    <div class="abele-chat-msg__detail-time">{{ formatTime(message.timestamp) }}</div>
    <div v-if="message.usage" class="abele-chat-msg__detail-row">
      <span class="abele-chat-msg__detail-label">Tokens</span>
      <span
        >in: {{ message.usage.input }} / out: {{ message.usage.output }} / total:
        {{ message.usage.total
        }}<template v-if="message.usage.speed"> · {{ message.usage.speed }} t/s</template></span
      >
    </div>
    <div v-for="mark in message.highlights ?? []" :key="mark.id" class="abele-chat-msg__detail-row">
      <span :class="`abele-highlight abele-highlight--${mark.color}`">{{ mark.quote }}</span>
      <Button
        text="Remove"
        :tooltip="`Remove highlight: ${mark.quote}`"
        :aria-label="`Remove highlight: ${mark.quote}`"
        @click="emit('remove-highlight', message.id, mark.id)"
      />
    </div>
    <div v-if="message.toolParams" class="abele-chat-msg__detail-row">
      <span class="abele-chat-msg__detail-label">Params</span>
      <pre data-find-part="params">{{ toolParamsText(message.toolParams) }}</pre>
    </div>
    <div v-if="message.toolResult" class="abele-chat-msg__detail-row">
      <span class="abele-chat-msg__detail-label">Result</span>
      <pre data-find-part="result">{{ toolResultText(message.toolResult) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatTimestamp } from '@/helpers/displayFormat'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import type { ChatMessage } from '@/ai/types'
import { toolParamsText, toolResultText } from '@/ai/toolLine'

withDefaults(
  defineProps<{
    message: ChatMessage
    /** The row of actions; a question or an answer has them in the line under it instead. */
    actions?: boolean
    readOnlyHistory?: boolean
    canComment?: boolean
    captureSelection: () => void
    askHere: () => void
  }>(),
  { actions: true }
)
const emit = defineEmits<{
  (event: 'copy'): void
  (event: 'actions', mouse: MouseEvent): void
  (event: 'edit-message', id: string): void
  (event: 'retry-message', id: string): void
  (event: 'insert-into-note', id: string): void
  (event: 'remove-highlight', id: string, highlight: string): void
}>()
// Short, as the time under a message: today the time alone, another day its date as well.
const formatTime = (timestamp: number) => formatTimestamp(timestamp, { diagnostic: true }).exact
</script>
