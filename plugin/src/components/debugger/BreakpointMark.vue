<template>
  <span
    ref="el"
    class="abele-breakpoint-mark"
    :class="`abele-breakpoint-mark_${breakpoint.state}`"
    role="img"
    :aria-label="label"
  />
</template>

<script setup lang="ts">
// A breakpoint by its colour, the same in the margin and in the list: a red disc where the
// program will stop, a hollow ring while the adapter has not confirmed it, a faint ring with a
// stroke where it cannot stop; the reason in the tooltip.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import type { DebugBreakpoint } from './types'

const props = defineProps<{ breakpoint: DebugBreakpoint }>()
const el = ref<HTMLElement>()
const label = computed(() =>
  props.breakpoint.state === 'set'
    ? 'Stops here'
    : props.breakpoint.state === 'pending'
      ? 'Not confirmed yet'
      : `Cannot stop here${props.breakpoint.reason ? `: ${props.breakpoint.reason}` : ''}`
)
const tip = () => el.value && setTooltip(el.value, label.value)
onMounted(tip)
watch(label, tip)
</script>

<style lang="scss">
.abele-breakpoint-mark {
  display: inline-block;
  flex: 0 0 auto;
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: 50%;
}
.abele-breakpoint-mark_set {
  background-color: var(--color-red);
}
.abele-breakpoint-mark_pending {
  box-shadow: inset 0 0 0 var(--border-width) var(--color-red);
}
.abele-breakpoint-mark_rejected {
  box-shadow: inset 0 0 0 var(--border-width) var(--text-faint);
  background: linear-gradient(
    135deg,
    transparent calc(50% - 0.5px),
    var(--text-faint) calc(50% - 0.5px),
    var(--text-faint) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
}
</style>
