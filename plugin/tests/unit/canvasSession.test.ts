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
  it.each(['unknown', 'written-acknowledgment-pending'] as const)(
    'retains %s work and history while revoking the attempted publication capability',
    (outcome) => {
      const session = new CanvasSession(initial())
      commit(session, session.prepare(edit('Prior history')), 'revision-1')
      const baseline = session.committed,
        history = session.history,
        token = session.prepare(edit('Unsettled command'))
      session.apply(token, baseline)
      session.quarantine(token, outcome)
      expect(session.publicationOutcome).toBe(outcome)
      expect(session.committed).toEqual(baseline)
      expect(session.history).toEqual(history)
      expect(session.draft).toEqual({
        graph: token.graph,
        baseRevision: token.revision,
        active: false,
      })
      expect(session.busy).toBe(false)
      expect(session.conflict).toBe(true)
      expectCode(() => session.apply(token, baseline), 'stale')
      expectCode(() => session.reject(token), 'stale')
      expectCode(
        () => session.acknowledge(token, { graph: token.graph, revision: 'revision-result' }),
        'stale'
      )
      expectCode(() => session.prepareDraft(), 'conflict')
      session.externalChanged({ graph: token.graph, revision: 'revision-observed' })
      expect(session.publicationOutcome).toBe(outcome)
      const evidence = session.publicationEvidence
      expect(evidence).toEqual({
        outcome,
        baseline,
        proposed: token.graph,
        kind: 'command',
      })
      evidence!.baseline.graph.nodes[1].text = 'Outside mutation'
      evidence!.proposed.nodes.reverse()
      expect(session.publicationEvidence).toEqual({
        outcome,
        baseline,
        proposed: token.graph,
        kind: 'command',
      })
      expect(session.history).toEqual(history)
      expectCode(() => session.prepareDraft(), 'conflict')
      session.reapplyDraft(edit('Explicitly reviewed'))
      expect(session.publicationOutcome).toBeNull()
      expect(session.publicationEvidence).toBeNull()
      commit(session, session.prepareDraft(), 'revision-reviewed')
      expect(session.committed.graph.nodes[1].text).toBe('Explicitly reviewed')
    }
  )

  it('does not let late outcome callbacks erase or relabel a newer draft after explicit discard', () => {
    const session = new CanvasSession(initial()),
      token = session.prepare(edit('Old attempt'))
    session.apply(token, session.committed)
    session.quarantine(token, 'unknown')
    session.discardDraft()
    session.beginDraft()
    session.updateDraft(edit('New composition'))
    const draft = session.draft,
      generation = session.generation
    expectCode(() => session.quarantine(token, 'written-acknowledgment-pending'), 'stale')
    expectCode(
      () => session.acknowledge(token, { graph: token.graph, revision: 'revision-late' }),
      'stale'
    )
    expectCode(() => session.reject(token), 'stale')
    expect(session.draft).toEqual(draft)
    expect(session.generation).toBe(generation)
    expect(session.publicationOutcome).toBeNull()
    expect(session.history).toEqual({ undo: 0, redo: 0 })
  })

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

  it('acknowledges a confirmed write after its modify notification without prematurely recording history', () => {
    const session = new CanvasSession(initial())
    session.beginDraft()
    session.updateDraft(edit('Published draft'))
    session.finishDraft()
    const prepared = session.prepareDraft()
    const confirmed = { graph: session.apply(prepared, initial()), revision: 'revision-1' }
    session.externalChanged(confirmed)
    expect(session.history.undo).toBe(0)
    expect(session.draft?.graph).toEqual(confirmed.graph)
    session.acknowledge(prepared, confirmed)
    expect(session.history.undo).toBe(1)
    expect(session.committed).toEqual(confirmed)
    expect(session.busy).toBe(false)
    expect(session.dirty).toBe(false)
    commit(session, session.prepareUndo(), 'revision-2')
    expect(session.committed.graph).toEqual(sample())
  })

  it('never restores a confirmed older publication over a newer observed external revision', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare(edit('Published'))
    const confirmed = { graph: session.apply(prepared, initial()), revision: 'revision-1' }
    const external = { graph: edit('Newer external')(confirmed.graph), revision: 'revision-2' }
    session.externalChanged(external)
    session.acknowledge(prepared, confirmed)
    expect(session.committed).toEqual(external)
    expect(session.history.undo).toBe(1)
    expect(session.busy).toBe(false)
    expect(session.draft).toBeNull()
    expectCode(() => session.prepareUndo(), 'conflict')
  })

  it('retains a failed in-flight draft when an external revision arrives before rejection', () => {
    const session = new CanvasSession(initial())
    const prepared = session.prepare(edit('Failed proposal'))
    session.apply(prepared, initial())
    const external = { graph: edit('External')(sample()), revision: 'revision-external' }
    session.externalChanged(external)
    session.reject(prepared)
    expect(session.committed).toEqual(external)
    expect(session.draft?.graph.nodes[1].text).toBe('Failed proposal')
    expect(session.conflict).toBe(true)
    expect(session.busy).toBe(false)
    expect(session.history.undo).toBe(0)
  })

  it('distinguishes extension arrays from objects with numeric keys in reversible patches', () => {
    const graph = sample()
    graph.future = ['opaque']
    const session = new CanvasSession({ graph, revision: 'revision-0' })
    const after = commit(
      session,
      session.prepare((input) => ({ ...input, future: { 0: 'opaque' } })),
      'revision-1'
    )
    expect(after.future).toEqual({ 0: 'opaque' })
    commit(session, session.prepareUndo(), 'revision-2')
    expect(session.committed.graph.future).toEqual(['opaque'])
    commit(session, session.prepareRedo(), 'revision-3')
    expect(session.committed.graph.future).toEqual({ 0: 'opaque' })
  })

  it('refuses a planner made stale by a reentrant draft rather than staging over human work', () => {
    const session = new CanvasSession(initial())
    expectCode(
      () =>
        session.prepare((graph) => {
          session.beginDraft()
          session.updateDraft(edit('Human'))
          return edit('Agent')(graph)
        }),
      'stale'
    )
    expect(session.draft?.graph.nodes[1].text).toBe('Human')
    expect(session.committed).toEqual(initial())
  })

  it('settles a no-write rejection after external invalidation before apply and recovers the proposal', () => {
    const session = new CanvasSession(initial())
    commit(session, session.prepare(edit('Local')), 'revision-1')
    commit(session, session.prepareUndo(), 'revision-2')
    const history = session.history
    const proposal = session.prepare(edit('Recoverable agent proposal'))
    const external = { graph: edit('External')(sample()), revision: 'revision-external' }
    session.externalChanged(external)
    expectCode(() => session.apply(proposal, session.committed), 'stale')
    session.reject(proposal)
    expect(session.committed).toEqual(external)
    expect(session.history).toEqual(history)
    expect(session.draft).toEqual({
      graph: proposal.graph,
      baseRevision: 'revision-2',
      active: false,
    })
    expect(session.dirty).toBe(true)
    expect(session.busy).toBe(false)
    expect(session.conflict).toBe(true)
    expectCode(() => session.reject(proposal), 'stale')
    expectCode(() => session.prepareDraft(), 'conflict')
    session.reapplyDraft(edit('Recovered on latest baseline'))
    commit(session, session.prepareDraft(), 'revision-recovered')
    expect(session.history).toEqual({ undo: 1, redo: 0 })
  })

  it.each(['before', 'after'] as const)(
    'preserves a newer human draft started %s external invalidation when rejecting an old proposal',
    (when) => {
      const session = new CanvasSession(initial())
      const proposal = session.prepare(edit('Old agent proposal'))
      const external = { graph: edit('External')(sample()), revision: 'revision-external' }
      if (when === 'after') session.externalChanged(external)
      session.beginDraft()
      session.updateDraft(edit('New human draft'))
      if (when === 'before') session.externalChanged(external)
      const draft = session.draft
      expectCode(() => session.apply(proposal, session.committed), 'stale')
      session.reject(proposal)
      expect(session.draft).toEqual(draft)
      expect(session.committed).toEqual(external)
      expect(session.history).toEqual({ undo: 0, redo: 0 })
      expect(session.conflict).toBe(when === 'before')
      expect(session.busy).toBe(true)
      session.finishDraft()
      if (when === 'after') commit(session, session.prepareDraft(), 'revision-human')
      else expectCode(() => session.prepareDraft(), 'conflict')
    }
  )

  it.each(['agent', 'draft'] as const)(
    'does not resurrect an explicitly discarded %s preparation after external change',
    (kind) => {
      const session = new CanvasSession(initial())
      if (kind === 'draft') {
        session.beginDraft()
        session.updateDraft(edit('Discarded human proposal'))
        session.finishDraft()
      }
      const proposal =
        kind === 'draft'
          ? session.prepareDraft()
          : session.prepare(edit('Discarded agent proposal'))
      const external = { graph: edit('External')(sample()), revision: 'revision-external' }
      session.externalChanged(external)
      session.discardDraft()
      expectCode(() => session.reject(proposal), 'stale')
      expectCode(() => session.apply(proposal, session.committed), 'stale')
      expect(session.draft).toBeNull()
      expect(session.conflict).toBe(false)
      expect(session.dirty).toBe(false)
      expect(session.committed).toEqual(external)
      commit(session, session.prepare(edit('Fresh proposal')), 'revision-fresh')
    }
  )

  it('cannot settle a superseded token instead of its still-owned replacement after external change', () => {
    const session = new CanvasSession(initial())
    const superseded = session.prepare(edit('Superseded'))
    const replacement = session.prepare(edit('Replacement'))
    const external = { graph: edit('External')(sample()), revision: 'revision-external' }
    session.externalChanged(external)
    expectCode(() => session.reject(superseded), 'stale')
    expect(session.draft).toBeNull()
    session.reject(replacement)
    expect(session.draft?.graph).toEqual(replacement.graph)
    expect(session.committed).toEqual(external)
    expect(session.conflict).toBe(true)
  })

  it('does not replace reentrantly applied publication with the outer preparation', () => {
    const session = new CanvasSession(initial())
    const first = session.prepare(edit('Actually published'))
    let published: CanvasGraph, outerError: unknown
    try {
      session.prepare((graph) => {
        published = session.apply(first, session.committed)
        return edit('Outer proposal')(graph)
      })
    } catch (error) {
      outerError = error
    }
    expect(session.busy).toBe(true)
    expect(session.committed).toEqual(initial())
    expect(session.history).toEqual({ undo: 0, redo: 0 })
    session.acknowledge(first, { graph: published, revision: 'revision-confirmed' })
    expect(session.committed.graph.nodes[1].text).toBe('Actually published')
    expect(session.busy).toBe(false)
    expect(session.draft).toBeNull()
    expect(session.history).toEqual({ undo: 1, redo: 0 })
    expect(outerError).toBeInstanceOf(CanvasSessionError)
    expect((outerError as CanvasSessionError).code).toBe('stale')
    expectCode(
      () => session.acknowledge(first, { graph: published, revision: 'revision-confirmed' }),
      'stale'
    )
  })

  it('keeps a nested preparation owned when it supersedes the outer planner without changing generation', () => {
    const session = new CanvasSession(initial())
    let nested: ReturnType<CanvasSession['prepare']>
    expectCode(
      () =>
        session.prepare((graph) => {
          nested = session.prepare(edit('Nested proposal'))
          return edit('Outer proposal')(graph)
        }),
      'stale'
    )
    commit(session, nested, 'revision-nested')
    expect(session.committed.graph.nodes[1].text).toBe('Nested proposal')
    expect(session.history.undo).toBe(1)
  })

  it('cannot stage over a rejection settled reentrantly inside the outer planner', () => {
    const session = new CanvasSession(initial())
    const first = session.prepare(edit('Recoverable first proposal'))
    expectCode(
      () =>
        session.prepare((graph) => {
          session.apply(first, session.committed)
          session.reject(first)
          return edit('Outer proposal')(graph)
        }),
      'stale'
    )
    expect(session.draft?.graph).toEqual(first.graph)
    expect(session.committed).toEqual(initial())
    expect(session.history.undo).toBe(0)
    expect(session.busy).toBe(false)
    commit(session, session.prepareDraft(), 'revision-recovered')
  })

  it('keeps explicit reentrant discard final instead of restoring the outer or old proposal', () => {
    const session = new CanvasSession(initial())
    const first = session.prepare(edit('Old proposal'))
    expectCode(
      () =>
        session.prepare((graph) => {
          session.discardDraft()
          return edit('Outer proposal')(graph)
        }),
      'stale'
    )
    expectCode(() => session.reject(first), 'stale')
    expect(session.draft).toBeNull()
    expect(session.committed).toEqual(initial())
    expect(session.busy).toBe(false)
  })

  it('protects in-flight ownership from all competing preparation and draft paths', () => {
    const session = new CanvasSession(initial())
    const first = session.prepare(edit('First proposal'))
    const published = session.apply(first, session.committed)
    const attempts = [
      () => session.prepare(edit('Competing proposal')),
      () => session.prepareDraft(),
      () => session.prepareUndo(),
      () => session.prepareRedo(),
      () => session.beginDraft(),
      () => session.updateDraft(edit('Competing draft')),
      () => session.finishDraft(),
      () => session.discardDraft(),
      () => session.reapplyDraft(edit('Competing recovery')),
      () => session.apply(first, session.committed),
    ]
    for (const attempt of attempts) expectCode(attempt, 'busy')
    session.acknowledge(first, { graph: published, revision: 'revision-confirmed' })
    expect(session.busy).toBe(false)
    expect(session.history).toEqual({ undo: 1, redo: 0 })
    expect(session.committed.graph).toEqual(first.graph)
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
