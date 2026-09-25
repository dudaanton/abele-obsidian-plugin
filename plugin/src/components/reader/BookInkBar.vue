<template>
  <div class="abele-book-ink" role="toolbar" aria-label="Drawing" data-ignore-swipe="true">
    <div class="abele-book-ink__group">
      <Icon
        v-for="t in TOOLS"
        :key="t.id"
        :icon="t.icon"
        :tooltip="t.tooltip"
        :active="ink.tool === t.id"
        class="abele-book-ink__tool"
        @click="emit('tool', t.id)"
      />
    </div>
    <div class="abele-book-ink__group">
      <Icon
        v-for="c in colors"
        :key="c"
        icon="circle"
        :color="c === 'black' ? undefined : c"
        :active="current === c"
        :tooltip="`Draw in ${c}`"
        class="abele-book-ink__swatch"
        @click="emit('color', c)"
      />
    </div>
    <div class="abele-book-ink__group">
      <Icon
        v-if="ink.touch"
        icon="pointer"
        :active="ink.finger"
        :tooltip="
          ink.finger ? 'A finger draws: tap to let it move the pages' : 'Draw with a finger too'
        "
        class="abele-book-ink__finger"
        @click="emit('finger', !ink.finger)"
      />
      <Icon
        icon="undo-2"
        tooltip="Undo"
        :disabled="!ink.canUndo"
        class="abele-book-ink__undo"
        @click="emit('undo')"
      />
      <Icon
        icon="redo-2"
        tooltip="Redo"
        :disabled="!ink.canRedo"
        class="abele-book-ink__redo"
        @click="emit('redo')"
      />
      <Icon
        icon="check"
        tooltip="Stop drawing"
        class="abele-book-ink__done"
        @click="emit('done')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The row under a PDF's page while drawing is on: the pen, the marker, the eraser, the tool's
 * colours, drawing with a finger (a touch screen only), undo, redo and the way out. It takes the
 * place of the line with the slider, as the bar for selected words does, so nothing covers the
 * page; and it is Obsidian's own mark that keeps its swipes off the row.
 */
import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'
import type { InkModel, InkToolName } from '@/reader/ink/inkModel'
import { INK_COLORS, type InkColor } from '@/reader/ink/stroke'

const props = defineProps<{ ink: InkModel }>()

const emit = defineEmits<{
  (e: 'tool', tool: InkToolName): void
  (e: 'color', color: InkColor): void
  (e: 'finger', on: boolean): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'done'): void
}>()

const TOOLS: { id: InkToolName; icon: string; tooltip: string }[] = [
  { id: 'pen', icon: 'pen-line', tooltip: 'Pen: the harder it presses, the wider the line' },
  { id: 'marker', icon: 'highlighter', tooltip: 'Marker' },
  { id: 'eraser', icon: 'eraser', tooltip: 'Eraser: takes away the whole stroke it touches' },
]

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

  /* Dots, narrower than the glyphs beside them, as in the bar for selected words. */
  &__swatch.abele-obsidian-icon {
    padding-inline: var(--size-2-1);
  }

  &__swatch svg {
    fill: currentColor;
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
