<template>
  <ObsidianModal :title="t('streamC.efe4eba1ad28627b')" @close="emit('cancel')">
    <!-- The comment dialog's own look: a quote over a field. -->
    <div class="abele-book-comment abele-book-forms">
      <blockquote class="abele-book-comment__quote">
        {{ shortText(highlight.text, 200) }}
      </blockquote>
      <Input v-model="text" as-text-area :rows="3" :placeholder="t('streamC.29cebfc193aa3faa')" />
      <div class="setting-item-description">{{ t('streamC.4bcfb8af403a1338') }}</div>
    </div>
    <template #footer>
      <Button
        v-if="highlight.forms?.length"
        :text="t('streamC.95f9b652844789c7')"
        :tooltip="t('streamC.b3348cd57ac0a0a7')"
        @click="emit('save', [])"
      />
      <Button
        :text="t('settings.GithubConnectionEditor.save.1509f561')"
        accent
        :tooltip="t('streamC.98234fe4a6949fb3')"
        @click="emit('save', parseForms(text))"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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
