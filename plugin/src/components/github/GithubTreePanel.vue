<template>
  <aside ref="panel" class="abele-github-tree" aria-label="The repository's files">
    <div class="abele-github-tree__head">
      <span class="abele-github-tree__title">Files</span>
      <Badge v-if="version" :text="shortRef(version.ref)" />
      <Icon
        class="abele-github-tree__close"
        icon="x"
        tooltip="Close the file tree"
        @click="emit('close')"
      />
    </div>
    <Search v-model="query" class="abele-github-tree__filter" placeholder="Filter by name" />
    <div ref="body" class="abele-github-tree__body">
      <div v-if="error" class="abele-github-tree__error">
        <EmptyState :text="error" />
        <Button text="Try again" icon="refresh-cw" tooltip="Ask GitHub again" @click="load" />
      </div>
      <EmptyState v-else-if="!tree" text="Loading the files…" />
      <template v-else>
        <div v-if="tree.truncated && query" class="abele-github-tree__note">
          The repository is too large to list at once: only the folders opened so far are filtered.
        </div>
        <div v-if="query && !filtered?.matches" class="abele-github-tree__note">
          No name holds “{{ query.trim() }}”.
        </div>
        <div v-else-if="filtered?.capped" class="abele-github-tree__note">
          The first {{ filtered.matches }} matches. Type more to narrow them.
        </div>
        <div role="tree">
          <GithubTreeNode
            v-for="child in paged.visible.value"
            :key="child.path"
            :node="child"
            :expanded="shownOpen"
            :current="current?.path ?? null"
            @pick="pick"
          />
          <div v-if="paged.hasMore.value" ref="sentinel" class="abele-github-tree__note">
            {{ paged.total.value - paged.visible.value.length }} more…
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import type { PaneType } from 'obsidian'
import Badge from '../obsidian/Badge.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Icon from '../obsidian/Icon.vue'
import Search from '../obsidian/Search.vue'
import GithubTreeNode from './GithubTreeNode.vue'
import type { GithubClient } from '@/github/client'
import { paneForClick } from '@/github/links'
import { usePagedList } from '@/composables/usePagedList'
import { ancestors, blobUrlAt, filterTree, findNode, type TreeNode } from '@/github/tree/fileTree'
import { repoTree, type RepoTree } from '@/github/tree/repoTree'

/**
 * The repository's files beside what a tab shows, at the version it shows: a pull request's head,
 * a commit, the ref a file or a folder was read at, the default branch for an issue. The file on
 * screen is marked and its folders are open; a name filter narrows the tree; a click on a file
 * opens it at that same version, by the clicks of any link here.
 *
 * Beside the content on a wide screen; over it, as a drawer, on a narrow one — a phone's code is
 * never squeezed to make room.
 */
const props = defineProps<{
  repo: { host: string; owner: string; repo: string }
  client: GithubClient
  /** Changes when the version does; empty while the tab does not know it yet. */
  versionKey: string
  /** The branch, tag or commit links are made at, and the commit the tree is read at. */
  resolve: () => Promise<{ ref: string; sha: string }>
  /** What the tab shows, to mark: a file, or a folder. */
  current: { path: string; kind: 'file' | 'dir' } | null
}>()

const emit = defineEmits<{
  /** A file to open; `overlaid` when the panel covers the content, and should get out of the way. */
  (e: 'open', url: string, pane: PaneType | false, overlaid: boolean): void
  (e: 'close'): void
}>()

const panel = ref<HTMLElement>()
const body = ref<HTMLElement>()
const tree = shallowRef<RepoTree | null>(null)
const version = ref<{ ref: string; sha: string } | null>(null)
const error = ref<string | null>(null)
const query = ref('')

/** The folders open in the tree, and — while filtering — in the filtered one. */
const expanded = reactive(new Set<string>())
const filterOpen = reactive(new Set<string>())

let generation = 0
const load = async () => {
  const mine = ++generation
  error.value = null
  if (!props.versionKey) return
  try {
    const v = await props.resolve()
    const t = await repoTree(props.client, props.repo, v.sha)
    if (mine !== generation) return
    version.value = v
    tree.value = t
    void showCurrent()
  } catch (e) {
    if (mine !== generation) return
    console.debug('[Abele] GitHub file tree failed', e)
    error.value = e instanceof Error ? e.message : String(e)
  }
}
watch(
  () => props.versionKey,
  (key, before) => {
    if (key === before) return
    tree.value = null
    version.value = null
    expanded.clear()
    void load()
  },
  { immediate: true }
)

const filtered = computed(() =>
  tree.value && query.value.trim() ? filterTree(tree.value.root, query.value) : null
)
watch(filtered, (f) => {
  filterOpen.clear()
  for (const path of f?.open ?? []) filterOpen.add(path)
})
const shownOpen = computed(() => (filtered.value ? filterOpen : expanded))
const shownRoot = computed<TreeNode | null>(() => filtered.value?.root ?? tree.value?.root ?? null)

const paged = usePagedList(() => shownRoot.value?.children ?? [], 200)
const sentinel = paged.sentinel

/** The file on screen: its folders opened, read first where the tree is read a folder at a time. */
async function showCurrent() {
  const t = tree.value
  const c = props.current
  if (!t || !c) return
  try {
    await t.reveal(c.path)
    const folder = c.kind === 'dir' ? findNode(t.root, c.path) : null
    if (folder) await t.expand(folder)
  } catch (e) {
    console.debug('[Abele] GitHub file tree: a folder did not load', e)
  }
  if (t !== tree.value) return
  for (const folder of ancestors(c.path)) expanded.add(folder)
  if (c.kind === 'dir' && c.path) expanded.add(c.path)
  await nextTick()
  const row = body.value?.querySelector<HTMLElement>(
    `.tree-item-self[data-path="${CSS.escape(c.path)}"]`
  )
  const box = body.value
  if (!row || !box) return
  // Within the panel only: scrolling the row into view would move the content beside it too.
  const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
  if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - row.offsetHeight) {
    box.scrollTop = Math.max(0, top - box.clientHeight / 3)
  }
}
watch(
  () => [props.current?.path, props.current?.kind],
  () => void showCurrent()
)

const shortRef = (ref: string) => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref)

/** Whether the panel lies over the content — a phone, a narrow pane — rather than beside it. */
const overlaid = () => {
  // The frame around the panel is what the narrow layout moves over the content.
  const el = panel.value?.parentElement ?? panel.value
  return !!el && el.ownerDocument.defaultView?.getComputedStyle(el).position === 'absolute'
}

const pick = (node: TreeNode, event: MouseEvent) => {
  if (node.kind === 'dir') {
    const open = shownOpen.value
    if (open.has(node.path)) open.delete(node.path)
    else {
      open.add(node.path)
      tree.value?.expand(node).catch((e: unknown) => {
        console.debug('[Abele] GitHub file tree: a folder did not load', e)
        open.delete(node.path)
      })
    }
    return
  }
  if (!version.value) return
  const url = blobUrlAt(props.repo, version.value.ref, node.path)
  const pane = paneForClick(event, false)
  // A submodule is another repository, at a commit only GitHub's own page names.
  if (pane === null || node.kind === 'submodule') window.open(url)
  else emit('open', url, pane, overlaid())
}
</script>

<style lang="scss">
.abele-github-tree {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  background-color: var(--background-secondary);

  &__head {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    padding: var(--size-4-2) var(--size-4-2) var(--size-4-1) var(--size-4-3);
  }

  &__title {
    font-weight: var(--font-semibold);
    font-size: var(--font-ui-small);
    color: var(--text-muted);
  }

  &__close {
    margin-inline-start: auto;
  }

  &__filter {
    padding: 0 var(--size-4-2) var(--size-4-2);
  }

  &__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--size-4-2) var(--size-4-4);
  }

  &__note {
    padding: var(--size-4-1) var(--size-4-2);
    color: var(--text-faint);
    font-size: var(--font-ui-small);
  }

  &__error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--size-4-2);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
}
</style>
