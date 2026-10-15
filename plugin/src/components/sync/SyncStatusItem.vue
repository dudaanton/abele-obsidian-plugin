<template>
  <Icon class="abele-sync-status-icon" :icon="icon" :tooltip="tooltip" /><span
    class="abele-sync-status-text"
    >{{ text }}</span
  >
</template>

<script setup lang="ts">
// The inside of the sync item in the status bar: the state's glyph and its word. The item
// itself, its class and its tooltip are the status bar's; `renderStatus` patches this into it.
import Icon from '@/components/obsidian/Icon.vue'

defineProps<{ icon: string; text: string; tooltip: string }>()
</script>

<style lang="scss">
// The status bar's colour, not the kit's icon colour: the warning tints glyph and word alike.
.abele-sync-status > .abele-sync-status-icon.abele-obsidian-icon {
  color: inherit;
  display: inline-flex;
}
</style>
