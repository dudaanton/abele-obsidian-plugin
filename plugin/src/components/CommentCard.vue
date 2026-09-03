<template>
  <div class="abele-comment-card" :class="`abele-comment-card_${state}`">
    <!-- Folded: the whole card is one control, because at this size anything smaller is a
         target nobody can hit. `role="button"` rather than a `<button>` — see docs/Design.md. -->
    <div
      v-if="!expanded"
      class="abele-comment-card__summary"
      role="button"
      tabindex="0"
      @click="openCard"
      @keydown.enter.prevent="openCard"
      @keydown.space.prevent="openCard"
    >
      <div class="abele-comment-card__head">
        <div class="abele-comment-card__agent">
          <Badge :text="agentName" />
        </div>
        <span
          v-if="state !== 'idle'"
          class="abele-comment-card__state"
          :class="`abele-comment-card__state_${state}`"
        />
        <!-- Decoration, not an action: the whole summary is the control it stands for. -->
        <Icon icon="chevron-down" no-hover class="abele-comment-card__hint" />
      </div>
      <div v-if="question" class="abele-comment-card__line abele-comment-card__line_user">
        {{ question }}
      </div>
      <div v-if="answer" class="abele-comment-card__line abele-comment-card__line_assistant">
        {{ answer }}
      </div>
      <EmptyState v-if="!question && !answer" text="Nothing asked yet." />
    </div>

    <template v-else>
      <div class="abele-comment-card__head">
        <div class="abele-comment-card__agent">
          <Badge :text="agentName" />
        </div>
        <span
          v-if="state !== 'idle'"
          class="abele-comment-card__state"
          :class="`abele-comment-card__state_${state}`"
        />
        <div class="abele-comment-card__actions">
          <Icon
            v-if="!promoted"
            icon="panel-right-open"
            tooltip="Open this comment as a full chat in the sidebar"
            @click="openAsChat"
          />
          <Icon
            icon="trash-2"
            tooltip="Delete this comment, its marker and its chat file"
            @click="pendingRemoval = activeId"
          />
          <Icon icon="chevron-up" tooltip="Fold this comment back to a summary" @click="fold" />
        </div>
      </div>

      <Tabs
        v-if="entry.ids.length > 1"
        class="abele-comment-card__tabs"
        level="secondary"
        :tabs="tabs"
        :model-value="activeId"
        @update:model-value="showComment"
      />

      <div v-if="quoteLost" class="abele-comment-card__notice">
        <span>The quoted text was changed</span>
        <q class="abele-comment-card__quote">{{ quote }}</q>
      </div>

      <!-- Promoted into a chat: the conversation belongs to the sidebar now, and the margin
           keeps only enough of it to say which one this marker leads to. -->
      <template v-if="promoted">
        <div class="abele-comment-card__readonly">
          <div v-for="msg in firstExchange" :key="msg.id" class="abele-comment-card__readonly-msg">
            <Markdown :text="msg.content" :file-path="entry.notePath" />
          </div>
        </div>
        <Button
          text="Open in sidebar"
          tooltip="Show this chat in the AI sidebar"
          @click="openInSidebar"
        />
      </template>

      <template v-else>
        <CommentThread v-if="session" :session="session" />
        <EmptyState v-else text="Reading this comment…" />
        <!-- Keyed by the comment: a half-typed question belongs to the tab it was typed in,
             and a shared composer would carry it over to the next one. -->
        <CommentInput
          :key="activeId"
          :busy="busy"
          :disabled="!session"
          :focus="fresh"
          @send="onSend"
          @abort="onAbort"
        />
      </template>
    </template>

    <ConfirmModal
      v-if="pendingRemoval"
      title="Delete comment"
      message="Delete this comment? Its marker comes out of the note and its chat file is
        removed. This cannot be undone."
      confirm-tooltip="Delete this comment"
      @confirm="remove"
      @close="pendingRemoval = null"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * A comment chat as a sidenote.
 *
 * One card per marker, which is why the tabs exist: several comments can sit at one place, and
 * they share the margin slot the overlay measured for them. Which card is expanded is
 * `CommentService.open` and not a ref of our own — the marker in the text draws itself open
 * from the same value, and two sources for one fact is how the two stop agreeing.
 *
 * Everything slow is a read: the session comes from the service, and the note is read once to
 * answer a single question — is the quoted passage still there. The editor's own field asks
 * that question too, but it cannot tell the card, and the card cannot reach into the editor.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { TFile } from 'obsidian'
import Badge from './obsidian/Badge.vue'
import Button from './obsidian/Button.vue'
import ConfirmModal from './obsidian/ConfirmModal.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import Tabs from './obsidian/Tabs.vue'
import CommentInput from './CommentInput.vue'
import CommentThread from './CommentThread.vue'
import { CommentEntry } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { parseMarkers, resolveQuote } from '@/editor/commentMarkers'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ChatMessage } from '@/ai/types'

const props = defineProps<{
  entry: CommentEntry
}>()

const service = CommentService.getInstance()

/** Which of the marker's comments the card is showing. */
const activeId = ref(props.entry.ids[0])
const pendingRemoval = ref<string | null>(null)

const openId = computed(() => service.open.value)
const expanded = computed(() => !!openId.value && props.entry.ids.includes(openId.value))

// Opening a second comment at the same marker switches the strip rather than opening a second
// card: one marker, one slot in the margin.
watch(openId, (id) => {
  if (id && props.entry.ids.includes(id)) activeId.value = id
})

const session = computed(() => service.sessionFor(activeId.value))
const agentName = computed(() => session.value?.agent.value?.name ?? 'Comment')
const state = computed(() => session.value?.commentState.value ?? 'idle')
const busy = computed(() => state.value === 'busy')
const promoted = computed(() => session.value?.kind === 'chat')

const tabs = computed(() => props.entry.ids.map((id, index) => ({ id, label: String(index + 1) })))

const messages = computed<ChatMessage[]>(() => session.value?.messages.value ?? [])

/** What was asked first — the thing a reader scans the margin for. */
const question = computed(
  () => messages.value.find((msg) => msg.role === 'user' && !msg.draft)?.content ?? ''
)

/**
 * How the newest answer begins, or how it is beginning right now.
 *
 * What is arriving wins over what arrived: a folded card sitting on the previous answer while
 * the next one streams into the thread is a card telling the reader the wrong thing.
 */
const answer = computed(() => {
  const arriving = session.value?.streamingContent.value ?? ''
  if (arriving) return arriving

  for (let i = messages.value.length - 1; i >= 0; i--) {
    const msg = messages.value[i]
    if (msg.role === 'assistant' && msg.content) return msg.content
  }
  return ''
})

/**
 * A comment nobody has said anything in yet, which is a comment that was just made.
 *
 * The composer takes the caret for one of these and for no other: expanding a comment to read
 * it must leave the caret in the passage the reader was reading.
 */
const fresh = computed(() => !!session.value && messages.value.length === 0)

/** Read-only after promotion: the question and the first answer, and nothing else. */
const firstExchange = computed(() => {
  const asked = messages.value.find((msg) => msg.role === 'user' && !msg.draft)
  const answered = messages.value.find((msg) => msg.role === 'assistant' && msg.content)
  return [asked, answered].filter((msg): msg is ChatMessage => !!msg)
})

const quote = computed(() => session.value?.anchor.value?.quote)

/**
 * The note as it stands, read once and again whenever the quote changes.
 *
 * `edit_selection` rewrites both the passage and the quote, so the answer to "is it still
 * there" changes with it; nothing else the card does needs the note's text.
 */
const noteText = ref<string | null>(null)

async function readNote(): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(props.entry.notePath)
  noteText.value = file instanceof TFile ? await app.vault.cachedRead(file) : null
}

/**
 * Whether the passage this comment was written about is gone.
 *
 * The rules are the editor's own (`resolveQuote`): the text ending at the marker, else the
 * nearest occurrence anywhere, else nothing — and nothing is what earns the notice. A comment
 * made at a cursor never quoted anything and is not missing it.
 */
const quoteLost = computed(() => {
  const text = noteText.value
  const wanted = quote.value
  if (!text || !wanted) return false

  const marker = parseMarkers(text).find((candidate) => candidate.ids.includes(activeId.value))
  if (!marker) return false

  return resolveQuote(text, marker, wanted) === null
})

onMounted(() => {
  // Every comment at this marker, whether or not its tab is the one showing: the strip names
  // them all and the state dot has to be right before anyone presses anything.
  for (const id of props.entry.ids) void service.load(id)
  void readNote()
})

watch(
  () => [props.entry.notePath, quote.value],
  () => {
    void readNote()
  }
)

const openCard = () => {
  service.open.value = activeId.value
}
const fold = () => {
  service.open.value = null
}
const showComment = (id: string) => {
  service.open.value = id
}
const openAsChat = () => void service.expand(activeId.value)
const remove = () => {
  const id = activeId.value
  // `CommentService.remove` clears this too, but only after the marker and the file are gone;
  // until then the card would go on rendering a session being torn down under it.
  if (service.open.value === id) service.open.value = null
  void service.remove(id)
}

const openInSidebar = () => {
  const current = session.value
  if (!current) return

  const chatService = ChatService.getInstance()
  chatService.switchTab(current.id)
  void chatService.revealSidebar()
}

const onSend = (text: string) => void session.value?.sendMessage(text)
const onAbort = () => session.value?.abort()
</script>

<style lang="scss">
.abele-comment-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  min-width: 0;
  padding: var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
  font-size: var(--font-ui-small);
}

/**
 * Waiting on the reader, or failed. The marker in the text says the same thing from the same
 * `commentState`, so the two cannot drift apart; the card says it along its edge because at
 * this width a banner would be most of the card.
 */
.abele-comment-card_busy {
  border-color: var(--text-accent);
}

.abele-comment-card_pending {
  border-color: var(--text-warning);
}

.abele-comment-card_error {
  border-color: var(--text-error);
}

.abele-comment-card__summary {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
  border-radius: var(--radius-s);
  cursor: var(--cursor-link);

  // Folded, the card is one target, so the whole of it has to answer the pointer — a card
  // that looks inert is a card nobody tries to open.
  &:hover {
    background-color: var(--background-modifier-hover);
  }

  &:focus-visible {
    outline: 1px solid var(--background-modifier-border-focus);
  }
}

.abele-comment-card__head {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
}

/**
 * The badge is `flex: 0 0 auto` and never shrinks, so an agent with a long name would push the
 * header's actions off the edge of a 200 px card. Clipping it here keeps them reachable.
 */
.abele-comment-card__agent {
  min-width: 0;
  overflow: hidden;
}

.abele-comment-card__hint {
  flex: 0 0 auto;
  margin-inline-start: auto;
  color: var(--text-faint);
}

.abele-comment-card__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  flex: 0 0 auto;
  margin-inline-start: auto;
}

/**
 * Two lines each, folded. A summary that grew with its conversation would push the next
 * sidenote down the page and eventually off it — the overlay stacks these, it does not scroll.
 */
.abele-comment-card__line {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.abele-comment-card__line_user {
  color: var(--text-normal);
}

.abele-comment-card__line_assistant {
  color: var(--text-muted);
}

/* A dot, not a word: the badge beside it already spends the width. */
.abele-comment-card__state {
  flex: 0 0 auto;
  width: var(--size-2-2);
  height: var(--size-2-2);
  border-radius: var(--radius-l);
}

.abele-comment-card__state_busy {
  background-color: var(--text-accent);
}

.abele-comment-card__state_pending {
  background-color: var(--text-warning);
}

.abele-comment-card__state_error {
  background-color: var(--text-error);
}

.abele-comment-card__notice {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  padding: var(--size-2-1) var(--size-2-3);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-smallest);
}

.abele-comment-card__quote {
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.abele-comment-card__readonly {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  color: var(--text-muted);
}
</style>
