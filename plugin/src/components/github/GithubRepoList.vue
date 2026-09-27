<template>
  <section class="abele-github-home-list" :data-list="list">
    <div class="abele-github-home-list__head">
      <FoldHeading :text="title" />
      <Button
        v-if="allUrl"
        class="abele-github-home__all"
        text="All"
        :tooltip="allTooltip ?? 'Open the whole list on GitHub in the browser'"
        @click="openAll"
      />
    </div>
    <div v-if="error" class="abele-github-home-list__error">
      <EmptyState :text="error" />
      <Icon icon="refresh-cw" tooltip="Ask GitHub again" @click="emit('retry')" />
    </div>
    <EmptyState v-else-if="rows === null" text="Loading…" />
    <EmptyState v-else-if="!rows.length" :text="empty" />
    <div v-else class="abele-github-home-list__rows" role="tree" :aria-label="title">
      <TreeItem
        v-for="row in rows"
        :key="row.key"
        :text="row.text"
        :icon="row.icon"
        :flair="row.flair"
        :path="row.url"
        @click="open(row, $event)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PaneType } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import FoldHeading from '../obsidian/FoldHeading.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import { paneForClick } from '@/github/links'

export interface ListRow {
  key: string
  text: string
  icon: string
  flair?: string
  url: string
  /** Opens in the browser rather than a tab — a release, which no tab shows. */
  external?: boolean
}

/**
 * One of the short lists on a repository's front page — its freshest open pull requests, its
 * issues, its latest release — with the way to the whole list beside the title. A row opens by
 * the clicks of any link here: plain by the tab rule, Mod in a new tab, Alt in the browser.
 */
const props = defineProps<{
  /** Which list, for finding it again: `pulls`, `issues`, `release`. */
  list: string
  title: string
  /** Null while it loads. */
  rows: ListRow[] | null
  error?: string | null
  /** What an empty list says. */
  empty: string
  /** The whole list, on GitHub. */
  allUrl?: string
  allTooltip?: string
  /** The whole list is GitHub's only — releases — and opens in the browser. */
  allExternal?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
  (e: 'retry'): void
}>()

/** The whole list in a tab of its own, by the clicks of any link here; GitHub's for releases. */
const openAll = (event?: MouseEvent) => {
  if (!props.allUrl) return
  const pane = event ? paneForClick(event, false) : false
  if (pane === null || props.allExternal) window.open(props.allUrl)
  else emit('open', props.allUrl, pane)
}

const open = (row: ListRow, event: MouseEvent) => {
  const pane = paneForClick(event, false)
  if (pane === null || row.external) window.open(row.url)
  else emit('open', row.url, pane)
}
</script>

<style lang="scss">
.abele-github-home-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  min-width: 0;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-2);
  }

  &__error {
    display: flex;
    align-items: flex-start;
    gap: var(--size-4-2);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  // A flat list folds nothing: its rows need no room for the arrow a tree keeps at their start.
  &__rows .tree-item-self {
    padding-inline-start: var(--size-4-2);
  }

  // A title runs to as many lines as it needs rather than off the edge of a narrow column.
  &__rows .abele-tree-item__text {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
</style>
