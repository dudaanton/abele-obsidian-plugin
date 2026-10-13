/** Witness a point inside the visible, unobstructed part of the owned dismiss button. */
export function selectionDismissPoint(
  control: HTMLElement,
  bar: HTMLElement,
  width: number,
  height: number
): { x: number; y: number } | null {
  if (!control.isConnected || !bar.contains(control)) return null
  const r = control.getBoundingClientRect(),
    b = bar.getBoundingClientRect()
  const left = Math.max(0, r.left, b.left),
    right = Math.min(width, r.right, b.right)
  const top = Math.max(0, r.top, b.top),
    bottom = Math.min(height, r.bottom, b.bottom)
  if (right <= left || bottom <= top) return null
  const point = { x: (left + right) / 2, y: (top + bottom) / 2 }
  const hit = control.ownerDocument.elementFromPoint(point.x, point.y)
  return hit && (hit === control || control.contains(hit)) ? point : null
}
