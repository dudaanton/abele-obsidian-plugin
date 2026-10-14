import { computed, ref, shallowRef, markRaw } from 'vue'
import { ChannelError } from '@abele/channel-protocol'
import { formatTimestamp } from '@/helpers/displayFormat'
import { NodePathSnapshotSchema, emptySnapshotChange } from './nodePathSnapshot'
import { applyPathChanges, type PathTreeBatch } from './nodePathChanges'
import type { NodeClient } from '@abele/node-client'
import type { RepositoryRevision } from '@abele/node-protocol'
import type {
  CommitSummary,
  CopySummary,
  FileChange,
  FileTreeMode,
  FolderSummary,
  NodeImagePreview,
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
  }[]
  capabilities: string[]
}
/** Transport-independent product port. Wire validation belongs to the node client. */
export interface NodePathPort {
  catalogue(): Promise<PathCatalogue>
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
    stage?: 'staged' | 'unstaged',
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
}
export interface SeenChanges {
  get(key: string): string | undefined
  set(key: string, changeId: string): void
}

export class NodePathModel {
  readonly folders = shallowRef<FolderSummary[]>([])
  readonly selected = ref('')
  readonly selectedChat = ref('')
  readonly mode = ref<FileTreeMode>('changed')
  readonly receivedAt = ref('')
  readonly error = ref('')
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
    this.folders.value.find((f) => f.id === this.current.value?.projectId)
  )
  readonly currentCopy = computed(() =>
    this.currentFolder.value?.copies.find((c) => c.id === this.selected.value)
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
        chats: c.chats?.map((chat) => ({ ...chat, running: false })),
      })),
      chats: f.chats?.map((chat) => ({ ...chat, running: false })),
    }))
    this.targets.value = value.targets
    this.selected.value = value.selected
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
    if (!target) throw new Error('This target is no longer available. Refresh its folder.')
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
    await this.refresh()
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
    await Promise.all([this.refresh(), target ? this.reloadTarget(target) : Promise.resolve()])
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
      const catalogue = await this.port.catalogue()
      if (this.disposed || generation !== this.catalogueGeneration) return
      this.targets.value = catalogue.targets.map((t) => ({ ...t }))
      this.sessions.value = catalogue.sessions
      this.capabilities.value = catalogue.capabilities
      this.folders.value = catalogue.folders
      this.decorate()
      if (this.disposed || generation !== this.catalogueGeneration) return
      this.receivedAt.value = this.now()
      this.error.value = ''
    } catch (error) {
      if (generation === this.catalogueGeneration) this.report(error)
      throw error
    } finally {
      if (generation === this.catalogueGeneration) this.busy.value = false
    }
  }
  async select(id: string): Promise<void> {
    return this.selectTarget(this.target(id))
  }
  async selectTarget(target: PathTarget, copy?: CopySummary): Promise<void> {
    if (target.nodeId !== this.nodeId || target.registrationId !== this.registrationId)
      throw new Error('This target belongs to another node registration.')
    if (!this.targets.value.some((entry) => pathTargetKey(entry) === pathTargetKey(target)))
      this.targets.value = [...this.targets.value, { ...target }]
    if (copy)
      this.folders.value = this.folders.value.map((folder) =>
        folder.id === target.projectId
          ? { ...folder, copies: [...folder.copies.filter((entry) => entry.id !== copy.id), copy] }
          : folder
      )
    const generation = ++this.selectionGeneration
    this.selected.value = target.kind === 'workspace' ? target.projectId : target.id
    this.stopWatch?.()
    this.stopWatch = undefined
    if (!this.online.value) {
      if (!this.inspections.value[pathTargetKey(target)])
        throw new Error('This target’s files were not retained. Reconnect to load them.')
      this.mode.value =
        target.kind === 'worktree' && this.changes.value.length ? 'changed-tree' : 'all'
      return
    }
    // The watch comes first and the files are read after it, once: a read before it could miss
    // what changed until the stream started, and reading again would race whatever comes next.
    let stop: (() => void) | undefined, watchError: unknown
    try {
      stop = await this.port.watch(
        target,
        () => {
          void this.reloadTarget(target).catch((e) => {
            // The tree already says it failed, with a retry, without moving its rows; a notice
            // over it would push them down on every failed background read.
            if (this.progress.value[pathTargetKey(target)]?.state === 'failed')
              console.debug('[Abele] node path: reading the files again failed', e)
            else this.report(e)
          })
        },
        (batch) => this.applyBatch(target, batch)
      )
    } catch (error) {
      watchError = error
    }
    if (this.disposed || generation !== this.selectionGeneration) {
      stop?.()
      return
    }
    this.stopWatch = stop
    const pending = this.treeLoads.get(pathTargetKey(target))
    await (pending?.promise ?? this.reloadTarget(target))
    if (this.disposed || generation !== this.selectionGeneration) return
    this.mode.value =
      target.kind === 'worktree' && this.changes.value.length ? 'changed-tree' : 'all'
    if (watchError) throw watchError
  }
  async reloadTarget(target: PathTarget, files = true): Promise<void> {
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
      } while (load.dirty && !this.disposed)
    })().finally(() => {
      this.treeLoads.delete(key)
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
    this.invalidateRevision(target)
    this.patch(target, batch.entries)
    const listed = new Set((this.inspections.value[key]?.changes ?? []).map((c) => c.path))
    const touched = batch.entries.some((c) =>
      c.change === 'deleted'
        ? listed.has(c.path)
        : listed.has(c.entry.path) || (c.change === 'renamed' && listed.has(c.from))
    )
    if (batch.git || touched)
      void this.serialTarget(target, () => this.readTarget(target, false)).catch((e) =>
        this.report(e)
      )
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
      if (!this.online.value) throw new Error('Reconnect to load this folder’s unretained entries.')
      this.setProgress(target, 'reading')
      const activeCursor = more ? this.cursors.value[key]?.[path] : undefined
      if (more && !activeCursor) return
      const revision = more
        ? this.pageRevisions.get(key)?.get(path)
        : this.knownRead(target)?.revision
      if (more && target.kind === 'worktree' && !revision)
        throw new Error('Refresh the folder before continuing its expired listing.')
      const mark = this.batchMark(target)
      const page = await tree.call(this.port, target, path, activeCursor ?? undefined, revision)
      if (this.disposed) return
      if (more && page.cursor === activeCursor) throw new Error('Node pagination did not advance')
      this.publishPage(target, path, page, more)
      this.catchUp(target, mark)
      this.setProgress(target)
    })
      .catch((error: unknown) => {
        if (!this.disposed)
          this.setProgress(
            target,
            'failed',
            error instanceof Error ? error.message : 'Could not read folder'
          )
        throw error
      })
      .finally(() => this.folderLoads.delete(requestKey))
    this.folderLoads.set(requestKey, read)
    return read
  }
  private async readTarget(target: PathTarget, files: boolean): Promise<void> {
    if (this.disposed) return
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
        if (this.disposed) return
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
        if (this.disposed) return
        this.publishPage(target, '', page, false, true)
        for (const { path, loaded } of opened) {
          try {
            const folder = await pages(
              path,
              await tree(target, path, undefined, page.revision),
              loaded
            )
            if (this.disposed) return
            this.publishPage(target, path, folder, false, true)
          } catch (error) {
            console.debug('[Abele] node path: an opened folder was not read again', path, error)
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
    let inspection = await this.port.inspect(target, files, this.knownRead(target)?.revision)
    if (this.disposed) return
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
  hasRetained(target: PathTarget, path: string, stage?: 'staged' | 'unstaged'): boolean {
    return this.retained.has(JSON.stringify([pathTargetKey(target), path, stage, undefined]))
  }
  async openFile(
    target: PathTarget,
    path: string,
    stage?: 'staged' | 'unstaged',
    revision?: RepositoryRevision,
    publish: (document: PathDocument) => boolean = () => true
  ): Promise<PathDocument> {
    target = Object.freeze({ ...target })
    const cacheKey = JSON.stringify([pathTargetKey(target), path, stage, revision])
    if (!this.online.value) {
      const retained = this.retained.get(cacheKey)
      if (!retained)
        throw new Error('This file is not retained on this device. Reconnect to open it.')
      return {
        ...retained.document,
        note: 'Offline · retained version. Reconnect to capture current bytes.',
      }
    }
    const key = pathTargetKey(target)
    let known = revision ? undefined : this.knownRead(target)
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
      throw new Error('The file response belongs to another target.')
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
              id: s.session.session_id,
              title: s.session.title,
              running: s.running,
              when: formatTimestamp(s.session.created_at).label,
            }))
        : undefined,
      copies: folder.copies.map((copy) => {
        const target = this.targets.value.find((t) => t.id === copy.id)
        const inspection = target && this.inspections.value[pathTargetKey(target)]
        const chats = this.sessions.value
          .filter((s) => s.target?.id === copy.id && s.target?.kind === target?.kind)
          .map((s) => ({
            id: s.session.session_id,
            title: s.session.title,
            running: s.running,
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
  report(error: unknown): void {
    this.error.value = error instanceof Error ? error.message : 'Could not load the node'
  }
  destroy(): void {
    this.disposed = true
    ++this.selectionGeneration
    ++this.catalogueGeneration
    this.stopWatch?.()
    this.stopCatalog?.()
    this.stopWatch = this.stopCatalog = undefined
    this.retained.clear()
    this.retainedBytes = 0
  }
}

/** One replaceable file leaf owns its target, stage and request lifetime. */
export class NodePathFileModel {
  readonly document = shallowRef<PathDocument>()
  readonly mode = ref<'diff' | 'file'>('diff')
  readonly busy = ref(false)
  readonly error = ref('')
  private generation = 0
  private stage?: 'staged' | 'unstaged'
  constructor(
    readonly pathModel: NodePathModel,
    readonly target: PathTarget
  ) {
    this.target = Object.freeze({ ...target })
    markRaw(this)
  }
  async open(path: string, stage?: 'staged' | 'unstaged'): Promise<void> {
    const generation = ++this.generation
    this.busy.value = true
    try {
      const file = await this.pathModel.openFile(
        this.target,
        path,
        stage,
        undefined,
        () => generation === this.generation
      )
      if (generation !== this.generation) return
      this.document.value = file
      this.stage = stage
      this.mode.value = file.change ? 'diff' : 'file'
      this.error.value = ''
    } catch (error) {
      if (generation === this.generation)
        this.error.value = error instanceof Error ? error.message : 'Could not read file'
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
    ++this.generation
  }
}
