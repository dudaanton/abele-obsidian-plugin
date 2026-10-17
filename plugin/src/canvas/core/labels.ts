import type { CanvasGraph } from './model'
import { linesOf } from './primitives'
import { defaultMetrics, labelBox, labelPoint, paintedRoute, type TextMetricsPort } from './scene'

/** Only captions whose routes can actually be painted. Sorted independently of stacking. */
export function canvasLabels(graph: CanvasGraph, metrics: TextMetricsPort = defaultMetrics) {
  return [
    ...graph.edges.flatMap((edge) => {
      const route = paintedRoute(edge, graph)
      return edge.label && route.points.length
        ? [
            {
              id: edge.id,
              box: labelBox(edge.label, labelPoint(route, edge.abele?.labelPosition), metrics),
            },
          ]
        : []
    }),
    ...linesOf(graph).flatMap((line) =>
      line.label
        ? [
            {
              id: line.id,
              box: labelBox(
                line.label,
                labelPoint({ kind: 'polyline', points: [line.from, line.to] }, line.labelPosition),
                metrics
              ),
            },
          ]
        : []
    ),
  ].sort((a, b) => a.id.localeCompare(b.id))
}
