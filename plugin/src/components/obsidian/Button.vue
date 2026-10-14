<template>
  <button
    ref="el"
    type="button"
    class="abele-obsidian-button"
    :class="{
      'clickable-icon': plain,
      'abele-obsidian-button_plain': plain,
      'mod-cta': accent,
      'mod-warning': warning,
      'abele-obsidian-button_accent': accent,
      'abele-obsidian-button_warning': warning,
      'abele-obsidian-button_loading': loading,
      'abele-obsidian-button_block': block,
      'abele-obsidian-button_disabled': disabled,
      'abele-obsidian-button_quiet': quiet,
    }"
    :disabled="disabled"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <span
      v-if="icon || loading"
      ref="iconEl"
      class="abele-obsidian-button__icon"
      :class="{ 'abele-obsidian-button__icon_loading': loading }"
    />
    <span class="abele-obsidian-button__label"
      ><slot>{{ text }}</slot></span
    >
    <span v-if="trailingIcon" ref="trailingIconEl" class="abele-obsidian-button__trailing-icon" />
  </button>
</template>

<script setup lang="ts">
// A button shaped like Nuxt UI's: a leading icon, the label, a trailing icon, a loading state and
// a full-width form. Its look is Obsidian's own button, with `mod-cta` and `mod-warning`.
import { ref, onMounted, watch, nextTick } from 'vue'
import { setIcon, setTooltip } from 'obsidian'

const props = defineProps<{
  text: string
  icon?: string
  /** An icon after the label: where the button leads, out of the app or into a menu. */
  trailingIcon?: string
  accent?: boolean
  /** Native neutral row/glyph action rather than a filled form button. */
  plain?: boolean
  /** For an action that destroys something. */
  warning?: boolean
  /** The action is running: a spinner takes the icon's place and a second press does nothing. */
  loading?: boolean
  /** As wide as the place it stands in. */
  block?: boolean
  /** Muted words with no box, as Obsidian's own "Collapse all" over a list: a small action beside
   *  a list's heading rather than a button of the window. */
  quiet?: boolean
  disabled?: boolean
  /** What pressing this does, in a few words. Every button carries one — see docs/Design.md. */
  tooltip?: string
  /** Action name preceding any contextual facts in the native tooltip label. */
  label?: string
}>()

const emit = defineEmits<{
  (e: 'click'): void
}>()

const el = ref<HTMLElement>()
// A bare glyph, not the plugin's `Icon`: that one is a control of its own, painted in the icon
// grey with a hover box, which put a dark sun on the accent button and a patch inside every
// button under the pointer. Obsidian's svg strokes in `currentColor`, so the glyph takes the
// button's own text colour, on `mod-cta` too, and the button alone reacts to the pointer.
const iconEl = ref<HTMLElement>()
const trailingIconEl = ref<HTMLElement>()

function onClick(): void {
  // Still enabled while loading, so the focus stays on it and its width does not jump; the
  // press is simply not passed on.
  if (props.loading) return
  emit('click')
}

// Obsidian's own tooltip rather than the browser's `title`: it is styled with the theme and
// appears without the second-long delay a native tooltip has.
const applyTooltip = () => {
  if (el.value) {
    const text = props.label
      ? [props.label, props.tooltip].filter(Boolean).join(' · ')
      : (props.tooltip ?? props.text)
    setTooltip(el.value, text)
  }
}

const applyIcons = () => {
  if (iconEl.value) {
    iconEl.value.empty()
    const name = props.loading ? 'loader-circle' : props.icon
    if (name) setIcon(iconEl.value, name)
  }
  if (trailingIconEl.value) {
    trailingIconEl.value.empty()
    if (props.trailingIcon) setIcon(trailingIconEl.value, props.trailingIcon)
  }
}

onMounted(() => {
  applyTooltip()
  applyIcons()
})
watch(() => [props.tooltip, props.label, props.text], applyTooltip)
watch(
  () => [props.icon, props.trailingIcon, props.loading],
  () => void nextTick(applyIcons)
)
</script>

<style lang="scss">
// Words, not a button: no box, no fill, muted until the pointer or the keyboard is on them.
// A button in the words' own size, without a frame: under the pointer it lights up as every
// clickable thing in Obsidian does. The room the light needs is taken back by margins, so its words
// stay on the edge of the text around it.
.abele-obsidian-button.abele-obsidian-button_quiet {
  height: auto;
  padding: var(--size-2-1) var(--size-2-3);
  margin: calc(-1 * var(--size-2-1)) calc(-1 * var(--size-2-3));
  border: none;
  border-radius: var(--radius-s);
  background: none;
  box-shadow: none;
  color: var(--text-muted);
  font-size: inherit;
  font-weight: var(--font-normal);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
  &:focus-visible {
    background: none;
    color: var(--text-normal);
  }
}

.abele-obsidian-button {
  display: flex;
  // Obsidian's own icon-and-label control, `.text-icon-button`, keeps this gap.
  gap: var(--size-2-2);

  .abele-obsidian-button__icon,
  .abele-obsidian-button__trailing-icon {
    display: flex;
    align-items: center;
  }
}

.abele-obsidian-button_plain {
  text-align: start;
  font-weight: var(--font-normal);
  white-space: normal;
  box-shadow: none;
}

.abele-obsidian-button_block {
  justify-content: center;
  width: 100%;
}

.abele-obsidian-button_loading {
  cursor: progress;
}

.abele-obsidian-button__icon_loading svg {
  animation: abele-obsidian-button-spin 1s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .abele-obsidian-button__icon_loading svg {
    animation: none;
  }
}
@keyframes abele-obsidian-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
