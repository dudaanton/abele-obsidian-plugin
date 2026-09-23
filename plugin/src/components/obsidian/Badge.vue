<template>
  <span
    class="abele-badge"
    :class="{
      'abele-badge_accent': accent,
      [`abele-badge_color-${color}`]: color && color !== 'grey',
    }"
    >{{ text }}</span
  >
</template>

<script setup lang="ts">
import type { KitColor } from '@/constants/colors'

defineProps<{
  text: string
  accent?: boolean
  /** A theme colour by name. Grey, or none, is the default muted badge. */
  color?: KitColor
}>()
</script>

<style lang="scss">
.abele-badge {
  flex: 0 0 auto;
  padding: 0 var(--size-2-2);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-smallest);
  white-space: nowrap;
}

.abele-badge_accent {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
}

// Obsidian's own named colours, so a tint follows the theme and its dark variant. The fill is
// the colour thinned over whatever is behind it; the word keeps the colour at full strength.
@each $name in red, orange, yellow, green, cyan, blue, purple, pink {
  .abele-badge_color-#{$name} {
    background-color: color-mix(in srgb, var(--color-#{$name}) 18%, transparent);
    color: var(--color-#{$name});
  }
}
</style>
