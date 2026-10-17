import type { StyleSpecification } from 'maplibre-gl'

/** Compatibility baseline: obsidianmd/obsidian-maps 0.2.2. */
export const MAPS_BASELINE = '0.2.2'
export type Point = { lat: number; lon: number }
/** A clicked world copy is the same geographic point, never an out-of-range stored longitude. */
export function wrapLongitude(lon: number): number {
  return lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180
}
export type Background = { id: string; name: string; light: string[]; dark: string[] }
export function coordinates(
  value: unknown
): { point: Point } | { reason: 'no-coordinates' | 'unreadable' } {
  if (value == null || value === '') return { reason: 'no-coordinates' }
  const parts = typeof value === 'string' ? value.split(',') : value
  if (!Array.isArray(parts) || parts.length < 2) return { reason: 'unreadable' }
  const numbers = parts
    .slice(0, 2)
    .map((v: unknown) =>
      typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? parseFloat(v.trim()) : NaN
    )
  const [lat, lon] = numbers
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { point: { lat, lon } }
    : { reason: 'unreadable' }
}
export type Camera = {
  center: [number, number]
  zoom: number
  minZoom?: number
  maxZoom?: number
  bounds?: [[number, number], [number, number]]
}
const numeric = (v: unknown, fallback: number) =>
  v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : fallback
export function camera(
  points: Point[],
  options: { center?: unknown; zoom?: unknown; minZoom?: unknown; maxZoom?: unknown },
  history?: Camera
): Camera {
  const minZoom = Math.max(0, Math.min(24, numeric(options.minZoom, 0)))
  const maxZoom = Math.max(minZoom, Math.min(24, numeric(options.maxZoom, 18)))
  const clamp = (v: number) => Math.max(minZoom, Math.min(maxZoom, v))
  if (history) return { ...history, zoom: clamp(history.zoom), minZoom, maxZoom }
  const parsed = coordinates(options.center)
  const point = 'point' in parsed ? parsed.point : points[0]
  const result: Camera = {
    center: point ? [point.lon, point.lat] : [10, 30],
    zoom: clamp(numeric(options.zoom, points.length ? 15 : 1.5)),
    minZoom,
    maxZoom,
  }
  if (!('point' in parsed) && points.length > 1)
    result.bounds = [
      [Math.min(...points.map((p) => p.lon)), Math.min(...points.map((p) => p.lat))],
      [Math.max(...points.map((p) => p.lon)), Math.max(...points.map((p) => p.lat))],
    ]
  return result
}
export function writableCoordinateKey(selector: string | null): string | null {
  return selector?.startsWith('note.') && selector.length > 5 ? selector.slice(5) : null
}
export const DEFAULT_LIGHT = 'https://tiles.openfreemap.org/styles/bright'
export const DEFAULT_DARK = 'https://tiles.openfreemap.org/styles/dark'
export function backgroundStyle(urls: string[], dark = false): string | StyleSpecification {
  if (!urls.length) return dark ? DEFAULT_DARK : DEFAULT_LIGHT
  if (urls.length === 1 && !['{z}', '{x}', '{y}'].some((token) => urls[0].includes(token)))
    return urls[0]
  const sources: StyleSpecification['sources'] = {}
  const layers: StyleSpecification['layers'] = []
  urls.forEach((url, i) => {
    const id = `background-${i}`
    sources[id] = { type: 'raster', tiles: [url], tileSize: 256 }
    layers.push({ id, type: 'raster', source: id })
  })
  return { version: 8, sources, layers }
}
export function backgroundsFrom(value: unknown): Background[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const v = entry as Partial<Background>
    const urls = (raw: unknown) =>
      Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
    return typeof v.id === 'string' &&
      typeof v.name === 'string' &&
      v.name.trim() &&
      urls(v.light).length
      ? [{ id: v.id, name: v.name, light: urls(v.light), dark: urls(v.dark) }]
      : []
  })
}
