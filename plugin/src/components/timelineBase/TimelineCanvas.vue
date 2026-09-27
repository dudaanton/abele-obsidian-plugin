<template>
  <div ref="root" class="abele-timeline-canvas">
    <canvas
      ref="canvas"
      class="abele-timeline-canvas__surface"
      tabindex="0"
      role="img"
      :aria-label="ariaLabel"
      :data-view="viewData"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
      @pointerleave="onLeave"
      @dblclick="onDouble"
      @auxclick="onAux"
      @contextmenu="onMenu"
      @wheel="onWheel"
      @keydown="onKey"
    />
    <span ref="probe" class="abele-timeline-canvas__probe" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
/**
 * The drawing of a history timeline: its size, the theme it paints with, the pictures it waits
 * for, and a frame whenever something moves. What a hand does to it is `timelineGestures`.
 *
 * The rows are laid out once per zoom bucket (`timelineScene`) and painted each frame
 * (`timelineDraw`), so a pinch redraws at full speed without bars jumping between lines.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import type { TimelineLane } from '@/bases/TimelineView'
import type { HistLang } from '@/bases/historyDates'
import type { TimelineItem } from '@/bases/timelineLayout'
import {
  bucketPpy,
  ticks as axisTicks,
  xToT,
  zoomBucket,
  type Viewport,
} from '@/bases/timelineScale'
import { formatYear } from '@/bases/historyDates'
import { DESKTOP, PHONE, buildScene, type Hit, type Scene } from './timelineScene'
import { paint } from './timelineDraw'
import { labelWidth, readPalette, type Palette } from './timelineText'
import { createGestures, type HoverAt } from './timelineGestures'
import { CoverCache } from './timelineCovers'

const props = defineProps<{
  items: readonly TimelineItem[]
  lanes: readonly TimelineLane[]
  view: Viewport
  limits: [number, number]
  extent: [number, number]
  selected: TimelineItem | null
  lang: HistLang
  narrow: boolean
  today: number
  canCreate: boolean
}>()

const emit = defineEmits<{
  (e: 'update:view', view: Viewport): void
  (e: 'select', item: TimelineItem | null): void
  (e: 'open', item: TimelineItem, event: MouseEvent | KeyboardEvent | null): void
  (e: 'hover', at: HoverAt | null, event?: MouseEvent): void
  (e: 'create', year: number): void
  (e: 'size', width: number): void
}>()

const root = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const probe = ref<HTMLElement>()
const width = ref(0)
const height = ref(0)
const scrollY = ref(0)
const cursorX = ref<number | null>(null)
const hovered = shallowRef<TimelineItem | null>(null)
const palette = shallowRef<Palette | null>(null)
/** Bumped when a picture arrives, so the frame is drawn again with it. */
const pictures = ref(0)

const metrics = computed(() => (props.narrow ? PHONE : DESKTOP))
const areaWidth = computed(() => Math.max(1, width.value - metrics.value.labelW))
const bucket = computed(() => zoomBucket(props.view.ppy))

let measureCtx: CanvasRenderingContext2D | null = null

const scene = computed<Scene | null>(() => {
  const p = palette.value
  if (!p || !measureCtx) return null
  const ctx = measureCtx
  const m = metrics.value
  const lang = props.lang
  return buildScene(
    props.items,
    props.lanes,
    {
      ppy: bucketPpy(bucket.value),
      gapPx: 8,
      pointPx: 10,
      minBarPx: 3,
      padPx: 6,
      labelPx: (item) => labelWidth(ctx, p, item, lang, true, m.barH),
    },
    m,
    props.selected
  )
})

const top = computed(() => {
  const m = metrics.value
  return m.axisH + (scene.value?.eraRows ?? 0) * m.eraH
})
const bottom = computed(() => height.value - metrics.value.minimapH)
const maxScroll = computed(() =>
  Math.max(0, (scene.value?.contentH ?? 0) - (bottom.value - top.value))
)

const ticks = computed(() => {
  const t0 = xToT(props.view, 0)
  const t1 = xToT(props.view, areaWidth.value)
  return axisTicks(t0, t1, props.view.ppy, props.lang, props.narrow ? 70 : 90)
})

/** Where the drawing stands, for whatever finds things on it by position — the e2e tier does. */
const viewData = computed(() =>
  JSON.stringify({
    t0: props.view.t0,
    ppy: props.view.ppy,
    labelW: metrics.value.labelW,
    top: top.value,
    scrollY: scrollY.value,
    lines: scene.value?.boxes.map((b) => b.pack.lines),
    overflow: scene.value?.boxes.map((b) => b.pack.overflow.length),
    focus: !!scene.value?.focus,
  })
)

const ariaLabel = computed(() => {
  const n = props.items.length
  const t0 = xToT(props.view, 0)
  const t1 = xToT(props.view, areaWidth.value)
  return `Timeline of ${n} notes, ${formatYear(t0, props.lang)} to ${formatYear(t1, props.lang)}`
})

// ---- pictures ------------------------------------------------------------------------------

const covers = new CoverCache(
  (url) => {
    const doc = canvas.value?.ownerDocument ?? activeDocument
    const img = doc.win.createEl('img')
    img.decoding = 'async'
    img.src = url
    return img
  },
  () => pictures.value++
)
const image = (url: string) => covers.get(url)

// The notes changed: the pictures of notes gone from the base go too.
watch(
  () => props.items,
  (items) => covers.keepOnly(new Set(items.flatMap((i) => (i.cover ? [i.cover] : []))))
)

// ---- drawing -------------------------------------------------------------------------------

let hits: Hit[] = []

function draw() {
  const el = canvas.value
  const ctx = el?.getContext('2d')
  const s = scene.value
  const p = palette.value
  if (!el || !ctx || !s || !p || width.value <= 0 || height.value <= 0) return
  const ratio = el.ownerDocument.defaultView?.devicePixelRatio ?? 1
  const w = Math.round(width.value * ratio)
  const h = Math.round(height.value * ratio)
  if (el.width !== w || el.height !== h) {
    el.width = w
    el.height = h
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  hits = paint(ctx, {
    scene: s,
    view: props.view,
    width: width.value,
    height: height.value,
    scrollY: Math.min(scrollY.value, maxScroll.value),
    palette: p,
    lang: props.lang,
    ticks: ticks.value,
    today: props.today,
    hovered: hovered.value,
    selected: props.selected,
    cursorX: cursorX.value,
    extent: props.extent,
    image,
    covers: true,
  })
  // Where things were drawn, for the e2e tier to press them by name.
  ;(el as HTMLCanvasElement & { abeleHits?: Hit[] }).abeleHits = hits
}

let frame = 0
const schedule = () => {
  const view = root.value?.ownerDocument.defaultView ?? window
  view.cancelAnimationFrame(frame)
  frame = view.requestAnimationFrame(() => draw())
}

watch(
  [
    scene,
    () => props.view,
    width,
    height,
    scrollY,
    cursorX,
    hovered,
    () => props.selected,
    pictures,
  ],
  schedule
)
watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    if (probe.value) palette.value = readPalette(probe.value)
  }
)
// A new pick starts its list at the top.
watch(
  () => props.selected,
  () => (scrollY.value = 0)
)

// ---- moving about --------------------------------------------------------------------------

const gestures = createGestures({
  canvas: () => canvas.value,
  view: () => props.view,
  limits: () => props.limits,
  extent: () => props.extent,
  labelW: () => metrics.value.labelW,
  areaWidth: () => areaWidth.value,
  width: () => width.value,
  height: () => height.value,
  bottom: () => bottom.value,
  scrollY: () => scrollY.value,
  maxScroll: () => maxScroll.value,
  scrollTo: (y) => (scrollY.value = Math.max(0, Math.min(maxScroll.value, y))),
  hits: () => hits,
  hovered: () => hovered.value,
  setHovered: (item) => (hovered.value = item),
  setCursor: (x) => (cursorX.value = x),
  selected: () => props.selected,
  canCreate: () => props.canCreate,
  step: () => ticks.value.step,
  lang: () => props.lang,
  emit: emit,
})
const { onDown, onMove, onUp, onCancel, onLeave, onDouble, onAux, onMenu, onWheel, onKey } =
  gestures

// ---- size ------------------------------------------------------------------------------

let observer: ResizeObserver | null = null

onMounted(() => {
  const el = root.value
  if (!el) return
  const doc = el.ownerDocument
  measureCtx = doc.win.createEl('canvas').getContext('2d')
  if (probe.value) palette.value = readPalette(probe.value)
  const size = (w: number, h: number) => {
    width.value = Math.round(w)
    height.value = Math.round(h)
    emit('size', width.value)
  }
  size(el.clientWidth, el.clientHeight)
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect
    if (box && (Math.round(box.width) !== width.value || Math.round(box.height) !== height.value))
      size(box.width, box.height)
  })
  observer.observe(el)
  schedule()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  gestures.dispose()
  covers.clear()
  root.value?.ownerDocument.defaultView?.cancelAnimationFrame(frame)
})

defineExpose({
  scrollTo: (y: number) => (scrollY.value = Math.max(0, Math.min(maxScroll.value, y))),
})
</script>

<style lang="scss">
.abele-timeline-canvas {
  position: relative;
  flex: 1 1 0;
  min-height: 12rem;
  min-width: 0;
}

.abele-timeline-canvas__surface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  // Every touch is the timeline's own: one finger moves it, two zoom it.
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }

  &:focus-visible {
    outline: var(--size-2-1) solid var(--interactive-accent);
    outline-offset: calc(-1 * var(--size-2-1));
  }
}

// Only ever read from: what the theme's variables resolve to.
.abele-timeline-canvas__probe {
  position: absolute;
  font-weight: var(--font-semibold);
  visibility: hidden;
  pointer-events: none;
}
</style>
