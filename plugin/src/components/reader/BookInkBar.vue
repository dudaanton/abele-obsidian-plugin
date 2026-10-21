<template>
  <div
    class="abele-book-ink"
    role="toolbar"
    :aria-label="t('streamC.39de4731eedc9da7')"
    data-ignore-swipe="true"
  >
    <!-- The way out sits on the left, where the pen that turned drawing on was. -->
    <Icon
      icon="check"
      :tooltip="t('streamC.2f6a897afbb198e3')"
      class="abele-book-ink__done"
      @click="emit('done')"
    />
    <div class="abele-book-ink__group">
      <Icon
        v-for="tool in TOOLS"
        :key="tool.id"
        :icon="tool.icon"
        :tooltip="tool.tooltip"
        :active="ink.tool === tool.id"
        class="abele-book-ink__tool"
        @click="emit('tool', tool.id)"
      />
    </div>
    <div class="abele-book-ink__group">
      <Icon
        v-for="c in colors"
        :key="c"
        icon="circle"
        :color="c === 'black' ? undefined : c"
        :active="current === c"
        :tooltip="t('streamC.acd278bfc91387ff', { v1: streamCLabel(c) })"
        class="abele-book-ink__swatch"
        :class="{ 'abele-book-ink__swatch_ink': c === 'black' }"
        @click="emit('color', c)"
      />
      <Icon
        icon="line-squiggle"
        :tooltip="t('streamC.a14055dd728bec45', { v1: streamCLabel(ink.thickness) })"
        class="abele-book-ink__thickness"
        @click="thickness"
      />
    </div>
    <div class="abele-book-ink__group">
      <Icon
        v-if="ink.touch"
        icon="pointer"
        :active="ink.finger"
        :tooltip="ink.finger ? t('streamC.d3b08e8bb2193fc0') : t('streamC.6b28e49ffe9b8b69')"
        class="abele-book-ink__finger"
        @click="emit('finger', !ink.finger)"
      />
      <Icon
        icon="undo-2"
        :tooltip="t('streamC.a8283ade31856f71')"
        :disabled="!ink.canUndo"
        class="abele-book-ink__undo"
        @click="emit('undo')"
      />
      <Icon
        icon="redo-2"
        :tooltip="t('streamC.74273989b0966e23')"
        :disabled="!ink.canRedo"
        class="abele-book-ink__redo"
        @click="emit('redo')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { streamCLabel } from '@/i18n/streamCLabels'
import { t } from '@/i18n'

/**
 * The row under a PDF's page while drawing is on: the pen, the marker, the eraser, the tool's
 * colours and thickness, drawing with a finger (a touch screen only), undo and redo, and the way out on the
 * left, where the pen that turned drawing on sat. It takes the place of the line with the slider,
 * as the bar for selected words does, so nothing covers the page; and it is Obsidian's own mark
 * that keeps its swipes off the row.
 */
import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'
import type { InkModel, InkToolName } from '@/reader/ink/inkModel'
import { INK_COLORS, type InkColor } from '@/reader/ink/stroke'

const props = defineProps<{ ink: InkModel }>()

const emit = defineEmits<{
  (e: 'tool', tool: InkToolName): void
  (e: 'color', color: InkColor): void
  (e: 'thickness', at: { x: number; y: number }): void
  (e: 'finger', on: boolean): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'done'): void
}>()

const TOOLS: { id: InkToolName; icon: string; tooltip: string }[] = [
  { id: 'pen', icon: 'pen-line', tooltip: t('streamC.2b62e979a01b8587') },
  { id: 'marker', icon: 'highlighter', tooltip: t('streamC.13ce08699c85c1f2') },
  { id: 'eraser', icon: 'eraser', tooltip: t('streamC.84f2425d2b761cc5') },
]

/** The thickness menu, under the button that opened it. */
const thickness = (e: Event) => {
  const box = ((e.currentTarget ?? e.target) as HTMLElement | null)?.getBoundingClientRect()
  emit('thickness', { x: box?.left ?? 0, y: box?.top ?? 0 })
}

/** The marker's colours with the marker in hand, the pen's otherwise. */
const colors = computed<readonly InkColor[]>(() =>
  props.ink.tool === 'marker' ? INK_COLORS.marker : INK_COLORS.pen
)
const current = computed(() =>
  props.ink.tool === 'marker'
    ? props.ink.markerColor
    : props.ink.tool === 'pen'
      ? props.ink.penColor
      : null
)
</script>

<style lang="scss">
.abele-book-ink {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  padding: 0 var(--size-4-2);
  /* One row, as tall as the line it replaces: what does not fit a narrow screen scrolls sideways
     rather than taking a second row from the page. */
  overflow-x: auto;
  scrollbar-width: none;
  border-top: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);

  &::-webkit-scrollbar {
    display: none;
  }

  &__group {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--size-2-1);
  }

  &__swatch svg {
    fill: currentColor;
  }

  /* The pen's black is the text's colour, pressed or not: a pressed glyph otherwise takes the
     accent, and black would read as purple. */
  &__swatch_ink.abele-obsidian-icon {
    color: var(--text-normal);
  }
}

/* The sheet over a PDF's pages while drawing is on: it takes every touch, so neither the page nor
   Obsidian hears one, and the browser neither scrolls, nor selects, nor shows its magnifier. */
.abele-book-reader__stage {
  position: relative;
}

.abele-ink-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: crosshair;
}

.abele-ink-overlay__canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* Pages drawn dark have their ink turned with them; the stroke being drawn turns the same way. */
.abele-ink-overlay_dark .abele-ink-overlay__canvas {
  filter: invert(1) hue-rotate(180deg);
}
</style>
