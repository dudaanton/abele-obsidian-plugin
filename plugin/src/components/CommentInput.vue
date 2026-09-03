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
import { computed, onMounted, ref } from 'vue'
import Icon from './obsidian/Icon.vue'
import Input from './obsidian/Input.vue'

/** Past this the field scrolls; a card that grew with its thread would walk over its neighbour. */
const MAX_ROWS = 5

const props = defineProps<{
  /** The session is streaming or running a tool, so the button stops it instead of sending. */
  busy: boolean
  /** The comment file has not been read yet: there is nothing to send to. */
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'abort'): void
}>()

const text = ref('')
const field = ref<{ $el: HTMLTextAreaElement } | null>(null)

const rows = computed(() => Math.min(MAX_ROWS, Math.max(1, text.value.split('\n').length)))

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

// The card is opened by a press — on the marker, on the collapsed card, or by the command that
// just created the comment — and every one of those means "I want to type here".
onMounted(() => field.value?.$el.focus())
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
