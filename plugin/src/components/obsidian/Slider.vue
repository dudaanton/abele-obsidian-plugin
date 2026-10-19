<template>
  <input
    ref="el"
    class="slider abele-slider"
    type="range"
    :data-ignore-swipe="thumbDragOnly ? undefined : 'true'"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    :disabled="disabled"
    :aria-label="label"
    @input="onInput"
    @change="emit('update:model-value', Number(($event.target as HTMLInputElement).value))"
    @touchstart="touchStart"
    @touchmove="touchMove"
    @touchend="touchEnd"
    @touchcancel="touchCancel"
  />
</template>

<script setup lang="ts">
/**
 * A slider, in Obsidian's own `slider` class so the track and thumb are the theme's. `input`
 * follows the thumb while it is dragged; the model changes when it is let go. On a phone the
 * drag is its own: `data-ignore-swipe` is what Obsidian's own sliders carry so that its swipe
 * for the side panels leaves them alone — without it, dragging the thumb opened a side panel.
 */
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import './designKit.css'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number | 'any'
    disabled?: boolean
    /** What the slider sets, for the tooltip and for a screen reader. */
    label?: string
    /** Leave track swipes to the host; only a touch starting on the thumb drags it. */
    thumbDragOnly?: boolean
  }>(),
  { min: 0, max: 100, step: 1, disabled: false, label: undefined, thumbDragOnly: false }
)

const emit = defineEmits<{
  (e: 'update:model-value', value: number): void
  (e: 'input', value: number): void
}>()

const el = ref<HTMLInputElement>()

let trackTouch: { x: number; y: number; moved: boolean } | null = null

const track = () => {
  const input = el.value
  const box = input.getBoundingClientRect()
  const thumb = parseFloat(getComputedStyle(input).getPropertyValue('--slider-thumb-width')) || 18
  return { left: box.left + thumb / 2, width: Math.max(1, box.width - thumb), thumb }
}

const touchStart = (event: TouchEvent) => {
  if (!props.thumbDragOnly || props.disabled) return
  trackTouch = null
  const point = event.touches[0]
  if (!point || event.touches.length !== 1) return
  const { left, width, thumb } = track()
  const ratio = (Number(el.value.value) - props.min) / (props.max - props.min || 1)
  if (Math.abs(point.clientX - (left + ratio * width)) <= thumb / 2) {
    // Set synchronously: Obsidian reads this as touchstart bubbles to its gesture handler.
    el.value.setAttribute('data-ignore-swipe', 'true')
  } else {
    // Cancel the native range drag, while letting the host receive the entire gesture.
    event.preventDefault()
    trackTouch = { x: point.clientX, y: point.clientY, moved: false }
  }
}

const touchMove = (event: TouchEvent) => {
  if (!trackTouch) return
  const point = event.touches[0]
  if (
    event.touches.length !== 1 ||
    !point ||
    Math.hypot(point.clientX - trackTouch.x, point.clientY - trackTouch.y) > 8
  )
    trackTouch.moved = true
}

const touchCancel = () => {
  trackTouch = null
  if (props.thumbDragOnly) el.value?.removeAttribute('data-ignore-swipe')
}

const touchEnd = () => {
  const tap = trackTouch
  touchCancel()
  if (!tap || tap.moved) return
  const { left, width } = track()
  // Let the native range enforce its step and bounds for a stationary track tap.
  el.value.value = String(
    props.min + Math.min(1, Math.max(0, (tap.x - left) / width)) * (props.max - props.min)
  )
  const value = Number(el.value.value)
  fill(value)
  emit('input', value)
  emit('update:model-value', value)
}

/** Obsidian's slider draws its filled part from this ratio, which its own component keeps set. */
const fill = (value: number) => {
  const span = props.max - props.min
  const ratio = span > 0 ? (value - props.min) / span : 0
  el.value?.style.setProperty('--slider-fill-ratio', String(Math.min(1, Math.max(0, ratio))))
}

const onInput = (e: Event) => {
  const value = Number((e.target as HTMLInputElement).value)
  fill(value)
  emit('input', value)
}

onMounted(() => {
  if (el.value && props.label) setTooltip(el.value, props.label)
  fill(props.modelValue)
})
watch(
  () => [props.modelValue, props.min, props.max],
  () => fill(props.modelValue)
)
watch(
  () => props.label,
  (label) => {
    if (el.value && label) setTooltip(el.value, label)
  }
)
</script>

<style lang="scss">
.abele-slider {
  width: 100%;
  min-width: 0;
}
body.is-phone input.abele-slider {
  // Extend the hit box around the native track, not the track/gradient or thumb itself.
  box-sizing: content-box;
  border-block: calc((var(--abele-touch-min) - var(--slider-track-height)) / 2) solid transparent;
  background-clip: padding-box;
  border-radius: calc(var(--slider-track-height) / 2) / calc(var(--abele-touch-min) / 2);
}
</style>
