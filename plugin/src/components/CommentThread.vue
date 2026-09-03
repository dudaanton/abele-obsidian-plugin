<template>
  <div ref="root" class="abele-comment-thread" @scroll="onScroll">
    <div
      v-for="msg in visible"
      :key="msg.id"
      class="abele-comment-thread__msg"
      :class="`abele-comment-thread__msg_${msg.role}`"
    >
      <template v-if="msg.role === 'tool-call'">
        <div class="abele-comment-thread__tool">
          <Icon icon="wrench" no-hover class="abele-comment-thread__tool-icon" />
          <span class="abele-comment-thread__tool-name">{{ msg.toolName }}</span>
          <span v-if="summarise(msg)" class="abele-comment-thread__tool-args">
            {{ summarise(msg) }}
          </span>
        </div>
        <div v-if="isStanding(msg)" class="abele-comment-thread__tool-actions">
          <Button text="Approve" tooltip="Let the agent run this" @click="approve" />
          <Button
            text="Deny"
            warning
            tooltip="Refuse this and tell the agent why it did not run"
            @click="deny"
          />
        </div>
      </template>

      <template v-else>
        <details v-if="msg.thinking" class="abele-comment-thread__thinking">
          <summary class="abele-comment-thread__thinking-summary">Thinking</summary>
          <Markdown :text="msg.thinking" :file-path="notePath" />
        </details>
        <Markdown
          v-if="msg.content"
          class="abele-comment-thread__body"
          :text="msg.content"
          :file-path="notePath"
        />
        <!-- Only in the margin: a sheet is what a phone opens instead of one, and there is
             nowhere for a pinned message to go there. -->
        <div v-if="host === 'margin'" class="abele-comment-thread__actions">
          <Icon
            class="abele-comment-thread__pin"
            :icon="session.isPinned(msg.id) ? 'pin-off' : 'pin'"
            :tooltip="
              session.isPinned(msg.id)
                ? 'Take this message out of the margin'
                : 'Keep this message at the top of the margin'
            "
            @click="togglePin(msg)"
          />
        </div>
      </template>
    </div>

    <!-- What is arriving right now, in the same shape as the message it will become. -->
    <div
      v-if="streamingThinking"
      class="abele-comment-thread__msg abele-comment-thread__msg_assistant"
    >
      <details class="abele-comment-thread__thinking">
        <summary class="abele-comment-thread__thinking-summary">Thinking</summary>
        <Markdown :text="streamingThinking" :file-path="notePath" />
      </details>
    </div>
    <div
      v-if="streamingContent"
      class="abele-comment-thread__msg abele-comment-thread__msg_assistant"
    >
      <Markdown class="abele-comment-thread__body" :text="streamingContent" :file-path="notePath" />
    </div>
    <div v-if="waiting" class="abele-comment-thread__waiting">Working…</div>

    <div v-if="question" class="abele-comment-thread__question">
      <div class="abele-comment-thread__question-text">{{ question.question }}</div>
      <div class="abele-comment-thread__question-options">
        <Button
          v-for="option in question.options"
          :key="option"
          :text="option"
          :tooltip="`Answer ${option}`"
          @click="answer(option)"
        />
      </div>
    </div>

    <div v-if="error" class="abele-comment-thread__error">
      <span class="abele-comment-thread__error-text">{{ error }}</span>
      <Button text="Retry" tooltip="Send the last message again" @click="retry" />
    </div>

    <EmptyState v-if="empty" text="Nothing asked yet." />
  </div>
</template>

<script setup lang="ts">
/**
 * One comment's conversation, compact enough for the margin.
 *
 * The sidebar's `AiChatMessage` is not reused and neither is `AiToolApproval`: both are built
 * for a pane, both predate the design standard, and `AiToolApproval` approves on
 * `ChatService.activeSession` — a session this component's own is never in. What a margin
 * needs is a side, a tint and one line per tool call; the diff and the argument editor are
 * behind "open as chat", one press away in the card's header.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from './obsidian/Button.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import type { ChatSession } from '@/ai/ChatSession'
import type { ChatMessage } from '@/ai/types'

/** How much of a tool's arguments fits on one line at sidenote width. */
const ARG_SUMMARY_LIMIT = 48

const props = withDefaults(
  defineProps<{
    session: ChatSession
    /**
     * Where the thread is being shown. A margin can hold a pinned message at its top; a sheet
     * is the phone's stand-in for a margin and has nowhere to put one.
     */
    host?: 'margin' | 'sheet'
  }>(),
  { host: 'margin' }
)

const notePath = computed(() => props.session.anchor.value?.note ?? '')

/**
 * A tool result is already summarised by the line above it, a system message is scaffolding,
 * and a draft is the interceptor's business — none of the three belongs in a margin.
 */
const visible = computed(() =>
  props.session.messages.value.filter(
    (msg) => msg.role !== 'system' && msg.role !== 'tool-result' && !msg.draft
  )
)

const streamingContent = computed(() => props.session.streamingContent.value)
const streamingThinking = computed(() => props.session.streamingThinking.value)
const error = computed(() => props.session.error.value)

const waiting = computed(
  () =>
    (props.session.isStreaming.value || props.session.isExecutingTool.value) &&
    !streamingContent.value &&
    !streamingThinking.value
)

const empty = computed(
  () => visible.value.length === 0 && !waiting.value && !streamingContent.value && !error.value
)

const question = computed(() => {
  const pending = props.session.pendingQuestions.value
  return pending ? pending.questions[pending.currentIndex] : null
})

/**
 * Whether this is the call the session is actually waiting on.
 *
 * `approveToolCall` always answers the head of the queue, so only the head may show buttons —
 * offering them on a later call would approve a different one than the reader pressed on.
 */
function isStanding(msg: ChatMessage): boolean {
  const head = props.session.pendingToolCalls.value[0]
  return !!head && msg.toolCallId === head.id
}

/** The arguments as one short phrase: what the call is about, not the call itself. */
function summarise(msg: ChatMessage): string {
  const args = msg.toolParams
  if (!args) return ''

  const text = Object.values(args)
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ')

  return text.length > ARG_SUMMARY_LIMIT ? `${text.slice(0, ARG_SUMMARY_LIMIT)}…` : text
}

/**
 * The thread scrolls, so a reply arriving lands below the fold unless the card follows it.
 *
 * It follows only a reader who was already at the end: someone who has scrolled back to read
 * an earlier answer is reading it, and dragging them to the bottom on every streamed token is
 * the single most irritating thing a chat can do.
 */
const root = ref<HTMLElement | null>(null)

/** Within a line of the end still counts as the end — a reader there is following, not reading back. */
const STICK_SLACK = 24

let stick = true

function onScroll(): void {
  const el = root.value
  if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK
}

function scrollToEnd(): void {
  const el = root.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => [
    visible.value.length,
    streamingContent.value,
    streamingThinking.value,
    props.session.pendingToolCalls.value.length,
    error.value,
  ],
  () => {
    if (stick) scrollToEnd()
  },
  // After the render, so the height being scrolled to is the height of what just arrived.
  { flush: 'post' }
)

/**
 * The height changes for reasons the session cannot report.
 *
 * `Markdown` renders through Obsidian and answers whenever it answers, so the thread is
 * nearly empty at mount and grows several times afterwards; a `<details>` opening does the
 * same. Watching the messages alone leaves a card opened on a long conversation sitting at
 * its first line. The observer is built from the element's own window, not the ambient one —
 * settings can render this in a window of their own.
 */
let growth: MutationObserver | null = null

// A card opened on a conversation opens on its latest turn, not on its first.
onMounted(() => {
  scrollToEnd()

  const el = root.value
  const view = el?.ownerDocument.defaultView
  if (!el || !view?.MutationObserver) return

  growth = new view.MutationObserver(() => {
    if (stick) scrollToEnd()
  })
  // `attributes` is for the thinking block: unfolding a `<details>` changes no node and no
  // text, only its own `open`, and the reasoning it reveals pushes the answer below the fold.
  growth.observe(el, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['open'],
  })
})

onBeforeUnmount(() => {
  growth?.disconnect()
  growth = null
})

const togglePin = (msg: ChatMessage): void =>
  void (props.session.isPinned(msg.id) ? props.session.unpin(msg.id) : props.session.pin(msg.id))

const approve = () => void props.session.approveToolCall()
const deny = () => void props.session.rejectToolCall('Denied from the comment card')
const answer = (option: string) => props.session.answerCurrentQuestion(option)
const retry = () => void props.session.retryRequest()
</script>

<style lang="scss">
.abele-comment-thread {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  min-width: 0;
  font-size: var(--font-ui-small);
  /* Deliberately a scroller: a long thread must not push the next sidenote off the page. */
  max-height: 24em;
  overflow-y: auto;
  /**
   * The hairline the composer draws below the conversation, drawn above it as well. A thread
   * opens at its latest turn, so the top of the box holds whatever line the scroll cut in
   * half; against the header alone that reads as broken text, and under a rule it reads as a
   * message scrolled beneath one.
   */
  padding-top: var(--size-2-2);
  border-top: 1px solid var(--background-modifier-border);
}

.abele-comment-thread__msg {
  position: relative;
  min-width: 0;
  overflow-wrap: anywhere;
}

/**
 * The row's own actions, out of the way until the row is reached for.
 *
 * Out of flow entirely, at the row's top corner. Reserving the room instead — a hidden box
 * that still takes its line — puts an empty strip under every message in the thread, and at
 * sidenote width that strip is most of a short answer. Out of flow, nothing reflows when the
 * pointer arrives either, which is what reserving the room was for.
 */
.abele-comment-thread__actions {
  display: none;
  position: absolute;
  top: 0;
  inset-inline-end: 0;
  /* Over the end of the first line rather than beside it: at 180 px there is no beside. */
  border-radius: var(--radius-s);
  background-color: var(--background-secondary);
}

.abele-comment-thread__msg:hover .abele-comment-thread__actions,
.abele-comment-thread__msg:focus-within .abele-comment-thread__actions {
  display: flex;
}

/** A per-message control at the size of the text it belongs to, like the tool-call bullet. */
.abele-comment-thread__pin {
  --icon-size: var(--icon-xs);
  height: auto;
  padding: var(--size-2-1);
  color: var(--text-faint);
}

/**
 * A phone, where there is no hover to reveal it and no margin to pin into. The `host` prop
 * already takes it away wherever a sheet is what opened — this covers the tablet-sized case
 * Obsidian still calls mobile, where a card can be in a margin and a pointer never arrives.
 * Spelled deeply enough to outrank the two hover rules above, which a tablet with a mouse —
 * or `emulateMobile` on a desktop — would otherwise still match.
 */
body.is-mobile .abele-comment-thread__msg .abele-comment-thread__actions {
  display: none;
}

/**
 * The reader's own words, set apart by side and tint rather than by an avatar or a name: at
 * sidenote width either of those would cost more room than the message itself.
 */
.abele-comment-thread__msg_user {
  align-self: flex-end;
  max-width: 90%;
  padding: var(--size-2-1) var(--size-2-3);
  border-radius: var(--radius-m);
  background-color: var(--background-modifier-hover);
}

.abele-comment-thread__msg_assistant,
.abele-comment-thread__msg_tool-call {
  align-self: stretch;
}

/**
 * Markdown as prose, not as a document: a paragraph's own margins would open a gap at the top
 * and the bottom of every message, and in a card this narrow that gap is most of the card.
 * A code block wraps rather than scrolling sideways, which at 200 px it would always do.
 */
.abele-comment-thread__body {
  p:first-child,
  ul:first-child,
  ol:first-child {
    margin-top: 0;
  }

  p:last-child,
  ul:last-child,
  ol:last-child {
    margin-bottom: 0;
  }

  pre,
  code {
    white-space: pre-wrap;
    word-break: break-word;
  }
}

/**
 * Obsidian's own copy button, which it appends to every `pre` it renders.
 *
 * Its stylesheet positions the button only under `.markdown-rendered`, and the kit's
 * `Markdown` adds that class for a whole document — which a card in the margin is not. So the
 * button arrived here wearing Obsidian's default `button` chrome and sitting below the code as
 * a grey slab, and `.is-mobile` shows it permanently rather than on hover: a phone screenshot
 * of a comment thread was most of a code block and then a large grey square.
 *
 * The rules are `AiChatMessage`'s, at a sidenote's size. Flat selectors rather than nested
 * ones, because the test that guards them reads this stylesheet as text.
 */
.abele-comment-thread__body pre {
  position: relative;
  /* Room for the button at the end of the first line, so the code does not run under it. */
  padding-inline-end: var(--size-4-12);
}

.abele-comment-thread__body .copy-code-button {
  position: absolute;
  top: var(--size-4-1);
  inset-inline-end: var(--size-4-1);
  width: auto;
  height: auto;
  padding: var(--size-2-1) var(--size-2-2);
  color: var(--text-muted);
  background-color: transparent;
  border: none;
  box-shadow: none;
  font-size: var(--font-ui-smaller);
  /* Obsidian draws the glyph at `--icon-size`; the card's default would be taller than the label. */
  --icon-size: var(--icon-xs);
}

.abele-comment-thread__body .copy-code-button:hover {
  color: var(--text-normal);
  background-color: var(--background-modifier-hover);
}

.abele-comment-thread__thinking {
  color: var(--text-faint);
  font-size: var(--font-smallest);
}

.abele-comment-thread__thinking-summary {
  cursor: var(--cursor-link);
}

.abele-comment-thread__tool {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-smallest);
}

/**
 * A glyph at the size of the line it labels.
 *
 * The kit's `Icon` draws at Obsidian's default `--icon-size` of 18px, which beside a
 * `--font-smallest` label is nearly twice the height of the text and reads as the loudest
 * thing in the card. The padding goes for the same reason: this is a bullet, not a button.
 */
.abele-comment-thread__tool-icon {
  flex: 0 0 auto;
  --icon-size: var(--icon-xs);
  height: auto;
  padding: 0;
}

.abele-comment-thread__tool-name {
  flex: 0 0 auto;
  font-family: var(--font-monospace);
}

.abele-comment-thread__tool-args {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-faint);
}

.abele-comment-thread__tool-actions,
.abele-comment-thread__question-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  margin-top: var(--size-2-1);
}

.abele-comment-thread__question-text {
  margin-bottom: var(--size-2-1);
  color: var(--text-normal);
}

.abele-comment-thread__waiting {
  color: var(--text-faint);
  font-size: var(--font-smallest);
}

.abele-comment-thread__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-1) var(--size-2-3);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-error);
  font-size: var(--font-smallest);
}

.abele-comment-thread__error-text {
  color: var(--text-error);
  overflow-wrap: anywhere;
}
</style>
