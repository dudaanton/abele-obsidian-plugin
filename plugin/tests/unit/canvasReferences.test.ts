import { describe, expect, it } from 'vitest'
import { nodeReferencesPath, renameCanvasReferences } from '@/canvas/core/references'
import { CanvasSession } from '@/canvas/core/session'
import { parseCanvas } from '@/canvas/core/model'
const graph = parseCanvas({
  nodes: [
    {
      id: 'sample',
      type: 'file',
      file: 'sample-folder/sample.md',
      subpath: '#Heading',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      abele: { file: 'sample-folder/sample.md' },
    },
    {
      id: 'group',
      type: 'group',
      background: 'sample-folder/sample.svg',
      x: -20,
      y: -20,
      width: 200,
      height: 200,
    },
  ],
  edges: [],
  future: { path: 'sample-folder/sample.md' },
})
const rename = { before: 'sample-folder', after: 'sample-moved' }
function save(
  session: CanvasSession,
  transform: (input: typeof graph) => typeof graph,
  revision: string
) {
  const token = session.prepare(transform)
  const next = session.apply(token, session.committed)
  session.acknowledge(token, { graph: next, revision })
}
describe('standard canvas references', () => {
  it('follows folder and rename chains, preserving subpaths and opaque extensions', () => {
    const moved = renameCanvasReferences(graph, [
      rename,
      { before: 'sample-moved/sample.md', after: 'sample-moved/sample-new.md' },
    ])
    expect(moved.nodes[0]).toMatchObject({
      file: 'sample-moved/sample-new.md',
      subpath: '#Heading',
      abele: { file: 'sample-folder/sample.md' },
    })
    expect(moved.nodes[1].background).toBe('sample-moved/sample.svg')
    expect(moved.future).toEqual(graph.future)
    expect(graph.nodes[0].file).toBe('sample-folder/sample.md')
  })
  it('does not match a sibling folder sharing only a lexical prefix', () => {
    expect(renameCanvasReferences(graph, [{ before: 'sample-fold', after: 'other' }])).toEqual(
      graph
    )
  })
  it.each([
    '[[sample#Heading|Label]]',
    '![[sample-folder/sample.md#Heading]]',
    '[label](sample-folder/sample.md#Heading)',
  ])('identifies known text links without rewriting text: %s', (text) => {
    const node = { ...graph.nodes[0], type: 'text' as const, text }
    expect(nodeReferencesPath(node, 'sample-folder/sample.md')).toBe(true)
    expect(renameCanvasReferences({ nodes: [node], edges: [] }, [rename]).nodes[0].text).toBe(text)
  })
  it('rewrites removed cards in history so undo cannot resurrect an old attachment path', () => {
    const session = new CanvasSession({ graph, revision: 'initial' })
    save(session, (g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== 'sample') }), 'deleted')
    expect(session.referencesPath('sample-folder/sample.md')).toBe(true)
    session.invalidateReferences()
    const moved = renameCanvasReferences(session.committed.graph, [rename])
    expect(session.reconcileReferences({ graph: moved, revision: 'renamed' }, [rename])).toBe(true)
    const undo = session.prepareUndo()
    expect(undo.graph.nodes.find((n) => n.id === 'sample')?.file).toBe('sample-moved/sample.md')
  })
  it('keeps redo valid without restoring old paths after rename', () => {
    const session = new CanvasSession({ graph, revision: 'initial' })
    save(session, (g) => ({ ...g, nodes: g.nodes.map((n) => ({ ...n, x: 20 })) }), 'changed')
    const undo = session.prepareUndo()
    session.apply(undo, session.committed)
    session.acknowledge(undo, { graph: undo.graph, revision: 'undone' })
    session.invalidateReferences()
    expect(
      session.reconcileReferences(
        { graph: renameCanvasReferences(graph, [rename]), revision: 'renamed' },
        [rename]
      )
    ).toBe(true)
    expect(session.prepareRedo().graph.nodes[0]).toMatchObject({
      file: 'sample-moved/sample.md',
      x: 20,
    })
  })
  it('does not alter uncertain publication evidence or acknowledge matching renamed source', () => {
    const session = new CanvasSession({ graph, revision: 'initial' })
    const token = session.prepare((g) => ({ ...g, nodes: [] }))
    session.apply(token, session.committed)
    session.quarantine(token, 'unknown')
    const evidence = session.publicationEvidence
    session.invalidateReferences()
    expect(
      session.reconcileReferences(
        { graph: renameCanvasReferences(graph, [rename]), revision: 'renamed' },
        [rename]
      )
    ).toBe(false)
    expect(session.publicationEvidence).toEqual(evidence)
    expect(session.history).toEqual({ undo: 0, redo: 0 })
  })
})
