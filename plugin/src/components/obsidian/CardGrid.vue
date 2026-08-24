<template>
  <div class="abele-card-grid" :class="{ 'abele-card-grid_wide': wide }">
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** For cards carrying a description as well as a title — they need a wider column. */
  wide?: boolean
}>()
</script>

<style lang="scss">
/**
 * `min(100%, …)` rather than a bare track size: a fixed minimum wider than the pane makes the
 * grid itself overflow, which is how a settings tab ends up scrolling sideways on a phone.
 */
.abele-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 12em), 1fr));
  gap: var(--size-4-2);
}

.abele-card-grid_wide {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22em), 1fr));
}
</style>
