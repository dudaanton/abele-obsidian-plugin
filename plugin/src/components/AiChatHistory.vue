<template>
  <ObsidianModal title="Chat History" size="tall" @close="emit('close')">
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

      <div ref="listRef" class="abele-chat-history__list">
        <Card
          v-for="chat in visible"
          :key="chat.path"
          :ref="(card) => watchCard(card, chat)"
          :data-path="chat.path"
          :title="chat.title || chat.path"
          :description="describe(chat)"
          :meta="[formatDate(chat)]"
          clickable
          @click="select(chat.path)"
        >
          <template #actions>
            <Icon icon="trash" tooltip="Delete chat" @click="remove(chat.path)" />
          </template>
        </Card>
        <div v-if="hasMore" ref="sentinel" class="abele-chat-history__sentinel" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  nextTick,
  type ComponentPublicInstance,
} from 'vue'
import { TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Card from './obsidian/Card.vue'
import Icon from './obsidian/Icon.vue'
import { ChatStorage } from '@/ai/ChatStorage'
import { SummaryBackfill } from '@/ai/ChatDigest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { usePagedList } from '@/composables/usePagedList'
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

// mtime cache to avoid repeated vault lookups
const mtimeMap = new Map<string, number>()

/**
 * A summary arriving for a card on screen. The entry is replaced rather than mutated: the list
 * holds copies, and a copy changed in place is not something Vue sees.
 */
const backfill = new SummaryBackfill((path, summary) => {
  ChatStorage.getInstance().setSummary(path, summary)
  allChats.value = allChats.value.map((c) => (c.path === path ? { ...c, summary } : c))
})

onMounted(async () => {
  const history = await ChatStorage.getInstance().refreshHistory()
  const { app } = GlobalStore.getInstance()

  for (const entry of history) {
    const f = app.vault.getAbstractFileByPath(entry.path)
    mtimeMap.set(entry.path, f instanceof TFile ? f.stat.mtime : 0)
  }

  allChats.value = [...history]
    .map((entry) => ({ ...entry }))
    .sort((a, b) => (mtimeMap.get(b.path) || 0) - (mtimeMap.get(a.path) || 0))

  await nextTick()
  searchRef.value?.focus()
})

const filtered = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return allChats.value
  return allChats.value.filter(
    (c) =>
      (c.title || '').toLowerCase().includes(q) ||
      (c.summary || '').toLowerCase().includes(q) ||
      c.path.toLowerCase().includes(q)
  )
})

const { visible, hasMore, sentinel } = usePagedList(() => filtered.value, PAGE_SIZE)

/**
 * The summary, or the recap for a chat that has none yet: that sentence is about the same
 * conversation, and a card with something under its title reads better than one without.
 */
const describe = (chat: AiChatHistoryEntry): string | undefined =>
  chat.summary || chat.recap || undefined

// ── Summaries for the cards somebody actually sees ──

/**
 * Only a card that comes on screen asks for a summary. The history is every chat ever had,
 * and walking all of it would be one background request per conversation on every opening.
 */
let cardObserver: IntersectionObserver | null = null
const observed = new Map<Element, AiChatHistoryEntry>()

const needsSummary = (chat: AiChatHistoryEntry) =>
  !chat.summary && AbeleConfig.getInstance().ai.enabled

const watchCard = (card: Element | ComponentPublicInstance | null, chat: AiChatHistoryEntry) => {
  const el = (card as ComponentPublicInstance | null)?.$el as Element | undefined
  if (!el || observed.has(el) || !needsSummary(chat)) return
  if (!cardObserver && typeof IntersectionObserver !== 'undefined') {
    cardObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const seen = observed.get(entry.target)
        cardObserver?.unobserve(entry.target)
        observed.delete(entry.target)
        if (seen && needsSummary(seen)) backfill.request(seen.path)
      }
    })
  }
  if (!cardObserver) return
  observed.set(el, chat)
  cardObserver.observe(el)
}

onBeforeUnmount(() => {
  cardObserver?.disconnect()
  observed.clear()
  backfill.dispose()
})

/** Only the date, small, under the summary: when the chat was last written to. */
const formatDate = (chat: AiChatHistoryEntry) => {
  const mtime = mtimeMap.get(chat.path)
  if (mtime) return dayjs(mtime).format('D MMM YYYY, HH:mm')
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
/**
 * A tall dialog, a column: the search stays put and the cards scroll under it. Cards with a
 * summary under the title are three times the height of the old one-line rows, so a list capped
 * at a desktop box would show three of them; on a phone it is the whole sheet.
 */
.abele-chat-history {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
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

/**
 * The one thing that scrolls. The padding is room for a card's focus ring, which a scrolling box
 * would otherwise clip, pulled back by the same margin so the cards stand where they would.
 */
.abele-chat-history__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-2-2);
  margin: calc(-1 * var(--size-2-2));
}

.abele-chat-history__sentinel {
  height: 1px;
  flex: 0 0 auto;
}

.abele-chat-history__empty {
  padding: var(--size-4-4);
  text-align: center;
  color: var(--text-muted);
}
</style>
