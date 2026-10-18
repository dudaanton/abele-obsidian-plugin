<template>
  <div
    class="abele-book-speech abele-book-search-bar"
    role="toolbar"
    :aria-label="t('streamC.e978b00de465a271')"
    data-ignore-swipe="true"
  >
    <span class="abele-book-speech__label">{{ label }}</span>
    <div class="abele-book-speech__actions">
      <Icon
        icon="chevron-left"
        :tooltip="t('streamC.9ef1e9ea1f79b789')"
        @click="emit('step', -1)"
      />
      <Icon
        icon="chevron-right"
        :tooltip="t('streamC.5ee03ae6fd67fe46')"
        @click="emit('step', 1)"
      />
      <Icon icon="list" :tooltip="t('streamC.82d6e24a70c23d3b')" @click="emit('list')" />
      <Icon icon="x" :tooltip="t('kit.closeSearch')" @click="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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
  const n =
    s.current >= 0
      ? t('streamC.16b40c1318912162', { v1: String(s.current + 1), v2: String(s.count) })
      : t('streamC.aa56c9d3302af396', { v1: String(s.count) })
  return `${what} · ${n}${s.running ? '…' : ''}`
})
</script>
