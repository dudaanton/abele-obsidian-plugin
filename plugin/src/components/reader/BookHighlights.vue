<template>
  <div class="abele-book-highlights">
    <div class="abele-book-highlights__list">
      <EmptyState
        v-if="!highlights.length"
        text="No highlights yet. Select words on the page and pick a colour."
      />
      <div
        v-for="h in highlights"
        :key="h.cfi"
        class="abele-book-highlights__item"
        :class="`abele-book-highlights__item_${h.color}`"
        role="button"
        tabindex="0"
        @click="emit('go', h)"
        @keydown.enter.prevent="emit('go', h)"
      >
        <div class="abele-book-highlights__text">{{ shortText(h.text) }}</div>
        <div v-if="h.comment" class="abele-book-highlights__comment">
          {{ shortText(h.comment, 200) }}
        </div>
        <div class="abele-book-highlights__label">{{ h.label }}</div>
      </div>
    </div>
    <div v-if="highlights.length" class="abele-book-highlights__foot">
      <Button
        text="Open the note"
        icon="file-text"
        tooltip="Open the note these highlights are kept in"
        @click="emit('open-note')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/** A book's highlights, in the book's order, as its highlights note keeps them. */
import EmptyState from '../obsidian/EmptyState.vue'
import Button from '../obsidian/Button.vue'
import { shortText } from '@/reader/model'
import type { Highlight } from '@/reader/highlights'

defineProps<{
  highlights: Highlight[]
}>()

const emit = defineEmits<{
  (e: 'go', h: Highlight): void
  (e: 'open-note'): void
}>()
</script>

<style lang="scss">
.abele-book-highlights {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;

  &__list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--size-4-2);
  }

  &__item {
    margin-bottom: var(--size-4-2);
    padding: var(--size-4-1) var(--size-4-2);
    border-inline-start: var(--size-2-1) solid var(--abele-highlight-color, var(--color-yellow));
    border-radius: var(--radius-s);
    cursor: var(--cursor);

    &:hover,
    &:focus-visible {
      background-color: var(--background-modifier-hover);
    }

    @each $c in yellow, green, blue, pink, purple, orange {
      &_#{$c} {
        --abele-highlight-color: var(--color-#{$c});
      }
    }
  }

  &__text {
    font-size: var(--font-ui-small);
  }

  &__comment {
    margin-top: var(--size-4-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    font-style: italic;
  }

  &__label {
    margin-top: var(--size-4-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
  }

  &__foot {
    padding: var(--size-4-2);
    border-top: 1px solid var(--background-modifier-border);
  }
}
</style>
