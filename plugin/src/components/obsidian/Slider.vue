<template>
  <input
    ref="el"
    class="slider abele-slider"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    :disabled="disabled"
    :aria-label="label"
    @input="onInput"
    @change="emit('update:model-value', Number(($event.target as HTMLInputElement).value))"
  />
</template>

<script setup lang="ts">
/**
 * A slider, in Obsidian's own `slider` class so the track and thumb are the theme's. `input`
 * follows the thumb while it is dragged; the model changes when it is let go.
 */
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number | 'any'
    disabled?: boolean
    /** What the slider sets, for the tooltip and for a screen reader. */
    label?: string
  }>(),
  { min: 0, max: 100, step: 1, disabled: false, label: undefined }
)

const emit = defineEmits<{
  (e: 'update:model-value', value: number): void
  (e: 'input', value: number): void
}>()

const el = ref<HTMLInputElement>()

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
</style>
