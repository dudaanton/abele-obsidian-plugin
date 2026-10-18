/** Pure legacy item transformation; no automatic SVG rewriting or host dependency. */
import type { DrawingItem } from './items'

export function renamedNotes(
  items: readonly DrawingItem[],
  from: string,
  to: string
): DrawingItem[] | null {
  if (!items.some((item) => item.type === 'note' && item.path === from)) return null
  return items.map((item) =>
    item.type === 'note' && item.path === from ? { ...item, path: to } : item
  )
}
