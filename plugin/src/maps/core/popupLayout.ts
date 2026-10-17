/** Popup geometry is local to its map, including when that map is in a narrow split. */
export function popupLayout(
  size: { width: number; height: number },
  point: { x: number; y: number },
  padding = 12
) {
  let width = Math.max(1, Math.min(280, size.width - 24))
  let side: '' | '-left' | '-right' = ''
  let offset = 0
  if (point.x < width / 2 + 12) {
    side = '-left'
    offset = 18
    width = Math.max(1, Math.min(width, size.width - point.x - 30))
  } else if (point.x > size.width - width / 2 - 12) {
    side = '-right'
    offset = -18
    width = Math.max(1, Math.min(width, point.x - 30))
  }
  const left =
    side === '-left'
      ? point.x + offset
      : side === '-right'
        ? point.x + offset - width
        : point.x - width / 2
  const below = point.y < size.height / 2
  return {
    width,
    left,
    height: Math.max(32, (below ? size.height - point.y : point.y) - 36 - padding * 2),
    anchor: `${below ? 'top' : 'bottom'}${side}` as const,
    offset: [offset, below ? 18 : -18] as [number, number],
  }
}
