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
      <GithubHeader
        :repo="`${target.owner}/${target.repo}`"
        :title="head.title"
        :number="head.number"
        :url="browserUrl"
        :state="head.state"
        :labels="head.labels"
        :meta="head.meta"
        :loading="main.loading.value"
        @refresh="reload"
        @browser="openInBrowser(browserUrl)"
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
        <Markdown
          v-if="splitMessage(commit.message).body"
          class="abele-github__message"
          :text="splitMessage(commit.message).body"
          as-document
        />
        <GithubFiles :files="commit.files" :anchor="fileAnchor" />
      </template>

      <template v-else-if="shown.kind === 'blob' && blob">
        <GithubCode :text="blob.text" :path="blob.path" :range="blobRange" />
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
import Markdown from '../obsidian/Markdown.vue'
import GithubHeader from './GithubHeader.vue'
import GithubThread from './GithubThread.vue'
import GithubFiles from './GithubFiles.vue'
import GithubCode from './GithubCode.vue'
import GithubNotice from './GithubNotice.vue'
import type { GithubViewModel } from '@/github/model'
import type { GithubClient } from '@/github/client'
import { targetKey, shortName, type GithubTarget } from '@/github/urls'
import { formatDate, splitMessage } from '@/github/format'
import { useLoad } from '@/github/useLoad'
import { elementTop, pinIntoView } from '@/github/scrollTo'
import { LINKER, createLinker } from '@/github/linking'
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
  /** Opens another GitHub URL in a tab of its own. */
  onOpen?: (url: string) => void
}>()

const root = ref<HTMLElement>()
const target = computed(() => props.model.target)

/**
 * What is actually on screen. An issue link whose number turns out to be a pull request is shown
 * as the pull request, the way GitHub redirects it.
 */
const promoted = ref<Of<'pull'> | null>(null)
const shown = computed<GithubTarget>(() => promoted.value ?? target.value!)

const client = () => props.clientFor(target.value!.host)

const main = useLoad<IssueData | PullData | DiscussionData | CommitData | BlobData>(async () => {
  const t = target.value!
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
    return { ...fallback, title: b.path, meta: [`at ${b.ref}`] }
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
provide(
  LINKER,
  createLinker({
    app: GlobalStore.getInstance().app,
    shown: () => (target.value ? shown.value : null),
    data: () => main.data.value,
    title: () => head.value.title,
    client,
  })
)

const tabTitle = computed(() => {
  const t = shown.value
  if (!t || !main.data.value) return ''
  if (t.kind === 'blob')
    return `${(main.data.value as BlobData).path.split('/').pop()} @ ${(main.data.value as BlobData).ref}`
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
  const a = anchor.value
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

// A new item loads from scratch; the same item at another line or comment only moves there.
watch(
  () => (target.value ? targetKey(target.value) : null),
  (key) => {
    if (!key || !props.enabled) return
    const t = target.value!
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
