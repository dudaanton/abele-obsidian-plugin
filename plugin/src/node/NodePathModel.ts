import { uiFields, uiField, uiErrorMessage, uiMessage, UiError } from '@/i18n/streamBErrors'

import { computed, ref, shallowRef, markRaw, watch } from 'vue'
import type { SessionActivity } from './sessionActivity'
import { ChannelError } from '@abele/channel-protocol'
import { formatTimestamp } from '@/helpers/displayFormat'
import { NodePathSnapshotSchema, emptySnapshotChange } from './nodePathSnapshot'
import { applyPathChanges, type PathTreeBatch } from './nodePathChanges'
import { nodeActionError } from './errorWords'
import { NodePathHistoryModel } from './NodePathHistoryModel'
import { panelReplacementTarget, type TargetLocation } from './nodeTargetIdentity'
import type { PathGit } from './nodePathGit'
import type { NodeClient } from '@abele/node-client'
import type { RepositoryRevision } from '@abele/node-protocol'
import type {
  CommitSummary,
  CopySummary,
  FileChange,
  FolderSummary,
  NodePanelMode,
  NodeImagePreview,
  PullRequestSummary,
  BranchState,
  TreeEntry,
} from '@/components/nodeWork/types'

/** UI identities are immutable bindings, not branch names or filesystem paths. */
export interface PathTarget {
  nodeId: string
  registrationId: string
  projectId: string
  kind: 'worktree' | 'workspace'
  id: string
  /** Session binding incarnation, present only on an observed chat target. */
  incarnation?: string
  location?: TargetLocation
}
export const pathTargetKey = (target: PathTarget) =>
  JSON.stringify([target.nodeId, target.kind, target.id])
export interface PathChange extends FileChange {
  changeId?: string
}
export interface PathInspection {
  entries: TreeEntry[]
  changes: PathChange[]
  ahead?: number
  behind?: number
  base?: string
  lastCommit?: string
  revision?: RepositoryRevision
  note?: string
}
export type PathFileStage = 'staged' | 'unstaged' | { kind: 'committed'; base: string }
export interface PathDocument {
  target: PathTarget
  path: string
  text: string
  contentId: string | null
  image?: NodeImagePreview
  revision?: RepositoryRevision
  change?: PathChange
  note?: string
}
export interface PathTreePage {
  entries: TreeEntry[]
  cursor: string | null
  revision?: RepositoryRevision
}
/** A session's state as its row in the panel shows it. */
const chatActivity = (s: PathCatalogue['sessions'][number]) => ({
  id: s.session.session_id,
  title: s.session.title,
  running: s.running,
  ...(s.activity?.waiting ? { waiting: true } : {}),
  ...(s.activity?.failed ? { failed: true } : {}),
  ...(s.activity?.since ? { since: s.activity.since } : {}),
  ...(s.session.settings?.permission_mode === 'bypassPermissions' ? { bypass: true } : {}),
})
export interface KnownPathRead {
  revision: RepositoryRevision
  changes?: PathChange[]
}
export interface TreeProgress {
  state: 'reading' | 'failed'
  count: number
  error: string
}
export interface PathCatalogue {
  folders: FolderSummary[]
  targets: PathTarget[]
  sessions: {
    session: Awaited<ReturnType<NodeClient['getSession']>>
    target?: PathTarget
    running?: boolean
    /** What it is doing now, read from its journal. */
    activity?: SessionActivity
  }[]
  capabilities: string[]
}
/** Transport-independent product port. Wire validation belongs to the node client. */
export interface NodePathPort {
  searchCode?(
    target: PathTarget,
    scope: import('@/repository/search').Scope,
    query: import('@/repository/search').CodeQuery,
    glob: string,
    signal?: AbortSignal
  ): Promise<import('@/repository/model').CodeResults>
  search?(target: PathTarget, query: string): Promise<TreeEntry[]>
  invalidate?(target?: PathTarget): void
  catalogue(capabilities?: (capabilities: string[]) => void): Promise<PathCatalogue>
  inspect(
    target: PathTarget,
    files?: boolean,
    revision?: RepositoryRevision
  ): Promise<PathInspection>
  tree?(
    target: PathTarget,
    path: string,
    cursor?: string,
    revision?: RepositoryRevision
  ): Promise<PathTreePage>
  file(
    target: PathTarget,
    path: string,
    stage?: PathFileStage,
    revision?: RepositoryRevision,
    known?: KnownPathRead
  ): Promise<PathDocument>
  history(
    target: PathTarget,
    cursor?: string,
    revision?: RepositoryRevision
  ): Promise<{ entries: CommitSummary[]; cursor: string | null; revision?: RepositoryRevision }>
  commit(target: PathTarget, hash: string): Promise<CommitSummary>
  /** The commit's changed paths at once, each `pending`; `commitFile` reads one's contents. */
  commitIndex?(target: PathTarget, hash: string): Promise<CommitSummary>
  commitFile?(target: PathTarget, commit: CommitSummary, file: FileChange): Promise<FileChange>
  /** `changed`: the node's change batches in order, where it streams them. */
  watch(
    target: PathTarget,
    notify: () => void,
    changed?: (batch: PathTreeBatch) => void
  ): Promise<() => void>
  subscribe(notify: () => void): Promise<() => void>
  /** A worktree's branch against its base, or against the one chosen. */
  branch?(target: PathTarget, base?: string): Promise<PathBranch>
  /** Where the node reports the folder's remote; absent, the panel says none is known. */
  pulls?(target: PathTarget): Promise<PathPulls>
  /** Opens a pull request on the remote's git service for the worktree's pushed branch. */
  createPull?(target: PathTarget, pull: NewPull): Promise<{ number: number; url?: string }>
  /** Git writes, where the node offers them. */
  readonly git?: PathGit
}
export interface NewPull {
  title: string
  body: string
  /** The branch it asks to be merged into, as people say it (`main`). */
  base: string
  draft: boolean
}
/** A worktree's branch against its base, as a pull request page says it. */
export interface PathBranch {
  state: BranchState
  /** Files committed on the branch and not in its base. */
  committed: PathChange[]
  /** Every branch, remote branch and tag the branch can be compared with, in full. */
  refs: string[]
}
/** The pull requests of a place, from the git service its remote lives on. */
export interface PathPulls {
  draftSupported?: boolean
  serviceLabel?: string
  /** The remote the folder pushes to, as the node reports it; null when it reports none. */
  remote: string | null
  /** An account of that git service is connected, so its pull requests can be read. */
  connected: boolean
  pulls: (PullRequestSummary & { branch: string })[]
}
export interface SeenChanges {
  get(key: string): string | undefined
  set(key: string, changeId: string): void
}

export class NodePathModel {
  readonly folders = shallowRef<FolderSummary[]>([])
  readonly selected = ref('')
  readonly selectedChat = ref('')
  /** What the side panel shows of the selected place; kept in the snapshot. */
  readonly panelMode = ref<NodePanelMode>('files')
  readonly receivedAt = ref('')
  readonly error = ref('')
  private connectionError?: string
  readonly busy = ref(false)
  readonly online = ref(true)
  readonly capabilities = shallowRef<string[]>([])
  readonly inspections = shallowRef<Record<string, PathInspection>>({})
  readonly targets = shallowRef<PathTarget[]>([])
  readonly sessions = shallowRef<PathCatalogue['sessions']>([])
  readonly current = computed(() =>
    this.targets.value.find(
      (t) =>
        t.id === this.selected.value ||
        (t.kind === 'workspace' && t.projectId === this.selected.value)
    )
  )
  readonly inspection = computed(() =>
    this.current.value ? this.inspections.value[pathTargetKey(this.current.value)] : undefined
  )
  /** The selected place's history and pull requests, read while their mode is shown. */
  readonly panelHistory = shallowRef<NodePathHistoryModel>()
  readonly panelPulls = shallowRef<PathPulls>()
  /** The branch the selected worktree is compared with, when not its default; full ref. */
  readonly panelBase = ref('')
  private comparisonBases: Record<string, string> = {}
  readonly panelBranch = shallowRef<PathBranch>()
  readonly fileRefresh = shallowRef<Record<string, number>>({})
  private branchGeneration = 0
  /** The git action under way in the panel, one at a time: `stage`, `commit`, `push`… */
  readonly gitBusy = ref('')
  private readonly progress = shallowRef<Record<string, TreeProgress | undefined>>({})
  private readonly cursors = shallowRef<Record<string, Record<string, string | null>>>({})
  readonly treeProgress = computed(() =>
    this.current.value ? this.progress.value[pathTargetKey(this.current.value)] : undefined
  )
  readonly treeCursors = computed(() =>
    this.current.value ? (this.cursors.value[pathTargetKey(this.current.value)] ?? {}) : {}
  )
  readonly entries = computed(() => this.inspection.value?.entries ?? [])
  readonly changes = computed(() => this.inspection.value?.changes ?? [])
  readonly currentFolder = computed(() =>
    this.folders.value.find(
      (f) => f.id === this.current.value?.projectId || (f.missing && f.id === this.selected.value)
    )
  )
  readonly currentCopy = computed(() =>
    this.currentFolder.value?.copies.find((c) => c.id === this.selected.value)
  )
  readonly unavailable = computed(
    () =>
      !!(
        this.currentFolder.value?.missing ||
        this.currentCopy.value?.missing ||
        this.error.value === 'repository_unavailable'
      )
  )
  private retained = new Map<string, { document: PathDocument; bytes: number }>()
  private retainedBytes = 0
  private disposed = false
  private catalogueGeneration = 0
  private selectionGeneration = 0
  private targetGenerations = new Map<string, number>()
  private treeGenerations = new Map<string, number>()
  private treeLoads = new Map<string, { dirty: boolean; promise: Promise<void> }>()
  private stopWatch?: () => void
  private stopCatalog?: () => void
  private refreshPromise?: Promise<void>
  private latestRead?: Promise<void>
  private dirty = false
  private targetQueues = new Map<string, Promise<unknown>>()
  private folderLoads = new Map<string, Promise<void>>()
  private revisions = new Map<string, { at: number; read: KnownPathRead }>()
  private revisionEpochs = new Map<string, number>()
  private resourceEpochs = new Map<string, number>()
  private pageRevisions = new Map<string, Map<string, RepositoryRevision | undefined>>()
  /** Per target, the change batches applied so far and the latest of them. */
  private batches = new Map<string, { count: number; recent: PathTreeBatch[] }>()

  constructor(
    readonly nodeId: string,
    readonly registrationId: string,
    readonly port: NodePathPort,
    private seen: SeenChanges,
    private now = () => new Date().toISOString()
  ) {
    markRaw(this)
  }

  restoreSnapshot(raw: unknown): void {
    const parsed = NodePathSnapshotSchema.safeParse(raw)
    if (
      !parsed.success ||
      parsed.data.nodeId !== this.nodeId ||
      parsed.data.registrationId !== this.registrationId
    )
      return
    const value = parsed.data
    this.folders.value = value.folders.map((f) => ({
      ...f,
      copies: f.copies.map((c) => ({
        ...c,
        running: false,
        chats: c.chats?.map((chat) => ({ ...chat, running: false, waiting: false })),
      })),
      chats: f.chats?.map((chat) => ({ ...chat, running: false, waiting: false })),
    }))
    this.targets.value = value.targets
    this.selected.value = value.selected
    this.comparisonBases = value.comparisonBases ?? {}
    this.panelBase.value = this.comparisonBases[value.selected] ?? ''
    if (value.panelMode) this.panelMode.value = value.panelMode
    this.receivedAt.value = value.receivedAt
    const selected = this.current.value
    if (selected && value.inspection)
      this.inspections.value = { [pathTargetKey(selected)]: this.mark(selected, value.inspection) }
  }
  snapshot(): unknown {
    const cleanTree = (entries: TreeEntry[]): TreeEntry[] =>
      entries.map((entry) => ({
        ...entry,
        ...(entry.change ? { change: emptySnapshotChange(entry.change) } : {}),
        ...(entry.children ? { children: cleanTree(entry.children) } : {}),
      }))
    const inspection = this.inspection.value
    return {
      version: 1,
      nodeId: this.nodeId,
      registrationId: this.registrationId,
      receivedAt: this.receivedAt.value,
      selected: this.selected.value,
      panelMode: this.panelMode.value,
      comparisonBases: {
        ...this.comparisonBases,
        ...(this.selected.value ? { [this.selected.value]: this.panelBase.value } : {}),
      },
      folders: this.folders.value,
      targets: this.targets.value,
      ...(inspection
        ? {
            inspection: {
              entries: cleanTree(inspection.entries),
              changes: inspection.changes.map(emptySnapshotChange),
              ahead: inspection.ahead,
              behind: inspection.behind,
              base: inspection.base,
              lastCommit: inspection.lastCommit,
              note: inspection.note,
            },
          }
        : {}),
    }
  }
  target(id: string): PathTarget {
    const target = this.targets.value.find(
      (t) => t.id === id || (t.kind === 'workspace' && t.projectId === id)
    )
    if (!target) throw new UiError(uiMessage('streamBError.cbbb077a00'))
    return { ...target }
  }
  async start(): Promise<void> {
    if (this.disposed) return
    const stop = await this.port.subscribe(() => this.invalidate())
    if (this.disposed) {
      stop()
      return
    }
    this.stopCatalog = stop
    const generation = this.selectionGeneration
    await this.refresh()
    if (generation !== this.selectionGeneration) return
    const selected = this.current.value ?? this.targets.value[0]
    if (selected) await this.select(selected.id)
  }
  private invalidate(): void {
    this.dirty = true
    if (this.refreshPromise || this.disposed) return
    this.refreshPromise = (async () => {
      while (this.dirty && !this.disposed) {
        this.dirty = false
        try {
          await this.refresh()
        } catch (error) {
          this.report(error)
          break
        }
      }
    })().finally(() => {
      this.refreshPromise = undefined
    })
  }
  async refreshCurrent(): Promise<void> {
    const target = this.current.value
    const folders = this.folders.value
    // The selected root is read again without waiting on the catalogue, which may stall;
    // once the catalogue answers, a target that is gone surfaces as stale.
    const listed = this.refresh().then(() => {
      if (target && !this.hasTarget(target)) {
        if (this.currentFolder.value?.missing && this.current.value?.projectId === target.projectId)
          return
        const replacement = panelReplacementTarget(
          target,
          folders,
          this.targets.value,
          this.folders.value
        )
        if (!replacement || this.current.value?.id !== replacement.id)
          throw new ChannelError('stale_resource')
      }
    })
    await Promise.all([
      listed,
      target ? this.reloadTarget(target) : Promise.resolve(),
      this.panelMode.value === 'history' ? this.loadPanelHistory() : Promise.resolve(),
      this.panelMode.value === 'pulls' ? this.loadPanelPulls() : Promise.resolve(),
    ])
  }
  async reconnected(): Promise<void> {
    const target = this.current.value
    for (const known of this.targets.value) this.discardTarget(known)
    this.port.invalidate?.()
    const generation = this.selectionGeneration
    await this.refresh()
    if (this.disposed || generation !== this.selectionGeneration) return
    if (target) {
      if (!this.hasTarget(target)) throw new ChannelError('stale_resource')
      await this.selectTarget(target)
    }
  }
  private hasTarget(target: PathTarget): boolean {
    return this.targets.value.some(
      (entry) =>
        pathTargetKey(entry) === pathTargetKey(target) &&
        entry.projectId === target.projectId &&
        entry.registrationId === target.registrationId
    )
  }
  private discardTarget(target: PathTarget): void {
    const key = pathTargetKey(target)
    this.invalidateRevision(target)
    this.resourceEpochs.set(key, (this.resourceEpochs.get(key) ?? 0) + 1)
    this.pageRevisions.delete(key)
    this.batches.delete(key)
    this.treeLoads.delete(key)
    for (const request of this.folderLoads.keys())
      if ((JSON.parse(request) as [string])[0] === key) this.folderLoads.delete(request)
    this.inspections.value = Object.fromEntries(
      Object.entries(this.inspections.value).filter(([id]) => id !== key)
    )
    this.cursors.value = Object.fromEntries(
      Object.entries(this.cursors.value).filter(([id]) => id !== key)
    )
    this.port.invalidate?.(target)
    for (const [watchKey, watched] of this.targetWatches) {
      if ((JSON.parse(watchKey) as [string])[0] !== key) continue
      this.targetWatches.delete(watchKey)
      void watched.stop.then((stop) => stop()).catch(() => {})
    }
    if (this.selected.value === (target.kind === 'workspace' ? target.projectId : target.id)) {
      ++this.selectionGeneration
      this.stopWatch?.()
      this.stopWatch = undefined
      this.panelHistory.value?.destroy()
      this.panelHistory.value = undefined
      this.panelBranch.value = undefined
      this.panelPulls.value = undefined
    }
  }
  private readonly targetWatches = new Map<string, { users: number; stop: Promise<() => void> }>()
  /** File tabs and the selected folder share one lease; a tab outlives sidebar selection. */
  watchFileTarget(target: PathTarget): Promise<() => void> {
    return this.watchTarget(target)
  }
  fileWatchVersion(target: PathTarget): number {
    return this.resourceEpochs.get(pathTargetKey(target)) ?? 0
  }
  private async watchTarget(target: PathTarget): Promise<() => void> {
    if (this.disposed) return () => {}
    const key = JSON.stringify([
      pathTargetKey(target),
      this.resourceEpochs.get(pathTargetKey(target)) ?? 0,
    ])
    let shared = this.targetWatches.get(key)
    if (!shared) {
      shared = { users: 0, stop: this.startTargetWatch(target) }
      this.targetWatches.set(key, shared)
    }
    shared.users++
    let stop: () => void
    try {
      stop = await shared.stop
    } catch (error) {
      if (this.targetWatches.get(key) === shared) this.targetWatches.delete(key)
      throw error
    }
    let released = false
    return () => {
      if (released || this.targetWatches.get(key) !== shared) return
      released = true
      if (--shared.users === 0) {
        this.targetWatches.delete(key)
        stop()
      }
    }
  }
  private startTargetWatch(target: PathTarget): Promise<() => void> {
    const epoch = this.resourceEpochs.get(pathTargetKey(target)) ?? 0
    const current = () =>
      !this.disposed && epoch === (this.resourceEpochs.get(pathTargetKey(target)) ?? 0)
    return this.port.watch(
      target,
      () => {
        if (!current()) return
        void this.reloadTarget(target).catch((e) => {
          // The tree already says it failed, with a retry, without moving its rows; a notice
          // over it would push them down on every failed background read.
          if (this.progress.value[pathTargetKey(target)]?.state === 'failed')
            console.debug('[Abele] node path: reading the files again failed', e)
          else this.report(e)
        })
      },
      (batch) => {
        if (current()) this.applyBatch(target, batch)
      }
    )
  }
  private async recoverRead(
    target: PathTarget,
    read: () => Promise<void>,
    renewWatch = true,
    retryRead = read
  ): Promise<void> {
    const epoch = this.resourceEpochs.get(pathTargetKey(target)) ?? 0
    try {
      return await read()
    } catch (error) {
      if (this.disposed || epoch !== (this.resourceEpochs.get(pathTargetKey(target)) ?? 0)) return
      if (
        !(error instanceof ChannelError) ||
        !['stale_resource', 'stale_revision', 'stale_cursor'].includes(error.code)
      )
        throw error
      const selected =
        this.current.value && pathTargetKey(this.current.value) === pathTargetKey(target)
      console.debug('[Abele] node path: refreshing a stale target', target.id, error.code)
      this.discardTarget(target)
      if (error.code === 'stale_resource') {
        const folders = this.folders.value
        await this.refresh()
        if (!this.hasTarget(target)) {
          if (
            this.currentFolder.value?.missing &&
            this.current.value?.projectId === target.projectId
          )
            return
          const replacement =
            selected &&
            panelReplacementTarget(target, folders, this.targets.value, this.folders.value)
          if (replacement && this.current.value?.id === replacement.id) return
          this.report(error)
          throw error
        }
      }
      // Only a read is retried. Session bindings are never substituted.
      try {
        if (
          renewWatch &&
          selected &&
          this.current.value &&
          pathTargetKey(this.current.value) === pathTargetKey(target)
        ) {
          const generation = this.selectionGeneration
          const stop = await this.watchTarget(target)
          if (this.disposed || generation !== this.selectionGeneration) stop()
          else this.stopWatch = stop
        }
        return await retryRead()
      } catch (retryError) {
        this.discardTarget(target)
        this.report(retryError)
        throw retryError
      }
    }
  }
  /** The selected worktree's commits for the panel, the first page read again. */
  async loadPanelHistory(): Promise<void> {
    const target = this.current.value
    if (!target || target.kind !== 'worktree' || !this.online.value) return
    let history = this.panelHistory.value
    if (!history || pathTargetKey(history.target) !== pathTargetKey(target)) {
      history?.destroy()
      history = new NodePathHistoryModel(this.port, target)
      this.panelHistory.value = history
    }
    await history.load()
  }
  /** The selected worktree's branch against its base (or the chosen one), and what it committed. */
  async loadPanelBranch(): Promise<void> {
    const target = this.current.value
    if (!target || target.kind !== 'worktree' || !this.port.branch || !this.online.value) return
    const generation = ++this.branchGeneration
    const branch = await this.port.branch(target, this.panelBase.value || undefined)
    if (!this.disposed && generation === this.branchGeneration) this.panelBranch.value = branch
  }
  /**
   * One git write on the selected worktree, against the revision the panel shows, then the
   * worktree and its branch read again. A second action waits for the first to finish.
   */
  private async gitAct<T>(
    id: string,
    run: (git: PathGit, target: PathTarget, seen: RepositoryRevision) => Promise<T>
  ): Promise<T> {
    const git = this.port.git,
      target = this.current.value,
      seen = this.inspection.value?.revision
    if (!git || !target || target.kind !== 'worktree')
      throw new UiError(uiMessage('streamBError.d15771e911'))
    if (!seen) throw new UiError(uiMessage('streamBError.54a4d809c8'))
    if (this.gitBusy.value) throw new UiError(uiMessage('streamBError.607e975b14'))
    this.gitBusy.value = id
    try {
      const result = await run(git, target, seen)
      uiField(this.error, 'value', uiErrorMessage(''))
      return result
    } catch (error) {
      throw id === 'stage' ? nodeActionError(error, 'Stage') : error
    } finally {
      this.gitBusy.value = ''
      this.invalidateRevision(target)
      await this.reloadTarget(target, false).catch((error) => this.report(error))
      void this.loadPanelBranch().catch((error) => this.report(error))
    }
  }
  stage(paths: string[] | 'all'): Promise<void> {
    return this.gitAct('stage', (git, target, seen) => git.stage(target, seen, paths))
  }
  unstage(paths: string[] | 'all'): Promise<void> {
    return this.gitAct('unstage', (git, target, seen) => git.unstage(target, seen, paths))
  }
  /** Only after the person confirmed it. */
  discard(paths: string[]): Promise<void> {
    return this.gitAct('discard', (git, target, seen) => git.discard(target, seen, paths))
  }
  commit(message: string): Promise<{ commit: string; author: string }> {
    return this.gitAct('commit', (git, target, seen) => git.commit(target, seen, message))
  }
  /** `lease`: the remote branch as the person saw it, to replace it after a rebase. */
  push(lease?: string): Promise<void> {
    return this.gitAct('push', (git, target, seen) => git.push(target, seen, lease))
  }
  fetch(): Promise<void> {
    return this.gitAct('fetch', (git, target) => git.fetch(target))
  }
  /** A branch at the commit the worktree is on, switched to. */
  createBranch(name: string): Promise<void> {
    return this.gitAct('create-branch', (git, target, seen) => {
      const at = seen.kind === 'commit' ? seen.commit : seen.head
      if (!at) throw new UiError(uiMessage('streamBError.97797a06f1'))
      return git.createBranch(target, name, at, seen)
    })
  }
  /** The remote branch as last fetched, to replace it only if it is still that. */
  async upstreamLease(): Promise<{ commit: string; ahead: number; behind: number } | undefined> {
    const target = this.current.value
    const upstream = target && (await this.port.git?.info(target))?.upstream
    return upstream?.commit
      ? { commit: upstream.commit, ahead: upstream.ahead ?? 0, behind: upstream.behind ?? 0 }
      : undefined
  }
  /** Rebases onto the branch's base; the files left in conflict, if it stopped on them. */
  update(): Promise<{ conflicts: string[] }> {
    const base = this.panelBranch.value?.state.baseRef
    return this.gitAct('update', (git, target, seen) => git.update(target, seen, base))
  }
  continueStopped(operation: 'rebase' | 'merge'): Promise<{ conflicts: string[] }> {
    return this.gitAct('continue', (git, target) => git.continue(target, operation))
  }
  abortStopped(operation: 'rebase' | 'merge'): Promise<void> {
    return this.gitAct('abort', (git, target) => git.abort(target, operation))
  }
  async createPull(pull: NewPull): Promise<{ number: number; url?: string }> {
    const target = this.current.value
    if (!target || !this.port.createPull) throw new UiError(uiMessage('streamBError.890a0701f9'))
    const made = await this.port.createPull(target, pull)
    void this.loadPanelBranch().catch((error) => this.report(error))
    return made
  }
  async loadPanelPulls(): Promise<void> {
    const target = this.current.value
    if (!target || target.kind !== 'worktree') return
    if (!this.port.pulls) {
      this.panelPulls.value = { remote: null, connected: false, pulls: [] }
      return
    }
    const key = pathTargetKey(target)
    const pulls = await this.port.pulls(target)
    if (!this.disposed && this.current.value && pathTargetKey(this.current.value) === key)
      this.panelPulls.value = pulls
  }
  async refresh(): Promise<void> {
    const generation = ++this.catalogueGeneration
    const read = this.refreshCatalogue(generation)
    this.latestRead = read
    try {
      await read
    } catch (error) {
      if (generation === this.catalogueGeneration) throw error
    }
    while (!this.disposed && generation !== this.catalogueGeneration) {
      const latest = this.latestRead
      await latest
      if (latest === this.latestRead) return
    }
  }
  private async refreshCatalogue(generation: number): Promise<void> {
    this.busy.value = true
    try {
      const catalogue = await this.port.catalogue((capabilities) => {
        if (!this.disposed && generation === this.catalogueGeneration)
          this.capabilities.value = [...capabilities]
      })
      if (this.disposed || generation !== this.catalogueGeneration) return
      const previous = this.targets.value
      const selected = this.current.value
      const previousFolders = this.folders.value
      this.targets.value = catalogue.targets.map((t) => ({ ...t }))
      const removed = previous.filter((target) => !this.hasTarget(target))
      const removedSelected = removed.some(
        (target) =>
          target.id === this.selected.value ||
          (target.kind === 'workspace' && target.projectId === this.selected.value)
      )
      const replacement =
        removedSelected && selected
          ? catalogue.folders.some((f) => f.id === selected.projectId && f.missing)
            ? this.targets.value.find((t) => t.projectId === selected.projectId)
            : panelReplacementTarget(
                selected,
                previousFolders,
                this.targets.value,
                catalogue.folders
              )
          : undefined
      for (const target of removed) this.discardTarget(target)
      // Retire the old selection before opening any independently matched replacement.
      if (removedSelected)
        this.selected.value = catalogue.folders.some(
          (f) => f.id === selected?.projectId && f.missing
        )
          ? selected.projectId
          : ''
      this.sessions.value = catalogue.sessions
      this.capabilities.value = catalogue.capabilities
      this.folders.value = catalogue.folders
      this.decorate()
      if (this.disposed || generation !== this.catalogueGeneration) return
      this.receivedAt.value = this.now()
      uiField(this.error, 'value', uiErrorMessage(''))
      if (replacement) {
        console.debug('[Abele] node path: recovering panel selection', selected?.id, replacement.id)
        await this.selectTargetOnce(replacement)
      } else if (this.currentFolder.value?.missing || this.currentCopy.value?.missing) {
        if (this.current.value) this.discardTarget(this.current.value)
        this.report(new ChannelError('repository_unavailable'))
      } else if (removedSelected) this.report(new ChannelError('stale_resource'))
    } catch (error) {
      if (generation === this.catalogueGeneration) this.report(error)
      throw error
    } finally {
      if (generation === this.catalogueGeneration) this.busy.value = false
    }
  }
  async select(id: string): Promise<void> {
    if (this.folders.value.some((folder) => folder.id === id && folder.missing)) {
      ++this.selectionGeneration
      ++this.branchGeneration
      this.panelBranch.value = undefined
      this.stopWatch?.()
      this.stopWatch = undefined
      this.selected.value = id
      this.report(new ChannelError('repository_unavailable'))
      return
    }
    return this.selectTarget(this.target(id))
  }
  async selectTarget(target: PathTarget, copy?: CopySummary): Promise<void> {
    return this.recoverRead(target, () => this.selectTargetOnce(target, copy), false)
  }
  private async selectTargetOnce(target: PathTarget, copy?: CopySummary): Promise<void> {
    if (target.nodeId !== this.nodeId || target.registrationId !== this.registrationId)
      throw new UiError(uiMessage('streamBError.8a0e599716'))
    if (!this.targets.value.some((entry) => pathTargetKey(entry) === pathTargetKey(target)))
      this.targets.value = [...this.targets.value, { ...target }]
    if (copy)
      this.folders.value = this.folders.value.map((folder) =>
        folder.id === target.projectId
          ? { ...folder, copies: [...folder.copies.filter((entry) => entry.id !== copy.id), copy] }
          : folder
      )
    const generation = ++this.selectionGeneration
    const next = target.kind === 'workspace' ? target.projectId : target.id
    if (next !== this.selected.value) {
      // Another place: its own base and branch, not the last one's.
      if (this.selected.value) this.comparisonBases[this.selected.value] = this.panelBase.value
      this.panelBase.value = this.comparisonBases[next] ?? ''
      this.panelBranch.value = undefined
      ++this.branchGeneration
    }
    this.selected.value = next
    if (this.currentFolder.value?.missing || this.currentCopy.value?.missing) {
      this.discardTarget(target)
      this.report(new ChannelError('repository_unavailable'))
      return
    }
    const previousWatch = this.stopWatch
    this.stopWatch = undefined
    if (!this.online.value) {
      previousWatch?.()
      if (!this.inspections.value[pathTargetKey(target)])
        throw new UiError(uiMessage('streamBError.e1b43e1573'))
      this.openMode(target)
      return
    }
    // The watch comes first and the files are read after it, once: a read before it could miss
    // what changed until the stream started, and reading again would race whatever comes next.
    let stop: (() => void) | undefined, watchError: unknown
    try {
      stop = await this.watchTarget(target)
    } catch (error) {
      watchError = error
    }
    // Acquire the shared lease first: selecting the same target must never drop its
    // last user and close the node's filesystem watcher between renders.
    previousWatch?.()
    if (this.disposed || generation !== this.selectionGeneration) {
      stop?.()
      return
    }
    this.stopWatch = stop
    const pending = this.treeLoads.get(pathTargetKey(target))
    await (pending?.promise ?? this.reloadTargetOnce(target))
    if (this.disposed || generation !== this.selectionGeneration) return
    this.openMode(target)
    if (watchError) throw watchError
    uiField(this.error, 'value', uiErrorMessage(''))
  }
  /**
   * A place opens on its files, or on its changes when it has some. History and pull requests
   * are kept when the person moves to another place; a folder without git has files only.
   */
  private openMode(target: PathTarget): void {
    if (target.kind !== 'worktree') this.panelMode.value = 'files'
    else if (this.panelMode.value === 'files' || this.panelMode.value === 'changes')
      this.panelMode.value = this.changes.value.length ? 'changes' : 'files'
  }
  async reloadTarget(target: PathTarget, files = true): Promise<void> {
    if (
      this.folders.value.find((f) => f.id === target.projectId)?.missing ||
      this.copy(target)?.missing
    ) {
      this.report(new ChannelError('repository_unavailable'))
      return
    }
    await this.recoverRead(target, () => this.reloadTargetOnce(target, files))
    if (this.current.value && pathTargetKey(this.current.value) === pathTargetKey(target))
      uiField(this.error, 'value', uiErrorMessage(''))
    const key = pathTargetKey(target)
    this.refreshFiles(key)
  }
  private refreshFiles(key: string, paths?: readonly string[]): void {
    const versions = { ...this.fileRefresh.value }
    for (const path of paths ?? [undefined]) {
      const entry = path === undefined ? key : JSON.stringify([key, path])
      versions[entry] = (versions[entry] ?? 0) + 1
    }
    this.fileRefresh.value = versions
  }
  /** Whole-target refreshes plus streamed edits of this file or one of its parent folders. */
  fileVersion(
    target: PathTarget,
    path: string,
    versions: Readonly<Record<string, number>> = this.fileRefresh.value
  ): number {
    const key = pathTargetKey(target)
    let version = versions[key] ?? 0,
      prefix = ''
    for (const part of path.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${part}` : part
      version += versions[JSON.stringify([key, prefix])] ?? 0
    }
    return version
  }
  private async reloadTargetOnce(target: PathTarget, files = true): Promise<void> {
    if (this.disposed) return
    if (!files) return this.serialTarget(target, () => this.readTarget(target, false))
    this.invalidateRevision(target)
    const key = pathTargetKey(target),
      pending = this.treeLoads.get(key)
    if (pending) {
      pending.dirty = true
      return pending.promise
    }
    // Never continually supersede a large listing before it can publish. Burst invalidations
    // share this read and request one fresh observation afterwards, without losing freshness.
    const epoch = this.resourceEpochs.get(key) ?? 0
    const load = { dirty: false, promise: Promise.resolve() }
    this.treeLoads.set(key, load)
    load.promise = (async () => {
      do {
        load.dirty = false
        try {
          await this.serialTarget(target, () => this.readTarget(target, true))
        } catch (error) {
          if (!load.dirty) throw error
        }
      } while (load.dirty && !this.disposed && epoch === (this.resourceEpochs.get(key) ?? 0))
    })().finally(() => {
      if (this.treeLoads.get(key) === load) this.treeLoads.delete(key)
    })
    return load.promise
  }
  /**
   * Patches the rows a batch names in place; opened folders stay filled and nothing is read
   * again. The change list is read again — not the tree — when git state moved or a file in it
   * was touched, since its details come from the node's status.
   */
  private applyBatch(target: PathTarget, batch: PathTreeBatch): void {
    if (this.disposed) return
    const key = pathTargetKey(target)
    const seen = this.batches.get(key) ?? { count: 0, recent: [] }
    seen.count++
    seen.recent.push(batch)
    if (seen.recent.length > 32) seen.recent.shift()
    this.batches.set(key, seen)
    // Reads after this observe the files again.
    const previous = this.inspections.value[key]?.revision
    this.invalidateRevision(target)
    this.patch(target, batch.entries)
    if (batch.entries.length)
      this.refreshFiles(key, [
        ...new Set(
          batch.entries.flatMap((entry) =>
            entry.change === 'deleted'
              ? [entry.path]
              : entry.change === 'renamed'
                ? [entry.from, entry.entry.path]
                : [entry.entry.path]
          )
        ),
      ])
    const listed = new Set((this.inspections.value[key]?.changes ?? []).map((c) => c.path))
    const touched = batch.entries.some((c) =>
      c.change === 'deleted'
        ? listed.has(c.path)
        : listed.has(c.entry.path) || (c.change === 'renamed' && listed.has(c.from))
    )
    if (batch.git || touched)
      void this.serialTarget(target, () => this.readTarget(target, false))
        .then(() => {
          const next = this.inspections.value[key]?.revision
          if (
            !this.disposed &&
            !batch.entries.length &&
            previous?.kind === 'working' &&
            next?.kind === 'working' &&
            previous.head !== next.head
          )
            this.refreshFiles(key)
        })
        .catch((e) => this.report(e))
  }
  private patch(target: PathTarget, changes: PathTreeBatch['entries']): void {
    const key = pathTargetKey(target),
      current = this.inspections.value[key]
    if (!current || !changes.length) return
    const entries = applyPathChanges(
      current.entries,
      changes,
      target.kind === 'workspace' ? 'plain' : 'git'
    )
    if (entries === current.entries) return
    this.inspections.value = {
      ...this.inspections.value,
      [key]: this.mark(target, { ...current, entries }),
    }
  }
  /** Where a read starts in the stream, to give it afterwards the batches that overtook it. */
  private batchMark(target: PathTarget) {
    return this.batches.get(pathTargetKey(target))?.count ?? 0
  }
  private catchUp(target: PathTarget, mark: number) {
    const seen = this.batches.get(pathTargetKey(target))
    if (!seen || seen.count === mark) return
    // More overtook the read than are kept: only reading it all again is right.
    if (seen.count - mark > seen.recent.length) {
      void this.reloadTarget(target).catch((e) => this.report(e))
      return
    }
    const missed = seen.recent.slice(Math.max(0, seen.recent.length - (seen.count - mark)))
    this.patch(
      target,
      missed.flatMap((batch) => batch.entries)
    )
  }
  private serialTarget<T>(target: PathTarget, read: () => Promise<T>): Promise<T> {
    const key = pathTargetKey(target),
      previous = this.targetQueues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(read)
    this.targetQueues.set(key, next)
    void next
      .finally(() => {
        if (this.targetQueues.get(key) === next) this.targetQueues.delete(key)
      })
      .catch(() => {})
    return next
  }
  private invalidateRevision(target: PathTarget): void {
    const key = pathTargetKey(target)
    this.revisions.delete(key)
    this.revisionEpochs.set(key, (this.revisionEpochs.get(key) ?? 0) + 1)
  }
  private rememberRevision(target: PathTarget, read: KnownPathRead): void {
    const key = pathTargetKey(target),
      previous = this.revisions.get(key)
    const same =
      previous && JSON.stringify(previous.read.revision) === JSON.stringify(read.revision)
    if (
      previous?.read.revision.kind === 'working' &&
      read.revision.kind === 'working' &&
      Date.parse(read.revision.observed_at) < Date.parse(previous.read.revision.observed_at)
    )
      return
    // Reading bytes, another page, or metadata for A does not make A a new observation.
    const changes = read.changes ?? (same ? previous.read.changes : undefined)
    if (same && changes === previous.read.changes) return
    this.revisions.set(key, {
      at: same ? previous.at : Date.now(),
      read: { revision: read.revision, ...(changes ? { changes } : {}) },
    })
    this.revisionEpochs.set(key, (this.revisionEpochs.get(key) ?? 0) + 1)
  }
  private knownRead(target: PathTarget): KnownPathRead | undefined {
    const known = this.revisions.get(pathTargetKey(target))
    return known && Date.now() - known.at < 30000 ? known.read : undefined
  }
  private setProgress(target: PathTarget, state?: TreeProgress['state'], error = ''): void {
    const count = (entries: TreeEntry[]): number =>
      entries.reduce((total, entry) => total + 1 + count(entry.children ?? []), 0)
    const key = pathTargetKey(target)
    this.progress.value = {
      ...this.progress.value,
      [key]: state
        ? { state, count: count(this.inspections.value[key]?.entries ?? []), error }
        : undefined,
    }
  }
  private publishPage(
    target: PathTarget,
    path: string,
    page: PathTreePage,
    append: boolean,
    /** Keep the entries already read inside folders that are still there. */
    retain = false
  ): void {
    const key = pathTargetKey(target),
      current = this.inspections.value[key] ?? { entries: [], changes: [] }
    const kept = (previous: TreeEntry[]) => {
      const known = new Map(previous.map((entry) => [entry.path, entry]))
      return page.entries.map((entry) => {
        const before = known.get(entry.path)
        return entry.children === undefined &&
          before?.kind === entry.kind &&
          before.children !== undefined
          ? { ...entry, children: before.children }
          : entry
      })
    }
    const merge = (previous: TreeEntry[]) =>
      append
        ? [...new Map([...previous, ...page.entries].map((entry) => [entry.path, entry])).values()]
        : retain
          ? kept(previous)
          : page.entries
    const walk = (entries: TreeEntry[]): TreeEntry[] =>
      entries.map((entry) =>
        entry.path === path
          ? { ...entry, children: merge(entry.children ?? []) }
          : entry.children
            ? { ...entry, children: walk(entry.children) }
            : entry
      )
    const entries = path ? walk(current.entries) : merge(current.entries)
    this.inspections.value = {
      ...this.inspections.value,
      [key]: this.mark(target, { ...current, entries }),
    }
    this.cursors.value = {
      ...this.cursors.value,
      [key]: { ...(path || append ? this.cursors.value[key] : {}), [path]: page.cursor },
    }
    const revisions =
      path || append
        ? (this.pageRevisions.get(key) ?? new Map())
        : new Map<string, RepositoryRevision | undefined>()
    revisions.set(path, page.revision)
    this.pageRevisions.set(key, revisions)
    if (page.revision) {
      const known = this.revisions.get(key)?.read
      const changes =
        known && JSON.stringify(known.revision) === JSON.stringify(page.revision)
          ? known.changes
          : undefined
      this.rememberRevision(target, { revision: page.revision, ...(changes ? { changes } : {}) })
    }
    this.setProgress(target, 'reading')
  }
  loadFolder(path: string): Promise<void> {
    return this.loadDirectory(path, false)
  }
  loadMore(path = ''): Promise<void> {
    return this.loadDirectory(path, true)
  }
  private loadDirectory(path: string, more: boolean): Promise<void> {
    const target = this.current.value
    const tree = this.port.tree
    if (!target || !tree) return Promise.resolve()
    const key = pathTargetKey(target),
      requestKey = JSON.stringify([key, path])
    const pending = this.folderLoads.get(requestKey)
    if (pending !== undefined) return pending
    const cursor = this.cursors.value[key]?.[path]
    if (more ? !cursor : cursor !== undefined) return Promise.resolve()
    const retainedFolder = (entries: TreeEntry[]): TreeEntry | undefined => {
      for (const entry of entries) {
        if (entry.path === path) return entry
        const nested = retainedFolder(entry.children ?? [])
        if (nested) return nested
      }
    }
    if (!more && retainedFolder(this.inspections.value[key]?.entries ?? [])?.children !== undefined)
      return Promise.resolve()
    const read = this.serialTarget(target, async () => {
      if (this.disposed) return
      const epoch = this.resourceEpochs.get(key) ?? 0
      if (!this.online.value) throw new UiError(uiMessage('streamBError.b4836687ce'))
      this.setProgress(target, 'reading')
      const activeCursor = more ? this.cursors.value[key]?.[path] : undefined
      if (more && !activeCursor) return
      const revision = more
        ? this.pageRevisions.get(key)?.get(path)
        : this.knownRead(target)?.revision
      if (more && target.kind === 'worktree' && !revision)
        throw new UiError(uiMessage('streamBError.29f751894a'))
      const mark = this.batchMark(target)
      const page = await tree.call(this.port, target, path, activeCursor ?? undefined, revision)
      if (this.disposed || epoch !== (this.resourceEpochs.get(key) ?? 0)) return
      if (more && page.cursor === activeCursor)
        throw new UiError(uiMessage('streamBError.fd3e95b2aa'))
      this.publishPage(target, path, page, more)
      this.catchUp(target, mark)
      this.setProgress(target)
    }).catch((error: unknown) => {
      if (!this.disposed)
        this.setProgress(
          target,
          'failed',
          error instanceof Error ? error.message : 'Could not read folder'
        )
      throw error
    })
    const recovering = this.recoverRead(
      target,
      () => read,
      true,
      () => this.reloadTargetOnce(target)
    )
    this.folderLoads.set(requestKey, recovering)
    return recovering.finally(() => {
      if (this.folderLoads.get(requestKey) === recovering) this.folderLoads.delete(requestKey)
    })
  }
  private async readTarget(target: PathTarget, files: boolean): Promise<void> {
    if (this.disposed) return
    const epoch = this.resourceEpochs.get(pathTargetKey(target)) ?? 0
    const outdated = () =>
      this.disposed || epoch !== (this.resourceEpochs.get(pathTargetKey(target)) ?? 0)
    if (files && this.port.tree) {
      this.setProgress(target, 'reading')
      try {
        const mark = this.batchMark(target)
        const read = this.port.tree
        const tree = (
          at: PathTarget,
          path: string,
          cursor?: string,
          revision?: RepositoryRevision
        ) => read.call(this.port, at, path, cursor, revision)
        const first = await tree(target, '')
        if (outdated()) return
        // A refresh keeps the folders the person opened filled, and as many of each one's pages
        // as were loaded, while it reads each again at the new observation: a folder is swapped
        // in only once all of them are read, so the tree neither collapses, shortens nor jumps.
        const previous = this.inspections.value[pathTargetKey(target)]?.entries ?? []
        const opened: { path: string; loaded: number }[] = []
        const walk = (entries: TreeEntry[]) =>
          entries.forEach((entry) => {
            if (entry.children === undefined) return
            opened.push({ path: entry.path, loaded: entry.children.length })
            walk(entry.children)
          })
        walk(previous)
        const pages = async (path: string, page: PathTreePage, loaded: number) => {
          const entries = new Map(page.entries.map((entry) => [entry.path, entry]))
          let cursor = page.cursor
          while (cursor && entries.size < loaded && !this.disposed) {
            const next: PathTreePage = await tree(target, path, cursor, page.revision)
            if (next.cursor === cursor) break
            next.entries.forEach((entry) => entries.set(entry.path, entry))
            cursor = next.cursor
          }
          return { ...page, entries: [...entries.values()], cursor }
        }
        const page = await pages('', first, previous.length)
        if (outdated()) return
        this.publishPage(target, '', page, false, true)
        for (const { path, loaded } of opened) {
          try {
            const folder = await pages(
              path,
              await tree(target, path, undefined, page.revision),
              loaded
            )
            if (outdated()) return
            this.publishPage(target, path, folder, false, true)
          } catch (error) {
            console.debug('[Abele] node path: an opened folder was not read again', path, error)
            if (
              error instanceof ChannelError &&
              ['stale_resource', 'stale_revision', 'stale_cursor'].includes(error.code)
            )
              throw error
          }
        }
        this.catchUp(target, mark)
        await this.readTarget(target, false)
        if (!this.disposed) this.setProgress(target)
      } catch (error) {
        if (!this.disposed)
          this.setProgress(
            target,
            'failed',
            error instanceof Error ? error.message : 'Could not read folder'
          )
        throw error
      }
      return
    }
    const key = pathTargetKey(target),
      generation = (this.targetGenerations.get(key) ?? 0) + 1
    this.targetGenerations.set(key, generation)
    const treeGeneration = files ? (this.treeGenerations.get(key) ?? 0) + 1 : undefined
    if (treeGeneration !== undefined) this.treeGenerations.set(key, treeGeneration)
    let inspection: PathInspection
    const revision = this.knownRead(target)?.revision
    try {
      inspection = await this.port.inspect(target, files, revision)
    } catch (error) {
      if (!revision || !(error instanceof ChannelError) || error.code !== 'stale_revision')
        throw error
      // Recording writes can expire metadata after the tree was read. Keep that tree and
      // observe current metadata rather than restarting the entire listing and watch.
      inspection = await this.port.inspect(target, files, undefined)
    }
    if (outdated()) return
    const current = this.inspections.value[key]
    if (generation !== this.targetGenerations.get(key)) {
      // A metadata-only read must not cancel the only in-flight file listing. Keep the
      // newer metadata, but admit this tree unless another full listing superseded it.
      if (!files || treeGeneration !== this.treeGenerations.get(key)) return
      if (current) inspection = { ...current, entries: inspection.entries }
    } else if (!files && current) inspection.entries = current.entries
    this.inspections.value = { ...this.inspections.value, [key]: this.mark(target, inspection) }
    if (inspection.revision)
      this.rememberRevision(target, { revision: inspection.revision, changes: inspection.changes })
    this.receivedAt.value = this.now()
    this.decorate()
  }
  private mark(target: PathTarget, inspection: PathInspection): PathInspection {
    const changes = inspection.changes.map((c) => ({
      ...c,
      unseen: !!c.changeId && this.seen.get(this.seenKey(target, c.path)) !== c.changeId,
    }))
    const walk = (entries: TreeEntry[]): TreeEntry[] =>
      entries.map((e) => ({
        ...e,
        change: changes.find((c) => c.path === e.path),
        ...(e.children ? { children: walk(e.children) } : {}),
      }))
    return { ...inspection, changes, entries: walk(inspection.entries) }
  }
  private seenKey(target: PathTarget, path: string) {
    return JSON.stringify([target.nodeId, target.kind, target.id, path])
  }
  hasRetained(target: PathTarget, path: string, stage?: PathFileStage): boolean {
    return this.retained.has(JSON.stringify([pathTargetKey(target), path, stage, undefined]))
  }
  async openFile(
    target: PathTarget,
    path: string,
    stage?: PathFileStage,
    revision?: RepositoryRevision,
    publish: (document: PathDocument) => boolean = () => true,
    fresh = false
  ): Promise<PathDocument> {
    target = Object.freeze({ ...target })
    const cacheKey = JSON.stringify([pathTargetKey(target), path, stage, revision])
    if (!this.online.value) {
      const retained = this.retained.get(cacheKey)
      if (!retained) throw new UiError(uiMessage('streamBError.d6473017d0'))
      return uiFields(
        {
          ...retained.document,
          note: 'Offline · retained version. Reconnect to capture current bytes.',
        },
        { note: uiMessage('streamBError.cf3ad06448') },
        retained.document
      )
    }
    const key = pathTargetKey(target)
    let known = revision || fresh ? undefined : this.knownRead(target)
    let epoch = this.revisionEpochs.get(key) ?? 0
    let file: PathDocument
    try {
      file = await this.port.file({ ...target }, path, stage, revision, known)
    } catch (error) {
      if (!known || !(error instanceof ChannelError) || error.code !== 'stale_revision') throw error
      // An error from A must not delete B if a refresh won the race while A was in flight.
      if (epoch === (this.revisionEpochs.get(key) ?? 0)) this.invalidateRevision(target)
      known = this.knownRead(target)
      epoch = this.revisionEpochs.get(key) ?? 0
      file = await this.port.file({ ...target }, path, stage, revision, known)
    }
    if (this.disposed) return file
    if (
      pathTargetKey(file.target) !== key ||
      file.target.projectId !== target.projectId ||
      file.target.registrationId !== target.registrationId
    )
      throw new UiError(uiMessage('streamBError.4566a5a6f4'))
    if (!publish(file)) return file
    // An accepted display still owns its retained bytes even if target metadata advanced.
    // Only promotion into the shared working-revision cache is fenced by that epoch.
    if (
      !revision &&
      file.revision?.kind === 'working' &&
      epoch === (this.revisionEpochs.get(key) ?? 0)
    ) {
      const changes =
        known && JSON.stringify(known.revision) === JSON.stringify(file.revision)
          ? known.changes
          : undefined
      this.rememberRevision(target, { revision: file.revision, ...(changes ? { changes } : {}) })
    }
    const bytes =
      (file.image?.bytes.byteLength ?? 0) +
      new TextEncoder().encode(file.text + (file.change?.before ?? '') + (file.change?.after ?? ''))
        .length
    const previous = this.retained.get(cacheKey)
    if (previous) {
      this.retainedBytes -= previous.bytes
      this.retained.delete(cacheKey)
    }
    if (bytes <= 4 * 1024 * 1024) {
      this.retained.set(cacheKey, { document: file, bytes })
      this.retainedBytes += bytes
    }
    while (this.retainedBytes > 4 * 1024 * 1024) {
      const key = this.retained.keys().next().value!
      this.retainedBytes -= this.retained.get(key)!.bytes
      this.retained.delete(key)
    }
    // Frozen commits are not evidence that the current working change has been reviewed.
    if (!revision && file.change?.changeId) {
      this.seen.set(this.seenKey(target, path), file.change.changeId)
      const key = pathTargetKey(target),
        inspection = this.inspections.value[key]
      if (inspection)
        this.inspections.value = { ...this.inspections.value, [key]: this.mark(target, inspection) }
      this.decorate()
    }
    return file
  }
  private decorate(): void {
    this.folders.value = this.folders.value.map((folder) => ({
      ...folder,
      chats: !folder.git
        ? this.sessions.value
            .filter((s) => s.target?.projectId === folder.id && s.target.kind === 'workspace')
            .map((s) => ({
              ...chatActivity(s),
              when: formatTimestamp(s.session.created_at).label,
            }))
        : undefined,
      copies: folder.copies.map((copy) => {
        const target = this.targets.value.find((t) => t.id === copy.id)
        const inspection = target && this.inspections.value[pathTargetKey(target)]
        const chats = this.sessions.value
          .filter((s) => s.target?.id === copy.id && s.target?.kind === target?.kind)
          .map((s) => ({
            ...chatActivity(s),
            when: formatTimestamp(s.session.created_at).label,
          }))
        return {
          ...copy,
          chats,
          running: chats.some((c) => c.running),
          ...(inspection
            ? {
                changed: new Set(inspection.changes.map((c) => c.path)).size,
                unseen: inspection.changes.filter((c) => c.unseen).length,
                ahead: inspection.ahead,
                behind: inspection.behind,
                lastCommit: inspection.lastCommit,
              }
            : {}),
        }
      }),
    }))
  }
  copy(target: PathTarget): CopySummary | undefined {
    return this.folders.value
      .find((f) => f.id === target.projectId)
      ?.copies.find((c) => c.id === target.id)
  }
  /** A healthy peer reply retires only the transient connection banner. */
  connectionRecovered(): void {
    if (this.connectionError !== undefined && this.error.value === this.connectionError)
      uiField(this.error, 'value', uiErrorMessage(''))
    this.connectionError = undefined
  }
  report(error: unknown): void {
    uiField(
      this.error,
      'value',
      error instanceof Error ? uiErrorMessage(error) : uiMessage('streamBError.6097572d7b')
    )
    this.connectionError =
      error instanceof ChannelError && ['outcome_unknown', 'disconnected'].includes(error.code)
        ? this.error.value
        : undefined
  }
  destroy(): void {
    this.disposed = true
    ++this.selectionGeneration
    ++this.catalogueGeneration
    this.stopWatch?.()
    this.stopCatalog?.()
    this.stopWatch = this.stopCatalog = undefined
    for (const watched of this.targetWatches.values())
      void watched.stop.then((stop) => stop()).catch(() => {})
    this.targetWatches.clear()
    this.panelHistory.value?.destroy()
    this.retained.clear()
    this.retainedBytes = 0
  }
}

/** One replaceable file leaf owns its target, stage and request lifetime. */
export class NodePathFileModel {
  readonly markdownMode = ref<'preview' | 'code'>()
  readonly document = shallowRef<PathDocument>()
  readonly mode = ref<'diff' | 'file'>('diff')
  readonly busy = ref(false)
  readonly error = ref('')
  private generation = 0
  private stage?: PathFileStage
  private requested?: { path: string; stage?: PathFileStage }
  private busyRetry?: number
  get requestedPath(): string | undefined {
    return this.requested?.path
  }
  private stopRefresh: () => void
  private stopTarget?: () => void
  private disposed = false
  private watchVersion = -1
  constructor(
    readonly pathModel: NodePathModel,
    readonly target: PathTarget
  ) {
    this.target = Object.freeze({ ...target })
    markRaw(this)
    this.watchTarget()
    this.stopRefresh = watch(
      () => pathModel.fileRefresh?.value,
      (next, previous) => {
        const doc = this.document.value
        if (!doc) return
        const version = (values: Readonly<Record<string, number>> | undefined) =>
          pathModel.fileVersion?.(this.target, doc.path, values ?? {}) ??
          values?.[pathTargetKey(this.target)] ??
          0
        if (version(next) === version(previous)) return
        this.watchTarget()
        if (doc.revision?.kind === 'commit' || typeof this.stage === 'object') return
        void this.open(doc.path, this.stage, false, true).catch(() => {})
      }
    )
  }
  private watchTarget(): void {
    if (!this.pathModel.watchFileTarget) return
    const version = this.pathModel.fileWatchVersion(this.target)
    if (version === this.watchVersion) return
    this.watchVersion = version
    this.stopTarget?.()
    void this.pathModel
      .watchFileTarget(this.target)
      .then((stop) => {
        if (this.disposed || this.watchVersion !== version) stop()
        else this.stopTarget = stop
      })
      .catch((error: unknown) => {
        if (this.disposed || this.watchVersion !== version) return
        this.watchVersion = -1
        uiField(this.error, 'value', uiErrorMessage(error))
      })
  }
  async refresh(): Promise<void> {
    const request = this.requested
    if (request) await this.open(request.path, request.stage, true, true)
  }
  async open(
    path: string,
    stage?: PathFileStage,
    fresh = false,
    preserveMode = false
  ): Promise<void> {
    const generation = ++this.generation
    window.clearTimeout(this.busyRetry)
    this.requested = { path, stage }
    this.busy.value = true
    try {
      const file = await this.pathModel.openFile(
        this.target,
        path,
        stage,
        undefined,
        () => generation === this.generation,
        fresh
      )
      if (generation !== this.generation) return
      this.document.value = file
      this.stage = stage
      this.mode.value =
        preserveMode && this.mode.value === 'file' ? 'file' : file.change ? 'diff' : 'file'
      uiField(this.error, 'value', uiErrorMessage(''))
    } catch (error) {
      if (generation === this.generation) {
        uiField(
          this.error,
          'value',
          error instanceof Error ? uiErrorMessage(error) : uiMessage('streamBError.2bf254e296')
        )
        if (
          error instanceof Error &&
          (('code' in error && error.code === 'resource_busy') ||
            /\bresource_busy\b/.test(error.message))
        )
          this.busyRetry = window.setTimeout(() => {
            if (
              !this.disposed &&
              generation === this.generation &&
              this.pathModel.online?.value !== false
            )
              void this.refresh().catch((error) =>
                console.debug('[node] Busy file retry pending', error)
              )
          }, 2000)
      }
      throw error
    } finally {
      if (generation === this.generation) this.busy.value = false
    }
  }
  async step(by: 1 | -1): Promise<void> {
    const list = this.pathModel.inspections.value[pathTargetKey(this.target)]?.changes ?? []
    const at = list.findIndex((c) => c.path === this.document.value?.path)
    const next = list[(at + by + list.length) % list.length]
    if (next) await this.open(next.path, this.stage)
  }
  destroy(): void {
    this.disposed = true
    window.clearTimeout(this.busyRetry)
    this.stopTarget?.()
    this.stopRefresh()
    ++this.generation
  }
}
