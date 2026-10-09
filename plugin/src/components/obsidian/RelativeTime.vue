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
      @toggle="opened = ($event.target as HTMLDetailsElement).open"
    >
      <summary>
        <span
          ref="glyph"
          class="collapse-icon"
          :class="{ 'is-collapsed': !opened }"
          aria-hidden="true"
        />Exact time
      </summary>
      <span class="abele-relative-time__exact">{{ formatted.exact }}</span>
    </details>
  </span>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { setIcon } from 'obsidian'
import { formatTimestamp, type TimestampValue } from '@/helpers/displayFormat'
const props = defineProps<{
  value?: TimestampValue
  now?: Date
  mode?: 'relative' | 'absolute'
  diagnostic?: boolean
  timeZone?: string
}>()
const formatted = computed(() => formatTimestamp(props.value, props))
const glyph = ref<HTMLElement>(),
  opened = ref(false)
const draw = () => {
  if (glyph.value) {
    glyph.value.replaceChildren()
    setIcon(glyph.value, 'right-triangle')
  }
}
onMounted(draw)
watch(
  () => formatted.value.datetime,
  () => void nextTick(draw)
)
</script>
<style>
.abele-relative-time {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}
.abele-relative-time__detail {
  display: block;
  min-width: 0;
}
.abele-relative-time__detail summary {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  cursor: var(--cursor-link);
  list-style: none;
}
.abele-relative-time__detail summary::marker,
.abele-relative-time__detail summary::-webkit-details-marker {
  display: none;
  content: '';
}
.abele-relative-time__exact {
  display: block;
  margin-top: var(--size-4-1);
}
body.is-phone .abele-relative-time__detail summary {
  min-height: var(--abele-touch-min);
}
</style>
