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
