<template>
  <div
    ref="el"
    class="abele-floating-button mod-raised"
    role="button"
    tabindex="0"
    :aria-label="label"
    :aria-expanded="expanded"
    :class="{
      'abele-floating-button_left': side === 'left',
      'abele-floating-button_tucked': tucked,
      'abele-floating-button_dragging': dragging,
    }"
  >
    <div ref="iconEl" class="abele-floating-button__icon" />
  </div>
</template>

<script setup lang="ts">
/**
 * A round button that floats over the screen at one of its edges, for a phone.
 *
 * Obsidian has no such thing, so it is drawn from what Obsidian's own floating surfaces are
 * made of: `mod-raised` — the class of their navigation bar on a phone — which gives it their
 * frosted background and shadow in the floating-navigation style, and a plain raised shadow
 * otherwise; the size of their touch targets; their icon size. Where it stands is its host's
 * business: `--abele-floating-button-top`, set on the element, and while it is dragged
 * `--abele-floating-button-shift`, how far it has been pulled sideways.
 *
 * Tucked, it slides to its edge with a sliver still on screen, still a button: out of the way of
 * what is being read and still there to press.
 */
import { onMounted, ref, watch } from 'vue'
import { setIcon } from 'obsidian'

const props = withDefaults(
  defineProps<{
    icon: string
    /** What pressing it does, read out by a screen reader. */
    label: string
    side?: 'left' | 'right'
    tucked?: boolean
    dragging?: boolean
    /** Whatever it opens is open. */
    expanded?: boolean
  }>(),
  { side: 'right', tucked: false, dragging: false, expanded: false }
)

const el = ref<HTMLElement>()
const iconEl = ref<HTMLElement>()

const draw = () => {
  if (!iconEl.value) return
  iconEl.value.empty()
  setIcon(iconEl.value, props.icon)
}

onMounted(draw)
watch(() => props.icon, draw)

defineExpose({ el })
</script>

<style lang="scss">
.abele-floating-button {
  position: fixed;
  top: var(--abele-floating-button-top, auto);
  right: calc(var(--safe-area-inset-right, 0px) + var(--size-4-4));
  z-index: var(--layer-popover);
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--touch-size-l);
  height: var(--touch-size-l);
  border-radius: 50%;
  background: var(--raised-background, var(--background-primary));
  color: var(--text-normal);
  --icon-size: var(--icon-l);
  --icon-stroke: var(--icon-l-stroke-width);
  cursor: var(--cursor);
  // The finger that drags it must not scroll the page under it, nor select anything.
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease,
    background-color 0.2s ease,
    top 0.2s ease;

  &:active {
    opacity: var(--icon-opacity-hover);
  }
}

// Obsidian's floating navigation draws `mod-raised` with its own shadow; the plain bar does not.
body:not(.is-floating-nav) .abele-floating-button {
  box-shadow: var(--shadow-s);
}

.abele-floating-button_left {
  right: auto;
  left: calc(var(--safe-area-inset-left, 0px) + var(--size-4-4));
}

.abele-floating-button__icon {
  display: flex;
}

// Slid past its edge, a sliver as wide as the gap it stood from the edge left on screen: it
// sits in the margin, clear of the text, and is still there to tap. Two classes, to outweigh
// Obsidian's `.is-phone .mod-raised` background.
.abele-floating-button.abele-floating-button_tucked {
  // In the accent colour: a sliver of the frosted surface is lost against a white page.
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  opacity: 0.6;
  transform: translateX(100%);
}

.abele-floating-button_left.abele-floating-button_tucked {
  transform: translateX(-100%);
}

.abele-floating-button_dragging {
  opacity: 0.85;
  transform: translateX(var(--abele-floating-button-shift, 0px));
  transition: none;
}
</style>
