<template>
  <div class="abele-file-tree" :class="{ 'abele-file-tree_stale': stale }">
    <div class="abele-file-tree__bar">
      <Search
        v-model="query"
        class="abele-file-tree__search"
        :placeholder="t('streamB.findAFile.423001')"
        :aria-label="t('streamB.findAFileByNameOrPath.d42472')"
      />
      <Icon
        v-if="codeSearch"
        icon="file-search"
        data-node-project-search
        :tooltip="t('streamB.searchCode.c33868')"
        :active="contentOpen"
        @click="contentOpen = !contentOpen"
      />
      <!-- A phone's panel has no room for three glyphs beside the field: one, the view shown,
           and the three in its menu, opened at the glyph. -->
      <Icon
        v-if="git && modes && phone"
        class="abele-file-tree__mode"
        :icon="MODES.find((m) => m.id === mode)?.icon ?? 'folder-tree'"
        :tooltip="t('streamB.whichFilesToShow.f6fdf2')"
        aria-haspopup="menu"
        @click="modeMenu"
      />
      <Icon
        v-if="git && modes && !phone"
        class="abele-file-tree__mode"
        :class="{ 'is-active': mode === 'all' }"
        icon="folder-tree"
        :tooltip="t('streamB.allFiles.866956')"
        :aria-pressed="mode === 'all'"
        @click="emit('update:mode', 'all')"
      />
      <Icon
        v-if="git && modes && !phone"
        class="abele-file-tree__mode"
        :class="{ 'is-active': mode === 'changed-tree' }"
        icon="folder-git-2"
        :tooltip="t('streamB.changedFilesInTheirFolders.55c297', { v0: String(changes.length) })"
        :aria-pressed="mode === 'changed-tree'"
        @click="emit('update:mode', 'changed-tree')"
      />
      <Icon
        v-if="git && modes && !phone"
        class="abele-file-tree__mode"
        :class="{ 'is-active': mode === 'changed' }"
        icon="file-diff"
        :tooltip="t('streamB.onlyChangedFilesStagedApart.bcb221', { v0: String(changes.length) })"
        :aria-pressed="mode === 'changed'"
        @click="emit('update:mode', 'changed')"
      />
      <!-- Reading again under rows already shown: said here, in a slot that is always there,
           so neither the rows nor the field move when it comes and goes. -->
      <span class="abele-file-tree__state">
        <template v-if="progress && !statusLine">
          <Icon
            v-if="progress.state === 'failed'"
            class="abele-file-tree__state-failed"
            icon="alert-triangle"
            size="xs"
            :tooltip="
              t('streamB.couldnTReadTheFilesTryAgain.5ae5c2', {
                v0: String(progress.error ? ` · ${progress.error}` : ''),
              })
            "
            @click="emit('retry')"
          />
          <ResultMark
            v-else
            state="working"
            :text="
              t('streamB.readingTheFiles.149032', {
                v0: String(
                  progress.count
                    ? t('streamB.soFar.4464f4', { v0: String(streamBNumber(progress.count)) })
                    : ''
                ),
              })
            "
          />
        </template>
      </span>
    </div>

    <div v-if="codeSearch && contentOpen" class="abele-file-tree__body">
      <GithubCodeSearch
        :code="codeSearch"
        @open="(url) => emit('open-result', url)"
        @close="contentOpen = false"
      />
    </div>
    <div v-else class="abele-file-tree__body" role="tree" :aria-label="label">
      <!-- The files are still being read, or reading them failed, and there is no row yet:
           said in place of the rows, never as an empty folder. -->
      <div
        v-if="statusLine"
        class="abele-file-tree__status"
        :class="{ 'abele-file-tree__status_failed': progress.state === 'failed' }"
        role="status"
      >
        <template v-if="progress.state === 'failed'">
          <Icon
            class="abele-file-tree__status-mark"
            icon="alert-triangle"
            :interactive="false"
            size="xs"
            :tooltip="progress.error"
          />
          <span class="abele-file-tree__status-text">{{
            t('streamB.couldnTReadTheFiles.9a7e62')
          }}</span>
          <Icon
            icon="rotate-ccw"
            size="xs"
            :tooltip="t('streamB.tryAgain.d8b839')"
            @click="emit('retry')"
          />
        </template>
        <template v-else>
          <ResultMark state="working" :text="t('streamB.readingTheFiles.6ce37f')" />
          <span class="abele-file-tree__status-text"
            >{{ t('streamB.readingTheFiles.86a22c')
            }}<template v-if="progress.count">
              {{
                t('streamBMeta.549a8796e9', { p0: String(streamBNumber(progress.count)) })
              }}</template
            ></span
          >
        </template>
      </div>
      <!-- A name typed: every file that matches, flat, wherever it lies. -->
      <template v-if="query.trim()">
        <div v-if="searchError" role="alert">{{ searchError }}</div>
        <div v-if="searching" role="status">{{ t('streamB.stillReadingTheFiles.e4cd3c') }}</div>
        <TreeItem
          v-for="hit in found"
          :key="hit.path"
          :text="hit.name"
          :icon="fileIcon(hit.name)"
          :where="dirName(hit.path)"
          :active="selected === hit.path"
          :path="hit.path"
          @click="emit('open', hit.path)"
          @contextmenu.prevent.stop="emit('menu', $event, hit.path)"
        >
          <template v-if="hit.change" #end><ChangeCodes :change="hit.change" /></template>
        </TreeItem>
        <div v-if="matches.length > found.length" class="abele-file-tree__note">
          {{
            t('streamBMeta.eeb4efb354', {
              p0: String(found.length),
              p1: String(streamBNumber(matches.length)),
            })
          }}
        </div>
        <div
          v-if="!found.length && !progress && !searching && !searchError"
          class="search-empty-state"
        >
          {{ t('streamB.noFileMatches.076cff') }}
        </div>
        <div v-if="progress" class="abele-file-tree__note">
          {{
            progress.state === 'failed'
              ? t('streamB.searchedOnlyTheFilesReadSoFar.8941c5')
              : found.length
                ? t('streamB.stillReadingTheFilesMoreMayMatch.4df218')
                : t('streamB.stillReadingTheFiles.e4cd3c')
          }}
        </div>
      </template>

      <!-- Only what changed, in two groups: not yet staged, and staged for the commit. -->
      <template v-else-if="git && mode === 'changed'">
        <template v-for="group in groups" :key="group.id">
          <TreeItem
            v-if="group.files.length"
            class="abele-file-tree__group"
            :text="group.title"
            :label="group.tip"
            :flair="String(group.files.length)"
            collapsible
            :collapsed="folded.has(group.id)"
            @click="toggle(group.id)"
          >
            <template v-if="actions && group.id !== 'committed'" #actions>
              <Icon
                :icon="group.id === 'staged' ? 'minus' : 'plus'"
                size="xs"
                :tooltip="
                  group.id === 'staged'
                    ? t('streamB.unstageAll.2aed2d')
                    : t('streamB.stageAll.24f4c8')
                "
                @click.stop="emit(group.id === 'staged' ? 'unstage-all' : 'stage-all')"
              />
            </template>
            <TreeItem
              v-for="change in group.files"
              :key="change.path"
              :text="fileName(change.path)"
              :icon="fileIcon(fileName(change.path))"
              :where="dirName(change.path)"
              :active="selected === change.path"
              :path="change.path"
              :class="{
                'abele-file-tree__deleted': change.kind === 'deleted',
                'abele-file-tree__change': true,
              }"
              @click="emit('open', change.path, group.id)"
              @contextmenu.prevent.stop="emit('menu', $event, change.path)"
            >
              <template #end><ChangeCodes :change="change" /></template>
              <template v-if="actions && group.id !== 'committed'" #actions>
                <Icon
                  v-if="group.id === 'unstaged' && change.kind !== 'conflict'"
                  icon="undo-2"
                  size="xs"
                  :tooltip="t('streamB.discardTheChangesToThisFile.f1468a')"
                  @click.stop="emit('discard', change.path)"
                />
                <Icon
                  :icon="group.id === 'staged' ? 'minus' : 'plus'"
                  size="xs"
                  :tooltip="
                    group.id === 'staged'
                      ? t('streamB.unstage.033f86')
                      : change.kind === 'conflict'
                        ? t('streamB.markResolvedAndStage.b8565a')
                        : t('streamB.stage.de8388')
                  "
                  @click.stop="emit(group.id === 'staged' ? 'unstage' : 'stage', change.path)"
                />
              </template>
            </TreeItem>
          </TreeItem>
        </template>
        <div v-if="!changes.length && !branchChanges.length" class="search-empty-state">
          {{
            base
              ? t('streamB.nothingDiffersFrom.71f83c', { v0: String(base) })
              : t('streamB.nothingChanged.874ab5')
          }}
        </div>
        <div v-if="more" class="abele-file-tree__note">
          {{ more }}
        </div>
      </template>

      <!-- Only what changed, but where it lies: the folders that hold changes, a folder with one
           folder in it named as one path, and each file with its codes. -->
      <template v-else-if="git && mode === 'changed-tree'">
        <!-- With staging at hand the same trees go under their groups, as a source control
             panel splits them: what is not staged, what is, what the branch committed. -->
        <template v-if="actions || grouped">
          <template v-for="group in groups" :key="group.id">
            <TreeItem
              v-if="group.files.length"
              class="abele-file-tree__group"
              :text="group.title"
              :label="group.tip"
              :flair="String(group.files.length)"
              collapsible
              :collapsed="folded.has(group.id)"
              @click="toggle(group.id)"
            >
              <template v-if="actions && group.id !== 'committed'" #actions>
                <Icon
                  :icon="group.id === 'staged' ? 'minus' : 'plus'"
                  size="xs"
                  :tooltip="
                    group.id === 'staged'
                      ? t('streamB.unstageAll.2aed2d')
                      : t('streamB.stageAll.24f4c8')
                  "
                  @click.stop="emit(group.id === 'staged' ? 'unstage-all' : 'stage-all')"
                />
              </template>
              <FileTreeLevel
                :entries="groupTrees[group.id]"
                :selected="selected"
                :folded="changedFolded"
                :stage="!actions || group.id === 'committed' ? undefined : group.id"
                @toggle="toggleChanged"
                @open="(path) => emit('open', path, group.id)"
                @menu="(e, path) => emit('menu', e, path)"
                @stage="(p) => emit('stage', p)"
                @unstage="(p) => emit('unstage', p)"
                @discard="(p) => emit('discard', p)"
              />
            </TreeItem>
          </template>
        </template>
        <FileTreeLevel
          v-else
          :entries="changedTree"
          :selected="selected"
          :folded="changedFolded"
          @toggle="toggleChanged"
          @open="openChanged"
          @menu="(e, path) => emit('menu', e, path)"
        />
        <div v-if="!allChanges.length" class="search-empty-state">
          {{
            base
              ? t('streamB.nothingDiffersFrom.71f83c', { v0: String(base) })
              : t('streamB.nothingChanged.874ab5')
          }}
        </div>
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
        <TreeItem
          v-if="cursors?.['']"
          :text="t('streamB.loadMoreFiles.5c455f')"
          @click="emit('more', '')"
        />
        <div v-if="!entries.length && !progress" class="search-empty-state">
          {{ t('streamB.theFolderIsEmpty.9bce31') }}
        </div>
      </template>
      <div v-if="git && (mode === 'all' || query.trim())" class="abele-file-tree__note">
        {{ t('streamB.ignoredFilesAreNotShown.6bee96') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { streamBNumber } from '@/i18n/streamBDate'
import { t } from '@/i18n'
import GithubCodeSearch from '../github/GithubCodeSearch.vue'
import type { TabCode } from '@/github/search/tabCode'
// The files of a folder or a worktree in the side panel, the way the file explorer lists a vault:
// folders open in place, a click on a file opens it in the main area. Git speaks in codes at the
// row's end: a coloured square for the kind of change, an accent dot for a change you have not
// looked at yet, a dot on a folder that holds changes. Three modes: every file, only the changed
// ones in their folders, or only the changed ones as a list split into unstaged and staged.
import { computed, reactive, ref, watch } from 'vue'
import { presentUiError } from '@/i18n/streamBErrors'
import { Menu, Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Search from '../obsidian/Search.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import ResultMark from '../obsidian/ResultMark.vue'
import ChangeCodes from './ChangeCodes.vue'
import FileTreeLevel from './FileTreeLevel.vue'
import { dirName, fileIcon, fileName } from './codes'
import type { FileChange, FileTreeMode, TreeEntry } from './types'
import { changedTree as buildChangedTree } from './changedTree'

const props = withDefaults(
  defineProps<{
    entries: TreeEntry[]
    search?: (query: string) => Promise<TreeEntry[]>
    codeSearch?: Pick<TabCode, 'search' | 'refLabel'>
    searchKey?: string
    changes: FileChange[]
    mode: FileTreeMode
    /** The file open in the main area. */
    selected?: string
    /** Shown as last known while the node is away. */
    stale?: boolean
    /** A repository; a plain folder has only its files, no changes to show. */
    git?: boolean
    label?: string
    progress?: { state: 'reading' | 'failed'; count?: number; error?: string }
    cursors?: Record<string, string | null>
    /**
     * Files committed on this branch and not in its base, for a third group under the two of the
     * working tree: what the branch would bring in, as a pull request lists it.
     */
    branchChanges?: FileChange[]
    /** The branch the committed group is compared with. */
    base?: string
    /** The view switches beside the search; off where the page around it chooses the view. */
    modes?: boolean
    /** Stage, unstage and discard on each changed row, shown under the pointer. */
    actions?: boolean
    /** The changed files under their groups (not staged, staged, committed) without the actions. */
    grouped?: boolean
    /** What the list leaves out, said under it ("200 of 1 240 files · show more"). */
    more?: string
  }>(),
  {
    selected: undefined,
    search: undefined,
    codeSearch: undefined,
    searchKey: undefined,
    stale: false,
    git: true,
    label: () => t('streamB.files.abc7e9'),
    cursors: undefined,
    progress: undefined,
    branchChanges: () => [],
    base: undefined,
    modes: true,
    actions: false,
    grouped: false,
    more: undefined,
  }
)

const emit = defineEmits<{
  (e: 'open-result', url: string): void
  (e: 'update:mode', mode: FileTreeMode): void
  (e: 'open', path: string, stage?: 'staged' | 'unstaged' | 'committed'): void
  (e: 'stage' | 'unstage' | 'discard', path: string): void
  (e: 'stage-all' | 'unstage-all'): void
  (e: 'menu', event: MouseEvent, path: string): void
  (e: 'expand', path: string): void
  (e: 'more', path: string): void
  (e: 'retry'): void
}>()

const phone = Platform.isPhone
const contentOpen = ref(false)
/** The three views, as the computer's glyphs say them and the phone's menu lists them. */
const MODES: { id: FileTreeMode; icon: string; title: string }[] = [
  { id: 'all', icon: 'folder-tree', title: t('streamB.allFiles.866956') },
  {
    id: 'changed-tree',
    icon: 'folder-git-2',
    title: t('streamB.changedFilesInTheirFolders.efb6ff'),
  },
  { id: 'changed', icon: 'file-diff', title: t('streamB.onlyChangedFilesStagedApart.500e8a') },
]
/** The phone's one glyph: the three views in a menu at it, the one shown ticked. */
function modeMenu(event: MouseEvent) {
  const menu = new Menu()
  for (const m of MODES)
    menu.addItem((item) =>
      item
        .setTitle(m.id === 'all' ? m.title : `${m.title} · ${props.changes.length}`)
        .setIcon(m.icon)
        .setChecked(props.mode === m.id)
        .onClick(() => emit('update:mode', m.id))
    )
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  menu.showAtPosition({ x: rect.left, y: rect.bottom })
}

const query = ref('')
const searchResults = ref<TreeEntry[]>([])
const searching = ref(false)
const searchError = ref('')
watch([query, () => props.searchKey], async ([value], _previous, cleanup) => {
  let cancelled = false
  cleanup(() => {
    cancelled = true
  })
  searchResults.value = []
  searchError.value = ''
  const search = props.search
  searching.value = !!search && !!value.trim()
  if (!search || !value.trim()) return
  try {
    const rows = await search(value.trim())
    if (!cancelled) searchResults.value = rows
  } catch (error) {
    if (!cancelled) searchError.value = presentUiError(error)
  } finally {
    if (!cancelled) searching.value = false
  }
})
const statusLine = computed(
  () =>
    !!props.progress &&
    !props.entries.length &&
    (props.mode === 'all' || !props.git) &&
    !query.value.trim()
)

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
    if (path)
      [...folded].forEach((folder) => {
        if (!path.startsWith(`${folder}/`)) return
        folded.delete(folder)
        if (knownFolders.has(folder)) emit('expand', folder)
      })
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
    id: 'unstaged' as const,
    title: t('streamB.changes.bbd4b6'),
    tip: t('streamB.changedInTheWorkingTreeNotStaged.df3eee'),
    files: props.changes.filter((c) => c.stage !== 'staged'),
  },
  {
    id: 'staged' as const,
    title: t('streamB.staged.daec45'),
    tip: t('streamB.stagedForTheNextCommit.fb5957'),
    files: props.changes.filter((c) => c.stage === 'staged' || c.stage === 'partly'),
  },
  {
    id: 'committed' as const,
    title: t('streamB.committed.dd9061'),
    tip: t('streamB.committedOnThisBranchNotIn.28b056', {
      v0: String(props.base ?? t('streamB.itsBase.6fb4dc')),
    }),
    files: props.branchChanges,
  },
])
/** Everything that differs from the base: the working tree over what the branch committed. */
const allChanges = computed(() => {
  const working = new Set(props.changes.map((c) => c.path))
  return [...props.changes, ...props.branchChanges.filter((c) => !working.has(c.path))]
})

const changedTree = computed(() => buildChangedTree(allChanges.value))
const groupTrees = computed(() =>
  Object.fromEntries(groups.value.map((g) => [g.id, buildChangedTree(g.files)]))
)
// Its folders stand open, since only changes are in them; folding one here leaves the whole tree be.
const changedFolded = reactive(new Set<string>())
const toggleChanged = (path: string) =>
  changedFolded.has(path) ? changedFolded.delete(path) : changedFolded.add(path)
// A file staged whole opens its staged change; any other, what is in the working tree.
const openChanged = (path: string) =>
  emit(
    'open',
    path,
    props.changes.find((c) => c.path === path)?.stage === 'staged'
      ? 'staged'
      : props.changes.some((c) => c.path === path)
        ? 'unstaged'
        : 'committed'
  )

const files = computed(() => {
  const out: TreeEntry[] = []
  const walk = (list: TreeEntry[]) =>
    list.forEach((e) => (e.kind === 'file' ? out.push(e) : walk(e.children ?? [])))
  walk(props.entries)
  return out
})
const matches = computed(() => {
  if (props.search) return searchResults.value
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
.abele-file-tree__state {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: calc(var(--icon-xs) + 2 * var(--size-2-2));
}
.abele-file-tree__state-failed {
  color: var(--text-error);
}
.abele-file-tree__body {
  padding: var(--size-2-2) var(--size-4-2) var(--size-4-4);
}
.abele-file-tree__group > .tree-item-self {
  --abele-tree-item-weight: var(--font-semibold);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
// A name keeps to one line and is cut short, as the file explorer keeps it; broken anywhere, a
// long one ran over three lines in a phone's panel. The whole path is in the row's tooltip.
.abele-file-tree .abele-tree-item__inner {
  flex: 1 1 auto;
}
.abele-file-tree .abele-tree-item__text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
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
body.is-phone .abele-file-tree .abele-tree-item__text {
  flex: 1 1 auto;
  white-space: normal;
  overflow-wrap: anywhere;
}
body.is-phone .abele-file-tree__change > .tree-item-self {
  flex-wrap: wrap;
  row-gap: var(--size-4-1);
}
body.is-phone .abele-file-tree__change > .tree-item-self > .abele-tree-item__inner {
  flex-basis: 100%;
}
body.is-phone .abele-file-tree__change > .tree-item-self > .tree-item-flair-outer {
  margin-inline-start: auto;
}
// One line over the tree, its glyph where a row's glyph stands and its words on the rows' text.
.abele-file-tree__status {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2) var(--size-4-1) var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-file-tree__status-text {
  flex: 1 1 auto;
  color: inherit;
  min-width: 0;
}
.abele-file-tree__status_failed {
  color: var(--text-normal);

  .abele-file-tree__status-mark {
    padding: 0;
    color: var(--text-error);
  }
}
</style>
