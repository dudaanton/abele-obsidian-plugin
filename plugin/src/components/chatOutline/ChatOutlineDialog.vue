<template>
  <Modal title="This chat" size="tall" @close="emit('close')">
    <ChatOutlinePane
      v-bind="props"
      :preview="preview"
      :autofocus="!Platform.isMobile"
      @start="emit('start')"
      @latest="emit('latest')"
      @back="emit('back')"
      @cancel-pending="emit('cancel-pending')"
      @close="emit('close')"
      @jump="jump"
      @discussion="discussion"
    />
  </Modal>
</template>

<script setup lang="ts">
import Modal from '../obsidian/Modal.vue'
import { Platform } from 'obsidian'
import ChatOutlinePane from './ChatOutlinePane.vue'
import { CommentService } from '@/ai/CommentService'
import type { NavigationState } from '@/ai/chatNavigation'
import type { ChatMessage, MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = defineProps<{
  messages: readonly ChatMessage[]
  allMessages?: readonly ChatMessage[]
  comments: readonly MessageComment[]
  state: NavigationState
  activeMessageId?: string
  canGoBack?: boolean
  pending?: string
  focusFork?: string
}>()
const emit = defineEmits<{
  (e: 'start'): void
  (e: 'latest'): void
  (e: 'back'): void
  (e: 'cancel-pending'): void
  (e: 'close'): void
  (e: 'jump', id: string, part?: FindPart, query?: string): void
  (e: 'discussion', id: string, messageId?: string, part?: FindPart, query?: string): void
}>()
const jump = (id: string, part?: FindPart, query?: string) => {
  if (query !== undefined) emit('jump', id, part, query)
  else if (part !== undefined) emit('jump', id, part)
  else emit('jump', id)
}
const discussion = (id: string, message?: string, part?: FindPart, query?: string) => {
  if (query !== undefined) emit('discussion', id, message, part, query)
  else if (message !== undefined) emit('discussion', id, message, part)
  else emit('discussion', id)
}

// Previewing the outline must never migrate, repair or start a discussion.
const preview = async (id: string) => {
  const session = await CommentService.getInstance().navigationPreview(id)
  if (!session || session.isDestroyed) return null
  return {
    messages: session.messages.value,
    allMessages: session.allMessages?.value,
    comments: session.messageComments.value,
  }
}
</script>
