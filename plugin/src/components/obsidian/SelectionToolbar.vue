<template>
  <span ref="anchor" hidden />
  <Teleport v-if="target" :to="target">
    <div
      ref="element"
      v-bind="$attrs"
      class="abele-selection-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      :style="{ top: `${top}px`, left: `${left}px` }"
      @pointerdown.prevent
    >
      <slot />
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
/** Compact actions near a text selection, outside scrolling/clipping panes. */
defineOptions({ inheritAttrs: false })
defineProps<{ top: number; left: number }>()
const anchor = ref<HTMLElement>()
const target = shallowRef<HTMLElement>()
const element = ref<HTMLElement>()
onMounted(() => {
  target.value = anchor.value?.ownerDocument.body
})
defineExpose({ element })
</script>
<style lang="scss">
.abele-selection-toolbar {
  position: fixed;
  z-index: var(--layer-popover);
  display: flex;
  gap: var(--size-4-1);
  padding: var(--size-4-1);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background-color: var(--background-primary);
  box-shadow: var(--shadow-s);
  max-width: calc(100vw - var(--size-4-4));
  box-sizing: border-box;
  user-select: none;
  -webkit-user-select: none;
}
</style>
