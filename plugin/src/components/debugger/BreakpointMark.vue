<template>
  <span
    ref="el"
    class="abele-breakpoint-mark"
    :class="[
      `abele-breakpoint-mark_${breakpoint.state}`,
      { 'abele-breakpoint-mark_record': breakpoint.kind === 'record' },
    ]"
    role="img"
    :aria-label="label"
  />
</template>

<script setup lang="ts">
// A breakpoint by its colour, the same in the margin and in the list: a red disc where the
// program will stop, a hollow ring while the adapter has not confirmed it, a faint ring with a
// stroke where it cannot stop; the reason in the tooltip. A record point, which takes values and
// lets the program go on, is the same in the shape of a diamond, as a logpoint is in VS Code.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import type { DebugBreakpoint } from './types'

const props = defineProps<{ breakpoint: DebugBreakpoint }>()
const el = ref<HTMLElement>()
const label = computed(() => {
  const b = props.breakpoint
  const record = b.kind === 'record'
  if (b.state === 'pending') return 'Not confirmed yet'
  if (b.state === 'rejected')
    return `${record ? 'Cannot record here' : 'Cannot stop here'}${b.reason ? `: ${b.reason}` : ''}`
  if (!record) return 'Stops here'
  const what = b.take?.length ? b.take.join(', ') : 'all the values here'
  return `Record point: takes ${what} and goes on${b.when ? `, when ${b.when}` : ''}`
})
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
// A diamond: the square turned and drawn a little smaller, so it stands as tall as the disc.
.abele-breakpoint-mark_record {
  border-radius: 1px;
  transform: rotate(45deg) scale(0.82);
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
