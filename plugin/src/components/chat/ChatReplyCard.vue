<template>
  <!-- One place of the agent's words being answered, as a card standing among the person's own
       words, never as the agent's words pasted in: the reply arrow and the words' start in one
       faint line. In the composer it can be taken out; sent, it leads back to its words. -->
  <div
    ref="el"
    class="abele-chat-reply-card"
    :class="{ 'abele-chat-reply-card_gone': gone, 'abele-chat-reply-card_sent': !removable }"
    :role="gone ? undefined : 'link'"
    :tabindex="gone ? undefined : 0"
    :aria-label="label"
    @click="!gone && emit('open')"
    @keydown.enter="!gone && emit('open')"
  >
    <Icon :icon="gone ? 'unlink' : 'reply'" size="xs" :interactive="false" />
    <span class="abele-chat-reply-card__words">{{ words }}</span>
    <Icon
      v-if="removable"
      icon="x"
      class="abele-chat-reply-card__remove"
      :tooltip="'Take this reply out'"
      @click.stop="emit('remove')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import type { ChatReplyTo } from '@/ai/types'

const props = withDefaults(
  defineProps<{
    to: ChatReplyTo
    /** In the composer, before it is sent. */
    removable?: boolean
    /** Its message is not in this branch. */
    gone?: boolean
  }>(),
  { removable: false, gone: false }
)
const emit = defineEmits<{ (e: 'open'): void; (e: 'remove'): void }>()

const words = computed(() => props.to.quote.replace(/\s+/g, ' ').trim())
const label = computed(() =>
  props.gone
    ? 'Its message is in another branch of this chat'
    : props.removable
      ? 'The agent gets a link to these words, not the words again; click to see them'
      : 'Go to the words this answered'
)
const el = ref<HTMLElement>()
const tip = () => el.value && setTooltip(el.value, label.value)
onMounted(tip)
watch(label, tip)
</script>

<style lang="scss">
// As a file put with the message: a quiet plate in the row above the words.
.abele-chat-reply-card {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
  max-width: 100%;
  padding: var(--size-2-1) var(--size-2-3);
  border-radius: var(--radius-s);
  background-color: var(--background-secondary);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
  &:focus-visible {
    box-shadow: var(--input-shadow);
  }

  > .abele-obsidian-icon:not(.abele-chat-reply-card__remove) {
    flex-shrink: 0;
    height: auto;
    padding: 0;
    color: var(--text-faint);
  }
}

.abele-chat-reply-card__words {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-chat-reply-card .abele-chat-reply-card__remove {
  flex-shrink: 0;
  // The whole glyph box to press, as a file's cross in the same row; its height given back so
  // the card stays one line tall.
  margin-block: calc(-1 * var(--size-2-1));
}

.abele-chat-reply-card_gone {
  color: var(--text-faint);
  cursor: default;

  &:hover {
    background-color: var(--background-secondary);
  }
}
</style>

<style lang="scss">
// Among the words, where the person put it: a line of its own, as wide as its words need, with
// the same room above and below as between two paragraphs' lines — in the composer and sent.
.abele-chat-reply-inline {
  display: flex;
  max-width: 100%;
  margin-block: var(--size-2-1);

  > .abele-chat-reply-card {
    display: inline-flex;
  }
}
// In the composer's text it stands inline on its line, which holds nothing else: as a block
// the editor's cursor anchors either side of it took lines of their own.
.cm-line > .abele-chat-reply-inline {
  display: inline-flex;
  vertical-align: top;
}
// The question's own ground is the plate's; inside it the card stands on the pane's ground.
.abele-chat-msg .abele-chat-reply-inline .abele-chat-reply-card {
  background-color: var(--background-primary);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}
</style>
