<template>
  <div class="abele-chat-msg__details">
    <div
      v-if="actions"
      class="abele-chat-msg__actions"
      role="group"
      :aria-label="t('streamB.messageActions.f532ee')"
    >
      <button
        type="button"
        class="clickable-icon"
        :aria-label="t('streamB.copyMessage.457efe')"
        @click="emit('copy')"
      >
        <Icon icon="copy" :tooltip="t('streamB.copyMessage.457efe')" no-hover />
      </button>
      <template v-if="!readOnlyHistory">
        <button
          v-if="message.role === 'user'"
          type="button"
          class="clickable-icon"
          :aria-label="t('streamB.edit.464c4f')"
          @click="emit('edit-message', message.id)"
        >
          <Icon icon="pencil" :tooltip="t('streamB.edit.464c4f')" no-hover />
        </button>
        <button
          v-if="message.role === 'assistant' || message.role === 'tool-call'"
          type="button"
          class="clickable-icon"
          :aria-label="t('streamB.retry.942087')"
          @click="emit('retry-message', message.id)"
        >
          <Icon icon="rotate-cw" :tooltip="t('streamB.retry.942087')" no-hover />
        </button>
        <button
          v-if="message.role === 'user' || message.role === 'assistant'"
          type="button"
          class="clickable-icon"
          :aria-label="t('streamB.insertIntoNote.be3d5a')"
          @click="emit('insert-into-note', message.id)"
        >
          <Icon icon="file-input" :tooltip="t('streamB.insertIntoNote.be3d5a')" no-hover />
        </button>
        <button
          v-if="canComment && (message.role === 'assistant' || message.role === 'user')"
          type="button"
          class="clickable-icon"
          :aria-label="t('streamB.askHere.7b4ec4')"
          @pointerdown="captureSelection"
          @click="askHere"
        >
          <Icon icon="message-square" :tooltip="t('streamB.askHere.7b4ec4')" no-hover />
        </button>
        <button
          type="button"
          class="clickable-icon"
          :aria-label="t('streamB.moreMessageActions.d1a0bd')"
          aria-haspopup="menu"
          @click="emit('actions', $event)"
        >
          <Icon icon="ellipsis" :tooltip="t('streamB.moreMessageActions.d1a0bd')" no-hover />
        </button>
      </template>
    </div>
    <div class="abele-chat-msg__detail-time">{{ formatTime(message.timestamp) }}</div>
    <div v-if="message.error" class="abele-chat-msg__detail-row">
      <span class="abele-chat-msg__detail-label">{{ t('node.error.details') }}</span>
      <pre>{{ message.error }}</pre>
    </div>
    <div v-if="message.usage" class="abele-chat-msg__detail-row">
      <span class="abele-chat-msg__detail-label">{{ t('streamB.tokens.a039df') }}</span>
      <span
        >{{
          t('streamBMeta.92b76bc427', {
            p0: String(message.usage.input),
            p1: String(message.usage.output),
            p2: String(message.usage.total),
          })
        }}<template v-if="message.usage.speed">
          {{ t('streamBMeta.d46f6ad65a', { p0: String(message.usage.speed) }) }}</template
        ></span
      >
    </div>
    <div v-for="mark in message.highlights ?? []" :key="mark.id" class="abele-chat-msg__detail-row">
      <span :class="`abele-highlight abele-highlight--${mark.color}`">{{ mark.quote }}</span>
      <Button
        :text="t('streamB.remove.c3812f')"
        :tooltip="t('streamB.removeHighlight.a3dfce', { v0: String(mark.quote) })"
        :aria-label="t('streamB.removeHighlight.a3dfce', { v0: String(mark.quote) })"
        @click="emit('remove-highlight', message.id, mark.id)"
      />
    </div>
    <div v-if="message.toolParams" class="abele-chat-msg__detail-row">
      <span class="abele-chat-msg__detail-label">{{ t('streamB.params.7ffdd4') }}</span>
      <pre data-find-part="params">{{ toolParamsText(message.toolParams) }}</pre>
    </div>
    <div v-if="message.toolResult" class="abele-chat-msg__detail-row">
      <span class="abele-chat-msg__detail-label">{{ t('streamB.result.6e7d50') }}</span>
      <div v-if="chatList" class="abele-chat-list" data-find-part="result">
        <TreeItem
          v-for="(chat, index) in chatList"
          :key="index"
          :text="chat.title"
          :where="chat.folder"
          icon="message-square"
          plain
        />
      </div>
      <pre v-else data-find-part="result">{{ toolResultText(message.toolResult) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import type { ChatMessage } from '@/ai/types'
import { toolParamsText, toolResultText } from '@/ai/toolLine'
import { computed } from 'vue'
import TreeItem from './obsidian/TreeItem.vue'

const props = withDefaults(
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
const chatList = computed(() => {
  if (props.message.toolName !== 'list_chats' || !props.message.toolResult) return null
  try {
    const result: unknown = JSON.parse(props.message.toolResult)
    if (!Array.isArray(result)) return null
    const rows: { title: string; folder?: string }[] = []
    for (const item of result) {
      if (!item || typeof item !== 'object' || typeof item.title !== 'string') return null
      rows.push({
        title: item.title,
        folder: typeof item.folder === 'string' ? item.folder : undefined,
      })
    }
    return rows
  } catch {
    return null
  }
})
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
