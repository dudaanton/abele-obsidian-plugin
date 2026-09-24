<template>
  <div ref="root" class="abele-github">
    <EmptyState v-if="!enabled">
      The GitHub integration is off. Turn it on in Abele settings → GitHub.
    </EmptyState>

    <div v-else-if="!target" class="abele-github__fallback">
      <EmptyState text="This is not a GitHub link a tab here can show." />
      <Button
        v-if="model.url"
        text="Open in browser"
        icon="external-link"
        tooltip="Open the link in the browser instead"
        @click="openInBrowser(model.url)"
      />
    </div>

    <template v-else>
      <GithubFindBar
        v-if="tabSearch.findOpen.value && root"
        ref="findBar"
        :root="root"
        :hooks="tabSearch.finderHooks"
        @close="tabSearch.findOpen.value = false"
      />
      <GithubHeader
        :repo="`${target.owner}/${target.repo}`"
        :title="head.title"
        :number="head.number"
        :url="browserUrl"
        :state="head.state"
        :labels="head.labels"
        :meta="head.meta"
        :loading="main.loading.value"
        :chat="!!model.screen.link && linker.canAsk()"
        @refresh="reload"
        @browser="openInBrowser(browserUrl)"
        @chat="chatAbout"
        @find="showFind"
        @search="tabSearch.openSearch"
      />

      <!-- Kept while the tab follows a result, so the next result is still there to take. -->
      <GithubCodeSearch
        v-if="tabSearch.searchOpen.value"
        :code="tabSearch.code"
        :ready="!!main.data.value"
        :has-changes="tabSearch.hasChanges.value"
        :request="tabSearch.searchRequest.value"
        @open="(url: string, newTab: boolean) => props.onOpen?.(url, newTab ? 'tab' : false)"
        @close="tabSearch.searchOpen.value = false"
      />

      <div v-if="main.error.value" class="abele-github__error">
        <EmptyState :text="main.error.value" />
        <Button text="Try again" icon="refresh-cw" tooltip="Ask GitHub again" @click="reload" />
      </div>
      <EmptyState v-else-if="!main.data.value" text="Loading from GitHub…" />

      <template v-else-if="shown.kind === 'issue' && issue">
        <GithubThread
          :author="issue.author"
          :created-at="issue.createdAt"
          :body="issue.body"
          :comments="issue.comments"
          :anchor="anchor"
          :incomplete="!issue.commentsComplete"
          :problem="issue.commentsProblem"
          :retrying="conversationRetrying"
          @retry="retryConversation"
        />
      </template>

      <template v-else-if="shown.kind === 'discussion' && discussion">
        <GithubThread
          :author="discussion.author"
          :created-at="discussion.createdAt"
          :body="discussion.body"
          :comments="discussion.comments"
          :anchor="anchor"
          :missing="discussion.totalComments - discussion.comments.length"
        />
      </template>

      <template v-else-if="shown.kind === 'pull' && pull">
        <Tabs v-model="pullTab" :tabs="pullTabs" level="secondary" class="abele-github__tabs" />
        <GithubThread
          v-if="pullTab === 'conversation'"
          :author="pull.author"
          :created-at="pull.createdAt"
          :body="pull.body"
          :comments="pull.comments"
          :anchor="anchor"
          :incomplete="!pull.commentsComplete"
          :problem="pull.commentsProblem"
          :retrying="conversationRetrying"
          @retry="retryConversation"
        />
        <template v-else-if="pullTab === 'files'">
          <div v-if="files.error.value" class="abele-github__error">
            <EmptyState :text="files.error.value" />
            <Button
              text="Try again"
              icon="refresh-cw"
              tooltip="Ask GitHub again"
              @click="files.load"
            />
          </div>
          <EmptyState v-else-if="!files.data.value" text="Loading the changed files…" />
          <template v-else>
            <GithubNotice
              v-if="files.data.value.reviewCommentsProblem"
              :text="files.data.value.reviewCommentsProblem"
              :busy="files.loading.value"
              @retry="files.load"
            />
            <GithubFiles
              :files="files.data.value.files"
              :complete="files.data.value.complete"
              :anchor="fileAnchor"
              :comment-anchor="anchor"
            />
          </template>
        </template>
        <template v-else>
          <div v-if="commits.error.value" class="abele-github__error">
            <EmptyState :text="commits.error.value" />
            <Button
              text="Try again"
              icon="refresh-cw"
              tooltip="Ask GitHub again"
              @click="commits.load"
            />
          </div>
          <EmptyState v-else-if="!commits.data.value" text="Loading the commits…" />
          <div v-else class="abele-github__commits">
            <Card
              v-for="c in commits.data.value"
              :key="c.sha"
              :title="splitMessage(c.message).title"
              :subtitle="`${c.sha.slice(0, 7)} · ${c.author} · ${formatDate(c.date)}`"
              icon="git-commit-horizontal"
              clickable
              @click="openCommit(c.sha)"
            />
          </div>
        </template>
      </template>

      <template v-else-if="shown.kind === 'commit' && commit">
        <GithubText
          v-if="splitMessage(commit.message).body && repo"
          class="abele-github__message"
          :text="splitMessage(commit.message).body"
          :repo="repo"
          as-document
        />
        <GithubFiles :files="commit.files" :anchor="fileAnchor" />
      </template>

      <template v-else-if="shown.kind === 'blob' && blob">
        <GithubBlob
          :text="blob.text"
          :file="blobFile!"
          :range="blobRange"
          :plain="blobPlain"
          :mode="model.mode"
          :client="client()"
          @mode="setMode"
          @open="(url: string) => onOpen?.(url)"
        />
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Button from '../obsidian/Button.vue'
import Tabs from '../obsidian/Tabs.vue'
import Card from '../obsidian/Card.vue'
import GithubText from './GithubText.vue'
import GithubHeader from './GithubHeader.vue'
import GithubThread from './GithubThread.vue'
import GithubFiles from './GithubFiles.vue'
import GithubBlob from './GithubBlob.vue'
import GithubNotice from './GithubNotice.vue'
import GithubFindBar from './GithubFindBar.vue'
import GithubCodeSearch from './GithubCodeSearch.vue'
import type { PaneType } from 'obsidian'
import { useTabSearch } from '@/github/search/useTabSearch'
import type { GithubViewModel } from '@/github/model'
import { anchorSlug, type RepoFile } from '@/github/markdownLinks'
import type { BlobMode } from '@/github/markdownPreview'
import type { GithubClient } from '@/github/client'
import { targetKey, shortName, type GithubTarget } from '@/github/urls'
import { formatDate, splitMessage } from '@/github/format'
import { useLoad } from '@/github/useLoad'
import { elementTop, pinIntoView } from '@/github/scrollTo'
import { LINKER, createLinker } from '@/github/linking'
import { SCREEN } from '@/github/screen'
import { GITHUB_REPO } from '@/github/repoContext'
import { bodyLink, type GithubLink } from '@/github/permalinks'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  loadBlob,
  loadCommit,
  loadDiscussion,
  loadIssue,
  loadIssueConversation,
  loadPull,
  loadPullCommits,
  loadPullConversation,
  loadPullFiles,
  type BlobData,
  type CommitData,
  type DiscussionData,
  type IssueData,
  type Label,
  type PullData,
} from '@/github/api'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

const props = defineProps<{
  model: GithubViewModel
  enabled: boolean
  clientFor: (host: string) => GithubClient
  /** Tells the tab its name once the item's title is known. */
  onTitle?: (title: string) => void
  /** Opens another GitHub URL: by the usual rule, or in a new tab, split or window. */
  onOpen?: (url: string, pane?: PaneType | false) => void
  /** Moves each time Mod+F is pressed in the tab. */
  keys?: { find: number }
  /** The tab's state changed in a way worth saving: the file view was switched. */
  onState?: () => void
}>()

const root = ref<HTMLElement>()
const target = computed(() => props.model.target)

/**
 * What is actually on screen. An issue link whose number turns out to be a pull request is shown
 * as the pull request, the way GitHub redirects it.
 */
const promoted = ref<Of<'pull'> | null>(null)
const shown = computed<GithubTarget>(() => promoted.value ?? target.value)

const client = () => props.clientFor(target.value.host)

const main = useLoad<IssueData | PullData | DiscussionData | CommitData | BlobData>(async () => {
  const t = target.value
  switch (t.kind) {
    case 'issue': {
      const issue = await loadIssue(client(), t)
      if (!issue.isPull) return issue
      promoted.value = { ...t, kind: 'pull', tab: 'conversation' }
      return loadPull(client(), promoted.value)
    }
    case 'pull':
      return loadPull(client(), t)
    case 'discussion':
      return loadDiscussion(client(), t)
    case 'commit':
      return loadCommit(client(), t)
    case 'blob':
      return loadBlob(client(), t)
  }
})

const files = useLoad(() => loadPullFiles(client(), shown.value as Of<'pull'>))
const commits = useLoad(() => loadPullCommits(client(), shown.value as Of<'pull'>))

// Find in the tab, code search and go to definition.
const findBar = ref<InstanceType<typeof GithubFindBar>>()
const tabSearch = useTabSearch({
  root,
  shown,
  data: () => main.data.value,
  files,
  client,
  open: (url, pane) => props.onOpen?.(url, pane),
})
/** Opens the find bar, or puts the cursor back in it with its query selected. */
const showFind = async () => {
  tabSearch.openFind()
  await nextTick()
  findBar.value?.focus()
}
watch(() => props.keys?.find, showFind)

const issue = computed(() => (shown.value.kind === 'issue' ? (main.data.value as IssueData) : null))
const pull = computed(() => (shown.value.kind === 'pull' ? (main.data.value as PullData) : null))
const discussion = computed(() =>
  shown.value.kind === 'discussion' ? (main.data.value as DiscussionData) : null
)
const commit = computed(() =>
  shown.value.kind === 'commit' ? (main.data.value as CommitData) : null
)
const blob = computed(() => (shown.value.kind === 'blob' ? (main.data.value as BlobData) : null))

const anchor = computed(() => target.value?.anchor)
const fileAnchor = computed(() => {
  const t = target.value
  return t && (t.kind === 'pull' || t.kind === 'commit') ? t.file : undefined
})
const blobRange = computed(() => (target.value?.kind === 'blob' ? target.value.lines : undefined))
const blobPlain = computed(() => (target.value?.kind === 'blob' ? !!target.value.plain : false))
/** The file on screen, for the links and images of its rendered view. */
const blobFile = computed<RepoFile | null>(() => {
  const t = target.value
  const b = blob.value
  if (!t || !b) return null
  return { host: t.host, owner: t.owner, repo: t.repo, ref: b.ref, path: b.path }
})
/** Preview or code: the tab keeps it, so back, forward and a restart come back to it. */
const setMode = (mode: BlobMode) => {
  // The model is the tab's state, which this side writes too.
  props.model.mode = mode
  props.onState?.()
}

const pullTab = ref<'conversation' | 'files' | 'commits'>('conversation')
const pullTabs = computed(() => [
  { id: 'conversation', label: 'Conversation', icon: 'message-square' },
  {
    id: 'files',
    label: pull.value ? `Files (${pull.value.changedFiles})` : 'Files',
    icon: 'file-diff',
  },
  {
    id: 'commits',
    label: pull.value ? `Commits (${pull.value.commitsCount})` : 'Commits',
    icon: 'git-commit-horizontal',
  },
])

/**
 * Asks again for the comments alone, which were refused while the item itself was read, and
 * puts them in place without reloading the rest.
 */
const conversationRetrying = ref(false)
const retryConversation = async () => {
  const data = main.data.value as IssueData | PullData | null
  const t = shown.value
  if (!data || conversationRetrying.value || (t.kind !== 'pull' && t.kind !== 'issue')) return
  conversationRetrying.value = true
  try {
    const conversation =
      t.kind === 'pull'
        ? await loadPullConversation(client(), t)
        : await loadIssueConversation(client(), t)
    // The item was reloaded meanwhile; that load brought its own comments.
    if (main.data.value !== data) return
    main.data.value = {
      ...data,
      comments: conversation.comments,
      commentsComplete: conversation.complete,
      commentsProblem: conversation.problem,
    }
  } finally {
    conversationRetrying.value = false
  }
}

watch(pullTab, (tab) => {
  if (tab === 'files' && !files.data.value && !files.loading.value) void files.load()
  if (tab === 'commits' && !commits.data.value && !commits.loading.value) void commits.load()
})

const browserUrl = computed(() => {
  if (!target.value) return ''
  const data = main.data.value as { url?: string } | null
  // The address the link had, so a line anchor survives; GitHub's own for an item it moved.
  return props.model.url || data?.url || ''
})

/** A commit SHA as GitHub shows one; a branch or a tag as it is. */
const shortRef = (ref: string) => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref)

interface Head {
  title: string
  number?: number
  state?: string
  labels: Label[]
  meta: string[]
}

const head = computed<Head>(() => {
  const t = shown.value
  const data = main.data.value
  const fallback: Head = { title: t ? shortName(t) : '', labels: [], meta: [] }
  if (!t || !data) return fallback

  if (t.kind === 'commit') {
    const c = data as CommitData
    return {
      ...fallback,
      title: splitMessage(c.message).title,
      meta: [c.sha.slice(0, 7), c.author, formatDate(c.date), ...(t.pull ? [`in #${t.pull}`] : [])],
    }
  }
  if (t.kind === 'blob') {
    const b = data as BlobData
    return { ...fallback, title: b.path, meta: [`at ${shortRef(b.ref)}`] }
  }

  const item = data as IssueData | PullData | DiscussionData
  const meta = [`${item.author} opened ${formatDate(item.createdAt)}`]
  if (t.kind === 'pull') {
    const p = item as PullData
    meta.push(`${p.head} → ${p.base}`, `+${p.additions} −${p.deletions}`)
  }
  if (t.kind === 'discussion') meta.push((item as DiscussionData).category)
  return {
    title: item.title,
    number: item.number,
    state: item.state,
    labels: item.labels,
    meta: meta.filter(Boolean),
  }
})

// Comments, diffs and the file view make links to themselves through this.
const linker = createLinker({
  app: GlobalStore.getInstance().app,
  shown: () => (target.value ? shown.value : null),
  data: () => main.data.value,
  title: () => head.value.title,
  client,
})
provide(LINKER, linker)

/** The repository shown: comments and messages resolve their relative links and images in it. */
const repo = computed<RepoFile | null>(() => {
  const t = target.value
  return t ? { host: t.host, owner: t.owner, repo: t.repo, ref: 'HEAD', path: '' } : null
})
provide(GITHUB_REPO, repo)

// What is on screen, for an agent to ask about: the diffs and the file view add their part.
const screen = props.model.screen
provide(SCREEN, screen)

/** A link to the item itself — for a file, to the file at the ref it was read at. */
const itemLink = computed<GithubLink | null>(() => {
  const t = shown.value
  const data = main.data.value
  if (!t || !data) return null
  if (t.kind === 'blob') {
    const b = data as BlobData
    const path = b.path.split('/').map(encodeURIComponent).join('/')
    return {
      label: `${t.owner}/${t.repo}@${b.ref} · ${b.path}`,
      url: `https://${t.host}/${t.owner}/${t.repo}/blob/${b.ref}/${path}`,
    }
  }
  const item = linker.item()
  return item ? bodyLink(item, head.value.title) : null
})

watch(
  () => [itemLink.value, head.value.title, main.error.value, pullTab.value, shown.value] as const,
  () => {
    const t = target.value ? shown.value : null
    screen.link = itemLink.value
    screen.title = main.data.value ? head.value.title : ''
    screen.kind = t?.kind ?? ''
    screen.section = t?.kind === 'pull' ? pullTab.value : null
    screen.error = main.error.value ?? ''
  },
  { immediate: true }
)

const chatAbout = () => {
  if (screen.link) void linker.ask(screen.link)
}

const tabTitle = computed(() => {
  const t = shown.value
  if (!t || !main.data.value) return ''
  if (t.kind === 'blob')
    return `${(main.data.value as BlobData).path.split('/').pop()} @ ${shortRef((main.data.value as BlobData).ref)}`
  return `${shortName(t)} ${head.value.title}`
})

watch(tabTitle, (title) => {
  if (title) props.onTitle?.(title)
})

const openInBrowser = (url: string) => {
  if (url) window.open(url)
}

const openCommit = (sha: string) => {
  const t = shown.value
  if (t.kind !== 'pull') return
  props.onOpen?.(`https://${t.host}/${t.owner}/${t.repo}/pull/${t.number}/commits/${sha}`)
}

/**
 * Brings the comment a link pointed at into view, once it is on screen and for as long as what
 * is above it is still settling. A link to a line in a diff is the diff file's to scroll to.
 */
let unpin = () => {}
const scrollToAnchor = async () => {
  // A heading of a rendered file is found by its slug, whatever case the link wrote it in.
  const a = shown.value?.kind === 'blob' && anchor.value ? anchorSlug(anchor.value) : anchor.value
  if (!a || fileAnchor.value || !root.value) return
  await nextTick()
  const el = root.value
  unpin()
  unpin = pinIntoView(
    el,
    elementTop(() => el.querySelector(`[data-anchor="${CSS.escape(a)}"]`))
  )
}
onBeforeUnmount(() => unpin())

const reload = async () => {
  promoted.value = null
  files.data.value = null
  commits.data.value = null
  await main.load()
  if (pullTab.value === 'files') await files.load()
  if (pullTab.value === 'commits') await commits.load()
  void scrollToAnchor()
}

// A tab that follows a link to another item must not draw the new item from the old one's data
// while it loads — a pull request read as a file has no text. Cleared the moment the target
// changes, before anything computed from it is asked again.
watch(
  () => (target.value ? targetKey(target.value) : null),
  () => {
    promoted.value = null
    main.data.value = null
    main.error.value = null
    screen.expanded.splice(0)
    screen.selection = null
  },
  { flush: 'sync' }
)

// A new item loads from scratch; the same item at another line or comment only moves there.
watch(
  () => (target.value ? targetKey(target.value) : null),
  (key) => {
    if (!key || !props.enabled) return
    const t = target.value
    pullTab.value = t.kind === 'pull' ? t.tab : 'conversation'
    void reload()
  },
  { immediate: true }
)

watch(
  () => props.model.nonce,
  () => {
    const t = target.value
    if (t?.kind === 'pull') pullTab.value = t.tab
    void scrollToAnchor()
  }
)
</script>

<style lang="scss">
.abele-github {
  padding: var(--size-4-4);
  max-width: var(--file-line-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);

  // Diffs want the width a code review wants, not a line of prose.
  &:has(.abele-github-files, .abele-github-blob) {
    max-width: none;
  }

  &__fallback,
  &__error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--size-4-2);
  }

  // A refusal is several lines — the cause, the permission, GitHub's own words — and reads as them.
  &__error {
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  &__commits {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2);
  }

  &__message {
    overflow-wrap: anywhere;
  }
}

body.is-phone .abele-github {
  padding: var(--size-4-2);
}
</style>
