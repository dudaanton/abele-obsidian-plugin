import type { EditorView } from '@codemirror/view'

interface FlightDecoration {
  block?: boolean
  startSide?: number
  endSide?: number
  widget?: object
  isReplace?: boolean
  spec?: { side?: number }
}
interface FlightTile {
  length?: number
  flags?: number
  breakAfter?: number
  parent?: FlightTile | null
  children?: FlightTile[]
  widget?: object
}

/** Bounded metadata only; never reads source text, DOM contents, or layout. */
export function columnRedrawDetail(
  view: EditorView,
  docView: Record<string, unknown>,
  args: unknown[],
  widgetId: (widget: object) => number
): string {
  const ranges: object[] = []
  const sets = docView.decorations as
    | {
        between(
          from: number,
          to: number,
          visit: (from: number, to: number, value: FlightDecoration) => false | void
        ): void
      }[]
    | undefined
  for (const [set, decorations] of (sets ?? []).entries()) {
    decorations.between(0, view.state.doc.length, (from, to, value) => {
      if (ranges.length >= 200) return false
      ranges.push({
        set,
        from,
        to,
        block: value.block,
        startSide: value.startSide,
        endSide: value.endSide,
        widget: value.widget ? widgetId(value.widget) : undefined,
        type: value.widget?.constructor.name,
        decorationType: value.constructor.name,
        replace: value.isReplace,
        side: value.spec?.side,
      })
    })
    if (ranges.length >= 200) break
  }
  const seen = new Map<FlightTile, number>()
  const tiles: object[] = []
  const pending = [{ tile: docView.tile as FlightTile | undefined, parent: 0 }]
  let repeated = false
  let brokenParent = false
  while (pending.length && tiles.length < 256) {
    const item = pending.pop()
    if (!item) break
    const { tile, parent } = item
    if (!tile) continue
    if (seen.has(tile)) {
      repeated = true
      continue
    }
    const id = seen.size + 1
    seen.set(tile, id)
    if (parent ? !tile.parent || seen.get(tile.parent) !== parent : !!tile.parent)
      brokenParent = true
    tiles.push({
      id,
      parent,
      length: tile.length,
      flags: tile.flags,
      breakAfter: tile.breakAfter,
      widget: tile.widget ? widgetId(tile.widget) : undefined,
      type: tile.widget?.constructor.name,
    })
    for (const child of (tile.children ?? []).slice(0, 256).reverse())
      pending.push({ tile: child, parent: id })
  }
  return JSON.stringify({
    selection: view.state.selection?.main && {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
    },
    changes: Array.isArray(args[0])
      ? args[0]
          .slice(0, 64)
          .map(({ fromA, toA, fromB, toB }: Record<string, number>) => ({ fromA, toA, fromB, toB }))
      : undefined,
    composition: !!args[1],
    ranges,
    rangesTruncated: ranges.length >= 200,
    tiles,
    tilesTruncated: pending.length > 0,
    repeated,
    brokenParent,
  })
}
