<template>
  <div
    class="abele-book-speech abele-book-search-bar"
    role="toolbar"
    aria-label="Search results"
    data-ignore-swipe="true"
  >
    <span class="abele-book-speech__label">{{ label }}</span>
    <div class="abele-book-speech__actions">
      <Icon icon="chevron-left" tooltip="The result before" @click="emit('step', -1)" />
      <Icon icon="chevron-right" tooltip="The next result" @click="emit('step', 1)" />
      <Icon icon="list" tooltip="Every result" @click="emit('list')" />
      <Icon icon="x" tooltip="Close the search" @click="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Under the page while a search has results: back and on through them without the panel — which
 * covers the page on a phone — the whole list, and an end to the search. The reading-aloud bar's
 * own look.
 */
import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'
import type { BookSearch } from '@/reader/model'

const props = defineProps<{
  search: BookSearch
}>()

const emit = defineEmits<{
  (e: 'step', step: 1 | -1): void
  (e: 'list'): void
  (e: 'close'): void
}>()

const label = computed(() => {
  const s = props.search
  const what = s.words?.length ? s.words.join(', ') : s.query.trim()
  const n = s.current >= 0 ? `${s.current + 1} of ${s.count}` : `${s.count} found`
  return `${what} · ${n}${s.running ? '…' : ''}`
})
</script>
