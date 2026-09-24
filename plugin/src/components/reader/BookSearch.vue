<template>
  <div class="abele-book-search">
    <div class="abele-book-search__field">
      <Search :model-value="query" placeholder="Search the book…" @update:model-value="onInput" />
    </div>
    <div class="abele-book-search__status">{{ status }}</div>
    <div class="abele-book-search__list">
      <div v-for="(group, g) in search.groups" :key="g" class="abele-book-search__group">
        <div class="abele-book-search__label">{{ group.label }}</div>
        <div
          v-for="(hit, h) in group.hits"
          :key="h"
          class="abele-book-search__hit"
          role="button"
          tabindex="0"
          @click="emit('go', hit)"
          @keydown.enter.prevent="emit('go', hit)"
        >
          <span>{{ hit.excerpt.pre }}</span
          ><mark class="abele-book-search__match">{{ hit.excerpt.match }}</mark
          ><span>{{ hit.excerpt.post }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Search through a whole book or PDF. Results come in chapter by chapter, or page by page, while
 * the search goes on; a result goes to its place and marks the words.
 */
import { computed, onMounted, ref } from 'vue'
import Search from '../obsidian/Search.vue'
import type { BookSearch, SearchHit } from '@/reader/model'

const props = defineProps<{
  search: BookSearch
}>()

const emit = defineEmits<{
  (e: 'search', query: string): void
  (e: 'go', hit: SearchHit): void
}>()

const query = ref(props.search.query)
let timer = 0

/** A search runs a moment after typing stops: a whole book is slow to go through. */
const onInput = (value: string) => {
  query.value = value
  window.clearTimeout(timer)
  timer = window.setTimeout(() => emit('search', value), 400)
}

onMounted(() => {
  // The field has the cursor as soon as the search is asked for.
  const input = activeDocument.querySelector<HTMLInputElement>('.abele-book-search__field input')
  input?.focus()
})

const status = computed(() => {
  const s = props.search
  if (s.query.trim().length < 2) return 'Type at least two letters.'
  const n = s.count === 1 ? '1 result' : `${s.count} results`
  if (s.running) return `${n} so far · ${Math.round(s.progress * 100)}%`
  return s.count ? n : 'Nothing found.'
})
</script>

<style lang="scss">
.abele-book-search {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;

  &__field {
    padding: var(--size-4-2);
  }

  &__status {
    padding: 0 var(--size-4-3) var(--size-4-2);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  &__list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--size-4-2) var(--size-4-2);
  }

  &__label {
    padding: var(--size-4-2) var(--size-4-1) var(--size-4-1);
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    color: var(--text-muted);
  }

  &__hit {
    padding: var(--size-4-1) var(--size-4-2);
    border-radius: var(--radius-s);
    font-size: var(--font-ui-small);
    line-height: var(--line-height-tight);
    cursor: var(--cursor);

    &:hover,
    &:focus-visible {
      background-color: var(--background-modifier-hover);
    }
  }

  &__match {
    background-color: var(--text-highlight-bg);
    color: var(--text-normal);
  }
}
</style>
