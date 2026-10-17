import {
  ListValue,
  NullValue,
  StringValue,
  type BasesEntry,
  type BasesPropertyId,
  type Value,
} from 'obsidian'
import { coordinates } from '@/maps/core/model'
import type { MapPlace, MapSkipped } from '@/maps/core/records'

export function mapValue(value: Value | null | undefined): unknown {
  if (!value || value instanceof NullValue) return null
  if (value instanceof ListValue)
    return Array.from({ length: value.length() }, (_, i) => mapValue(value.get(i)))
  return value.toString()
}
export function mapRows(
  rows: BasesEntry[],
  selectors: {
    coordinates: BasesPropertyId | null
    icon: BasesPropertyId | null
    color: BasesPropertyId | null
  },
  order: BasesPropertyId[],
  displayName: (id: BasesPropertyId) => string
) {
  const places: MapPlace[] = []
  const skipped: MapSkipped[] = []
  for (const row of rows) {
    const base = { path: row.file.path, title: row.file.basename }
    try {
      const parsed = coordinates(
        selectors.coordinates ? mapValue(row.getValue(selectors.coordinates)) : null
      )
      if ('reason' in parsed) {
        skipped.push({ ...base, reason: parsed.reason })
        continue
      }
      const text = (id: BasesPropertyId | null) => {
        try {
          const value = id ? row.getValue(id) : null
          return value instanceof StringValue ? value.toString() : ''
        } catch {
          return ''
        }
      }
      const properties = popupProperties(row, order, Object.values(selectors)).map(
        ({ id, value }) => ({ name: displayName(id), value: value.toString() })
      )
      places.push({
        ...base,
        id: base.path,
        ...parsed.point,
        properties,
        icon: text(selectors.icon),
        color: text(selectors.color),
      })
    } catch {
      skipped.push({ ...base, reason: 'formula-error' })
    }
  }
  return { places, skipped }
}

export function popupProperties(
  row: BasesEntry,
  order: BasesPropertyId[],
  hidden: (BasesPropertyId | null)[]
) {
  const truthy = (value: Value): boolean =>
    value.isTruthy() &&
    (!(value instanceof ListValue) ||
      Array.from({ length: value.length() }, (_, i) => value.get(i)).some(truthy))
  return order.slice(0, 20).flatMap((id) => {
    if (hidden.includes(id)) return []
    try {
      const value = row.getValue(id)
      return value && truthy(value) ? [{ id, value }] : []
    } catch {
      return []
    }
  })
}
