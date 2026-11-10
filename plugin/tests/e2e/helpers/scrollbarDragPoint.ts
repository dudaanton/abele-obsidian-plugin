/** Aim inside the thumb, not its rounded end or the edge of an overlay scrollbar. */
export function scrollbarDragPoint(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const height = el.clientHeight
  const range = Math.max(0, el.scrollHeight - height)
  if (!height) throw Error('Native scrollbar drag requires a visible viewport')
  const fraction = range ? Math.max(0, Math.min(1, el.scrollTop / range)) : 0
  const thumb = range ? Math.min(height, Math.max(24, (height * height) / el.scrollHeight)) : height
  const gutter = Math.max(0, el.offsetWidth - el.clientWidth)
  const inset = gutter > 0 ? gutter / 2 : 6
  const rtl = el.ownerDocument.defaultView!.getComputedStyle(el).direction === 'rtl'
  return {
    x: rtl ? rect.left + inset : rect.right - inset,
    y: rect.top + el.clientTop + fraction * (height - thumb) + thumb / 2,
  }
}

/** Hover alone does not reveal an inactive macOS overlay scrollbar. Keep the real
 * scrollbar and its hit testing; reveal it with native input before aiming at it.
 * Self-contained for serialization into the renderer probe.
 */
export async function prepareScrollbarDrag(
  el: HTMLElement,
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  wait: (ms: number) => Promise<unknown>,
  point: (el: HTMLElement) => { x: number; y: number }
) {
  // Stay on the scroller's edge, away from nested scrollable message content.
  const reveal = point(el)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    ...reveal,
    deltaX: 0,
    deltaY: -32,
  })
  await wait(100)
  // Return to the tail so even a viewport with less than 32px of overflow has
  // upward travel left for the drag. Both movements use the native scroll path.
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    ...reveal,
    deltaX: 0,
    deltaY: 32,
  })
  await wait(100)
  // Native scrolling (and the render window) can change the thumb's position.
  const target = point(el)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target, buttons: 0 })
  await wait(100)
  return point(el)
}
