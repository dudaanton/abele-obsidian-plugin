<template>
  <ObsidianModal :title="title" size="full" @close="emit('close')">
    <div
      ref="frame"
      class="abele-book-figure"
      :class="{ 'abele-book-figure_dragging': dragging }"
      data-ignore-swipe="true"
      tabindex="0"
      role="figure"
      :aria-label="`${title}. Drag to move it, pinch or plus and minus to zoom, swipe down to close.`"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="onDoubleClick"
      @keydown="onKey"
    >
      <div
        class="abele-book-figure__canvas"
        :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }"
      >
        <img
          v-if="figure.kind === 'image'"
          class="abele-book-figure__image"
          :src="figure.src"
          :alt="figure.alt"
          :width="figure.width"
          :height="figure.height"
          draggable="false"
        />
        <iframe
          v-else
          class="abele-book-figure__table"
          :srcdoc="figure.html"
          sandbox="allow-same-origin"
          :width="figure.width + 16"
          :height="figure.height + 16"
          tabindex="-1"
          title="Table"
        />
      </div>
      <div class="abele-book-figure__controls">
        <Icon icon="zoom-out" tooltip="Zoom out" @click="zoom(1 / STEP)" />
        <Icon icon="scan" tooltip="Fit it on the screen" @click="fit" />
        <Icon icon="zoom-in" tooltip="Zoom in" @click="zoom(STEP)" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * A picture or a table from a book's page, full screen: pinched or wheeled with Mod to zoom,
 * dragged to move, double-tapped to zoom in on a spot and back, fitted again with the middle
 * button or 0, and closed with the dialog's button, Escape, or a swipe down while it is fitted.
 *
 * A table is shown in a frame that runs nothing, as every page of the book is, and the frame
 * takes no pointer events: every gesture is this viewer's.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Icon from '../obsidian/Icon.vue'
import type { BookFigure } from '@/reader/figures'
import { fitView, panBy, pinch, zoomAt, type Point, type View } from '@/mermaid/panZoom'

const props = defineProps<{ figure: BookFigure }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const STEP = 1.4
/** How far a finger drags down, with the figure fitted, to close the viewer. */
const CLOSE_DRAG = 110
const DRAG_THRESHOLD = 6

const title = computed(() =>
  props.figure.kind === 'table' ? 'Table' : props.figure.alt.trim() || 'Picture'
)
const frame = ref<HTMLElement | null>(null)
const view = ref<View>({ scale: 1, x: 0, y: 0 })
const dragging = ref(false)
let fitted = true
let fitScale = 1

const size = () => ({
  width: frame.value?.clientWidth ?? 0,
  height: frame.value?.clientHeight ?? 0,
})
const content = () => ({
  width: props.figure.width + (props.figure.kind === 'table' ? 16 : 0),
  height: props.figure.height + (props.figure.kind === 'table' ? 16 : 0),
})

/** The whole figure on the screen, as large as the screen lets it be. */
const fit = () => {
  fitted = true
  view.value = fitView(size(), content(), Number.POSITIVE_INFINITY)
  fitScale = view.value.scale
}

const setView = (next: View) => {
  fitted = false
  view.value = next
}

const centre = (): Point => ({ x: size().width / 2, y: size().height / 2 })
const zoom = (factor: number) => setView(zoomAt(view.value, factor, centre()))

const pointAt = (e: { clientX: number; clientY: number }): Point => {
  const box = frame.value?.getBoundingClientRect()
  return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
}

const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    const lines = e.deltaMode === 1 ? 16 : 1
    setView(zoomAt(view.value, Math.exp(-e.deltaY * lines * 0.002), pointAt(e)))
  } else setView(panBy(view.value, -e.deltaX, -e.deltaY))
}

const onDoubleClick = (e: MouseEvent) => {
  if (view.value.scale > fitScale * 1.05) fit()
  else setView(zoomAt(view.value, 2.5, pointAt(e)))
}

const onKey = (e: KeyboardEvent) => {
  const step = 60
  const moves: Record<string, () => void> = {
    '+': () => zoom(STEP),
    '=': () => zoom(STEP),
    '-': () => zoom(1 / STEP),
    '0': fit,
    ArrowLeft: () => setView(panBy(view.value, step, 0)),
    ArrowRight: () => setView(panBy(view.value, -step, 0)),
    ArrowUp: () => setView(panBy(view.value, 0, step)),
    ArrowDown: () => setView(panBy(view.value, 0, -step)),
  }
  const move = moves[e.key]
  if (!move) return
  e.preventDefault()
  move()
}

const pointers = new Map<number, Point>()
let start = new Map<number, Point>()
let startView: View = view.value
let moved = 0

const begin = () => {
  start = new Map(pointers)
  startView = view.value
}

const onPointerDown = (e: PointerEvent) => {
  if ((e.target as Element | null)?.closest?.('.abele-book-figure__controls')) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  frame.value?.setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, pointAt(e))
  if (pointers.size === 1) moved = 0
  begin()
}

const onPointerMove = (e: PointerEvent) => {
  if (!pointers.has(e.pointerId)) return
  const now = pointAt(e)
  pointers.set(e.pointerId, now)
  const [first, second] = [...pointers.keys()]
  if (second === undefined) {
    const from = start.get(first)
    if (!from) return
    moved = Math.max(moved, Math.hypot(now.x - from.x, now.y - from.y))
    if (moved < DRAG_THRESHOLD) return
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

const onPointerUp = (e: PointerEvent) => {
  const from = start.get(e.pointerId)
  const at = pointers.get(e.pointerId)
  if (!pointers.delete(e.pointerId)) return
  // A single finger that dragged the fitted figure down, mostly down: the viewer closes.
  const wasFitted = Math.abs(startView.scale - fitScale) < fitScale * 0.02
  if (pointers.size === 0 && start.size === 1 && from && at && wasFitted) {
    const dy = at.y - from.y
    const dx = at.x - from.x
    if (dy > CLOSE_DRAG && dy > Math.abs(dx) * 2) {
      emit('close')
      return
    }
    // Let go of a figure only moved, not zoomed: it goes back to fit the screen.
    if (e.pointerType !== 'mouse' && moved >= DRAG_THRESHOLD) fit()
  }
  if (pointers.size === 0) dragging.value = false
  begin()
}

let resize: ResizeObserver | null = null
onMounted(() => {
  fit()
  frame.value?.focus()
  // The window the dialog opened in, whose own constructor watches it.
  const win = frame.value?.ownerDocument.defaultView as unknown as {
    ResizeObserver: typeof ResizeObserver
  } | null
  if (!win || !frame.value) return
  resize = new win.ResizeObserver(() => {
    if (fitted) fit()
  })
  resize.observe(frame.value)
})
onBeforeUnmount(() => resize?.disconnect())
</script>

<style lang="scss">
.abele-book-figure {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: grab;
  outline: none;
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
}

.abele-book-figure_dragging {
  cursor: grabbing;
}

.abele-book-figure__canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.abele-book-figure__image {
  display: block;
  max-width: none;
  background-color: white;
}

.abele-book-figure__table {
  display: block;
  border: 0;
  background-color: Canvas;
  pointer-events: none;
}

.abele-book-figure__controls {
  position: absolute;
  right: var(--size-4-2);
  bottom: var(--size-4-2);
  display: flex;
  gap: var(--size-2-1);
  padding: var(--size-2-1);
  background-color: var(--background-primary);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  cursor: default;
}
</style>
