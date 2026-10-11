<template>
  <!-- Two places that are always there, so every row's dot and number stand in one column. -->
  <span class="abele-copy-codes">
    <span class="abele-copy-codes__dot">
      <StatusDot v-if="running" tone="accent" pulse :label="runningLabel" />
      <StatusDot
        v-else-if="unseen"
        tone="accent"
        :label="unseenLabel ?? `${plural(unseen, 'change')} since you looked`"
      />
    </span>
    <span ref="countEl" class="tree-item-flair abele-copy-codes__count">{{ changed || '' }}</span>
  </span>
</template>

<script setup lang="ts">
// What is going on in a worktree, at the end of its row: a pulsing dot while an agent works in
// it, a still accent dot for changes you have not looked at, and the number of changed files.
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import StatusDot from '../obsidian/StatusDot.vue'
import { plural } from './codes'

const props = withDefaults(
  defineProps<{
    running?: boolean
    unseen?: number
    changed?: number
    runningLabel?: string
    unseenLabel?: string
  }>(),
  {
    running: false,
    unseen: 0,
    changed: 0,
    runningLabel: 'An agent is working here',
    unseenLabel: undefined,
  }
)
const countEl = ref<HTMLElement>()
const tip = () =>
  countEl.value && setTooltip(countEl.value, `${plural(props.changed ?? 0, 'changed file')}`)
onMounted(tip)
watch(() => props.changed, tip, { flush: 'post' })
</script>

<style lang="scss">
.abele-copy-codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-copy-codes__dot {
  display: inline-flex;
  justify-content: center;
  width: var(--size-4-2);
}
// One panel-wide column, at least three figures; large counts must not shift only their row.
.abele-copy-codes__count.tree-item-flair {
  width: calc(var(--abele-copy-count-digits, 3) * 1ch);
  min-width: calc(var(--abele-copy-count-digits, 3) * 1ch);
  text-align: start;
  font-variant-numeric: tabular-nums;

  &:empty {
    visibility: hidden;
  }
}
</style>
