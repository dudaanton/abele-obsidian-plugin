/**
 * What a GitHub tab needs to place itself in its repository: the breadcrumbs of a file or a
 * folder, the file tree panel's state, and the version both link at. Kept out of the tab component
 * so that component only says where they go.
 */
import { computed, type ComputedRef } from 'vue'
import { Platform, type PaneType } from 'obsidian'
import type { GithubViewModel } from '../model'
import type { GithubClient } from '../client'
import type { GithubTarget } from '../urls'
import { commitSha, type BlobData } from '../api'
import { defaultBranch } from '../search/source'
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
  open: (url: string, pane: PaneType | false) => void
  /** The tab's state changed in a way worth saving. */
  saved: () => void
}

export function useTreePanel(o: TreePanelOptions) {
  const app = () => GlobalStore.getInstance().app

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
    return t ? { host: t.host, owner: t.owner, repo: t.repo } : null
  })

  /** The ref the links stay at, once the item has loaded; null for the default branch. */
  const ref = () => {
    const t = o.shown.value
    return t ? linkRef(t, o.data()) : null
  }

  const versionKey = computed(() => {
    const r = repoRef.value
    if (!r || !o.data()) return ''
    return `${r.host}/${r.owner}/${r.repo}@${ref() ?? ''}`
  })

  const resolveVersion = async () => {
    const r = repoRef.value
    if (!r) throw new Error('Nothing is shown.')
    const at = ref() ?? (await defaultBranch(o.client(), r))
    return { ref: at, sha: await commitSha(o.client(), r, at) }
  }

  /** The file or folder on screen, to mark in the tree. */
  const current = computed<{ path: string; kind: 'file' | 'dir' } | null>(() => {
    const t = o.shown.value
    const d = o.data() as BlobData | FolderData | null
    if (!t || !d) return null
    if (t.kind === 'blob') return { path: d.path, kind: 'file' }
    if (t.kind === 'tree') return { path: d.path, kind: 'dir' }
    return null
  })

  /** `owner / repo / dir / name` for a file or a folder; unset for anything else. */
  const crumbs = computed<Crumb[] | undefined>(() => {
    const t = o.shown.value
    const d = o.data() as BlobData | FolderData | null
    if (!t || !d || (t.kind !== 'blob' && t.kind !== 'tree')) return undefined
    return crumbsOf(t, d.ref, d.path)
  })
  const crumbRef = computed(() => {
    const t = o.shown.value
    const d = o.data() as BlobData | FolderData | null
    return t && d && (t.kind === 'blob' || t.kind === 'tree') ? shortRef(d.ref) : undefined
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
