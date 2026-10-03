import { describe, expect, it } from 'vitest'
import { CanvasSession, CanvasSessionError } from '../../src/canvas/core/session'
import {
  cloneCanvas,
  parseCanvas,
  serializeCanvas,
  type CanvasGraph,
} from '../../src/canvas/core/model'
import { planCanvasEdit, planCanvasLayout, type GraphSnapshot } from '../../src/canvas/core/service'
import { editCanvasSteps } from '../../src/canvas/core/steps'

function sample(): CanvasGraph {
  return parseCanvas({
    nodes: [
      {
        id: 'sample-b',
        type: 'text',
        text: 'Second',
        x: 200,
        y: 0,
        width: 100,
        height: 80,
        future: { flag: true },
      },
      {
        id: 'sample-a',
        type: 'text',
        text: 'First',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        abele: { opaque: ['keep'] },
      },
    ],
    edges: [
      { id: 'sample-z', fromNode: 'sample-a', toNode: 'sample-b', future: { dash: 7 } },
      { id: 'sample-y', fromNode: 'sample-b', toNode: 'sample-a' },
    ],
    future: { nested: ['preserve', { value: 3 }] },
    abele: {
      ink: [{ legacy: true }],
      steps: [{ id: 'sample-step', reveal: ['sample-a'], say: 'Start', future: 9 }],
    },
  })
}
const edit = (text: string) => (graph: CanvasGraph) =>
  planCanvasEdit(graph, [{ op: 'update', id: 'sample-a', patch: { text } }])
function initial(): GraphSnapshot {
  return { graph: sample(), revision: 'revision-0' }
}
function commit(
  session: CanvasSession,
  prepared: ReturnType<CanvasSession['prepare']>,
  revision: string
) {
  const graph = session.apply(prepared, session.committed)
  session.acknowledge(prepared, { graph, revision })
  return graph
}
function expectCode(action: () => unknown, code: string) {
  try {
    action()
    throw new Error('Expected a session error')
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasSessionError)
    expect((error as CanvasSessionError).code).toBe(code)
  }
}

describe('portable canvas document session', () => {
  it('validates an entire batch without changing the baseline, generation or history on error', () => {
    const session = new CanvasSession(initial())
    expect(() =>
      session.prepare((graph) =>
        planCanvasEdit(graph, [
          { op: 'update', id: 'sample-a', patch: { text: 'Changed' } },
          { op: 'remove', id: 'missing-sample' },
        ])
      )
    ).toThrow('Unknown id')
    expect(session.committed).toEqual(initial())
    expect(session.generation).toBe(0)
    expect(session.history).toEqual({ undo: 0, redo: 0 })
    expect(session.draft).toBeNull()
  })

  it('records a multi-operation agent batch once, only after successful storage confirmation', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare((graph) =>
      planCanvasEdit(graph, [
        { op: 'update', id: 'sample-a', patch: { text: 'Changed', x: 12 } },
        { op: 'remove', id: 'sample-b' },
      ])
    )
    const after = session.apply(prepared, session.committed)
    expect(session.history.undo).toBe(0)
    expect(session.committed).toEqual(initial())
    session.acknowledge(prepared, { graph: after, revision: 'revision-1' })
    expect(session.history).toEqual({ undo: 1, redo: 0 })
    expect(session.committed.graph.nodes).toHaveLength(1)
    commit(session, session.prepareUndo(), 'revision-2')
    expect(session.committed.graph).toEqual(sample())
    expect(session.history).toEqual({ undo: 0, redo: 1 })
    commit(session, session.prepareRedo(), 'revision-3')
    expect(session.committed.graph).toEqual(after)
  })

  it('invalidates a prepared transaction when a later human draft starts', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare(edit('Agent'))
    session.beginDraft()
    session.updateDraft(edit('Human'))
    expectCode(() => session.apply(prepared, initial()), 'stale')
    expect(session.draft?.graph.nodes[1].text).toBe('Human')
    expect(session.committed).toEqual(initial())
  })

  it('keeps previews transient and treats a finished human command as one undo item', () => {
    const session = new CanvasSession(initial())
    session.beginDraft()
    session.updateDraft(edit('Preview one'))
    session.updateDraft(edit('Preview two'))
    expect(session.dirty).toBe(true)
    expect(session.busy).toBe(true)
    expectCode(() => session.prepare(edit('Agent')), 'busy')
    expectCode(() => session.prepareDraft(), 'busy')
    session.finishDraft()
    expect(session.busy).toBe(false)
    commit(session, session.prepareDraft(), 'revision-1')
    expect(session.draft).toBeNull()
    expect(session.dirty).toBe(false)
    expect(session.history.undo).toBe(1)
    commit(session, session.prepareUndo(), 'revision-2')
    expect(session.committed.graph).toEqual(sample())
  })

  it('retains a finished draft and baseline when storage rejects publication', () => {
    const session = new CanvasSession(initial())
    session.beginDraft()
    session.updateDraft(edit('Recoverable'))
    session.finishDraft()
    const prepared = session.prepareDraft()
    session.apply(prepared, initial())
    session.reject(prepared)
    expect(session.committed).toEqual(initial())
    expect(session.history).toEqual({ undo: 0, redo: 0 })
    expect(session.draft?.graph.nodes[1].text).toBe('Recoverable')
    expect(session.dirty).toBe(true)
    expect(session.busy).toBe(false)
    commit(session, session.prepareDraft(), 'revision-1')
    expect(session.history.undo).toBe(1)
  })

  it('recovers a failed agent proposal without publishing or adding history', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare(edit('Recover agent batch'))
    session.apply(prepared, initial())
    session.reject(prepared)
    expect(session.draft?.graph.nodes[1].text).toBe('Recover agent batch')
    expect(session.committed).toEqual(initial())
    expect(session.history.undo).toBe(0)
  })

  it('preserves an active draft across external change and requires explicit recovery', () => {
    const session = new CanvasSession(initial())
    session.beginDraft()
    session.updateDraft(edit('Human draft'))
    const external = { graph: edit('External')(sample()), revision: 'revision-external' }
    session.externalChanged(external)
    expect(session.committed).toEqual(external)
    expect(session.conflict).toBe(true)
    expect(session.draft?.graph.nodes[1].text).toBe('Human draft')
    session.finishDraft()
    expectCode(() => session.prepareDraft(), 'conflict')
    session.reapplyDraft(edit('Reapplied'))
    commit(session, session.prepareDraft(), 'revision-recovered')
    expect(session.committed.graph.nodes[1].text).toBe('Reapplied')
    expect(session.conflict).toBe(false)
  })

  it.each(['undo', 'redo'] as const)(
    'blocks stale %s after an external revision even with identical content',
    (direction) => {
      const session = new CanvasSession(initial())
      commit(session, session.prepare(edit('Local')), 'revision-1')
      if (direction === 'redo') commit(session, session.prepareUndo(), 'revision-2')
      session.externalChanged({ graph: session.committed.graph, revision: 'revision-external' })
      expectCode(
        () => (direction === 'undo' ? session.prepareUndo() : session.prepareRedo()),
        'conflict'
      )
      expect(session.committed.revision).toBe('revision-external')
    }
  )

  it('rechecks revision and graph at the atomic publication boundary', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare(edit('Local'))
    expectCode(
      () => session.apply(prepared, { graph: sample(), revision: 'other-revision' }),
      'stale'
    )
    expectCode(
      () => session.apply(prepared, { graph: edit('Other')(sample()), revision: 'revision-0' }),
      'stale'
    )
    expect(session.committed).toEqual(initial())
  })

  it('rejects duplicate or unconfirmed acknowledgments and protects an in-flight publication', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare(edit('Local'))
    expectCode(
      () => session.acknowledge(prepared, { graph: prepared.graph, revision: 'revision-1' }),
      'stale'
    )
    session.apply(prepared, initial())
    expectCode(() => session.beginDraft(), 'busy')
    expectCode(
      () => session.acknowledge(prepared, { graph: sample(), revision: 'revision-1' }),
      'stale'
    )
    session.acknowledge(prepared, { graph: prepared.graph, revision: 'revision-1' })
    expectCode(
      () => session.acknowledge(prepared, { graph: prepared.graph, revision: 'revision-1' }),
      'stale'
    )
  })

  it('does not let caller mutations change baseline, draft or prepared publication', () => {
    const snapshot = initial()
    const session = new CanvasSession(snapshot)
    snapshot.graph.nodes[0].text = 'Outside'
    session.committed.graph.nodes.reverse()
    session.beginDraft()
    session.updateDraft(edit('Human'))
    session.draft!.graph.nodes[1].text = 'Outside'
    session.finishDraft()
    const prepared = session.prepareDraft()
    prepared.graph.nodes.reverse()
    prepared.graph.nodes[0].text = 'Outside'
    const graph = commit(session, prepared, 'revision-1')
    expect(graph.nodes.map((n) => n.id)).toEqual(['sample-b', 'sample-a'])
    expect(graph.nodes[1].text).toBe('Human')
    expect(graph.nodes[0].text).toBe('Second')
  })

  it('round-trips unknown root, node, edge and step fields and semantic stacking through layout, steps and history', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare((graph) =>
      editCanvasSteps(planCanvasLayout(graph, { algorithm: 'grid' }), [
        { op: 'upsert', step: { id: 'sample-step', reveal: ['sample-a'], say: 'Updated' } },
      ])
    )
    const after = commit(session, prepared, 'revision-1')
    expect(after.future).toEqual(sample().future)
    expect(after.abele?.ink).toEqual(sample().abele?.ink)
    expect((after.abele?.steps as Record<string, unknown>[])[0].future).toBe(9)
    expect(after.nodes.map((n) => n.id)).toEqual(['sample-b', 'sample-a'])
    expect(after.edges.map((e) => e.id)).toEqual(['sample-z', 'sample-y'])
    commit(session, session.prepareUndo(), 'revision-2')
    expect(serializeCanvas(session.committed.graph)).toBe(serializeCanvas(sample()))
    commit(session, session.prepareRedo(), 'revision-3')
    expect(parseCanvas(serializeCanvas(session.committed.graph))).toEqual(after)
  })

  it('reverses collection reordering and additions without restoring a whole-file snapshot', () => {
    const session = new CanvasSession(initial())
    const after = commit(
      session,
      session.prepare((graph) => {
        const changed = planCanvasEdit(graph, [
          { op: 'add_node', node: { id: 'sample-c', kind: 'text', label: 'Third', x: 400, y: 0 } },
        ])
        changed.nodes.reverse()
        changed.edges.reverse()
        delete changed.future
        return changed
      }),
      'revision-1'
    )
    commit(session, session.prepareUndo(), 'revision-2')
    expect(session.committed.graph).toEqual(sample())
    commit(session, session.prepareRedo(), 'revision-3')
    expect(session.committed.graph).toEqual(after)
  })

  it('bounds history and drops redo when a new command commits', () => {
    const session = new CanvasSession(initial(), { historyLimit: 2 })
    for (let i = 1; i <= 3; i++)
      commit(session, session.prepare(edit(`Change ${i}`)), `revision-${i}`)
    expect(session.history.undo).toBe(2)
    commit(session, session.prepareUndo(), 'revision-4')
    commit(session, session.prepareUndo(), 'revision-5')
    expect(session.committed.graph.nodes[1].text).toBe('Change 1')
    expectCode(() => session.prepareUndo(), 'empty-history')
    commit(session, session.prepare(edit('New branch')), 'revision-6')
    expect(session.history).toEqual({ undo: 1, redo: 0 })
  })

  it('keeps history unchanged on failed undo, and retains the inverse as a recoverable draft', () => {
    const session = new CanvasSession(initial())
    commit(session, session.prepare(edit('Local')), 'revision-1')
    const undo = session.prepareUndo()
    session.apply(undo, session.committed)
    session.reject(undo)
    expect(session.history).toEqual({ undo: 1, redo: 0 })
    expect(session.committed.graph.nodes[1].text).toBe('Local')
    expect(session.draft?.graph).toEqual(sample())
    session.discardDraft()
    commit(session, session.prepareUndo(), 'revision-2')
    expect(session.committed.graph).toEqual(sample())
  })

  it('ignores confirmed own-revision notifications without dropping history or drafts', () => {
    const session = new CanvasSession(initial())
    commit(session, session.prepare(edit('Local')), 'revision-1')
    session.beginDraft()
    session.updateDraft(edit('Draft'))
    const generation = session.generation
    session.externalChanged(session.committed)
    expect(session.generation).toBe(generation)
    expect(session.history.undo).toBe(1)
    expect(session.conflict).toBe(false)
    expect(session.draft?.graph.nodes[1].text).toBe('Draft')
  })

  it('discards a conflicted draft explicitly and starts new history on the current external baseline', () => {
    const session = new CanvasSession(initial())
    commit(session, session.prepare(edit('Old local')), 'revision-1')
    session.beginDraft()
    session.updateDraft(edit('Old draft'))
    const external = { graph: cloneCanvas(sample()), revision: 'revision-external' }
    session.externalChanged(external)
    session.discardDraft()
    commit(session, session.prepare(edit('New local')), 'revision-new')
    expect(session.history).toEqual({ undo: 1, redo: 0 })
    commit(session, session.prepareUndo(), 'revision-undo')
    expect(session.committed.graph).toEqual(external.graph)
  })
})
