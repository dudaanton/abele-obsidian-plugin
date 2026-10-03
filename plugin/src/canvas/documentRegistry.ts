/** Host registry: TFile identity survives rename; cameras and selection remain leaf-local. */
import { TFile, type App, type EventRef } from 'obsidian'
import { CanvasSession, type GraphTransform } from './core/session'
import type { GraphSnapshot } from './core/service'

export interface CanvasDocumentState {
  generation: number
  dirty: boolean
  busy: boolean
  conflict: boolean
  writer: boolean
  native: boolean
  error: string | null
}
type Loader = () => Promise<GraphSnapshot>
type Listener = (document: CanvasDocument) => void
export interface CanvasDocumentLease {
  document: CanvasDocument
  release(): void
}
export class CanvasDocument {
  readonly session: CanvasSession
  readonly owners = new Map<object, Listener>()
  writer = false
  operations = 0
  error: string | null = null
  constructor(
    readonly file: TFile,
    snapshot: GraphSnapshot,
    readonly load: Loader,
    private readonly native: () => boolean,
    private readonly prune: () => void
  ) {
    this.session = new CanvasSession(snapshot)
  }
  get state(): CanvasDocumentState {
    return {
      generation: this.session.generation,
      dirty: this.session.dirty,
      busy: this.session.busy,
      conflict: this.session.conflict || (this.native() && (this.writer || this.session.dirty)),
      writer: this.writer,
      native: this.native(),
      error: this.error,
    }
  }
  acquireWriter(): void {
    if (this.native())
      throw new Error(
        'Native Canvas is active; settle its pending work before acquiring the Abele writer'
      )
    this.writer = true
    this.notify()
  }
  releaseWriter(): void {
    if (this.session.dirty || this.session.busy)
      throw new Error(
        'Pending canvas draft must be published or explicitly discarded before releasing the writer'
      )
    this.writer = false
    this.notify()
  }
  beginDraft(): void {
    if (this.native())
      throw new Error(
        'Native Canvas is active; settle its pending work before acquiring the Abele writer'
      )
    this.session.beginDraft()
    this.writer = true
    this.notify()
  }
  updateDraft(transform: GraphTransform): void {
    this.session.updateDraft(transform)
    this.notify()
  }
  finishDraft(): void {
    this.session.finishDraft()
    this.notify()
  }
  discardDraft(): void {
    this.session.discardDraft()
    this.notify()
  }
  reapplyDraft(transform: GraphTransform): void {
    this.session.reapplyDraft(transform)
    this.notify()
  }
  observe(snapshot: GraphSnapshot): void {
    this.session.externalChanged(snapshot)
    this.error = null
    this.notify()
  }
  notify(): void {
    for (const listener of this.owners.values()) {
      try {
        listener(this)
      } catch (error) {
        console.warn('Canvas observer failed', error)
      }
    }
    this.prune()
  }
}

const registries = new WeakMap<App, CanvasDocumentRegistry>()
export function canvasDocuments(app: App): CanvasDocumentRegistry {
  let registry = registries.get(app)
  if (!registry) {
    registry = new CanvasDocumentRegistry(app)
    registries.set(app, registry)
  }
  return registry
}
export class CanvasDocumentRegistry {
  private readonly documents = new Map<TFile, CanvasDocument>()
  private readonly queues = new Map<TFile | string, Promise<unknown>>()
  private readonly opening = new Set<TFile>()
  private vaultRefs: EventRef[] = []
  private workspaceRef: EventRef | null = null
  constructor(private readonly app: App) {}
  find(file: TFile): CanvasDocument | undefined {
    return this.documents.get(file)
  }
  retain(file: TFile): () => void {
    const document = this.documents.get(file)
    if (document) document.operations++
    return () => {
      if (document) {
        document.operations--
        this.prune(file)
      }
    }
  }
  async serial<T>(identity: TFile | string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(identity) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    this.queues.set(identity, current)
    try {
      return await current
    } finally {
      if (this.queues.get(identity) === current) this.queues.delete(identity)
    }
  }
  async flush(file: TFile): Promise<void> {
    while (this.queues.has(file)) await this.queues.get(file)?.catch(() => {})
  }
  async open(
    file: TFile,
    owner: object,
    load: Loader,
    listener: Listener = () => {}
  ): Promise<CanvasDocumentLease> {
    this.opening.add(file)
    this.listen()
    try {
      return await this.serial(file, async () => {
        let document = this.documents.get(file)
        if (!document) {
          document = new CanvasDocument(
            file,
            await load(),
            load,
            () =>
              (this.app.workspace?.getLeavesOfType('canvas') ?? []).some(
                (leaf) => (leaf.view as { file?: TFile }).file === file
              ),
            () => this.prune(file)
          )
          this.documents.set(file, document)
        }
        document.owners.set(owner, listener)
        document.notify()
        let released = false
        return {
          document,
          release: () => {
            if (released) return
            released = true
            document.owners.delete(owner)
            this.prune(file)
          },
        }
      })
    } finally {
      this.opening.delete(file)
      this.stopIfIdle()
    }
  }
  async reload(file: TFile): Promise<void> {
    await this.serial(file, async () => {
      const document = this.documents.get(file)
      if (!document) return
      try {
        document.observe(await document.load())
      } catch (error) {
        document.error = String(error)
        document.notify()
      }
    })
  }
  private listen(): void {
    if (this.vaultRefs.length) return
    const observe = (file: unknown) => {
      if (file instanceof TFile && (this.documents.has(file) || this.opening.has(file)))
        void this.reload(file)
    }
    this.vaultRefs = [
      this.app.vault.on('modify', observe),
      this.app.vault.on('rename', observe),
      this.app.vault.on('delete', observe),
    ]
    this.workspaceRef =
      this.app.workspace?.on?.('layout-change', () => {
        for (const document of this.documents.values()) document.notify()
      }) ?? null
  }
  private prune(file: TFile): void {
    const document = this.documents.get(file)
    if (
      !document ||
      document.owners.size ||
      document.operations ||
      document.session.dirty ||
      document.session.busy
    )
      return
    this.documents.delete(file)
    this.stopIfIdle()
  }
  private stopIfIdle(): void {
    if (this.documents.size || this.opening.size) return
    for (const ref of this.vaultRefs) this.app.vault.offref(ref)
    this.vaultRefs = []
    if (this.workspaceRef) this.app.workspace.offref(this.workspaceRef)
    this.workspaceRef = null
  }
  dispose(): void {
    if (
      [...this.documents.values()].some(
        (document) => document.operations || document.session.dirty || document.session.busy
      )
    )
      throw new Error('Pending canvas drafts must be recovered before registry disposal')
    this.documents.clear()
    this.stopIfIdle()
  }
}
