<template>
  <!-- The canvas's controls laid out as Obsidian Canvas lays out its own, in its own classes: the
       tools at the foot in the middle, zoom and history in a column at the top right, and the
       actions for what is picked in a small bar standing over it. -->
  <!-- The frames' names stand on the canvas itself, so a press on one reaches its pointer. -->
  <Teleport :to="viewer.stage">
    <CanvasFrames :editor="editor" :viewer="viewer" :tick="tick" />
  </Teleport>
  <div
    class="abele-canvas-chrome"
    :class="{ 'is-phone-layout': phone }"
    :style="{ '--abele-canvas-bar': `${barHeight}px`, '--abele-canvas-find': `${findHeight}px` }"
    @pointerdown.stop
    @touchstart.stop
    @touchmove.stop
    @touchend.stop
    @touchcancel.stop
  >
    <!-- Touches on the controls stop here: the canvas under them cancels every touch so the page
         does not scroll under a pen, and a cancelled touch never becomes a tap on a button. -->
    <div v-if="saveState" class="canvas-controls abele-canvas-chrome__state">
      <div class="canvas-control-group">
        <div
          ref="stateEl"
          class="canvas-control-item abele-canvas-chrome__save"
          :class="`is-${saveState}`"
          :aria-label="saveState === 'saving' ? 'Saving' : 'Not saved: open for what to do'"
          @click="menus.saveMenu($event, c)"
        >
          <span class="abele-canvas-chrome__save-dot" />
        </div>
      </div>
    </div>

    <div class="canvas-controls abele-canvas-chrome__view">
      <div class="canvas-control-group abele-canvas-chrome__zoom">
        <ControlItem icon="plus" tooltip="Zoom in" @click="zoom(1.25)" />
        <ControlItem icon="rotate-ccw" :tooltip="`Reset zoom (${percent}%)`" @click="zoomTo(1)" />
        <ControlItem icon="maximize" tooltip="Zoom to fit" @click="viewer.fit()" />
        <ControlItem icon="minus" tooltip="Zoom out" @click="zoom(0.8)" />
      </div>
      <div class="canvas-control-group">
        <ControlItem
          icon="undo-2"
          tooltip="Undo"
          :disabled="state('Undo canvas change').disabled"
          @click="press('Undo canvas change')"
        />
        <ControlItem
          icon="redo-2"
          tooltip="Redo"
          :disabled="state('Redo canvas change').disabled"
          @click="press('Redo canvas change')"
        />
      </div>
      <!-- The walkthrough, only when the canvas has one: a glyph to start it, and while it runs
           the steps back and forth, the step it is at in their tooltips, and a way out. -->
      <div v-if="steps" class="canvas-control-group">
        <ControlItem
          v-if="viewer.step === null || viewer.step === undefined"
          key="start"
          icon="presentation"
          :tooltip="`Go through the canvas step by step (${steps} steps)`"
          @click="step(1)"
        />
        <template v-else>
          <ControlItem
            :key="`back-${viewer.step}`"
            icon="chevron-left"
            :tooltip="`Previous step (now ${viewer.step} of ${steps})`"
            :disabled="viewer.step <= 1"
            @click="step(-1)"
          />
          <ControlItem
            :key="`next-${viewer.step}`"
            icon="chevron-right"
            :tooltip="`Next step (now ${viewer.step} of ${steps})`"
            :disabled="viewer.step >= steps"
            @click="step(1)"
          />
          <ControlItem
            key="all"
            icon="x"
            tooltip="Leave the steps and show all"
            @click="allSteps"
          />
        </template>
      </div>
    </div>

    <!-- Over a picked thing, its actions; above it, or under it where the top has no room. -->
    <div
      v-if="picked.rect && !editing && !drawing && !placing && !gesturing && !naming && !labelling"
      ref="barEl"
      class="canvas-menu abele-canvas-chrome__picked"
      :style="pickedAt"
      role="toolbar"
      aria-label="Selection"
    >
      <button
        class="clickable-icon abele-canvas-chrome__swatch-button"
        aria-label="Colour"
        @click="menus.colourMenu($event, c, view)"
      >
        <span class="canvas-color-picker-item" :class="colourClass(currentColour)" />
      </button>
      <ChromeIcon
        v-if="one && (kind === 'text' || kind === 'shape')"
        :icon="SHAPE_ICONS[currentShape] ?? 'square'"
        tooltip="Shape"
        @click="menus.shapeMenu($event, c, view)"
      />
      <ChromeIcon
        v-if="one && (kind === 'text' || kind === 'shape')"
        icon="pencil"
        tooltip="Edit text"
        :disabled="state('Edit card text').disabled"
        @click="press('Edit card text')"
      />
      <ChromeIcon
        v-if="one && kind === 'file' && /\.md$/i.test(pickedNode?.file ?? '')"
        icon="list-tree"
        :tooltip="
          pickedNode?.subpath
            ? `Shows ${pickedNode.subpath.slice(1)}: show another part`
            : 'Show one part of the note'
        "
        @click="menus.partMenu($event, c, view)"
      />
      <ChromeIcon
        v-if="one && (kind === 'file' || kind === 'link')"
        icon="arrow-up-right"
        tooltip="Open"
        @click="press('Open selected card')"
      />
      <template v-if="one && (kind === 'connection' || kind === 'line')">
        <ChromeIcon
          v-if="kind === 'connection'"
          :icon="ROUTE_ICONS[value('routing')] ?? 'spline'"
          tooltip="Line: straight, elbow or curved"
          @click="menus.routeMenu($event, c)"
        />
        <ChromeIcon icon="move-right" tooltip="Arrow ends" @click="menus.endsMenu($event, c)" />
        <ChromeIcon
          icon="arrow-right-left"
          tooltip="Reverse the arrows"
          @click="press('Reverse connection arrows')"
        />
      </template>
      <!-- Strokes held by a card can be let go of; free ones, taken by the card picked with them
           or the one under them. A mixed pick offers both. -->
      <ChromeIcon
        v-if="attachedInk"
        icon="unlink"
        tooltip="Detach from its card"
        @click="press('Detach selected ink')"
      />
      <ChromeIcon
        v-if="freeInk"
        icon="link"
        tooltip="Attach to the card under it"
        :disabled="state('Attach selected ink').disabled"
        @click="press('Attach selected ink')"
      />
      <ChromeIcon
        v-if="!one || (kind !== 'group' && kind !== 'connection' && kind !== 'line')"
        icon="frame"
        tooltip="Frame these"
        :disabled="groupLabel === null"
        @click="groupLabel && press(groupLabel)"
      />
      <template v-if="one && kind === 'group'">
        <ChromeIcon icon="pencil" tooltip="Rename" @click="c.name(picked.ids[0])" />
        <ChromeIcon
          :icon="pickedNode?.collapsed ? 'chevrons-up-down' : 'chevrons-down-up'"
          :tooltip="
            pickedNode?.collapsed ? 'Unfold: show what is inside' : 'Fold: hide what is inside'
          "
          @click="c.foldFrame(picked.ids[0], !pickedNode?.collapsed)"
        />
        <ChromeIcon
          icon="ungroup"
          tooltip="Remove the frame, keep what is inside"
          @click="press('Ungroup selected group')"
        />
      </template>
      <!-- A pinned card says so where it is picked, and lets go of its pin from here. -->
      <ChromeIcon
        v-if="one && pickedNode?.abele?.pinned === true"
        icon="pin"
        tooltip="Pinned in place: press to let it move"
        :active="true"
        @click="c.setPinned(picked.ids[0], false)"
      />
      <!-- Where there is no Shift to hold: each press on a card then adds it or takes it away. -->
      <ChromeIcon
        icon="list-checks"
        tooltip="Pick several"
        :active="state('Toggle multiple selection').on"
        @click="press('Toggle multiple selection')"
      />
      <ChromeIcon
        icon="more-horizontal"
        tooltip="More"
        @click="menus.moreMenu($event, c, view, host)"
      />
    </div>

    <CanvasFind
      v-if="finding"
      :editor="editor"
      :viewer="viewer"
      :tick="tick"
      @height="findHeight = $event"
    />

    <!-- A connection's label written on the line itself, as Obsidian Canvas writes it. -->
    <div v-if="labelling && labelAt" class="canvas-path-label-wrapper" :style="labelAt.style">
      <div
        ref="labelEl"
        class="canvas-path-label is-editing abele-canvas-chrome__label"
        contenteditable="true"
        role="textbox"
        aria-label="Connection label"
        @pointerdown.stop
        @keydown="labelKey"
        @blur="labelDone"
      >
        {{ labelAt.text }}
      </div>
    </div>

    <!-- The tools, the kit's tool bar across the tab's top as over a drawing: one slot for each
         family, wearing the glyph of the member last used; with a pen in hand, its colours and
         width in the same row. -->
    <ToolBar ref="toolsBar" class="abele-canvas-chrome__tools" label="Canvas tools">
      <ToolBarGroup v-for="(group, g) in shownGroups" :key="g">
        <ChromeIcon
          v-for="slot in group"
          :key="slot.id"
          :icon="slotIcon(slot)"
          :tooltip="slotTooltip(slot)"
          :active="slotActive(slot)"
          class="abele-canvas-chrome__tool"
          @click="useSlot(slot, $event)"
        />
      </ToolBarGroup>
      <ToolBarGroup v-if="hidden.length">
        <ChromeIcon
          :icon="hiddenActive ? slotIcon(hiddenActive) : 'more-horizontal'"
          tooltip="More tools"
          :active="!!hiddenActive"
          class="abele-canvas-chrome__tool"
          @click="moreTools($event)"
        />
      </ToolBarGroup>
      <template v-if="penStrip">
        <!-- With a Pencil about and another tool in hand, which of pen and marker the Pencil
             draws with: pressed, it takes the other. -->
        <ToolBarGroup v-if="!drawing && !phone" label="Pencil">
          <ChromeIcon
            :key="pencilInk"
            :icon="pencilInk === 'marker' ? 'highlighter' : 'pen-line'"
            :tooltip="
              pencilInk === 'marker'
                ? 'The Pencil draws with the marker; press for the pen'
                : 'The Pencil draws with the pen; press for the marker'
            "
            @click="c.setPencilInk(pencilInk === 'marker' ? 'pen' : 'marker')"
          />
        </ToolBarGroup>
        <ToolBarGroup class="abele-canvas-chrome__pen" label="Colours">
          <ChromeIcon
            v-for="col in COLOURS"
            :key="col"
            icon="circle"
            :color="SWATCH_COLOURS[col]"
            :active="value('ink-color') === col"
            :tooltip="`Draw in ${COLOUR_NAMES[col]}`"
            class="abele-canvas-chrome__swatch"
            :class="{ 'abele-canvas-chrome__swatch_ink': !col }"
            @click="set('ink-color', col)"
          />
          <ChromeIcon
            icon="line-squiggle"
            :tooltip="`Width: ${value('ink-size') || THICKNESSES[1]}`"
            class="abele-canvas-chrome__width"
            @click="widthMenu($event)"
          />
        </ToolBarGroup>
      </template>
    </ToolBar>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { Menu, Platform, setIcon, setTooltip } from 'obsidian'
import type { CanvasEditor, CanvasField } from '@/canvas/Editor'
import type { CanvasViewer } from '@/canvas/Viewer'
import { stepsOf } from '@/canvas/core/steps'
import { allInkEntries } from '@/canvas/core/ink'
import { linesOf } from '@/canvas/core/primitives'
import { centredLabel, contentBox, labelPoint, paintedRoute } from '@/canvas/core/scene'
import { zoomAt } from '@/drawing/camera'
import ChromeIcon from '../obsidian/Icon.vue'
import ToolBar from '../obsidian/ToolBar.vue'
import ToolBarGroup from '../obsidian/ToolBarGroup.vue'
import CanvasFrames from './CanvasFrames.vue'
import CanvasFind from './CanvasFind.vue'
import {
  COLOURS,
  COLOUR_NAMES,
  PHONE_ORDER,
  ROUTE_ICONS,
  SHAPE_ICONS,
  SLOTS,
  SWATCH_COLOURS,
  THICKNESSES,
  type Slot,
} from './chromeTools'
import * as menus from './chromeMenus'
import type { CanvasHostActions } from '@/canvas/pickedActions'

const props = defineProps<{
  editor: CanvasEditor
  viewer: CanvasViewer
  /** What the more menus do outside the canvas: pictures, embeds, the chat, notes. */
  host?: CanvasHostActions
}>()
const c = props.editor.controls

/** One of Obsidian Canvas's own control items: a glyph in its column, named by its tooltip. */
const ControlItem = defineComponent({
  props: { icon: String, tooltip: String, disabled: Boolean },
  emits: ['click'],
  setup(p, { emit }) {
    const el = ref<HTMLElement>()
    onMounted(() => {
      if (!el.value) return
      setIcon(el.value, p.icon)
      setTooltip(el.value, p.tooltip, { placement: 'left' })
    })
    return () =>
      h('div', {
        ref: el,
        class: ['canvas-control-item', { 'is-disabled': p.disabled }],
        role: 'button',
        'aria-label': p.tooltip,
        'aria-disabled': p.disabled || undefined,
        onClick: (e: MouseEvent) => !p.disabled && emit('click', e),
      })
  },
})
/** A tool at the foot, as Obsidian Canvas draws its card menu's buttons. */
const tick = ref(0)
const phone = Platform.isPhone
const last = ref<Record<string, number>>({})
const stateEl = ref<HTMLElement>()

const tool = computed(() => (tick.value, c.tool()))
const picked = computed(() => (tick.value, c.picked()))
const kinds = computed(() => picked.value.kinds)
const one = computed(() => kinds.value.length === 1)
const kind = computed(() => kinds.value[0])
const editing = computed(() => (tick.value, c.editing()))
const gesturing = computed(() => (tick.value, c.gesturing()))
const naming = computed(() => (tick.value, c.naming()))
const labelling = computed(() => (tick.value, c.labelling()))
const finding = computed(() => (tick.value, c.finding()))
const findHeight = ref(0)
const placing = computed(() => ['frame', 'card', 'shape'].includes(tool.value))
const labelEl = ref<HTMLElement>()
/** Where the label being written stands: in the middle of its line, on the screen. */
const labelAt = computed(() => {
  tick.value
  const id = labelling.value
  if (!id) return null
  const edge = graph().edges.find((e) => e.id === id)
  const line = edge ? undefined : linesOf(graph()).find((l) => l.id === id)
  if (!edge && !line) return null
  const mid = edge
    ? labelPoint(paintedRoute(edge, graph()))
    : { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 }
  const cam = props.viewer.camera
  return {
    text: (edge ?? line).label ?? '',
    style: {
      left: `${(mid.x - cam.x) * cam.zoom}px`,
      top: `${(mid.y - cam.y) * cam.zoom}px`,
      '--zoom-multiplier': String(Math.max(0.6, Math.min(cam.zoom, 2))),
      '--canvas-color': 'var(--interactive-accent)',
    },
  }
})
let labelOpened = ''
watch(labelling, async (id) => {
  if (!id || id === labelOpened) return
  labelOpened = id
  await nextTick()
  const el = labelEl.value
  if (!el) return
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = document.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
})
function labelDone(e: FocusEvent) {
  const id = c.labelling()
  labelOpened = ''
  if (!id) return
  void c.saveLabel(id, (e.target as HTMLElement).innerText.replace(/\s+/g, ' '))
}
function labelKey(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.isComposing) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    ;(e.target as HTMLElement).blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    labelOpened = ''
    c.editLabel(null)
    props.viewer.el.focus({ preventScroll: true })
  }
}
const barEl = ref<HTMLElement>()
const drawing = computed(() => ['pen', 'marker', 'eraser', 'partial-eraser'].includes(tool.value))
/** Once a Pencil has touched the canvas it draws whatever is in hand, so its colours stay out. */
const pencil = computed(() => (tick.value, c.pencil()))
const pencilInk = computed(() => (tick.value, c.pencilInk()))
/** The tools' row: the column of zoom and undo stands under it, however tall it wraps. */
const toolsBar = ref<{ $el: HTMLElement }>()
const barHeight = ref(0)
let barSize: ResizeObserver | undefined
onMounted(() => {
  const el = toolsBar.value?.$el
  if (!el || typeof ResizeObserver === 'undefined') return
  barSize = new ResizeObserver(() => {
    barHeight.value = el.offsetHeight
    // Fitting and revealing keep what they show clear of the row of tools.
    props.viewer.insetTop = el.offsetHeight
  })
  barSize.observe(el)
})
onBeforeUnmount(() => {
  barSize?.disconnect()
  props.viewer.insetTop = 0
})
/** The pen's width, from its row's glyph: Obsidian's menu under the button. */
function widthMenu(e: MouseEvent) {
  const menu = new Menu()
  for (const t of THICKNESSES)
    menu.addItem((item) =>
      item
        .setTitle(t[0].toUpperCase() + t.slice(1))
        .setChecked((value('ink-size') || THICKNESSES[1]) === t)
        .onClick(() => set('ink-size', t))
    )
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menu.showAtPosition({ x: r.left, y: r.bottom })
}
const penStrip = computed(
  () =>
    !['eraser', 'partial-eraser', 'lasso'].includes(tool.value) &&
    (drawing.value || (pencil.value && !editing.value && !naming.value))
)
const steps = computed(() => (tick.value, stepsOf(props.viewer.graph).length))
const percent = computed(() => (tick.value, Math.round(props.viewer.camera.zoom * 100)))
const state = (label: string) => (tick.value, c.state(label))
const value = (field: CanvasField) => (tick.value, c.value(field))
const press = (label: string) => c.press(label)
const set = (field: CanvasField, v: string) => c.set(field, v)
const graph = () => props.viewer.graph

const groupLabel = computed(() => {
  tick.value
  if (!state('Group selected cards').disabled) return 'Group selected cards'
  if (!state('Group canvas selection').disabled) return 'Group canvas selection'
  return null
})
const attachedInk = computed(
  () => (
    tick.value,
    allInkEntries(graph()).some((e) => e.node && picked.value.ids.includes(e.stroke.id))
  )
)
const freeInk = computed(
  () => (
    tick.value,
    allInkEntries(graph()).some((e) => !e.node && picked.value.ids.includes(e.stroke.id))
  )
)
const pickedNode = computed(() => graph().nodes.find((n) => n.id === picked.value.ids[0]))
const currentShape = computed(
  () => (pickedNode.value?.styleAttributes?.shape as string | undefined) ?? 'rectangle'
)
const currentColour = computed(() => {
  const node = pickedNode.value
  if (node) return node.color ?? ''
  const edge = graph().edges.find((e) => e.id === picked.value.ids[0])
  return edge?.color ?? ''
})
/** What is picked, as the menus over it read it. */
const view = computed<menus.PickedView>(() => ({
  ids: picked.value.ids,
  kinds: kinds.value,
  one: one.value,
  kind: kind.value,
  node: pickedNode.value,
  shape: currentShape.value,
  colour: currentColour.value,
  rect: picked.value.rect,
}))
const colourClass = (v: string) => (v ? `mod-canvas-color-${v}` : 'abele-canvas-chrome__ink')

/** The bar stands over the picked thing, on the screen, kept inside the stage. */
const pickedAt = computed(() => {
  tick.value
  const r = picked.value.anchor
  if (!r) return {}
  const cam = props.viewer.camera
  const left = (r.x + r.width / 2 - cam.x) * cam.zoom
  const top = (r.y - cam.y) * cam.zoom
  const bottom = (r.y + r.height - cam.y) * cam.zoom
  // A frame's name stands over its top edge: the bar goes over the name, not onto it.
  const name =
    one.value && kind.value === 'group'
      ? props.viewer.stage.querySelector<HTMLElement>(`[data-frame-id="${picked.value.ids[0]}"]`)
      : null
  const nameTop = name
    ? name.getBoundingClientRect().top - props.viewer.stage.getBoundingClientRect().top
    : top
  const over = Math.min(top, nameTop)
  // Kept clear of the stage's sides, of the tools' row across the top and of the control column
  // at the top right.
  const width = barEl.value?.offsetWidth ?? 0,
    height = barEl.value?.offsetHeight ?? 40,
    half = width / 2,
    column = props.viewer.el.querySelector<HTMLElement>('.abele-canvas-chrome__view'),
    right = props.viewer.stage.clientWidth - (column ? column.offsetWidth + 24 : 8),
    ceiling = barHeight.value + findHeight.value + 8
  const x = Math.max(8 + half, Math.min(left, right - half))
  // A connection's bar never covers its two ends, which are pulled to reconnect it: above its
  // middle, else under it, else beside it.
  const ends = connectionEnds()
  const covers = (bx: number, by: number) =>
    ends.some(
      (p) => p.x > bx - half - 14 && p.x < bx + half + 14 && p.y > by - 14 && p.y < by + height + 14
    )
  const aboveTop = over - 12 - height,
    belowTop = bottom + 12
  if (ends.length) {
    if (aboveTop > ceiling && !covers(x, aboveTop))
      return { left: `${x}px`, top: `${aboveTop}px`, transform: 'translate(-50%, 0)' }
    if (!covers(x, belowTop))
      return { left: `${x}px`, top: `${belowTop}px`, transform: 'translate(-50%, 0)' }
    const midY = (top + bottom) / 2
    return {
      left: `${Math.min(left + 24, right - width)}px`,
      top: `${Math.max(ceiling, midY - height / 2)}px`,
      transform: 'none',
    }
  }
  const above = aboveTop > ceiling
  return {
    left: `${x}px`,
    top: `${above ? aboveTop : belowTop}px`,
    transform: 'translate(-50%, 0)',
  }
})
/** The two ends of the one picked connection or line, on the screen. */
function connectionEnds(): { x: number; y: number }[] {
  if (!one.value || (kind.value !== 'connection' && kind.value !== 'line')) return []
  const id = picked.value.ids[0],
    g = graph(),
    cam = props.viewer.camera
  const edge = g.edges.find((e) => e.id === id)
  const line = edge ? undefined : linesOf(g).find((l) => l.id === id)
  const points = edge ? paintedRoute(edge, g).points : line ? [line.from, line.to] : []
  if (!points.length) return []
  return [points[0], points[points.length - 1]].map((p) => ({
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  }))
}

const saveState = computed(() => {
  tick.value
  // Words being written on a card are not unsaved work yet: they are saved when the card is left.
  if (c.editing()) return null
  if (!state('Retry save').hidden || !state('Discard local draft').hidden) return 'unsaved'
  return null
})

const slots = SLOTS.flat()
const shownGroups = computed(() =>
  phone ? [PHONE_ORDER.map((id) => slots.find((s) => s.id === id))] : SLOTS
)
const hidden = computed(() => (phone ? slots.filter((s) => !PHONE_ORDER.includes(s.id)) : []))
const hiddenActive = computed(() => hidden.value.find((s) => slotActive(s)))

const member = (slot: Slot) => slot.members[last.value[slot.id] ?? 0]
/** The shape slot wears the shape the Shape tool puts down, however it was chosen. */
const slotIcon = (slot: Slot) => {
  if (slot.id === 'shape' && tool.value === 'shape')
    return SHAPE_ICONS[value('shape')] ?? member(slot).icon
  const m = slot.members.find((x) => x.id === tool.value) ?? member(slot)
  return m.icon
}
const slotTooltip = (slot: Slot) =>
  slot.id === 'shape' && tool.value === 'shape'
    ? `Shape: ${(value('shape') || 'rectangle').replace(/-/g, ' ')} (R, again for the next)`
    : member(slot).tooltip
const slotActive = (slot: Slot) =>
  slot.id === 'shape' ? tool.value === 'shape' : slot.members.some((m) => m.id === tool.value)

/** A family's slot takes its last member; pressed again, it offers the others at the button. */
function useSlot(slot: Slot, e: MouseEvent) {
  // Pressed while its tool is already in hand, a family offers its other members at the button.
  const again = slotActive(slot) && slot.members.length > 1
  if (again) return familyMenu(slot, e)
  run(slot, member(slot))
}
function run(slot: Slot, m: Slot['members'][number]) {
  last.value = { ...last.value, [slot.id]: slot.members.indexOf(m) }
  // Card and Shape are tools: the card or shape goes where the canvas is then clicked or dragged.
  if (slot.id === 'shape') {
    set('shape', m.id)
    return c.useTool('shape')
  }
  if (slot.id === 'card') return c.useTool('card')
  press(m.label)
}
function familyMenu(slot: Slot, e: MouseEvent) {
  const menu = new Menu()
  for (const m of slot.members)
    menu.addItem((item) =>
      item
        .setTitle(m.tooltip.replace(/ \(.*\)$/, ''))
        .setIcon(m.icon)
        .setChecked(m === member(slot))
        .onClick(() => run(slot, m))
    )
  menus.showAt(menu, e)
}
function moreTools(e: MouseEvent) {
  const menu = new Menu()
  // Every member of each family left out of the row, so a line or an arrow is in reach too.
  hidden.value.forEach((slot, i) => {
    if (i) menu.addSeparator()
    for (const m of slot.members)
      menu.addItem((item) =>
        item
          .setTitle(m.tooltip.replace(/ \(.*\)$/, ''))
          .setIcon(m.icon)
          .setChecked(m.id === tool.value)
          .onClick(() => run(slot, m))
      )
  })
  menus.showAt(menu, e)
}
function zoom(factor: number) {
  const s = props.viewer.stage
  props.viewer.setCamera(zoomAt(props.viewer.camera, s.clientWidth / 2, s.clientHeight / 2, factor))
  tick.value++
}
function zoomTo(z: number) {
  zoom(z / props.viewer.camera.zoom)
}
function allSteps() {
  props.viewer.go(null)
  tick.value++
}
function step(delta: number) {
  const n = (props.viewer.step ?? 0) + delta
  props.viewer.go(n < 1 ? null : Math.min(n, steps.value))
  tick.value++
}

/** The card being written in: the editor's own field, laid over the card on the canvas. */
/** The card whose own words hide while they are written over it, so they do not show twice. */
let hiddenCard: HTMLElement | null = null
function markWritten() {
  const id = c.editing()
  // The card is drawn afresh as its words change, so it is looked up again each frame.
  const card = id ? props.viewer.stage.querySelector<HTMLElement>(`[data-card-id="${id}"]`) : null
  if (card === hiddenCard && (!card || card.classList.contains('is-being-written'))) return
  hiddenCard?.classList.remove('is-being-written')
  card?.classList.add('is-being-written')
  hiddenCard = card
}
const placeField = () => {
  const id = c.editing()
  const text = c.textField(),
    field = text.parentElement
  if (!field) return
  const node = id ? graph().nodes.find((n) => n.id === id) : undefined
  markWritten()
  if (!node) return field.style.removeProperty('left')
  const cam = props.viewer.camera,
    stage = props.viewer.stage
  // A shape's words are written where they stand, in the middle of the shape, which stays in
  // sight; a card's fill the card.
  const shaped = centredLabel(node),
    box = shaped ? contentBox(node) : node
  field.classList.toggle('is-shape', shaped)
  Object.assign(field.style, {
    left: `${stage.offsetLeft + (box.x - cam.x) * cam.zoom}px`,
    top: `${stage.offsetTop + (box.y - cam.y) * cam.zoom}px`,
    width: `${box.width * cam.zoom}px`,
    height: `${box.height * cam.zoom}px`,
    fontSize: `calc(var(--font-text-size) * ${cam.zoom})`,
  })
  if (shaped) {
    text.style.setProperty('padding-top', '0px')
    const room = box.height * cam.zoom
    text.style.setProperty('padding-top', `${Math.max(0, (room - text.scrollHeight) / 2)}px`)
  } else text.style.removeProperty('padding-top')
}
let frame = 0
let seen = ''
const watchCamera = () => {
  const cam = props.viewer.camera,
    key = `${cam.x}|${cam.y}|${cam.zoom}|${props.viewer.step}`
  if (key !== seen) {
    seen = key
    tick.value++
    placeField()
  }
  markWritten()
  frame = window.requestAnimationFrame(watchCamera)
}
let dropShown: unknown = null
const off = shallowRef<() => void>()
/**
 * A press on the canvas leaves whatever is being written there: the canvas keeps its touches to
 * itself, so a phone would otherwise keep the field, and its keyboard, open.
 */
const leaveFields = (e: Event) => {
  const active = props.viewer.el.ownerDocument.activeElement as HTMLElement | null
  if (!active || active === e.target || active.contains(e.target as Node)) return
  if (
    active === c.textField() ||
    active === labelEl.value ||
    active.matches('[data-frame-id][contenteditable="true"]')
  )
    active.blur()
}
const blur = () => {
  if (c.editing() && !state('Save text').disabled) press('Save text')
}
onMounted(() => {
  props.viewer.el.classList.add('abele-canvas-view_chrome')
  props.viewer.groupLabels = true
  props.viewer.draw()
  off.value = c.watch(() => {
    tick.value++
    props.viewer.stage.dataset.tool = c.tool()
    placeField()
    const drop = c.drop()
    if (drop && drop !== dropShown) {
      dropShown = drop
      menus.dropMenu(c)
    } else if (!drop) dropShown = null
  })
  c.textField().addEventListener('blur', blur)
  c.textField().addEventListener('input', placeField)
  frame = window.requestAnimationFrame(watchCamera)
})
onBeforeUnmount(() => {
  off.value?.()
  c.textField().removeEventListener('blur', blur)
  c.textField().removeEventListener('input', placeField)
  cancelAnimationFrame(frame)
  props.viewer.el.classList.remove('abele-canvas-view_chrome')
  props.viewer.groupLabels = false
})
</script>

<style lang="scss">
// The editor's old rows of words and its status line give way to the controls above. Doubled
// with the viewer's own class to outweigh the status line's place kept in viewer.css, which
// otherwise came and went with the order styles load in and moved the canvas under the pointer.
.abele-canvas-viewer.abele-canvas-view_chrome {
  position: relative;

  > .abele-canvas-controls,
  > .abele-canvas-connection-properties,
  > .abele-canvas-editor-status,
  > .abele-canvas-status {
    display: none;
  }

  // A card's words are written on the card itself.
  > .abele-canvas-text-editor {
    position: absolute;
    z-index: calc(var(--layer-cover) + 1);
    padding: 0;

    textarea {
      width: 100%;
      height: 100%;
      resize: none;
      padding: var(--size-4-2) var(--size-4-3);
      border: 2px solid var(--interactive-accent);
      border-radius: var(--radius-m);
      background: var(--background-primary);
      font-family: var(--font-text);
      font-size: inherit;
    }
    // On a shape the words sit in its middle with no box of their own: the shape is the box.
    &.is-shape textarea {
      padding-inline: 0;
      padding-bottom: 0;
      border: none;
      background: transparent;
      text-align: center;
      overflow: hidden;
    }
  }
}

.abele-canvas-chrome {
  position: absolute;
  inset: 0;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }

  // Nothing to undo or redo yet: the glyph stays, faint, and is no longer something to press.
  .canvas-control-item.is-disabled {
    cursor: default;
    opacity: 0.4;
  }
}

.abele-canvas-chrome__state {
  inset-inline-end: calc(
    var(--size-4-2) * 2 + var(--canvas-controls-icon-size, 18px) + var(--size-4-4)
  );
}

.abele-canvas-chrome__save-dot {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-yellow);
}
.abele-canvas-chrome__save.is-saving .abele-canvas-chrome__save-dot {
  background: var(--text-faint);
}

.abele-canvas-chrome__label {
  position: absolute;
  z-index: var(--layer-cover);
  transform: translate(-50%, -50%);
  min-width: 8em;
  text-align: center;
}

.abele-canvas-chrome__picked {
  position: absolute;
  z-index: var(--layer-cover);
}

// The colour of words, for a stroke or card left without one of the six.
.abele-canvas-chrome__ink {
  --canvas-color: var(--text-normal);
}

// A card's words written over it hide its own copy of them.
.abele-canvas-card-frame.is-being-written .abele-canvas-card {
  visibility: hidden;
}
// The pointer says what the tool in hand does.
.abele-canvas-view_chrome .abele-canvas-stage {
  &.is-panning,
  &[data-tool='pan'] {
    cursor: grab;
  }
  &[data-tool='card'],
  &[data-tool='shape'],
  &[data-tool='frame'],
  &[data-tool='connect'],
  &[data-tool='line'],
  &[data-tool='arrow'] {
    cursor: crosshair;
  }
}

// The tools' row across the tab's top, over the canvas as a drawing's is over its paper; the
// column of zoom and undo stands under it.
.abele-canvas-chrome__tools {
  position: absolute;
  inset-inline: 0;
  top: 0;
  z-index: var(--layer-cover);
}
.abele-canvas-chrome > .canvas-controls {
  top: calc(var(--abele-canvas-bar, 0px) + var(--abele-canvas-find, 0px) + var(--size-4-2));
}

.abele-canvas-chrome__swatch svg {
  fill: currentColor;
}
// The text's colour, pressed or not: a pressed glyph otherwise takes the accent.
.abele-canvas-chrome__swatch_ink.abele-obsidian-icon {
  color: var(--text-normal);
}

// On a phone two fingers zoom; the column keeps only undo and redo.
.is-phone-layout .abele-canvas-chrome__zoom {
  display: none;
}
</style>
