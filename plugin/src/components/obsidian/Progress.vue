<template>
  <progress
    class="abele-progress"
    :aria-label="label"
    :aria-busy="current === undefined"
    :value="current"
    :max="limit"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(
  defineProps<{
    label: string
    /** Omit while total work is unknown. Zero is a determinate value. */
    value?: number
    max?: number
  }>(),
  { max: 100 }
)
const limit = computed(() => (Number.isFinite(props.max) && props.max > 0 ? props.max : 100))
const current = computed(() =>
  props.value === undefined || !Number.isFinite(props.value)
    ? undefined
    : Math.min(limit.value, Math.max(0, props.value))
)
</script>
<style>
/* Native markdown progress geometry and host colours, shared by every import screen. */
.abele-progress {
  width: 100%;
  max-width: 100%;
  height: var(--size-2-3);
  border: 0;
  border-radius: var(--radius-s);
  accent-color: var(--interactive-accent);
}
.abele-progress[value] {
  appearance: none;
}
.abele-progress[value]::-webkit-progress-bar {
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  box-sizing: border-box;
  border-radius: var(--radius-s);
}
.abele-progress[value]::-webkit-progress-value {
  background: var(--interactive-accent);
  border-radius: var(--radius-s);
}
.abele-progress[value]::-moz-progress-bar {
  background: var(--interactive-accent);
}
</style>
