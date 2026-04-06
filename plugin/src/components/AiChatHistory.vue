<template>
  <ObsidianModal title="Chat History" @close="emit('close')">
    <div class="abele-chat-history">
      <div v-if="chats.length === 0" class="abele-chat-history__empty">No previous chats</div>
      <div
        v-for="chat in chats"
        :key="chat.path"
        class="abele-chat-history__item"
        @click="select(chat.path)"
      >
        <div class="abele-chat-history__info">
          <div class="abele-chat-history__title">{{ chat.title || chat.path }}</div>
          <div class="abele-chat-history__date">{{ chat.created }}</div>
        </div>
        <Icon icon="trash" @click.stop="remove(chat.path)" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Icon from './obsidian/Icon.vue'
import { ChatStorage } from '@/ai/ChatStorage'
import { GlobalStore } from '@/stores/GlobalStore'
import type { AiChatHistoryEntry } from '@/ai/types'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', file: TFile): void
}>()

const chats = ref<AiChatHistoryEntry[]>(ChatStorage.getInstance().getHistory())

const select = (path: string) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    emit('select', file)
    emit('close')
  }
}

const remove = async (path: string) => {
  await ChatStorage.getInstance().deleteChat(path)
  chats.value = ChatStorage.getInstance().getHistory()
}
</script>

<style lang="scss">
.abele-chat-history {
  max-height: 400px;
  overflow-y: auto;
}

.abele-chat-history__empty {
  padding: var(--size-4-4);
  text-align: center;
  color: var(--text-muted);
}

.abele-chat-history__item {
  display: flex;
  align-items: center;
  padding: var(--size-4-2) var(--size-4-3);
  cursor: pointer;
  border-radius: var(--radius-s);
  gap: var(--size-4-2);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-chat-history__info {
  flex: 1;
  min-width: 0;
}

.abele-chat-history__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-chat-history__date {
  font-size: var(--font-small);
  color: var(--text-muted);
}
</style>
