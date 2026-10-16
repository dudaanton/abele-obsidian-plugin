<template>
  <span class="abele-context-meter" :class="`abele-context-meter_${level}`">{{ percent }}%</span>
</template>

<script setup lang="ts">
// How full the session's context is, as a quiet share: orange when it nears the end, red at it.
// It stands in the session's control at the composer's foot, which carries the counts.
import { computed } from 'vue'
import type { ContextUse } from './types'

const props = defineProps<{ context: ContextUse }>()

const share = computed(() => Math.min(1, props.context.used / props.context.limit))
const percent = computed(() => Math.round(share.value * 100))
const level = computed(() => (share.value > 0.95 ? 'full' : share.value > 0.8 ? 'high' : 'ok'))
</script>

<style lang="scss">
.abele-context-meter {
  font-variant-numeric: tabular-nums;
}
.abele-context-meter_high {
  color: var(--color-orange);
}
.abele-context-meter_full {
  color: var(--text-error);
}
</style>
