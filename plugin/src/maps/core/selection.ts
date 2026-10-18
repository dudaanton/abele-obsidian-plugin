import type { MapPlace } from './records'

/** A selected place is independent of clustering; coincident places keep their group accessible. */
export function selectionLayout(
  places: MapPlace[],
  id: string | null,
  group: boolean,
  project?: (place: MapPlace) => { point: { x: number; y: number }; width: number; height: number },
  gap = 48
): { place: MapPlace | undefined; points: MapPlace[]; offset: [number, number] } {
  const place = places.find((p) => p.id === id)
  const points = place ? places.filter((p) => p.id !== id) : places
  if (!place || !group || !points.some((p) => p.lat === place.lat && p.lon === place.lon))
    return { place, points, offset: [0, 0] }
  let offset: [number, number] = [0, -gap]
  const screen = project?.(place)
  if (screen) {
    const candidates: [number, number][] = [offset, [0, gap], [gap, 0], [-gap, 0]]
    const margin = gap / 2
    offset =
      candidates.find(
        ([x, y]) =>
          screen.point.x + x >= margin &&
          screen.point.x + x <= screen.width - margin &&
          screen.point.y + y >= margin &&
          screen.point.y + y <= screen.height - margin
      ) ?? offset
  }
  return { place, points, offset }
}
