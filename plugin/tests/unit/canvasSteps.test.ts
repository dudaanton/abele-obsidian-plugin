import { describe, expect, it } from 'vitest'
import { parseCanvas, serializeCanvas } from '@/canvas/core/model'
import { editCanvasSteps, stepScene, stepsOf } from '@/canvas/core/steps'
import { pictureRegion, paintCanvas } from '@/canvas/core/painter'
import { lintCanvas } from '@/canvas/core/lint'

const sample = () =>
  parseCanvas({
    sampleExtension: true,
    abele: { sample: 'keep', steps: [] },
    nodes: [
      { id: 'level', type: 'group', label: 'Level', x: 0, y: 0, width: 640, height: 240 },
      { id: 'alpha', type: 'text', text: 'Alpha', x: 30, y: 40, width: 200, height: 100 },
      { id: 'beta', type: 'text', text: 'Beta', x: 360, y: 40, width: 200, height: 100 },
      { id: 'gamma', type: 'text', text: 'Gamma', x: 900, y: 40, width: 200, height: 100 },
    ],
    edges: [
      { id: 'flow', fromNode: 'alpha', toNode: 'beta' },
      { id: 'later', fromNode: 'beta', toNode: 'gamma' },
    ],
  })
const walk = () =>
  editCanvasSteps(sample(), [
    {
      op: 'replace',
      steps: [
        { id: 'start', reveal: ['alpha'], say: 'Start with the input.', focus: 'alpha' },
        {
          id: 'level-step',
          reveal: ['level'],
          highlight: ['flow', 'beta'],
          say: 'Then the level.',
          focus: 'level',
        },
        {
          id: 'end',
          reveal: ['gamma'],
          say: 'The result.',
          focus: { x: 850, y: 0, width: 300, height: 200 },
        },
      ],
    },
  ])

describe('portable canvas walkthroughs', () => {
  it('reveals and focuses free primitives by stable id without leaking later lines', () => {
    const graph = sample()
    graph.abele!.lines = [
      {
        version: 1,
        id: 'free',
        from: { x: -400, y: -100 },
        to: { x: -200, y: 100 },
        toEnd: 'arrow',
      },
      { version: 1, id: 'later-line', from: { x: 1000, y: 0 }, to: { x: 1200, y: 100 } },
    ]
    const changed = editCanvasSteps(graph, [
      {
        op: 'replace',
        steps: [
          {
            id: 'first',
            reveal: ['free'],
            highlight: ['free'],
            focus: 'free',
            say: 'A free arrow',
          },
          { id: 'last', reveal: ['later-line'], say: 'Another line' },
        ],
      },
    ])
    expect(stepScene(changed, 1).graph.abele?.lines).toEqual([graph.abele!.lines[0]])
    expect(stepScene(changed, 1).region.x).toBeLessThan(-400)
    expect(stepScene(changed, 2).graph.abele?.lines).toHaveLength(2)
    expect(lintCanvas(changed).filter((w) => w.code === 'missing-step-id')).toEqual([])
  })
  it('reveals cumulatively by id, expands groups, never leaks an unrevealed endpoint, and rewinds', () => {
    const graph = walk()
    expect(
      stepScene(graph, 1)
        .graph.nodes.map((n) => n.id)
        .sort()
    ).toEqual(['alpha', 'level'])
    expect(stepScene(graph, 1).graph.edges).toEqual([])
    expect(
      stepScene(graph, 2)
        .graph.nodes.map((n) => n.id)
        .sort()
    ).toEqual(['alpha', 'beta', 'level'])
    expect(stepScene(graph, 2).graph.edges.map((e) => e.id)).toEqual(['flow'])
    expect([...stepScene(graph, 2).highlight].sort()).toEqual(['beta', 'flow'])
    expect(stepScene(graph, 3).graph.nodes).toHaveLength(4)
    expect(stepScene(graph, 1).graph.nodes).toHaveLength(2)
    expect(stepScene(graph, 1).say).toBe('Start with the input.')
  })
  it('diagnoses step pictures against the source rather than inventing missing ids for hidden cards', () => {
    const source = walk(),
      scene = stepScene(source, 1)
    const ctx = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'measureText' ? (text: string) => ({ width: text.length * 8 }) : () => {},
      }
    ) as CanvasRenderingContext2D
    const theme = {
      paper: 'white',
      card: 'white',
      text: 'black',
      border: 'gray',
      accent: 'blue',
      muted: 'gray',
      font: 'sans-serif',
      size: 16,
      lineHeight: 1.4,
      presets: [],
    }
    const result = paintCanvas(ctx, scene.graph, scene.region, theme, { diagnosticGraph: source })
    expect(result.warnings.filter((w) => w.code === 'missing-step-id')).toEqual([])
    expect(result.warnings.some((w) => w.code === 'isolated' && w.ids.includes('alpha'))).toBe(
      false
    )
  })
  it('uses one-based pictures with the same camera region as the viewer, and explicit crops win', () => {
    const graph = walk()
    expect(pictureRegion(graph, { step: 1 })).toEqual(stepScene(graph, 1).region)
    expect(pictureRegion(graph, { step: 3 })).toEqual({ x: 850, y: 0, width: 300, height: 200 })
    expect(pictureRegion(graph, { step: 2, node: 'beta' }).width).toBe(248)
    expect(() => stepScene(graph, 0)).toThrow(/step/i)
    expect(() => stepScene(graph, 4)).toThrow(/step/i)
  })
  it('edits, orders and removes steps by stable id in an atomic batch without losing extensions', () => {
    const graph = walk(),
      bytes = serializeCanvas(graph)
    const edited = editCanvasSteps(graph, [
      {
        op: 'upsert',
        step: { id: 'extra', reveal: [], say: 'Pause', sample: true },
        before: 'end',
      },
      { op: 'move', id: 'end', before: 'start' },
      { op: 'remove', id: 'level-step' },
    ])
    expect(stepsOf(edited).map((s) => s.id)).toEqual(['end', 'start', 'extra'])
    expect(edited.abele?.sample).toBe('keep')
    expect(stepsOf(edited)[2].sample).toBe(true)
    expect(serializeCanvas(graph)).toBe(bytes)
    expect(() =>
      editCanvasSteps(graph, [
        { op: 'remove', id: 'start' },
        { op: 'move', id: 'missing', before: null },
      ])
    ).toThrow(/op 1/i)
    expect(serializeCanvas(graph)).toBe(bytes)
  })
  it('preserves step extensions during repositioning and can replace a malformed legacy list', () => {
    const graph = walk()
    ;(graph.abele!.steps as Record<string, unknown>[])[1].sample = 'keep'
    const moved = editCanvasSteps(graph, [
      {
        op: 'upsert',
        step: { id: 'level-step', reveal: ['level'], say: 'Refined' },
        before: 'start',
      },
    ])
    expect(stepsOf(moved)[0].sample).toBe('keep')
    graph.abele!.steps = 'broken'
    const repaired = editCanvasSteps(graph, [
      { op: 'replace', steps: [{ id: 'fixed', reveal: ['alpha'], say: 'Repaired' }] },
    ])
    expect(stepsOf(repaired)[0].id).toBe('fixed')
  })
  it('validates duplicate steps, missing ids, camera boxes, and id-valued focus before publishing', () => {
    for (const step of [
      { id: 'bad', reveal: ['missing'], say: '' },
      { id: 'bad', reveal: [], say: '', focus: 'missing' },
      { id: 'bad', reveal: [], say: '', focus: { x: 0, y: 0, width: 0, height: 10 } },
    ])
      expect(() => editCanvasSteps(sample(), [{ op: 'upsert', step }])).toThrow()
    expect(() =>
      editCanvasSteps(sample(), [
        {
          op: 'replace',
          steps: [
            { id: 'same', reveal: [], say: '' },
            { id: 'same', reveal: [], say: '' },
          ],
        },
      ])
    ).toThrow(/duplicate/i)
  })
  it('keeps broken legacy data readable and diagnoses missing ids and group-sized reveals', () => {
    const graph = walk()
    graph.abele!.steps = [{ reveal: ['missing'], highlight: ['gone'], say: 'Legacy' }]
    expect(parseCanvas(serializeCanvas(graph)).abele?.steps).toEqual(graph.abele.steps)
    expect(lintCanvas(graph).filter((w) => w.code === 'missing-step-id')).toHaveLength(2)
    expect(stepsOf(graph)[0].id).toBe('step-1')
    const large = sample()
    large.nodes.push(
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `sample-${i}`,
        type: 'text' as const,
        text: 'Sample',
        x: i * 40,
        y: 180,
        width: 30,
        height: 30,
      }))
    )
    large.abele!.steps = [{ id: 'many', reveal: ['level'], say: '' }]
    expect(lintCanvas(large).some((w) => w.code === 'dense-step')).toBe(true)
  })
})
