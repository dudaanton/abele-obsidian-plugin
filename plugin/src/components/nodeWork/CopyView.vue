<template>
  <div
    class="abele-copy-view"
    :class="{ 'abele-copy-view_offline': offline, 'abele-copy-view_plain': !folder.git }"
  >
    <header class="abele-copy-view__header">
      <div class="abele-copy-view__where">
        <span>{{ node.name }}</span
        ><span class="abele-copy-view__separator">/</span
        ><span>{{ copy?.path ?? folder.path }}</span>
      </div>
      <h1 class="abele-copy-view__title">{{ folder.name }}</h1>
      <div v-if="folder.git && copy" class="abele-copy-view__git">
        <Dropdown
          class="abele-copy-view__copy"
          :options="copyOptions"
          :model-value="copy.id"
          aria-label="Working copy"
          :disabled="offline"
          @update:model-value="(id: string) => emit('switch-copy', id)"
        />

        <Icon
          class="abele-copy-view__refresh"
          icon="refresh-cw"
          tooltip="Refresh"
          :disabled="offline"
          @click="emit('refresh')"
        />
      </div>
    </header>

    <div v-if="offline" class="abele-copy-view__notice" role="status">
      <StatusDot tone="red" :label="`Offline · seen ${node.seen}`" />
      <span>{{ node.name }} is offline. This is how the folder looked {{ node.seen }}.</span>
    </div>

    <div v-if="copy?.missing" class="abele-copy-view__gone">
      <span class="abele-copy-view__gone-icon" aria-hidden="true"
        ><Icon icon="folder-x" :interactive="false"
      /></span>
      <div class="abele-copy-view__gone-title">This copy is not on {{ node.name }} any more</div>
      <div class="abele-copy-view__gone-text">{{ copy.path }}</div>
      <Button text="Remove from the list" tooltip="Forget this copy" @click="emit('forget')" />
    </div>

    <template v-else>
      <!-- What changed first: it is what one comes to a working copy for. -->
      <section v-if="folder.git" class="abele-copy-view__section abele-copy-view__changes">
        <div class="abele-copy-view__section-head">
          <h2 class="abele-copy-view__section-title">Changes</h2>
          <span v-if="changes.length" class="abele-copy-view__count">{{ changes.length }}</span>
        </div>
        <div v-if="!changes.length" class="abele-copy-view__quiet">
          Nothing changed since the last commit
        </div>
        <div v-else class="abele-copy-view__rows" role="list">
          <template v-for="change in changes" :key="change.path">
            <div
              class="abele-copy-view__row abele-copy-view__change"
              :class="{ 'is-active': open === change.path }"
              role="listitem"
              tabindex="0"
              :aria-expanded="open === change.path"
              @click="toggle(change.path)"
              @keydown.enter.prevent="toggle(change.path)"
              @keydown.space.prevent="toggle(change.path)"
              @keydown.esc="open = null"
            >
              <span class="abele-copy-view__glyph"
                ><Icon
                  :icon="glyphs[change.kind].icon"
                  :color="glyphs[change.kind].color"
                  size="xs"
                  :tooltip="changeLabel(change)"
                  :interactive="false"
              /></span>
              <span class="abele-copy-view__name">{{ fileName(change.path) }}</span>
              <span class="abele-copy-view__dir">{{ dirName(change.path) }}</span>
              <span class="abele-copy-view__stats">
                <span v-if="change.removed" class="abele-copy-view__removed"
                  >−{{ change.removed }}</span
                >
                <span class="abele-copy-view__added">{{
                  change.added ? `+${change.added}` : ''
                }}</span>
              </span>
            </div>
            <Diff
              v-if="open === change.path"
              class="abele-copy-view__diff"
              :text-left="change.before"
              :text-right="change.after"
              :title="change.path"
            />
          </template>
        </div>
      </section>

      <section class="abele-copy-view__section abele-copy-view__files">
        <div class="abele-copy-view__section-head">
          <h2 class="abele-copy-view__section-title">Files</h2>
          <nav v-if="dir.length" class="abele-copy-view__crumbs" aria-label="Folder">
            <span
              class="abele-copy-view__crumb"
              role="link"
              tabindex="0"
              @click="emit('enter', '')"
              @keydown.enter="emit('enter', '')"
              >{{ folder.name }}</span
            >
            <template v-for="(part, i) in dir" :key="i">
              <span class="abele-copy-view__separator">/</span>
              <span
                class="abele-copy-view__crumb"
                :class="{ 'is-current': i === dir.length - 1 }"
                role="link"
                tabindex="0"
                @click="emit('enter', dir.slice(0, i + 1).join('/'))"
                @keydown.enter="emit('enter', dir.slice(0, i + 1).join('/'))"
                >{{ part }}</span
              >
            </template>
          </nav>
        </div>
        <div class="abele-copy-view__rows" role="list">
          <div
            v-for="entry in entries"
            :key="entry.name"
            class="abele-copy-view__row abele-copy-view__entry"
            :class="{ 'is-active': file?.path === pathOf(entry) }"
            role="listitem"
            tabindex="0"
            @click="openEntry(entry)"
            @keydown.enter.prevent="openEntry(entry)"
          >
            <span class="abele-copy-view__glyph"
              ><Icon
                :icon="entry.kind === 'folder' ? 'folder' : fileIcon(entry.name)"
                size="xs"
                :interactive="false"
            /></span>
            <span class="abele-copy-view__name">{{ entry.name }}</span>
            <StatusDot
              v-if="changedHere(entry)"
              tone="orange"
              :label="entry.kind === 'folder' ? 'Has changed files' : 'Changed'"
            />
            <span class="abele-copy-view__size">{{ entry.size }}</span>
          </div>
        </div>

        <div v-if="file" ref="fileCard" class="abele-copy-view__card abele-copy-view__file">
          <div class="abele-copy-view__card-head">
            <span class="abele-copy-view__card-title">{{ file.path }}</span>
            <Icon icon="x" size="xs" tooltip="Close the file" @click="emit('close-file')" />
          </div>
          <div
            class="abele-copy-view__code"
            :style="{ '--abele-copy-digits': String(fileLines.length).length }"
          >
            <div v-for="(line, i) in fileLines" :key="i" class="abele-copy-view__code-line">
              <span class="abele-copy-view__code-number">{{ i + 1 }}</span
              ><span class="abele-copy-view__code-text">{{ line }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="$slots.readme" class="abele-copy-view__card abele-copy-view__readme">
          <div class="abele-copy-view__card-head">
            <span class="abele-copy-view__card-title">README.md</span>
          </div>
          <div class="abele-copy-view__readme-body markdown-rendered"><slot name="readme" /></div>
        </div>
      </section>

      <section v-if="folder.git" class="abele-copy-view__section abele-copy-view__history">
        <div class="abele-copy-view__section-head">
          <h2 class="abele-copy-view__section-title">Commits</h2>
          <a
            v-if="moreCommits"
            class="abele-copy-view__more"
            role="button"
            tabindex="0"
            @click="emit('all-commits')"
            @keydown.enter="emit('all-commits')"
            >Show all</a
          >
        </div>
        <div v-for="group in commitDays" :key="group.day" class="abele-copy-view__day">
          <div class="abele-copy-view__day-title">{{ group.day }}</div>
          <div class="abele-copy-view__rows" role="list">
            <div
              v-for="c in group.commits"
              :key="c.hash"
              class="abele-copy-view__row abele-copy-view__commit-row"
              role="listitem"
            >
              <span class="abele-copy-view__name">{{ c.subject }}</span>
              <span class="abele-copy-view__meta">{{ c.author }} · {{ c.when }}</span>
              <span class="abele-copy-view__hash">{{ c.hash }}</span>
            </div>
          </div>
        </div>
      </section>
      <div v-else class="abele-copy-view__quiet abele-copy-view__plain-note">
        <Icon icon="folder" size="xs" :interactive="false" />
        <span>Not a git repository, so only its files are shown</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// A working copy on the node, in a tab: what changed, its files, its recent commits. Changes come
// first, each opening its own diff in place; files are a list with the folder's README under it,
// or the opened file; commits are grouped by day. Kinds of change are coloured glyphs, their
// words in the tooltip.
import { computed, nextTick, ref, watch } from 'vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import Diff from '../Diff.vue'
import type { KitColor } from '@/constants/colors'
import type {
  ChangeKind,
  CommitSummary,
  CopySummary,
  FileChange,
  FolderEntry,
  FolderSummary,
  NodeSummary,
} from './types'

const props = withDefaults(
  defineProps<{
    node: NodeSummary
    folder: FolderSummary
    copy?: CopySummary
    changes?: FileChange[]
    /** The folder inside the copy whose entries are listed, as path parts. */
    dir?: string[]
    entries?: FolderEntry[]
    file?: { path: string; text: string }
    commits?: CommitSummary[]
    moreCommits?: boolean
  }>(),
  {
    copy: undefined,
    changes: () => [],
    dir: () => [],
    entries: () => [],
    file: undefined,
    commits: () => [],
    moreCommits: false,
  }
)

const emit = defineEmits<{
  (e: 'switch-copy', id: string): void
  (e: 'refresh'): void
  (e: 'enter', path: string): void
  (e: 'open-file', path: string): void
  (e: 'close-file'): void
  (e: 'all-commits'): void
  (e: 'forget'): void
}>()

const offline = computed(() => props.node.status === 'offline')
const open = ref<string | null>(null)
const toggle = (path: string) => (open.value = open.value === path ? null : path)

const glyphs: Record<ChangeKind, { icon: string; color: KitColor }> = {
  modified: { icon: 'square-dot', color: 'orange' },
  added: { icon: 'square-plus', color: 'green' },
  deleted: { icon: 'square-minus', color: 'red' },
  renamed: { icon: 'square-arrow-right', color: 'blue' },
  conflict: { icon: 'triangle-alert', color: 'red' },
}
const changeLabel = (c: FileChange) =>
  ({
    modified: 'Modified',
    added: 'New file',
    deleted: 'Deleted',
    renamed: `Renamed from ${c.from ?? ''}`,
    conflict: 'Conflict: both sides changed it',
  })[c.kind] + (c.partlyStaged ? ' · partly staged' : '')

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const dirName = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

const copyOptions = computed(() =>
  props.folder.copies.map((c) => ({
    value: c.id,
    display: c.branch,
    disabled: c.missing,
  }))
)

const pathOf = (entry: FolderEntry) => [...props.dir, entry.name].join('/')
const changedHere = (entry: FolderEntry) => {
  const path = pathOf(entry)
  return props.changes.some((c) => c.path === path || c.path.startsWith(`${path}/`))
}
function openEntry(entry: FolderEntry) {
  if (entry.kind === 'folder') emit('enter', pathOf(entry))
  else emit('open-file', pathOf(entry))
}
const fileIcon = (name: string) =>
  /\.(md|txt)$/i.test(name)
    ? 'file-text'
    : /\.(png|jpe?g|svg|gif)$/i.test(name)
      ? 'file-image'
      : /\.(json|ya?ml|toml)$/i.test(name)
        ? 'file-cog'
        : 'file-code'
const fileLines = computed(() => props.file?.text.split('\n') ?? [])
// An opened file comes into view, as far as it has to and no further.
const fileCard = ref<HTMLElement>()
watch(
  () => props.file?.path,
  (path) => path && void nextTick(() => fileCard.value?.scrollIntoView({ block: 'nearest' }))
)

const commitDays = computed(() => {
  const days: { day: string; commits: CommitSummary[] }[] = []
  for (const c of props.commits) {
    const last = days.at(-1)
    if (last?.day === c.day) last.commits.push(c)
    else days.push({ day: c.day, commits: [c] })
  }
  return days
})
</script>

<style lang="scss">
// One column at the width of a note, as Obsidian reads; sections spaced like a note's headings.
.abele-copy-view {
  max-width: var(--file-line-width);
  margin: 0 auto;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
}

.abele-copy-view__header {
  margin-bottom: var(--heading-spacing);
}
.abele-copy-view__where {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-copy-view__separator {
  padding-inline: var(--size-2-2);
  color: var(--text-faint);
}
.abele-copy-view__title {
  margin: var(--size-4-1) 0 var(--size-4-3);
  font-size: var(--inline-title-size);
  font-weight: var(--inline-title-weight);
  line-height: var(--inline-title-line-height);
}
.abele-copy-view__git {
  display: flex;
  align-items: center;
  gap: var(--size-4-3);
  min-width: 0;
}
.abele-copy-view__copy {
  flex: 0 1 auto;
  min-width: 0;
}
.abele-copy-view__commit {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-copy-view__commit-subject {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-copy-view__meta {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-copy-view__hash {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}

.abele-copy-view__notice {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-bottom: var(--heading-spacing);
  padding: var(--size-4-2) var(--size-4-3);
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
  color: var(--text-muted);
}
.abele-copy-view_offline .abele-copy-view__section {
  color: var(--text-muted);
}

.abele-copy-view__section + .abele-copy-view__section,
.abele-copy-view__section + .abele-copy-view__plain-note {
  margin-top: var(--heading-spacing);
}
.abele-copy-view__section-head {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}
.abele-copy-view__section-title {
  margin: 0;
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
}
.abele-copy-view__count {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.abele-copy-view__more {
  margin-inline-start: auto;
  color: var(--text-accent);
  text-decoration: none;
  cursor: var(--cursor);

  &:hover {
    color: var(--text-accent-hover);
  }
}
.abele-copy-view__quiet {
  color: var(--text-muted);
}
.abele-copy-view__plain-note {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);

  .abele-obsidian-icon {
    padding: 0;
  }
}

// Rows are one line: glyph, name, quiet detail, a fact at the right edge. The row's hover and
// highlight are Obsidian's tree item's.
.abele-copy-view__rows {
  display: flex;
  flex-direction: column;
}
.abele-copy-view__row {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);

  &[tabindex] {
    cursor: var(--cursor);
  }
  &[tabindex]:hover {
    background-color: var(--nav-item-background-hover);
  }
  &.is-active {
    background-color: var(--nav-item-background-active);
  }
}
.abele-copy-view__glyph {
  display: flex;
  flex: 0 0 auto;
  color: var(--icon-color);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-copy-view__name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-copy-view__dir {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-copy-view__stats {
  display: flex;
  flex: 0 0 auto;
  gap: var(--size-4-1);
  margin-inline-start: auto;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-copy-view__removed,
.abele-copy-view__added {
  // Each count keeps its column, so the numbers stand under each other row to row.
  min-width: var(--size-4-6);
  text-align: end;
}
.abele-copy-view__removed {
  color: var(--text-error);
}
.abele-copy-view__added {
  color: var(--text-success);
}
.abele-copy-view__diff {
  margin: var(--size-4-1) 0 var(--size-4-3);
}
.abele-copy-view__size {
  flex: 0 0 auto;
  margin-inline-start: auto;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-copy-view__entry .abele-status-dot {
  margin-inline-start: var(--size-4-1);
}
.abele-copy-view__commit-row .abele-copy-view__name {
  flex: 1 1 auto;
}

.abele-copy-view__crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  min-width: 0;
  color: var(--text-muted);
}
.abele-copy-view__crumb {
  cursor: var(--cursor);

  &:hover {
    color: var(--text-normal);
  }
  &.is-current {
    color: var(--text-normal);
  }
}

// The open file and the README are cards like the diff: the same frame, header band and radius.
.abele-copy-view__card {
  margin-top: var(--size-4-3);
  overflow: hidden;
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
}
.abele-copy-view__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-3);
  padding: var(--size-4-2) var(--size-4-3);
  border-bottom: var(--border-width) solid var(--background-modifier-border);
  background-color: var(--background-secondary);
}
.abele-copy-view__card-title {
  min-width: 0;
  overflow: hidden;
  font-weight: var(--font-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-copy-view__card-head .abele-obsidian-icon {
  margin-block: calc(-1 * var(--size-4-1));
}
.abele-copy-view__readme-body {
  padding: var(--size-4-2) var(--size-4-4);
  font-size: var(--font-text-size);

  > :first-child {
    margin-top: 0;
  }
  > :last-child {
    margin-bottom: 0;
  }
}
.abele-copy-view__code {
  max-height: calc(var(--size-4-8) * 12);
  overflow: auto;
  padding-block: var(--size-4-1);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-normal);
}
.abele-copy-view__code-line {
  display: flex;
  padding-inline: var(--size-4-3);
}
.abele-copy-view__code-number {
  flex: 0 0 auto;
  width: calc(var(--abele-copy-digits) * 1ch);
  margin-inline-end: var(--size-4-3);
  color: var(--text-faint);
  text-align: end;
  user-select: none;
}
.abele-copy-view__code-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.abele-copy-view__day + .abele-copy-view__day {
  margin-top: var(--size-4-3);
}
.abele-copy-view__day-title {
  margin-bottom: var(--size-4-1);
  padding-inline: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-copy-view__gone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-8) var(--size-4-4);
  text-align: center;

  .abele-obsidian-button {
    margin-top: var(--size-4-3);
  }
}
.abele-copy-view__gone-icon {
  display: flex;
  margin-bottom: var(--size-4-2);
  color: var(--text-faint);
  --icon-size: var(--icon-xl);
  --icon-stroke: var(--icon-xl-stroke-width);
}
.abele-copy-view__gone-title {
  font-size: var(--font-ui-medium);
  font-weight: var(--font-medium);
}
.abele-copy-view__gone-text {
  color: var(--text-muted);
}

// The phone: the commit line goes under the copy picker; rows are touch height.
body.is-phone {
  .abele-copy-view__git {
    flex-wrap: wrap;
  }
  .abele-copy-view__commit {
    order: 3;
    flex-basis: 100%;
  }
  .abele-copy-view__row {
    min-height: var(--touch-size-m);
  }
  .abele-copy-view__crumb {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch-size-m);
    padding-inline: var(--size-4-1);
  }
  .abele-copy-view__dir,
  .abele-copy-view__commit-row .abele-copy-view__meta {
    display: none;
  }
}
</style>
