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
        :aria-label="colourNames[color]"
        :aria-checked="modelValue === color"
        :disabled="disabled || busy"
        :tabindex="color === modelValue || (!colors.includes(modelValue) && index === 0) ? 0 : -1"
        @click="choose(color)"
        @keydown="onKey($event, index)"
      >
        <span class="abele-swatch-picker__swatch" aria-hidden="true"
          ><Icon
            v-if="color === 'grey'"
            class="abele-swatch-picker__clear"
            icon="ban"
            no-hover /><Icon v-else-if="modelValue === color" icon="check" no-hover
        /></span>
      </button>
    </div>
    <Icon
      v-if="underline !== undefined"
      class="abele-swatch-picker__underline"
      :class="{ 'is-active': underline, 'abele-obsidian-icon_active': underline }"
      icon="underline"
      :text-right="underline ? t('kit.underlineOn') : t('kit.underlineOff')"
      :tooltip="t('kit.underline')"
      role="checkbox"
      :aria-checked="underline"
      :disabled="disabled || busy"
      :disabled-reason="busy ? t('kit.savingColour') : t('kit.selectionMissing')"
      @click="emit('update:underline', !underline)"
    />
    <span v-if="!busy" class="setting-item-description">{{
      modelValue === 'grey' ? t('kit.noColour') : colourNames[modelValue]
    }}</span>
    <span v-if="busy" role="status">{{
      t('kit.savingNamedColour', { colour: colourNames[modelValue] })
    }}</span>
    <span v-else-if="disabled" class="setting-item-description">{{
      disabledReason || t('kit.colourDisabled')
    }}</span>
  </div>
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import { KIT_COLORS, type KitColor } from '@/constants/colors'
import Icon from './Icon.vue'
const colourNames = {
  grey: t('kit.colour.grey'),
  red: t('kit.colour.red'),
  orange: t('kit.colour.orange'),
  yellow: t('kit.colour.yellow'),
  green: t('kit.colour.green'),
  cyan: t('kit.colour.cyan'),
  blue: t('kit.colour.blue'),
  purple: t('kit.colour.purple'),
  pink: t('kit.colour.pink'),
}
const props = withDefaults(
  defineProps<{
    modelValue: KitColor
    label: string
    colors?: KitColor[]
    disabled?: boolean
    busy?: boolean
    underline?: boolean
    disabledReason?: string
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
.abele-swatch-picker {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-1);
}
.abele-swatch-picker__group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
}
.abele-swatch-picker__choice,
body.is-phone .abele-swatch-picker__choice,
body.is-phone .modal .abele-swatch-picker .abele-swatch-picker__choice {
  padding: var(--size-4-1);
}
body.is-phone .modal .abele-swatch-picker .abele-swatch-picker__underline {
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
.abele-swatch-picker__choice[aria-checked='true'] {
  background: var(--background-modifier-active-hover);
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
@each $color in 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink' {
  .abele-swatch-picker__choice_#{$color} .abele-swatch-picker__swatch {
    background: var(--color-#{$color});
  }
}
</style>
