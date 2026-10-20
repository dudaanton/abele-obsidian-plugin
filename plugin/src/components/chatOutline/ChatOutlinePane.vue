<template>
  <div ref="root" class="abele-chat-outline" tabindex="-1" @keydown="onKey">
    <div class="abele-chat-outline__search">
      <Search
        v-model="query"
        :placeholder="t('streamB.findInThisChat.af2c63')"
        :autofocus="autofocus"
      />
      <Icon
        v-for="b in toggles"
        :key="b.icon"
        :icon="b.icon"
        :tooltip="b.label"
        :active="b.active"
        @click="b.run"
      />
    </div>

    <!-- A branch chosen while the agent works waits for its turn to end; it can be taken back. -->
    <div v-if="pending" class="abele-chat-outline__note" aria-live="polite">
      <Icon icon="clock" size="xs" :interactive="false" />
      <span class="abele-chat-outline__note-text">{{ pending }}</span>
      <Icon
        icon="x"
        size="xs"
        :tooltip="t('streamB.cancelTheBranchSwitch.bd0ae7')"
        @click="emit('cancel-pending')"
      />
    </div>

    <!-- While searching: how many found, and how far through the discussions, which can be stopped. -->
    <div v-if="query.trim()" class="abele-chat-outline__note" aria-live="polite">
      <span class="abele-chat-outline__note-text">{{ found }}</span>
      <template v-if="discussions && (searchRunning || searchCanceled || progress.total)">
        <span class="abele-chat-outline__note-text abele-chat-outline__progress">
          <Icon icon="messages-square" size="xs" :interactive="false" />{{ progress.done }} /
          {{ progress.total }}
        </span>
        <Icon
          v-if="searchRunning"
          icon="square"
          size="xs"
          :tooltip="t('streamB.stopReadingTheDiscussions.b5dca6')"
          @click="cancelSearch"
        />
      </template>
    </div>

    <div
      ref="list"
      class="abele-chat-outline__list"
      role="tree"
      :aria-label="t('streamB.thisChat.60e292')"
      @scroll="rememberScroll"
    >
      <ChatOutlineResults
        v-if="query.trim()"
        :query="query"
        :hits="hits"
        :discussion-hits="discussionHits"
        :unavailable="unavailable"
        :messages="searchedMessages"
        :comments="comments"
        :labels="everyBranch ? labels : undefined"
        @jump="(id, part, q) => emit('jump', id, part, q)"
        @discussion="(id, m, part, q) => emit('discussion', id, m, part, q)"
      />
      <template v-else>
        <div v-if="!sent.length" class="search-empty-state">
          {{ t('streamB.nothingSentYet.a5ff06') }}
        </div>
        <ChatOutlineTurns
          :messages="messages"
          :comments="comments"
          :tree="tree"
          :current-ids="currentIds"
          :active-message-id="activeMessageId"
          @jump="(id, part) => emit('jump', id, part)"
          @discussion="(id) => emit('discussion', id)"
        />
      </template>
    </div>

    <!-- In a dialog the moves sit under the list, beside the keys, as the quick switcher shows its:
         in the dialog's own footer row, so the list scrolls to the bottom of the body. -->
    <Teleport :to="footerTo" :disabled="!footerTo">
      <div class="abele-chat-outline__footer">
        <Icon
          v-for="b in moves"
          :key="b.icon"
          :icon="b.icon"
          :tooltip="b.label"
          :disabled="b.disabled"
          @click="b.run"
        />
        <span class="abele-chat-outline__keys">
          <span><kbd>↑↓</kbd> {{ t('streamB.move.683a62') }}</span
          ><span><kbd>→</kbd> {{ t('streamB.open.2348f9') }}</span
          ><span><kbd>↵</kbd> {{ t('streamB.go.4cd0e2') }}</span>
        </span>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// A chat's outline: the questions by day, what followed each folded under it, branches and
// discussions, and a search over the chat. A dialog over the chat in the right sidebar, opened
// from the chat's header and closed by a jump.
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import Icon from '../obsidian/Icon.vue'
import Search from '../obsidian/Search.vue'
import ChatOutlineTurns from './ChatOutlineTurns.vue'
import ChatOutlineResults from './ChatOutlineResults.vue'
import { provideOutline } from './context'
import { plural } from '../nodeWork/codes'
import {
  buildChatNavigation,
  searchChatNavigation,
  type NavigationState,
} from '@/ai/chatNavigation'
import { buildNavigationTree, navigationBranchLabels } from '@/ai/chatNavigationBranches'
import {
  searchNavigationDiscussions,
  type DiscussionNavigationHit,
  type DiscussionSearchProgress,
  type NavigationDiscussionData,
  type UnavailableDiscussion,
} from '@/ai/chatNavigationDiscussionSearch'
import type { ChatMessage, MessageComment } from '@/ai/types'
import type { FindPart } from '@/ai/chatFind'

const props = withDefaults(
  defineProps<{
    /** The conversation as it goes now. */
    messages: readonly ChatMessage[]
    /** Every branch of it. */
    allMessages?: readonly ChatMessage[]
    comments: readonly MessageComment[]
    state: NavigationState
    /** The message being read now. */
    activeMessageId?: string
    canGoBack?: boolean
    autofocus?: boolean
    /** A branch switch waiting for the agent's turn to end, said in a line. */
    pending?: string
    /** A fork to open and show first. */
    focusFork?: string
    preview: (id: string) => Promise<NavigationDiscussionData | null>
    /** The dialog's footer row, where the moves go; without one they stay under the list. */
    footerTo?: HTMLElement | null
  }>(),
  {
    allMessages: undefined,
    activeMessageId: undefined,
    pending: undefined,
    focusFork: undefined,
    autofocus: true,
    footerTo: null,
  }
)
const emit = defineEmits<{
  (e: 'start'): void
  (e: 'latest'): void
  (e: 'back'): void
  (e: 'cancel-pending'): void
  (e: 'close'): void
  (e: 'jump', id: string, part?: FindPart, query?: string): void
  (e: 'discussion', id: string, messageId?: string, part?: FindPart, query?: string): void
}>()

// Open rows, kept in the chat's own state so they come back the next time it is opened.
const open = reactive(new Set(props.state.expanded))
provideOutline({
  isOpen: (key) => open.has(key),
  flip: (key) => {
    if (open.has(key)) open.delete(key)
    else open.add(key)
    props.state.expanded = [...open]
  },
  preview: props.preview,
})

const query = ref('')
const everyBranch = ref(false)
const discussions = ref(false)
const sent = computed(() => props.messages.filter((m) => !m.draft))
const tree = computed(() => buildNavigationTree(props.allMessages ?? props.messages))
const currentIds = computed(() => props.messages.map((m) => m.id))
const labels = computed(() => navigationBranchLabels(tree.value))
const searchedMessages = computed(() =>
  everyBranch.value ? [...tree.value.byId.values()] : props.messages
)
const hits = computed(() => searchChatNavigation(searchedMessages.value, query.value))

const moves = computed(() => [
  {
    icon: 'arrow-up-to-line',
    label: t('streamB.toTheStart.781abc'),
    disabled: !sent.value.length,
    run: () => emit('start'),
  },
  {
    icon: 'arrow-down-to-line',
    label: t('streamB.toTheLatest.0e7207'),
    disabled: !sent.value.length,
    run: () => emit('latest'),
  },
  {
    icon: 'undo-2',
    label: t('streamB.backToWhereYouWere.1e76ec'),
    disabled: !props.canGoBack,
    run: () => emit('back'),
  },
])
const toggles = computed(() => [
  {
    icon: 'split',
    label: everyBranch.value
      ? t('streamB.searchingEveryBranchOfThisChat.dcfe88')
      : t('streamB.searchEveryBranchOfThisChat.e23584'),
    active: everyBranch.value,
    run: () => (everyBranch.value = !everyBranch.value),
  },
  {
    icon: 'messages-square',
    label: discussions.value
      ? t('streamB.searchingDiscussionsTooNestedOnesIncluded.22938b')
      : t('streamB.searchDiscussionsTooNestedOnesIncluded.bc7b5c'),
    active: discussions.value,
    run: () => (discussions.value = !discussions.value),
  },
])

// Discussions are read one by one in the background, a little after the typing stops.
const discussionHits = shallowRef<DiscussionNavigationHit[]>([])
const unavailable = shallowRef<UnavailableDiscussion[]>([])
const progress = ref<DiscussionSearchProgress>({ done: 0, total: 0 })
const searchRunning = ref(false)
const searchCanceled = ref(false)
let controller: AbortController | undefined
let generation = 0
let timer: number | undefined
const root = ref<HTMLElement>()
const list = ref<HTMLElement>()
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
    everyBranch,
    discussions,
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
    if (!discussions.value || !query.value.trim()) return
    const mine = generation
    const words = query.value
    const allBranches = everyBranch.value
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
        read: props.preview,
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

const found = computed(() => {
  const n = hits.value.length + discussionHits.value.length
  if (n)
    return `${plural(n, 'match', 'matches')}${searchCanceled.value ? t('streamB.searchStopped.bd232c') : ''}`
  if (searchRunning.value) return t('streamB.nothingYet.5becee')
  if (searchCanceled.value) return t('streamB.searchStopped.090ad7')
  return everyBranch.value
    ? t('streamB.nothingInThisChat.642500')
    : t('streamB.nothingOnThisBranch.c31cc3')
})

const rememberScroll = () => {
  if (list.value) props.state.scrollTop = list.value.scrollTop
}

// Opens where you are: the fork asked for, else the question being read, else where it was left.
onMounted(async () => {
  await nextTick()
  const box = list.value
  if (!box) return
  if (props.focusFork) {
    // The other ways show under the question the path takes from that place: it opens.
    const here = props.messages.find(
      (m) =>
        m.role === 'user' &&
        m.parentId === (props.focusFork === 'roots' ? undefined : props.focusFork)
    )
    if (here) open.add(`${here.id}:turn`)
    await nextTick()
    const row = here && box.querySelector<HTMLElement>(`[data-question="${CSS.escape(here.id)}"]`)
    row?.scrollIntoView({ block: 'center' })
    row?.querySelector<HTMLElement>('.tree-item-self')?.focus({ preventScroll: true })
    return
  }
  const here = box.querySelector<HTMLElement>('.tree-item-self.is-active')
  if (here) here.scrollIntoView({ block: 'center' })
  else box.scrollTop = props.state.scrollTop
  if (props.autofocus) root.value?.querySelector<HTMLInputElement>('input')?.focus()
})

// Arrows walk the rows, right and left open and fold, Enter goes, Escape closes the dialog.
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
  if (!target.matches('input, .tree-item-self, .search-result-file-match')) return
  const row = target.closest<HTMLElement>('.tree-item')
  if (
    (event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
    target.matches('.tree-item-self')
  ) {
    const folded = row?.classList.contains('is-collapsed')
    const toggle = target.querySelector<HTMLElement>(':scope > .collapse-icon')
    if (toggle && folded === (event.key === 'ArrowRight')) {
      event.preventDefault()
      toggle.click()
    }
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [
    ...el.querySelectorAll<HTMLElement>(
      '.abele-chat-outline__list .tree-item-self[tabindex], .abele-chat-outline__list .search-result-file-match'
    ),
  ]
  if (!items.length) return
  event.preventDefault()
  const at = items.indexOf(target)
  const step = event.key === 'ArrowDown' ? 1 : -1
  const next =
    at < 0 ? (step > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, at + step))
  items[next].focus()
}
</script>

<style lang="scss">
.abele-chat-outline {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  outline: none;
}
.abele-chat-outline__search {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);

  .abele-obsidian-search {
    flex: 1 1 auto;
  }
}
// One quiet line under the field: the waiting branch switch, or what the search found.
.abele-chat-outline__note {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-2) 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);

  .abele-obsidian-icon:not(.clickable-icon) {
    padding: 0;
  }
  .abele-obsidian-icon.clickable-icon {
    margin-block: calc(-1 * var(--size-2-2));
  }
}
.abele-chat-outline__note-text {
  min-width: 0;
}
.abele-chat-outline__note-text:first-of-type {
  flex: 1 1 auto;
}
.abele-chat-outline__progress {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  font-variant-numeric: tabular-nums;
}
.abele-chat-outline__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-block: var(--size-4-2);
}
// Under the list, as the quick switcher keeps its keys: the moves first, the keys after.
.abele-chat-outline__footer {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  padding-top: var(--size-4-2);
  border-top: var(--border-width) solid var(--background-modifier-border);
}
// The dialog's footer draws the line and the room above it already.
.abele-modal__footer .abele-chat-outline__footer {
  flex: 1 1 100%;
  padding-top: 0;
  border-top: none;
}
.abele-chat-outline__keys {
  display: flex;
  gap: var(--size-4-3);
  margin-inline-start: auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);

  kbd {
    margin-inline-end: var(--size-2-2);
    font-family: inherit;
    font-weight: var(--font-semibold);
  }
}
body.is-phone .abele-chat-outline__keys {
  display: none;
}
</style>
