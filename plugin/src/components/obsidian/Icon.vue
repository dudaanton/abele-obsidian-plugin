<template>
  <component
    :is="isInteractive ? 'button' : 'span'"
    ref="el"
    class="abele-obsidian-icon"
    :type="isInteractive ? 'button' : undefined"
    :disabled="isInteractive ? disabled : undefined"
    :aria-label="isInteractive ? accessibleName : undefined"
    :aria-hidden="!isInteractive ? true : undefined"
    :aria-pressed="isInteractive ? active : undefined"
    :class="{
      'clickable-icon': isInteractive,
      'abele-obsidian-icon_with-bg': withBg,
      'abele-obsidian-icon_no-hover': noHover,
      'abele-obsidian-icon_disabled': disabled,
      'abele-obsidian-icon_active': active,
      [`abele-obsidian-icon_color-${color}`]: color && color !== 'grey',
    }"
    @click="isInteractive && !disabled && emit('click', $event)"
  >
    <span v-if="textLeft" class="abele-obsidian-icon__text">{{ textLeft }}</span>
    <span v-if="icon" ref="iconEl" class="abele-obsidian-icon__icon" aria-hidden="true" />
    <span v-if="textRight" class="abele-obsidian-icon__text">{{ textRight }}</span>
  </component>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, ref, onMounted, watch } from 'vue'
import { setIcon, setTooltip } from 'obsidian'
import type { KitColor } from '@/constants/colors'
import './designKit.css'

const props = withDefaults(
  defineProps<{
    icon?: string
    textLeft?: string
    textRight?: string
    tooltip?: string
    /** Explicit mode; omitted preserves existing callers with a click listener. */
    interactive?: boolean
    label?: string
    disabledReason?: string
    withBg?: boolean
    noHover?: boolean
    disabled?: boolean
    /** Tints the glyph with a theme colour by name, for an icon that carries meaning in colour. */
    color?: KitColor
    /** A toggle's state: on draws it pressed, as Obsidian draws its own search options. */
    active?: boolean
  }>(),
  // Left unset, an icon is not a toggle at all, rather than a toggle that is off.
  {
    icon: undefined,
    textLeft: undefined,
    textRight: undefined,
    tooltip: undefined,
    color: undefined,
    active: undefined,
    interactive: undefined,
  }
)

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const instance = getCurrentInstance()
const isInteractive = computed(
  () => props.interactive ?? (!!instance?.vnode.props?.onClick || props.active !== undefined)
)
const accessibleName = computed(() => {
  const label = props.label ?? props.tooltip ?? props.textLeft ?? props.textRight ?? ''
  return props.disabled && props.disabledReason ? `${label}: ${props.disabledReason}` : label
})
const el = ref<HTMLElement>()
const iconEl = ref<HTMLElement>()

// Obsidian's own tooltip rather than the browser's `title`: it is styled with the theme and
// appears without the second-long delay a native tooltip has.
const updateTooltip = () => {
  if (el.value) setTooltip(el.value, accessibleName.value || props.tooltip || '')
}

const updateIcon = () => {
  if (iconEl.value) {
    iconEl.value.empty()
    if (props.icon) {
      setIcon(iconEl.value, props.icon)
    }
  }
}

onMounted(() => {
  updateIcon()
  updateTooltip()
})
watch(() => props.icon, updateIcon)
watch(accessibleName, updateTooltip)
</script>

<style lang="scss">
.abele-obsidian-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--icon-size);
  color: var(--icon-color);
  padding: var(--size-2-1) var(--size-2-2);
  border-radius: var(--radius-s);

  &_disabled {
    color: var(--text-faint);
    cursor: default;
  }

  &_with-bg {
    background-color: var(--background-secondary);
  }

  &_active {
    color: var(--text-accent);
    background-color: var(--background-modifier-active-hover);
  }
  &:not(.abele-obsidian-icon_disabled):not(.abele-obsidian-icon_no-hover) {
    cursor: var(--cursor-link);
  }
  // Only where there is a pointer to hover with, as Obsidian's `.clickable-icon` does: a phone
  // keeps `:hover` on whatever was tapped last, so the highlight stayed behind after a tap.
  @media (hover: hover) {
    &:not(.abele-obsidian-icon_disabled):not(.abele-obsidian-icon_no-hover):hover {
      color: var(--icon-color-hover);
      background-color: var(--background-modifier-hover);
    }
  }
}

@each $name in 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink' {
  .abele-obsidian-icon.abele-obsidian-icon_color-#{$name} {
    color: var(--color-#{$name});
  }
}

.abele-obsidian-icon__icon {
  display: flex;
  align-items: center;
  height: var(--icon-size);
}

.abele-obsidian-icon__text {
  user-select: none;
  font-size: var(--font-ui-smaller);

  &:first-child {
    margin-right: var(--size-2-2);
  }

  &:last-child {
    margin-left: var(--size-2-2);
  }
}
</style>
