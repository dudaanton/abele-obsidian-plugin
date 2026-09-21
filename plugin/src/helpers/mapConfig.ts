import { parseYaml } from 'obsidian'

/**
 * What a map is, before anything draws it.
 *
 * Kept apart from the drawing so the parsing can be read and tested without a WebGL context:
 * `abele-map` blocks, an agent's route and a note's own coordinates all arrive here first and
 * come out as the same small structure.
 */

export interface MapPoint {
  lat: number
  lon: number
  label?: string
  /** Any CSS colour. Left out, the marker takes the theme's accent. */
  color?: string
}

export interface MapLine {
  points: MapPoint[]
  color?: string
}

export interface MapConfig {
  points: MapPoint[]
  lines: MapLine[]
  center?: MapPoint
  zoom?: number
  /** Height in pixels. */
  height: number
  /** A style URL of one's own, instead of the free one the plugin ships with. */
  style?: string
  /** False for a picture rather than something to drag around — used in a chat. */
  interactive: boolean
}

export const DEFAULT_MAP_HEIGHT = 320

/** `56.9496, 24.1052`, and the other separators a person types. */
export function parsePoint(input: unknown): MapPoint | null {
  if (typeof input === 'number') return null

  if (Array.isArray(input) && input.length >= 2) {
    const lat = Number(input[0])
    const lon = Number(input[1])
    return valid(lat, lon) ? { lat, lon } : null
  }

  if (input && typeof input === 'object') {
    const row = input as Record<string, unknown>
    const inner =
      row.location ?? row.coordinates ?? row.point ?? (row.lat !== undefined ? null : undefined)
    const base =
      inner !== undefined && inner !== null
        ? parsePoint(inner)
        : valid(Number(row.lat), Number(row.lon))
          ? { lat: Number(row.lat), lon: Number(row.lon) }
          : null
    if (!base) return null

    return {
      ...base,
      label:
        typeof row.label === 'string'
          ? row.label
          : typeof row.name === 'string'
            ? row.name
            : undefined,
      color: typeof row.color === 'string' ? row.color : undefined,
    }
  }

  if (typeof input !== 'string') return null

  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input)
  if (!match) return null

  const lat = Number(match[1])
  const lon = Number(match[2])
  return valid(lat, lon) ? { lat, lon } : null
}

function valid(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

/**
 * The encoded polyline every routing service answers with, turned back into points.
 *
 * Valhalla encodes at six decimals and OSRM at five; the difference is a factor of ten in the
 * result, which is the whole world away rather than a rounding error, so the precision travels
 * with the line.
 */
export function decodePolyline(encoded: string, precision = 6): MapPoint[] {
  const factor = Math.pow(10, precision)
  const points: MapPoint[] = []

  let index = 0
  let lat = 0
  let lon = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    lon += result & 1 ? ~(result >> 1) : result >> 1

    points.push({ lat: lat / factor, lon: lon / factor })
  }

  return points
}

/**
 * A map as it is written down — in an `abele-map` block, or in what a tool hands the chat.
 *
 * The same shape either way on purpose: a route the agent drew in a chat can be pasted into
 * a note as a block and mean the same thing.
 */
export interface MapBlock {
  points?: unknown
  point?: unknown
  center?: unknown
  zoom?: number
  height?: number
  style?: string
  route?: string
  routePrecision?: number
  lines?: unknown
  color?: string
  interactive?: boolean
}

function parsePoints(input: unknown): MapPoint[] {
  if (!input) return []
  const rows = Array.isArray(input) ? input : [input]
  return rows.map(parsePoint).filter((p): p is MapPoint => p !== null)
}

function parseLines(block: MapBlock): MapLine[] {
  const lines: MapLine[] = []

  if (typeof block.route === 'string' && block.route.trim()) {
    // Several legs of one journey arrive joined by `;`, each encoded on its own.
    for (const leg of block.route.split(';')) {
      if (!leg) continue
      const points = decodePolyline(leg, block.routePrecision ?? 6)
      if (points.length > 1) lines.push({ points, color: block.color })
    }
  }

  const rows = Array.isArray(block.lines) ? block.lines : []
  for (const row of rows) {
    const line = row as {
      points?: unknown
      route?: string
      routePrecision?: number
      color?: string
    }
    const points = line.route
      ? decodePolyline(line.route, line.routePrecision ?? 6)
      : parsePoints(line.points)
    if (points.length > 1) lines.push({ points, color: line.color })
  }

  return lines
}

/**
 * An `abele-map` block, read.
 *
 * Nothing here throws: a block someone is still typing should show an empty map rather than a
 * stack trace in the middle of their note.
 */
export function parseMapBlock(source: string): MapConfig | { error: string } {
  let block: MapBlock

  try {
    block = (parseYaml(source) || {}) as MapBlock
  } catch (error) {
    return { error: `YAML parse error: ${error instanceof Error ? error.message : error}` }
  }

  if (typeof block !== 'object') return { error: 'Expected a block of settings' }

  return normalizeMapBlock(block)
}

/** The same, for a block that arrived as data rather than as text. */
export function normalizeMapBlock(block: MapBlock): MapConfig | { error: string } {
  const points = [...parsePoints(block.points), ...parsePoints(block.point)]
  const lines = parseLines(block)
  const center = block.center ? parsePoint(block.center) : null

  if (!points.length && !lines.length && !center) {
    return { error: 'Nothing to show: give points, a route or a center' }
  }

  return {
    points,
    lines,
    center: center ?? undefined,
    zoom: typeof block.zoom === 'number' ? block.zoom : undefined,
    height: typeof block.height === 'number' ? block.height : DEFAULT_MAP_HEIGHT,
    style: typeof block.style === 'string' && block.style ? block.style : undefined,
    interactive: block.interactive !== false,
  }
}

/** Everything the map has to fit in view: its pins and every point of every line. */
export function mapBounds(config: MapConfig): { min: MapPoint; max: MapPoint } | null {
  const all = [...config.points, ...config.lines.flatMap((line) => line.points)]
  if (!all.length) return null

  return {
    min: {
      lat: Math.min(...all.map((p) => p.lat)),
      lon: Math.min(...all.map((p) => p.lon)),
    },
    max: {
      lat: Math.max(...all.map((p) => p.lat)),
      lon: Math.max(...all.map((p) => p.lon)),
    },
  }
}
