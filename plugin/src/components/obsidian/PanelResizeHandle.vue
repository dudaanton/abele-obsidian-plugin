<template>
  <hr
    class="workspace-leaf-resize-handle abele-panel-resize-handle"
    :class="{ 'is-active': active }"
    role="separator"
    :aria-label="label"
    aria-orientation="vertical"
    :aria-valuemin="Math.round(min)"
    :aria-valuemax="Math.round(max)"
    :aria-valuenow="Math.round(current)"
    :tabindex="narrow ? -1 : 0"
  />
</template>

<script setup lang="ts">
/** Obsidian's divider, positioned at the edge of a panel inside a view rather than a split. */
defineProps<{
  label: string
  min: number
  max: number
  current: number
  narrow: boolean
  active: boolean
}>()
</script>

<style lang="scss">
// Match Obsidian's last-workspace-leaf hide rule: this divider is inside that leaf, not its edge.
.abele-panel-layout.abele-panel-layout_open
  > .abele-resizable-panel
  > .workspace-leaf-resize-handle.abele-panel-resize-handle {
  display: block;
  inset-block: 0;
  inset-inline-end: 0;
  width: var(--divider-width-hover);
  height: 100%;
  border-inline-end: var(--divider-width) solid var(--divider-color);
  cursor: col-resize;

  &:hover,
  &:focus-visible {
    border-color: var(--divider-color-hover);
  }

  &.is-active {
    border-color: var(--color-accent);
  }
}

@container (max-width: 640px) {
  .abele-panel-layout.abele-panel-layout_open
    > .abele-resizable-panel
    > .workspace-leaf-resize-handle.abele-panel-resize-handle {
    display: none;
  }
}
</style>
