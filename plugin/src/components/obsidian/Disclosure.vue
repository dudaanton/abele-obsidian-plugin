<template>
  <div class="abele-disclosure">
    <button
      type="button"
      class="clickable-icon abele-disclosure__control"
      :aria-label="label"
      :aria-expanded="modelValue"
      :aria-controls="contentId"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span
        ref="glyph"
        class="collapse-icon"
        :class="{ 'is-collapsed': !modelValue }"
        aria-hidden="true"
      />
      <span>{{ label }}</span
      ><span v-if="count !== undefined" class="abele-disclosure__count">{{ count }}</span>
    </button>
    <div v-if="modelValue" :id="contentId" class="abele-disclosure__content"><slot /></div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, useId } from 'vue'
import { setIcon } from 'obsidian'
import './designKit.css'
defineProps<{ label: string; modelValue: boolean; count?: number }>()
const emit = defineEmits<{ 'update:modelValue': [expanded: boolean] }>()
const contentId = `abele-disclosure-${useId()}`
const glyph = ref<HTMLElement>()
onMounted(() => {
  if (glyph.value) setIcon(glyph.value, 'right-triangle')
})
</script>
<style>
.abele-disclosure__control {
  display: inline-flex;
  gap: var(--size-4-1);
  justify-content: flex-start;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  white-space: normal;
  text-align: start;
}
.abele-disclosure__count {
  color: var(--text-muted);
  font-weight: var(--font-normal);
}
.abele-disclosure__content {
  padding: var(--size-4-3);
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
