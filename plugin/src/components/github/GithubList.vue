<template>
  <div class="abele-github-list">
    <div class="abele-github-list__search">
      <Input
        v-model="draft"
        class="abele-github-list__query"
        :placeholder="DEFAULT_QUERY[target.list]"
        @keydown.enter.prevent="apply(draft)"
      />
      <Button text="Search" tooltip="List what this query finds" @click="apply(draft)" />
      <Icon
        v-if="target.query !== DEFAULT_QUERY[target.list]"
        icon="rotate-ccw"
        tooltip="Back to the list GitHub starts with"
        @click="apply(DEFAULT_QUERY[target.list])"
      />
    </div>

    <Tabs
      :model-value="state"
      :tabs="stateTabs"
      level="secondary"
      class="abele-github-list__states"
      @update:model-value="(s: string) => apply(withState(target.query, s as ListState))"
    />

    <div class="abele-github-list__filters">
      <label class="abele-github-list__filter">
        <span>Author</span>
        <Input
          :model-value="one('author')"
          placeholder="login"
          @change="(e: Event) => set('author', (e.target as HTMLInputElement).value)"
          @keydown.enter.prevent="
            (e: KeyboardEvent) => set('author', (e.target as HTMLInputElement).value)
          "
        />
      </label>
      <label v-if="target.list !== 'discussions'" class="abele-github-list__filter">
        <span>Assignee</span>
        <Input
          :model-value="one('assignee')"
          placeholder="login"
          @change="(e: Event) => set('assignee', (e.target as HTMLInputElement).value)"
          @keydown.enter.prevent="
            (e: KeyboardEvent) => set('assignee', (e.target as HTMLInputElement).value)
          "
        />
      </label>
      <label v-if="choices.labels.length" class="abele-github-list__filter">
        <span>Label</span>
        <Dropdown
          :options="optionsOf(choices.labels, 'Any label')"
          :model-value="one('label')"
          @update:model-value="(v: string) => set('label', v)"
        />
      </label>
      <label v-if="choices.milestones.length" class="abele-github-list__filter">
        <span>Milestone</span>
        <Dropdown
          :options="optionsOf(choices.milestones, 'Any milestone')"
          :model-value="one('milestone')"
          @update:model-value="(v: string) => set('milestone', v)"
        />
      </label>
      <label v-if="target.list === 'pulls'" class="abele-github-list__filter">
        <span>Review</span>
        <Dropdown
          :options="[
            { value: '', display: 'Any review' },
            ...REVIEWS.map((r) => ({ value: r.value, display: r.label })),
          ]"
          :model-value="one('review')"
          @update:model-value="(v: string) => set('review', v)"
        />
      </label>
      <label v-if="target.list === 'pulls'" class="abele-github-list__filter">
        <span>Draft</span>
        <Dropdown
          :options="[
            { value: '', display: 'Drafts and ready' },
            { value: 'true', display: 'Drafts only' },
            { value: 'false', display: 'Ready only' },
          ]"
          :model-value="one('draft')"
          @update:model-value="(v: string) => set('draft', v)"
        />
      </label>
      <label v-if="choices.categories.length" class="abele-github-list__filter">
        <span>Category</span>
        <Dropdown
          :options="optionsOf(choices.categories, 'Any category')"
          :model-value="one('category')"
          @update:model-value="(v: string) => set('category', v)"
        />
      </label>
      <label v-if="target.list === 'discussions'" class="abele-github-list__filter">
        <span>Answer</span>
        <Dropdown
          :options="[
            { value: '', display: 'Answered or not' },
            { value: 'answered', display: 'Answered' },
            { value: 'unanswered', display: 'Unanswered' },
          ]"
          :model-value="answered"
          @update:model-value="
            (v: string) =>
              apply(setQualifier(target.query, 'is', v || null, ['answered', 'unanswered']))
          "
        />
      </label>
      <label class="abele-github-list__filter">
        <span>Sort</span>
        <Dropdown
          :options="SORTS.map((s) => ({ value: s.id, display: s.label }))"
          :model-value="sortId"
          @update:model-value="(v: string) => set('sort', v === 'created-desc' ? '' : v)"
        />
      </label>
    </div>

    <EmptyState v-if="!items.length" :text="emptyText" />
    <div v-else class="abele-github-list__rows" role="list">
      <GithubListRow
        v-for="item in items"
        :key="item.url"
        :item="item"
        @open="(url: string, pane: PaneType | false) => emit('open', url, pane)"
      />
    </div>
    <div v-if="moreError" class="abele-github-list__more-error">
      <EmptyState :text="moreError" />
      <Button
        text="Try again"
        icon="refresh-cw"
        tooltip="Ask GitHub for the next page again"
        @click="more"
      />
    </div>
    <div v-else-if="next !== null" ref="sentinel" class="abele-github-list__more">
      <Button
        :text="loadingMore ? 'Loading…' : `Show more (${items.length} of ${shownTotal})`"
        :disabled="loadingMore"
        tooltip="Ask GitHub for the next page"
        @click="more"
      />
    </div>
    <div v-else-if="data.total > SEARCH_CAP_SHOWN" class="abele-github-list__cap">
      GitHub's search shows the first thousand; narrow the query to see the rest.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { PaneType } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import Tabs from '../obsidian/Tabs.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import GithubListRow from './GithubListRow.vue'
import type { GithubClient } from '@/github/client'
import type { GithubTarget } from '@/github/urls'
import {
  loadChoices,
  loadMore,
  listUrl,
  type ListChoices,
  type ListData,
  type ListItem,
} from '@/github/lists/listData'
import {
  DEFAULT_QUERY,
  REVIEWS,
  SORTS,
  qualifier,
  setQualifier,
  sortOf,
  stateOf,
  withState,
  type ListState,
} from '@/github/lists/listQuery'

type ListTarget = Extract<GithubTarget, { kind: 'list' }>

/**
 * A repository's pull requests, issues or discussions for a query, as GitHub lists them: the
 * query in GitHub's own syntax on top — the one source of truth — the open and closed counts, the
 * filters that rewrite the query, and the rows, a page at a time as the list is scrolled. A change
 * of query is a new address for the tab, so the back arrow returns to the list before.
 */
const props = defineProps<{
  target: ListTarget
  /** The first page, as the tab loaded it. */
  data: ListData
  client: GithubClient
}>()

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
}>()

const SEARCH_CAP_SHOWN = 1000

const draft = ref(props.target.query)
watch(
  () => props.target.query,
  (q) => (draft.value = q)
)

/** A new query: the tab follows the list's address for it, as GitHub's own page does. */
const apply = (query: string) => {
  const q = query.trim().replace(/\s+/g, ' ')
  if (q === props.target.query) return
  emit('open', listUrl(props.target, q), false)
}

const one = (key: string) => qualifier(props.target.query, key)[0] ?? ''
const set = (key: string, value: string) =>
  apply(setQualifier(props.target.query, key, value.trim() || null))

const state = computed(() => stateOf(props.target.query))
const answered = computed(() => {
  const is = qualifier(props.target.query, 'is').map((v) => v.toLowerCase())
  return is.includes('answered') ? 'answered' : is.includes('unanswered') ? 'unanswered' : ''
})
const sortId = computed(() => {
  const { sort, order } = sortOf(props.target.query)
  return `${sort}-${order}`
})

const count = (n: number | null) => (n === null ? '' : ` ${n.toLocaleString()}`)
const stateTabs = computed(() => [
  { id: 'open', label: `Open${count(props.data.counts.open)}`, icon: 'circle-dot' },
  { id: 'closed', label: `Closed${count(props.data.counts.closed)}`, icon: 'circle-check' },
  ...(props.target.list === 'pulls' ? [{ id: 'merged', label: 'Merged', icon: 'git-merge' }] : []),
  { id: 'all', label: 'All', icon: 'list' },
])

const optionsOf = (values: string[], any: string) => [
  { value: '', display: any },
  ...values.map((v) => ({ value: v, display: v })),
]

const choices = shallowRef<ListChoices>({ labels: [], milestones: [], categories: [] })
watch(
  () => `${props.target.host}/${props.target.owner}/${props.target.repo}/${props.target.list}`,
  () => {
    choices.value = { labels: [], milestones: [], categories: [] }
    void loadChoices(props.client, props.target).then((c) => (choices.value = c))
  },
  { immediate: true }
)

// The rows: the first page as loaded, then each page after it as it arrives.
const items = shallowRef<ListItem[]>([])
const next = ref<number | string | null>(null)
const moreError = ref<string | null>(null)
const loadingMore = ref(false)
watch(
  () => props.data,
  (d) => {
    items.value = d.items
    next.value = d.next
    moreError.value = null
  },
  { immediate: true }
)
const shownTotal = computed(() => Math.min(props.data.total, SEARCH_CAP_SHOWN).toLocaleString())

const emptyText = computed(() =>
  props.target.list === 'pulls'
    ? 'No pull requests match this query.'
    : props.target.list === 'issues'
      ? 'No issues match this query.'
      : 'No discussions match this query.'
)

const more = async () => {
  const from = next.value
  if (from === null || loadingMore.value) return
  const data = props.data
  loadingMore.value = true
  moreError.value = null
  try {
    const page = await loadMore(props.client, props.target, from)
    // Another query came meanwhile; its own first page is what is shown.
    if (props.data !== data) return
    items.value = [...items.value, ...page.items]
    next.value = page.next
  } catch (e) {
    if (props.data === data)
      moreError.value = e instanceof Error ? e.message : 'GitHub could not be asked.'
  } finally {
    loadingMore.value = false
  }
}

// The next page is asked for as the end of the list comes into view.
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | null = null
watch(sentinel, (el) => {
  observer?.disconnect()
  observer = null
  const Observer = el?.ownerDocument.defaultView?.IntersectionObserver
  if (!el || !Observer) return
  observer = new Observer((entries) => {
    if (entries.some((e) => e.isIntersecting)) void more()
  })
  observer.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<style lang="scss">
.abele-github-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);

  &__search {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
  }

  &__query {
    flex: 1 1 auto;
    font-family: var(--font-monospace);
  }

  &__filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4-2) var(--size-4-3);
  }

  &__filter {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
    min-width: 0;
    flex: 1 1 calc(var(--size-4-18) * 2);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  &__rows {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
  }

  &__more,
  &__more-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--size-4-2);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  &__cap {
    color: var(--text-faint);
    font-size: var(--font-ui-small);
    text-align: center;
  }
}
</style>
