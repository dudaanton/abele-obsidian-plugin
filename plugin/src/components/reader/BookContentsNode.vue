<template>
  <TreeItem
    :text="entry.label"
    :path="entry.key"
    :active="entry.key === activeKey"
    :collapsible="entry.children.length > 0"
    :collapsed="!open"
    @click="onClick"
  >
    <BookContentsNode
      v-for="child in entry.children"
      :key="child.key"
      :entry="child"
      :active-key="activeKey"
      :expanded="expanded"
      @pick="emit('pick', $event)"
    />
  </TreeItem>
</template>

<script setup lang="ts">
/** One entry of a book's contents, with the entries under it. */
import { ref, watch } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import type { TocEntry } from '@/reader/model'

const props = defineProps<{
  entry: TocEntry
  /** The entry of the page on screen. */
  activeKey: string | null
  /** The entries on the way to it, which open by themselves. */
  expanded: string[]
}>()

const emit = defineEmits<{
  (e: 'pick', entry: TocEntry): void
}>()

const open = ref(props.expanded.includes(props.entry.key))
watch(
  () => props.expanded,
  (keys) => {
    if (keys.includes(props.entry.key)) open.value = true
  }
)

/** The arrow folds; the name goes there. */
const onClick = (e: MouseEvent) => {
  const onArrow = (e.target as Element | null)?.closest?.('.collapse-icon')
  if (onArrow) {
    open.value = !open.value
    return
  }
  emit('pick', props.entry)
}
</script>
