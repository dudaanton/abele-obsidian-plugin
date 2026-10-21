<template>
  <component
    :is="isInteractive ? 'button' : 'span'"
    ref="el"
    class="abele-obsidian-icon"
    :type="isInteractive ? 'button' : undefined"
    :disabled="isInteractive ? disabled : undefined"
    :aria-disabled="isInteractive && disabled ? 'true' : undefined"
    :aria-label="isInteractive ? accessibleName : undefined"
    :aria-hidden="!isInteractive ? true : undefined"
    :aria-pressed="isInteractive ? active : undefined"
    :class="{
      'clickable-icon': isInteractive,
      'abele-obsidian-icon_with-bg': withBg,
      'abele-obsidian-icon_no-hover': noHover,
      'abele-obsidian-icon_disabled': disabled,
      'abele-obsidian-icon_active': active,
      'abele-obsidian-icon_with-text': textLeft || textRight,
      [`abele-obsidian-icon_color-${color}`]: color && color !== 'grey',
      [`abele-obsidian-icon_size-${size}`]: !!size,
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
    /** One of Obsidian's icon sizes; left unset, the icon takes the size of the place it sits in.
     *  Obsidian's `s` is left out: on a desktop it is the same 16px as `m`. */
    size?: 'xs' | 'm' | 'l' | 'xl'
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
    size: undefined,
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
// A row of glyph buttons under a title: the first glyph's ink, not its button's box, starts where
// the title starts — less the button's padding and the margin a glyph is drawn inside its box
// with. A phone widens the button to a finger's size and centres the glyph in it, so the glyph is
// held to the start there, or it lands a few pixels in from the title.
.abele-glyph-row > .clickable-icon:first-child {
  justify-content: flex-start;
  margin-inline-start: calc(-1 * var(--size-2-3) - var(--icon-size) * 2 / 24);
}

.abele-obsidian-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--icon-size);
  color: var(--icon-color);

  // A clickable icon takes Obsidian's own `.clickable-icon` box (4 by 6 around the glyph, its
  // own radius), so it is the size of the host's icon buttons. A picture-only icon is the glyph
  // and nothing more: a margin of its own put space before every icon that the layout around it
  // never asked for. Kept at no weight, so a place that wants a box can give it one.
  &:where(:not(.clickable-icon)) {
    border-radius: var(--radius-s);
  }

  &:where(:not(.clickable-icon)).abele-obsidian-icon_with-bg,
  &:where(:not(.clickable-icon)).abele-obsidian-icon_active {
    padding: var(--size-2-1) var(--size-2-2);
  }

  &_disabled {
    color: var(--text-faint);
    cursor: default;
  }
  &_disabled.clickable-icon:hover {
    color: var(--text-faint);
    background-color: transparent;
  }

  &_with-bg {
    background-color: var(--background-secondary);
  }

  &_active {
    color: var(--text-accent);
    background-color: var(--background-modifier-active-hover);
  }
  // Only an icon that does something reacts to the pointer. A picture-only icon is a span with
  // no `clickable-icon`, and a disabled one carries Obsidian's own `aria-disabled`, whose rule
  // already keeps the hover background off; neither may light up.
  &.clickable-icon:not(.abele-obsidian-icon_disabled):not(.abele-obsidian-icon_no-hover) {
    cursor: var(--cursor-link);
  }
  // Only where there is a pointer to hover with, as Obsidian's `.clickable-icon` does: a phone
  // keeps `:hover` on whatever was tapped last, so the highlight stayed behind after a tap.
  @media (hover: hover) {
    &.clickable-icon:not(.abele-obsidian-icon_disabled):not(.abele-obsidian-icon_no-hover):hover {
      color: var(--icon-color-hover);
      background-color: var(--background-modifier-hover);
    }
  }
}

@each $size in 'xs', 'm', 'l', 'xl' {
  .abele-obsidian-icon.abele-obsidian-icon_size-#{$size} {
    --icon-size: var(--icon-#{$size});
    // Obsidian thins the line as the icon grows; a size without its stroke looks heavy.
    --icon-stroke: var(--icon-#{$size}-stroke-width);
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

  // Only the side that faces the glyph: words with no glyph beside them are not pushed in.
  &:first-child:not(:last-child) {
    margin-right: var(--size-2-2);
  }

  &:last-child:not(:first-child) {
    margin-left: var(--size-2-2);
  }
}

// A theme may size phone glyphs as squares; labelled actions need room for their words too.
.abele-obsidian-icon.clickable-icon.abele-obsidian-icon_with-text {
  width: max-content;
  flex-shrink: 0;
  white-space: nowrap;
}
</style>
