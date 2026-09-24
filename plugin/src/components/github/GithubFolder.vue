<template>
  <div class="abele-github-folder">
    <div class="abele-github-folder__list" role="tree" aria-label="Folders and files">
      <EmptyState v-if="!folder.entries.length" text="This folder is empty." />
      <TreeItem
        v-for="entry in paged.visible.value"
        :key="entry.path"
        :text="entry.name"
        :icon="ICONS[entry.kind]"
        :flair="
          entry.size !== undefined && entry.kind === 'file' ? formatSize(entry.size) : undefined
        "
        :path="entry.path"
        @click="open(entry, $event)"
      />
      <div v-if="paged.hasMore.value" ref="sentinel" class="abele-github-folder__more">
        {{ paged.total.value - paged.visible.value.length }} more…
      </div>
    </div>

    <section
      v-if="readme"
      ref="readmeEl"
      class="abele-github-folder__readme"
      :data-path="readme.path"
    >
      <div class="abele-github-folder__readme-name">{{ readme.name }}</div>
      <EmptyState v-if="readmeText.error.value" :text="readmeText.error.value" />
      <EmptyState v-else-if="readmeText.data.value === null" text="Loading the README…" />
      <GithubText
        v-else-if="isMarkdownPath(readme.path)"
        :text="readmeText.data.value"
        :repo="readmeFile"
        as-document
      />
      <pre v-else class="abele-github-folder__plain">{{ readmeText.data.value }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PaneType } from 'obsidian'
import TreeItem from '../obsidian/TreeItem.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubText from './GithubText.vue'
import type { GithubClient } from '@/github/client'
import type { RepoFile } from '@/github/markdownLinks'
import { isMarkdownPath } from '@/github/markdownPreview'
import { useLoad } from '@/github/useLoad'
import { paneForClick } from '@/github/links'
import { usePagedList } from '@/composables/usePagedList'
import { blobUrlAt, treeUrl } from '@/github/tree/fileTree'
import { formatSize, readmeOf, type FolderData, type FolderEntry } from '@/github/tree/folder'
import { registerProse, unregisterProse } from '@/github/proseSelection'

/**
 * A folder of a repository, as GitHub lists one: its folders, then its files with their sizes,
 * and its README rendered under them. A click opens the entry at the same version; the clicks are
 * those of any link here.
 */
const props = defineProps<{
  folder: FolderData
  repo: { host: string; owner: string; repo: string }
  client: GithubClient
}>()

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
}>()

const ICONS: Record<FolderEntry['kind'], string> = {
  dir: 'folder',
  file: 'file',
  submodule: 'package',
  symlink: 'file-symlink',
}

/** A folder of thousands of files draws a page at a time, as it scrolls. */
const paged = usePagedList(() => props.folder.entries, 200)
const sentinel = paged.sentinel
watch(() => props.folder, paged.reset)

const urlOf = (entry: FolderEntry) =>
  entry.kind === 'dir'
    ? treeUrl(props.repo, props.folder.ref, entry.path)
    : blobUrlAt(props.repo, props.folder.ref, entry.path)

const open = (entry: FolderEntry, event: MouseEvent) => {
  const url = urlOf(entry)
  const pane = paneForClick(event, false)
  // A submodule is another repository, at a commit only GitHub's own page names.
  if (pane === null || entry.kind === 'submodule') window.open(url)
  else emit('open', url, pane)
}

const readme = computed(() => readmeOf(props.folder.entries))
const readmeFile = computed<RepoFile>(() => ({
  ...props.repo,
  ref: props.folder.ref,
  path: readme.value?.path ?? '',
}))
const readmeText = useLoad(async () => {
  const r = readme.value
  return r ? props.client.fileText(props.repo, r.path, props.folder.ref, 'the README') : ''
})
/**
 * Words selected in the README are the README's: asked about, linked and quoted as that file at
 * the version shown, not as the folder.
 */
const readmeEl = ref<HTMLElement>()
watch(readmeEl, (el, old) => {
  if (old) unregisterProse(old)
  if (!el) return
  registerProse(el, {
    what: 'README',
    name: 'the README',
    link: () => {
      const r = readme.value
      if (!r) return null
      const { owner, repo } = props.repo
      const ref = props.folder.ref
      return {
        label: `${owner}/${repo}@${/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref} · ${r.path}`,
        url: blobUrlAt(props.repo, ref, r.path),
      }
    },
  })
})
onBeforeUnmount(() => {
  if (readmeEl.value) unregisterProse(readmeEl.value)
})

watch(
  () => [props.folder.ref, readme.value?.path],
  () => {
    readmeText.data.value = null
    if (readme.value) void readmeText.load()
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-github-folder {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);

  &__list {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    padding: var(--size-4-1);
  }

  // A flat list folds nothing: its rows need no room for the arrow a tree keeps at their start.
  &__list .tree-item-self {
    padding-inline-start: var(--size-4-2);
  }

  &__more {
    padding: var(--size-4-1) var(--size-4-2);
    color: var(--text-faint);
    font-size: var(--font-ui-small);
  }

  &__readme {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    padding: var(--size-4-3) var(--size-4-4);
    min-width: 0;
  }

  &__readme-name {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    padding-bottom: var(--size-4-2);
    margin-bottom: var(--size-4-2);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  &__plain {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
  }
}
</style>
