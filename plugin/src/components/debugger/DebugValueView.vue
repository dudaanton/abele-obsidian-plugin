<template>
  <div class="abele-debug-value-view">
    <div class="abele-debug-value-view__head">
      <span class="abele-debug-value-view__name">{{ name }}</span>
      <span class="abele-debug-value-view__facts">{{ facts }}</span>
    </div>
    <div
      ref="host"
      class="abele-github-code abele-debug-value-view__code"
      :class="{ 'abele-debug-value-view__code_wrap': wrap }"
    />
  </div>
</template>

<script setup lang="ts">
// A value of the program in a tab of its own, for what does not fit a row: a long string, a
// whole XML document, a JSON payload. It opens laid out to read, with the code viewer's colours,
// line numbers and search; the raw text is one switch away in the tab's header, beside wrapping
// and copying. Like any tab it can be dragged into a window of its own.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mountCode, type CodeViewer } from '@/github/codeViewer'
import { detectFormat, formatValue, sizeOf, type ValueFormat } from './valueFormat'

const props = withDefaults(
  defineProps<{
    /** The variable or expression the value belongs to. */
    name: string
    value: string
    type?: string
    /** Laid out to read, or exactly as the program holds it. */
    mode?: 'formatted' | 'raw'
    wrap?: boolean
  }>(),
  { type: undefined, mode: 'formatted', wrap: false }
)

const format = computed<ValueFormat>(() => detectFormat(props.value))
const shown = computed(() =>
  props.mode === 'formatted' ? formatValue(props.value, format.value) : props.value
)
const facts = computed(() =>
  [
    props.type,
    format.value === 'text' ? undefined : format.value.toUpperCase(),
    sizeOf(props.value),
  ]
    .filter(Boolean)
    .join(' · ')
)

const host = ref<HTMLElement>()
let viewer: CodeViewer | undefined
async function draw() {
  await nextTick()
  viewer?.destroy()
  if (host.value)
    viewer = mountCode(
      host.value,
      shown.value,
      `value.${format.value === 'text' ? 'txt' : format.value}`,
      undefined,
      {},
      undefined,
      undefined,
      props.wrap
    )
}
onMounted(draw)
watch([shown, () => props.wrap], draw)
onBeforeUnmount(() => viewer?.destroy())
</script>

<style lang="scss">
.abele-debug-value-view {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  min-width: 0;
}
.abele-debug-value-view__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--size-4-1) var(--size-4-3);
}
.abele-debug-value-view__name {
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-weight: var(--font-semibold);
}
.abele-debug-value-view__facts {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-debug-value-view__code {
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);

  .cm-gutters {
    border: none;
    background-color: var(--background-secondary);
    color: var(--text-faint);
  }
  .cm-content {
    white-space: pre;
  }
}
.abele-debug-value-view__code_wrap .cm-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
