<template>
  <ObsidianModal :title="t('streamC.44f5e3fbec57be75')" @close="emit('cancel')">
    <div class="abele-book-comment">
      <blockquote class="abele-book-comment__quote">
        {{ shortText(highlight.text, 400) }}
      </blockquote>
      <Input v-model="text" as-text-area :rows="5" :placeholder="t('streamC.2ccc886e5012897d')" />
    </div>
    <template #footer>
      <Button
        :text="t('settings.GithubConnectionEditor.save.1509f561')"
        accent
        :tooltip="t('streamC.230128dbe25d4abb')"
        @click="emit('save', text)"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/** A comment on a highlight, written under it in the book's highlights note. */
import { ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import { shortText } from '@/reader/model'
import type { Highlight } from '@/reader/highlights'

const props = defineProps<{
  highlight: Highlight
}>()

const emit = defineEmits<{
  (e: 'save', comment: string): void
  (e: 'cancel'): void
}>()

const text = ref(props.highlight.comment)
</script>

<style lang="scss">
.abele-book-comment {
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
