<template>
  <div
    ref="root"
    class="abele-timeline-base"
    :class="{ 'abele-timeline-base_narrow': narrow, 'abele-timeline-base_stacked': stacked }"
  >
    <div class="abele-timeline-base__header">
      <Input
        v-model="query"
        class="abele-timeline-base__go"
        placeholder="Go to 1812, 490 BC or a name"
        @keydown.enter.prevent="go"
      />
      <Icon
        v-if="canCreate && narrow"
        class="abele-timeline-base__new-icon"
        icon="plus"
        with-bg
        tooltip="Make a note at the year in the middle of the screen"
        @click="createInMiddle"
      />
      <Tabs
        class="abele-timeline-base__levels"
        level="secondary"
        :tabs="levelTabs"
        :model-value="level"
        @update:model-value="(l) => setLevel(l as ZoomLevel)"
      />
      <Button
        v-if="canCreate && !narrow"
        class="abele-timeline-base__new"
        text="New note"
        icon="plus"
        tooltip="Make a note at the year in the middle of the screen"
        @click="createInMiddle"
      />
    </div>

    <div v-if="named.length || undated" class="abele-timeline-base__legend">
      <Badge
        v-for="lane in named"
        :key="lane.label"
        :text="lane.label"
        :color="lane.color ?? undefined"
      />
      <span v-if="undated" class="abele-timeline-base__undated">
        {{ undated === 1 ? '1 note has' : `${undated} notes have` }} no date it can read
      </span>
    </div>

    <div class="abele-timeline-base__body">
      <TimelineCanvas
        ref="board"
        :items="items"
        :lanes="lanes"
        :view="view"
        :limits="limits"
        :extent="extent"
        :selected="selected"
        :lang="lang"
        :narrow="narrow"
        :today="today"
        :can-create="canCreate"
        @update:view="(v) => (view = v)"
        @select="(item) => select(item, false)"
        @open="(item, event) => instance.open(item, event)"
        @hover="onHover"
        @create="(year) => instance.create(year)"
        @size="onSize"
      />
      <TimelinePanel
        v-if="selected"
        :selected="selected"
        :items="items"
        :lang="lang"
        @select="select"
        @open="(item, event) => instance.open(item, event)"
        @close="select(null)"
      />
    </div>

    <!-- On the window's body: a leaf clips what is inside it, a card near its edge included. -->
    <Teleport v-if="hover" :to="cardHost">
      <TimelineCard
        :item="hover.item"
        :x="hover.x"
        :y="hover.y"
        :t="hover.t"
        :selected="selected"
        :lang="lang"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * The history timeline of a base: the header — go to a year or a name, how far out, a new
 * note — the rows' colours, the drawing, and the list of contemporaries of whoever is picked.
 *
 * Where the view looks is not stored: it opens on everything the base holds, like the calendar
 * opens on today. Narrow is the view's own width, not the window's: a base in a sidebar is as
 * narrow as a phone.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useNow } from '@vueuse/core'
import Input from '../obsidian/Input.vue'
import Tabs, { type Tab } from '../obsidian/Tabs.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import Icon from '../obsidian/Icon.vue'
import TimelineCanvas from './TimelineCanvas.vue'
import TimelinePanel from './TimelinePanel.vue'
import TimelineCard from './TimelineCard.vue'
import type { TimelineBaseInstance } from '@/bases/TimelineView'
import { parseHistDate, todayPoint, humanYear } from '@/bases/historyDates'
import type { TimelineItem } from '@/bases/timelineLayout'
import {
  clampPpy,
  levelPpy,
  nearestLevel,
  roundToStep,
  xToT,
  zoomAt,
  zoomLimits,
  ZOOM_LEVELS,
  type Viewport,
  type ZoomLevel,
} from '@/bases/timelineScale'
import { DESKTOP, PHONE } from './timelineScene'

/** Below this width of the view the row names become chips and the list goes under. */
const NARROW = 560
/** Below this the list of contemporaries goes under the drawing rather than beside it. */
const STACKED = 900

const LEVEL_NAMES: Record<ZoomLevel, string> = {
  millennia: 'Millennia',
  centuries: 'Centuries',
  decades: 'Decades',
  years: 'Years',
  days: 'Days',
}

const props = defineProps<{ instance: TimelineBaseInstance }>()

const items = computed(() => props.instance.items.value)
const lanes = computed(() => props.instance.lanes.value)
const undated = computed(() => props.instance.undated.value)
const canCreate = computed(() => props.instance.canCreate.value)
const lang = computed(() => props.instance.lang.value)
const named = computed(() => lanes.value.filter((l) => l.label))

const now = useNow({ interval: 3_600_000 })
const today = computed(() => todayPoint(now.value))

/** The drawing's own width, and the whole view's: the narrow layout goes by the view's. */
const width = ref(0)
const root = ref<HTMLElement>()
const rootWidth = ref(0)
const narrow = computed(() => rootWidth.value > 0 && rootWidth.value < NARROW)
/** Too narrow for the list beside the drawing: it goes under it. */
const stacked = computed(() => rootWidth.value > 0 && rootWidth.value < STACKED)
const cardHost = computed(() => root.value?.ownerDocument.body ?? 'body')
const areaWidth = computed(() =>
  Math.max(1, width.value - (narrow.value ? PHONE.labelW : DESKTOP.labelW))
)

/** The stretch of everything in the base, for the first look and the overview. */
const extent = computed<[number, number]>(() => {
  let a = Infinity
  let b = -Infinity
  for (const item of items.value) {
    if (item.from < a) a = item.from
    if (item.to > b) b = item.to
  }
  if (!Number.isFinite(a)) return [today.value - 300, today.value + 10]
  const pad = Math.max(5, (b - a) * 0.04)
  return [a - pad, b + pad]
})

/** How finely the base's dates are known: the zoom goes no further than that. */
const finest = computed<'day' | 'month' | 'year'>(() => {
  let found: 'day' | 'month' | 'year' = 'year'
  for (const item of items.value)
    for (const d of [item.start, item.end]) {
      if (!d || d.now) continue
      if (d.precision === 'day') return 'day'
      if (d.precision === 'month') found = 'month'
    }
  return found
})

const limits = computed(() => zoomLimits(areaWidth.value, extent.value, finest.value))

const view = shallowRef<Viewport>({ t0: 1400, ppy: 1 })
let fitted = false

/** Room kept on the right as the view opens, for the labels beside the last bars. */
const LABEL_ROOM = 160

/** Everything in sight, as the view opens. */
function fit() {
  const [a, b] = extent.value
  const room = Math.max(areaWidth.value * 0.5, areaWidth.value - LABEL_ROOM)
  const ppy = clampPpy(room / (b - a), limits.value)
  view.value = { t0: a, ppy }
}

const onSize = (w: number) => {
  width.value = w
  // The drawing is measured before this view is: the narrow layout must be known for the fit.
  if (!rootWidth.value && root.value) rootWidth.value = root.value.clientWidth
  if (!fitted && w > 0 && items.value.length) {
    fitted = true
    fit()
  }
}

// The drawing narrowed or widened — the list opened beside it, the window resized: the year in
// the middle stays in the middle.
watch(areaWidth, (w, old) => {
  if (!fitted || !old || w === old) return
  view.value = { t0: view.value.t0 + (old - w) / 2 / view.value.ppy, ppy: view.value.ppy }
})

watch(items, (list) => {
  if (!fitted && width.value > 0 && list.length) {
    fitted = true
    fit()
  }
  // The pick follows its note through the base's updates.
  const id = selected.value?.id
  if (id) selected.value = list.find((i) => i.id === id) ?? null
})

let observer: ResizeObserver | null = null
onMounted(() => {
  const el = root.value
  if (!el) return
  rootWidth.value = el.clientWidth
  observer = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? el.clientWidth
    if (w > 0) rootWidth.value = Math.round(w)
  })
  observer.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())

// ---- how far out ------------------------------------------------------------------------

const levelTabs = computed<Tab[]>(() =>
  ZOOM_LEVELS.filter((l) => l !== 'days' || finest.value !== 'year').map((l) => ({
    id: l,
    label: LEVEL_NAMES[l],
    tooltip: `Zoom to ${LEVEL_NAMES[l].toLowerCase()}`,
  }))
)

const level = computed(() => nearestLevel(view.value.ppy, areaWidth.value))

const setLevel = (l: ZoomLevel) => {
  const ppy = clampPpy(levelPpy(l, areaWidth.value), limits.value)
  view.value = zoomAt(view.value, areaWidth.value / 2, ppy)
}

const centreOn = (t: number) => {
  view.value = { t0: t - areaWidth.value / 2 / view.value.ppy, ppy: view.value.ppy }
}

// ---- going somewhere --------------------------------------------------------------------

const query = ref('')

/** A year or a date takes the view there; anything else is a name, and picks that note. */
function go() {
  const text = query.value.trim()
  if (!text) return
  const date = parseHistDate(text, { approx: 5, now: today.value })
  if (date) {
    centreOn(date.at)
    return
  }
  const lower = text.toLowerCase()
  const list = items.value
  const found =
    list.find((i) => i.title.toLowerCase().startsWith(lower)) ??
    list.find((i) => i.title.toLowerCase().includes(lower))
  if (found) select(found)
}

// ---- the pick -------------------------------------------------------------------------------

const selected = shallowRef<TimelineItem | null>(null)

/**
 * Picks a note. Picked by name or from the list, the view goes to it and zooms so its span takes
 * about a third of the screen; pressed on the drawing, the view only moves when part of it is
 * off screen, so what was pressed does not jump away from under the finger.
 */
const select = (item: TimelineItem | null, reveal = true) => {
  selected.value = item
  hover.value = null
  if (!item) return
  const w = areaWidth.value
  const v = view.value
  const span = item.to - item.from
  if (reveal) {
    const ppy = span > 0 ? clampPpy((w * 0.35) / span, limits.value) : v.ppy
    view.value = { t0: (item.from + item.to) / 2 - w / 2 / ppy, ppy }
    return
  }
  const x0 = (item.from - v.t0) * v.ppy
  const x1 = (item.to - v.t0) * v.ppy
  if (x0 >= 0 && x1 <= w) return
  const fits = span * v.ppy < w * 0.8
  const t0 = fits ? (item.from + item.to) / 2 - w / 2 / v.ppy : item.from - (w * 0.1) / v.ppy
  view.value = { t0, ppy: v.ppy }
}

// ---- the card under the pointer --------------------------------------------------------------

const hover = shallowRef<{ item: TimelineItem; x: number; y: number; t: number } | null>(null)
const onHover = (
  at: { item: TimelineItem; x: number; y: number; t: number } | null,
  event?: MouseEvent
) => {
  const changed = at?.item !== hover.value?.item
  hover.value = at
  // Obsidian's own page preview, as over any link; it decides whether Mod is needed.
  if (at && changed && event?.target instanceof HTMLElement)
    props.instance.hover(at.item, event, event.target)
}

// ---- a new note ------------------------------------------------------------------------------

function createInMiddle() {
  const t = xToT(view.value, areaWidth.value / 2)
  const span = areaWidth.value / view.value.ppy
  const step = span > 600 ? 100 : span > 60 ? 10 : 1
  const year = roundToStep(t, step)
  props.instance.create(year === 0 ? humanYear(t) || 1 : year)
}
</script>

<style lang="scss">
.abele-timeline-base-host {
  height: 100%;
}

.abele-timeline-base {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  height: 100%;
  min-height: 420px;
  // On a phone Obsidian's floating bar stands over the view's foot; the overview stays above it.
  padding: var(--size-4-2) var(--size-4-4) max(var(--size-4-2), var(--view-bottom-spacing, 0px));
}

.abele-timeline-base__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2) var(--size-4-3);
}

.abele-timeline-base__go.abele-obsidian-input {
  flex: 0 1 16em;
  min-width: 10em;
}

.abele-timeline-base__levels {
  flex: 0 1 auto;
}

.abele-timeline-base__new {
  margin-inline-start: auto;
}

.abele-timeline-base__new-icon {
  flex: 0 0 auto;
}

.abele-timeline-base__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-3);
}

.abele-timeline-base__undated {
  font-size: var(--font-smallest);
  color: var(--text-muted);
}

.abele-timeline-base__body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  gap: var(--size-4-3);
  border-block-start: var(--border-width) solid var(--background-modifier-border);
}

// Stacked, the list of contemporaries goes under the drawing.
.abele-timeline-base_stacked .abele-timeline-base__body {
  flex-direction: column;
}

// Narrow, the go-to field takes its own line, the chips scroll sideways in one row and the
// list of contemporaries goes under the drawing.
.abele-timeline-base_narrow {
  padding-inline: var(--size-4-2);

  .abele-timeline-base__go.abele-obsidian-input {
    flex: 1 1 0;
  }

  // The steps in one row a finger scrolls, under the field.
  .abele-timeline-base__levels {
    flex: 1 1 100%;
    flex-wrap: nowrap;
    overflow-x: auto; // five steps do not fit a phone's width; they scroll rather than wrap
    scrollbar-width: none;
  }

  .abele-timeline-base__legend {
    flex-wrap: nowrap;
    overflow-x: auto; // one row of chips a finger scrolls, rather than three rows of them
    scrollbar-width: none;
  }

  .abele-timeline-base__body {
    flex-direction: column;
  }

  // On a phone the drawing keeps the larger share of the height under a pick.
  .abele-timeline-canvas {
    flex-grow: 3;
  }

  .abele-timeline-panel {
    flex-grow: 2;
  }
}
</style>
