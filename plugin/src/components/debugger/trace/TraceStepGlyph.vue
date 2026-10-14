<template>
  <!-- A step by its kind, before its words: the record point's diamond where values were taken in
       the code, an arrow for a browser request in the colour of its status, a cross for an
       exception, an unplugged cord where the browser went away. -->
  <span
    ref="el"
    class="abele-trace-glyph"
    :class="`abele-trace-glyph_${tone}`"
    role="img"
    :aria-label="kindWords(step)"
  >
    <span
      v-if="step.kind === 'probe'"
      class="abele-breakpoint-mark abele-breakpoint-mark_set abele-breakpoint-mark_record"
    />
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { setIcon, setTooltip } from 'obsidian'
import { kindWords } from './format'
import type { TraceStep } from './types'

const props = defineProps<{ step: TraceStep }>()
const el = ref<HTMLElement>()

const tone = computed(() => {
  const s = props.step
  if (s.kind === 'error') return 'error'
  if (s.kind === 'browser-lost') return 'faint'
  if (s.kind === 'http') return s.status && s.status >= 400 ? 'error' : 'normal'
  return 'probe'
})
const icon = computed(() =>
  props.step.kind === 'http'
    ? 'arrow-right-left'
    : props.step.kind === 'error'
      ? 'circle-x'
      : props.step.kind === 'browser-lost'
        ? 'unplug'
        : null
)

function draw() {
  if (!el.value) return
  if (icon.value) {
    el.value.replaceChildren()
    setIcon(el.value, icon.value)
  }
  setTooltip(el.value, kindWords(props.step))
}
onMounted(draw)
watch(() => props.step, draw)
</script>

<style lang="scss">
.abele-trace-glyph {
  display: inline-flex;
  flex: 0 0 var(--icon-s);
  overflow: hidden;
  align-items: center;
  justify-content: center;
  width: var(--icon-s);
  height: var(--icon-s);
  color: var(--text-muted);

  svg {
    width: 100%;
    height: 100%;
  }
}
.abele-trace-glyph_error {
  color: var(--text-error);
}
.abele-trace-glyph_faint {
  color: var(--text-faint);
}
</style>
