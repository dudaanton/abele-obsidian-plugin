<template>
  <!-- Zen mode over the open tab. While it is there the window keeps only this tab: the classes it
       puts on the body hide the rest (styles below). It adds two things of its own: a strip along
       the top that brings the tab's header back while the pointer is there, and on a page, the
       column's two edges to drag it wider or narrower about the centre. -->
  <div class="abele-zen">
    <div class="abele-zen__top" aria-hidden="true" @pointerenter="reveal()" @click="reveal()" />
    <template v-if="!wide && !phone">
      <hr
        v-for="side in SIDES"
        :key="side"
        :ref="(el) => (edges[side] = el as HTMLElement | null)"
        class="workspace-leaf-resize-handle abele-zen__edge"
        :class="[`abele-zen__edge_${side}`, { 'is-active': dragging === side }]"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="EDGE_TIP"
        :aria-valuenow="width"
        :aria-valuemin="ZEN_MIN_WIDTH"
        @pointerdown="drag($event, side)"
        @dblclick="emit('update:width', ZEN_WIDTH)"
        @keydown.left.prevent="step(side === 'end' ? -32 : 32)"
        @keydown.right.prevent="step(side === 'end' ? 32 : -32)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch, watchEffect } from 'vue'
import { Platform, setTooltip } from 'obsidian'
import { ZEN_MIN_WIDTH, ZEN_WIDTH, zenWidth } from '@/zen/zenLayout'

const props = defineProps<{
  /** The column's width, px. */
  width: number
  /** The tab is a surface (a canvas, a graph): edge to edge, no column. */
  wide: boolean
  document?: Document
}>()
const emit = defineEmits<{ 'update:width': [width: number] }>()

const SIDES = ['start', 'end'] as const
const EDGE_TIP = 'Drag to change the width · double-click to reset'
const phone = Platform.isPhone
const doc = props.document ?? document
const win = doc.defaultView!
const body = doc.body
const edges = reactive<Record<(typeof SIDES)[number], HTMLElement | null>>({
  start: null,
  end: null,
})
const dragging = ref<(typeof SIDES)[number] | null>(null)

watchEffect(() => {
  body.style.setProperty('--abele-zen-width', `${props.width}px`)
  body.classList.toggle('abele-zen-wide', props.wide)
})
watch(
  () => [edges.start, edges.end],
  () => SIDES.forEach((side) => edges[side] && setTooltip(edges[side], EDGE_TIP))
)

// The header comes back while the pointer is at the top, and goes a moment after it leaves; on a
// phone a tap at the top brings it for a few seconds.
let hide: number | undefined
function reveal() {
  body.classList.add('abele-zen-header')
  win.clearTimeout(hide)
  if (phone) hide = win.setTimeout(conceal, 3000)
}
function conceal() {
  body.classList.remove('abele-zen-header')
}
function onMove(event: PointerEvent) {
  if (phone || !body.classList.contains('abele-zen-header')) return
  const header = doc.querySelector('.workspace-leaf.abele-zen-active .view-header')
  const bottom = header?.getBoundingClientRect().bottom ?? 0
  win.clearTimeout(hide)
  if (event.clientY > bottom + 8) hide = win.setTimeout(conceal, 800)
}

// Either edge moves both: the column stays in the middle.
let stopDrag: (() => void) | undefined
function drag(event: PointerEvent, side: (typeof SIDES)[number]) {
  stopDrag?.()
  event.preventDefault()
  const start = event.clientX
  const from = props.width
  dragging.value = side
  const move = (e: PointerEvent) =>
    emit(
      'update:width',
      zenWidth(from + 2 * (side === 'end' ? 1 : -1) * (e.clientX - start), room())
    )
  const up = () => {
    dragging.value = null
    win.removeEventListener('pointermove', move)
    win.removeEventListener('pointerup', up)
    win.removeEventListener('pointercancel', up)
    stopDrag = undefined
  }
  stopDrag = up
  win.addEventListener('pointermove', move)
  win.addEventListener('pointerup', up)
  win.addEventListener('pointercancel', up)
}
const room = () => win.innerWidth
const step = (by: number) => emit('update:width', zenWidth(props.width + by, room()))

onMounted(() => {
  body.classList.add('abele-zen')
  win.addEventListener('pointermove', onMove)
})
onUnmounted(() => {
  stopDrag?.()
  win.clearTimeout(hide)
  win.removeEventListener('pointermove', onMove)
  body.classList.remove('abele-zen', 'abele-zen-wide', 'abele-zen-header')
  body.style.removeProperty('--abele-zen-width')
})
</script>

<style lang="scss">
// Everything around the open tab goes: the ribbon, both sidebars, the tab strip, the status bar,
// the window's title bar, the other panes of a split; on a phone, the bottom bar.
body.abele-zen {
  .workspace-ribbon,
  .workspace-split.mod-left-split,
  .workspace-split.mod-right-split,
  .workspace-split.mod-root .workspace-tab-header-container,
  .status-bar,
  .titlebar,
  .mobile-navbar,
  .workspace-split.mod-root .workspace-leaf:not(.abele-zen-active) {
    display: none;
  }

  .workspace-split.mod-root .workspace-tabs:not(:has(.abele-zen-active)),
  .workspace-split.mod-root .workspace-split:not(:has(.abele-zen-active)) {
    display: none;
  }

  // A split's dividers go with its other panes.
  .workspace-split.mod-root .workspace-leaf-resize-handle:not(.abele-zen__edge) {
    display: none;
  }

  .workspace-split.mod-root .workspace-leaf.abele-zen-active {
    position: relative;
  }
  // The header's room stays empty, so the page does not move when it goes and the header comes
  // back over nothing.
  .workspace-split.mod-root .workspace-leaf.abele-zen-active > .workspace-leaf-content {
    padding-top: var(--header-height);
  }

  // The header waits above the tab and comes over it while the pointer is at the top.
  .workspace-leaf.abele-zen-active .view-header {
    position: absolute;
    inset-inline: 0;
    top: 0;
    z-index: var(--layer-cover);
    background-color: var(--background-primary);
    border-bottom: var(--border-width) solid var(--background-modifier-border);
    transform: translateY(-100%);
    transition: transform 150ms ease-out;
  }
  &.abele-zen-header .workspace-leaf.abele-zen-active .view-header,
  .workspace-leaf.abele-zen-active .view-header:hover,
  .workspace-leaf.abele-zen-active .view-header:focus-within {
    transform: none;
  }

  // A page stands in the column: a note by Obsidian's own readable width, set to the column's,
  // whether readable line length is on or not; any other page by its content.
  --file-line-width: var(--abele-zen-width);

  .markdown-preview-sizer,
  .cm-sizer {
    max-width: var(--file-line-width);
    margin-inline: auto;
  }
  .workspace-leaf.abele-zen-active
    .workspace-leaf-content:not([data-type='markdown'])
    > .view-content {
    width: 100%;
    max-width: var(--abele-zen-width);
    margin-inline: auto;
  }
  // A phone's header floats over the page: it fades rather than slides, and the page starts
  // under the status bar instead of under the header.
  &.is-phone {
    --view-top-spacing: calc(var(--safe-area-inset-top, 0px) + var(--size-4-2));
    --view-top-spacing-markdown: calc(var(--safe-area-inset-top, 0px) + var(--size-4-4));
  }
  // Obsidian's markdown leaf takes no room of its own above; a note keeps only the markdown one.
  &.is-phone .mod-root .workspace-leaf-content[data-type='markdown'] {
    --view-top-spacing: 0;
  }
  &.is-phone .workspace-split.mod-root .workspace-leaf.abele-zen-active > .workspace-leaf-content {
    padding-top: 0;
  }
  &.is-phone .workspace-leaf.abele-zen-active .view-header {
    position: absolute;
    background-color: transparent;
    border-bottom: none;
    transform: none;
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms ease-out;
  }
  &.is-phone.abele-zen-header .workspace-leaf.abele-zen-active .view-header {
    opacity: 1;
    pointer-events: auto;
  }
  // On a phone there is no column: the page is as wide as the screen.
  &.is-phone .workspace-leaf.abele-zen-active .workspace-leaf-content > .view-content {
    max-width: none;
  }
}
// A surface goes edge to edge.
body.abele-zen.abele-zen-wide
  .workspace-leaf.abele-zen-active
  .workspace-leaf-content
  > .view-content {
  max-width: none;
}

div.abele-zen {
  position: absolute;
  inset: 0;
  z-index: var(--layer-cover);
  pointer-events: none;
}
.abele-zen__top {
  position: absolute;
  inset-inline: 0;
  top: 0;
  height: var(--size-4-2);
  pointer-events: auto;
}
body.is-phone .abele-zen__top {
  height: var(--size-4-6);
}
// The column's edges, Obsidian's own divider: seen only while pointed at or dragged.
// Obsidian hides a leaf's own divider in the last pane; these are the column's, not the leaf's.
body.abele-zen .workspace-leaf .abele-zen > .abele-zen__edge.workspace-leaf-resize-handle {
  display: block;
  position: absolute;
  inset-block: 0;
  width: var(--divider-width-hover);
  height: 100%;
  margin: 0;
  border: none;
  border-inline-end: var(--divider-width) solid transparent;
  cursor: col-resize;
  pointer-events: auto;

  &:hover,
  &:focus-visible {
    border-color: var(--divider-color-hover);
  }
  &.is-active {
    border-color: var(--color-accent);
  }
}
.abele-zen__edge_start {
  left: calc(50% - var(--abele-zen-width) / 2 - var(--divider-width-hover));
}
.abele-zen__edge_end {
  left: calc(50% + var(--abele-zen-width) / 2);
}
</style>
