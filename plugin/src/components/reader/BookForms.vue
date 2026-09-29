<template>
  <ObsidianModal title="Underline everywhere" @close="emit('cancel')">
    <div class="abele-book-forms">
      <blockquote class="abele-book-forms__quote">
        {{ shortText(highlight.text, 200) }}
      </blockquote>
      <Input
        v-model="text"
        as-text-area
        :rows="3"
        placeholder="The word's forms, separated by commas"
      />
      <div class="abele-book-forms__hint setting-item-description">
        Each form is underlined wherever it stands as a whole word in this book, and a tap on it
        leads to this highlight. Leave the field empty to stop.
      </div>
    </div>
    <template #footer>
      <Button
        v-if="highlight.forms?.length"
        text="Stop underlining"
        tooltip="Keep the highlight, underline its word nowhere else"
        @click="emit('save', [])"
      />
      <Button
        text="Save"
        accent
        tooltip="Keep the forms with the highlight in its note"
        @click="emit('save', parseForms(text))"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * The forms of a highlight's word to underline everywhere in the book, kept with the highlight
 * in its note (`src/reader/vocab/`). Filled in with the highlighted word the first time.
 */
import { ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import { shortText } from '@/reader/model'
import type { Highlight } from '@/reader/highlights'
import { WORD, formsLine, parseForms } from '@/reader/vocab/words'

const props = defineProps<{
  highlight: Highlight
}>()

const emit = defineEmits<{
  (e: 'save', forms: string[]): void
  (e: 'cancel'): void
}>()

/** The highlighted word itself, when the highlight is one word; the words as they are otherwise. */
const firstGuess = (text: string): string => {
  const words = text.match(new RegExp(WORD.source, 'gu')) ?? []
  return words.length === 1 ? words[0] : text.trim()
}

const text = ref(
  props.highlight.forms?.length
    ? formsLine(props.highlight.forms)
    : firstGuess(props.highlight.text)
)
</script>

<style lang="scss">
.abele-book-forms {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);

  &__quote {
    margin: 0;
    padding-inline-start: var(--size-4-3);
    border-inline-start: var(--blockquote-border-thickness, var(--size-2-1)) solid
      var(--blockquote-border-color);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
}
</style>
