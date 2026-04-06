<template>
  <ObsidianModal title="Chat History" @close="emit('close')">
    <div class="abele-chat-history">
      <div v-if="loading" class="abele-chat-history__loading">Loading...</div>
      <div v-else-if="chats.length === 0" class="abele-chat-history__empty">No previous chats</div>
      <div
        v-for="chat in chats"
        :key="chat.path"
        class="abele-chat-history__item"
        @click="select(chat)"
      >
        <div class="abele-chat-history__title">{{ chatTitle(chat) }}</div>
        <div class="abele-chat-history__date">{{ formatDate(chat.stat.mtime) }}</div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { TFile } from 'obsidian'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import { ChatStorage } from '@/ai/ChatStorage'
import { GlobalStore } from '@/stores/GlobalStore'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', file: TFile): void
}>()

const chats = ref<TFile[]>([])
const loading = ref(true)

onMounted(async () => {
  chats.value = await ChatStorage.getInstance().listChats()
  loading.value = false
})

const chatTitle = (file: TFile): string => {
  const cache = GlobalStore.getInstance().app.metadataCache.getFileCache(file)
  return cache?.frontmatter?.title || file.basename
}

const formatDate = (timestamp: number): string => {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm')
}

const select = (file: TFile) => {
  emit('select', file)
  emit('close')
}
</script>

<style lang="scss">
.abele-chat-history {
  max-height: 400px;
  overflow-y: auto;
}

.abele-chat-history__loading,
.abele-chat-history__empty {
  padding: var(--size-4-4);
  text-align: center;
  color: var(--text-muted);
}

.abele-chat-history__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--size-4-2) var(--size-4-3);
  cursor: pointer;
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-chat-history__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-chat-history__date {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-left: var(--size-4-2);
  white-space: nowrap;
}
</style>
