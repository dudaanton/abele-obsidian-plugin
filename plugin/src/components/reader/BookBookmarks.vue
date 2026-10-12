<template>
  <div class="abele-book-bookmarks">
    <div class="abele-book-bookmarks__list">
      <EmptyState
        v-if="!bookmarks.length"
        text="No bookmarks yet. Tap the bookmark under the page to mark it."
      />
      <EntryRow
        v-for="b in bookmarks"
        :key="b.id"
        class="abele-book-bookmarks__item"
        :active="here.has(b.id)"
        role="button"
        tabindex="0"
        @click="emit('go', b)"
        @keydown.enter.prevent="emit('go', b)"
      >
        <span class="abele-book-bookmarks__label">{{ b.label || 'Untitled' }}</span>
        <template #codes>
          <span class="abele-book-bookmarks__date">{{ dateOf(b.created) }}</span>
        </template>
        <template v-if="b.text" #meta>
          <span class="abele-book-bookmarks__text">{{ shortText(b.text) }}</span>
        </template>
        <template #aside>
          <Icon
            class="abele-book-bookmarks__remove"
            icon="trash-2"
            tooltip="Remove this bookmark"
            @click.stop="emit('remove', b)"
          />
        </template>
      </EntryRow>
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
import EntryRow from '../obsidian/EntryRow.vue'
import { shortText } from '@/reader/model'
import type { Bookmark } from '@/reader/bookmarks'
import dayjs from 'dayjs'
import { compactDate } from '@/helpers/datesHelper'

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

// The short date the other lists use: the day and month this year, the year added before it.
const dateOf = (ms: number) => compactDate(dayjs(ms))
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
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
    padding: var(--size-4-2);
  }

  &__label {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    font-size: var(--font-ui-small);
  }

  &__date {
    font-variant-numeric: tabular-nums;
  }
}
</style>
