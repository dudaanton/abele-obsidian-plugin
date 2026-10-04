/** Thin vault adapter. All publishers share canonical-file queues and the final byte boundary. */
import { TFile, type App, type TextFileView } from 'obsidian'
import {
  canvasFingerprint,
  nativeCanvasFingerprint,
  cloneCanvas,
  parseCanvas,
  serializeCanvas,
  type CanvasGraph,
} from './core/model'
import type { GraphStore, GraphSnapshot } from './core/service'
import type { PreparedCanvasTransaction, GraphTransform } from './core/session'
import { canvasRevision, CANVAS_CONFLICT } from './core/revision'
import { parseCanvasFile } from './fileData'
import {
  canvasDocuments,
  type CanvasDocument,
  type CanvasDocumentLease,
  type CanvasDocumentState,
  type CanvasProposalOwner,
  type CanvasRecoveryAction,
} from './documentRegistry'

interface NativeCanvasView extends TextFileView {
  canvas: {
    getData(): unknown
    requestSave(history?: boolean): void
    requestPushHistory: { cancel?(): void }
    pushHistory(data: unknown): void
    history: { data: unknown[]; current: number }
  }
}
interface StoredSnapshot extends GraphSnapshot {
  bytes: string
  views: NativeCanvasView[]
}
export interface CanvasStoreSnapshot extends GraphSnapshot {
  state?: CanvasDocumentState
}
export interface CanvasWriteResult {
  before: CanvasGraph
  after: CanvasGraph
  revision: string
  warning?: string
  recovery?: CanvasRecoveryAction
}
export function canvasPath(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !input.endsWith('.canvas') ||
    input.startsWith('/') ||
    input.includes('\\') ||
    input.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.')) ||
    Array.from(input).some(
      (c) =>
        c.charCodeAt(0) < 32 || ['#', '|', '[', ']', '^', '*', '"', '<', '>', '?', ':'].includes(c)
    )
  )
    throw new Error('Use an exact safe vault-relative .canvas path')
  return input
}
export class ObsidianCanvasStore implements GraphStore {
  constructor(private readonly app: App) {}
  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(canvasPath(path))
    if (!(file instanceof TFile)) throw new Error(`Canvas file not found: ${path}`)
    return file
  }
  private canonical(file: TFile): void {
    if (
      !(file instanceof TFile) ||
      file.extension !== 'canvas' ||
      this.app.vault.getAbstractFileByPath(file.path) !== file
    )
      throw new Error(CANVAS_CONFLICT)
  }
  private views(file: TFile): NativeCanvasView[] {
    return (this.app.workspace?.getLeavesOfType('canvas') ?? [])
      .map((leaf) => leaf.view as NativeCanvasView)
      .filter((view) => view.file === file)
  }
  private async stored(file: TFile): Promise<StoredSnapshot> {
    this.canonical(file)
    const bytes = await this.app.vault.read(file),
      views = this.views(file)
    if (views.length > 1)
      throw new Error(
        'This diagram is open in multiple native editors; close duplicate tabs before reading a write revision'
      )
    // Validate stored bytes even when a native view still holds an older valid graph.
    // Empty-file normalization belongs to the shared file parser, not the graph validator.
    const persisted = parseCanvasFile(bytes)
    const graph = views[0] ? parseCanvas(views[0].canvas.getData()) : persisted
    return { graph, bytes, views, revision: await canvasRevision(bytes, graph) }
  }
  open(
    file: TFile,
    owner: object,
    listener?: (document: CanvasDocument) => void
  ): Promise<CanvasDocumentLease> {
    return canvasDocuments(this.app).open(file, owner, () => this.stored(file), listener)
  }
  private publicSnapshot(stored: GraphSnapshot, document?: CanvasDocument): CanvasStoreSnapshot {
    return document
      ? {
          graph: document.session.graph,
          revision: `${stored.revision}:abele-${document.incarnation}-${document.session.generation}`,
          state: document.state,
        }
      : { graph: cloneCanvas(stored.graph), revision: stored.revision }
  }
  private async capture(
    file: TFile
  ): Promise<{ stored: StoredSnapshot; document?: CanvasDocument; snapshot: CanvasStoreSnapshot }> {
    const stored = await this.stored(file),
      document = canvasDocuments(this.app).find(file)
    document?.observe(stored)
    return { stored, document, snapshot: this.publicSnapshot(stored, document) }
  }
  async snapshot(key: string): Promise<CanvasStoreSnapshot> {
    return this.snapshotFile(this.file(key))
  }
  snapshotFile(file: TFile): Promise<CanvasStoreSnapshot> {
    this.canonical(file)
    return canvasDocuments(this.app).serial(file, async () => (await this.capture(file)).snapshot)
  }
  async read(key: string): Promise<CanvasGraph> {
    return (await this.snapshot(key)).graph
  }
  async create(key: string, graph: CanvasGraph, signal?: AbortSignal): Promise<void> {
    const path = canvasPath(key),
      text = serializeCanvas(graph)
    await canvasDocuments(this.app).serial(path, async () => {
      signal?.throwIfAborted()
      if (this.app.vault.getAbstractFileByPath(path))
        throw new Error(`Canvas file already exists: ${path}`)
      const parts = path.split('/')
      parts.pop()
      let folder = ''
      for (const part of parts) {
        folder = folder ? `${folder}/${part}` : part
        if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder)
      }
      signal?.throwIfAborted()
      await this.app.vault.create(path, text)
    })
  }
  change(
    key: string,
    revision: string,
    transform: GraphTransform,
    signal?: AbortSignal,
    owner?: CanvasProposalOwner
  ): Promise<CanvasWriteResult> {
    return this.publish(this.file(key), key, revision, 'command', transform, signal, owner)
  }
  recover(
    key: string,
    revision: string,
    proposal: string,
    action: CanvasRecoveryAction,
    owner: CanvasProposalOwner,
    signal?: AbortSignal
  ): Promise<CanvasWriteResult> {
    return this.publish(this.file(key), key, revision, action, undefined, signal, owner, proposal)
  }
  /** Explicit local-user recovery, on an already canonical file rather than an agent path. */
  recoverFile(
    file: TFile,
    revision: string,
    proposal: string,
    action: CanvasRecoveryAction
  ): Promise<CanvasWriteResult> {
    this.canonical(file)
    return this.publish(
      file,
      file.path,
      revision,
      action,
      undefined,
      undefined,
      undefined,
      proposal
    )
  }
  publishDraft(file: TFile, signal?: AbortSignal): Promise<CanvasWriteResult> {
    return this.publish(file, file.path, undefined, 'draft', undefined, signal)
  }
  undo(key: string, revision: string, signal?: AbortSignal): Promise<CanvasWriteResult> {
    return this.publish(this.file(key), key, revision, 'undo', undefined, signal)
  }
  redo(key: string, revision: string, signal?: AbortSignal): Promise<CanvasWriteResult> {
    return this.publish(this.file(key), key, revision, 'redo', undefined, signal)
  }
  private publish(
    file: TFile,
    path: string,
    revision: string | undefined,
    kind: 'command' | 'draft' | 'undo' | 'redo' | CanvasRecoveryAction,
    transform?: GraphTransform,
    signal?: AbortSignal,
    owner?: CanvasProposalOwner,
    proposal?: string
  ): Promise<CanvasWriteResult> {
    const registry = canvasDocuments(this.app)
    return registry.serial(file, async () => {
      const release = registry.retain(file)
      let token: PreparedCanvasTransaction | undefined, document: CanvasDocument | undefined
      let recovered: ReturnType<CanvasDocument['requireRecovery']> | undefined
      try {
        signal?.throwIfAborted()
        if (file.path !== path)
          throw new Error('Canvas renamed before publication; reread its current path')
        const captured = await this.capture(file),
          snapshot = captured.stored
        document = captured.document
        if (kind !== 'draft' && (!revision || captured.snapshot.revision !== revision))
          throw new Error(CANVAS_CONFLICT)
        signal?.throwIfAborted()
        if (kind === 'retry' || kind === 'reapply' || kind === 'discard') {
          if (!document) throw new Error('No retained failed canvas proposal')
          recovered = document.requireRecovery(proposal, owner)
          if (file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file)
            throw new Error(CANVAS_CONFLICT)
          if (kind === 'discard') {
            document.discardDraft()
            const graph = cloneCanvas(snapshot.graph)
            return {
              before: graph,
              after: cloneCanvas(graph),
              revision: this.publicSnapshot(snapshot, document).revision,
              recovery: kind,
            }
          }
        }
        const view = snapshot.views[0]
        if (
          view &&
          document &&
          (document.writer || document.session.dirty || document.session.busy)
        )
          throw new Error(
            'Native Canvas and an Abele writer overlap; pending work is retained, retry after a safe handoff'
          )
        if (kind !== 'command' && (!document || view))
          throw new Error(
            'Canvas draft/history requires the active Abele session without a native writer'
          )
        if (document && !view) {
          if (kind === 'reapply') document.reapplyProposal(proposal)
          token =
            kind === 'draft' || kind === 'retry' || kind === 'reapply'
              ? document.session.prepareDraft()
              : kind === 'undo'
                ? document.session.prepareUndo()
                : kind === 'redo'
                  ? document.session.prepareRedo()
                  : document.session.prepare(transform)
        }
        signal?.throwIfAborted()
        let before: CanvasGraph | undefined, after: CanvasGraph | undefined
        const published = await this.app.vault.process(file, (current) => {
          signal?.throwIfAborted()
          if (file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file)
            throw new Error('Canvas renamed during publication; reread its current path')
          if (current !== snapshot.bytes) throw new Error(CANVAS_CONFLICT)
          const currentViews = this.views(file)
          if (
            currentViews.length !== snapshot.views.length ||
            currentViews.some((value, i) => value !== snapshot.views[i])
          )
            throw new Error(
              'Native Canvas writer changed at publication; pending work was not saved or discarded'
            )
          if (document && registry.find(file) !== document) throw new Error(CANVAS_CONFLICT)
          const data = view ? parseCanvas(view.canvas.getData()) : parseCanvasFile(current)
          if (canvasFingerprint(data) !== canvasFingerprint(snapshot.graph))
            throw new Error(CANVAS_CONFLICT)
          before = data
          after = token
            ? document.session.apply(token, { graph: data, revision: snapshot.revision })
            : parseCanvas(transform(cloneCanvas(data)))
          if (view) {
            // Preserve the native-only batch/undo seam; Abele never acquires its write role here.
            view.canvas.requestPushHistory.cancel?.()
            const previous = view.canvas.history.data[view.canvas.history.current]
            if (
              !previous ||
              nativeCanvasFingerprint(parseCanvas(previous)) !== nativeCanvasFingerprint(data)
            )
              view.canvas.pushHistory(data)
            const pendingSave = view.requestSave as (() => void) & { cancel?: () => void }
            pendingSave?.cancel?.()
          }
          return serializeCanvas(after)
        })
        if (!before || !after) throw new Error('Canvas storage did not run the transaction')
        const confirmed = { graph: after, revision: await canvasRevision(published, after) }
        // No abort check after publication: a confirmed write is a committed result, not a cancellation.
        if (token) {
          document.session.acknowledge(token, confirmed)
          document.clearRecovery()
        } else document?.observe(confirmed)
        document?.notify()
        let warning: string | undefined
        if (view) {
          try {
            const expected = nativeCanvasFingerprint(after),
              deadline = Date.now() + 3000
            while (nativeCanvasFingerprint(parseCanvas(view.canvas.getData())) !== expected) {
              if (Date.now() > deadline) {
                warning =
                  'Canvas batch was committed, but native display has not caught up; reread before editing again'
                break
              }
              await new Promise<void>((resolve) => window.setTimeout(resolve, 20))
            }
          } catch {
            warning =
              'Canvas batch was committed, but native reconciliation failed; reread before editing again'
          }
        }
        return {
          before,
          after,
          revision: this.publicSnapshot(confirmed, document).revision,
          ...(warning ? { warning } : {}),
          ...(kind === 'retry' || kind === 'reapply' ? { recovery: kind } : {}),
        }
      } catch (error) {
        if (token && document) {
          const existing = document.session.draft
          const stillOwned = recovered && document.ownsRecovery(recovered)
          try {
            document.session.reject(token)
            // Never relabel a newer human draft as agent-owned recovery work.
            if (!existing || stillOwned) {
              const failedOwner = recovered?.owner ?? owner,
                failedTransform = recovered?.transform ?? transform
              if (failedOwner && failedTransform)
                document.recordFailedProposal(failedOwner, failedTransform)
            }
          } catch {
            /* Explicit discard or supersession already revoked this token. */
          }
          document.notify()
        }
        throw error
      } finally {
        release()
      }
    })
  }
}
