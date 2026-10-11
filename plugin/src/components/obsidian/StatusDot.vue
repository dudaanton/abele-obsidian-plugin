<template>
  <span
    ref="el"
    class="abele-status-dot"
    :class="`abele-status-dot_${tone}`"
    role="status"
    :aria-label="label"
  />
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
const props = defineProps<{
  tone: 'green' | 'orange' | 'red' | 'faint'
  label: string
  pulse?: boolean
}>()
const el = ref<HTMLElement>()
const tip = () => {
  if (el.value) setTooltip(el.value, props.label)
}
onMounted(tip)
watch(() => props.label, tip)
</script>
<style>
.abele-status-dot {
  display: inline-block;
  flex: 0 0 auto;
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: 50%;
  background: var(--text-faint);
}
.abele-status-dot_green {
  background: var(--color-green);
}
.abele-status-dot_orange {
  background: var(--color-orange);
}
.abele-status-dot_red {
  background: var(--color-red);
}
</style>
