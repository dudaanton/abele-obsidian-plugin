<template>
  <header
    ref="root"
    class="abele-github-header"
    :class="{ 'abele-github-header_path': crumbs, 'abele-github-header_file': pinActions }"
  >
    <div class="abele-github-header__top">
      <DrawerViewSwitch
        icon="github"
        :name="
          native ? t('settings.GithubSettings.git_hosting.a3002011') : t('streamB.github.f911e4')
        "
      />
      <div v-if="$slots.controls" class="abele-github-header__controls">
        <slot name="controls" />
      </div>
      <div v-else class="abele-github-header__repo" :title="crumbs ? undefined : repo">
        {{ crumbs ? '' : repo }}
      </div>
      <div class="abele-github-header__actions">
        <!-- What the page itself offers (a file's blame), first in the row. -->
        <slot name="actions" />
        <Icon
          v-if="!node"
          v-bind="nativeAction"
          icon="folder-tree"
          :active="tree"
          :tooltip="
            tree
              ? t('streamB.hideTheFileTree.0da55e')
              : t('streamB.showTheRepositorySFilesBesideThis.e1d212')
          "
          @keydown.enter.prevent="emit('tree')"
          @keydown.space.prevent="emit('tree')"
          @click="emit('tree')"
        />
        <Icon
          v-if="swap"
          v-bind="nativeAction"
          icon="arrow-left-right"
          :tooltip="t('streamB.swapBaseAndHeadWhatBaseHas.b665db')"
          @keydown.enter.prevent="emit('swap')"
          @keydown.space.prevent="emit('swap')"
          @click="emit('swap')"
        />
        <Icon
          v-if="compare"
          v-bind="nativeAction"
          icon="git-compare"
          :tooltip="t('streamB.compareAgainstABranchTagOrCommit.23b381')"
          @keydown.enter.prevent="emit('compare')"
          @keydown.space.prevent="emit('compare')"
          @click="emit('compare')"
        />
        <Icon
          v-bind="nativeAction"
          icon="search"
          :tooltip="t('streamB.findInThisTabModF.de7869')"
          @click="emit('find')"
          @keydown.enter.prevent="emit('find')"
          @keydown.space.prevent="emit('find')"
        />
        <Icon
          v-bind="nativeAction"
          icon="file-search"
          :tooltip="t('streamB.searchTheCodeThisChangeTheWhole.b06270')"
          @keydown.enter.prevent="emit('search')"
          @keydown.space.prevent="emit('search')"
          @click="emit('search')"
        />
        <Icon
          v-if="chat"
          v-bind="nativeAction"
          icon="message-square-plus"
          :tooltip="t('streamB.chatAboutThisANewChatWith.a3e982')"
          @keydown.enter.prevent="emit('chat')"
          @keydown.space.prevent="emit('chat')"
          @click="emit('chat')"
        />
        <Icon
          v-bind="nativeAction"
          icon="refresh-cw"
          :tooltip="
            node
              ? t('streamB.refreshFromTheNode.dade74')
              : native
                ? t('settings.git.reloadService')
                : t('streamB.loadAgainFromGithub.2429ac')
          "
          :disabled="loading"
          @keydown.enter.prevent="loading || emit('refresh')"
          @keydown.space.prevent="loading || emit('refresh')"
          @click="emit('refresh')"
        />
        <Icon
          v-if="url"
          v-bind="nativeAction"
          icon="external-link"
          :tooltip="
            native
              ? t('settings.git.openBrowser')
              : t('streamB.openThisOnGithubInTheBrowser.c80abc')
          "
          @keydown.enter.prevent="emit('browser')"
          @keydown.space.prevent="emit('browser')"
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
        <!-- The state as a dot of GitHub's own meaning, the labels as words with their colour. -->
        <span v-if="state" class="abele-github-header__state">
          <StatusDot
            :tone="stateTone(state)"
            :label="t('streamB.state.2a3ddf', { v0: String(streamBLabel(state)) })"
          />{{ streamBLabel(state) }}
        </span>
        <span
          v-for="label in labels"
          :key="label.name"
          class="abele-github-header__label"
          :style="label.color ? { '--abele-github-label-color': `#${label.color}` } : undefined"
          >{{ label.name }}</span
        >
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
import { t } from '@/i18n'
import { streamBLabel } from '@/i18n/streamBLabels'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import { isNativeForge } from '@/forge/native'
import { computed, ref } from 'vue'
import { useRepositorySource } from '@/repository/context'
import { useResizeObserver } from '@vueuse/core'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import GithubBreadcrumbs from './GithubBreadcrumbs.vue'
import GithubUser from './GithubUser.vue'
import type { PaneType } from 'obsidian'
import type { Label } from '@/github/api'
import type { Crumb } from '@/github/tree/fileTree'
import type { MetaPart } from '@/github/itemHead'

const props = withDefaults(
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
    /** Offer to pin a version to compare the repository's files against. */
    compare?: boolean
    /** A file keeps its actions and path visible together while reading. */
    pinActions?: boolean
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
const native = computed(() => isNativeForge(source.value?.identity.provider))
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
  (e: 'compare'): void
  (e: 'open', url: string, pane: PaneType | false): void
}>()

// Measure the pinned area, including wrapped actions and theme font changes.
const root = ref<HTMLElement>()
const path = ref<HTMLElement>()
useResizeObserver(
  computed(() => (props.pinActions ? root.value : path.value)),
  () => {
    const head = root.value
    head?.parentElement?.style.setProperty(
      '--abele-github-header-height',
      `${(props.pinActions ? head : path.value)?.getBoundingClientRect().height ?? 0}px`
    )
  }
)

/** GitHub's own colours for a state: open green, merged in the accent, closed red, draft grey. */
const stateTone = (state: string) =>
  state === 'open' ? 'green' : state === 'merged' ? 'accent' : state === 'closed' ? 'red' : 'faint'
</script>

<style lang="scss">
// A page's own glyphs stand in the row as its siblings do.
.abele-github-header__page-glyphs {
  display: contents;
}

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

.abele-github-header.abele-github-header_file {
  display: flex;
  position: sticky;
  top: calc(-1 * var(--size-4-3));
  z-index: 2;
  background: var(--background-primary);

  > .abele-github-header__title {
    position: static;
    border-bottom: none;
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

  &__controls {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
  }

  // One line: the tab's title already says the whole name when it is cut.
  &__repo {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__actions {
    display: flex;
    gap: var(--size-4-1);
    // A file can offer more glyphs than a phone can hold on one line.
    min-width: 0;
    flex-shrink: 1;
    flex-wrap: wrap;
    justify-content: flex-end;
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

  // The template drops the space between the title and its number; it is given back here.
  &__number {
    margin-inline-start: var(--size-2-3);
    color: var(--text-faint);
    font-weight: var(--font-normal);
  }

  &__badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-3);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  &__state {
    display: inline-flex;
    align-items: center;
    gap: var(--size-2-2);
  }

  &__label {
    white-space: nowrap;

    &::before {
      content: '';
      display: inline-block;
      width: var(--size-2-3);
      height: var(--size-2-3);
      margin-inline-end: var(--size-2-2);
      border-radius: 50%;
      vertical-align: middle;
      background-color: var(--abele-github-label-color, var(--text-faint));
    }
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
// Keep the repository and its navigation together; truncate the label before wrapping actions.
body.is-phone .abele-github:not(.abele-github_node) {
  .abele-github-header__repo {
    flex-basis: 0;
  }
  .abele-github-header__actions {
    flex-wrap: nowrap;
    flex-shrink: 0;
    gap: 0;
  }
  .abele-github-header_path .abele-github-header__repo {
    display: none;
  }
}
</style>
