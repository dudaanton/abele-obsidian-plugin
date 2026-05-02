<template>
  <ObsidianModal title="Chat History" @close="emit('close')">
    <div class="abele-chat-history">
      <input
        ref="searchRef"
        type="text"
        class="abele-chat-history__search"
        placeholder="Search chats..."
        :value="query"
        @input="query = ($event.target as HTMLInputElement).value"
      />

      <div v-if="filtered.length === 0" class="abele-chat-history__empty">
        {{ allChats.length === 0 ? 'No previous chats' : 'No matches' }}
      </div>

      <div ref="listRef" class="abele-chat-history__list" @scroll="onScroll">
        <div
          v-for="chat in visible"
          :key="chat.path"
          class="abele-chat-history__item"
          @click="select(chat.path)"
        >
          <div class="abele-chat-history__info">
            <div class="abele-chat-history__title">{{ chat.title || chat.path }}</div>
            <div class="abele-chat-history__date">{{ formatDate(chat) }}</div>
          </div>
          <Icon icon="trash" @click.stop="remove(chat.path)" />
        </div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Icon from './obsidian/Icon.vue'
import { ChatStorage } from '@/ai/ChatStorage'
import { GlobalStore } from '@/stores/GlobalStore'
import type { AiChatHistoryEntry } from '@/ai/types'
import dayjs from 'dayjs'

const PAGE_SIZE = 30

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', file: TFile): void
}>()

const searchRef = ref<HTMLInputElement>()
const listRef = ref<HTMLElement>()
const allChats = ref<AiChatHistoryEntry[]>([])
const query = ref('')
const limit = ref(PAGE_SIZE)

// mtime cache to avoid repeated vault lookups
const mtimeMap = new Map<string, number>()

onMounted(async () => {
  const history = await ChatStorage.getInstance().refreshHistory()
  const { app } = GlobalStore.getInstance()

  for (const entry of history) {
    const f = app.vault.getAbstractFileByPath(entry.path)
    mtimeMap.set(entry.path, f instanceof TFile ? f.stat.mtime : 0)
  }

  allChats.value = [...history].sort(
    (a, b) => (mtimeMap.get(b.path) || 0) - (mtimeMap.get(a.path) || 0)
  )

  await nextTick()
  searchRef.value?.focus()
})

const filtered = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return allChats.value
  return allChats.value.filter(
    (c) => (c.title || '').toLowerCase().includes(q) || c.path.toLowerCase().includes(q)
  )
})

const visible = computed(() => filtered.value.slice(0, limit.value))

const onScroll = () => {
  const el = listRef.value
  if (!el) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
    if (limit.value < filtered.value.length) {
      limit.value += PAGE_SIZE
    }
  }
}

const formatDate = (chat: AiChatHistoryEntry) => {
  const mtime = mtimeMap.get(chat.path)
  if (mtime) return dayjs(mtime).format('YYYY-MM-DD HH:mm')
  return chat.created || ''
}

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
  allChats.value = allChats.value.filter((c) => c.path !== path)
  mtimeMap.delete(path)
}
</script>

<style lang="scss">
.abele-chat-history {
  display: flex;
  flex-direction: column;
  min-width: min(400px, 90vw);
}

.abele-chat-history__search {
  padding: var(--size-4-2) var(--size-4-3);
  margin-bottom: var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: var(--font-ui-medium);

  &::placeholder {
    color: var(--text-faint);
  }
}

.abele-chat-history__list {
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
