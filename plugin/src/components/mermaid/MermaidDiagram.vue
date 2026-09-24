<template>
  <div
    ref="root"
    class="abele-mermaid"
    :class="{ 'abele-mermaid_full': full, 'abele-mermaid_error': error !== null }"
  >
    <div v-if="error !== null" class="abele-mermaid__error">
      <div class="abele-mermaid__error-head">
        <div class="abele-mermaid__error-title">This diagram could not be drawn</div>
        <div class="abele-mermaid__error-actions">
          <Icon v-if="edit" icon="code-2" tooltip="Edit the diagram's source" @click="edit()" />
          <Icon icon="copy" tooltip="Copy the diagram's source" @click="copySource" />
        </div>
      </div>
      <pre class="abele-mermaid__error-text">{{ error }}</pre>
    </div>
    <div
      v-else
      ref="frame"
      class="abele-mermaid__frame"
      :class="{ 'abele-mermaid__frame_dragging': dragging }"
      tabindex="0"
      role="figure"
      aria-label="Mermaid diagram. Drag to move it, arrow keys to pan, plus and minus to zoom."
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click.capture="onClick"
      @keydown="onKey"
    >
      <div ref="canvas" class="abele-mermaid__canvas" />
      <div class="abele-mermaid__controls abele-mermaid__controls_top">
        <Icon v-if="edit" icon="code-2" tooltip="Edit the diagram's source" @click="edit()" />
        <Icon
          icon="copy"
          tooltip="Copy the diagram: its source, a picture, or SVG"
          @click="openCopyMenu"
        />
        <Icon
          v-if="!full"
          icon="maximize-2"
          tooltip="Open the diagram full screen"
          class="abele-mermaid__fullscreen"
          @click="fullOpen = true"
        />
      </div>
      <div class="abele-mermaid__controls abele-mermaid__pad">
        <span />
        <Icon icon="chevron-up" tooltip="Pan up" @click="pan(0, 1)" />
        <Icon
          icon="zoom-in"
          tooltip="Zoom in"
          class="abele-mermaid__zoom-in"
          @click="zoom(ZOOM_STEP)"
        />
        <Icon icon="chevron-left" tooltip="Pan left" @click="pan(1, 0)" />
        <Icon
          icon="scan"
          tooltip="Fit the whole diagram in the frame"
          class="abele-mermaid__reset"
          @click="reset"
        />
        <Icon icon="chevron-right" tooltip="Pan right" @click="pan(-1, 0)" />
        <span />
        <Icon icon="chevron-down" tooltip="Pan down" @click="pan(0, -1)" />
        <Icon
          icon="zoom-out"
          tooltip="Zoom out"
          class="abele-mermaid__zoom-out"
          @click="zoom(1 / ZOOM_STEP)"
        />
      </div>
    </div>
    <Modal v-if="fullOpen" size="full" title="Diagram" @close="fullOpen = false">
      <MermaidDiagram :source="source" :source-path="sourcePath" full />
    </Modal>
  </div>
</template>

<script setup lang="ts">
/**
 * A mermaid diagram as GitHub shows one: the width of the note, in a frame you can zoom and
 * drag inside, with a full-screen view and copies of it a click away.
 *
 * Drawn only once it comes near the screen — a note with twenty diagrams draws the two in
 * view — and drawn again when the theme switches between light and dark. Drawing goes through
 * `renderDiagram`, which keeps every drawing by source and theme, so scrolling back, reopening
 * a note or opening the full-screen view costs nothing.
 *
 * The page keeps its scroll. The wheel zooms only with Mod held (or a trackpad pinch, which
 * arrives as the same thing); without it the note scrolls past the diagram as it would past a
 * picture. On a phone a finger inside the frame moves the diagram and two fingers zoom it;
 * outside the frame the page scrolls as ever.
 */
import { nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Keymap, Menu, Notice } from 'obsidian'
import Icon from '@/components/obsidian/Icon.vue'
import Modal from '@/components/obsidian/Modal.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { renderDiagram, placeDiagram } from '@/mermaid/renderMermaid'
import { svgMarkup, svgToPng } from '@/mermaid/diagramExport'
import type { DiagramTheme } from '@/mermaid/mermaidSource'
import {
  fitView,
  frameHeight,
  panBy,
  pinch,
  zoomAt,
  MIN_FRAME_HEIGHT,
  type Point,
  type Size,
  type View,
} from '@/mermaid/panZoom'

const props = defineProps<{
  source: string
  /** The note the diagram is in, for resolving a node that links to a note. */
  sourcePath: string
  /** The full-screen view: fills its dialog and may enlarge a small diagram to do so. */
  full?: boolean
  /** In the editor: puts the cursor into the block, which shows its source. */
  edit?: () => void
}>()

const ZOOM_STEP = 1.25
/** How far one press of an arrow moves the diagram, in screen pixels. */
const PAN_STEP = 80
/** Movement under this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4
/** A frame in a note is never taller than this, nor than most of the window. */
const MAX_FRAME_HEIGHT = 640
const MAX_FRAME_SHARE = 0.7
/** How far the full-screen view enlarges a small diagram to fill the screen. */
const FULL_MAX_SCALE = 2

const root = ref<HTMLElement>()
const frame = ref<HTMLElement>()
const canvas = ref<HTMLElement>()
const error = ref<string | null>(null)
const fullOpen = ref(false)
const dragging = ref(false)
const svgEl = shallowRef<SVGSVGElement | null>(null)

let natural: Size = { width: 0, height: 0 }
let view: View = { scale: 1, x: 0, y: 0 }
/** Still showing the whole diagram: a resize refits it. Any zoom or drag ends that. */
let fitted = true
let visible = false
let generation = 0
let gone = false
let intersection: IntersectionObserver | null = null
let resize: ResizeObserver | null = null

const win = (): Window => root.value?.doc.win ?? window

const currentTheme = (): DiagramTheme =>
  root.value?.doc.body.classList.contains('theme-dark') ? 'dark' : 'light'

const apply = () => {
  canvas.value?.setCssStyles({
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
  })
}

const setView = (next: View) => {
  view = next
  apply()
}

/** The frame's size, after giving a frame in a note the height its diagram needs. */
const frameSize = (): Size => {
  const el = frame.value
  if (!el) return { width: 0, height: 0 }
  if (props.full) return { width: el.clientWidth, height: el.clientHeight }
  const width = root.value?.clientWidth ?? 0
  const cap = Math.min(MAX_FRAME_HEIGHT, Math.round(win().innerHeight * MAX_FRAME_SHARE))
  const height = frameHeight(width, natural, cap)
  el.setCssStyles({ height: `${height}px` })
  return { width, height }
}

const layout = () => {
  const size = frameSize()
  if (fitted) setView(fitView(size, natural, props.full ? FULL_MAX_SCALE : 1))
}

async function draw(): Promise<void> {
  const mine = ++generation
  const result = await renderDiagram(props.source, currentTheme())
  if (mine !== generation || gone) return
  if ('error' in result) {
    error.value = result.error
    svgEl.value = null
    return
  }
  error.value = null
  await nextTick()
  if (mine !== generation || gone || !canvas.value) return
  canvas.value.empty()
  svgEl.value = placeDiagram(canvas.value, result)
  natural = { width: result.width, height: result.height }
  layout()
  observeSize()
}

const observeSize = () => {
  if (resize || !root.value) return
  resize = new ResizeObserver(() => layout())
  resize.observe(props.full && frame.value ? frame.value : root.value)
}

const start = () => {
  if (visible) return
  visible = true
  intersection?.disconnect()
  intersection = null
  void draw()
}

onMounted(() => {
  // Room for the controls until the diagram says how much it needs.
  if (!props.full) frame.value?.setCssStyles({ height: `${MIN_FRAME_HEIGHT}px` })
  if (props.full) {
    start()
    return
  }
  const Observer = (win() as Window & { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver
  if (!Observer || !root.value) {
    start()
    return
  }
  // A screen ahead of time, so a diagram scrolled towards is drawn by the time it arrives.
  intersection = new Observer(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) start()
    },
    { rootMargin: '100% 0px' }
  )
  intersection.observe(root.value)
})

onUnmounted(() => {
  gone = true
  intersection?.disconnect()
  resize?.disconnect()
})

watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    if (visible) void draw()
  }
)

watch(
  () => props.source,
  () => {
    fitted = true
    if (visible) void draw()
  }
)

const centre = (): Point => {
  const size = { width: frame.value?.clientWidth ?? 0, height: frame.value?.clientHeight ?? 0 }
  return { x: size.width / 2, y: size.height / 2 }
}

const zoom = (factor: number) => {
  fitted = false
  setView(zoomAt(view, factor, centre()))
}

/** Moves the view the way an arrow points: `pan(0, 1)` shows more of what is above. */
const pan = (right: number, down: number) => {
  fitted = false
  setView(panBy(view, right * PAN_STEP, down * PAN_STEP))
}

const reset = () => {
  fitted = true
  layout()
}

const pointAt = (event: { clientX: number; clientY: number }): Point => {
  const box = frame.value?.getBoundingClientRect()
  return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
}

const onWheel = (event: WheelEvent) => {
  // Without a modifier the wheel belongs to the page. A trackpad pinch arrives as a wheel
  // with Ctrl held, so it zooms here too.
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const lines = event.deltaMode === 1 ? 16 : 1
  fitted = false
  setView(zoomAt(view, Math.exp(-event.deltaY * lines * 0.002), pointAt(event)))
}

const pointers = new Map<number, Point>()
let gestureStart = new Map<number, Point>()
let gestureView: View = view
let moved = 0
/** A drag just ended: the click that follows it is not a click on a link. */
let dragged = false

const beginGesture = () => {
  gestureStart = new Map(pointers)
  gestureView = view
}

const inControls = (event: Event) =>
  !!(event.target as Element | null)?.closest?.('.abele-mermaid__controls')

const onPointerDown = (event: PointerEvent) => {
  if (inControls(event)) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  frame.value?.setPointerCapture?.(event.pointerId)
  pointers.set(event.pointerId, pointAt(event))
  if (pointers.size === 1) moved = 0
  beginGesture()
}

const onPointerMove = (event: PointerEvent) => {
  if (!pointers.has(event.pointerId)) return
  const now = pointAt(event)
  pointers.set(event.pointerId, now)
  const [first, second] = [...pointers.keys()]
  if (second === undefined) {
    const from = gestureStart.get(first)
    if (!from) return
    moved = Math.max(moved, Math.hypot(now.x - from.x, now.y - from.y))
    if (moved < DRAG_THRESHOLD) return
    dragging.value = true
    fitted = false
    setView(panBy(gestureView, now.x - from.x, now.y - from.y))
    return
  }
  const [a, b] = [gestureStart.get(first), gestureStart.get(second)]
  const [c, d] = [pointers.get(first), pointers.get(second)]
  if (!a || !b || !c || !d) return
  const from: [Point, Point] = [a, b]
  const to: [Point, Point] = [c, d]
  moved = Math.max(moved, DRAG_THRESHOLD)
  fitted = false
  setView(pinch(gestureView, from, to))
}

const onPointerUp = (event: PointerEvent) => {
  if (!pointers.delete(event.pointerId)) return
  if (pointers.size === 0) {
    dragged = moved >= DRAG_THRESHOLD
    dragging.value = false
  }
  // One finger lifted out of two: the other carries on from where the view is now.
  beginGesture()
}

const onClick = (event: MouseEvent) => {
  if (dragged) {
    dragged = false
    event.preventDefault()
    event.stopPropagation()
    return
  }
  const link = (event.target as Element | null)?.closest?.('a.internal-link')
  if (!link) return
  event.preventDefault()
  event.stopPropagation()
  const target = link.getAttribute('href')
  if (target) {
    void GlobalStore.getInstance().app.workspace.openLinkText(
      target,
      props.sourcePath,
      Keymap.isModEvent(event)
    )
  }
}

const onKey = (event: KeyboardEvent) => {
  if (event.target !== frame.value) return
  const moves: Record<string, () => void> = {
    ArrowUp: () => pan(0, 1),
    ArrowDown: () => pan(0, -1),
    ArrowLeft: () => pan(1, 0),
    ArrowRight: () => pan(-1, 0),
    '+': () => zoom(ZOOM_STEP),
    '=': () => zoom(ZOOM_STEP),
    '-': () => zoom(1 / ZOOM_STEP),
    '0': reset,
  }
  const move = moves[event.key]
  if (!move || event.metaKey || event.ctrlKey || event.altKey) return
  event.preventDefault()
  event.stopPropagation()
  move()
}

const copyText = async (text: string, done: string) => {
  try {
    await win().navigator.clipboard.writeText(text)
    new Notice(done)
  } catch (reason) {
    console.debug('Abele: copying a diagram failed', reason)
    new Notice('Could not copy the diagram')
  }
}

const copySource = () => copyText(props.source, 'Diagram source copied')

const markup = (): string => {
  if (!svgEl.value || !root.value) return ''
  const font = win().getComputedStyle(root.value).getPropertyValue('--font-mermaid').trim()
  return svgMarkup(svgEl.value, font)
}

const copyPng = async () => {
  if (!root.value) return
  try {
    const background = win()
      .getComputedStyle(root.value)
      .getPropertyValue('--background-primary')
      .trim()
    const blob = await svgToPng(markup(), natural, background, win())
    await win().navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    new Notice('Diagram copied as a picture')
  } catch (reason) {
    console.debug('Abele: copying a diagram as PNG failed', reason)
    new Notice('Could not copy the diagram as a picture')
  }
}

const openCopyMenu = (event: MouseEvent) => {
  // Drawn by Obsidian in the page, as the plugin's other menus are, not the system's own.
  const menu = new Menu().setUseNativeMenu(false)
  menu.addItem((item) =>
    item
      .setTitle('Copy source')
      .setIcon('code-2')
      .onClick(() => void copySource())
  )
  if (svgEl.value) {
    menu.addItem((item) =>
      item
        .setTitle('Copy as picture')
        .setIcon('image')
        .onClick(() => void copyPng())
    )
    menu.addItem((item) =>
      item
        .setTitle('Copy as SVG')
        .setIcon('file-code')
        .onClick(() => void copyText(markup(), 'Diagram copied as SVG'))
    )
  }
  menu.showAtMouseEvent(event)
}

defineExpose({ openCopyMenu })
</script>

<style lang="scss">
.abele-mermaid {
  position: relative;
  margin: var(--size-4-2) 0;
}

.abele-mermaid_full {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
}

/**
 * The frame clips the diagram, which is what lets it be any size inside it: nothing past the
 * frame's edge reaches the note, so a wide diagram never makes the note scroll sideways.
 * `touch-action: none` hands a finger inside the frame to the diagram — the page still
 * scrolls from anywhere outside it.
 */
.abele-mermaid__frame {
  position: relative;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: grab;
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  outline: none;

  &:focus-visible {
    box-shadow: 0 0 0 var(--size-2-1) var(--background-modifier-border-focus);
  }
}

.abele-mermaid__frame_dragging {
  cursor: grabbing;
}

.abele-mermaid_full .abele-mermaid__frame {
  flex: 1 1 auto;
  min-height: 0;
}

.abele-mermaid__canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;

  svg {
    display: block;
    max-width: none;
  }
}

/**
 * The controls sit over the diagram's corners and show while the pointer is over the frame or
 * a control has focus. A phone has no hover, so there they are always shown.
 */
.abele-mermaid__controls {
  position: absolute;
  display: flex;
  gap: var(--size-2-1);
  padding: var(--size-2-1);
  background-color: var(--background-primary);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  cursor: default;
  opacity: 0;
  transition: opacity var(--anim-duration-fast) ease-in-out;
}

.abele-mermaid__frame:hover .abele-mermaid__controls,
.abele-mermaid__frame:focus-within .abele-mermaid__controls,
body.is-mobile .abele-mermaid__controls {
  opacity: 1;
}

.abele-mermaid__controls_top {
  top: var(--size-4-2);
  right: var(--size-4-2);
}

.abele-mermaid__pad {
  display: grid;
  grid-template-columns: repeat(3, auto);
  right: var(--size-4-2);
  bottom: var(--size-4-2);
}

.abele-mermaid__error {
  padding: var(--size-4-3);
  border: var(--border-width) solid var(--background-modifier-error);
  border-radius: var(--radius-m);
}

.abele-mermaid__error-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.abele-mermaid__error-title {
  color: var(--text-error);
  font-weight: var(--font-semibold);
}

.abele-mermaid__error-actions {
  display: flex;
  gap: var(--size-2-1);
}

.abele-mermaid__error-text {
  margin: var(--size-4-2) 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-monospace);
  font-size: var(--font-smaller);
  color: var(--text-muted);
}

/** Where Mermaid lays a diagram out before it is shown: in the page, out of sight. */
.abele-mermaid-scratch {
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
}
</style>
