<template>
  <button
    ref="el"
    class="abele-obsidian-button"
    :class="{ 'mod-cta': accent, 'mod-warning': warning }"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <span v-if="icon" ref="iconEl" class="abele-obsidian-button__icon" />
    {{ text }}
  </button>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { setIcon, setTooltip } from 'obsidian'

const props = defineProps<{
  text: string
  icon?: string
  accent?: boolean
  /** For an action that destroys something. */
  warning?: boolean
  disabled?: boolean
  /** What pressing this does, in a few words. Every button carries one — see docs/Design.md. */
  tooltip?: string
}>()

defineEmits<{
  (e: 'click'): void
}>()

const el = ref<HTMLElement>()
// A bare glyph, not the plugin's `Icon`: that one is a control of its own, painted in the icon
// grey with a hover box, which put a dark sun on the accent button and a patch inside every
// button under the pointer. Obsidian's svg strokes in `currentColor`, so the glyph takes the
// button's own text colour, on `mod-cta` too, and the button alone reacts to the pointer.
const iconEl = ref<HTMLElement>()

// Obsidian's own tooltip rather than the browser's `title`: it is styled with the theme and
// appears without the second-long delay a native tooltip has.
const applyTooltip = () => {
  if (el.value) setTooltip(el.value, props.tooltip ?? '')
}

const applyIcon = () => {
  if (!iconEl.value) return
  iconEl.value.empty()
  if (props.icon) setIcon(iconEl.value, props.icon)
}

onMounted(() => {
  applyTooltip()
  applyIcon()
})
watch(() => props.tooltip, applyTooltip)
watch(
  () => props.icon,
  () => void nextTick(applyIcon)
)
</script>

<style lang="scss">
.abele-obsidian-button {
  display: flex;
  // Obsidian's own icon-and-label control, `.text-icon-button`, keeps this gap.
  gap: var(--size-2-2);

  .abele-obsidian-button__icon {
    display: flex;
    align-items: center;
  }
}
</style>
