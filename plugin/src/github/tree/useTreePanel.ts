/**
 * What a GitHub tab needs to place itself in its repository: the breadcrumbs of a file or a
 * folder, the file tree panel's state, and the version both link at. Kept out of the tab component
 * so that component only says where they go.
 */
import { computed, watch, type ComputedRef } from 'vue'
import { Platform, type PaneType } from 'obsidian'
import type { GithubViewModel } from '../model'
import type { GithubClient } from '../client'
import { targetKey, type GithubTarget } from '../urls'
import { type BlobData } from '../api'
import { sourceKey, type RepositorySource } from '@/repository/source'
import { githubRepositorySource } from '@/repository/github'
import { GlobalStore } from '@/stores/GlobalStore'
import { crumbs as crumbsOf, type Crumb } from './fileTree'
import type { FolderData } from './folder'
import { PANEL_KEY, initialPanel, rememberPanel } from './panel'
import { linkRef } from './version'
import { shortRef } from '../itemHead'

export interface TreePanelOptions {
  model: GithubViewModel
  enabled: () => boolean
  shown: ComputedRef<GithubTarget | null>
  data: () => unknown
  client: () => GithubClient
  source?: () => RepositorySource
  pinned?: () => boolean
  open: (url: string, pane: PaneType | false) => void
  /** The tab's state changed in a way worth saving. */
  saved: () => void
}

export function useTreePanel(o: TreePanelOptions) {
  const app = () => GlobalStore.getInstance().app
  const source = () => o.source?.() ?? githubRepositorySource(o.client(), repoRef.value)

  /** Open or closed as the tab keeps it; a tab that never said opens as the last one was left. */
  const panelOpen = computed(
    () => o.model.tree ?? initialPanel(Platform.isPhone, app().loadLocalStorage(PANEL_KEY))
  )
  const panelShown = computed(() => o.enabled() && !!o.shown.value && panelOpen.value)

  const setPanel = (open: boolean) => {
    // The model is the tab's state, which this side writes too.
    o.model.tree = open
    rememberPanel(app(), open, Platform.isPhone)
    o.saved()
  }

  const repoRef = computed(() => {
    const t = o.shown.value
    return t ? { host: t.host, origin: t.origin, owner: t.owner, repo: t.repo } : null
  })

  /** The ref the links stay at, once the item has loaded; null for the default branch. */
  const ref = () => {
    const t = o.shown.value
    return t ? linkRef(t, o.data()) : null
  }

  const versionKey = computed(() => {
    const r = repoRef.value
    if (!r || !o.data()) return ''
    return `${sourceKey(source().identity)}:${source().cacheNamespace}:${targetKey(o.shown.value)}@${ref() ?? ''}`
  })

  // The tab owns the frozen target, not the drawer component that is destroyed when closed.
  let frozenVersion: { key: string; promise: Promise<{ ref: string; sha: string }> } | undefined
  watch(
    () => o.pinned?.(),
    (pinned) => {
      if (!pinned) frozenVersion = undefined
    }
  )
  const resolveVersion = async () => {
    const r = repoRef.value
    if (!r) throw new Error('Nothing is shown.')
    const client = source(),
      key = versionKey.value,
      pinned = o.pinned?.() ?? false
    client.assertCurrent?.()
    if (pinned && frozenVersion?.key === key) return frozenVersion.promise
    const read = (async () => {
      const at = ref() ?? (await client.defaultBranch())
      const sha = await client.resolve(at)
      client.assertCurrent?.()
      if (versionKey.value === key) {
        o.model.sourceRevision = client.revision?.(sha) ?? { kind: 'commit', commit: sha }
        o.saved()
      }
      return { ref: pinned ? sha : at, sha }
    })()
    if (pinned) {
      frozenVersion = { key, promise: read }
      void read.catch(() => {
        if (frozenVersion?.promise === read) frozenVersion = undefined
      })
    }
    return read
  }

  /** The file or folder on screen, to mark in the tree. */
  const current = computed<{ path: string; kind: 'file' | 'dir' } | null>(() => {
    const t = o.shown.value
    const d = o.data() as BlobData | FolderData | null
    if (!t || !d) return null
    if (t.kind === 'blob') return { path: d.path, kind: 'file' }
    if (t.kind === 'tree' || t.kind === 'repo') return { path: d.path, kind: 'dir' }
    return null
  })

  /** `owner / repo / dir / name` for a file or a folder; unset for anything else. */
  const crumbs = computed<Crumb[] | undefined>(() => {
    const t = o.shown.value
    const d = o.data() as BlobData | FolderData | null
    if (!t || !d || (t.kind !== 'blob' && t.kind !== 'tree' && t.kind !== 'repo')) return undefined
    return crumbsOf(t, d.ref, d.path).map((crumb, index) =>
      crumb.url
        ? {
            ...crumb,
            url: source().navigation.folder(
              d.ref,
              d.path
                .split('/')
                .filter(Boolean)
                .slice(0, index - 1)
                .join('/')
            ),
          }
        : crumb
    )
  })
  const crumbRef = computed(() => {
    const t = o.shown.value
    const d = o.data() as BlobData | FolderData | null
    return t && d && (t.kind === 'blob' || t.kind === 'tree' || t.kind === 'repo')
      ? shortRef(
          source().identity.provider === 'node' && d.ref.startsWith('working-')
            ? 'Working tree'
            : d.ref
        )
      : undefined
  })

  /** A file picked in the panel; a drawer over the content gets out of its way. */
  const openFromPanel = (url: string, pane: PaneType | false, overlaid: boolean) => {
    // Not remembered: the drawer closing itself is not the person choosing a closed panel.
    if (overlaid && !pane) {
      o.model.tree = false
      o.saved()
    }
    o.open(url, pane)
  }

  return {
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
  }
}
