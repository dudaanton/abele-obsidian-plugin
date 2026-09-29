<template>
  <ObsidianModal title="Chat History" size="tall" @close="emit('close')">
    <div class="abele-chat-history">
      <div class="abele-chat-history__bar">
        <input
          ref="searchRef"
          type="text"
          class="abele-chat-history__search"
          placeholder="Search chats..."
          :value="query"
          @input="query = ($event.target as HTMLInputElement).value"
        />
        <!-- Which date the list goes by: the last message, or when the chat was started. -->
        <Dropdown
          class="abele-chat-history__order"
          aria-label="Order the chats by"
          :options="HISTORY_ORDERS"
          :model-value="order"
          @update:model-value="setOrder"
        />
      </div>

      <div v-if="reading" class="abele-chat-history__status" aria-live="polite">
        Searching the messages… {{ reading.done }} of {{ reading.total }} chats
      </div>

      <div v-if="filtered.length === 0 && !reading" class="abele-chat-history__empty">
        {{ allChats.length === 0 ? 'No previous chats' : 'No matches' }}
      </div>

      <div ref="listRef" class="abele-chat-history__list">
        <template v-for="(chat, i) in visible" :key="chat.path">
          <!-- A day over the chats of that day, by the date the list goes by. -->
          <DateDivider v-if="dayOf(chat) !== dayOf(visible[i - 1])" :date="dayOf(chat)" />
          <Card
            :ref="(card) => watchCard(card, chat)"
            :data-path="chat.path"
            :title="chat.title || chat.path"
            :description="hits.get(chat.path) ? undefined : describe(chat)"
            :meta="metaOf(chat)"
            clickable
            @click="select(chat.path)"
          >
            <template v-if="hits.get(chat.path)" #subtitle>
              <span class="abele-chat-history__snippet"
                >{{ hits.get(chat.path)!.snippet.before
                }}<span class="search-result-file-matched-text">{{
                  hits.get(chat.path)!.snippet.match
                }}</span
                >{{ hits.get(chat.path)!.snippet.after }}</span
              >
            </template>
            <template #actions>
              <Icon icon="trash" tooltip="Delete chat" @click="remove(chat.path)" />
            </template>
          </Card>
        </template>
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
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Card from './obsidian/Card.vue'
import Icon from './obsidian/Icon.vue'
import Dropdown from './obsidian/Dropdown.vue'
import DateDivider from './obsidian/DateDivider.vue'
import {
  HISTORY_ORDERS,
  HISTORY_ORDER_KEY,
  historyDate,
  isHistoryOrder,
  sortHistory,
  type HistoryOrder,
} from '@/ai/chatHistoryOrder'
import { DATE_FORMAT } from '@/constants/dates'
import { ChatStorage } from '@/ai/ChatStorage'
import { CommentService } from '@/ai/CommentService'
import { SummaryBackfill } from '@/ai/ChatDigest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { usePagedList } from '@/composables/usePagedList'
import { ChatSearchIndex, type ChatSearchHit, type PrepareProgress } from '@/ai/ChatSearchIndex'
import { foldQuery } from '@/ai/chatFind'
import type { AiChatHistoryEntry } from '@/ai/types'
import dayjs from 'dayjs'

const PAGE_SIZE = 30

const emit = defineEmits<{
  (e: 'close'): void
  /** `found` when the chat was picked by words in its messages: where they are, to open on. */
  (e: 'select', file: TFile, found?: { query: string; messageId: string }): void
}>()

const searchRef = ref<HTMLInputElement>()
const listRef = ref<HTMLElement>()
const allChats = ref<AiChatHistoryEntry[]>([])
const query = ref('')

/** The chats' files, looked up once: their times stand in for a chat with no messages. */
const files = new Map<string, TFile | null>()
const fileOf = (path: string) => files.get(path) ?? null

/** The date the list goes by, chosen on this device and kept there. */
const order = ref<HistoryOrder>('last')
{
  const saved = GlobalStore.getInstance().app.loadLocalStorage(HISTORY_ORDER_KEY)
  if (isHistoryOrder(saved)) order.value = saved
}
const setOrder = (value: string) => {
  if (!isHistoryOrder(value)) return
  order.value = value
  GlobalStore.getInstance().app.saveLocalStorage(HISTORY_ORDER_KEY, value)
}

/** Every chat in the order chosen, newest first; what the search narrows keeps that order. */
const sorted = computed(() => sortHistory(allChats.value, order.value, fileOf))

/** A chat's moment in the order chosen. */
const dateOf = (chat: AiChatHistoryEntry) => historyDate(chat, order.value, fileOf(chat.path))

/** The day a chat falls on in that order, for the dividers; empty when nothing is known. */
const dayOf = (chat: AiChatHistoryEntry | undefined): string => {
  const at = chat ? dateOf(chat) : 0
  return at ? dayjs(at).format(DATE_FORMAT) : ''
}

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
    files.set(entry.path, f instanceof TFile ? f : null)
  }

  allChats.value = history.map((entry) => ({ ...entry }))

  await nextTick()
  searchRef.value?.focus()
})

const filtered = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return sorted.value
  return sorted.value.filter(
    (c) =>
      (c.title || '').toLowerCase().includes(q) ||
      (c.summary || '').toLowerCase().includes(q) ||
      c.path.toLowerCase().includes(q) ||
      hits.value.has(c.path)
  )
})

// ── Search in the messages ──

/** Shorter than this, a query matches too much of every chat to be worth reading them for. */
const MIN_CONTENT_QUERY = 2
/** How long typing has to pause before the messages are searched. */
const CONTENT_SEARCH_DELAY_MS = 200

/** The chats whose messages hold the words, by path — the query the list was last searched by. */
const hits = shallowRef<Map<string, ChatSearchHit>>(new Map())
/** How far reading the chats has got, while it is under way — the first search of a session. */
const reading = ref<PrepareProgress | null>(null)
/** The words `hits` answers, which is what a picked result opens the find bar on. */
let hitsFor = ''
let searchTimer = 0
/** Which search is the latest, so one typed over stops reading and does not answer. */
let generation = 0

const searchMessages = async (words: string) => {
  const mine = ++generation
  if (foldQuery(words).trim().length < MIN_CONTENT_QUERY) {
    hits.value = new Map()
    reading.value = null
    return
  }
  const index = ChatSearchIndex.getInstance()
  const { app } = GlobalStore.getInstance()
  const files = allChats.value
    .map((c) => app.vault.getAbstractFileByPath(c.path))
    .filter((f): f is TFile => f instanceof TFile)
  if (!index.isReady(files)) {
    await index.prepare(
      app,
      files,
      (progress) => {
        // Only a first reading is worth a line: a chat or two that changed since is instant.
        if (mine === generation && progress.total - progress.done > 5) reading.value = progress
      },
      () => mine !== generation
    )
  }
  if (mine !== generation) return
  reading.value = null
  hitsFor = words
  hits.value = index.search(words)
}

watch(query, (words) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void searchMessages(words), CONTENT_SEARCH_DELAY_MS)
})

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  generation++
})

/** The date, and for a chat found by its messages, when the one found was written. */
const metaOf = (chat: AiChatHistoryEntry): string[] => {
  const hit = hits.value.get(chat.path)
  if (!hit) return [formatDate(chat)]
  const matches = hit.count === 1 ? '1 match' : `${hit.count} matches`
  return [dayjs(hit.timestamp).format('D MMM YYYY, HH:mm'), matches]
}

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

/** Only the date, small, under the summary: the one the list goes by. */
const formatDate = (chat: AiChatHistoryEntry) => {
  const at = dateOf(chat)
  if (at) return dayjs(at).format('D MMM YYYY, HH:mm')
  return chat.created || ''
}

const select = (path: string) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    const hit = hits.value.get(path)
    emit('select', file, hit ? { query: hitsFor, messageId: hit.messageId } : undefined)
    emit('close')
  }
}

const remove = async (path: string) => {
  // Comments on its answers have no other way in, so they go first, while it can say which.
  await CommentService.getInstance().removeCommentsOn(path)
  await ChatStorage.getInstance().deleteChat(path)
  allChats.value = allChats.value.filter((c) => c.path !== path)
  files.delete(path)
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

.abele-chat-history__bar {
  display: flex;
  gap: var(--size-4-2);
  align-items: center;
  margin-bottom: var(--size-4-2);
}

/** The order's own width, whole: the search field is the one that gives way on a phone. */
.abele-chat-history__order {
  flex: 0 0 auto;

  select {
    width: auto;
    max-width: none;
  }
}

.abele-chat-history__search {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--size-4-2) var(--size-4-3);
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

.abele-chat-history__status {
  padding: var(--size-4-1) var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

/** The words found and a few either side, under the title of a chat found by its messages. */
.abele-chat-history__snippet {
  font-family: var(--font-interface);
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  white-space: normal;
  overflow-wrap: anywhere;
}

.abele-chat-history__empty {
  padding: var(--size-4-4);
  text-align: center;
  color: var(--text-muted);
}
</style>
