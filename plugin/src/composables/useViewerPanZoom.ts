import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { fitView, panBy, pinch, zoomAt, type Point, type Size, type View } from '@/mermaid/panZoom'

/** The book/diagram view arithmetic with one pointer gesture lifecycle for full-screen media. */
export function useViewerPanZoom(
  frame: Ref<HTMLElement | null>,
  content: () => Size,
  options: {
    close: () => void
    maxFitScale?: number
    wheelZoom?: boolean
    swipe?: (direction: 'prev' | 'next') => void
  }
) {
  const STEP = 1.4
  const DRAG_THRESHOLD = 6
  const view = ref<View>({ scale: 1, x: 0, y: 0 })
  const dragging = ref(false)
  let fitted = true
  let fitScale = 1
  const size = () => ({
    width: frame.value?.clientWidth ?? 0,
    height: frame.value?.clientHeight ?? 0,
  })
  const fit = () => {
    fitted = true
    view.value = fitView(size(), content(), options.maxFitScale ?? Number.POSITIVE_INFINITY)
    fitScale = view.value.scale
  }
  const setView = (next: View) => {
    fitted = false
    view.value = next
  }
  const centre = (): Point => ({ x: size().width / 2, y: size().height / 2 })
  const zoom = (factor: number) => setView(zoomAt(view.value, factor, centre()))
  const pointAt = (event: { clientX: number; clientY: number }): Point => {
    const box = frame.value?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (options.wheelZoom || event.ctrlKey || event.metaKey) {
      const lines = event.deltaMode === 1 ? 16 : 1
      setView(zoomAt(view.value, Math.exp(-event.deltaY * lines * 0.002), pointAt(event)))
    } else setView(panBy(view.value, -event.deltaX, -event.deltaY))
  }
  const onDoubleClick = (event: MouseEvent) => {
    if (view.value.scale > fitScale * 1.05) fit()
    else setView(zoomAt(view.value, 2.5, pointAt(event)))
  }
  const onKey = (event: KeyboardEvent) => {
    const moves: Record<string, () => void> = {
      '+': () => zoom(STEP),
      '=': () => zoom(STEP),
      '-': () => zoom(1 / STEP),
      '0': fit,
      ArrowLeft: () => setView(panBy(view.value, 60, 0)),
      ArrowRight: () => setView(panBy(view.value, -60, 0)),
      ArrowUp: () => setView(panBy(view.value, 0, 60)),
      ArrowDown: () => setView(panBy(view.value, 0, -60)),
    }
    if (moves[event.key]) {
      event.preventDefault()
      moves[event.key]()
    }
  }
  const pointers = new Map<number, Point>()
  let start = new Map<number, Point>()
  let startView = view.value
  let moved = 0
  let pinched = false
  const begin = () => {
    start = new Map(pointers)
    startView = view.value
  }
  const onPointerDown = (event: PointerEvent) => {
    if ((event.target as Element | null)?.closest?.('[data-viewer-controls]')) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    frame.value?.setPointerCapture?.(event.pointerId)
    pointers.set(event.pointerId, pointAt(event))
    if (pointers.size === 1) {
      moved = 0
      pinched = false
    }
    if (pointers.size > 1) pinched = true
    begin()
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return
    const now = pointAt(event)
    pointers.set(event.pointerId, now)
    const [first, second] = [...pointers.keys()]
    if (second === undefined) {
      const from = start.get(first)
      if (!from) return
      moved = Math.max(moved, Math.hypot(now.x - from.x, now.y - from.y))
      if (moved < DRAG_THRESHOLD) return
      // At fit a gallery gesture chooses an image, not a pan; after a pinch it remains a pan.
      if (options.swipe && !pinched && startView.scale <= fitScale * 1.02) return
      dragging.value = true
      setView(panBy(startView, now.x - from.x, now.y - from.y))
      return
    }
    const [a, b, c, d] = [
      start.get(first),
      start.get(second),
      pointers.get(first),
      pointers.get(second),
    ]
    if (!a || !b || !c || !d) return
    moved = Math.max(moved, DRAG_THRESHOLD)
    setView(pinch(startView, [a, b], [c, d]))
  }
  const onPointerUp = (event: PointerEvent) => {
    const from = start.get(event.pointerId)
    const at = pointers.get(event.pointerId)
    if (!pointers.delete(event.pointerId)) return
    const wasFitted = Math.abs(startView.scale - fitScale) < fitScale * 0.02
    if (
      event.type !== 'pointercancel' &&
      !pinched &&
      pointers.size === 0 &&
      start.size === 1 &&
      from &&
      at &&
      wasFitted &&
      (!options.swipe || event.pointerType !== 'mouse')
    ) {
      const dy = at.y - from.y
      const dx = at.x - from.x
      if (options.swipe) {
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
          options.swipe(dx < 0 ? 'next' : 'prev')
      } else {
        if (dy > 110 && dy > Math.abs(dx) * 2) options.close()
        else if (event.pointerType !== 'mouse' && moved >= DRAG_THRESHOLD) fit()
      }
    }
    if (pointers.size === 0) dragging.value = false
    begin()
  }
  const reset = () => {
    pointers.clear()
    dragging.value = false
    pinched = false
    fit()
  }
  let resize: ResizeObserver | null = null
  onMounted(() => {
    fit()
    frame.value?.focus()
    const win = frame.value?.ownerDocument.defaultView as
      | (Window & { ResizeObserver?: typeof ResizeObserver })
      | null
    if (!win?.ResizeObserver || !frame.value) return
    resize = new win.ResizeObserver(() => {
      if (fitted) fit()
    })
    resize.observe(frame.value)
  })
  onBeforeUnmount(() => {
    resize?.disconnect()
    pointers.clear()
  })
  return {
    view,
    dragging,
    fit,
    reset,
    zoom,
    onWheel,
    onDoubleClick,
    onKey,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
