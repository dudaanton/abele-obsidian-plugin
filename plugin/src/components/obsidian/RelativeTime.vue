<template>
  <span class="abele-relative-time">
    <time
      v-if="formatted.datetime"
      :datetime="formatted.datetime"
      :aria-label="formatted.exact"
      :title="formatted.exact"
      >{{ formatted.label }}</time
    >
    <span v-else>{{ formatted.label }}</span>
    <details
      v-if="formatted.datetime && formatted.label !== formatted.exact"
      class="abele-relative-time__detail"
    >
      <summary>Exact time</summary>
      {{ formatted.exact }}
    </details>
  </span>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { formatTimestamp, type TimestampValue } from '@/helpers/displayFormat'
const props = defineProps<{
  value?: TimestampValue
  now?: Date
  mode?: 'relative' | 'absolute'
  diagnostic?: boolean
  timeZone?: string
}>()
const formatted = computed(() => formatTimestamp(props.value, props))
</script>
<style>
.abele-relative-time {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}
.abele-relative-time__detail {
  display: inline-block;
  margin-inline-start: var(--size-4-1);
}
.abele-relative-time__detail summary {
  cursor: var(--cursor-link);
}
body.is-phone .abele-relative-time__detail summary {
  min-height: var(--abele-touch-min);
  display: inline-flex;
  align-items: center;
}
</style>
