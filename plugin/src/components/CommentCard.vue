<template>
  <div
    class="abele-comment-card"
    :class="[`abele-comment-card_${state}`, { 'abele-comment-card_collapsed': !expanded }]"
  >
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
          <!-- Open, the badge becomes the choice it was only reporting. -->
          <Dropdown
            v-if="session"
            :model-value="agentId"
            :options="agentOptions"
            @update:model-value="chooseAgent"
          />
          <Badge v-else :text="agentName" />
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
            :disabled="blocked"
            :tooltip="blocked ? blockedTooltip : 'Open this comment as a full chat in the sidebar'"
            @click="openAsChat"
          />
          <Icon
            icon="trash-2"
            tooltip="Delete this comment, its marker and its chat file"
            @click="pendingRemoval = activeId"
          />
          <!-- Not in a modal: the dialog's own × is already the way out, and two controls for
               one act on a phone header is one of them nobody presses. -->
          <Icon
            v-if="host !== 'modal'"
            icon="chevron-up"
            tooltip="Fold this comment back to a summary"
            @click="fold"
          />
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
        <div class="abele-comment-card__promoted-actions">
          <Button
            text="Open in sidebar"
            tooltip="Show this chat in the AI sidebar"
            @click="openInSidebar"
          />
          <Button
            text="Back to comment"
            :disabled="blocked"
            :tooltip="
              blocked
                ? blockedTooltip
                : 'Close the sidebar tab and go on with this conversation here'
            "
            @click="demote"
          />
        </div>
      </template>

      <template v-else>
        <CommentThread v-if="session" :session="session" :host="host" />
        <EmptyState v-else-if="lost" text="This comment's file is missing." />
        <EmptyState v-else text="Reading this comment…" />
        <!-- Keyed by the comment: a half-typed question belongs to the tab it was typed in,
             and a shared composer would carry it over to the next one. -->
        <CommentInput
          :key="activeId"
          :busy="busy"
          :pending="pending"
          :disabled="!session"
          :focus="fresh"
          :host="host"
          @send="onSend"
          @note="onNote"
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Notice, TFile, type EventRef } from 'obsidian'
import Badge from './obsidian/Badge.vue'
import Button from './obsidian/Button.vue'
import ConfirmModal from './obsidian/ConfirmModal.vue'
import Dropdown from './obsidian/Dropdown.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import Tabs from './obsidian/Tabs.vue'
import CommentInput from './CommentInput.vue'
import CommentThread from './CommentThread.vue'
import { CommentEntry } from '@/entities/Comment'
import { CommentService } from '@/ai/CommentService'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { parseMarkers, resolveQuote } from '@/editor/commentMarkers'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ChatMessage } from '@/ai/types'

const props = withDefaults(
  defineProps<{
    entry: CommentEntry
    /**
     * Where the card is being shown. The margin is a sidenote beside the text; a modal is a
     * dialog that has drawn its own frame and its own way out, so the card gives back the
     * actions the frame already provides.
     */
    host?: 'margin' | 'modal'
  }>(),
  { host: 'margin' }
)

const emit = defineEmits<{
  /**
   * The conversation has been handed to the sidebar — by "open as chat", or by "open in
   * sidebar" on a card that was promoted already.
   *
   * The margin ignores this: a sidenote sits beside the text and hides nothing. A modal does
   * not, and on a phone it is the whole screen, so it leaves on hearing it. `CommentService`
   * cannot say this itself — `expand` never touches `open`, and the reveal is the card's.
   */
  (e: 'promoted'): void
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
/**
 * The service has looked for this comment's file and found nothing there.
 *
 * Until it says so there is no telling a load in flight from a load that will never arrive,
 * and "Reading this comment…" over a file somebody deleted by hand never stops being read.
 */
const lost = computed(() => service.isMissing(activeId.value))
const agentName = computed(() => session.value?.agent.value?.name ?? 'Comment')
const agentId = computed(() => session.value?.agentId.value ?? '')

/**
 * Which agents this comment may be handed to.
 *
 * The agents a person configured, minus the utility ones — those exist for scripts and for
 * delegation, and a list of them is a list of things nobody meant to talk to. Two are let
 * back in because leaving them out would be worse: the agent `commentAgentId` names, which is
 * a utility agent in every vault that took the default and is the one this card starts on,
 * and whichever agent this conversation is already running on, so the picker can always show
 * its own value rather than silently sitting on the first option.
 */
const agentOptions = computed(() => {
  const registry = AgentRegistry.getInstance()
  const listed = registry.list()

  const named = registry.get(AbeleConfig.getInstance().ai.commentAgentId ?? '')
  if (named && !listed.some((agent) => agent.id === named.id)) listed.unshift(named)

  const options = listed.map((agent) => ({ value: agent.id, display: agent.name }))

  // The agent this conversation is on, whatever has become of it. A `select` handed a value
  // none of its options carry shows the first one instead, so a comment left on a deleted
  // agent would sit there naming one it has nothing to do with; the id, marked, is at least
  // true. `session.agent` has already fallen back to the default, so the chat still works.
  const current = agentId.value
  if (current && !options.some((option) => option.value === current)) {
    const known = registry.get(current)
    options.push({ value: current, display: known ? known.name : `${current} (deleted)` })
  }

  return options
})

const chooseAgent = (id: string) => {
  if (!id || id === agentId.value) return
  session.value?.switchAgent(id)
}
const state = computed(() => session.value?.commentState.value ?? 'idle')
const busy = computed(() => state.value === 'busy')
/**
 * A turn that has stopped to ask something — an approval, or a question — rather than one that
 * is running. The composer needs the two apart: a note kept now would land in the middle of
 * that turn, while a question typed now simply waits for it.
 */
const pending = computed(() => state.value === 'pending')
const promoted = computed(() => session.value?.kind === 'chat')

/**
 * A turn nothing may be moved out from under: see `ChatSession.isMidTurn`.
 *
 * Promoting and demoting both rebind the agent and rewrite what the file says this is, and
 * neither can be done in the middle of a turn. The buttons go dark rather than refusing on
 * the press, and say why they are dark.
 */
const midTurn = computed(() => !!session.value?.isMidTurn)
/** A move already under way — the file is being written, and the maps have yet to follow. */
const moving = computed(() => !!session.value?.moving.value)
const blocked = computed(() => midTurn.value || moving.value)
const BUSY_TOOLTIP = 'The agent is still working — finish or dismiss the pending step first'
const MOVING_TOOLTIP = 'This comment is being moved'
const blockedTooltip = computed(() => (moving.value ? MOVING_TOOLTIP : BUSY_TOOLTIP))
/** The same words the composer answers a refused note with; it is the same refusal. */
const BUSY_NOTICE = 'Finish or dismiss the pending step first'
const MOVING_NOTICE = 'Already moving this comment'

/**
 * A digit is all the label a 300 px strip has room for, so the glyph and the tooltip carry the
 * rest of the meaning — what is being switched between, and how many there are.
 */
const tabs = computed(() =>
  props.entry.ids.map((id, index) => ({
    id,
    label: String(index + 1),
    icon: 'message-circle',
    tooltip: `Comment ${index + 1} of ${props.entry.ids.length}`,
  }))
)

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

/**
 * The note changing under the card, which is the other half of the answer going stale.
 *
 * A reader editing the passage the comment was written about is the ordinary way this
 * happens, and nothing else tells the card: the editor's own field knows, but it cannot
 * reach in here. Registered and dropped with the component, so a card that has left the
 * margin stops reading notes.
 */
let modifyRef: EventRef | null = null

onMounted(() => {
  // Every comment at this marker, whether or not its tab is the one showing: the strip names
  // them all and the state dot has to be right before anyone presses anything.
  for (const id of props.entry.ids) void service.load(id)
  void readNote()

  const { app } = GlobalStore.getInstance()
  modifyRef = app.vault.on('modify', (file) => {
    if (file.path === props.entry.notePath) void readNote()
  })
})

onBeforeUnmount(() => {
  if (!modifyRef) return
  GlobalStore.getInstance().app.vault.offref(modifyRef)
  modifyRef = null
})

// Expanding is when the notice is first read, so the note behind it is read again then — a
// card folded since it was mounted has been showing an answer from whenever that was.
watch(
  () => [props.entry.notePath, quote.value, expanded.value],
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
/**
 * The service refuses a move made in the middle of a turn, and one made while a move is
 * already under way — the button above is already dark for both, so this is the race between
 * the two, and a refusal that said nothing would look exactly like a promotion that happened
 * somewhere out of sight.
 *
 * Which of the two it was is read here rather than after the call: by the time the service has
 * answered, the move that was in flight may have finished and the reason be gone.
 */
async function promote(): Promise<void> {
  if (moving.value) {
    new Notice(MOVING_NOTICE)
    return
  }
  if (!(await service.expand(activeId.value))) {
    new Notice(BUSY_NOTICE)
    return
  }
  emit('promoted')
}

const openAsChat = () => void promote()
/**
 * The way back. Nothing is emitted: the conversation is coming *out* of the sidebar, so the
 * host has no reason to move — the card is where the reader is about to go on typing.
 */
const demote = (): void =>
  void (async () => {
    if (moving.value) {
      new Notice(MOVING_NOTICE)
      return
    }
    if (!(await service.collapse(activeId.value))) new Notice(BUSY_NOTICE)
  })()
const remove = () => {
  const id = activeId.value
  // `CommentService.remove` clears this too, but only after the marker and the file are gone;
  // until then the card would go on rendering a session being torn down under it.
  if (service.open.value === id) service.open.value = null
  void service.remove(id)
}

async function reveal(): Promise<void> {
  const current = session.value
  if (!current) return

  const chatService = ChatService.getInstance()
  // Adopted rather than switched to: a promotion whose tab was refused because the bar was
  // full leaves a chat the sidebar is not holding, and `switchTab` does nothing for one.
  chatService.adoptSession(current)
  await chatService.revealSidebar()
  emit('promoted')
}

const openInSidebar = () => void reveal()

const onSend = (text: string) => void session.value?.sendMessage(text)
/**
 * Kept, not asked: the words go into the conversation and no agent is started.
 *
 * The session refuses one in the middle of a turn — the composer's button is already dark
 * there, so this is the race between the two — and a refusal that said nothing would look
 * exactly like a note that was saved.
 */
const onNote = (text: string) =>
  void (async () => {
    const kept = await session.value?.addUserNote(text)
    if (kept === false) new Notice('Finish or dismiss the pending step first')
  })()
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
 * Folded, the whole card is one control, so the whole card answers the pointer. The tint used
 * to sit on the summary, which is inset by the card's own padding and read as a box drawn
 * inside a box.
 */
.abele-comment-card_collapsed:hover {
  /**
   * `--background-modifier-hover` is translucent, so it has to sit *over* the card's own fill
   * rather than replace it — as a background it would leave the card lighter than it was,
   * which reads as the card losing its surface instead of answering the pointer. A gradient of
   * one colour is the one-element way to layer it.
   */
  background-image: linear-gradient(
    var(--background-modifier-hover),
    var(--background-modifier-hover)
  );
  border-color: var(--background-modifier-border-hover);
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
  cursor: var(--cursor-link);
  border-radius: var(--radius-s);

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

/**
 * The picker at the size of the badge it replaces. Obsidian's own dropdown is a form control
 * built for a settings row, and at that height it is the tallest thing in a sidenote header.
 *
 * Only the vertical padding is taken back. The chevron is a background image drawn 12 px in
 * from the right edge, and the 32 px of right padding is the room it stands in — a compact
 * shorthand takes that room away and the glyph lands on the last letter of the agent's name,
 * which is what the first phone screenshot showed.
 */
.abele-comment-card__agent .abele-obsidian-dropdown .dropdown {
  max-width: 10em;
  height: auto;
  padding: var(--size-2-1) var(--size-4-6) var(--size-2-1) var(--size-4-2);
  font-size: var(--font-ui-smaller);
}

/**
 * A phone, where the picker is something to hit rather than something to read. The composer
 * below it takes `--size-4-9` for the same reason; a 21 px control in a header is a miss.
 */
body.is-mobile .abele-comment-card__agent .abele-obsidian-dropdown .dropdown {
  min-height: var(--size-4-9);
  font-size: var(--font-ui-small);
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

/**
 * Both ways out of a promoted card. They wrap rather than shrink: a sidenote is 180 px at its
 * narrowest and two buttons on one line there would be two truncated labels.
 */
.abele-comment-card__promoted-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
}

.abele-comment-card__readonly {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  color: var(--text-muted);
}
</style>
