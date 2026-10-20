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
import { t } from '@/i18n'

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
  if (b.state === 'disabled') return t('debug.breakpointDisabled')
  if (b.state === 'pending') return t('streamC.96584d78f43835f6')
  if (b.state === 'rejected')
    return `${record ? t('streamC.6adbfde88c55906a') : t('streamC.3f1facb79cc50b40')}${b.reason ? `: ${b.reason}` : ''}`
  if (!record) return t('streamC.e8041f01a8c14622')
  const what = b.take?.length ? b.take.join(', ') : t('streamC.3c438c10f8ef00bc')
  return t('streamC.4232225a4d26d1cc', {
    v1: String(what),
    v2: String(b.when ? t('streamC.7bcd5276cf2d423a', { v1: String(b.when) }) : ''),
  })
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
.abele-breakpoint-mark_disabled {
  box-shadow: inset 0 0 0 var(--border-width) var(--text-faint);
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
