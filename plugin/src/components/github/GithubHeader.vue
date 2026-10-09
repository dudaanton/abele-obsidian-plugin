<template>
  <header ref="root" class="abele-github-header" :class="{ 'abele-github-header_path': crumbs }">
    <div class="abele-github-header__top">
      <div class="abele-github-header__repo">{{ crumbs ? '' : repo }}</div>
      <div class="abele-github-header__actions">
        <Icon
          v-bind="nativeAction"
          @keydown.enter.prevent="emit('tree')"
          @keydown.space.prevent="emit('tree')"
          icon="folder-tree"
          :active="tree"
          :tooltip="tree ? 'Hide the file tree' : 'Show the repository\'s files beside this'"
          @click="emit('tree')"
        />
        <Icon
          v-bind="nativeAction"
          @keydown.enter.prevent="emit('swap')"
          @keydown.space.prevent="emit('swap')"
          v-if="swap"
          icon="arrow-left-right"
          tooltip="Swap base and head: what base has that head has not"
          @click="emit('swap')"
        />
        <Icon
          v-bind="nativeAction"
          icon="search"
          tooltip="Find in this tab (Mod+F)"
          @click="emit('find')"
          @keydown.enter.prevent="emit('find')"
          @keydown.space.prevent="emit('find')"
        />
        <Icon
          v-bind="nativeAction"
          @keydown.enter.prevent="emit('search')"
          @keydown.space.prevent="emit('search')"
          icon="file-search"
          tooltip="Search the code: this change, the whole repository, or file names"
          @click="emit('search')"
        />
        <Icon
          v-bind="nativeAction"
          @keydown.enter.prevent="emit('chat')"
          @keydown.space.prevent="emit('chat')"
          v-if="chat"
          icon="message-square-plus"
          tooltip="Chat about this: a new chat with a link to it in the input"
          @click="emit('chat')"
        />
        <Icon
          v-bind="nativeAction"
          @keydown.enter.prevent="loading || emit('refresh')"
          @keydown.space.prevent="loading || emit('refresh')"
          icon="refresh-cw"
          :tooltip="node ? 'Refresh from the node' : 'Load again from GitHub'"
          :disabled="loading"
          @click="emit('refresh')"
        />
        <Icon
          v-bind="nativeAction"
          @keydown.enter.prevent="emit('browser')"
          @keydown.space.prevent="emit('browser')"
          v-if="url"
          icon="external-link"
          tooltip="Open this on GitHub in the browser"
          @click="emit('browser')"
        />
      </div>
    </div>
    <h2 ref="path" class="abele-github-header__title">
      <GithubBreadcrumbs
        v-if="crumbs"
        :crumbs="crumbs"
        :ref-label="refLabel"
        @open="(url: string, pane: PaneType | false) => emit('open', url, pane)"
      />
      <template v-else>{{ title }}</template>
      <span v-if="number" class="abele-github-header__number">#{{ number }}</span>
    </h2>
    <div class="abele-github-header__details">
      <slot name="file-actions" />
      <div v-if="state || labels?.length" class="abele-github-header__badges">
        <Badge v-if="state" :text="state" :accent="accentStates.includes(state)" />
        <Badge v-for="label in labels" :key="label.name" :text="label.name" />
      </div>
      <div v-if="meta.length" class="abele-github-header__meta">
        <span v-for="(part, i) in meta" :key="i">
          <template v-if="typeof part === 'string'">{{ part }}</template>
          <template v-else>
            <GithubUser :login="part.login" :avatar="part.avatar" />
            <template v-if="part.after">{{ ` ${part.after}` }}</template>
          </template>
        </span>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRepositorySource } from '@/repository/context'
import { useResizeObserver } from '@vueuse/core'
import Icon from '../obsidian/Icon.vue'
import Badge from '../obsidian/Badge.vue'
import GithubBreadcrumbs from './GithubBreadcrumbs.vue'
import GithubUser from './GithubUser.vue'
import type { PaneType } from 'obsidian'
import type { Label } from '@/github/api'
import type { Crumb } from '@/github/tree/fileTree'
import type { MetaPart } from '@/github/itemHead'

withDefaults(
  defineProps<{
    repo: string
    title: string
    number?: number
    url?: string
    state?: string
    labels?: Label[]
    /** The details under the title; a person is drawn with their name and picture. */
    meta?: MetaPart[]
    loading?: boolean
    /** Offer "Chat about this". */
    chat?: boolean
    /** For a file or a folder: the way up to the repository, shown as the title. */
    crumbs?: Crumb[]
    /** The version the crumbs are at, beside them. */
    refLabel?: string
    /** The file tree panel is open. */
    tree?: boolean
    /** Offer to swap a comparison's two sides. */
    swap?: boolean
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

const source = useRepositorySource()
const node = computed(() => source.value?.identity.provider === 'node')
const nativeAction = computed(() =>
  node.value ? { class: 'clickable-icon', role: 'button', tabindex: 0 } : {}
)

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'browser'): void
  (e: 'chat'): void
  (e: 'find'): void
  (e: 'search'): void
  (e: 'tree'): void
  (e: 'swap'): void
  (e: 'open', url: string, pane: PaneType | false): void
}>()

// Only the path obscures a line jump, including when it wraps or theme fonts change.
const root = ref<HTMLElement>()
const path = ref<HTMLElement>()
useResizeObserver(path, () => {
  const head = root.value
  head?.parentElement?.style.setProperty(
    '--abele-github-header-height',
    `${path.value?.getBoundingClientRect().height ?? 0}px`
  )
})

/** The states that mean "still going": the ones worth drawing the eye to. */
const accentStates = ['open', 'draft']
</script>

<style lang="scss">
// A file or folder pins just its path. The header has no containing box here, so the
// path's sticky range is the document, not the short-lived controls above and below it.
.abele-github-header.abele-github-header_path {
  display: contents;

  > .abele-github-header__title {
    position: sticky;
    // The tab scroller has theme padding; pin against its edge, not below that padding.
    top: calc(-1 * var(--size-4-3));
    z-index: 1;
    background: var(--background-primary);
    padding-block: var(--size-4-2);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  > .abele-github-header__details {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }
}

.abele-github:has(> .abele-github-header_path) {
  .cm-line,
  .abele-github-md__block {
    scroll-margin-top: calc(var(--abele-github-header-height, 0px) + var(--size-4-2));
  }
}

.abele-github-header {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding-bottom: var(--size-4-3);
  border-bottom: 1px solid var(--background-modifier-border);
  margin-bottom: var(--size-4-3);

  &__details {
    display: contents;
  }

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
