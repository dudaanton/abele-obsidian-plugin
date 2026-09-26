<template>
  <div class="abele-drawing-bar" role="toolbar" aria-label="Drawing" data-ignore-swipe="true">
    <!-- The first button turns drawing on, and in the same place turns it off again. -->
    <Icon
      :icon="model.on ? 'check' : 'pen-line'"
      :tooltip="model.on ? 'Stop drawing' : 'Draw: the pen, the marker and the eraser'"
      class="abele-drawing-bar__mode"
      @click="emit('toggle')"
    />
    <template v-if="model.on">
      <div class="abele-drawing-bar__group">
        <Icon
          v-for="t in TOOLS"
          :key="t.id"
          :icon="t.icon"
          :tooltip="t.tooltip"
          :active="model.tool === t.id"
          class="abele-drawing-bar__tool"
          :class="`abele-drawing-bar__tool_${t.id}`"
          @click="emit('tool', t.id)"
        />
      </div>
      <div class="abele-drawing-bar__group">
        <Icon
          v-for="c in colors"
          :key="c"
          icon="circle"
          :color="c === 'black' ? undefined : c"
          :active="current === c"
          :tooltip="`Draw in ${c}`"
          class="abele-drawing-bar__swatch"
          :class="{ 'abele-drawing-bar__swatch_ink': c === 'black' }"
          @click="emit('color', c)"
        />
        <Icon
          icon="line-squiggle"
          :tooltip="`Thickness: ${model.thickness}`"
          class="abele-drawing-bar__thickness"
          @click="emit('thickness', $event)"
        />
      </div>
      <div class="abele-drawing-bar__group">
        <Icon
          v-if="model.touch"
          icon="pointer"
          :active="model.finger"
          :tooltip="
            model.finger
              ? 'A finger draws: tap to let it move the drawing'
              : 'Draw with a finger too'
          "
          class="abele-drawing-bar__finger"
          @click="emit('finger', !model.finger)"
        />
        <Icon
          icon="undo-2"
          tooltip="Undo"
          :disabled="!model.canUndo"
          class="abele-drawing-bar__undo"
          @click="emit('undo')"
        />
        <Icon
          icon="redo-2"
          tooltip="Redo"
          :disabled="!model.canRedo"
          class="abele-drawing-bar__redo"
          @click="emit('redo')"
        />
      </div>
    </template>
    <div class="abele-drawing-bar__end">
      <Icon
        :text-right="zoomText"
        icon="zoom-in"
        tooltip="Zoom: 100%, the whole drawing, in or out"
        class="abele-drawing-bar__zoom"
        @click="emit('zoom', $event)"
      />
      <Icon
        icon="more-horizontal"
        tooltip="More: export, embed in a note"
        class="abele-drawing-bar__more"
        @click="emit('more', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The row over a drawing: the button that turns drawing on and off — first, in one place either
 * way — then, while drawing, the tools, the colours and thickness, drawing with a finger (a touch
 * screen only), undo and redo; and always the zoom and a menu of what else can be done with the
 * drawing. On a narrow screen the row wraps rather than hiding tools off its edge.
 */
import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'
import type { DrawingModel, DrawingTool } from '@/drawing/model'
import { INK_COLORS, type InkColor } from '@/reader/ink/stroke'

const props = defineProps<{ model: DrawingModel }>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'tool', tool: DrawingTool): void
  (e: 'color', color: InkColor): void
  (e: 'thickness', event: MouseEvent): void
  (e: 'finger', on: boolean): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'zoom', event: MouseEvent): void
  (e: 'more', event: MouseEvent): void
}>()

const TOOLS: { id: DrawingTool; icon: string; tooltip: string }[] = [
  { id: 'pen', icon: 'pen-line', tooltip: 'Pen: the harder it presses, the wider the line' },
  { id: 'marker', icon: 'highlighter', tooltip: 'Marker' },
  { id: 'eraser', icon: 'eraser', tooltip: 'Eraser: takes away the whole stroke it touches' },
]

const colors = computed<readonly InkColor[]>(() =>
  props.model.tool === 'marker' ? INK_COLORS.marker : INK_COLORS.pen
)
const current = computed(() =>
  props.model.tool === 'marker'
    ? props.model.markerColor
    : props.model.tool === 'pen'
      ? props.model.penColor
      : null
)
const zoomText = computed(() => `${Math.round(props.model.zoom * 100)}%`)
</script>

<style lang="scss">
.abele-drawing-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-1) var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  border-bottom: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);

  &__group {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--size-2-1);
  }

  &__end {
    display: flex;
    align-items: center;
    gap: var(--size-2-1);
    margin-left: auto;
  }

  /* Dots, narrower than the glyphs beside them. */
  &__swatch.abele-obsidian-icon {
    padding-inline: var(--size-2-1);
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

.abele-drawing-view {
  display: flex;
  flex-direction: column;
  padding: 0 !important;
  overflow: hidden;
}

.abele-drawing-view__stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

/* The drawing's own surface, its paper painted on its canvas (`renderer.ts`): it takes every touch,
   so neither Obsidian nor the browser hears one. */
.abele-drawing-surface {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: grab;

  &_drawing {
    cursor: crosshair;
  }
}

.abele-drawing-surface__canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
