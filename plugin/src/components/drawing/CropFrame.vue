<template>
  <!-- Over the picture's own box: the rest of the picture dimmed, the frame clear, its corners and
       sides to drag with a finger's room around each, thirds while it moves. -->
  <div
    class="abele-crop-frame"
    :class="{ 'is-dragging': held !== null }"
    data-ignore-swipe="true"
    @contextmenu.prevent
  >
    <div class="abele-crop-frame__shade" :style="frameStyle" aria-hidden="true" />
    <div
      ref="frame"
      class="abele-crop-frame__frame"
      :style="frameStyle"
      tabindex="0"
      role="group"
      aria-label="Crop frame: drag it or its corners, or move it with the arrow keys"
      @pointerdown="hold('move', $event)"
      @keydown="nudge"
    >
      <div class="abele-crop-frame__thirds" aria-hidden="true" />
      <div
        v-for="h in HANDLES"
        :key="h"
        class="abele-crop-frame__handle"
        :class="`abele-crop-frame__handle_${h}`"
        aria-hidden="true"
        @pointerdown.stop="hold(h, $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The frame a picture is cropped to, over the picture as it is shown. Corners resize from the
 * opposite corner, sides from the opposite side, the inside moves it; a kept shape holds while any
 * of them is dragged. The picture's long press does nothing here, so the handles win on a phone.
 */
import { computed, ref } from 'vue'
import { dragRect, type CropHandle, type CropRect } from '@/drawing/crop'

const props = defineProps<{
  rect: CropRect
  /** The frame's width over its height in pixels, or null for any shape. */
  ratio: number | null
  /** The shown picture's width over its height. */
  picture: number
}>()
const emit = defineEmits<{ 'update:rect': [rect: CropRect] }>()

const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const frame = ref<HTMLElement | null>(null)
const held = ref<CropHandle | null>(null)

const pct = (v: number) => `${(v * 100).toFixed(4)}%`
const frameStyle = computed(() => ({
  left: pct(props.rect.x),
  top: pct(props.rect.y),
  width: pct(props.rect.w),
  height: pct(props.rect.h),
}))

function hold(handle: CropHandle, e: PointerEvent) {
  const box = frame.value?.parentElement?.getBoundingClientRect()
  if (!box || !box.width || !box.height || e.button > 0) return
  e.preventDefault()
  const start = { ...props.rect }
  const from = { x: e.clientX, y: e.clientY }
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture?.(e.pointerId)
  held.value = handle
  const move = (m: PointerEvent) =>
    emit(
      'update:rect',
      dragRect(
        start,
        handle,
        (m.clientX - from.x) / box.width,
        (m.clientY - from.y) / box.height,
        props.ratio,
        props.picture
      )
    )
  const drop = () => {
    held.value = null
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', drop)
    target.removeEventListener('pointercancel', drop)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', drop)
  target.addEventListener('pointercancel', drop)
}

// Arrows move the frame by a hundredth; with Shift they move its far corner, so it resizes.
function nudge(e: KeyboardEvent) {
  const step = 0.01
  const d = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }[e.key]
  if (!d) return
  e.preventDefault()
  emit(
    'update:rect',
    dragRect(props.rect, e.shiftKey ? 'se' : 'move', d[0], d[1], props.ratio, props.picture)
  )
}
</script>

<style lang="scss">
.abele-crop-frame {
  // Not clipped here: the handles reach past the picture's edge for a finger, and the editor's stage
  // clips the dimming at its own edge.
  position: absolute;
  inset: 0;
  touch-action: none;
  user-select: none;
  -webkit-touch-callout: none;
}

// What falls outside is dimmed with Obsidian's picture viewer black, half through, the same in
// either theme so the kept part reads against it. A layer of its own under the frame, so the
// frame's focus ring is only its own.
.abele-crop-frame__shade {
  position: absolute;
  box-shadow: 0 0 0 100vmax color-mix(in srgb, var(--lightbox-background) 55%, transparent);
  pointer-events: none;
}

.abele-crop-frame__frame {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--text-on-accent);
  cursor: move;

  &:focus-visible {
    outline: var(--size-2-1) solid var(--background-modifier-border-focus);
    outline-offset: var(--size-2-1);
  }
}

// Thirds only while the frame moves, as a camera's grid: still, the picture is left clear.
.abele-crop-frame__thirds {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.15s ease-in-out;
  background:
    linear-gradient(
      to right,
      transparent calc(100% / 3),
      var(--text-on-accent) 0,
      var(--text-on-accent) calc(100% / 3 + 1px),
      transparent 0,
      transparent calc(200% / 3),
      var(--text-on-accent) 0,
      var(--text-on-accent) calc(200% / 3 + 1px),
      transparent 0
    ),
    linear-gradient(
      to bottom,
      transparent calc(100% / 3),
      var(--text-on-accent) 0,
      var(--text-on-accent) calc(100% / 3 + 1px),
      transparent 0,
      transparent calc(200% / 3),
      var(--text-on-accent) 0,
      var(--text-on-accent) calc(200% / 3 + 1px),
      transparent 0
    );

  .is-dragging & {
    opacity: 0.6;
  }
}

// A handle is the finger's size; what is drawn of it is a short thick stroke on the frame: an L
// at a corner, a bar on a side.
.abele-crop-frame__handle {
  --abele-crop-reach: var(--abele-touch-min, var(--touch-size-s));
  --abele-crop-arm: var(--size-4-5);
  --abele-crop-weight: var(--size-2-2);
  position: absolute;
  width: var(--abele-crop-reach);
  height: var(--abele-crop-reach);
  margin: calc(var(--abele-crop-reach) / -2);

  &::before {
    content: '';
    position: absolute;
    border: 0 solid var(--text-on-accent);
    // A faint edge of the viewer's black, so a white corner still reads over a white sky.
    filter: drop-shadow(0 0 1px color-mix(in srgb, var(--lightbox-background) 60%, transparent));
  }

  &_nw,
  &_ne,
  &_se,
  &_sw {
    &::before {
      width: var(--abele-crop-arm);
      height: var(--abele-crop-arm);
    }
  }
  &_nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
    &::before {
      top: calc(50% - var(--abele-crop-weight));
      left: calc(50% - var(--abele-crop-weight));
      border-top-width: var(--abele-crop-weight);
      border-left-width: var(--abele-crop-weight);
    }
  }
  &_ne {
    top: 0;
    left: 100%;
    cursor: nesw-resize;
    &::before {
      top: calc(50% - var(--abele-crop-weight));
      right: calc(50% - var(--abele-crop-weight));
      border-top-width: var(--abele-crop-weight);
      border-right-width: var(--abele-crop-weight);
    }
  }
  &_se {
    top: 100%;
    left: 100%;
    cursor: nwse-resize;
    &::before {
      bottom: calc(50% - var(--abele-crop-weight));
      right: calc(50% - var(--abele-crop-weight));
      border-bottom-width: var(--abele-crop-weight);
      border-right-width: var(--abele-crop-weight);
    }
  }
  &_sw {
    top: 100%;
    left: 0;
    cursor: nesw-resize;
    &::before {
      bottom: calc(50% - var(--abele-crop-weight));
      left: calc(50% - var(--abele-crop-weight));
      border-bottom-width: var(--abele-crop-weight);
      border-left-width: var(--abele-crop-weight);
    }
  }

  &_n,
  &_s {
    left: 50%;
    cursor: ns-resize;
    &::before {
      left: calc(50% - var(--abele-crop-arm) / 2);
      width: var(--abele-crop-arm);
      border-top-width: var(--abele-crop-weight);
    }
  }
  &_n {
    top: 0;
    &::before {
      top: calc(50% - var(--abele-crop-weight));
    }
  }
  &_s {
    top: 100%;
    &::before {
      top: 50%;
    }
  }

  &_e,
  &_w {
    top: 50%;
    cursor: ew-resize;
    &::before {
      top: calc(50% - var(--abele-crop-arm) / 2);
      height: var(--abele-crop-arm);
      border-left-width: var(--abele-crop-weight);
    }
  }
  &_w {
    left: 0;
    &::before {
      left: calc(50% - var(--abele-crop-weight));
    }
  }
  &_e {
    left: 100%;
    &::before {
      left: 50%;
    }
  }
}
</style>
