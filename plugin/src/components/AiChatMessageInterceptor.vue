<template>
  <div
    v-if="message.interceptorChat?.length || interceptorStreaming || interceptorError"
    class="abele-chat-msg__interceptor"
  >
    <div
      v-if="!message.draft && message.interceptorCollapsed !== false"
      class="abele-chat-msg__interceptor-collapsed"
      @click="emit('toggle', message.id)"
    >
      <Icon icon="message-square" />
      <span
        >{{ message.interceptorName || 'Interceptor' }} ({{
          message.interceptorChat?.length || 0
        }})</span
      >
    </div>
    <template v-else>
      <div
        v-if="!message.draft"
        class="abele-chat-msg__interceptor-header"
        @click="emit('toggle', message.id)"
      >
        <Icon icon="chevron-down" />
        <span>{{ message.interceptorName || 'Interceptor' }}</span>
      </div>
      <div class="abele-chat-msg__interceptor-messages" data-find-part="interceptor">
        <div
          v-for="icMsg in message.interceptorChat"
          :key="icMsg.id"
          class="abele-chat-msg__interceptor-msg"
          :class="`abele-chat-msg__interceptor-msg--${icMsg.role}`"
        >
          <Markdown v-if="icMsg.role === 'assistant'" :text="icMsg.content" />
          <span v-else>{{ icMsg.content }}</span>
        </div>
        <div
          v-if="interceptorStreaming"
          class="abele-chat-msg__interceptor-msg abele-chat-msg__interceptor-msg--assistant"
        >
          <Markdown
            v-if="interceptorStreamingContent"
            :text="interceptorStreamingContent"
            streaming
          />
          <span v-else class="abele-chat-msg__interceptor-typing">
            <span class="abele-ai-chat__typing-dot" />
            <span class="abele-ai-chat__typing-dot" />
            <span class="abele-ai-chat__typing-dot" />
          </span>
        </div>
      </div>
      <div v-if="interceptorError" class="abele-chat-msg__interceptor-error">
        <span>{{ interceptorError }}</span>
        <button class="abele-chat-msg__draft-btn" @click="emit('retry', message.id)">Retry</button>
      </div>
      <div
        v-if="
          message.draft && !message.interceptorScript && !interceptorStreaming && !interceptorError
        "
        class="abele-chat-msg__interceptor-input"
      >
        <textarea
          :value="text"
          class="abele-chat-msg__interceptor-textarea"
          placeholder="Reply..."
          rows="1"
          @input="text = ($event.target as HTMLTextAreaElement).value"
          @keydown.shift.enter.prevent="emit('reply')"
        />
        <Icon icon="send-horizontal" with-bg @click="emit('reply')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import type { ChatMessage } from '@/ai/types'

defineProps<{
  message: ChatMessage
  interceptorStreaming?: boolean
  interceptorStreamingContent?: string
  interceptorError?: string | null
}>()
// The parent keeps this input even when the section is not drawn.
const text = defineModel<string>('text', { required: true })
const emit = defineEmits<{
  (event: 'toggle', id: string): void
  (event: 'retry', id: string): void
  (event: 'reply'): void
}>()
</script>
