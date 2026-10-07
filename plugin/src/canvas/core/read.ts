import { labelOf, overlaps, parentsOf, type CanvasGraph, type Rect } from './model'
import { lintCanvas } from './lint'
import { linesOf, lineBounds } from './primitives'
import { allInkEntries, inkEntries, inkBounds, inkTransform } from './ink'
import { stepScene } from './steps'
import { defaultMetrics, type TextMetricsPort } from './scene'
/** Card geometry appears in full detail; primitives/ink carry geometry in every read. Sorted by id. */
export function canvasOutline(
  graph: CanvasGraph,
  options: { detail?: 'outline' | 'full'; region?: Rect; step?: number } = {},
  metrics: TextMetricsPort = defaultMetrics
) {
  const source = graph
  if (options.step !== undefined) graph = stepScene(graph, options.step).graph
  const parents = parentsOf(graph),
    selected = options.region ? graph.nodes.filter((n) => overlaps(n, options.region)) : graph.nodes
  const ids = new Set(selected.map((n) => n.id))
  const nodes = [...selected]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({
      id: n.id,
      type: n.type,
      shape: n.styleAttributes?.shape ?? 'rectangle',
      label: labelOf(n).replace(/\s+/g, ' ').slice(0, 160),
      ...(n.file ? { file: n.file, subpath: n.subpath } : {}),
      parent: parents.get(n.id) ?? null,
      collapsed: n.collapsed ?? false,
      ...(options.detail === 'full' ? { data: n } : {}),
    }))
  const groups = (parent: string | null): unknown[] =>
    nodes
      .filter((n) => n.type === 'group' && n.parent === parent)
      .map((n) => ({
        id: n.id,
        label: n.label,
        children: nodes.filter((c) => c.parent === n.id && c.type !== 'group').map((c) => c.id),
        groups: groups(n.id),
      }))
  return {
    groups: groups(null),
    nodes,
    edges: graph.edges
      .filter((e) => ids.has(e.fromNode) || ids.has(e.toNode))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) =>
        options.detail === 'full'
          ? e
          : { id: e.id, from: e.fromNode, to: e.toNode, label: e.label ?? '' }
      ),
    lines: linesOf(graph)
      .filter((l) => !options.region || overlaps(lineBounds(l), options.region))
      .sort((a, b) => a.id.localeCompare(b.id)),
    ink: (options.step === undefined ? allInkEntries(graph) : inkEntries(graph))
      .filter((entry) => !options.region || overlaps(inkBounds(entry), options.region))
      .sort((a, b) => a.stroke.id.localeCompare(b.stroke.id))
      .map((entry) => ({
        ...entry.stroke,
        node: entry.node?.id ?? null,
        world: inkTransform(entry),
        bounds: inkBounds(entry),
      })),
    steps: source.abele?.steps ?? [],
    ...(options.step !== undefined
      ? {
          playback: {
            number: options.step,
            say: stepScene(source, options.step).say,
            region: stepScene(source, options.step).region,
          },
        }
      : {}),
    warnings: lintCanvas(source, metrics),
    ...(options.detail === 'full'
      ? {
          extensions: Object.fromEntries(
            Object.entries(graph).filter(([key]) => key !== 'nodes' && key !== 'edges')
          ),
        }
      : {}),
  }
}
