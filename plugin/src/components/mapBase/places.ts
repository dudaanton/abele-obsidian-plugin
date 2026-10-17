export type {
  MapPlace,
  MapPlaceProperty,
  MapPlacePhoto,
  MapSkipReason,
  MapSkipped,
} from '@/maps/core/records'
import type { MapPlace, MapSkipReason } from '@/maps/core/records'

export const skipWords: Record<MapSkipReason, string> = {
  'no-coordinates': 'No coordinates',
  unreadable: 'Coordinates cannot be read',
  'formula-error': 'The formula failed',
}

/** A dot or a group as the view lays them out on screen at the current zoom. */
export type MapMark =
  | { kind: 'place'; place: MapPlace; x: number; y: number }
  | { kind: 'group'; places: MapPlace[]; x: number; y: number; sameSpot: boolean }

/**
 * Nearby places joined into groups: greedy, in screen space, so a group is what would otherwise
 * overlap. Places on one spot stay one group at any zoom and open as a list.
 */
export function groupMarks(
  points: { place: MapPlace; x: number; y: number }[],
  radius: number
): MapMark[] {
  const taken = new Set<number>()
  const marks: MapMark[] = []
  points.forEach((p, i) => {
    if (taken.has(i)) return
    taken.add(i)
    const members = [p]
    points.forEach((q, j) => {
      if (taken.has(j)) return
      if (Math.hypot(q.x - p.x, q.y - p.y) <= radius) {
        taken.add(j)
        members.push(q)
      }
    })
    if (members.length === 1) {
      marks.push({ kind: 'place', ...p })
      return
    }
    const x = members.reduce((s, m) => s + m.x, 0) / members.length
    const y = members.reduce((s, m) => s + m.y, 0) / members.length
    const sameSpot = members.every(
      (m) => m.place.lat === p.place.lat && m.place.lon === p.place.lon
    )
    marks.push({ kind: 'group', places: members.map((m) => m.place), x, y, sameSpot })
  })
  return marks
}

/** Straight-line distance in metres, not a route. */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`
  if (metres < 10_000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.round(metres / 1000)} km`
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

/** Where the list's distances are measured from. */
export type MapSortFrom = 'base' | 'me' | 'centre'

export const sortWords: Record<MapSortFrom, string> = {
  base: "The base's order",
  me: 'Nearest to me',
  centre: 'Nearest to the map centre',
}

/** A named background of a base's map: Obsidian Maps' tile set, light addresses and optional dark. */
export type MapBackground = { id: string; name: string; light: string[]; dark: string[] }
