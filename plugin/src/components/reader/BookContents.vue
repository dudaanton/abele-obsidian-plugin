<template>
  <div class="abele-book-contents" role="tree" :aria-label="t('streamC.437aea62a5bd6ad4')">
    <div ref="list" class="abele-book-contents__list">
      <EmptyState v-if="!toc.length" :text="t('streamC.e8c8840ef962c3d4')" />
      <BookContentsNode
        v-for="entry in toc"
        :key="entry.key"
        :entry="entry"
        :active-key="activeKey"
        :expanded="expanded"
        @pick="emit('pick', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/**
 * A book's table of contents, as a tree in Obsidian's own tree rows: the chapter on screen
 * marked, the way to it opened, and scrolled into view when the panel opens.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import BookContentsNode from './BookContentsNode.vue'
import { pathTo, type TocEntry } from '@/reader/model'

const props = defineProps<{
  toc: TocEntry[]
  currentHref: string | null
}>()

const emit = defineEmits<{
  (e: 'pick', entry: TocEntry): void
  (e: 'close'): void
}>()

const list = ref<HTMLElement>()
const expanded = computed(() => pathTo(props.toc, props.currentHref))
const activeKey = computed(() => expanded.value.at(-1) ?? null)

const reveal = async () => {
  await nextTick()
  const row = list.value?.querySelector('.tree-item-self.is-active')
  row?.scrollIntoView({ block: 'nearest' })
}
onMounted(reveal)
watch(activeKey, reveal)
</script>

<style lang="scss">
.abele-book-contents {
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
}
</style>
