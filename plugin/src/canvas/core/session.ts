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
/** One local change not yet written: its own undo step once the write that carries it lands. */
interface Step {
  kind: 'command' | 'undo' | 'redo'
  patch: GraphPatch
}
interface Preparation {
  token: PreparedCanvasTransaction
  before: CanvasGraph
  after: CanvasGraph
  patch: GraphPatch
  kind: 'command' | 'undo' | 'redo'
  /** The local steps a draft publication carries, in order. */
  steps?: Step[]
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
/** History after `steps`, as it will be once they are written. */
function replay(
  undo: GraphPatch[],
  redo: GraphPatch[],
  steps: readonly Step[],
  limit: number
): { undo: GraphPatch[]; redo: GraphPatch[] } {
  undo = [...undo]
  redo = [...redo]
  for (const step of steps) {
    if (step.kind === 'command') {
      undo.push(step.patch)
      redo = []
      if (undo.length > limit) undo.shift()
    } else if (step.kind === 'undo') redo.push(undo.pop() ?? step.patch)
    else undo.push(redo.pop() ?? step.patch)
  }
  return { undo, redo }
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
  private steps: Step[] = []
  private stepStart: CanvasGraph | null = null
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
  /** A write is in flight. */
  get writing(): boolean {
    return this.publishing
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
  /** Written history only. */
  get history(): { undo: number; redo: number } {
    return { undo: this.undoJournal.length, redo: this.redoJournal.length }
  }
  /** What a person can undo now: written history plus local steps not yet written. */
  get localHistory(): { undo: number; redo: number } {
    const { undo, redo } = this.effectiveHistory()
    return { undo: undo.length, redo: redo.length }
  }
  /** Local steps waiting for a write, the active draft not included. */
  get pendingSteps(): number {
    return this.steps.length
  }
  private effectiveHistory(): { undo: GraphPatch[]; redo: GraphPatch[] } {
    const current = this.journalRevision === this.baseline.revision
    return replay(
      current ? this.undoJournal : [],
      current ? this.redoJournal : [],
      this.steps,
      this.historyLimit
    )
  }

  /** Include deleted cards in history: undo must not bring their old paths back. */
  referencesPath(path: string, textOnly = false, source = ''): boolean {
    const matches = (node: CanvasNode | undefined) =>
      node && (!textOnly || node.type === 'text') && nodeReferencesPath(node, path, source)
    return (
      [this.baseline.graph, this.preview?.graph, this.prepared?.after].some((graph) =>
        graph?.nodes.some(matches)
      ) ||
      (this.stepStart?.nodes.some(matches) ?? false) ||
      [...this.undoJournal, ...this.redoJournal, ...this.steps.map((s) => s.patch)].some((patch) =>
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
    this.steps = this.steps.map((step) => ({ ...step, patch: patchReferences(step.patch) }))
    if (this.stepStart) this.stepStart = renameCanvasReferences(this.stepStart, renames)
    if (this.journalRevision === previous) this.journalRevision = snapshot.revision
    this.baseline = copySnapshot(snapshot)
    this.prepared = null
    this.version++
    return true
  }

  /** A local edit may start while an earlier one is being written; it is written later. */
  beginDraft(): void {
    if (this.preview?.active || this.foreignPublication) throw new CanvasSessionError('busy')
    if (this.conflicted) throw new CanvasSessionError('conflict')
    this.stepStart = cloneCanvas(this.preview?.graph ?? this.baseline.graph)
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
    if (this.foreignPublication) throw new CanvasSessionError('busy')
    if (!this.preview?.active) throw new CanvasSessionError('no-draft')
    const graph = this.transform(this.preview.graph, transform)
    this.preview = { ...this.preview, graph }
    this.version++
  }
  /** Ends the active draft as one local step. */
  finishDraft(): void {
    if (this.foreignPublication) throw new CanvasSessionError('busy')
    if (!this.preview?.active) throw new CanvasSessionError('no-draft')
    const start = this.stepStart ?? this.baseline.graph,
      patch = graphPatch(start, this.preview.graph)
    if (
      patch.fields.length ||
      patch.nodes.changes.length ||
      patch.edges.changes.length ||
      patch.nodes.order ||
      patch.edges.order
    )
      this.steps.push({ kind: 'command', patch })
    this.stepStart = null
    this.preview = { ...this.preview, active: false }
    this.dropEmptyPreview()
    this.version++
  }
  /** Drops only the active draft's change; earlier local steps stay. */
  cancelDraft(): void {
    if (this.foreignPublication) throw new CanvasSessionError('busy')
    if (!this.preview?.active) throw new CanvasSessionError('no-draft')
    this.preview = {
      ...this.preview,
      graph: this.stepStart ?? cloneCanvas(this.baseline.graph),
      active: false,
    }
    this.stepStart = null
    if (!this.steps.length && !this.publishing && !this.unsettledPublication) {
      // The gesture was the only local change: nothing is retained, a conflict included.
      this.preview = null
      this.conflicted = false
      this.prepared = null
    }
    this.dropEmptyPreview()
    this.version++
  }
  /**
   * A write that is not the local draft's (an agent command or written history). Local edits
   * wait for it: they would not build on what it writes.
   */
  get foreignPublication(): boolean {
    return this.publishing && !this.prepared?.steps
  }
  private dropEmptyPreview(): void {
    if (
      this.preview &&
      !this.preview.active &&
      !this.steps.length &&
      !this.publishing &&
      !this.conflicted &&
      !this.unsettledPublication &&
      this.preview.baseRevision === this.baseline.revision &&
      equal(this.preview.graph, this.baseline.graph)
    )
      this.preview = null
  }
  /** Undo in memory: the reversal is a local step like any other, written later. */
  undoLocal(): void {
    this.history$(true)
  }
  redoLocal(): void {
    this.history$(false)
  }
  private history$(reverse: boolean): void {
    if (this.preview?.active || this.foreignPublication) throw new CanvasSessionError('busy')
    if (this.conflicted) throw new CanvasSessionError('conflict')
    const { undo, redo } = this.effectiveHistory(),
      patch = (reverse ? undo : redo).at(-1)
    if (!patch) throw new CanvasSessionError('empty-history')
    const graph = applyPatch(this.preview?.graph ?? this.baseline.graph, patch, reverse)
    this.preview = {
      graph,
      baseRevision: this.preview?.baseRevision ?? this.baseline.revision,
      active: false,
    }
    this.steps.push({ kind: reverse ? 'undo' : 'redo', patch })
    this.dropEmptyPreview()
    this.version++
  }
  discardDraft(): void {
    if (this.publishing) throw new CanvasSessionError('busy')
    this.steps = []
    this.stepStart = null
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
    this.steps = [{ kind: 'command', patch: graphPatch(this.baseline.graph, graph) }]
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
      preparation = this.prepared,
      publishing = this.publishing
    const graph = cloneCanvas(transform(cloneCanvas(input)))
    // Preparation replacement and publication start need not change document generation.
    if (
      generation !== this.version ||
      preparation !== this.prepared ||
      publishing !== this.publishing
    )
      throw new CanvasSessionError('stale')
    return graph
  }
  /** Existing edit/layout/steps planners can be composed into one command on a detached clone. */
  prepare(transform: GraphTransform): PreparedCanvasTransaction {
    this.writable()
    return this.stage(this.transform(this.baseline.graph, transform), 'command')
  }
  /** Stages the finished local steps; a draft still active is left out and written later. */
  prepareDraft(): PreparedCanvasTransaction {
    if (this.publishing) throw new CanvasSessionError('busy')
    if (this.conflicted) throw new CanvasSessionError('conflict')
    if (!this.preview) throw new CanvasSessionError('no-draft')
    // Only an unfinished draft: nothing is ready to write.
    if (this.preview.active && !this.steps.length) throw new CanvasSessionError('busy')
    if (this.preview.baseRevision !== this.baseline.revision)
      throw new CanvasSessionError('conflict')
    const token = this.stage(
      this.preview.active ? (this.stepStart ?? this.baseline.graph) : this.preview.graph,
      'command'
    )
    // Retained work with no local steps (a failed agent proposal) is written as one command.
    if (this.steps.length) this.prepared.steps = [...this.steps]
    return token
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
    if (this.publishing) throw new CanvasSessionError('busy')
    if (this.conflicted) throw new CanvasSessionError('conflict')
    // A local draft opened since preparation would have changed the generation; only one
    // begun through a still-matching preparation is a later step, written after this one.
    if (this.preview?.active && !prepared.steps) throw new CanvasSessionError('busy')
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
    if (prepared.steps) {
      const current = this.journalRevision === token.revision,
        history = replay(
          current ? this.undoJournal : [],
          current ? this.redoJournal : [],
          prepared.steps,
          this.historyLimit
        )
      this.undoJournal = history.undo
      this.redoJournal = history.redo
      this.steps = this.steps.slice(prepared.steps.length)
    } else if (prepared.kind === 'command') {
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
    // Local steps made during the write stay pending, now on top of what it wrote.
    const later = !!prepared.steps && (this.steps.length > 0 || !!this.preview?.active)
    this.preview = later
      ? {
          ...this.preview,
          baseRevision: observedExternal ? this.preview.baseRevision : confirmed.revision,
        }
      : null
    if (!later) this.stepStart = null
    this.conflicted = later && observedExternal ? this.conflicted : false
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
