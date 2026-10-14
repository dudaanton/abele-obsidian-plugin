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
    :style="{ '--abele-canvas-bar': `${barHeight}px` }"
    @pointerdown.stop
  >
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
      v-if="
        picked.rect &&
        !editing &&
        !drawing &&
        tool !== 'frame' &&
        !gesturing &&
        !naming &&
        !labeling
      "
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
      <ChromeIcon
        v-if="kinds.includes('stroke')"
        :icon="attachedInk ? 'unlink' : 'link'"
        :tooltip="attachedInk ? 'Detach from its card' : 'Attach to the card under it'"
        @click="press(attachedInk ? 'Detach selected ink' : 'Attach selected ink')"
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
      <ChromeIcon
        icon="more-horizontal"
        tooltip="More"
        @click="menus.moreMenu($event, c, view, host)"
      />
    </div>

    <!-- A connection's label written where it stands, as Obsidian Canvas writes an edge's. -->
    <input
      v-if="labelAt"
      :key="labelAt.id"
      ref="labelEl"
      class="abele-canvas-chrome__label"
      :style="labelAt.style"
      :value="labelAt.text"
      type="text"
      aria-label="Label of the connection"
      placeholder="Label"
      @keydown="labelKey"
      @blur="labelDone"
      @pointerdown.stop
    />

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
import { zoomAt } from '@/drawing/camera'
import ChromeIcon from '../obsidian/Icon.vue'
import ToolBar from '../obsidian/ToolBar.vue'
import ToolBarGroup from '../obsidian/ToolBarGroup.vue'
import CanvasFrames from './CanvasFrames.vue'
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
import { labelPoint, paintedRoute } from '@/canvas/core/scene'
import { linesOf } from '@/canvas/core/primitives'

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
let lastPressed = ''
const stateEl = ref<HTMLElement>()

const tool = computed(() => (tick.value, c.tool()))
const picked = computed(() => (tick.value, c.picked()))
const kinds = computed(() => picked.value.kinds)
const one = computed(() => kinds.value.length === 1)
const kind = computed(() => kinds.value[0])
const editing = computed(() => (tick.value, c.editing()))
const gesturing = computed(() => (tick.value, c.gesturing()))
const naming = computed(() => (tick.value, c.naming()))
const labeling = computed(() => (tick.value, c.labeling()))
const labelEl = ref<HTMLInputElement>()
/** The label field over the middle of the connection being labelled, in the canvas's scale. */
const labelAt = computed(() => {
  const id = labeling.value
  if (!id) return null
  const g = graph(),
    edge = g.edges.find((e) => e.id === id),
    line = edge ? undefined : linesOf(g).find((l) => l.id === id)
  if (!edge && !line) return null
  const at = labelPoint(edge ? paintedRoute(edge, g).points : [line.from, line.to]),
    cam = props.viewer.camera
  return {
    id,
    text: (edge ?? line).label ?? '',
    style: {
      left: `${(at.x - cam.x) * cam.zoom}px`,
      top: `${(at.y - cam.y) * cam.zoom}px`,
      fontSize: `calc(var(--font-text-size) * ${Math.max(0.6, Math.min(cam.zoom, 2)).toFixed(3)})`,
    },
  }
})
watch(labelAt, (now, was) => {
  if (!now || now.id === was?.id) return
  void nextTick(() => {
    labelEl.value?.focus()
    labelEl.value?.select()
  })
})
let labelLeft = false
function labelKey(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    labelEl.value?.blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    labelLeft = true
    c.editLabel(null)
    props.viewer.el.focus({ preventScroll: true })
  }
}
function labelDone(e: FocusEvent) {
  const id = labeling.value
  if (labelLeft || !id) return void (labelLeft = false)
  void c.saveLabel(id, (e.target as HTMLInputElement).value)
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
  barSize = new ResizeObserver(() => (barHeight.value = el.offsetHeight))
  barSize.observe(el)
})
onBeforeUnmount(() => barSize?.disconnect())
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
  const r = picked.value.rect
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
  const above = Math.min(top, nameTop) > 56
  const over = Math.min(top, nameTop)
  // Kept clear of the stage's sides and of the control column at the top right.
  const half = (barEl.value?.offsetWidth ?? 0) / 2,
    column = props.viewer.el.querySelector<HTMLElement>('.abele-canvas-chrome__view'),
    right = props.viewer.stage.clientWidth - (column ? column.offsetWidth + 24 : 8)
  return {
    left: `${Math.max(8 + half, Math.min(left, right - half))}px`,
    top: `${above ? over - 12 : bottom + 12}px`,
    transform: `translate(-50%, ${above ? '-100%' : '0'})`,
  }
})

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
const slotIcon = (slot: Slot) => {
  const m = slot.members.find((x) => x.id === tool.value) ?? member(slot)
  return m.icon
}
const slotTooltip = (slot: Slot) => member(slot).tooltip
const slotActive = (slot: Slot) => slot.members.some((m) => m.id === tool.value)

/** A family's slot takes its last member; pressed again, it offers the others at the button. */
function useSlot(slot: Slot, e: MouseEvent) {
  // A tool already in hand offers its family; the shape slot adds a shape each time it is
  // pressed, so it offers its family when pressed twice running.
  const again =
    slot.members.length > 1 &&
    (slot.members.some((m) => m.id === tool.value) || lastPressed === slot.id)
  lastPressed = slot.id
  if (again) return familyMenu(slot, e)
  run(slot, member(slot))
}
function run(slot: Slot, m: Slot['members'][number]) {
  last.value = { ...last.value, [slot.id]: slot.members.indexOf(m) }
  if (slot.id === 'shape') {
    set('shape', m.id)
    return press('Add canvas shape')
  }
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
  for (const slot of hidden.value)
    menu.addItem((item) =>
      item
        .setTitle(member(slot).tooltip.replace(/ \(.*\)$/, ''))
        .setIcon(member(slot).icon)
        .setChecked(slotActive(slot))
        .onClick(() => run(slot, member(slot)))
    )
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
const placeField = () => {
  const id = c.editing()
  const field = c.textField().parentElement
  if (!field) return
  const node = id ? graph().nodes.find((n) => n.id === id) : undefined
  if (!node) return field.style.removeProperty('left')
  const cam = props.viewer.camera,
    stage = props.viewer.stage
  const at = stage.offsetTop
  Object.assign(field.style, {
    left: `${stage.offsetLeft + (node.x - cam.x) * cam.zoom}px`,
    top: `${at + (node.y - cam.y) * cam.zoom}px`,
    width: `${node.width * cam.zoom}px`,
    height: `${node.height * cam.zoom}px`,
    fontSize: `calc(var(--font-text-size) * ${cam.zoom})`,
  })
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
  frame = window.requestAnimationFrame(watchCamera)
}
let dropShown: unknown = null
const off = shallowRef<() => void>()
const blur = () => {
  if (c.editing() && !state('Save text').disabled) press('Save text')
}
onMounted(() => {
  props.viewer.el.classList.add('abele-canvas-view_chrome')
  props.viewer.groupLabels = true
  props.viewer.draw()
  off.value = c.watch(() => {
    tick.value++
    placeField()
    const drop = c.drop()
    if (drop && drop !== dropShown) {
      dropShown = drop
      menus.dropMenu(c)
    } else if (!drop) dropShown = null
  })
  c.textField().addEventListener('blur', blur)
  frame = window.requestAnimationFrame(watchCamera)
})
onBeforeUnmount(() => {
  off.value?.()
  c.textField().removeEventListener('blur', blur)
  cancelAnimationFrame(frame)
  props.viewer.el.classList.remove('abele-canvas-view_chrome')
  props.viewer.groupLabels = false
})
</script>

<style lang="scss">
// The editor's old rows of words and its status line give way to the controls above.
.abele-canvas-view_chrome {
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

// The tools' row across the tab's top, over the canvas as a drawing's is over its paper; the
// column of zoom and undo stands under it.
.abele-canvas-chrome__tools {
  position: absolute;
  inset-inline: 0;
  top: 0;
  z-index: var(--layer-cover);
}
.abele-canvas-chrome > .canvas-controls {
  top: calc(var(--abele-canvas-bar, 0px) + var(--size-4-2));
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
