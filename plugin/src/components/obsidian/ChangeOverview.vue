<template>
  <Teleport v-if="root" :to="root.ownerDocument.body">
    <div
      v-if="geometry"
      ref="strip"
      class="abele-change-overview"
      :style="{
        top: `${geometry.top}px`,
        left: `${geometry.left}px`,
        height: `${geometry.height}px`,
      }"
      role="scrollbar"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="t('streamB.diffOverview')"
      :aria-valuemin="1"
      :aria-valuemax="totalLines"
      :aria-valuenow="geometry.line"
      @pointerdown.prevent="start"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
      @keydown="key"
    >
      <span
        v-if="geometry.band"
        class="abele-change-overview__band"
        :style="{ top: `${geometry.band.top * 100}%`, height: `${geometry.band.height * 100}%` }"
      />
      <span
        v-for="(change, index) in changes"
        :key="index"
        :ref="(el) => tooltip(el as HTMLElement | null, change)"
        class="abele-change-overview__mark"
        :class="`abele-change-overview__mark_${change.kind}`"
        :style="{
          top: `${((change.from - 1) / totalLines) * 100}%`,
          height:
            change.kind === 'removed'
              ? 'var(--size-2-1)'
              : `max(var(--size-2-1), ${((change.to - change.from + 1) / totalLines) * 100}%)`,
        }"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { setTooltip } from 'obsidian'
import { t } from '@/i18n'
import { scrollParent } from '@/github/scrollTo'
import { overviewLine, type OverviewChange } from '../diffOverviewModel'

const props = defineProps<{ root?: HTMLElement; changes: OverviewChange[]; totalLines: number }>()
const emit = defineEmits<{ navigate: [line: number] }>()
const strip = ref<HTMLElement>()
const geometry = ref<{
  top: number
  left: number
  height: number
  line: number
  band?: { top: number; height: number }
}>()
let frame = 0
let win: Window | undefined
let dragging: number | undefined

function measure() {
  frame = 0
  const root = props.root
  if (!root) return
  const box = root.getBoundingClientRect()
  const scroll = scrollParent(root)?.getBoundingClientRect()
  const top = Math.max(box.top, scroll?.top ?? 0, 0)
  const viewportHeight = root.ownerDocument.defaultView.innerHeight
  const bottom = Math.min(box.bottom, scroll?.bottom ?? viewportHeight, viewportHeight)
  if (bottom <= top || box.width < 16 || root.closest('.mod-hidden')) {
    geometry.value = undefined
    return
  }
  const bandTop = Math.max(0, (top - box.top) / box.height)
  const bandHeight = Math.min(1 - bandTop, (bottom - top) / box.height)
  geometry.value = {
    top,
    left: box.right - 10,
    height: bottom - top,
    line: overviewLine(bandTop, props.totalLines),
    band: bandHeight < 0.999 ? { top: bandTop, height: bandHeight } : undefined,
  }
}
function schedule() {
  if (!frame && win) frame = win.requestAnimationFrame(measure)
}
function bind() {
  win?.removeEventListener('scroll', schedule, true)
  win?.removeEventListener('resize', schedule)
  if (frame) win?.cancelAnimationFrame(frame)
  frame = 0
  win = props.root?.ownerDocument.defaultView ?? undefined
  win?.addEventListener('scroll', schedule, true)
  win?.addEventListener('resize', schedule)
  measure()
}
function navigate(event: PointerEvent) {
  const box = strip.value?.getBoundingClientRect()
  if (box?.height)
    emit('navigate', overviewLine((event.clientY - box.top) / box.height, props.totalLines))
}
function start(event: PointerEvent) {
  dragging = event.pointerId
  strip.value?.setPointerCapture(event.pointerId)
  navigate(event)
}
function move(event: PointerEvent) {
  if (event.pointerId === dragging) navigate(event)
}
function finish(event: PointerEvent) {
  if (event.pointerId !== dragging) return
  if (strip.value?.hasPointerCapture(event.pointerId))
    strip.value.releasePointerCapture(event.pointerId)
  dragging = undefined
}
function key(event: KeyboardEvent) {
  const current = geometry.value?.line ?? 1
  const next =
    event.key === 'Home'
      ? 1
      : event.key === 'End'
        ? props.totalLines
        : event.key === 'ArrowDown'
          ? Math.min(props.totalLines, current + 1)
          : event.key === 'ArrowUp'
            ? Math.max(1, current - 1)
            : undefined
  if (next === undefined) return
  event.preventDefault()
  emit('navigate', next)
}
function tooltip(el: HTMLElement | null, change: OverviewChange) {
  if (!el) return
  const params = { from: change.from, to: change.to }
  const text =
    change.kind === 'added'
      ? t('streamB.diffOverviewAdded', params)
      : change.kind === 'removed'
        ? t('streamB.diffOverviewRemoved', params)
        : t('streamB.diffOverviewChanged', params)
  setTooltip(el, text, { placement: 'left' })
  el.setAttribute('aria-label', text)
}
useResizeObserver(() => props.root, schedule)
watch(() => [props.root, props.changes, props.totalLines], schedule, { flush: 'post' })
watch(() => props.root, bind, { flush: 'post' })
onMounted(bind)
onBeforeUnmount(() => {
  win?.removeEventListener('scroll', schedule, true)
  win?.removeEventListener('resize', schedule)
  if (frame) win?.cancelAnimationFrame(frame)
})
</script>

<style lang="scss">
.abele-change-overview {
  position: fixed;
  z-index: 3;
  width: var(--size-4-2);
  touch-action: none;
  cursor: pointer;
  background: var(--background-secondary);
  &::before {
    content: '';
    position: absolute;
    inset: 0 calc(-1 * var(--size-4-2));
  }
  &:focus-visible {
    outline: 1px solid var(--background-modifier-border-focus);
  }
}
.abele-change-overview__band {
  position: absolute;
  inset-inline: 0;
  background: var(--background-modifier-hover);
  border: 1px solid var(--background-modifier-border);
  pointer-events: none;
}
.abele-change-overview__mark {
  position: absolute;
  inset-inline: 1px;
  min-height: var(--size-2-1);
  background: var(--text-accent);
  &_added {
    background: var(--text-success);
  }
  &_removed {
    background: var(--text-error);
  }
}
@media (pointer: coarse) {
  .abele-change-overview::before {
    inset-inline: calc(-1 * var(--size-4-3));
  }
}
</style>
