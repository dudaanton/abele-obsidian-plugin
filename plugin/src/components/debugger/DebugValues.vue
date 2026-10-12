<template>
  <TreeItem
    v-for="v in values"
    :key="path(v)"
    :text="v.name"
    :collapsible="!!v.children?.length || !!v.handle || v.value.length > 80"
    :collapsed="!openSet.has(path(v))"
    class="abele-debug-value_row"
    :class="{ 'abele-debug-value_changed': v.changed }"
    @click="activate(v)"
  >
    <template #end>
      <span
        ref="valueEls"
        class="abele-debug-value"
        :data-tip="[v.type, v.value].filter(Boolean).join(' · ')"
        >{{ v.value }}</span
      >
    </template>
    <pre
      v-if="!v.children?.length && !v.handle && v.value.length > 80"
      class="abele-debug-value__detail"
      >{{ v.value }}</pre
    >
    <DebugValues
      v-if="v.children?.length"
      :values="v.children"
      :folded="folded"
      :prefix="path(v)"
      :disabled="disabled"
      @toggle="(id) => emit('toggle', id)"
      @inspect="emit('inspect', $event)"
    />
  </TreeItem>
</template>

<script setup lang="ts">
// Variables as a tree: name on the left, value at the end of the row, objects open in place. A
// value the last step changed is drawn in the accent colour; its type is in the tooltip.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import TreeItem from '../obsidian/TreeItem.vue'
import type { DebugVariable } from './types'

const props = withDefaults(
  defineProps<{
    values: DebugVariable[]
    folded: Set<string>
    prefix?: string
    disabled?: boolean
  }>(),
  { prefix: '', disabled: false }
)
const emit = defineEmits<{
  (e: 'toggle', id: string): void
  (e: 'inspect', handle: string): void
}>()
function activate(v: DebugVariable) {
  if (v.handle) {
    if (!props.disabled) emit('inspect', v.handle)
  } else if (v.children?.length || v.value.length > 80) emit('toggle', `value:${path(v)}`)
}
const path = (v: DebugVariable) => (props.prefix ? `${props.prefix}.${v.name}` : v.name)
// Objects start folded; the set holds the ones opened.
const openSet = computed(
  () =>
    new Set(
      [...props.folded]
        .filter((id) => id.startsWith('value:'))
        .map((id) => id.slice('value:'.length))
    )
)
const valueEls = ref<HTMLElement[]>([])
const tips = () => valueEls.value.forEach((el) => el.dataset.tip && setTooltip(el, el.dataset.tip))
onMounted(tips)
watch(
  () => props.values,
  () => queueMicrotask(tips),
  { deep: true }
)
</script>

<style lang="scss">
.abele-debug-value {
  max-width: 10em;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-debug-value__detail {
  margin: var(--size-4-2);
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.abele-debug-value_changed > .tree-item-self .abele-debug-value {
  color: var(--text-accent);
}
.abele-debug-panel .abele-tree-item__text {
  flex: 0 1 auto;
  overflow-wrap: anywhere;
}
// A value gives way before the row's edge: it shrinks and ends in an ellipsis inside the row's
// light instead of running past it. The whole value is in its tooltip and opens below the row.
.abele-debug-panel .abele-debug-value_row > .tree-item-self > .tree-item-flair-outer,
.abele-debug-panel .abele-debug-value_row > .tree-item-self .abele-tree-item__end {
  flex-shrink: 1;
  min-width: 0;
}
</style>
