<template>
  <div ref="root" class="abele-calendar-life" :data-current="current >= 0 ? current : undefined">
    <div class="abele-calendar-life__summary">
      <span class="abele-calendar-life__lived">
        <b>{{ number(summary.lived) }}</b> weeks lived
      </span>
      <span class="abele-calendar-life__left">
        <b>{{ number(summary.left) }}</b> left
      </span>
      <span class="abele-calendar-life__percent">
        {{ summary.percent }}% of {{ years }} years
      </span>
    </div>

    <div class="abele-calendar-life__legend" aria-hidden="true">
      <span><i class="abele-calendar-life__swatch abele-calendar-life__swatch_lived" />Lived</span>
      <span
        ><i class="abele-calendar-life__swatch abele-calendar-life__swatch_busy" />With notes</span
      >
      <span
        ><i class="abele-calendar-life__swatch abele-calendar-life__swatch_now" />This week</span
      >
      <span><i class="abele-calendar-life__swatch abele-calendar-life__swatch_ahead" />Ahead</span>
    </div>

    <canvas
      ref="canvas"
      class="abele-calendar-life__grid"
      tabindex="0"
      role="img"
      :aria-label="`Life in weeks: ${summary.lived} weeks lived, ${summary.left} left`"
      :data-grid="gridData"
      @click="onClick"
      @mousemove="onMove"
      @mouseleave="hovered = null"
      @keydown="onKey"
    />

    <div class="abele-calendar-life__hint">{{ hint }}</div>
    <span ref="probe" class="abele-calendar-life__probe" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
/**
 * A life in weeks, the way the poster draws it: a row for each year of age, fifty-two boxes
 * to a row, the lived ones filled, the ones ahead left open, this week marked, and every week
 * tinted by how many of the base's notes fall in it — the year's tint, one step coarser.
 *
 * Eighty years are over four thousand boxes, so they are painted on one canvas rather than
 * made into elements: one draw, one listener, whatever the width. The colours are the theme's,
 * read off a probe element and read again when the theme changes.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { heatLevel, type CalendarItem } from '@/bases/calendarLayout'
import {
  WEEKS_PER_ROW,
  lifeCounts,
  lifeGrid,
  lifeRows,
  lifeSummary,
  lifeWeekAt,
  lifeWeekOf,
  rowY,
  weekAtPoint,
  weekOrigin,
  type LifeGrid,
} from '@/bases/lifeWeeks'

const props = defineProps<{
  items: readonly CalendarItem[]
  today: string
  /** `YYYY-MM-DD`, already checked. */
  birth: string
  /** The years the life is expected to last. */
  years: number
  selected: number | null
}>()


const emit = defineEmits<{
  (e: 'week', index: number): void
}>()

const root = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const probe = ref<HTMLElement>()
const width = ref(0)
const hovered = ref<number | null>(null)

const rows = computed(() => lifeRows(props.birth, props.years, props.today))
const counts = computed(() => lifeCounts(props.items, props.birth, rows.value))
const max = computed(() => counts.value.reduce((a, b) => Math.max(a, b), 0))
const summary = computed(() => lifeSummary(props.birth, props.years, props.today))
/** This week, wherever it is — past the expected years too. */
const current = computed(() => lifeWeekOf(props.birth, props.today)?.index ?? -1)
const grid = computed<LifeGrid>(() => lifeGrid(width.value || 320, rows.value))

/** Where the boxes are, for whatever has to find one by position — the e2e tier does. */
const gridData = computed(() => {
  const { cell, gap, label, top, half, decade } = grid.value
  return JSON.stringify({ cell, gap, label, top, half, decade })
})

const number = (n: number) => n.toLocaleString()

const describe = (index: number): string => {
  const week = lifeWeekAt(props.birth, index)
  const from = dayjs(week.start)
  const to = dayjs(week.end)
  const days =
    from.year() === to.year()
      ? `${from.format('D MMM')} – ${to.format('D MMM YYYY')}`
      : `${from.format('D MMM YYYY')} – ${to.format('D MMM YYYY')}`
  const n = counts.value[index] ?? 0
  return `Age ${week.age}, week ${week.week + 1} · ${days} · ${n === 1 ? '1 note' : `${n} notes`}`
}

const hint = computed(() => {
  // The picked week is named under the grid already; this says what the pointer is over.
  const index = hovered.value
  return index === null ? 'Press a week to list what is in it.' : describe(index)
})

// ---- colours -------------------------------------------------------------------------------

interface Palette {
  accent: string
  onAccent: string
  now: string
  lived: string
  line: string
  text: string
  faint: string
  font: string
}

/** A theme variable as a colour the canvas understands, resolved through the probe. */
function readPalette(): Palette | null {
  const el = probe.value
  const view = el?.ownerDocument.defaultView
  if (!el || !view) return null
  const read = (name: string) => {
    el.style.setProperty('color', `var(${name})`)
    return view.getComputedStyle(el).color
  }
  return {
    accent: read('--interactive-accent'),
    onAccent: read('--text-on-accent'),
    now: read('--text-accent'),
    lived: read('--background-modifier-border-hover'),
    line: read('--background-modifier-border'),
    text: read('--text-normal'),
    faint: read('--text-faint'),
    font: view.getComputedStyle(el).fontFamily,
  }
}

let palette: Palette | null = null

// ---- drawing -------------------------------------------------------------------------------

/**
 * The accent at four strengths, laid over the lived grey: a week-sized box is smaller than a
 * day of the year, so the faintest step starts stronger than the year's or it reads as grey.
 */
const HEAT_ALPHA = [0, 0.4, 0.6, 0.8, 1]

function draw() {
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  palette ??= readPalette()
  const colors = palette
  if (!colors) return
  const g = grid.value
  const ratio = el.ownerDocument.defaultView?.devicePixelRatio ?? 1
  el.width = Math.round(g.width * ratio)
  el.height = Math.round(g.height * ratio)
  el.style.setProperty('width', `${g.width}px`)
  el.style.setProperty('height', `${g.height}px`)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, g.width, g.height)

  const small = Math.max(8, Math.min(11, g.cell))
  ctx.font = `${small}px ${colors.font}`
  ctx.fillStyle = colors.faint
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  for (let row = 0; row < g.rows; row += g.ageStep) {
    ctx.fillText(String(row), g.label - 4, rowY(g, row) + g.cell / 2)
  }
  if (g.top) {
    ctx.textAlign = 'center'
    for (const column of [0, 12, 25, 38, 51]) {
      const [x] = weekOrigin(g, column)
      ctx.fillText(String(column + 1), x + g.cell / 2, g.top / 2)
    }
  }

  const all = counts.value
  const busiest = max.value
  const now = current.value
  const total = g.rows * WEEKS_PER_ROW
  const radius = g.cell >= 8 ? 2 : 1
  const box = (x: number, y: number, size: number) => {
    ctx.beginPath()
    ctx.roundRect(x, y, size, size, radius)
  }
  ctx.textAlign = 'center'
  ctx.font = `${Math.round(g.cell * 0.55)}px ${colors.font}`
  for (let i = 0; i < total; i++) {
    const [x, y] = weekOrigin(g, i)
    const level = heatLevel(all[i], busiest)
    const past = now < 0 ? false : i < now
    if (level > 0) {
      box(x, y, g.cell)
      ctx.fillStyle = colors.lived
      ctx.fill()
      ctx.globalAlpha = HEAT_ALPHA[level]
      ctx.fillStyle = colors.accent
      ctx.fill()
      ctx.globalAlpha = 1
    } else if (past || i === now) {
      box(x, y, g.cell)
      ctx.fillStyle = colors.lived
      ctx.fill()
    } else {
      box(x + 0.5, y + 0.5, g.cell - 1)
      ctx.strokeStyle = colors.line
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (g.numbers && all[i] > 0) {
      ctx.fillStyle = level > 2 ? colors.onAccent : colors.text
      ctx.fillText(all[i] > 99 ? '99+' : String(all[i]), x + g.cell / 2, y + g.cell / 2 + 0.5)
    }
  }

  const ring = (index: number, color: string, lineWidth: number) => {
    if (index < 0 || index >= total) return
    const [x, y] = weekOrigin(g, index)
    const out = lineWidth / 2 + (g.gap > 1 ? 0.5 : 0)
    box(x - out, y - out, g.cell + 2 * out)
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
  ring(now, colors.now, g.cell >= 8 ? 2 : 1.5)
  if (props.selected !== null && props.selected !== now)
    ring(props.selected, colors.accent, g.cell >= 8 ? 2 : 1.5)
}

let frame = 0
const schedule = () => {
  const view = root.value?.ownerDocument.defaultView ?? window
  view.cancelAnimationFrame(frame)
  frame = view.requestAnimationFrame(() => draw())
}

watch([grid, counts, max, current, () => props.selected], schedule)
watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    palette = null
    schedule()
  }
)

// ---- pressing ------------------------------------------------------------------------------

const at = (event: MouseEvent): number | null => {
  const box = canvas.value?.getBoundingClientRect()
  if (!box) return null
  return weekAtPoint(grid.value, event.clientX - box.left, event.clientY - box.top)
}

const onClick = (event: MouseEvent) => {
  const index = at(event)
  if (index !== null) emit('week', index)
}

const onMove = (event: MouseEvent) => {
  hovered.value = at(event)
}

/** The arrows walk the weeks: a week sideways, a year up or down. */
const onKey = (event: KeyboardEvent) => {
  const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -WEEKS_PER_ROW, ArrowDown: WEEKS_PER_ROW }[
    event.key
  ]
  if (!by) return
  event.preventDefault()
  const from = props.selected ?? Math.max(0, current.value)
  const to = Math.min(rows.value * WEEKS_PER_ROW - 1, Math.max(0, from + by))
  emit('week', to)
}

// ---- how wide it is ------------------------------------------------------------------------

let observer: ResizeObserver | null = null

onMounted(() => {
  const el = root.value
  if (!el) return
  width.value = el.clientWidth
  observer = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? el.clientWidth
    if (w > 0 && Math.round(w) !== width.value) width.value = Math.round(w)
  })
  observer.observe(el)
  schedule()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  root.value?.ownerDocument.defaultView?.cancelAnimationFrame(frame)
})
</script>

<style lang="scss">
.abele-calendar-life {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}

.abele-calendar-life__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--size-2-2) var(--size-4-4);
  font-variant-numeric: tabular-nums;
}

.abele-calendar-life__percent {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.abele-calendar-life__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2) var(--size-4-3);
  font-size: var(--font-smallest);
  color: var(--text-muted);

  span {
    display: inline-flex;
    align-items: center;
    gap: var(--size-2-2);
  }
}

// The legend's boxes are drawn the way the canvas draws the weeks.
.abele-calendar-life__swatch {
  display: inline-block;
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: var(--radius-s);
}

.abele-calendar-life__swatch_lived {
  background-color: var(--background-modifier-border-hover);
}

.abele-calendar-life__swatch_busy {
  background-color: color-mix(in srgb, var(--interactive-accent) 65%, transparent);
}

.abele-calendar-life__swatch_now {
  background-color: var(--background-modifier-border-hover);
  box-shadow: 0 0 0 var(--size-2-1) var(--text-accent);
}

.abele-calendar-life__swatch_ahead {
  box-shadow: inset 0 0 0 1px var(--background-modifier-border);
}

.abele-calendar-life__grid {
  display: block;
  max-width: 100%;
  cursor: var(--cursor-link);
  border-radius: var(--radius-s);

  &:focus-visible {
    outline: var(--size-2-1) solid var(--interactive-accent);
    outline-offset: var(--size-2-2);
  }
}

.abele-calendar-life__hint {
  min-height: 1.5em;
  font-size: var(--font-smallest);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

// Only ever read from: what the theme's variables resolve to.
.abele-calendar-life__probe {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}
</style>
