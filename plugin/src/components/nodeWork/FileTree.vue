<template>
  <div class="abele-file-tree" :class="{ 'abele-file-tree_stale': stale }">
    <div class="abele-file-tree__bar">
      <Search
        v-model="query"
        class="abele-file-tree__search"
        placeholder="Find a file"
        aria-label="Find a file by name or path"
      />
      <Icon
        v-if="git"
        class="abele-file-tree__mode"
        :class="{ 'is-active': mode === 'all' }"
        icon="folder-tree"
        tooltip="All files"
        :aria-pressed="mode === 'all'"
        @click="emit('update:mode', 'all')"
      />
      <Icon
        v-if="git"
        class="abele-file-tree__mode"
        :class="{ 'is-active': mode === 'changed' }"
        icon="file-diff"
        :tooltip="`Only changed files · ${changes.length}`"
        :aria-pressed="mode === 'changed'"
        @click="emit('update:mode', 'changed')"
      />
    </div>

    <div class="abele-file-tree__body" role="tree" :aria-label="label">
      <!-- A name typed: every file that matches, flat, wherever it lies. -->
      <template v-if="query.trim()">
        <TreeItem
          v-for="hit in found"
          :key="hit.path"
          :text="hit.name"
          :note="dirName(hit.path)"
          :active="selected === hit.path"
          :path="hit.path"
          @click="emit('open', hit.path)"
          @contextmenu.prevent.stop="emit('menu', $event, hit.path)"
        >
          <template v-if="hit.change" #end><ChangeCodes :change="hit.change" /></template>
        </TreeItem>
        <div v-if="!found.length" class="search-empty-state">No file matches.</div>
        <div v-if="matches.length > found.length" class="abele-file-tree__note" role="status">
          {{ found.length }} of {{ matches.length }} · type more to narrow
        </div>
      </template>

      <!-- Only what changed, in two groups: not yet staged, and staged for the commit. -->
      <template v-else-if="git && mode === 'changed'">
        <template v-for="group in groups" :key="group.id">
          <TreeItem
            v-if="group.files.length"
            class="abele-file-tree__group"
            :text="group.title"
            :flair="String(group.files.length)"
            collapsible
            :collapsed="folded.has(group.id)"
            @click="toggle(group.id)"
          >
            <TreeItem
              v-for="change in group.files"
              :key="change.path"
              :text="fileName(change.path)"
              :note="dirName(change.path)"
              :active="selected === change.path"
              :path="change.path"
              :class="{ 'abele-file-tree__deleted': change.kind === 'deleted' }"
              @click="emit('open', change.path, group.id === 'staged' ? 'staged' : 'unstaged')"
              @contextmenu.prevent.stop="emit('menu', $event, change.path)"
            >
              <template #end><ChangeCodes :change="change" /></template>
            </TreeItem>
          </TreeItem>
        </template>
        <div v-if="!changes.length" class="search-empty-state">Nothing changed.</div>
      </template>

      <!-- The whole folder, as the file explorer draws it; changes marked where they are. -->
      <template v-else>
        <FileTreeLevel
          :entries="entries"
          :selected="selected"
          :folded="folded"
          :cursors="cursors"
          :changes="changes"
          @toggle="toggle"
          @more="(path) => emit('more', path)"
          @open="(path) => emit('open', path)"
          @menu="(e, path) => emit('menu', e, path)"
        />
        <TreeItem v-if="cursors?.['']" text="Load more files" @click="emit('more', '')" />
        <div v-if="!entries.length" class="search-empty-state">The folder is empty.</div>
      </template>
      <div v-if="git && (mode === 'all' || query.trim())" class="abele-file-tree__note">
        Ignored files are not shown.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// The files of a folder or a worktree in the side panel, the way the file explorer lists a vault:
// folders open in place, a click on a file opens it in the main area. Git speaks in codes at the
// row's end: a coloured square for the kind of change, an accent dot for a change you have not
// looked at yet, a dot on a folder that holds changes. Two modes: every file, or only the changed
// ones, split into unstaged and staged.
import { computed, reactive, ref, watch } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Search from '../obsidian/Search.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import ChangeCodes from './ChangeCodes.vue'
import FileTreeLevel from './FileTreeLevel.vue'
import { dirName, fileName } from './codes'
import type { FileChange, TreeEntry } from './types'

const props = withDefaults(
  defineProps<{
    entries: TreeEntry[]
    changes: FileChange[]
    mode: 'all' | 'changed'
    /** The file open in the main area. */
    selected?: string
    /** Shown as last known while the node is away. */
    stale?: boolean
    /** A repository; a plain folder has only its files, no changes to show. */
    git?: boolean
    label?: string
    cursors?: Record<string, string | null>
  }>(),
  { selected: undefined, stale: false, git: true, label: 'Files', cursors: undefined }
)

const emit = defineEmits<{
  (e: 'update:mode', mode: 'all' | 'changed'): void
  (e: 'open', path: string, stage?: 'staged' | 'unstaged'): void
  (e: 'menu', event: MouseEvent, path: string): void
  (e: 'expand', path: string): void
  (e: 'more', path: string): void
}>()

const query = ref('')

// Folders start folded, except the ones that lead to the open file.
const folded = reactive(new Set<string>())
const knownFolders = new Set<string>()
const foldAll = (list: TreeEntry[]) =>
  list.forEach((e) => {
    if (e.kind === 'folder') {
      if (!knownFolders.has(e.path) && !props.selected?.startsWith(`${e.path}/`)) folded.add(e.path)
      knownFolders.add(e.path)
      if (!folded.has(e.path) && e.children === undefined) emit('expand', e.path)
      foldAll(e.children ?? [])
    }
  })
watch(
  () => props.entries,
  () => foldAll(props.entries),
  { immediate: true }
)
watch(
  () => props.selected,
  (path) => {
    // Opening a file from elsewhere (the next-change arrows) unfolds the way to it.
    if (path) [...folded].forEach((f) => path.startsWith(`${f}/`) && folded.delete(f))
  }
)
const toggle = (id: string) => {
  if (folded.has(id)) {
    folded.delete(id)
    if (knownFolders.has(id)) emit('expand', id)
  } else folded.add(id)
}

const groups = computed(() => [
  {
    id: 'unstaged',
    title: 'Changes',
    files: props.changes.filter((c) => c.stage !== 'staged'),
  },
  {
    id: 'staged',
    title: 'Staged',
    files: props.changes.filter((c) => c.stage === 'staged' || c.stage === 'partly'),
  },
])

const files = computed(() => {
  const out: TreeEntry[] = []
  const walk = (list: TreeEntry[]) =>
    list.forEach((e) => (e.kind === 'file' ? out.push(e) : walk(e.children ?? [])))
  walk(props.entries)
  return out
})
const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  const byName = files.value.filter((f) => f.name.toLowerCase().includes(q))
  const named = new Set(byName)
  return [
    ...byName,
    ...files.value.filter((f) => !named.has(f) && f.path.toLowerCase().includes(q)),
  ]
})
const found = computed(() => matches.value.slice(0, 50))
</script>

<style lang="scss">
.abele-file-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
// The search field with the two mode switches beside it, as Obsidian's search pane sets its
// field over the results.
.abele-file-tree__bar {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-2);
  border-top: var(--border-width) solid var(--background-modifier-border);
}
.abele-file-tree__search {
  flex: 1 1 auto;
  min-width: 0;
}
.abele-file-tree__body {
  padding: 0 var(--size-4-2) var(--size-4-4);
}
.abele-file-tree__group > .tree-item-self {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-semibold);
}
.abele-file-tree__deleted > .tree-item-self .abele-tree-item__text {
  color: var(--text-muted);
  text-decoration: line-through;
}
.abele-file-tree_stale .tree-item-self {
  color: var(--text-muted);
}
.abele-file-tree .search-empty-state {
  padding: var(--size-4-2) var(--size-4-3);
}
.abele-file-tree__note {
  padding: var(--size-4-1) var(--size-4-3);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
body.is-phone .abele-file-tree .tree-item-self {
  min-height: var(--touch-size-m);
  align-items: center;
}
</style>
