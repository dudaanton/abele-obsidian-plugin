<template>
  <ObsidianModal :title="title" size="full" @close="emit('close')">
    <div
      ref="frame"
      class="abele-book-figure"
      :class="{ 'abele-book-figure_dragging': dragging }"
      data-ignore-swipe="true"
      tabindex="0"
      role="figure"
      :aria-label="t('streamC.bbccfe383a0709c0', { v1: String(title) })"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="onDoubleClick"
      @keydown="onKey"
    >
      <div
        class="abele-book-figure__canvas"
        :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }"
      >
        <img
          v-if="figure.kind === 'image'"
          class="abele-book-figure__image"
          :src="figure.src"
          :alt="figure.alt"
          :width="figure.width"
          :height="figure.height"
          draggable="false"
        />
        <iframe
          v-else
          class="abele-book-figure__table"
          :srcdoc="figure.html"
          sandbox="allow-same-origin"
          :width="figure.width + 16"
          :height="figure.height + 16"
          tabindex="-1"
          :title="t('streamC.16d1c9050a0b32e8')"
        />
      </div>
      <div class="abele-book-figure__controls" data-viewer-controls>
        <Icon icon="zoom-out" :tooltip="t('streamC.bc7b631a689b45ca')" @click="zoom(1 / 1.4)" />
        <Icon icon="scan" :tooltip="t('streamC.7617b23f02abab5f')" @click="fit" />
        <Icon icon="zoom-in" :tooltip="t('streamC.0e47f09a748fa132')" @click="zoom(1.4)" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/** A book figure in the shared shell and pointer viewer; tables remain inert. */
import { computed, ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Icon from '../obsidian/Icon.vue'
import type { BookFigure } from '@/reader/figures'
import { useViewerPanZoom } from '@/composables/useViewerPanZoom'
const props = defineProps<{ figure: BookFigure }>()
const emit = defineEmits<{ close: [] }>()
const title = computed(() =>
  props.figure.kind === 'table'
    ? t('streamC.16d1c9050a0b32e8')
    : props.figure.alt.trim() || t('streamC.9a1c54f55e7cfb1c')
)
const frame = ref<HTMLElement | null>(null)
const {
  view,
  dragging,
  fit,
  zoom,
  onWheel,
  onDoubleClick,
  onKey,
  onPointerDown,
  onPointerMove,
  onPointerUp,
} = useViewerPanZoom(
  frame,
  () => ({
    width: props.figure.width + (props.figure.kind === 'table' ? 16 : 0),
    height: props.figure.height,
  }),
  { close: () => emit('close') }
)
</script>

<style lang="scss">
.abele-book-figure {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: grab;
  outline: none;
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
}
.abele-book-figure_dragging {
  cursor: grabbing;
}
.abele-book-figure__canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}
.abele-book-figure__image {
  display: block;
  max-width: none;
  background-color: white;
}
.abele-book-figure__table {
  display: block;
  border: 0;
  background-color: Canvas;
  pointer-events: none;
}
.abele-book-figure__controls {
  position: absolute;
  right: var(--size-4-2);
  bottom: var(--size-4-2);
  display: flex;
  gap: var(--size-2-1);
  padding: var(--size-2-1);
  background-color: var(--background-primary);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  cursor: default;
}
</style>
