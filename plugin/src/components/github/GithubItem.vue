<template>
  <GithubLayout :panel="panelShown" @dismiss="setPanel(false)">
    <template #panel>
      <GithubTreePanel
        :repo="repoRef!"
        :client="client()"
        :version-key="versionKey"
        :resolve="resolveVersion"
        :current="current"
        :comparison="blob?.comparison?.index"
        :base-sha="projectPin?.baseSha"
        :retry-counts="countRetry"
        @open="openFromPanel"
        @close="setPanel(false)"
      />
    </template>
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
        <Button
          v-if="accountName"
          class="abele-github__account"
          :text="accountName"
          icon="user-round"
          tooltip="Open as another GitHub account"
          @click="onChooseAccount?.()"
        />
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
          :crumbs="crumbs"
          :ref-label="crumbRef"
          :tree="panelOpen"
          :swap="!!compared"
          @tree="setPanel(!panelOpen)"
          @swap="swapSides"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          @refresh="reload(true)"
          @browser="openInBrowser(browserUrl)"
          @chat="chatAbout"
          @find="showFind"
          @search="tabSearch.openSearch"
        >
          <template #file-actions>
            <div v-if="shown.kind === 'blob' && blob" ref="blobToolbar" />
          </template>
        </GithubHeader>

        <GithubBaseBar
          v-if="repoRef && ['blob', 'tree', 'repo'].includes(shown.kind)"
          :repo="repoRef"
          :client="client()"
          :pin="pin"
          :target-sha="blob?.comparison?.targetSha"
          :file="shown.kind === 'blob'"
          :original="model.originalFile"
          @original="setOriginal"
        />
        <EmptyState v-if="model.connectionNotice" :text="model.connectionNotice" />

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
          <Button
            text="Try again"
            icon="refresh-cw"
            tooltip="Ask GitHub again"
            @click="reload(true)"
          />
        </div>
        <EmptyState v-else-if="!main.data.value" text="Loading from GitHub…" />

        <template v-else-if="shown.kind === 'issue' && issue">
          <GithubThread
            :author="issue.author"
            :avatar="issue.authorAvatar"
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
            :avatar="discussion.authorAvatar"
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
            :avatar="pull.authorAvatar"
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
                :refs="{ head: pull.headSha, base: pull.baseSha }"
                @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
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
            <GithubCommits v-else :commits="commits.data.value" @open="openCommit" />
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
          <GithubFiles
            :files="commit.files"
            :anchor="fileAnchor"
            :refs="{ head: commit.sha, base: commit.parentSha }"
            @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          />
        </template>

        <GithubCompare
          v-else-if="shown.kind === 'compare' && compared"
          :data="compared"
          :repo="shown"
          :tab="compareTab"
          :anchor="fileAnchor"
          @tab="(tab: CompareSection) => (compareTab = tab)"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
        />

        <template v-else-if="shown.kind === 'blob' && blob">
          <GithubPinnedFile
            v-if="blob.comparison"
            :file="blob.comparison"
            :repo="repoRef!"
            :range="blobRange"
            :nonce="model.nonce"
            :busy="largeBusy"
            @large="loadLarge"
            @open="(url: string) => onOpen?.(url, false)"
          />
          <GithubBlob
            v-else
            :text="blob.text"
            :file="blobFile!"
            :range="blobRange"
            :plain="blobPlain"
            :mode="model.mode"
            :toolbar-host="blobToolbar"
            :client="client()"
            @mode="setMode"
            @open="(url: string) => onOpen?.(url)"
          />
        </template>

        <GithubRepoHome
          v-else-if="shown.kind === 'repo' && home"
          :home="home"
          :repo="repoRef!"
          :client="client()"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          @tree="setPanel(true)"
        />

        <GithubList
          v-else-if="shown.kind === 'list' && list"
          :target="shown"
          :data="list"
          :client="client()"
          @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
        />

        <template v-else-if="shown.kind === 'tree' && folder">
          <GithubFolder
            :folder="folder"
            :repo="repoRef!"
            :client="client()"
            @open="(url: string, pane: PaneType | false) => onOpen?.(url, pane)"
          />
        </template>

        <GithubProseActions v-if="root && main.data.value" :root="root" />
      </template>
    </div>
  </GithubLayout>
</template>

<script setup lang="ts">
import { openExternal } from '@/helpers/openExternal'
import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Button from '../obsidian/Button.vue'
import Tabs from '../obsidian/Tabs.vue'
import GithubText from './GithubText.vue'
import GithubHeader from './GithubHeader.vue'
import GithubCommits from './GithubCommits.vue'
import GithubCompare, { type CompareSection } from './GithubCompare.vue'
import GithubThread from './GithubThread.vue'
import GithubFiles from './GithubFiles.vue'
import GithubBlob from './GithubBlob.vue'
import GithubPinnedFile from './GithubPinnedFile.vue'
import GithubBaseBar from './GithubBaseBar.vue'
import { basePins } from '@/github/comparison/pins'
import { githubRepositorySource } from '@/repository/github'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { sourceKey, type RepositorySource, type RepositoryLocation } from '@/repository/source'
import { loadRepositoryLocation } from '@/repository/load'
import GithubNotice from './GithubNotice.vue'
import GithubFindBar from './GithubFindBar.vue'
import GithubCodeSearch from './GithubCodeSearch.vue'
import GithubFolder from './GithubFolder.vue'
import GithubRepoHome from './GithubRepoHome.vue'
import GithubList from './GithubList.vue'
import type { ListData } from '@/github/lists/listData'
import type { RepoHomeData } from '@/github/repoPage/repoHome'
import GithubProseActions from './GithubProseActions.vue'
import GithubTreePanel from './GithubTreePanel.vue'
import GithubLayout from './GithubLayout.vue'
import { useTreePanel } from '@/github/tree/useTreePanel'
import { itemHead, itemTabTitle, placeLink, type ItemHead } from '@/github/itemHead'
import type { FolderData } from '@/github/tree/folder'
import { type ItemData, type PinnedLoad } from '@/github/loadItem'
import type { PaneType } from 'obsidian'
import { useTabSearch } from '@/github/search/useTabSearch'
import type { GithubViewModel } from '@/github/model'
import { anchorSlug, type RepoFile } from '@/github/markdownLinks'
import type { BlobMode } from '@/github/markdownPreview'
import type { GithubClient } from '@/github/client'
import { targetKey, type GithubTarget } from '@/github/urls'
import { splitMessage } from '@/github/format'
import { type CompareData } from '@/github/compare'
import { useLoad } from '@/github/useLoad'
import { elementTop, pinIntoView } from '@/github/scrollTo'
import { LINKER, createLinker } from '@/github/linking'
import { SCREEN, chatSubject, emptyScreen } from '@/github/screen'
import { GITHUB_REPO } from '@/github/repoContext'
import { GITHUB_PEOPLE } from '@/github/users'
import { pageWidthCss } from '@/github/pageWidth'
import { githubSettings } from '@/github/GithubService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { repoWeb } from '@/github/origin'
import { bodyLink, type GithubLink } from '@/github/permalinks'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  loadIssueConversation,
  loadPullCommits,
  loadPullConversation,
  loadPullFiles,
  type BlobData,
  type CommitData,
  type DiscussionData,
  type IssueData,
  type PullData,
} from '@/github/api'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

const props = defineProps<{
  model: GithubViewModel
  source?: RepositorySource
  sourceLocation?: RepositoryLocation
  enabled: boolean
  clientFor?: (host: string) => GithubClient
  /** Connection-aware primary loading; secondary loads stay on clientFor. */
  primaryLoad?: (
    target: GithubTarget,
    promote: (target: GithubTarget) => void,
    retry?: boolean,
    pinned?: PinnedLoad
  ) => Promise<ItemData>
  peopleClient?: () => GithubClient
  accountName?: string
  onChooseAccount?: () => void
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
const blobToolbar = ref<HTMLElement | null>(null)

// How wide the text runs, from the settings, followed at once when they change.
const config = AbeleConfig.getInstance()
const pageWidth = computed(() => {
  void config.version.value
  return pageWidthCss(githubSettings())
})
watch([root, pageWidth], ([el, width]) => el?.style.setProperty('--abele-github-width', width), {
  immediate: true,
})
const target = computed(() => props.model.target)
const pins = basePins(GlobalStore.getInstance().app)
const pin = computed(() => (target.value ? pins.get(target.value, props.source?.identity) : null))
const setOriginal = (original: boolean) => {
  props.model.originalFile = original
  props.onState?.()
}
let cancellation = new AbortController()
let frozenTarget: { key: string; resolved: PinnedLoad['resolved'] } | undefined

/**
 * What is actually on screen. An issue link whose number turns out to be a pull request is shown
 * as the pull request, the way GitHub redirects it.
 */
const promoted = ref<GithubTarget | null>(null)
const shown = computed<GithubTarget>(() => promoted.value ?? target.value)
const projectPin = computed(() =>
  ['blob', 'tree', 'repo'].includes(shown.value?.kind ?? '') ? pin.value : null
)

const client = () => props.clientFor?.(target.value.host)
let githubAdapter: { client: GithubClient; key: string; source: RepositorySource } | undefined
const source = computed(() => {
  if (props.source) return props.source
  if (!target.value) return null
  const currentClient = client()
  const repository = target.value
  const key = JSON.stringify([
    props.model.connectionId,
    repository.origin,
    repository.host,
    repository.owner,
    repository.repo,
  ])
  // Parent renders replace clientFor callbacks even when their client is unchanged.
  // Keep the adapter identity so pending promotions still belong to this source.
  if (githubAdapter?.client !== currentClient || githubAdapter.key !== key) {
    githubAdapter = {
      client: currentClient,
      key,
      source: githubRepositorySource(currentClient, repository, props.model.connectionId),
    }
  }
  return githubAdapter.source
})
provide(REPOSITORY_SOURCE, source)

let loadGeneration = 0
let retryPrimary = false
let active = true
onBeforeUnmount(() => {
  active = false
  loadGeneration++
  cancellation.abort()
})
const main = useLoad<ItemData>(async () => {
  const generation = loadGeneration,
    currentClient = source.value,
    currentTarget = target.value
  const read =
    props.primaryLoad ??
    ((
      target: GithubTarget,
      promote: (target: GithubTarget) => void,
      _retry?: boolean,
      pinned?: PinnedLoad
    ) => {
      if (currentClient.github) return currentClient.github.loadTarget(target, promote, pinned)
      if (!props.sourceLocation) throw new Error('Select an explicit repository location.')
      if (props.sourceLocation.kind === 'file' && pinned?.base) {
        const location = props.sourceLocation
        return (async () => {
          const sha = pinned.resolved?.sha ?? (await currentClient.resolve(location.ref))
          const index = await currentClient.comparison(pinned.base.baseSha, sha, pinned.signal)
          const comparison = await currentClient.comparisonFile(
            index,
            location.path,
            false,
            pinned.signal
          )
          return {
            ref: sha,
            path: location.path,
            text: comparison.after?.text ?? '',
            url: currentClient.navigation.file(sha, location.path),
            comparison,
          }
        })()
      }
      return loadRepositoryLocation(currentClient, props.sourceLocation)
    })
  const key = `${sourceKey(currentClient.identity)}:${currentClient.cacheNamespace}:${targetKey(currentTarget)}:${JSON.stringify(props.sourceLocation ?? null)}`
  const data = await read(
    currentTarget,
    (t) => {
      if (active && generation === loadGeneration && currentClient === source.value) {
        promoted.value = t
        // Promotion still belongs to the original blob link's immutable target.
        if (
          currentTarget.kind === 'blob' &&
          t.kind === 'tree' &&
          projectPin.value &&
          !props.model.originalFile &&
          /^[0-9a-f]{40}$/i.test(t.rest[0])
        ) {
          frozenTarget = {
            key,
            resolved: {
              sha: t.rest[0],
              ref: t.rest[0],
              path: t.rest.slice(1).join('/'),
              kind: 'dir',
            },
          }
        }
      }
    },
    retryPrimary,
    {
      base: props.model.originalFile ? undefined : (projectPin.value ?? undefined),
      signal: cancellation.signal,
      resolved: frozenTarget?.key === key ? frozenTarget.resolved : undefined,
    }
  )
  const at = currentTarget.kind === 'blob' ? (data as BlobData).comparison : undefined
  if (at && active && generation === loadGeneration)
    frozenTarget = { key, resolved: { sha: at.targetSha, path: at.path, ref: at.targetSha } }
  return data
})

const files = useLoad(() => loadPullFiles(client(), shown.value as Of<'pull'>))
const commits = useLoad(() => loadPullCommits(client(), shown.value as Of<'pull'>))

// Where the tab is in its repository: the breadcrumbs, and the file tree panel beside it.
const {
  panelOpen,
  panelShown,
  setPanel,
  repoRef,
  versionKey,
  resolveVersion,
  current,
  crumbs,
  crumbRef,
  openFromPanel,
} = useTreePanel({
  model: props.model,
  enabled: () => props.enabled,
  shown: computed(() => (target.value ? shown.value : null)),
  data: () => main.data.value,
  client,
  source: () => source.value,
  pinned: () => !!projectPin.value,
  open: (url, pane) => props.onOpen?.(url, pane),
  saved: () => props.onState?.(),
})

// Find in the tab, code search and go to definition.
const findBar = ref<InstanceType<typeof GithubFindBar>>()
const tabSearch = useTabSearch({
  root,
  shown,
  data: () => main.data.value,
  files,
  client,
  source: () => source.value,
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
const blob = computed(() => (shown.value?.kind === 'blob' ? (main.data.value as BlobData) : null))
const largeBusy = ref(false)
const countRetry = ref(0)
const loadLarge = async () => {
  const data = blob.value,
    at = data?.comparison,
    generation = loadGeneration
  if (!data || !at || !repoRef.value || largeBusy.value) return
  largeBusy.value = true
  const signal = cancellation.signal
  try {
    const result = await source.value.comparisonFile(at.index, at.path, true, signal)
    if (active && generation === loadGeneration && main.data.value === data)
      main.data.value = { ...data, comparison: result }
  } catch (error) {
    if (!signal.aborted && active && generation === loadGeneration)
      main.error.value = error instanceof Error ? error.message : String(error)
  } finally {
    largeBusy.value = false
  }
}
const folder = computed(() =>
  shown.value.kind === 'tree' ? (main.data.value as FolderData) : null
)

const home = computed(() =>
  shown.value.kind === 'repo' ? (main.data.value as RepoHomeData) : null
)

const list = computed(() => (shown.value.kind === 'list' ? (main.data.value as ListData) : null))

const compared = computed(() =>
  shown.value?.kind === 'compare' ? (main.data.value as CompareData | null) : null
)

const anchor = computed(() => target.value?.anchor)
const fileAnchor = computed(() => {
  const t = target.value
  return t && (t.kind === 'pull' || t.kind === 'commit' || t.kind === 'compare')
    ? t.file
    : undefined
})
const blobRange = computed(() => (target.value?.kind === 'blob' ? target.value.lines : undefined))
const blobPlain = computed(() => (target.value?.kind === 'blob' ? !!target.value.plain : false))
/** The file on screen, for the links and images of its rendered view. */
const blobFile = computed<RepoFile | null>(() => {
  const t = target.value
  const b = blob.value
  if (!t || !b) return null
  return { host: t.host, origin: t.origin, owner: t.owner, repo: t.repo, ref: b.ref, path: b.path }
})
/** Preview or code: the tab keeps it, so back, forward and a restart come back to it. */
const setMode = (mode: BlobMode) => {
  // The model is the tab's state, which this side writes too.
  props.model.mode = mode
  props.onState?.()
}

const pullTab = ref<'conversation' | 'files' | 'commits'>('conversation')
/** A comparison opens on its files — what a link to one is for — unless it has none to show. */
const compareTab = ref<CompareSection>('files')
watch(compared, (c) => {
  if (c && !c.files.length && c.commits.length && !fileAnchor.value) compareTab.value = 'commits'
})
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
  if (!target.value || source.value.identity.provider === 'node') return ''
  const data = main.data.value as { url?: string } | null
  // The address the link had, so a line anchor survives; GitHub's own for an item it moved.
  return props.model.url || data?.url || ''
})

const head = computed<ItemHead>(() => itemHead(shown.value, main.data.value))

// Comments, diffs and the file view make links to themselves through this.
const linker = createLinker({
  app: GlobalStore.getInstance().app,
  shown: () => (target.value ? shown.value : null),
  data: () => main.data.value,
  title: () => head.value.title,
  client,
  source: () => source.value,
})
provide(LINKER, linker)

/** The repository shown: comments and messages resolve their relative links and images in it. */
const repo = computed<RepoFile | null>(() => {
  const t = target.value
  return t
    ? { host: t.host, origin: t.origin, owner: t.owner, repo: t.repo, ref: 'HEAD', path: '' }
    : null
})
provide(GITHUB_REPO, repo)
// The people in it are looked up with the tab's own client: its server, its token.
provide(GITHUB_PEOPLE, () =>
  target.value && source.value?.github ? (props.peopleClient?.() ?? client()) : null
)

// What is on screen, for an agent to ask about: the diffs and the file view add their part.
const screen = props.model.screen
provide(SCREEN, screen)

/** A link to the item itself — for a file or a folder, at the ref it was read at. */
const itemLink = computed<GithubLink | null>(() => {
  const t = shown.value
  const data = main.data.value
  if (!t || !data) return null
  if (source.value.identity.provider === 'node')
    return { label: head.value.title, url: (data as { url: string }).url }
  const place = placeLink(t, data)
  if (place !== undefined) return place
  const item = linker.item()
  return item ? bodyLink(item, head.value.title) : null
})

watch(
  () =>
    [
      itemLink.value,
      head.value.title,
      main.error.value,
      pullTab.value,
      compareTab.value,
      shown.value,
      blob.value?.comparison,
      pin.value?.enteredRef,
    ] as const,
  () => {
    const t = target.value ? shown.value : null
    props.model.screenNamespace = t ? source.value.cacheNamespace : undefined
    screen.link = itemLink.value
    screen.title = main.data.value ? head.value.title : ''
    screen.kind = t?.kind ?? ''
    screen.section =
      t?.kind === 'pull' ? pullTab.value : t?.kind === 'compare' ? compareTab.value : null
    screen.error = main.error.value ?? ''
    const comparison = blob.value?.comparison
    screen.comparison = comparison
      ? {
          baseSha: comparison.baseSha,
          targetSha: comparison.targetSha,
          baseRef: pin.value?.enteredRef ?? comparison.baseSha,
        }
      : null
  },
  { immediate: true }
)

const chatAbout = () => {
  const subject = chatSubject(screen)
  if (subject) void linker.ask(subject.link, subject.quote)
}

const tabTitle = computed(() =>
  shown.value && main.data.value ? itemTabTitle(shown.value, main.data.value, head.value.title) : ''
)

watch(tabTitle, (title) => {
  if (title) props.onTitle?.(title)
})

const openInBrowser = (url: string) => {
  if (url) openExternal(url)
}

/** The same two versions the other way round, in this tab: its back arrow returns. */
const swapSides = () => {
  const t = shown.value
  if (compared.value && t)
    props.onOpen?.(
      source.value.navigation.comparison(
        compared.value.head,
        compared.value.base,
        compared.value.direct
      ),
      false
    )
}

const openCommit = (sha: string) => {
  const t = shown.value
  if (t.kind !== 'pull') return
  props.onOpen?.(`${repoWeb(t)}/pull/${t.number}/commits/${sha}`)
}

/**
 * Brings the comment a link pointed at into view, once it is on screen and for as long as what
 * is above it is still settling. A link to a line in a diff is the diff file's to scroll to.
 */
let unpin = () => {}
const scrollToAnchor = async () => {
  // A heading of a rendered file is found by its slug, whatever case the link wrote it in.
  // So is one of a README under a folder or a front page.
  const rendered = ['blob', 'tree', 'repo'].includes(shown.value?.kind ?? '')
  const a = rendered && anchor.value ? anchorSlug(anchor.value) : anchor.value
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

const reload = async (retry = false) => {
  retryPrimary = retry
  if (retry) countRetry.value++
  // A denied capability must not leave previously loaded private provenance in the tab.
  try {
    source.value.assertCurrent()
  } catch {
    main.clear()
    Object.assign(screen, emptyScreen())
  }
  const generation = ++loadGeneration
  promoted.value = null
  cancellation.abort()
  cancellation = new AbortController()
  files.clear()
  commits.clear()
  await main.load()
  if (!active || generation !== loadGeneration) return
  if (pullTab.value === 'files') await files.load()
  if (pullTab.value === 'commits') await commits.load()
  void scrollToAnchor()
}

const loadKey = computed(() =>
  target.value
    ? `${sourceKey(source.value.identity)}:${source.value.cacheNamespace}:${targetKey(target.value)}:${projectPin.value?.baseSha ?? ''}:${!!props.model.originalFile}:${JSON.stringify(props.sourceLocation ?? null)}`
    : null
)

// A tab that follows a link to another item must not draw the new item from the old one's data
// while it loads — a pull request read as a file has no text. Cleared the moment the target
// changes, before anything computed from it is asked again.
watch(
  () => loadKey.value,
  () => {
    loadGeneration++
    cancellation.abort()
    promoted.value = null
    main.clear()
    files.clear()
    commits.clear()
    Object.assign(screen, emptyScreen())
    props.onTitle?.('')
  },
  { flush: 'sync' }
)

// A new item loads from scratch; the same item at another line or comment only moves there.
watch(
  () => loadKey.value,
  (key) => {
    if (!key || !props.enabled) return
    const t = target.value
    pullTab.value = t.kind === 'pull' ? t.tab : 'conversation'
    compareTab.value = 'files'
    void reload()
  },
  { immediate: true }
)

watch(
  () => props.model.nonce,
  () => {
    const t = target.value
    if (t?.kind === 'pull') pullTab.value = t.tab
    if (t?.kind === 'compare' && t.file) compareTab.value = 'files'
    void scrollToAnchor()
  }
)
</script>

<style lang="scss">
.abele-github {
  // The bar over selected words is placed inside it, and scrolls with the text it is over.
  position: relative;
  padding: var(--size-4-4);
  // Set from the GitHub settings (`pageWidth.ts`): the notes' line width, pixels, or the pane.
  max-width: var(--abele-github-width, var(--file-line-width));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);

  // Diffs want the width a code review wants, not a line of prose.
  &:has(.abele-github-files, .abele-github-blob, .abele-github-pinned) {
    max-width: none;
  }

  &__account {
    max-width: 100%;
    height: auto;
    min-height: var(--input-height);
    white-space: normal;
    overflow-wrap: anywhere;
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

  &__message {
    overflow-wrap: anywhere;
  }
}

body.is-phone .abele-github {
  padding: var(--size-4-2);
}

// Obsidian makes its whole interface unselectable and gives selection back only to a note; a
// GitHub tab is there to be read and quoted, so it gives it back itself — titles, comments,
// rendered files, code and diffs. Its controls stay unselectable, so a drag across them picks up
// no labels, and so do the line numbers: a diff copies as its text, nothing beside it.
.abele-github {
  user-select: text;
  -webkit-user-select: text;

  .abele-obsidian-icon,
  .abele-tabs,
  button,
  [role='button'],
  .cm-gutters,
  .abele-github-code__bar,
  .abele-github-selection {
    user-select: none;
    -webkit-user-select: none;
  }

  // A changed file's head folds its diff, but its path is worth copying; a person swaps their
  // name and login on a click, but the name is worth copying too.
  .abele-github-file__path,
  .abele-github-user {
    user-select: text;
    -webkit-user-select: text;
  }
}
</style>
