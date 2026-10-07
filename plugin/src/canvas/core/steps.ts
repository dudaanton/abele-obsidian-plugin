/** Ordered explanation data and deterministic playback, with no host or storage API. */
import { z } from 'zod'
import { bounds, cloneCanvas, descendants, parentsOf, type CanvasGraph, type Rect } from './model'
import { routeEdge } from './scene'
import { linesOf, lineBounds } from './primitives'

export const cameraRegionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict()
export const canvasStepSchema = z
  .object({
    id: z.string().min(1),
    reveal: z.array(z.string().min(1)),
    highlight: z.array(z.string().min(1)).optional(),
    focus: z.union([z.string().min(1), cameraRegionSchema]).optional(),
    say: z.string(),
  })
  .loose()
export type CanvasStep = z.infer<typeof canvasStepSchema>
export const stepOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace'), steps: z.array(canvasStepSchema) }).strict(),
  z
    .object({
      op: z.literal('upsert'),
      step: canvasStepSchema,
      before: z.string().min(1).nullable().optional(),
    })
    .strict(),
  z.object({ op: z.literal('remove'), id: z.string().min(1) }).strict(),
  z
    .object({ op: z.literal('move'), id: z.string().min(1), before: z.string().min(1).nullable() })
    .strict(),
])
/** Older hand-written steps have no ids. These synthesized ids are persisted only on authoring. */
export function stepsOf(graph: CanvasGraph): CanvasStep[] {
  const raw = graph.abele?.steps
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error('Canvas steps must be an ordered array')
  const steps = raw.map((value, i) =>
    canvasStepSchema.parse(
      value && typeof value === 'object' ? { id: `step-${i + 1}`, say: '', ...value } : value
    )
  )
  const ids = new Set<string>()
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error(`Duplicate step id: ${step.id}`)
    ids.add(step.id)
  }
  return steps
}
export function expandedNodeIds(graph: CanvasGraph, refs: readonly string[]): Set<string> {
  const parents = parentsOf(graph),
    ids = new Set<string>()
  for (const id of refs) {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) continue
    ids.add(id)
    if (node.type === 'group') for (const child of descendants(id, parents)) ids.add(child)
  }
  return ids
}
export function editCanvasSteps(input: CanvasGraph, ops: unknown): CanvasGraph {
  const graph = cloneCanvas(input)
  const operations = z.array(z.unknown()).min(1).parse(ops)
  // A full replacement is also the recovery path for malformed hand-written step data.
  const first = operations[0] as { op?: unknown } | null
  let steps = first?.op === 'replace' ? [] : stepsOf(graph)
  operations.forEach((raw, index) => {
    try {
      const op = stepOperationSchema.parse(raw)
      const locate = (id: string) => {
        const at = steps.findIndex((s) => s.id === id)
        if (at < 0) throw new Error(`Unknown step id ${id}`)
        return at
      }
      const insert = (step: CanvasStep, before: string | null) => {
        steps.splice(before === null ? steps.length : locate(before), 0, step)
      }
      if (op.op === 'replace') steps = op.steps
      else if (op.op === 'remove') steps.splice(locate(op.id), 1)
      else if (op.op === 'move') {
        if (op.id === op.before) throw new Error('A step cannot be moved before itself')
        const [step] = steps.splice(locate(op.id), 1)
        insert(step, op.before)
      } else {
        const at = steps.findIndex((s) => s.id === op.step.id)
        if (op.before === op.step.id) throw new Error('A step cannot be placed before itself')
        const merged = at >= 0 ? { ...steps[at], ...op.step } : op.step
        if (at >= 0 && op.before === undefined) steps[at] = merged
        else {
          if (at >= 0) steps.splice(at, 1)
          insert(merged, op.before ?? null)
        }
      }
      graph.abele = { ...graph.abele, steps }
      steps = stepsOf(graph)
      const ids = new Set([...graph.nodes, ...graph.edges, ...linesOf(graph)].map((e) => e.id))
      for (const step of steps)
        for (const id of [
          ...step.reveal,
          ...(step.highlight ?? []),
          ...(typeof step.focus === 'string' ? [step.focus] : []),
        ]) {
          if (!ids.has(id)) throw new Error(`Step ${step.id}: unknown diagram id ${id}`)
        }
    } catch (error) {
      throw new Error(
        `Canvas steps op ${index}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  })
  return graph
}
/** Connections appear only once both endpoints are visible; highlighting never reveals nodes. */
export function stepScene(graph: CanvasGraph, number: number) {
  const steps = stepsOf(graph)
  if (!Number.isInteger(number) || number < 1 || number > steps.length)
    throw new Error(`Unknown canvas step ${number}; use 1–${steps.length}`)
  const step = steps[number - 1],
    parents = parentsOf(graph)
  const revealed = expandedNodeIds(
    graph,
    steps.slice(0, number).flatMap((s) => s.reveal)
  )
  const refs = new Set(steps.slice(0, number).flatMap((s) => s.reveal)),
    lines = linesOf(graph).filter((l) => refs.has(l.id))
  const visible = new Set(revealed)
  for (const id of revealed) {
    let parent = parents.get(id)
    while (parent) {
      visible.add(parent)
      parent = parents.get(parent)
    }
  }
  const scene: CanvasGraph = {
    ...graph,
    abele: { ...graph.abele, lines },
    nodes: graph.nodes.filter((n) => visible.has(n.id)),
    edges: graph.edges.filter((e) => visible.has(e.fromNode) && visible.has(e.toNode)),
  }
  const highlight = new Set([
    ...(step.highlight ?? []),
    ...expandedNodeIds(graph, step.highlight ?? []),
  ])
  const rectangles = (ids: ReadonlySet<string>): Rect[] => [
    ...scene.nodes.filter((n) => ids.has(n.id)),
    ...lines.filter((l) => ids.has(l.id)).map((l) => lineBounds(l)),
    ...scene.edges
      .filter((e) => ids.has(e.id))
      .flatMap((e) => routeEdge(e, scene))
      .map((p) => ({ ...p, width: 1, height: 1 })),
  ]
  let region: Rect
  if (typeof step.focus === 'object') region = { ...step.focus }
  else if (typeof step.focus === 'string') {
    // A focus may describe the next level, but must never expose unrevealed content.
    const target =
      graph.nodes.find((n) => n.id === step.focus) ??
      graph.edges.find((e) => e.id === step.focus) ??
      linesOf(graph).find((l) => l.id === step.focus)
    if (!target) throw new Error(`Step ${step.id}: missing focus id ${step.focus}`)
    const rects = rectangles(new Set([step.focus]))
    region = bounds(
      rects.length ? rects : rectangles(new Set([...revealed, ...lines.map((l) => l.id)])),
      24
    )
  } else region = bounds(rectangles(new Set([...revealed, ...lines.map((l) => l.id)])), 24)
  return {
    graph: scene,
    region,
    highlight,
    say: step.say,
    step,
    number,
    total: steps.length,
    revealed,
  }
}
