<template>
  <span
    ref="el"
    class="abele-result-mark"
    :class="`abele-result-mark_${state}`"
    role="img"
    :aria-label="label"
  >
    <Icon :icon="glyph" :interactive="false" size="xs" />
  </span>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * What became of one row when the window acted on it: being done now, done, failed, or left
 * alone. A glyph in the row's codes; the words — the error itself — under the pointer.
 */
import { computed, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from './Icon.vue'

const props = defineProps<{
  state: 'working' | 'done' | 'error' | 'skipped'
  /** What it says under the pointer: "Moved to the trash", the error. */
  text?: string
}>()
const glyph = computed(
  () => ({ working: 'loader', done: 'check', error: 'x', skipped: 'minus' })[props.state]
)
const label = computed(
  () =>
    props.text ??
    {
      working: t('kit.working'),
      done: t('kit.done'),
      error: t('kit.failed'),
      skipped: t('kit.skipped'),
    }[props.state]
)
const el = ref<HTMLElement>()
watch([el, label], ([node, words]) => node && setTooltip(node, words), { immediate: true })
</script>

<style lang="scss">
.abele-result-mark {
  display: inline-flex;
  align-items: center;
  color: var(--text-faint);

  // The glyph takes the mark's colour, not an icon's own.
  .abele-obsidian-icon {
    color: inherit;
  }

  &_done {
    color: var(--color-green);
  }

  &_error {
    color: var(--text-error);
  }

  &_working svg {
    animation: abele-result-mark-spin 1s linear infinite;
  }
}

@keyframes abele-result-mark-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .abele-result-mark_working svg {
    animation: none;
  }
}
</style>
