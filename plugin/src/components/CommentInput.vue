<template>
  <div class="abele-comment-input">
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
      class="abele-comment-input__send"
      :icon="busy ? 'square' : 'send-horizontal'"
      :disabled="sendDisabled"
      :tooltip="sendTooltip"
      @click="onSend"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * The composer of a comment chat: one field and one button, and deliberately nothing else.
 *
 * No attachments, no voice, no slash commands — each of those is a reason to open the comment
 * as a full chat, which is one press away in the card's header. What is here is what a
 * question in the margin needs: a field that starts at one line, grows to five and then
 * scrolls, and a button that becomes a stop while the agent is working.
 */
import { computed, onMounted, ref, watch } from 'vue'
import Icon from './obsidian/Icon.vue'
import Input from './obsidian/Input.vue'

/** Past this the field scrolls; a card that grew with its thread would walk over its neighbour. */
const MAX_ROWS = 5

const props = defineProps<{
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
}>()

const emit = defineEmits<{
  (e: 'send', text: string): void
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
 * Enter sends and Shift+Enter opens a line.
 *
 * `isComposing` is what keeps an IME out of it: committing a Japanese or Chinese candidate
 * with Enter would otherwise post the half-typed question the candidate was part of.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return

  event.preventDefault()
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
  align-items: flex-end;
  gap: var(--size-2-2);
  padding-top: var(--size-2-2);
  border-top: 1px solid var(--background-modifier-border);
}

.abele-comment-input__field {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--size-2-1) var(--size-2-3);
  font-size: var(--font-ui-small);
  /* Five lines and then it scrolls, which is what `rows` stops counting at. */
  max-height: 8em;
}

.abele-comment-input__send {
  flex: 0 0 auto;
}
</style>
