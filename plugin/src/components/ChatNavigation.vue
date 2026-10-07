<template>
  <ObsidianModal title="Navigation" size="tall" @close="emit('close')">
    <div ref="root" class="abele-chat-navigation" tabindex="-1" @keydown="onKey">
      <Search v-model="query" placeholder="Find in this chat…" />
      <div class="abele-chat-navigation__controls">
        <label class="abele-chat-navigation__controls"
          >Search scope <Dropdown v-model="scope" :options="SCOPES"
        /></label>
        <div class="abele-chat-navigation__controls">
          <Checkbox
            :is-enabled="includeDiscussions"
            aria-label="Search discussions"
            @toggle="includeDiscussions = !includeDiscussions"
          />
          <span @click="includeDiscussions = !includeDiscussions"
            >Search discussions (including nested)</span
          >
        </div>
      </div>
      <div class="abele-chat-navigation__actions">
        <button type="button" :disabled="!sent.length" @click="emit('start')">To start</button>
        <button type="button" :disabled="!sent.length" @click="emit('latest')">To latest</button>
        <button type="button" :disabled="!canGoBack" @click="emit('back')">Back to place</button>
      </div>
      <div v-if="pending" class="setting-item-description" aria-live="polite">
        {{ pending }}
        <button type="button" @click="emit('cancel-pending')">Cancel branch switch</button>
      </div>
      <div
        v-if="includeDiscussions && query.trim()"
        class="abele-chat-navigation__controls"
        aria-live="polite"
      >
        <span class="setting-item-description"
          >{{ searchCanceled ? 'Search canceled' : searchRunning ? 'Reading' : 'Searched' }} ·
          {{ progress.done }} of {{ progress.total }} discussions</span
        >
        <button v-if="searchRunning" type="button" @click="cancelSearch">Cancel search</button>
      </div>
      <div ref="list" class="abele-chat-navigation__list" @scroll="rememberScroll">
        <template v-if="query.trim()">
          <div
            v-if="!hits.length && !discussionHits.length && !searchRunning"
            class="setting-item-description"
          >
            No matches{{ scope === 'current' ? ' in the current branch' : ' in this chat' }}
          </div>
          <button
            v-for="hit in hits"
            :key="`${hit.messageId}:${hit.part}`"
            type="button"
            data-nav-item
            class="abele-chat-navigation__row"
            @click="emit('jump', hit.messageId, hit.part, query)"
          >
            <span
              ><span v-if="scope === 'all'" class="setting-item-description"
                >{{ labels.get(hit.messageId) }} · </span
              >{{ hit.snippet.before
              }}<span class="search-result-file-matched-text">{{ hit.snippet.match }}</span
              >{{ hit.snippet.after }}</span
            ><time>{{ timeOf(hit.timestamp) }}</time>
          </button>
          <button
            v-for="hit in discussionHits"
            :key="`${hit.discussionId}:${hit.messageId}:${hit.part}`"
            type="button"
            data-nav-item
            class="abele-chat-navigation__row"
            @click="emit('discussion', hit.discussionId, hit.messageId, hit.part, query)"
          >
            <span
              ><span class="setting-item-description"
                >{{ hit.label
                }}<template v-if="scope === 'all'"> · {{ hit.continuation }}</template> · </span
              >{{ hit.snippet.before
              }}<span class="search-result-file-matched-text">{{ hit.snippet.match }}</span
              >{{ hit.snippet.after }}</span
            ><time>{{ timeOf(hit.timestamp) }}</time>
          </button>
          <div
            v-for="entry in unavailable"
            :key="entry.discussionId"
            class="setting-item-description"
          >
            Unavailable discussion — deleted, unreadable or not yet synced · {{ entry.label }}
          </div>
        </template>
        <template v-else>
          <div v-if="!sent.length" class="setting-item-description">No sent messages</div>
          <ChatNavigationFork
            v-if="rootFork"
            :fork="rootFork"
            :tree="tree"
            :current-ids="currentIds"
            :comments="comments"
            :state="state"
            @jump="forwardJump"
            @discussion="(id) => emit('discussion', id)"
          />
          <ChatNavigationRows
            :messages="messages"
            :comments="comments"
            :tree="tree"
            :current-ids="currentIds"
            :state="state"
            :active-message-id="activeMessageId"
            @jump="forwardJump"
            @discussion="(id) => emit('discussion', id)"
          />
        </template>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import Search from './obsidian/Search.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Checkbox from './obsidian/Checkbox.vue'
import ChatNavigationRows from './ChatNavigationRows.vue'
import ChatNavigationFork from './ChatNavigationFork.vue'
import {
  buildChatNavigation,
  searchChatNavigation,
  type NavigationState,
} from '@/ai/chatNavigation'
import {
  buildNavigationTree,
  navigationFork,
  navigationBranchLabels,
} from '@/ai/chatNavigationBranches'
import {
  searchNavigationDiscussions,
  type DiscussionNavigationHit,
  type UnavailableDiscussion,
  type DiscussionSearchProgress,
} from '@/ai/chatNavigationDiscussionSearch'
import { CommentService } from '@/ai/CommentService'
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
  (e: 'close'): void
  (e: 'start'): void
  (e: 'latest'): void
  (e: 'back'): void
  (e: 'cancel-pending'): void
  (e: 'jump', id: string, part?: FindPart, query?: string): void
  (e: 'discussion', id: string, messageId?: string, part?: FindPart, query?: string): void
}>()
const SCOPES = [
  { value: 'current', display: 'Current branch' },
  { value: 'all', display: 'All branches of this chat' },
]
const forwardJump = (id: string, part?: FindPart) => {
  if (part) emit('jump', id, part)
  else emit('jump', id)
}
const root = ref<HTMLElement>()
const list = ref<HTMLElement>()
const query = ref('')
const scope = ref('current')
const includeDiscussions = ref(false)
const sent = computed(() => props.messages.filter((m) => !m.draft))
const tree = computed(() => buildNavigationTree(props.allMessages ?? props.messages))
const currentIds = computed(() => props.messages.map((m) => m.id))
const rootFork = computed(() => navigationFork(tree.value, undefined, currentIds.value))
const labels = computed(() => navigationBranchLabels(tree.value))
const searchedMessages = computed(() =>
  scope.value === 'all' ? [...tree.value.byId.values()] : props.messages
)
const hits = computed(() => searchChatNavigation(searchedMessages.value, query.value))
const discussionHits = shallowRef<DiscussionNavigationHit[]>([])
const unavailable = shallowRef<UnavailableDiscussion[]>([])
const progress = ref<DiscussionSearchProgress>({ done: 0, total: 0 })
const searchRunning = ref(false)
const searchCanceled = ref(false)
let controller: AbortController | undefined
let generation = 0
let timer: number | undefined
const win = () => root.value?.ownerDocument.defaultView ?? window
const invalidateSearch = () => {
  generation++
  controller?.abort()
  if (timer !== undefined) win().clearTimeout(timer)
  timer = undefined
  searchRunning.value = false
}
const cancelSearch = () => {
  invalidateSearch()
  searchCanceled.value = true
}
watch(
  [
    query,
    scope,
    includeDiscussions,
    () => props.messages,
    () => props.allMessages,
    () => props.comments,
  ],
  () => {
    invalidateSearch()
    discussionHits.value = []
    unavailable.value = []
    progress.value = { done: 0, total: 0 }
    searchCanceled.value = false
    if (!includeDiscussions.value || !query.value.trim()) return
    const mine = generation
    const words = query.value
    const allBranches = scope.value === 'all'
    const seeds = buildChatNavigation(searchedMessages.value, props.comments).flatMap(
      (turn) => turn.discussions
    )
    timer = win().setTimeout(() => {
      timer = undefined
      if (mine !== generation) return
      controller = new AbortController()
      searchRunning.value = true
      void searchNavigationDiscussions({
        query: words,
        seeds,
        allBranches,
        signal: controller.signal,
        read: async (id) => {
          const preview = await CommentService.getInstance().navigationPreview(id)
          if (!preview || preview.isDestroyed) return null
          return {
            messages: preview.messages.value,
            allMessages: preview.allMessages?.value,
            comments: preview.messageComments.value,
          }
        },
        onProgress: (value) => {
          if (mine === generation) progress.value = value
        },
        onHit: (hit) => {
          if (mine === generation) discussionHits.value = [...discussionHits.value, hit]
        },
        onUnavailable: (entry) => {
          if (mine === generation) unavailable.value = [...unavailable.value, entry]
        },
        yield: () => new Promise((resolve) => win().setTimeout(resolve, 0)),
      }).then(() => {
        if (mine === generation) searchRunning.value = false
      })
    }, 180)
  }
)
onBeforeUnmount(invalidateSearch)
const rememberScroll = () => {
  if (list.value) props.state.scrollTop = list.value.scrollTop
}
const timeOf = (at: number) => dayjs(at).format('HH:mm')
onMounted(async () => {
  await nextTick()
  if (list.value) list.value.scrollTop = props.state.scrollTop
  root.value?.focus({ preventScroll: true })
  if (props.focusFork) {
    const fork = list.value?.querySelector<HTMLElement>(
      `[data-fork-id="${CSS.escape(props.focusFork)}"]`
    )
    fork?.scrollIntoView({ block: 'center' })
    fork?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }
})
const onKey = (event: KeyboardEvent) => {
  const el = root.value
  if (!el) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }
  const target = event.target as HTMLElement
  if (target.tagName === 'SELECT') return
  if (event.key === 'Enter' && target.matches('[data-nav-item]')) {
    event.preventDefault()
    target.click()
    return
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    if (!target.matches('summary')) return
    event.preventDefault()
    ;(target.parentElement as HTMLDetailsElement).open = event.key === 'ArrowRight'
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [...el.querySelectorAll<HTMLElement>('[data-nav-item]:not(:disabled)')].filter(
    (item) => {
      for (
        let parent = item.parentElement;
        parent && parent !== el;
        parent = parent.parentElement
      ) {
        if (
          parent.tagName === 'DETAILS' &&
          !(parent as HTMLDetailsElement).open &&
          parent.firstElementChild !== item
        )
          return false
      }
      return true
    }
  )
  if (!items.length) return
  event.preventDefault()
  const at = items.indexOf(target)
  const next =
    at < 0
      ? event.key === 'ArrowDown'
        ? 0
        : items.length - 1
      : Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
  items[next].focus()
}
</script>

<style lang="scss">
.abele-chat-navigation {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  gap: var(--size-4-2);
}
.abele-chat-navigation__actions,
.abele-chat-navigation__controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-chat-navigation__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-4-2);
  margin: calc(-1 * var(--size-4-2));
}
.abele-chat-navigation__row {
  display: flex;
  width: 100%;
  height: auto;
  min-width: 0;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--size-4-2);
  white-space: normal;
  text-align: start;
  margin-block: var(--size-4-1);
}
.abele-chat-navigation .setting-item-description {
  overflow-wrap: anywhere;
  min-width: 0;
}
.abele-chat-navigation__row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-chat-navigation time {
  flex-shrink: 0;
  color: var(--text-muted);
}
.abele-chat-navigation summary {
  padding: var(--size-4-1);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.abele-chat-navigation__list .is-selected {
  background: var(--background-modifier-hover);
}
.abele-chat-navigation__discussions {
  padding: var(--size-4-2);
}
.abele-chat-navigation__discussion > button {
  height: auto;
  white-space: normal;
  text-align: start;
  width: 100%;
  overflow-wrap: anywhere;
  margin-block: var(--size-4-1);
}
</style>
