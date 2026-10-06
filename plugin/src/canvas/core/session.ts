/** Portable document state. Hosts publish at their atomic storage boundary, then acknowledge. */
import { cloneCanvas, type CanvasGraph, type CanvasNode, type CanvasEdge } from './model'
import type { GraphSnapshot } from './service'
import {
  nodeReferencesPath,
  renameCanvasReferences,
  renameCanvasNodeReferences,
  type CanvasReferenceRename,
} from './references'

export type GraphTransform = (graph: CanvasGraph) => CanvasGraph
export type CanvasPublicationOutcome = 'unknown' | 'written-acknowledgment-pending'
export interface CanvasPublicationEvidence {
  outcome: CanvasPublicationOutcome
  baseline: GraphSnapshot
  proposed: CanvasGraph
  kind: 'command' | 'undo' | 'redo'
}
export type SessionErrorCode = 'busy' | 'conflict' | 'stale' | 'no-draft' | 'empty-history'
export class CanvasSessionError extends Error {
  constructor(readonly code: SessionErrorCode) {
    super(`Canvas session: ${code}`)
  }
}
export interface CanvasDraft {
  graph: CanvasGraph
  baseRevision: string
  active: boolean
}
/** Identity is session-owned. The graph getter returns a detached preview, not a writable plan. */
export interface PreparedCanvasTransaction {
  readonly revision: string
  readonly generation: number
  readonly graph: CanvasGraph
}
interface FieldChange {
  key: string
  before: unknown
  after: unknown
}
interface ElementChange<T> {
  id: string
  before: T | undefined
  after: T | undefined
}
interface CollectionPatch<T> {
  changes: ElementChange<T>[]
  order: { before: string[]; after: string[] } | null
}
interface GraphPatch {
  fields: FieldChange[]
  nodes: CollectionPatch<CanvasNode>
  edges: CollectionPatch<CanvasEdge>
}
interface Preparation {
  token: PreparedCanvasTransaction
  before: CanvasGraph
  after: CanvasGraph
  patch: GraphPatch
  kind: 'command' | 'undo' | 'redo'
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => equal(value, b[i]))
    )
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = Object.keys(a),
      right = Object.keys(b)
    return (
      left.length === right.length &&
      left.every(
        (key) =>
          Object.hasOwn(b, key) &&
          equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      )
    )
  }
  return false
}
function collectionPatch<T extends { id: string }>(before: T[], after: T[]): CollectionPatch<T> {
  const left = new Map(before.map((value) => [value.id, value])),
    right = new Map(after.map((value) => [value.id, value])),
    changes: ElementChange<T>[] = []
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    if (!equal(left.get(id), right.get(id)))
      changes.push({ id, before: left.get(id), after: right.get(id) })
  }
  const beforeIds = before.map((value) => value.id),
    afterIds = after.map((value) => value.id)
  return {
    changes,
    order: equal(beforeIds, afterIds) ? null : { before: beforeIds, after: afterIds },
  }
}
function graphPatch(before: CanvasGraph, after: CanvasGraph): GraphPatch {
  const fields: FieldChange[] = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key !== 'nodes' && key !== 'edges' && !equal(before[key], after[key]))
      fields.push({ key, before: before[key], after: after[key] })
  }
  return {
    fields,
    nodes: collectionPatch(before.nodes, after.nodes),
    edges: collectionPatch(before.edges, after.edges),
  }
}
function applyCollection<T extends { id: string }>(
  current: T[],
  patch: CollectionPatch<T>,
  reverse: boolean
): T[] {
  const from = reverse ? 'after' : 'before',
    to = reverse ? 'before' : 'after',
    index = new Map(current.map((value) => [value.id, value]))
  if (
    patch.order &&
    !equal(
      current.map((value) => value.id),
      patch.order[from]
    )
  )
    throw new CanvasSessionError('conflict')
  for (const change of patch.changes) {
    if (!equal(index.get(change.id), change[from])) throw new CanvasSessionError('conflict')
    const replacement = change[to]
    if (replacement === undefined) index.delete(change.id)
    else index.set(change.id, replacement)
  }
  return patch.order ? patch.order[to].map((id) => index.get(id)) : [...index.values()]
}
/** Guarded preimages, identity-addressed elements and explicit stacking, never stale file restoration. */
function applyPatch(current: CanvasGraph, patch: GraphPatch, reverse: boolean): CanvasGraph {
  const graph = cloneCanvas(current),
    from = reverse ? 'after' : 'before',
    to = reverse ? 'before' : 'after'
  for (const field of patch.fields) {
    if (!equal(graph[field.key], field[from])) throw new CanvasSessionError('conflict')
    if (field[to] === undefined) delete graph[field.key]
    else
      Object.defineProperty(graph, field.key, {
        value: field[to],
        enumerable: true,
        configurable: true,
        writable: true,
      })
  }
  graph.nodes = applyCollection(graph.nodes, patch.nodes, reverse)
  graph.edges = applyCollection(graph.edges, patch.edges, reverse)
  return cloneCanvas(graph)
}
function copySnapshot(snapshot: GraphSnapshot): GraphSnapshot {
  if (!snapshot.revision) throw new CanvasSessionError('stale')
  return { graph: cloneCanvas(snapshot.graph), revision: snapshot.revision }
}

export class CanvasSession {
  private baseline: GraphSnapshot
  private version = 0
  private preview: CanvasDraft | null = null
  private conflicted = false
  private prepared: Preparation | null = null
  private publishing = false
  private unsettledPublication: {
    identity: object
    outcome: CanvasPublicationOutcome
    preparation: Preparation
  } | null = null
  private undoJournal: GraphPatch[] = []
  private redoJournal: GraphPatch[] = []
  private journalRevision: string
  private readonly historyLimit: number

  constructor(snapshot: GraphSnapshot, options: { historyLimit?: number } = {}) {
    this.baseline = copySnapshot(snapshot)
    this.journalRevision = snapshot.revision
    this.historyLimit = options.historyLimit ?? 100
    if (!Number.isSafeInteger(this.historyLimit) || this.historyLimit < 0)
      throw new Error('Canvas history limit must be a nonnegative safe integer')
  }
  get committed(): GraphSnapshot {
    return copySnapshot(this.baseline)
  }
  get generation(): number {
    return this.version
  }
  get draft(): CanvasDraft | null {
    return this.preview ? { ...this.preview, graph: cloneCanvas(this.preview.graph) } : null
  }
  get graph(): CanvasGraph {
    return cloneCanvas(this.preview?.graph ?? this.baseline.graph)
  }
  get busy(): boolean {
    return this.publishing || !!this.preview?.active
  }
  get dirty(): boolean {
    return this.preview !== null
  }
  get conflict(): boolean {
    return this.conflicted
  }
  get publicationOutcome(): CanvasPublicationOutcome | null {
    return this.unsettledPublication?.outcome ?? null
  }
  /** Opaque unresolved-attempt identity; not the revoked publication token. */
  get publicationAttempt(): object | null {
    return this.unsettledPublication?.identity ?? null
  }
  /** A reviewed local discard removes memory only, without acknowledging or advancing history. */
  discardPublication(attempt: object, generation: number): void {
    if (
      !this.unsettledPublication ||
      this.unsettledPublication.identity !== attempt ||
      this.version !== generation ||
      this.busy
    )
      throw new CanvasSessionError('stale')
    this.discardDraft()
  }
  /** Detached historical evidence, never a publication or acknowledgment capability. */
  get publicationEvidence(): CanvasPublicationEvidence | null {
    if (!this.unsettledPublication) return null
    const { outcome, preparation } = this.unsettledPublication
    return {
      outcome,
      baseline: { graph: cloneCanvas(preparation.before), revision: preparation.token.revision },
      proposed: cloneCanvas(preparation.after),
      kind: preparation.kind,
    }
  }
  get history(): { undo: number; redo: number } {
    return { undo: this.undoJournal.length, redo: this.redoJournal.length }
  }

  /** Include deleted cards in history: undo must not bring their old paths back. */
  referencesPath(path: string, textOnly = false, source = ''): boolean {
    const matches = (node: CanvasNode | undefined) =>
      node && (!textOnly || node.type === 'text') && nodeReferencesPath(node, path, source)
    return (
      [this.baseline.graph, this.preview?.graph, this.prepared?.after].some((graph) =>
        graph?.nodes.some(matches)
      ) ||
      [...this.undoJournal, ...this.redoJournal].some((patch) =>
        patch.nodes.changes.some((change) => [change.before, change.after].some(matches))
      )
    )
  }
  invalidateReferences(): void {
    this.version++ // Revoke prepared writes and delayed approvals immediately, before native rewriting.
  }
  /** Rebase only a proven reference-only native rewrite, never an external content edit. */
  reconcileReferences(snapshot: GraphSnapshot, renames: readonly CanvasReferenceRename[]): boolean {
    if (
      this.publishing ||
      this.unsettledPublication ||
      this.conflicted ||
      !equal(renameCanvasReferences(this.baseline.graph, renames), snapshot.graph)
    )
      return false
    const previous = this.baseline.revision
    if (this.preview && this.preview.baseRevision !== previous) return false
    const patchReferences = (patch: GraphPatch): GraphPatch => ({
      ...patch,
      nodes: {
        ...patch.nodes,
        changes: patch.nodes.changes.map((change) => ({
          ...change,
          before: change.before && renames.reduce(renameCanvasNodeReferences, change.before),
          after: change.after && renames.reduce(renameCanvasNodeReferences, change.after),
        })),
      },
    })
    if (this.preview)
      this.preview = {
        ...this.preview,
        graph: renameCanvasReferences(this.preview.graph, renames),
        baseRevision: snapshot.revision,
      }
    this.undoJournal = this.undoJournal.map(patchReferences)
    this.redoJournal = this.redoJournal.map(patchReferences)
    if (this.journalRevision === previous) this.journalRevision = snapshot.revision
    this.baseline = copySnapshot(snapshot)
    this.prepared = null
    this.version++
    return true
  }

  beginDraft(): void {
    if (this.busy) throw new CanvasSessionError('busy')
    if (this.conflicted) throw new CanvasSessionError('conflict')
    this.preview = this.preview
      ? { ...this.preview, active: true }
      : {
          graph: cloneCanvas(this.baseline.graph),
          baseRevision: this.baseline.revision,
          active: true,
        }
    this.version++
  }
  updateDraft(transform: GraphTransform): void {
    if (this.publishing) throw new CanvasSessionError('busy')
    if (!this.preview?.active) throw new CanvasSessionError('no-draft')
    const graph = this.transform(this.preview.graph, transform)
    this.preview = { ...this.preview, graph }
    this.version++
  }
  finishDraft(): void {
    if (this.publishing) throw new CanvasSessionError('busy')
    if (!this.preview?.active) throw new CanvasSessionError('no-draft')
    this.preview = { ...this.preview, active: false }
    this.version++
  }
  discardDraft(): void {
    if (this.publishing) throw new CanvasSessionError('busy')
    this.preview = null
    this.conflicted = false
    this.unsettledPublication = null
    this.prepared = null // Explicit discard revokes recovery as well as publication.
    this.version++
  }
  /** Explicit host-chosen recovery on the latest baseline; no guessed merge of someone else's text. */
  reapplyDraft(transform: GraphTransform): void {
    if (this.busy) throw new CanvasSessionError('busy')
    if (!this.preview) throw new CanvasSessionError('no-draft')
    const graph = this.transform(this.baseline.graph, transform)
    this.preview = { graph, baseRevision: this.baseline.revision, active: false }
    this.conflicted = false
    this.unsettledPublication = null
    this.version++
  }

  private writable(allowDraft = false): void {
    if (this.busy) throw new CanvasSessionError('busy')
    if (this.conflicted) throw new CanvasSessionError('conflict')
    if (this.preview && !allowDraft) throw new CanvasSessionError('busy')
  }
  private stage(
    after: CanvasGraph,
    kind: Preparation['kind'],
    patch?: GraphPatch
  ): PreparedCanvasTransaction {
    if (this.publishing) throw new CanvasSessionError('busy')
    const before = cloneCanvas(this.baseline.graph),
      graph = cloneCanvas(after)
    const token: PreparedCanvasTransaction = Object.freeze({
      revision: this.baseline.revision,
      generation: this.version,
      get graph() {
        return cloneCanvas(graph)
      },
    })
    this.prepared = { token, before, after: graph, patch: patch ?? graphPatch(before, graph), kind }
    return token
  }
  private transform(input: CanvasGraph, transform: GraphTransform): CanvasGraph {
    const generation = this.version,
      preparation = this.prepared
    const graph = cloneCanvas(transform(cloneCanvas(input)))
    // Preparation replacement and publication start need not change document generation.
    if (generation !== this.version || preparation !== this.prepared || this.publishing)
      throw new CanvasSessionError('stale')
    return graph
  }
  /** Existing edit/layout/steps planners can be composed into one command on a detached clone. */
  prepare(transform: GraphTransform): PreparedCanvasTransaction {
    this.writable()
    return this.stage(this.transform(this.baseline.graph, transform), 'command')
  }
  prepareDraft(): PreparedCanvasTransaction {
    this.writable(true)
    if (!this.preview) throw new CanvasSessionError('no-draft')
    if (this.preview.baseRevision !== this.baseline.revision)
      throw new CanvasSessionError('conflict')
    return this.stage(this.preview.graph, 'command')
  }
  private prepareHistory(reverse: boolean): PreparedCanvasTransaction {
    this.writable()
    if (this.journalRevision !== this.baseline.revision) throw new CanvasSessionError('conflict')
    const journal = reverse ? this.undoJournal : this.redoJournal,
      patch = journal[journal.length - 1]
    if (!patch) throw new CanvasSessionError('empty-history')
    return this.stage(
      applyPatch(this.baseline.graph, patch, reverse),
      reverse ? 'undo' : 'redo',
      patch
    )
  }
  prepareUndo(): PreparedCanvasTransaction {
    return this.prepareHistory(true)
  }
  prepareRedo(): PreparedCanvasTransaction {
    return this.prepareHistory(false)
  }

  private matching(token: PreparedCanvasTransaction): Preparation {
    if (
      !this.prepared ||
      this.prepared.token !== token ||
      token.generation !== this.version ||
      token.revision !== this.baseline.revision
    )
      throw new CanvasSessionError('stale')
    return this.prepared
  }
  /** Call synchronously inside the storage transform, with its current effective snapshot. */
  apply(token: PreparedCanvasTransaction, current: GraphSnapshot): CanvasGraph {
    const prepared = this.matching(token)
    this.writable(true)
    if (current.revision !== token.revision || !equal(current.graph, prepared.before))
      throw new CanvasSessionError('stale')
    const graph = cloneCanvas(prepared.after)
    this.publishing = true
    return graph
  }
  /** Only a confirmed storage result may advance the committed baseline or history. */
  acknowledge(token: PreparedCanvasTransaction, confirmed: GraphSnapshot): void {
    const prepared = this.prepared
    if (
      !prepared ||
      prepared.token !== token ||
      !this.publishing ||
      !confirmed.revision ||
      !equal(confirmed.graph, prepared.after)
    )
      throw new CanvasSessionError('stale')
    const snapshot = copySnapshot(confirmed)
    // Once publication began, a modify callback may have observed this write or a later one.
    // Confirmation still records this transaction, but must never restore an older baseline.
    const observedExternal = this.baseline.revision !== token.revision
    if (prepared.kind === 'command') {
      if (this.journalRevision !== token.revision) this.undoJournal = []
      this.redoJournal = []
      if (!equal(prepared.before, prepared.after)) this.undoJournal.push(prepared.patch)
      if (this.undoJournal.length > this.historyLimit) this.undoJournal.shift()
    } else if (prepared.kind === 'undo') {
      this.undoJournal.pop()
      this.redoJournal.push(prepared.patch)
    } else {
      this.redoJournal.pop()
      this.undoJournal.push(prepared.patch)
    }
    if (!observedExternal) this.baseline = snapshot
    this.journalRevision = confirmed.revision
    this.preview = null
    this.conflicted = false
    this.prepared = null
    this.publishing = false
    this.version++
  }
  /**
   * Retain issued work without guessing its acknowledgment. Revoke the attempted capability,
   * not its draft, baseline or history. Source observation alone cannot settle this barrier;
   * existing explicit discard/reapplication remains available after review.
   */
  quarantine(token: PreparedCanvasTransaction, outcome: CanvasPublicationOutcome): void {
    const prepared = this.prepared
    if (!prepared || prepared.token !== token || !this.publishing)
      throw new CanvasSessionError('stale')
    this.preview ??= {
      graph: cloneCanvas(prepared.after),
      baseRevision: token.revision,
      active: false,
    }
    this.unsettledPublication = { identity: Object.freeze({}), outcome, preparation: prepared }
    this.conflicted = true
    this.publishing = false
    this.prepared = null
    this.version++
  }
  /** Reject only when the host knows no write occurred. After a write, acknowledge even on abort. */
  reject(token: PreparedCanvasTransaction): void {
    const prepared = this.prepared
    if (!prepared || prepared.token !== token) throw new CanvasSessionError('stale')
    // Settlement requires ownership, not permission to publish on the old baseline.
    // External invalidation or a newer human draft may have made application stale.
    // Preserve that draft, or retain the still-owned proposal for explicit recovery.
    this.preview ??= {
      graph: cloneCanvas(prepared.after),
      baseRevision: token.revision,
      active: false,
    }
    this.conflicted ||= this.preview.baseRevision !== this.baseline.revision
    this.publishing = false
    this.prepared = null
    this.version++
  }
  /** Observation never confirms publication by itself; only acknowledge advances history. */
  externalChanged(snapshot: GraphSnapshot): void {
    const next = copySnapshot(snapshot)
    if (next.revision === this.baseline.revision) {
      if (!equal(next.graph, this.baseline.graph)) throw new CanvasSessionError('stale')
      return
    }
    if (this.publishing && !this.preview && this.prepared)
      this.preview = {
        graph: cloneCanvas(this.prepared.after),
        baseRevision: this.baseline.revision,
        active: false,
      }
    this.baseline = next
    this.conflicted = this.preview !== null
    // Journal entries remain recoverable but may not be published on a different revision.
    this.version++
  }
}
