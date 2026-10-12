import { computed, ref, shallowRef, markRaw } from 'vue'
import { formatTimestamp } from '@/helpers/displayFormat'
import { NodePathSnapshotSchema, emptySnapshotChange } from './nodePathSnapshot'
import type { NodeClient } from '@abele/node-client'
import type { RepositoryRevision } from '@abele/node-protocol'
import type {
  CommitSummary,
  CopySummary,
  FileChange,
  FolderSummary,
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
  revision?: RepositoryRevision
  change?: PathChange
  note?: string
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
  inspect(target: PathTarget, files?: boolean): Promise<PathInspection>
  file(
    target: PathTarget,
    path: string,
    stage?: 'staged' | 'unstaged',
    revision?: RepositoryRevision
  ): Promise<PathDocument>
  history(
    target: PathTarget,
    cursor?: string,
    revision?: RepositoryRevision
  ): Promise<{ entries: CommitSummary[]; cursor: string | null; revision?: RepositoryRevision }>
  commit(target: PathTarget, hash: string): Promise<CommitSummary>
  watch(target: PathTarget, notify: () => void): Promise<() => void>
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
  readonly mode = ref<'all' | 'changed'>('changed')
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
  private stopWatch?: () => void
  private stopCatalog?: () => void
  private refreshPromise?: Promise<void>
  private latestRead?: Promise<void>
  private dirty = false

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
    const stop = await this.port.subscribe(() => this.invalidate())
    if (this.disposed) {
      stop()
      return
    }
    this.stopCatalog = stop
    await this.refresh()
    if (!this.selected.value && this.targets.value[0]) await this.select(this.targets.value[0].id)
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
      for (const target of this.targets.value) {
        const missing = this.copy(target)?.missing
        if (!missing) await this.reloadTarget(target, this.current.value?.id === target.id)
        if (this.disposed || generation !== this.catalogueGeneration) return
      }
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
    const target = this.target(id)
    const generation = ++this.selectionGeneration
    this.selected.value = target.kind === 'workspace' ? target.projectId : id
    this.stopWatch?.()
    this.stopWatch = undefined
    if (!this.online.value) {
      if (!this.inspections.value[pathTargetKey(target)])
        throw new Error('This target’s files were not retained. Reconnect to load them.')
      this.mode.value = target.kind === 'worktree' && this.changes.value.length ? 'changed' : 'all'
      return
    }
    await this.reloadTarget(target)
    if (this.disposed || generation !== this.selectionGeneration) return
    this.mode.value = target.kind === 'worktree' && this.changes.value.length ? 'changed' : 'all'
    const stop = await this.port.watch(target, () => {
      void this.reloadTarget(target).catch((e) => this.report(e))
    })
    if (this.disposed || generation !== this.selectionGeneration) stop()
    else this.stopWatch = stop
  }
  async reloadTarget(target: PathTarget, files = true): Promise<void> {
    const key = pathTargetKey(target),
      generation = (this.targetGenerations.get(key) ?? 0) + 1
    this.targetGenerations.set(key, generation)
    const inspection = await this.port.inspect(target, files)
    if (this.disposed || generation !== this.targetGenerations.get(key)) return
    if (!files && this.inspections.value[key])
      inspection.entries = this.inspections.value[key].entries
    this.inspections.value = { ...this.inspections.value, [key]: this.mark(target, inspection) }
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
    const file = await this.port.file({ ...target }, path, stage, revision)
    if (this.disposed || !publish(file)) return file
    const bytes = new TextEncoder().encode(
      file.text + (file.change?.before ?? '') + (file.change?.after ?? '')
    ).length
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
