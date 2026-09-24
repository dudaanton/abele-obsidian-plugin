<template>
  <header class="abele-github-header">
    <div class="abele-github-header__top">
      <div class="abele-github-header__repo">{{ crumbs ? '' : repo }}</div>
      <div class="abele-github-header__actions">
        <Icon
          icon="folder-tree"
          :active="tree"
          :tooltip="tree ? 'Hide the file tree' : 'Show the repository\'s files beside this'"
          @click="emit('tree')"
        />
        <Icon icon="search" tooltip="Find in this tab (Mod+F)" @click="emit('find')" />
        <Icon
          icon="file-search"
          tooltip="Search the code: this change, the whole repository, or file names"
          @click="emit('search')"
        />
        <Icon
          v-if="chat"
          icon="message-square-plus"
          tooltip="Chat about this: a new chat with a link to it in the input"
          @click="emit('chat')"
        />
        <Icon
          icon="refresh-cw"
          tooltip="Load again from GitHub"
          :disabled="loading"
          @click="emit('refresh')"
        />
        <Icon
          v-if="url"
          icon="external-link"
          tooltip="Open this on GitHub in the browser"
          @click="emit('browser')"
        />
      </div>
    </div>
    <h2 class="abele-github-header__title">
      <GithubBreadcrumbs
        v-if="crumbs"
        :crumbs="crumbs"
        :ref-label="refLabel"
        @open="(url: string, pane: PaneType | false) => emit('open', url, pane)"
      />
      <template v-else>{{ title }}</template>
      <span v-if="number" class="abele-github-header__number">#{{ number }}</span>
    </h2>
    <div v-if="state || labels?.length" class="abele-github-header__badges">
      <Badge v-if="state" :text="state" :accent="accentStates.includes(state)" />
      <Badge v-for="label in labels" :key="label.name" :text="label.name" />
    </div>
    <div v-if="meta.length" class="abele-github-header__meta">
      <span v-for="(part, i) in meta" :key="i">{{ part }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import Icon from '../obsidian/Icon.vue'
import Badge from '../obsidian/Badge.vue'
import GithubBreadcrumbs from './GithubBreadcrumbs.vue'
import type { PaneType } from 'obsidian'
import type { Label } from '@/github/api'
import type { Crumb } from '@/github/tree/fileTree'

withDefaults(
  defineProps<{
    repo: string
    title: string
    number?: number
    url?: string
    state?: string
    labels?: Label[]
    meta?: string[]
    loading?: boolean
    /** Offer "Chat about this". */
    chat?: boolean
    /** For a file or a folder: the way up to the repository, shown as the title. */
    crumbs?: Crumb[]
    /** The version the crumbs are at, beside them. */
    refLabel?: string
    /** The file tree panel is open. */
    tree?: boolean
  }>(),
  {
    number: undefined,
    url: undefined,
    state: undefined,
    labels: () => [],
    meta: () => [],
    crumbs: undefined,
    refLabel: undefined,
  }
)

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'browser'): void
  (e: 'chat'): void
  (e: 'find'): void
  (e: 'search'): void
  (e: 'tree'): void
  (e: 'open', url: string, pane: PaneType | false): void
}>()

/** The states that mean "still going": the ones worth drawing the eye to. */
const accentStates = ['open', 'draft']
</script>

<style lang="scss">
.abele-github-header {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding-bottom: var(--size-4-3);
  border-bottom: 1px solid var(--background-modifier-border);
  margin-bottom: var(--size-4-3);

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-2);
  }

  &__repo {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    overflow-wrap: anywhere;
  }

  &__actions {
    display: flex;
    gap: var(--size-4-1);
    flex-shrink: 0;
  }

  &__title {
    margin: 0;
    font-size: var(--h2-size);
    font-weight: var(--h2-weight);
    line-height: var(--line-height-tight);
    overflow-wrap: anywhere;
  }

  // A path reads as a path, not as a headline.
  &__title .abele-github-crumbs {
    font-size: var(--font-ui-large);
  }

  &__number {
    color: var(--text-faint);
    font-weight: var(--font-normal);
  }

  &__badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-1);
  }

  &__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-1) var(--size-4-3);
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    overflow-wrap: anywhere;
  }
}
</style>
