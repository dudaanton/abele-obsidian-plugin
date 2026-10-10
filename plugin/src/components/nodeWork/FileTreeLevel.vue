<template>
  <TreeItem
    v-for="entry in entries"
    :key="entry.path"
    :text="entry.name"
    :path="entry.path"
    :collapsible="entry.kind === 'folder'"
    :collapsed="folded.has(entry.path)"
    :active="entry.kind === 'file' && selected === entry.path"
    :class="{ 'abele-file-tree__deleted': entry.change?.kind === 'deleted' }"
    @click="entry.kind === 'folder' ? emit('toggle', entry.path) : emit('open', entry.path)"
    @contextmenu.prevent="emit('menu', $event, entry.path)"
  >
    <template v-if="entry.change" #end><ChangeCodes :change="entry.change" /></template>
    <template v-else-if="entry.kind === 'folder' && folded.has(entry.path) && inside(entry)" #end>
      <StatusDot
        :tone="inside(entry)!.unseen ? 'accent' : 'orange'"
        :label="`${plural(inside(entry)!.count, 'changed file')} inside${inside(entry)!.unseen ? ', some you have not looked at' : ''}`"
      />
    </template>
    <FileTreeLevel
      v-if="entry.kind === 'folder'"
      :entries="entry.children ?? []"
      :selected="selected"
      :folded="folded"
      @toggle="(p) => emit('toggle', p)"
      @open="(p) => emit('open', p)"
      @menu="(e, p) => emit('menu', e, p)"
    />
  </TreeItem>
</template>

<script setup lang="ts">
// One level of the file tree; folders hold the next level and open in place. A folded folder
// with changes inside carries a dot, accent when some of them are new to you.
import TreeItem from '../obsidian/TreeItem.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import ChangeCodes from './ChangeCodes.vue'
import { plural } from './codes'
import type { TreeEntry } from './types'

defineProps<{ entries: TreeEntry[]; selected?: string; folded: Set<string> }>()
const emit = defineEmits<{
  (e: 'toggle', path: string): void
  (e: 'open', path: string): void
  (e: 'menu', event: MouseEvent, path: string): void
}>()

function inside(folder: TreeEntry): { count: number; unseen: boolean } | null {
  let count = 0
  let unseen = false
  const walk = (list: TreeEntry[]) =>
    list.forEach((e) => {
      if (e.change) {
        count++
        unseen ||= !!e.change.unseen
      }
      walk(e.children ?? [])
    })
  walk(folder.children ?? [])
  return count ? { count, unseen } : null
}
</script>
