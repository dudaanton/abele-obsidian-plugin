<template>
  <div ref="element" class="abele-sidebar-panel" :class="{ 'abele-sidebar-panel_inset': inset }">
    <slot />
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
defineProps<{ inset?: boolean }>()
const emit = defineEmits<{ element: [HTMLElement] }>()
const element = ref<HTMLElement>()
onMounted(() => {
  if (element.value) emit('element', element.value)
})
</script>
<style lang="scss">
.abele-sidebar-panel {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--background-primary);
  padding: calc(var(--p-spacing) * 2);
  padding-top: calc(var(--size-4-2) * 2 + var(--icon-size));
}
.abele-sidebar-panel_inset {
  inset: 0;
  width: auto;
  height: auto;
}
@media (max-width: 600px) {
  .abele-sidebar-panel {
    padding: var(--size-4-4);
    padding-top: calc(var(--size-4-2) + var(--icon-size));
  }
}
// An absolute main-pane scroller must begin below the native phone header, not the
// leaf's top edge. This is shared by all list panels, including inset-sized accounts.
body.is-phone .workspace-split.mod-root .abele-sidebar-panel {
  top: calc(var(--safe-area-inset-top, 0px) + var(--view-header-height, 0px) + var(--size-4-2));
  height: calc(
    100% - var(--safe-area-inset-top, 0px) - var(--view-header-height, 0px) - var(--size-4-2)
  );
}
// Main-pane lists own an absolute scroller, so the view-content's native bottom inset
// cannot protect their last row from the phone's floating navigation.
.is-mobile .workspace-split.mod-root .abele-sidebar-panel {
  padding-bottom: calc(var(--size-4-4) + var(--view-bottom-spacing, 0px));
}
</style>
