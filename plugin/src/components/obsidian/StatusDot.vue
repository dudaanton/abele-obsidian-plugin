<template>
  <span
    ref="el"
    class="abele-status-dot"
    :class="[`abele-status-dot_${tone}`, { 'abele-status-dot_pulse': pulse }]"
    role="status"
    :aria-label="label"
  />
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
const props = defineProps<{
  tone: 'green' | 'orange' | 'red' | 'faint' | 'accent'
  /** What the state means, in words. */
  label: string
  /** Something is happening right now (connecting, running). */
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
.abele-status-dot_green { background-color: var(--color-green); }
.abele-status-dot_orange { background-color: var(--color-orange); }
.abele-status-dot_red { background-color: var(--color-red); }
.abele-status-dot_faint { background-color: var(--text-faint); }
.abele-status-dot_accent { background-color: var(--interactive-accent); }
.abele-status-dot_pulse { animation: abele-status-dot-pulse 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .abele-status-dot_pulse { animation: none; }
}
@keyframes abele-status-dot-pulse { 50% { opacity: 0.35; } }
</style>
