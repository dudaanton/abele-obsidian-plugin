<template>
  <div class="abele-tool-bar" role="toolbar" :aria-label="label" data-ignore-swipe="true">
    <!-- A tab's row of tools under its header: glyphs in groups, each group after the first behind
         a hairline, what is about the whole tab (zoom, more) at the end. On a narrow screen the
         row wraps rather than hiding tools off its edge. -->
    <slot />
    <div v-if="$slots.end" class="abele-tool-bar__end">
      <slot name="end" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The row of tools over a drawing or a canvas, one for both: their tools are the same tools, so
 * they stand in the same place and read the same way. Glyphs are `Icon`s (`active` for the tool
 * in hand); `ToolBarGroup` sets a group apart.
 */
defineProps<{
  /** What the row is for, said to a screen reader. */
  label: string
}>()
</script>

<style lang="scss">
.abele-tool-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-1) var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  border-bottom: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);

  &__end {
    display: flex;
    align-items: center;
    gap: var(--size-2-1);
    margin-left: auto;
  }
}
</style>
