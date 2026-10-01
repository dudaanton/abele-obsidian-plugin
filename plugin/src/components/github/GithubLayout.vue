<template>
  <div
    ref="layout"
    class="abele-github-layout"
    :class="{ 'abele-github-layout_panel': panel }"
    :style="{ '--abele-tree-width': width === null ? '18em' : `${width}px` }"
  >
    <template v-if="panel">
      <!-- Over the content, on a narrow screen: a tap beside the drawer closes it. -->
      <div class="abele-github-layout__backdrop" @click="emit('dismiss')" />
      <div class="abele-github-layout__panel">
        <slot name="panel" />
        <hr
          class="workspace-leaf-resize-handle abele-github-layout__resize"
          :class="{ 'is-active': drag !== null }"
          role="separator"
          aria-label="File tree width"
          aria-orientation="vertical"
          :aria-valuemin="Math.round(min)"
          :aria-valuemax="Math.round(max)"
          :aria-valuenow="Math.round(current)"
          :tabindex="narrow ? -1 : 0"
          @pointerdown="start"
          @pointermove="move"
          @pointerup="finish"
          @pointercancel="finish"
          @lostpointercapture="finish"
          @dblclick.prevent="reset"
          @keydown="resizeKey"
        />
      </div>
    </template>
    <div class="abele-github-layout__main">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A GitHub tab's frame: the content, and — while it is open — the file tree panel beside it on a
 * wide screen, or over it as a drawer on a narrow one. Each part scrolls on its own.
 */
import { computed, ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { GlobalStore } from '@/stores/GlobalStore'
import { WIDTH_KEY } from '@/github/tree/panel'

defineProps<{
  /** Show the panel. */
  panel: boolean
}>()

const emit = defineEmits<{
  /** The backdrop beside the drawer was tapped. */
  (e: 'dismiss'): void
}>()

const app = GlobalStore.getInstance().app
const stored: unknown = app.loadLocalStorage(WIDTH_KEY)
const width = ref<number | null>(
  typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : null
)
const layout = ref<HTMLElement>()
const available = ref(0)
const em = ref(14)
const narrow = computed(() => available.value <= 640)
const max = computed(() => Math.min(available.value * 0.4, em.value * 36))
const min = computed(() => Math.min(em.value * 12, max.value))
const clamp = (value: number) => Math.max(min.value, Math.min(max.value, value))
const current = computed(() => clamp(width.value ?? em.value * 18))
const drag = ref<{ id: number; x: number; width: number; direction: number } | null>(null)

useResizeObserver(layout, ([entry]) => {
  available.value = entry.contentRect.width
  em.value = parseFloat(getComputedStyle(entry.target).fontSize) || 14
})

function start(event: PointerEvent): void {
  if (narrow.value || event.button !== 0 || drag.value) return
  const handle = event.currentTarget as HTMLElement
  drag.value = {
    id: event.pointerId,
    x: event.clientX,
    width: current.value,
    direction: getComputedStyle(handle).direction === 'rtl' ? -1 : 1,
  }
  handle.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function move(event: PointerEvent): void {
  const from = drag.value
  if (!from || from.id !== event.pointerId || narrow.value) return
  width.value = clamp(from.width + (event.clientX - from.x) * from.direction)
}

function finish(event: PointerEvent): void {
  if (!drag.value || drag.value.id !== event.pointerId) return
  drag.value = null
  app.saveLocalStorage(WIDTH_KEY, width.value)
  const handle = event.currentTarget as HTMLElement
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
}

function reset(): void {
  if (narrow.value) return
  width.value = null
  app.saveLocalStorage(WIDTH_KEY, null)
}

function resizeKey(event: KeyboardEvent): void {
  if (narrow.value) return
  const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl'
  const step = (event.shiftKey ? 5 : 1) * em.value
  if (event.key === 'ArrowLeft') width.value = clamp(current.value + (rtl ? step : -step))
  else if (event.key === 'ArrowRight') width.value = clamp(current.value + (rtl ? -step : step))
  else if (event.key === 'Home') width.value = min.value
  else if (event.key === 'End') width.value = max.value
  else if (event.key === 'Enter') reset()
  else return
  event.preventDefault()
  app.saveLocalStorage(WIDTH_KEY, width.value)
}
</script>

<style lang="scss">
// Two columns, each scrolling on its own: the file tree panel when it is open, and the content.
// The tab's own box no longer scrolls, the way Obsidian's own views with a side part do it; the
// padding it had moves to the content.
.workspace-leaf-content .view-content.abele-github-view {
  padding: 0;
  overflow: hidden;
}

.abele-github-view__mount {
  height: 100%;
}

.abele-github-layout {
  position: relative;
  display: flex;
  height: 100%;
  container-type: inline-size;

  &__main {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding: var(--size-4-3) var(--size-4-3) max(var(--safe-area-inset-bottom), var(--size-4-8));
  }

  &__panel {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    width: var(--abele-tree-width);
    min-width: 12em;
    max-width: min(40%, 36em);
    border-inline-end: 1px solid var(--background-modifier-border);
  }

  // Obsidian's divider supplies its colours and active state. Only the split geometry differs
  // here: this is inside a view, not one of the workspace's own mod-vertical splits.
  &.abele-github-layout_panel
    > &__panel
    > .workspace-leaf-resize-handle.abele-github-layout__resize {
    display: block;
    inset-block: 0;
    inset-inline-end: 0;
    width: var(--divider-width-hover);
    height: 100%;
    border-inline-end: var(--divider-width) solid var(--divider-color);
    cursor: col-resize;

    &:hover,
    &:focus-visible {
      border-color: var(--divider-color-hover);
    }

    &.is-active {
      border-color: var(--color-accent);
    }
  }

  &__backdrop {
    display: none;
  }
}

// Too narrow to share — a phone, a split pane: the panel is a drawer over the content, which keeps
// its whole width, and a tap beside the drawer closes it.
@container (max-width: 640px) {
  .abele-github-layout__panel {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 2;
    width: min(85%, 22em);
    min-width: 0;
    max-width: none;
    box-shadow: var(--shadow-l);
  }

  .abele-github-layout.abele-github-layout_panel
    > .abele-github-layout__panel
    > .workspace-leaf-resize-handle.abele-github-layout__resize {
    display: none;
  }

  .abele-github-layout__backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1;
    background-color: var(--background-modifier-cover);
  }
}
</style>
