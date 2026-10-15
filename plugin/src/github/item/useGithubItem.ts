import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import type { CompareSection } from '@/github/compareSection'
import { basePins } from '@/github/comparison/pins'
import { githubRepositorySource } from '@/repository/github'
import { REPOSITORY_SOURCE } from '@/repository/context'
import { sourceKey, type RepositorySource } from '@/repository/source'
import { loadRepositoryLocation } from '@/repository/load'
import GithubFindBar from '@/components/github/GithubFindBar.vue'
import type { ListData } from '@/github/lists/listData'
import type { RepoHomeData } from '@/github/repoPage/repoHome'
import { useTreePanel } from '@/github/tree/useTreePanel'
import type { FolderData } from '@/github/tree/folder'
import { type ItemData, type PinnedLoad } from '@/github/loadItem'
import { useTabSearch } from '@/github/search/useTabSearch'
import { anchorSlug, type RepoFile } from '@/github/markdownLinks'
import type { BlobMode } from '@/github/markdownPreview'
import type { GithubClient } from '@/github/client'
import { targetKey, type GithubTarget } from '@/github/urls'
import { type CompareData } from '@/github/compare'
import { useLoad } from '@/github/useLoad'
import { elementTop, pinIntoView } from '@/github/scrollTo'
import { emptyScreen } from '@/github/screen'
import { pageWidthCss } from '@/github/pageWidth'
import { githubSettings } from '@/github/GithubService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import {
  loadPullCommits,
  loadPullFiles,
  type BlobData,
  type CommitData,
  type DiscussionData,
  type IssueData,
  type PullData,
} from '@/github/api'
import type { GithubItemProps } from './types'
import { useItemPresentation } from './useItemPresentation'
import { useLiveItemRefresh } from './useLiveItemRefresh'
import { useItemConversation } from './useItemConversation'
type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>
export function useGithubItem(props: GithubItemProps) {
  const root = ref<HTMLElement>()
  const blobToolbar = ref<HTMLElement | null>(null)
  const liveWorkingView = computed(
    () =>
      props.source?.identity.provider === 'node' &&
      props.sourceLocation &&
      'ref' in props.sourceLocation &&
      props.sourceLocation.ref === 'Working tree'
  )
  const browseRef = computed(() =>
    liveWorkingView.value && !projectPin.value ? 'Working tree' : undefined
  )
  const liveEditableFile = computed(
    () => !!browseRef.value && props.sourceLocation?.kind === 'file'
  )
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
  // Node tabs compare on the comparison page; a base pinned there earlier has no bar to undo it.
  const pin = computed(() =>
    target.value && props.source?.identity.provider !== 'node'
      ? pins.get(target.value, props.source?.identity)
      : null
  )
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
  watch(
    () => main.data.value,
    (data) => {
      if (!data || source.value?.identity.provider !== 'node') return
      const ref =
        (data as { ref?: string; sha?: string; headSha?: string }).ref ??
        (data as { sha?: string }).sha ??
        (data as { headSha?: string }).headSha
      if (ref) {
        props.model.sourceRevision = source.value.revision?.(ref)
        props.onState?.()
      }
    }
  )
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
    location: () => props.sourceLocation,
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
  const issue = computed(() =>
    shown.value.kind === 'issue' ? (main.data.value as IssueData) : null
  )
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
    if (!data || !repoRef.value || largeBusy.value) return
    if (!at) {
      if (!data.canLoadLarge || !source.value.largeBlob) return
      largeBusy.value = true
      try {
        const loaded = await source.value.largeBlob(
          data.ref,
          data.path,
          data.contentId ?? undefined
        )
        if (active && generation === loadGeneration && main.data.value === data)
          main.data.value = loaded
      } catch (error) {
        if (active && generation === loadGeneration && main.data.value === data)
          main.error.value = error instanceof Error ? error.message : String(error)
      } finally {
        largeBusy.value = false
      }
      return
    }
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
    return {
      host: t.host,
      origin: t.origin,
      owner: t.owner,
      repo: t.repo,
      ref: b.ref,
      path: b.path,
    }
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
  const { conversationRetrying, retryConversation } = useItemConversation(main, shown, client)
  watch(pullTab, (tab) => {
    if (tab === 'files' && !files.data.value && !files.loading.value) void files.load()
    if (tab === 'commits' && !commits.data.value && !commits.loading.value) void commits.load()
  })
  const {
    browserUrl,
    head,
    linker,
    repo,
    screen,
    chatAbout,
    openInBrowser,
    swapSides,
    openCommit,
  } = useItemPresentation({
    props,
    target,
    shown,
    source,
    main,
    compared,
    client,
    pullTab,
    compareTab,
    blob,
    pin,
  })
  /**
   * Brings the comment a link pointed at into view, once it is on screen and for as long as what
   * is above it is still settling. A link to a line in a diff is the diff file's to scroll to.
   */
  const anchorPin = { unpin: () => {} }
  const scrollToAnchor = async () => {
    // A heading of a rendered file is found by its slug, whatever case the link wrote it in.
    // So is one of a README under a folder or a front page.
    const rendered = ['blob', 'tree', 'repo'].includes(shown.value?.kind ?? '')
    const a = rendered && anchor.value ? anchorSlug(anchor.value) : anchor.value
    if (!a || fileAnchor.value || !root.value) return
    await nextTick()
    const el = root.value
    anchorPin.unpin()
    anchorPin.unpin = pinIntoView(
      el,
      elementTop(() => el.querySelector(`[data-anchor="${CSS.escape(a)}"]`))
    )
  }
  onBeforeUnmount(() => anchorPin.unpin())
  const reload = async (retry = false) => {
    if (retry) source.value.refresh?.()
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
      anchorPin.unpin()
      promoted.value = null
      main.clear()
      files.clear()
      commits.clear()
      Object.assign(screen, emptyScreen())
      props.onTitle?.('')
    },
    { flush: 'sync' }
  )
  useLiveItemRefresh({
    props,
    source,
    projectPin,
    main,
    screen,
    root,
    loadKey,
    anchorPin,
    reload,
    isActive: () => active,
  })
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
  return {
    root,
    blobToolbar,
    liveEditableFile,
    browseRef,
    target,
    pin,
    setOriginal,
    shown,
    projectPin,
    client,
    source,
    main,
    files,
    commits,
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
    findBar,
    tabSearch,
    showFind,
    issue,
    pull,
    discussion,
    commit,
    blob,
    largeBusy,
    countRetry,
    loadLarge,
    folder,
    home,
    list,
    compared,
    anchor,
    fileAnchor,
    blobRange,
    blobPlain,
    blobFile,
    setMode,
    pullTab,
    compareTab,
    pullTabs,
    conversationRetrying,
    retryConversation,
    browserUrl,
    head,
    linker,
    repo,
    chatAbout,
    openInBrowser,
    swapSides,
    openCommit,
    reload,
  }
}
