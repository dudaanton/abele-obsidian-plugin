<template>
  <ObsidianModal
    :title="title"
    :modal-class="modalClass"
    :close-in-footer="closeInFooter ?? choices.some((c) => c.value === null)"
    @close="emit('close')"
  >
    <p v-if="quote" class="abele-choice__quote">“{{ quote }}”</p>
    <p v-for="(line, i) in paragraphs" :key="i" class="abele-choice__message">{{ line }}</p>
    <div v-if="items?.length" class="abele-choice__items">
      <Button
        v-for="item in items"
        :key="item.value"
        :text="item.text"
        :tooltip="item.tooltip ?? item.text"
        class="abele-choice__item"
        @click="choose(item.value)"
      />
    </div>
    <template #footer>
      <Button
        v-for="choice in choices"
        :key="choice.value ?? '\u0000cancel'"
        :text="choice.text"
        :tooltip="choice.tooltip ?? choice.text"
        :accent="choice.cta"
        :warning="choice.warning"
        @click="choose(choice.value)"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ObsidianModal from './Modal.vue'
import Button from './Button.vue'
import type { Choice } from './choice'

/**
 * Asks to pick one of a few answers: a message (one string or several paragraphs), an optional
 * quote of what it is about, a list of answers in the body (`items`, for a list as long as its
 * data — paths, copies) and the buttons in the pinned row (`choices`). Answers with the picked
 * value; closing it any other way is no answer.
 *
 * Opened through `choiceDialog()`.
 */
const props = withDefaults(
  defineProps<{
    title: string
    message?: string | string[]
    quote?: string
    items?: { value: string; text: string; tooltip?: string }[]
    choices: Choice[]
    /** The footer's Cancel is the dismiss action; by default when a choice answers nothing. */
    closeInFooter?: boolean
    modalClass?: string | string[]
  }>(),
  // Unset, not Vue's false for a missing boolean: unset follows the choices.
  { closeInFooter: undefined }
)

const emit = defineEmits<{
  (e: 'answer', value: string): void
  (e: 'close'): void
}>()

const paragraphs = computed(() =>
  props.message === undefined ? [] : [props.message].flat().filter(Boolean)
)

function choose(value: string | null): void {
  if (value !== null) emit('answer', value)
  emit('close')
}
</script>

<style>
/* Plain paragraphs, spaced as Obsidian spaces a dialog's text; an address breaks anywhere. */
.abele-choice__message,
.abele-choice__quote {
  overflow-wrap: anywhere;
}
.abele-choice__items {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-2);
}
.abele-choice__item {
  white-space: normal;
  overflow-wrap: anywhere;
  height: auto;
}
</style>
