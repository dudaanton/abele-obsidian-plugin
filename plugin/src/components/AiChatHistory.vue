<template>
  <ObsidianModal :title="t('streamB.chatHistory.05a05a')" size="tall" @close="emit('close')">
    <!-- Every chat had, by day, newest first. Obsidian's own search field on top, and beside it
         as glyphs, the way its search pane has them: searching the messages too, and the order. -->
    <div class="abele-chat-history" @keydown.down="intoList">
      <div class="abele-chat-history__head search-row">
        <Search
          ref="searchRef"
          v-model="query"
          class="abele-chat-history__search abele-chat-history__field"
          :placeholder="
            contentSearch
              ? t('streamB.searchTitlesAndMessages.d2c785')
              : t('streamB.searchTitles.72dd0f')
          "
          :label="t('streamB.searchChats.02a39c')"
          input-class="abele-chat-history__search"
        />
        <Icon
          icon="text-search"
          class="abele-chat-history__content"
          :active="contentSearch"
          :label="
            contentSearch
              ? t('streamB.searchingMessagesToo.4127c2')
              : t('streamB.searchInMessagesToo.508f7c')
          "
          @click="setContentSearch(!contentSearch)"
        />
        <Icon
          icon="arrow-down-wide-narrow"
          class="abele-chat-history__order"
          aria-haspopup="menu"
          :label="t('streamB.sortedBy.def07f', { v0: String(orderLabel.toLowerCase()) })"
          @click="orderMenu"
        />
      </div>

      <!-- The first search in the messages reads every chat once: a quiet line while it does. -->
      <div v-if="reading" class="abele-chat-history__status" aria-live="polite">
        <Icon icon="loader" size="xs" :interactive="false" class="abele-chat-history__spinner" />
        <span>{{ t('streamB.readingChats.e3a5c7') }}</span>
        <MetaLine
          class="abele-chat-history__progress"
          :aria-label="
            t('streamB.of.ef59ff', { v0: String(reading.done), v1: String(reading.total) })
          "
          :facts="[{ key: '0', value: `${reading.done}/${reading.total}` }]"
        />
      </div>

      <EmptyState
        v-if="filtered.length === 0 && !reading && allChats.length === 0"
        class="abele-chat-history__empty"
        icon="history"
        :text="t('streamB.noChatsYet.269208')"
      />
      <EmptyState
        v-else-if="filtered.length === 0 && !reading"
        class="abele-chat-history__empty"
        variant="no-matches"
        :text="t('streamB.noMatches.2df01a')"
      >
        <template v-if="!contentSearch" #action>
          <Button :text="t('streamB.searchInMessages.b463e2')" @click="setContentSearch(true)" />
        </template>
      </EmptyState>

      <div ref="listRef" class="abele-chat-history__list">
        <template v-for="(chat, i) in visible" :key="chat.path">
          <!-- A day over the chats of that day, by the date the list goes by. -->
          <DateDivider v-if="dayOf(chat) !== dayOf(visible[i - 1])" :date="dayOf(chat)" />
          <Card
            :ref="(card) => watchCard(card, chat)"
            class="abele-chat-history__card"
            :data-path="chat.path"
            :title="chat.title || chat.path"
            :description="hits.get(chat.path) ? undefined : describe(chat)"
            :meta="metaOf(chat)"
            clickable
            @click="select(chat.path)"
          >
            <template v-if="tabState(chat.path)" #badges>
              <StatusDot
                :tone="tabState(chat.path) === 'waiting' ? 'orange' : 'accent'"
                :label="
                  tabState(chat.path) === 'waiting'
                    ? t('streamB.openInATabWaitingForYou.0240d8')
                    : t('streamB.openInATab.6f3a85')
                "
              />
            </template>
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
              <Icon
                class="abele-chat-history__delete"
                icon="trash"
                :tooltip="t('streamB.deleteChat.93291d')"
                @click="remove(chat.path)"
              />
            </template>
          </Card>
        </template>
        <div v-if="hasMore" ref="sentinel" class="abele-chat-history__sentinel" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { streamBCount } from '@/i18n/streamBCounts'
import { t } from '@/i18n'
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
import { Menu, TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Card from './obsidian/Card.vue'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import Search from './obsidian/Search.vue'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
import EmptyState from './obsidian/EmptyState.vue'
import MetaLine from './obsidian/MetaLine.vue'
import StatusDot from './obsidian/StatusDot.vue'
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
import { ChatService } from '@/ai/ChatService'
import { confirmDialog } from '@/components/obsidian/dialogs'
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

const searchRef = ref<InstanceType<typeof Search>>()
const listRef = ref<HTMLElement>()
const allChats = ref<AiChatHistoryEntry[]>([])
const query = ref('')

/** This device's search scope, deliberately outside synced/transferable settings. */
const CONTENT_SEARCH_KEY = 'abele-chat-history-content'
const contentSearch = ref(
  GlobalStore.getInstance().app.loadLocalStorage(CONTENT_SEARCH_KEY) === true
)
const setContentSearch = (enabled: boolean) => {
  contentSearch.value = enabled
  GlobalStore.getInstance().app.saveLocalStorage(CONTENT_SEARCH_KEY, enabled)
}

/** The chats' files, looked up once: creation time stands in when message dates are absent. */
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
const orderLabel = computed(
  () => HISTORY_ORDERS.find((o) => o.value === order.value)?.display ?? ''
)
/** The orders as Obsidian's menu, the one in force checked. */
const orderMenu = (event: MouseEvent) => {
  const menu = new Menu()
  for (const option of HISTORY_ORDERS)
    menu.addItem((item) =>
      item
        .setTitle(option.display)
        .setChecked(option.value === order.value)
        .onClick(() => setOrder(option.value))
    )
  menu.showAtMouseEvent(event)
}

/** Down from the field goes to the first chat, as in Obsidian's own lists. */
const intoList = (event: KeyboardEvent) => {
  if (event.target !== searchRef.value?.inputRef) return
  const first = listRef.value?.querySelector<HTMLElement>('.abele-card')
  if (!first) return
  event.preventDefault()
  first.focus()
}

/** A chat already open in a tab, and whether it waits there for an answer from you. */
const tabState = (path: string): 'open' | 'waiting' | null => {
  const session = ChatService.getInstance().getSessionByFile(path)
  if (!session) return null
  return session.pendingToolCalls.value.length || session.pendingQuestions.value
    ? 'waiting'
    : 'open'
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
      (describe(c) || '').toLowerCase().includes(q) ||
      (contentSearch.value && hits.value.has(c.path))
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
  if (!contentSearch.value || foldQuery(words).trim().length < MIN_CONTENT_QUERY) {
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

watch([query, contentSearch], ([words, enabled]) => {
  window.clearTimeout(searchTimer)
  // Invalidate a pending read immediately, not after the next debounce. No stale snippets or
  // message destinations survive a changed query or a switch back to metadata-only search.
  generation++
  hits.value = new Map()
  hitsFor = ''
  reading.value = null
  if (enabled) {
    searchTimer = window.setTimeout(() => void searchMessages(words), CONTENT_SEARCH_DELAY_MS)
  }
})

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  generation++
})

/** The date, and for a chat found by its messages, when the one found was written. */
const metaOf = (chat: AiChatHistoryEntry): string[] => {
  const hit = hits.value.get(chat.path)
  if (!hit) return [formatDate(chat)]
  const matches = streamBCount(hit.count, 'match')
  // The message found may be from another day than the one the chat stands under.
  const sameDay = dayjs(hit.timestamp).format(DATE_FORMAT) === dayOf(chat)
  const at = formatTimestamp(hit.timestamp, { mode: 'absolute' })
  return [matches, sameDay && at.datetime ? at.clock : at.exact]
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

/** Only the time, small: the day already stands over the card. */
const formatDate = (chat: AiChatHistoryEntry) => {
  const at = dateOf(chat)
  const time = formatTimestamp(at ?? chat.created, { mode: 'absolute' })
  return time.datetime ? time.clock : time.label
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
  const { app } = GlobalStore.getInstance()
  if (
    !(await confirmDialog({
      title: t('streamB.deleteChat.93291d'),
      message: t('streamB.deleteThisChatAndItsCommentsThis.0cb2ce'),
    }))
  )
    return
  const service = ChatService.getInstance()
  const session = service.getSessionByFile(path)
  if (session) {
    // The live session must stop owning the file before it is removed.
    await service.deleteChat(session.id)
  } else {
    // Comments on its answers have no other way in, so they go first, while it can say which.
    await CommentService.getInstance().removeCommentsOn(path)
    await ChatStorage.getInstance().deleteChat(path)
  }
  allChats.value = allChats.value.filter((c) => c.path !== path)
  files.delete(path)
}
</script>

<style lang="scss">
/**
 * A tall dialog, a column: the search stays put and the cards scroll under it. Cards with a
 * summary under the title are three times the height of one-line rows, so a list capped at a
 * desktop box would show three of them; on a phone it is the whole sheet.
 */
.abele-chat-history {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: min(400px, 90vw);
}

/** Obsidian's search row: the field takes the room, the glyphs keep theirs beside it. */
.abele-chat-history__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin: var(--size-4-3) 0 var(--size-4-4);
  padding-inline: 0;
}

.abele-chat-history__field {
  flex: 1 1 auto;
  min-width: 0;
}

.abele-chat-history__search {
  width: 100%;
}

.abele-chat-history__status {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-chat-history__spinner svg {
  animation: abele-chat-history-spin 1.2s linear infinite;
}
@keyframes abele-chat-history-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .abele-chat-history__spinner svg {
    animation: none;
  }
}

.abele-chat-history__progress {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
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

/** Deleting is there under the pointer; a phone, which cannot point, keeps it in sight. */
body:not(.is-mobile)
  .abele-chat-history__card:not(:hover):not(:focus-within)
  .abele-chat-history__delete {
  opacity: 0;
}

.abele-chat-history__sentinel {
  height: 1px;
  flex: 0 0 auto;
}

/** The words found and a few either side, under the title of a chat found by its messages. */
.abele-chat-history__snippet {
  font-family: var(--font-interface);
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
