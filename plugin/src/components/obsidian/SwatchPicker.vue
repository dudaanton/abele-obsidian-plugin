<template>
  <div class="abele-swatch-picker" :aria-busy="busy">
    <div role="radiogroup" :aria-label="label" class="abele-swatch-picker__group">
      <button
        v-for="(color, index) in colors"
        :key="color"
        type="button"
        role="radio"
        class="clickable-icon abele-swatch-picker__choice"
        :class="`abele-swatch-picker__choice_${color}`"
        :aria-label="KIT_COLOR_NAMES[color]"
        :aria-checked="modelValue === color"
        :disabled="disabled || busy"
        :tabindex="color === modelValue || (!colors.includes(modelValue) && index === 0) ? 0 : -1"
        @click="choose(color)"
        @keydown="onKey($event, index)"
      >
        <span class="abele-swatch-picker__swatch" aria-hidden="true"
          ><Icon v-if="modelValue === color" icon="check" no-hover
        /></span>
      </button>
    </div>
    <label v-if="underline !== undefined" class="abele-swatch-picker__underline"
      ><Checkbox
        :is-enabled="underline"
        :aria-disabled="disabled || busy"
        aria-label="Underline annotation"
        @toggle="!disabled && !busy && emit('update:underline', !underline)"
      />Underline</label
    >
    <span v-if="busy" role="status">Saving colour…</span>
  </div>
</template>
<script setup lang="ts">
import { KIT_COLORS, KIT_COLOR_NAMES, type KitColor } from '@/constants/colors'
import Checkbox from './Checkbox.vue'
import Icon from './Icon.vue'
const props = withDefaults(
  defineProps<{
    modelValue: KitColor
    label: string
    colors?: KitColor[]
    disabled?: boolean
    busy?: boolean
    underline?: boolean
  }>(),
  { colors: () => [...KIT_COLORS], underline: undefined }
)
const emit = defineEmits<{
  'update:modelValue': [color: KitColor]
  'update:underline': [value: boolean]
}>()
const choose = (color: KitColor) => {
  if (!props.disabled && !props.busy) emit('update:modelValue', color)
}
const onKey = (event: KeyboardEvent, index: number) => {
  if (props.disabled || props.busy) return
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.colors.length - 1
        : (index +
            (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
            props.colors.length) %
          props.colors.length
  choose(props.colors[next])
  const target = event.currentTarget as HTMLElement
  ;(target.parentElement?.children[next] as HTMLElement)?.focus()
}
</script>
<style lang="scss">
.abele-swatch-picker__group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
}
.abele-swatch-picker__choice {
  padding: var(--size-4-1);
}
.abele-swatch-picker__swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-4-6);
  height: var(--size-4-6);
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}
.abele-swatch-picker__choice[aria-checked='true'] .abele-swatch-picker__swatch {
  outline: var(--size-2-1) solid var(--text-normal);
  outline-offset: var(--size-2-1);
}
.abele-swatch-picker__swatch .abele-obsidian-icon {
  color: var(--text-normal);
}
.abele-swatch-picker__underline {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-top: var(--size-4-2);
}
@each $color in red, orange, yellow, green, cyan, blue, purple, pink {
  .abele-swatch-picker__choice_#{$color} .abele-swatch-picker__swatch {
    background: var(--color-#{$color});
  }
}
</style>
