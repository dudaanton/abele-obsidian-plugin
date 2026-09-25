<template>
  <div class="abele-book-bookmarks">
    <div class="abele-book-bookmarks__list">
      <EmptyState
        v-if="!bookmarks.length"
        text="No bookmarks yet. Tap the bookmark under the page to mark it."
      />
      <div
        v-for="b in bookmarks"
        :key="b.id"
        class="abele-book-bookmarks__item"
        :class="{ 'is-active': here.has(b.id) }"
        role="button"
        tabindex="0"
        @click="emit('go', b)"
        @keydown.enter.prevent="emit('go', b)"
      >
        <div class="abele-book-bookmarks__head">
          <span class="abele-book-bookmarks__label">{{ b.label || 'Untitled' }}</span>
          <Icon icon="trash-2" tooltip="Remove this bookmark" @click.stop="emit('remove', b)" />
        </div>
        <div v-if="b.text" class="abele-book-bookmarks__text">{{ shortText(b.text) }}</div>
        <div class="abele-book-bookmarks__date">{{ dateOf(b.created) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A book's bookmarks, in the book's order: the chapter each is in, the first words of its page
 * and the day it was made. A tap goes there; the bin removes it. The ones on the page on screen
 * are marked.
 */
import { computed } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Icon from '../obsidian/Icon.vue'
import { shortText } from '@/reader/model'
import type { Bookmark } from '@/reader/bookmarks'

const props = defineProps<{
  bookmarks: Bookmark[]
  /** The ids of those on the page on screen. */
  current: string[]
}>()

const emit = defineEmits<{
  (e: 'go', b: Bookmark): void
  (e: 'remove', b: Bookmark): void
}>()

const here = computed(() => new Set(props.current))

const dateOf = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<style lang="scss">
.abele-book-bookmarks {
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
    border-inline-start: var(--size-2-1) solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    cursor: var(--cursor);

    &:hover,
    &:focus-visible {
      background-color: var(--background-modifier-hover);
    }

    &.is-active {
      border-inline-start-color: var(--interactive-accent);
    }
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-1);
  }

  &__label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
  }

  &__text {
    margin-top: var(--size-2-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  &__date {
    margin-top: var(--size-2-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
  }
}
</style>
