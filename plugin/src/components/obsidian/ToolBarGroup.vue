<template>
  <div class="abele-tool-bar__group" role="group" :aria-label="label">
    <!-- One group of a tool bar: unless it opens the row, behind a hairline, as a toolbar's groups are. -->
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** What the group holds, for a screen reader: «Colours», «Width». */
  label?: string
}>()
</script>

<style lang="scss">
.abele-tool-bar__group {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--size-2-1);

  &:not(:first-child) {
    padding-inline-start: var(--size-4-2);
    border-inline-start: 1px solid var(--background-modifier-border);
  }
}
</style>
