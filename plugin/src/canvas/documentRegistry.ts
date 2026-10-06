/** Host registry: TFile identity survives rename; cameras and selection remain leaf-local. */
import { TFile, type App, type EventRef, type Plugin } from 'obsidian'
import { nanoid } from 'nanoid'
import { CanvasSession, type GraphTransform } from './core/session'
import type { GraphSnapshot } from './core/service'

export type CanvasRecoveryAction = 'retry' | 'reapply' | 'discard'
export type CanvasWriteTool = 'canvas_edit' | 'canvas_layout' | 'canvas_steps'
export interface CanvasProposalOwner {
  actor: string
  tool: CanvasWriteTool
}
export interface CanvasRecovery {
  proposal: string
  tool: CanvasWriteTool
  actions: CanvasRecoveryAction[]
}
interface FailedProposal {
  id: string
  generation: number
  owner: CanvasProposalOwner
  transform: GraphTransform
}
// The namespace also separates module reloads; the counter never reuses a live-module epoch.
const incarnationNamespace = nanoid()
let nextIncarnation = 0

export interface CanvasDocumentState {
  generation: number
  dirty: boolean
  busy: boolean
  conflict: boolean
  writer: boolean
  native: boolean
  error: string | null
  recovery?: CanvasRecovery
}
type Loader = () => Promise<GraphSnapshot>
type Listener = (document: CanvasDocument) => void
export interface CanvasDocumentLease {
  document: CanvasDocument
  release(): void
}
export class CanvasDocument {
  readonly session: CanvasSession
  readonly incarnation = `${incarnationNamespace}-${++nextIncarnation}`
  private failedProposal: FailedProposal | null = null
  private nextProposal = 0
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
    const recovery = this.recovery
    return {
      generation: this.session.generation,
      dirty: this.session.dirty,
      busy: this.session.busy,
      conflict: this.session.conflict || (this.native() && (this.writer || this.session.dirty)),
      writer: this.writer,
      native: this.native(),
      error: this.error,
      ...(recovery ? { recovery } : {}),
    }
  }
  get recovery(): CanvasRecovery | null {
    const proposal = this.failedProposal
    if (
      !proposal ||
      proposal.generation !== this.session.generation ||
      !this.session.dirty ||
      this.session.busy
    )
      return null
    return {
      proposal: proposal.id,
      tool: proposal.owner.tool,
      actions: this.native()
        ? ['discard']
        : this.session.conflict
          ? ['reapply', 'discard']
          : ['retry', 'reapply', 'discard'],
    }
  }
  requireRecovery(id: string, owner?: CanvasProposalOwner): FailedProposal {
    if (!this.recovery || this.recovery.proposal !== id)
      throw new Error('No matching failed agent proposal; human work was not changed')
    const proposal = this.failedProposal
    if (owner && proposal.owner.actor !== owner.actor)
      throw new Error('This failed proposal belongs to another owner')
    if (owner && proposal.owner.tool !== owner.tool)
      throw new Error(
        'This failed proposal belongs to another tool; use its original write permission'
      )
    return proposal
  }
  ownsRecovery(proposal: FailedProposal): boolean {
    // Starting or changing a human draft increments generation; publication itself does not.
    return (
      this.failedProposal === proposal &&
      proposal.generation === this.session.generation &&
      this.session.dirty
    )
  }
  recordFailedProposal(owner: CanvasProposalOwner, transform: GraphTransform): void {
    const draft = this.session.draft
    if (!draft || draft.active || this.session.busy) return
    this.failedProposal = {
      id: `${this.incarnation}:proposal-${++this.nextProposal}`,
      generation: this.session.generation,
      owner,
      transform,
    }
  }
  clearRecovery(): void {
    this.failedProposal = null
  }
  reapplyProposal(id: string): void {
    const proposal = this.requireRecovery(id)
    this.session.reapplyDraft(proposal.transform)
    proposal.generation = this.session.generation
    this.notify()
  }
  acquireWriter(): void {
    if (this.session.busy)
      throw new Error('Canvas session is busy; retry writer acquisition after publication settles')
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
    this.clearRecovery()
    this.writer = true
    this.notify()
  }
  updateDraft(transform: GraphTransform): void {
    this.session.updateDraft(transform)
    this.clearRecovery()
    this.notify()
  }
  finishDraft(): void {
    this.session.finishDraft()
    this.clearRecovery()
    this.notify()
  }
  discardDraft(): void {
    this.session.discardDraft()
    this.clearRecovery()
    this.notify()
  }
  reapplyDraft(transform: GraphTransform): void {
    this.session.reapplyDraft(transform)
    this.clearRecovery()
    this.notify()
  }
  observe(snapshot: GraphSnapshot): void {
    const owned = this.recovery ? this.failedProposal : null
    this.session.externalChanged(snapshot)
    if (owned) owned.generation = this.session.generation
    else this.clearRecovery()
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
  private readonly opening = new Map<TFile, number>()
  private vaultRefs: EventRef[] = []
  private workspaceRef: EventRef | null = null
  private closed = false
  constructor(private readonly app: App) {}
  registerLifecycle(plugin: Pick<Plugin, 'register'>): void {
    plugin.register(() => {
      // Unload must detach observers even when pending work prevents ordinary disposal.
      this.closed = true
      this.stopListening()
      if (registries.get(this.app) === this) registries.delete(this.app)
    })
  }
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
    this.opening.set(file, (this.opening.get(file) ?? 0) + 1)
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
        const subscribed: Listener = (current) => listener(current)
        document.owners.set(owner, subscribed)
        document.notify()
        let released = false
        return {
          document,
          release: () => {
            if (released) return
            released = true
            if (document.owners.get(owner) === subscribed) document.owners.delete(owner)
            this.prune(file)
          },
        }
      })
    } finally {
      const remaining = this.opening.get(file) - 1
      if (remaining) this.opening.set(file, remaining)
      else this.opening.delete(file)
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
    if (this.closed || this.vaultRefs.length) return
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
    this.stopListening()
  }
  private stopListening(): void {
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
