<template>
  <TreeItem
    :text="node.name"
    :icon="ICONS[node.kind]"
    :path="node.path"
    :active="node.path === current"
    :collapsible="node.kind === 'dir'"
    :collapsed="!open"
    @click="emit('pick', node, $event)"
  >
    <template v-if="node.kind === 'dir'" #actions>
      <Icon
        class="abele-github-tree__open-folder"
        icon="folder-open"
        tooltip="Open this folder's page"
        @click.stop="emit('page', node, $event)"
      />
    </template>
    <template v-if="node.kind === 'dir'">
      <div v-if="!node.children" class="abele-github-tree__note">Loading…</div>
      <GithubTreeNode
        v-for="child in paged.visible.value"
        :key="child.path"
        :node="child"
        :expanded="expanded"
        :current="current"
        @pick="(n: TreeNode, e: MouseEvent) => emit('pick', n, e)"
        @page="(n: TreeNode, e: MouseEvent) => emit('page', n, e)"
      />
      <div v-if="paged.hasMore.value" ref="sentinel" class="abele-github-tree__note">
        {{ paged.total.value - paged.visible.value.length }} more…
      </div>
    </template>
  </TreeItem>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import Icon from '../obsidian/Icon.vue'
import type { NodeKind, TreeNode } from '@/github/tree/fileTree'
import { usePagedList } from '@/composables/usePagedList'

/** One entry of the file tree panel, and — for an open folder — what is in it, a page at a time. */
const props = defineProps<{
  node: TreeNode
  /** The paths of the folders shown open. */
  expanded: Set<string>
  /** The file or folder the tab shows. */
  current: string | null
}>()

const emit = defineEmits<{
  (e: 'pick', node: TreeNode, event: MouseEvent): void
  /** The folder's own page was asked for, by its button. */
  (e: 'page', node: TreeNode, event: MouseEvent): void
}>()

const ICONS: Record<NodeKind, string> = { dir: 'folder', file: 'file', submodule: 'package' }

const open = computed(() => props.expanded.has(props.node.path))
/** A folder of thousands of files draws a page at a time, as the panel scrolls. */
const paged = usePagedList(() => (open.value ? (props.node.children ?? []) : []), 200)
const sentinel = paged.sentinel
</script>
