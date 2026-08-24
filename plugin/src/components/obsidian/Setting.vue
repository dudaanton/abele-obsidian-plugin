<template>
  <div class="setting-item abele-obsidian-setting">
    <div class="setting-item-info">
      <div class="setting-item-name">{{ name }}</div>
      <div v-if="desc" class="setting-item-description">{{ desc }}</div>
    </div>
    <div class="setting-item-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  desc?: string
}>()
</script>

<style lang="scss">
/**
 * Obsidian's `.setting-item` is a nowrap row sized for its own settings pane. Ours are
 * narrower — a plugin tab inside the pane, and narrower still inside a modal — so the label
 * and the control are allowed to stack instead of pushing the pane sideways. Equal flex
 * bases mean they only stack once neither fits.
 */
.abele-obsidian-setting {
  flex-wrap: wrap;
  gap: var(--size-4-1) var(--size-4-2);

  > .setting-item-info {
    flex: 1 1 14em;
    min-width: 0;
    margin-right: 0;
  }

  > .setting-item-control {
    flex: 1 1 14em;
    min-width: 0;
    flex-wrap: wrap;
  }

  .setting-item-name,
  .setting-item-description {
    overflow-wrap: anywhere;
  }
}
</style>
