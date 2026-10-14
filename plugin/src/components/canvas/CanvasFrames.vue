<template>
  <!-- Each frame's name, as Obsidian Canvas draws a group's: a label standing over the frame's
       top left corner, in the frame's colour. Pressing it picks and carries the frame; a double
       press writes a new name on the label itself. -->
  <div class="abele-canvas-frames">
    <div
      v-for="f in frames"
      :key="f.id"
      class="canvas-node canvas-node-group abele-canvas-frame"
      :class="[
        f.color ? `is-themed mod-canvas-color-${f.color}` : '',
        { 'is-selected': f.selected, 'is-collapsed': f.collapsed },
      ]"
      :style="f.style"
    >
      <div
        :ref="(el) => label(el as HTMLElement | null, f)"
        class="canvas-group-label abele-canvas-frame__label"
        :class="f.color ? (DARK_WORDS.has(f.color) ? 'mod-foreground-dark' : 'mod-foreground-light') : ''"
        :data-frame-id="f.id"
        :contenteditable="f.naming ? 'true' : undefined"
        :style="{ fontSize: f.font }"
        role="button"
        @dblclick.stop="c.name(f.id)"
        @pointerdown="f.naming && $event.stopPropagation()"
        @keydown="key($event, f.id)"
        @blur="f.naming && finish($event, f.id)"
      >
        <span
          v-if="f.collapsed && !f.naming"
          :ref="(el) => fold(el as HTMLElement | null, f)"
          class="abele-canvas-frame__fold"
          role="button"
          @pointerdown.stop
          @click.stop="c.foldFrame(f.id, false)"
        /><span v-if="!f.naming" class="abele-canvas-frame__name">{{ f.label }}</span
        ><template v-else>{{ f.label }}</template
        ><span v-if="f.collapsed && !f.naming && f.hidden" class="abele-canvas-frame__count">{{
          f.hidden
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { setIcon, setTooltip } from 'obsidian'
import type { CanvasEditor } from '@/canvas/Editor'
import type { CanvasViewer } from '@/canvas/Viewer'
import { canvasVisibility } from '@/canvas/core/visibility'
import { descendants } from '@/canvas/core/model'

const props = defineProps<{ editor: CanvasEditor; viewer: CanvasViewer; tick: number }>()
const c = props.editor.controls
/** Yellow and cyan are light enough that Obsidian writes on them in dark words. */
const DARK_WORDS = new Set(['3', '5'])

type Frame = {
  id: string
  label: string
  color: string
  selected: boolean
  collapsed: boolean
  naming: boolean
  hidden: number
  font: string
  style: Record<string, string>
}

/** Every frame on screen, placed where the viewer's camera puts it. */
const frames = computed<Frame[]>(() => {
  props.tick
  const graph = props.viewer.graph,
    cam = props.viewer.camera,
    selected = props.viewer.selection,
    naming = c.naming()
  if (props.viewer.step !== null) return []
  const { parents, visible } = canvasVisibility(graph, props.viewer.visible())
  return visible
    .filter((n) => n.type === 'group')
    .map((n) => ({
      id: n.id,
      label: n.label || 'Frame',
      color: /^[1-6]$/.test(n.color ?? '') ? n.color! : '',
      selected: selected.has(n.id),
      collapsed: !!n.collapsed,
      naming: naming === n.id,
      hidden: n.collapsed ? descendants(n.id, parents).length : 0,
      // Obsidian's size at full scale; zoomed out it shrinks with the canvas only so far, so a
      // name stays readable over a whole canvas on a phone without outweighing it.
      font: `calc(1.5em * ${Math.max(0.6, Math.min(cam.zoom, 2)).toFixed(3)})`,
      style: {
        left: `${(n.x - cam.x) * cam.zoom}px`,
        top: `${(n.y - cam.y) * cam.zoom}px`,
        width: `${n.width * cam.zoom}px`,
        height: `${n.height * cam.zoom}px`,
      },
    }))
})

const named = new WeakSet<HTMLElement>()
/** A label's full name in its tooltip; a label being written gets the caret, its words chosen. */
function label(el: HTMLElement | null, f: Frame) {
  if (!el) return
  setTooltip(el, f.collapsed ? `${f.label}: ${f.hidden} inside, folded` : f.label, {
    placement: 'top',
  })
  if (!f.naming) return named.delete(el)
  if (named.has(el)) return
  named.add(el)
  void nextTick(() => {
    el.focus()
    const range = el.ownerDocument.createRange()
    range.selectNodeContents(el)
    const sel = el.ownerDocument.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
}
function fold(el: HTMLElement | null, f: Frame) {
  if (!el || el.childElementCount) return
  setIcon(el, 'chevron-right')
  setTooltip(el, `Unfold ${f.label}`, { placement: 'top' })
}
function finish(e: Event, id: string) {
  const text = (e.target as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
  void c.renameFrame(id, text)
}
function key(e: KeyboardEvent, id: string) {
  if (c.naming() !== id || e.isComposing) return
  e.stopPropagation()
  if (e.key === 'Enter') {
    e.preventDefault()
    ;(e.target as HTMLElement).blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    c.name(null)
  }
}
watch(
  () => c.naming(),
  (now, was) => {
    if (!now && was) props.viewer.el.focus({ preventScroll: true })
  }
)
</script>

<style lang="scss">
.abele-canvas-frames {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 1;
}
// Obsidian's group node, carrying only its label: the frame itself is painted on the surface.
.abele-canvas-frame.canvas-node {
  position: absolute;
  pointer-events: none;
}
.abele-canvas-frame__label.canvas-group-label {
  max-width: 100%;
  &:not([contenteditable='true']) {
    display: flex;
    align-items: baseline;
  }
  transform: translate(0, -100%);
  top: calc(-1 * var(--size-4-1));
}
// A frame without a colour of its own stands on Obsidian's grey wash, not on nothing.
.abele-canvas-frame:not(.is-themed) .abele-canvas-frame__label:not([contenteditable='true']) {
  background-color: var(--background-modifier-hover);
}
.abele-canvas-frame__fold {
  display: inline-flex;
  vertical-align: -0.1em;
  margin-inline-end: var(--size-4-1);
  cursor: pointer;
  --icon-size: 0.9em;
}
.abele-canvas-frame__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-canvas-frame__fold,
.abele-canvas-frame__count {
  flex-shrink: 0;
}
.abele-canvas-frame__count {
  margin-inline-start: var(--size-4-2);
  font-size: 0.66em;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}
</style>
