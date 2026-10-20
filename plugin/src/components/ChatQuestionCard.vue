<template>
  <!-- The agent asks you something: the debugger's card, the question at the top and the answers
       it offers under it as rows. On a computer each row carries the key that picks it while the
       card has the keyboard; your own answer goes in the message field. Several questions in a
       row say where you are as a code in the corner; the cross skips them all. -->
  <RequestCard
    waiting
    class="abele-ai-chat__questions abele-chat-question"
    tabindex="-1"
    @keydown="onKey"
  >
    <div class="abele-chat-question__header">
      <Icon icon="message-circle-question" size="xs" :interactive="false" />
      <span class="abele-chat-question__text">{{ question }}</span>
      <span
        v-if="count > 1"
        ref="progress"
        class="abele-chat-question__progress"
        role="img"
        :aria-label="t('chat.questionPosition', { position: index + 1, count })"
        >{{ index + 1 }}/{{ count }}</span
      >
      <Icon
        class="abele-chat-question__skip"
        icon="x"
        size="xs"
        :label="count > 1 ? t('chat.skipQuestions') : t('chat.skipQuestion')"
        @click="emit('skip')"
      />
    </div>
    <!-- The answers as rows to press: the key that picks one stands first on a computer, a
         phone has no keys and shows only the words. The last row is for an answer of your own. -->
    <div class="abele-chat-question__options">
      <Button
        v-for="(option, i) in options"
        :key="i"
        :text="option"
        plain
        type="button"
        class="abele-chat-question__option"
        @click="emit('answer', option)"
      >
        <kbd v-if="i < 9" class="abele-chat-question__key">{{ i + 1 }}</kbd>
        <span class="abele-chat-question__answer">{{ option }}</span>
      </Button>
      <Button
        :text="t('chat.ownAnswer')"
        plain
        type="button"
        class="abele-chat-question__option abele-chat-question__option_own"
        @click="emit('own')"
      >
        <Icon class="abele-chat-question__key" icon="pencil" size="xs" :interactive="false" />
        <span class="abele-chat-question__answer">{{ t('chat.ownAnswer') }}</span>
      </Button>
    </div>
  </RequestCard>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { ref, watchEffect } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import RequestCard from './obsidian/RequestCard.vue'

const props = defineProps<{
  question: string
  options: readonly string[]
  /** Where this question stands among the ones asked together, from 0. */
  index: number
  count: number
}>()
const emit = defineEmits<{
  answer: [option: string]
  skip: []
  /** The reader will answer in words: the message field takes the keyboard. */
  own: []
}>()

const progress = ref<HTMLElement>()
watchEffect(() => {
  if (progress.value)
    setTooltip(
      progress.value,
      t('chat.questionPosition', { position: props.index + 1, count: props.count })
    )
})

/** A digit picks that answer while the card has the keyboard; Escape skips. */
function onKey(event: KeyboardEvent) {
  console.debug('[Abele question]', {
    key: event.key,
    composing: event.isComposing,
    repeat: event.repeat,
  })
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.repeat) return
  const n = Number(event.key)
  if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, props.options.length)) {
    event.preventDefault()
    emit('answer', props.options[n - 1])
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('skip')
  }
}
</script>

<style lang="scss">
// The debugger's card, as the approval card is: a thin accent frame while it waits for you.
.abele-chat-question {
  margin: var(--size-4-2) 0;

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
    outline: none;
  }
}
.abele-chat-question__header {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  min-width: 0;
  color: var(--text-normal);

  > .abele-obsidian-icon:first-child {
    padding: 0;
    // The glyph stands on the question's first line.
    margin-block: calc((1lh - var(--icon-xs)) / 2);
    color: var(--icon-color);
  }
}
.abele-chat-question__text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: break-word;
}
.abele-chat-question__progress {
  flex: none;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  line-height: inherit;
}
// Obsidian's whole button box, its height taken back so the question's line does not grow.
.abele-chat-question .abele-chat-question__skip {
  margin-block: calc(-1 * var(--size-2-2));
}
// A finger's box reaches past the first line, centred on it, so the cross stays level with it.
body.is-mobile .abele-chat-question .abele-chat-question__skip {
  margin-block: calc((1lh - var(--abele-touch-min)) / 2);
}
// The answers sit level with the question's text, each a row the width of the card.
.abele-chat-question__options {
  display: flex;
  flex-direction: column;
  gap: 0;
  // The row's patch starts a little left of the card's text, so its key stands under the glyph.
  margin-inline: calc(-1 * var(--size-4-2));
}
.abele-chat-question .abele-chat-question__option .abele-obsidian-button__label {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-chat-question .abele-chat-question__option {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: var(--size-4-2);
  width: 100%;
  height: auto;
  min-height: 0;
  padding: var(--size-2-2) var(--size-4-2);
  border-radius: var(--radius-s);
  background: transparent;
  box-shadow: none;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-weight: var(--font-normal);
  text-align: start;
  white-space: normal;
  cursor: var(--cursor);

  &:hover,
  &:focus-visible {
    background-color: var(--background-modifier-hover);
  }
}
.abele-chat-question .abele-chat-question__option_own {
  color: var(--text-muted);
  // Not one of the offered answers: a step apart from them.
  margin-top: var(--size-4-1);
}
.abele-chat-question__answer {
  min-width: 0;
  overflow-wrap: anywhere;
}
// The key that picks the answer: a small square code, the width of one figure.
.abele-chat-question__key {
  flex: none;
  box-sizing: border-box;
  min-width: 1.6em;
  padding: 0 var(--size-2-1);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-family: var(--font-interface);
  font-size: var(--font-ui-smaller);
  text-align: center;
  background: transparent;
}
.abele-chat-question .abele-obsidian-icon.abele-chat-question__key {
  // The pencil takes the key's column, so «Your own answer» starts where the answers do.
  display: inline-flex;
  justify-content: center;
  align-self: center;
  box-sizing: border-box;
  width: 1.6em;
  min-width: 0;
  font-size: var(--font-ui-smaller);
  padding: 0;
  border-color: transparent;
}
// A phone has no keys to pick by; the rows are the finger's height.
body.is-mobile {
  // Nor a column for them: the pencil goes too, «Your own answer» is told apart by its colour.
  .abele-chat-question .abele-chat-question__key {
    display: none;
  }
  .abele-chat-question .abele-chat-question__option {
    min-height: var(--abele-touch-min);
    align-items: center;
  }
}
</style>
