<template>
  <div class="abele-comment-input" :class="{ 'abele-comment-input_sheet': host === 'sheet' }">
    <!-- Above the field, as in the sidebar: what was dictated lands in what was already typed. -->
    <VoiceRecorder
      v-if="voiceOpen"
      can-send
      can-note
      auto-start
      class="abele-comment-input__voice"
      @text="onVoiceText"
      @send="onVoiceSend"
      @note="onVoiceNote"
      @close="voiceOpen = false"
    />
    <div class="abele-comment-input__row">
      <Input
        ref="field"
        class="abele-comment-input__field"
        as-text-area
        :rows="rows"
        :model-value="text"
        :disabled="disabled"
        placeholder="Ask about this…"
        @update:model-value="text = $event"
        @keydown="onKeydown"
      />
      <Icon
        class="abele-comment-input__mic"
        icon="mic"
        :class="{ 'abele-comment-input__mic_open': voiceOpen }"
        :disabled="disabled"
        :tooltip="voiceOpen ? 'Close voice input' : 'Dictate instead of typing'"
        @click="voiceOpen = !voiceOpen"
      />
      <Icon
        class="abele-comment-input__note"
        icon="sticky-note"
        :disabled="noteDisabled"
        :tooltip="noteTooltip"
        @click="note"
      />
      <Icon
        class="abele-comment-input__send"
        :icon="busy ? 'square' : 'send-horizontal'"
        :disabled="sendDisabled"
        :tooltip="sendTooltip"
        @click="onSend"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The composer of a comment chat: one field and one button, and deliberately nothing else.
 *
 * No attachments and no slash commands — each of those is a reason to open the comment as a
 * full chat, which is one press away in the card's header. What is here is what a question in
 * the margin needs: a field that starts at one line, grows to five and then scrolls, a button
 * that becomes a stop while the agent is working, beside it the one that keeps the words
 * without asking anybody anything, and the microphone, because a comment is most often made
 * on a phone where typing beside the text is the slowest way to say anything.
 *
 * The voice panel is the sidebar's own `VoiceRecorder`, mounted the way `AiChatInput` mounts
 * it. It answers with words and with which of the three endings was pressed; recording,
 * transcribing and every failure of either belong to it and are not repeated here.
 */
import { computed, onMounted, ref, watch } from 'vue'
import Icon from './obsidian/Icon.vue'
import Input from './obsidian/Input.vue'
import VoiceRecorder from './VoiceRecorder.vue'

/** Past this the field scrolls; a card that grew with its thread would walk over its neighbour. */
const MAX_ROWS = 5

const props = withDefaults(
  defineProps<{
    /** The session is streaming or running a tool, so the button stops it instead of sending. */
    busy: boolean
    /** The comment file has not been read yet: there is nothing to send to. */
    disabled?: boolean
    /**
     * Take the caret on mount.
     *
     * Only for a comment that was just made, which is the one case where the reader is already
     * typing. Expanding a comment to read it must leave the caret in the note, or a press on a
     * marker throws the person out of the passage they were reading.
     */
    focus?: boolean
    /**
     * Where the card holding this composer is being shown.
     *
     * A margin composer is a 300 px sidenote and is set small to fit one. A sheet is the whole
     * screen of a phone, and a field set below 16 px there is a field iOS zooms the note into
     * the moment it takes the caret — so the host, not a media query, is what sizes it.
     */
    host?: 'margin' | 'sheet'
  }>(),
  { host: 'margin' }
)

const emit = defineEmits<{
  (e: 'send', text: string): void
  /** Keep these words in the conversation, and start nothing. */
  (e: 'note', text: string): void
  (e: 'abort'): void
}>()

const text = ref('')
const field = ref<{ $el: HTMLTextAreaElement } | null>(null)
const rows = ref(1)

/**
 * How many rows what has been typed actually needs.
 *
 * Newlines are only half of it: a sidenote is 300 px at its widest, so an ordinary question
 * wraps two or three times before it ever reaches one. Only the element knows where it wrapped,
 * so the field is dropped to a single row, measured, and put back — `scrollHeight` then holds
 * the whole content and `clientHeight` one row of it, with the padding taken out of both.
 */
function measuredRows(el: HTMLTextAreaElement): number {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el)
  const padding =
    (parseFloat(style?.paddingTop ?? '') || 0) + (parseFloat(style?.paddingBottom ?? '') || 0)

  const previous = el.rows
  el.rows = 1
  const rowHeight = el.clientHeight - padding
  const contentHeight = el.scrollHeight - padding
  el.rows = previous

  // Nothing has been laid out yet — a fresh mount, or a test tier with no layout at all.
  if (rowHeight <= 0 || contentHeight <= 0) return 1

  return Math.ceil(contentHeight / rowHeight)
}

function resize(): void {
  const el = field.value?.$el
  const written = text.value.split('\n').length
  rows.value = Math.min(MAX_ROWS, Math.max(1, written, el ? measuredRows(el) : 1))
}

// After the render, so the element being measured is holding the text being measured.
watch(text, resize, { flush: 'post' })

const sendDisabled = computed(() => {
  if (props.disabled) return true
  return props.busy ? false : text.value.trim().length === 0
})

const sendTooltip = computed(() => {
  if (props.busy) return 'Stop the agent'
  if (props.disabled) return 'This comment is still being read from the vault'
  return 'Send this question'
})

/**
 * Nothing to keep, or nowhere to keep it yet — and not while a turn is running: a note joins
 * the same history the agent is being answered from, and putting one in halfway through would
 * land it among the messages that turn is still writing.
 */
const noteDisabled = computed(() => props.disabled || props.busy || text.value.trim().length === 0)

const noteTooltip = computed(() => {
  if (props.busy) return 'Wait for the agent to finish before keeping a note'
  if (props.disabled) return 'This comment is still being read from the vault'
  return 'Save as note, without asking the agent (Alt+Enter)'
})

function send(): void {
  const content = text.value.trim()
  if (props.disabled || !content) return

  emit('send', content)
  text.value = ''
}

function onSend(): void {
  if (props.busy) {
    emit('abort')
    return
  }
  send()
}

/**
 * The panel sits over the composer rather than replacing it, so what is dictated joins what
 * was already typed: a recording is one more thing said in the message, not a message of its
 * own. The same rule the sidebar keeps.
 */
const voiceOpen = ref(false)

const withDictated = (dictated: string) => {
  const existing = text.value.trim()
  return existing ? `${existing} ${dictated}` : dictated
}

const onVoiceText = (dictated: string) => {
  text.value = withDictated(dictated)
  field.value?.$el.focus()
}

const onVoiceSend = (dictated: string) => {
  text.value = withDictated(dictated)
  send()
}

const onVoiceNote = (dictated: string) => {
  text.value = withDictated(dictated)
  note()
}

function note(): void {
  if (noteDisabled.value) return

  emit('note', text.value.trim())
  text.value = ''
}

/**
 * Enter sends, Alt+Enter keeps a note, and Shift+Enter opens a line.
 *
 * `isComposing` is what keeps an IME out of it: committing a Japanese or Chinese candidate
 * with Enter would otherwise post the half-typed question the candidate was part of.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return

  event.preventDefault()
  if (event.altKey) return note()
  send()
}

onMounted(() => {
  resize()
  if (props.focus) field.value?.$el.focus()
})
</script>

<style lang="scss">
.abele-comment-input {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-2);
  min-width: 0;
  padding-top: var(--size-2-2);
  border-top: 1px solid var(--background-modifier-border);
}

/* The field and its buttons: one row, whatever the voice panel above it is doing. */
.abele-comment-input__row {
  display: flex;
  align-items: flex-end;
  gap: var(--size-2-2);
  min-width: 0;
}

.abele-comment-input__field {
  flex: 1 1 auto;
  min-width: 0;
  /* The card's own horizontal rhythm: anything tighter reads as narrower than a native field. */
  padding: var(--size-2-1) var(--size-4-2);
  font-size: var(--font-ui-small);
  /* Five lines and then it scrolls, which is what `rows` stops counting at. */
  max-height: 8em;
}

.abele-comment-input__mic,
.abele-comment-input__note,
.abele-comment-input__send {
  flex: 0 0 auto;
}

/* Open, the microphone is the thing the panel below belongs to. */
.abele-comment-input__mic_open {
  color: var(--interactive-accent);
}

/**
 * The panel is the sidebar's, and the sidebar is wider than a sidenote: its own row is a
 * waveform between two controls, which at 300 px leaves the waveform a stub. Nothing here
 * changes that — the panel wraps its actions onto a second row itself — but the text it is
 * set in is the card's, not the pane's.
 */
.abele-comment-input__voice {
  min-width: 0;
  font-size: var(--font-ui-small);
}

/**
 * A phone, and the sheet that is a phone's only host for a card.
 *
 * Three sizes, and each of them was reported as wrong from an iPhone. `--font-ui-medium` is
 * 16 px, which is the size below which iOS zooms the page into a focused field — the note
 * jumped and had to be pinched back every time somebody typed a question. `--input-height` is
 * what a native Obsidian field stands at, so the composer is a field rather than a line. And
 * `--size-4-9` is 36 px, the smallest square a thumb hits reliably; the margin's button is a
 * mouse target and stays the size it was.
 *
 * `body.is-mobile` as well as the host, because a phone in landscape can have room for a
 * margin card, and a field there is still being typed into with a thumb.
 */
.abele-comment-input_sheet .abele-comment-input__field,
body.is-mobile .abele-comment-input__field {
  font-size: var(--font-ui-medium);
  min-height: var(--input-height);
  padding: var(--size-4-1) var(--size-4-2);
}

.abele-comment-input_sheet .abele-comment-input__mic,
body.is-mobile .abele-comment-input__mic,
.abele-comment-input_sheet .abele-comment-input__note,
body.is-mobile .abele-comment-input__note,
.abele-comment-input_sheet .abele-comment-input__send,
body.is-mobile .abele-comment-input__send {
  min-width: var(--size-4-9);
  min-height: var(--size-4-9);
}
</style>
