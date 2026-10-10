<template>
  <span class="abele-copy-codes">
    <StatusDot v-if="running" tone="accent" pulse label="An agent is working here" />
    <StatusDot
      v-else-if="unseen"
      tone="accent"
      :label="`${plural(unseen, 'change')} since you looked`"
    />
    <span v-if="changed" ref="countEl" class="tree-item-flair abele-copy-codes__count">{{
      changed
    }}</span>
  </span>
</template>

<script setup lang="ts">
// What is going on in a worktree, at the end of its row: a pulsing dot while an agent works in
// it, a still accent dot for changes you have not looked at, and the number of changed files.
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import StatusDot from '../obsidian/StatusDot.vue'
import { plural } from './codes'

const props = defineProps<{ running?: boolean; unseen?: number; changed?: number }>()
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
</style>
