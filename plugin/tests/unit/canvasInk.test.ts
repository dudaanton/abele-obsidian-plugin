import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => vi.unstubAllGlobals())
import {
  addInk,
  attachmentAt,
  inkBounds,
  inkEntries,
  inkSchema,
  inkTransform,
  rawInk,
  type CanvasInk,
} from '@/canvas/core/ink'
import { editCanvas } from '@/canvas/core/edit'
import { parseCanvas, serializeCanvas, type CanvasGraph } from '@/canvas/core/model'
import { pictureRegion, paintCanvas } from '@/canvas/core/painter'
import { planCanvasExport } from '@/canvas/core/export'
import { stepScene } from '@/canvas/core/steps'
import { lintCanvas } from '@/canvas/core/lint'

const stroke = (id = 'sample-ink'): CanvasInk => ({
  version: 1,
  id,
  tool: 'pen',
  color: '1',
  size: 4,
  points: [10, 20, 0.2, 30, 40, 0.8],
})
const graph = (): CanvasGraph => ({
  nodes: [{ id: 'card', type: 'text', text: 'Sample', x: 100, y: 200, width: 200, height: 100 }],
  edges: [],
})

describe('canvas ink extension and attachment geometry', () => {
  it('serializes free and node-local pressure samples in the same native document', () => {
    const g = graph()
    addInk(g, stroke())
    addInk(g, { ...stroke('attached'), frame: { width: 200, height: 100 } }, 'card')
    expect(parseCanvas(serializeCanvas(g))).toEqual(g)
    expect(inkEntries(g).map((e) => [e.stroke.id, e.node?.id])).toEqual([
      ['sample-ink', undefined],
      ['attached', 'card'],
    ])
    expect(inkSchema.safeParse({ ...stroke(), points: [1, 2, 2] }).success).toBe(false)
    expect(inkSchema.safeParse({ ...stroke(), points: [1, 2] }).success).toBe(false)
    expect(inkSchema.safeParse({ ...stroke(), points: [Infinity, 2, 0.5] }).success).toBe(false)
  })
  it('chooses the visible topmost card, then its group, and never hidden descendants', () => {
    const g = graph()
    g.nodes.unshift({ id: 'group', type: 'group', x: 0, y: 0, width: 500, height: 500 })
    g.nodes.push({ ...g.nodes[1], id: 'top' })
    expect(attachmentAt(g, 120, 220)?.id).toBe('top')
    expect(attachmentAt(g, 20, 20)?.id).toBe('group')
    g.nodes[0].collapsed = true
    expect(attachmentAt(g, 120, 220)?.id).toBe('group')
    expect(attachmentAt(g, 900, 900)).toBeUndefined()
  })
  it('transforms outlines, not stored points or pressure, on translation and nonuniform resize', () => {
    const g = graph(),
      s = { ...stroke(), frame: { width: 200, height: 100 } }
    addInk(g, s, 'card')
    const moved = editCanvas(g, [
      { op: 'move', ids: ['card'], dx: 50, dy: 60 },
      { op: 'update', id: 'card', patch: { width: 400, height: 50 } },
    ]).graph
    const e = inkEntries(moved)[0]
    expect(e.stroke).toEqual(s)
    expect(inkTransform(e)).toEqual({ x: 150, y: 260, sx: 2, sy: 0.5 })
    const dot = { ...e, stroke: { ...s, points: [10, 20, 1] } }
    expect(inkBounds(dot)).toEqual({ x: 163.6, y: 268.4, width: 12.8, height: 3.2 })
  })
  it('includes off-card annotations and ink-only content in Fit and whole export', () => {
    const g = graph()
    addInk(
      g,
      { ...stroke(), points: [-500, 20, 0.5, 800, 40, 1], frame: { width: 200, height: 100 } },
      'card'
    )
    expect(pictureRegion(g, { node: 'card' }).x).toBeLessThan(-400)
    expect(pictureRegion(g).x).toBeLessThan(-400)
    expect(pictureRegion(g).x + pictureRegion(g).width).toBeGreaterThan(900)
    const free: CanvasGraph = { nodes: [], edges: [] }
    addInk(free, { ...stroke(), points: [1000, 1200, 1] })
    expect(planCanvasExport(free).region).toEqual(pictureRegion(free))
    expect(pictureRegion(free).x).toBeGreaterThan(900)
  })
  it('preserves opaque entries and refuses incompatible containers and duplicate IDs atomically', () => {
    const g = graph()
    g.abele = { ink: [{ version: 9, id: 'legacy', payload: 'opaque' }], future: { keep: true } }
    const result = editCanvas(g, [{ op: 'add_ink', stroke: stroke() }]).graph
    expect(rawInk(result)[0]).toEqual(g.abele.ink[0])
    expect(inkEntries(result)).toHaveLength(1)
    expect(() => editCanvas(result, [{ op: 'add_ink', stroke: stroke('legacy') }])).toThrow(
      /Duplicate/
    )
    expect(() =>
      editCanvas(result, [{ op: 'add_node', node: { id: 'sample-ink', kind: 'text' } }])
    ).toThrow(/Duplicate/)
    expect(() =>
      editCanvas(result, [{ op: 'add_ink', node: 'card', stroke: stroke('other') }])
    ).toThrow(/frame/)
    g.nodes[0].abele = { ink: { opaque: true } }
    expect(() =>
      editCanvas(g, [
        {
          op: 'add_ink',
          node: 'card',
          stroke: { ...stroke(), frame: { width: 200, height: 100 } },
        },
      ])
    ).toThrow(/incompatible/)
    expect(g.nodes[0].abele.ink).toEqual({ opaque: true })
    expect(parseCanvas(serializeCanvas(g))).toEqual(g)
  })
  it('hides attached ink with its collapsed or unrevealed owner, and reveals free ink explicitly', () => {
    const g = graph()
    g.nodes.unshift({
      id: 'group',
      type: 'group',
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      collapsed: true,
    })
    addInk(g, { ...stroke(), frame: { width: 200, height: 100 } }, 'card')
    addInk(g, stroke('free'))
    expect(inkEntries(g).map((e) => e.stroke.id)).toEqual(['free'])
    g.nodes[0].collapsed = false
    g.abele = {
      ...g.abele,
      steps: [
        { id: 'first', say: '', reveal: ['card'] },
        { id: 'second', say: '', reveal: ['free'] },
      ],
    }
    expect(lintCanvas(g).filter((w) => w.code === 'missing-step-id')).toEqual([])
    expect(inkEntries(stepScene(g, 1).graph).map((e) => e.stroke.id)).toEqual(['sample-ink'])
    expect(inkEntries(stepScene(g, 2).graph).map((e) => e.stroke.id)).toEqual([
      'free',
      'sample-ink',
    ])
  })
  it('paints the same pressure outline after card bodies for mixed pictures', () => {
    const g = graph()
    addInk(g, { ...stroke(), frame: { width: 200, height: 100 } }, 'card')
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(readonly path: string) {}
      }
    )
    const calls: string[] = []
    const ctx = new Proxy(
      {},
      {
        get:
          (_, key) =>
          (...args: unknown[]) => {
            calls.push(String(key))
            if (key === 'measureText') return { width: String(args[0]).length * 8 }
          },
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
      presets: ['red'],
    }
    paintCanvas(ctx, g, pictureRegion(g), theme)
    expect(calls.lastIndexOf('fill')).toBeGreaterThan(calls.lastIndexOf('fillText'))
    expect(calls).toContain('scale')
  })
})
