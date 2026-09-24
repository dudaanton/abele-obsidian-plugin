<template>
  <ObsidianModal title="Comment" @close="emit('cancel')">
    <div class="abele-book-comment">
      <blockquote class="abele-book-comment__quote">
        {{ shortText(highlight.text, 400) }}
      </blockquote>
      <Input v-model="text" as-text-area :rows="5" placeholder="What you think of it…" />
      <div class="abele-book-comment__actions">
        <Button
          text="Save"
          accent
          tooltip="Save the comment in the highlights note"
          @click="emit('save', text)"
        />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
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

  &__actions {
    display: flex;
    justify-content: flex-end;
  }
}
</style>
