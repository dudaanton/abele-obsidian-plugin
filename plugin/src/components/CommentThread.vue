<template>
  <div class="abele-comment-thread">
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
      <Markdown
        class="abele-comment-thread__body"
        :text="streamingContent"
        :file-path="notePath"
      />
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
import { computed } from 'vue'
import Button from './obsidian/Button.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Icon from './obsidian/Icon.vue'
import Markdown from './obsidian/Markdown.vue'
import type { ChatSession } from '@/ai/ChatSession'
import type { ChatMessage } from '@/ai/types'

/** How much of a tool's arguments fits on one line at sidenote width. */
const ARG_SUMMARY_LIMIT = 48

const props = defineProps<{
  session: ChatSession
}>()

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
}

.abele-comment-thread__msg {
  min-width: 0;
  overflow-wrap: anywhere;
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

.abele-comment-thread__tool-icon {
  flex: 0 0 auto;
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
