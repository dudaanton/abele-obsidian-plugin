<template>
  <TreeItem
    v-for="v in values"
    :key="path(v)"
    :text="v.name"
    :collapsible="!!v.children?.length"
    :collapsed="!!v.children?.length && !openSet.has(path(v))"
    :class="{ 'abele-debug-value_changed': v.changed }"
    @click="v.children?.length && emit('toggle', `value:${path(v)}`)"
  >
    <template #end>
      <span ref="valueEls" class="abele-debug-value" :data-tip="v.type ?? ''">{{ v.value }}</span>
    </template>
    <DebugValues
      v-if="v.children?.length"
      :values="v.children"
      :folded="folded"
      :prefix="path(v)"
      @toggle="(id) => emit('toggle', id)"
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
  defineProps<{ values: DebugVariable[]; folded: Set<string>; prefix?: string }>(),
  { prefix: '' }
)
const emit = defineEmits<{ (e: 'toggle', id: string): void }>()
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
.abele-debug-value_changed > .tree-item-self .abele-debug-value {
  color: var(--text-accent);
}
.abele-debug-panel .abele-tree-item__text {
  flex: 0 0 auto;
  overflow-wrap: normal;
}
</style>
