<template>
  <!-- The canvas's controls laid out as Obsidian Canvas lays out its own, in its own classes: the
       tools at the foot in the middle, zoom and history in a column at the top right, and the
       actions for what is picked in a small bar standing over it. -->
  <div class="abele-canvas-chrome" :class="{ 'is-phone-layout': phone }">
    <div v-if="saveState" class="canvas-controls abele-canvas-chrome__state">
      <div class="canvas-control-group">
        <div
          ref="stateEl"
          class="canvas-control-item abele-canvas-chrome__save"
          :class="`is-${saveState}`"
          :aria-label="saveState === 'saving' ? 'Saving' : 'Not saved: open for what to do'"
          @click="saveMenu"
        >
          <span class="abele-canvas-chrome__save-dot" />
        </div>
      </div>
    </div>

    <div class="canvas-controls abele-canvas-chrome__view">
      <div class="canvas-control-group">
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
    </div>

    <!-- Over a picked thing, its actions; above it, or under it where the top has no room. -->
    <div
      v-if="picked.rect && !editing && !drawing"
      class="canvas-menu abele-canvas-chrome__picked"
      :style="pickedAt"
      role="toolbar"
      aria-label="Selection"
    >
      <button
        class="clickable-icon abele-canvas-chrome__swatch-button"
        aria-label="Colour"
        @click="colourMenu($event)"
      >
        <span class="canvas-color-picker-item" :class="colourClass(currentColour)" />
      </button>
      <ChromeIcon
        v-if="one && (kind === 'text' || kind === 'shape')"
        :icon="SHAPE_ICONS[currentShape] ?? 'square'"
        tooltip="Shape"
        @click="shapeMenu($event, 'change')"
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
          @click="routeMenu($event)"
        />
        <ChromeIcon icon="move-right" tooltip="Arrow ends" @click="endsMenu($event)" />
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
        v-if="!one || kind !== 'group'"
        icon="frame"
        tooltip="Frame these"
        :disabled="groupLabel === null"
        @click="groupLabel && press(groupLabel)"
      />
      <ChromeIcon
        v-if="one && kind === 'group'"
        icon="ungroup"
        tooltip="Take out of the frame"
        @click="press('Ungroup selected group')"
      />
      <ChromeIcon icon="more-horizontal" tooltip="More" @click="moreMenu($event)" />
    </div>

    <!-- The walkthrough, only when the canvas has one. -->
    <div
      v-if="steps"
      class="canvas-menu abele-canvas-chrome__steps"
      role="toolbar"
      aria-label="Steps"
    >
      <ChromeIcon icon="chevron-left" tooltip="Previous step" @click="step(-1)" />
      <span class="abele-canvas-chrome__count">{{ viewer.step ?? 0 }} / {{ steps }}</span>
      <ChromeIcon icon="chevron-right" tooltip="Next step" @click="step(1)" />
      <ChromeIcon icon="play" tooltip="Play the walkthrough" @click="viewer.go(viewer.step ?? 1)" />
      <ChromeIcon
        icon="scan"
        tooltip="Show all"
        :disabled="viewer.step === null"
        @click="viewer.go(null)"
      />
    </div>

    <!-- The pen's colours and widths, over the tools while a pen is in hand. -->
    <div
      v-if="drawing && tool !== 'eraser' && tool !== 'partial-eraser'"
      class="canvas-menu abele-canvas-chrome__pen"
      role="toolbar"
      aria-label="Pen"
    >
      <button
        v-for="c in COLOURS"
        :key="c"
        class="clickable-icon abele-canvas-chrome__swatch-button"
        :class="{ 'is-active': value('ink-color') === c }"
        :aria-label="`Draw in ${COLOUR_NAMES[c]}`"
        @click="set('ink-color', c)"
      >
        <span
          class="canvas-color-picker-item"
          :class="[colourClass(c), { 'is-active': value('ink-color') === c }]"
        />
      </button>
      <span class="canvas-card-menu-divider" />
      <button
        v-for="(t, i) in THICKNESSES"
        :key="t"
        class="clickable-icon abele-canvas-chrome__width"
        :class="{ 'is-active': value('ink-size') === t }"
        :aria-label="`Width: ${t}`"
        @click="set('ink-size', t)"
      >
        <span
          class="abele-canvas-chrome__width-dot"
          :style="{ '--abele-width': 3 + i * 3 + 'px' }"
        />
      </button>
    </div>

    <!-- The tools: one slot for each family, wearing the glyph of the member last used. -->
    <div
      class="canvas-card-menu abele-canvas-chrome__tools"
      role="toolbar"
      aria-label="Canvas tools"
    >
      <template v-for="(group, g) in shownGroups" :key="g">
        <span v-if="g" class="canvas-card-menu-divider" />
        <ToolButton
          v-for="slot in group"
          :key="slot.id"
          :icon="slotIcon(slot)"
          :tooltip="slotTooltip(slot)"
          :active="slotActive(slot)"
          @click="useSlot(slot, $event)"
        />
      </template>
      <template v-if="hidden.length">
        <span class="canvas-card-menu-divider" />
        <ToolButton
          :icon="hiddenActive ? slotIcon(hiddenActive) : 'more-horizontal'"
          tooltip="More tools"
          :active="!!hiddenActive"
          @click="moreTools($event)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Menu, Notice, Platform, setIcon, setTooltip } from 'obsidian'
import type { CanvasEditor, CanvasField } from '@/canvas/Editor'
import type { CanvasViewer } from '@/canvas/Viewer'
import { stepsOf } from '@/canvas/core/steps'
import { SHAPES, type Shape } from '@/canvas/core/model'
import { allInkEntries } from '@/canvas/core/ink'
import { zoomAt } from '@/drawing/camera'
import ChromeIcon from '../obsidian/Icon.vue'

const props = defineProps<{ editor: CanvasEditor; viewer: CanvasViewer }>()
const c = props.editor.controls

/** One of Obsidian Canvas's own control items: a glyph in its column, named by its tooltip. */
const ControlItem = defineComponent({
  props: { icon: String, tooltip: String, disabled: Boolean },
  emits: ['click'],
  setup(p, { emit }) {
    const el = ref<HTMLElement>()
    onMounted(() => {
      if (!el.value) return
      setIcon(el.value, p.icon!)
      setTooltip(el.value, p.tooltip!, { placement: 'left' })
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
const ToolButton = defineComponent({
  props: { icon: String, tooltip: String, active: Boolean },
  emits: ['click'],
  setup(p, { emit }) {
    const el = ref<HTMLElement>()
    const draw = () => {
      if (!el.value) return
      el.value.replaceChildren()
      setIcon(el.value, p.icon!)
      setTooltip(el.value, p.tooltip!, { placement: 'top' })
    }
    onMounted(draw)
    return () => {
      queueMicrotask(draw)
      return h('div', {
        ref: el,
        class: ['canvas-card-menu-button', 'abele-canvas-chrome__tool', { 'is-active': p.active }],
        role: 'button',
        'aria-label': p.tooltip,
        'aria-pressed': p.active,
        onClick: (e: MouseEvent) => emit('click', e),
      })
    }
  },
})

type Slot = {
  id: string
  /** The family's members: a tool of the editor, or an action that adds something. */
  members: { id: string; label: string; icon: string; tooltip: string; key?: string }[]
}
const SHAPE_ICONS: Record<string, string> = {
  rectangle: 'square',
  pill: 'rectangle-horizontal',
  diamond: 'diamond',
  parallelogram: 'square-dashed',
  circle: 'circle',
  'predefined-process': 'columns-3',
  document: 'file',
  database: 'database',
}
const ROUTE_ICONS: Record<string, string> = {
  direct: 'minus',
  square: 'corner-down-right',
  bezier: 'spline',
}
const COLOURS = ['', '1', '2', '3', '4', '5', '6']
const COLOUR_NAMES: Record<string, string> = {
  '': 'the text colour',
  1: 'red',
  2: 'orange',
  3: 'yellow',
  4: 'green',
  5: 'cyan',
  6: 'purple',
}
const THICKNESSES = ['fine', 'medium', 'bold']
const SLOTS: Slot[][] = [
  [
    {
      id: 'select',
      members: [
        {
          id: 'select',
          label: 'Select canvas objects',
          icon: 'mouse-pointer-2',
          tooltip: 'Select (V)',
        },
      ],
    },
    {
      id: 'pan',
      members: [
        {
          id: 'pan',
          label: 'Navigate canvas',
          icon: 'hand',
          tooltip: 'Hand: move the canvas (H, or hold Space)',
        },
      ],
    },
  ],
  [
    {
      id: 'card',
      members: [{ id: 'card', label: 'Add text card', icon: 'sticky-note', tooltip: 'Card (T)' }],
    },
    {
      id: 'note',
      members: [
        {
          id: 'note',
          label: 'Add note or attachment',
          icon: 'file-text',
          tooltip: 'Note or file from the vault (N)',
        },
      ],
    },
    {
      id: 'shape',
      members: SHAPES.map((s) => ({
        id: s,
        label: 'Add canvas shape',
        icon: SHAPE_ICONS[s] ?? 'square',
        tooltip: `Shape: ${s.replace(/-/g, ' ')} (R)`,
      })),
    },
    {
      id: 'connect',
      members: [
        {
          id: 'connect',
          label: 'Draw connection',
          icon: 'spline',
          tooltip: 'Connect two cards (A)',
        },
        { id: 'line', label: 'Draw free line', icon: 'minus', tooltip: 'Line' },
        { id: 'arrow', label: 'Draw free arrow', icon: 'move-up-right', tooltip: 'Arrow' },
      ],
    },
    {
      id: 'frame',
      members: [
        {
          id: 'frame',
          label: 'Group selected cards',
          icon: 'frame',
          tooltip: 'Frame: pick cards, then frame them (F)',
        },
      ],
    },
  ],
  [
    {
      id: 'pen',
      members: [
        { id: 'pen', label: 'Draw with pen', icon: 'pen-line', tooltip: 'Pen (P)' },
        {
          id: 'marker',
          label: 'Draw with marker',
          icon: 'highlighter',
          tooltip: 'Marker (P again)',
        },
      ],
    },
    {
      id: 'eraser',
      members: [
        {
          id: 'eraser',
          label: 'Erase whole strokes',
          icon: 'eraser',
          tooltip: 'Eraser: whole strokes (E)',
        },
        {
          id: 'partial-eraser',
          label: 'Erase part of strokes',
          icon: 'eraser',
          tooltip: 'Eraser: part of a stroke (E again)',
        },
      ],
    },
    {
      id: 'lasso',
      members: [
        {
          id: 'lasso',
          label: 'Lasso canvas objects',
          icon: 'lasso',
          tooltip: 'Lasso: circle cards and ink (L)',
        },
      ],
    },
  ],
]
/** On a phone seven slots fit; the rest wait in More, in this order of need. */
const PHONE_ORDER = ['select', 'pen', 'eraser', 'shape', 'card', 'note']

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
const drawing = computed(() => ['pen', 'marker', 'eraser', 'partial-eraser'].includes(tool.value))
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
  const above = top > 56
  return {
    left: `${Math.max(8, left)}px`,
    top: `${above ? top - 12 : bottom + 12}px`,
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
  phone ? [PHONE_ORDER.map((id) => slots.find((s) => s.id === id)!)] : SLOTS
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
  const again = lastPressed === slot.id && slot.members.length > 1
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
  if (slot.id === 'frame') {
    if (groupLabel.value) return press(groupLabel.value)
    return void new Notice('Pick the cards to frame first')
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
  showAt(menu, e)
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
  showAt(menu, e)
}
/** A menu opens at the button that was pressed, under it, or over it at the foot. */
function showAt(menu: Menu, e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const low = r.top > window.innerHeight / 2
  menu.showAtPosition({
    x: r.left,
    y: low ? r.top : r.bottom,
    left: false,
    overlap: false,
    width: r.width,
  })
}

function colourMenu(e: MouseEvent) {
  const menu = new Menu()
  for (const v of COLOURS)
    menu.addItem((item) =>
      item
        .setTitle(v ? COLOUR_NAMES[v][0].toUpperCase() + COLOUR_NAMES[v].slice(1) : 'No colour')
        .setIcon('circle')
        .setChecked(currentColour.value === v)
        .onClick(() => applyColour(v))
    )
  showAt(menu, e)
}
function applyColour(v: string) {
  if (kind.value === 'connection' || kind.value === 'line') {
    set('connection-color', v)
    return press('Apply connection style')
  }
  if (one.value && (kind.value === 'text' || kind.value === 'shape')) {
    set('shape-color', v)
    set('shape', currentShape.value)
    return press('Apply selected shape')
  }
  set('ink-color', v)
  press('Recolor canvas selection')
}
function shapeMenu(e: MouseEvent, _: 'change') {
  const menu = new Menu()
  for (const s of SHAPES)
    menu.addItem((item) =>
      item
        .setTitle(s[0].toUpperCase() + s.slice(1).replace(/-/g, ' '))
        .setIcon(SHAPE_ICONS[s] ?? 'square')
        .setChecked(currentShape.value === s)
        .onClick(() => {
          set('shape', s as Shape)
          set('shape-color', currentColour.value)
          press('Apply selected shape')
        })
    )
  showAt(menu, e)
}
function routeMenu(e: MouseEvent) {
  const menu = new Menu()
  for (const [v, title] of [
    ['direct', 'Straight'],
    ['square', 'Elbow'],
    ['bezier', 'Curved'],
  ])
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(ROUTE_ICONS[v])
        .setChecked(value('routing') === v)
        .onClick(() => {
          set('routing', v)
          press('Apply connection style')
        })
    )
  showAt(menu, e)
}
function endsMenu(e: MouseEvent) {
  const menu = new Menu()
  for (const [from, to, title, icon] of [
    ['none', 'arrow', 'Arrow at the end', 'move-right'],
    ['arrow', 'arrow', 'Arrows at both ends', 'move-horizontal'],
    ['none', 'none', 'No arrows', 'minus'],
  ])
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(icon)
        .setChecked(value('from-end') === from && value('to-end') === to)
        .onClick(() => {
          set('from-end', from)
          set('to-end', to)
          press('Apply connection style')
        })
    )
  showAt(menu, e)
}
function moreMenu(e: MouseEvent) {
  const menu = new Menu()
  const later = (title: string, icon: string) =>
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(icon)
        .onClick(() => new Notice(`${title}: not in this prototype yet`))
    )
  later('Duplicate', 'copy-plus')
  later('Copy', 'copy')
  menu.addSeparator()
  later('Bring to front', 'bring-to-front')
  later('Send to back', 'send-to-back')
  menu.addSeparator()
  later('Attach to the chat as a picture', 'paperclip')
  later('Ask the agent about this', 'message-circle-question')
  later('Export the selection', 'image-down')
  later('Copy embed of the selection', 'clipboard-copy')
  menu.addSeparator()
  menu.addItem((item) =>
    item
      .setTitle('Delete')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() =>
        press(
          state('Delete selected card').disabled
            ? 'Delete canvas selection'
            : 'Delete selected card'
        )
      )
  )
  showAt(menu, e)
}
function saveMenu(e: MouseEvent) {
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle('Retry')
      .setIcon('refresh-cw')
      .onClick(() => press('Retry save'))
  )
  menu.addItem((i) =>
    i
      .setTitle('Keep the draft')
      .setIcon('archive')
      .onClick(() => press('Keep text draft'))
  )
  menu.addItem((i) =>
    i
      .setTitle('Discard the draft…')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => press('Discard local draft'))
  )
  showAt(menu, e)
}

function zoom(factor: number) {
  const s = props.viewer.stage
  props.viewer.setCamera(zoomAt(props.viewer.camera, s.clientWidth / 2, s.clientHeight / 2, factor))
  tick.value++
}
function zoomTo(z: number) {
  zoom(z / props.viewer.camera.zoom)
}
function step(delta: number) {
  const n = (props.viewer.step ?? 0) + delta
  props.viewer.go(n < 1 ? null : Math.min(n, steps.value))
  tick.value++
}

/** The card being written in: the editor's own field, laid over the card on the canvas. */
const placeField = () => {
  const id = c.editing()
  const field = c.textField().parentElement as HTMLElement | null
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
  frame = requestAnimationFrame(watchCamera)
}
const off = shallowRef<() => void>()
const blur = () => {
  if (c.editing() && !state('Save text').disabled) press('Save text')
}
onMounted(() => {
  props.viewer.el.classList.add('abele-canvas-view_chrome')
  off.value = c.watch(() => {
    tick.value++
    placeField()
  })
  c.textField().addEventListener('blur', blur)
  frame = requestAnimationFrame(watchCamera)
})
onBeforeUnmount(() => {
  off.value?.()
  c.textField().removeEventListener('blur', blur)
  cancelAnimationFrame(frame)
  props.viewer.el.classList.remove('abele-canvas-view_chrome')
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

.abele-canvas-chrome__picked {
  position: absolute;
  z-index: var(--layer-cover);
}

.abele-canvas-chrome__steps,
.abele-canvas-chrome__pen {
  position: absolute;
  left: 50%;
  bottom: calc(var(--size-4-4) + 3.6em);
  transform: translateX(-50%);
  z-index: var(--layer-cover);
  align-items: center;
}
.abele-canvas-chrome__pen ~ .abele-canvas-chrome__steps {
  display: none;
}

.abele-canvas-chrome__count {
  white-space: nowrap;
  padding-inline: var(--size-2-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  font-variant-numeric: tabular-nums;
}

.abele-canvas-chrome__swatch-button {
  padding: var(--size-2-1);

  .canvas-color-picker-item {
    width: 18px;
    height: 18px;
    margin: 0;
  }
}
// The colour of words, for a stroke or card left without one of the six.
.abele-canvas-chrome__ink {
  --canvas-color: var(--text-normal);
}

.abele-canvas-chrome__width {
  width: 28px;
  justify-content: center;

  &.is-active {
    background: var(--background-modifier-hover);
  }
}
.abele-canvas-chrome__width-dot {
  display: block;
  width: var(--abele-width);
  height: var(--abele-width);
  border-radius: 50%;
  background: var(--text-normal);
}

.abele-canvas-chrome__tool.is-active {
  color: var(--color-accent);
}

// Obsidian draws no card menu on a phone; this one stays, along the foot over the bar.
.is-phone .abele-canvas-chrome__tools {
  display: flex;
  bottom: calc(var(--size-4-3) + var(--safe-area-inset-bottom, 0px));
}
.is-phone .abele-canvas-chrome__tools .canvas-card-menu-button {
  padding: var(--size-4-2) var(--size-4-2);
  --icon-size: var(--icon-l);
}
</style>
