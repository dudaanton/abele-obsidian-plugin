<template>
  <TreeItem
    v-for="v in values"
    :key="path(v)"
    :text="v.name"
    :title="v.name"
    :collapsible="!!v.children?.length || !!v.handle || revealsInPlace(v)"
    :collapsed="!openSet.has(path(v))"
    class="abele-debug-value_row"
    :class="{ 'abele-debug-value_changed': v.changed }"
    @click="activate(v)"
  >
    <template #end>
      <span
        ref="valueEls"
        class="abele-debug-value"
        :data-tip="
          [v.type, opensWhole(v) ? t('streamC.9c7037a3d0026c7f') : v.value]
            .filter(Boolean)
            .join(' · ')
        "
        >{{ v.value }}</span
      >
    </template>
    <pre v-if="revealsInPlace(v)" class="abele-debug-value__detail">{{ v.value }}</pre>
    <DebugValues
      v-if="v.children?.length"
      :values="v.children"
      :folded="folded"
      :prefix="path(v)"
      :disabled="disabled"
      @toggle="(id) => emit('toggle', id)"
      @inspect="emit('inspect', $event)"
      @open="(n, f, t) => emit('open', n, f, t)"
    />
  </TreeItem>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

// Variables as a tree: name on the left, value at the end of the row, objects open in place. A
// value the last step changed is drawn in the accent colour; its type is in the tooltip. A value
// the row shows only the start of — a document, a payload — opens whole in a tab of its own, laid
// out and coloured, by the row alone; a long plain value opens under its row.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import TreeItem from '../obsidian/TreeItem.vue'
import type { DebugVariable } from './types'
import { wholeValue } from './valueFormat'

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
  /** A value too long for its row, to be read whole. */
  (e: 'open', name: string, value: string, type?: string): void
}>()
// A document the row shows only the start of opens in a tab; a long plain value opens under its row.
const opensWhole = (v: DebugVariable) =>
  !v.children?.length && !v.handle && wholeValue(v.value, v.full) !== undefined
const revealsInPlace = (v: DebugVariable) =>
  !v.children?.length && !v.handle && !opensWhole(v) && v.value.length > 80
function activate(v: DebugVariable) {
  if (v.handle) {
    if (!props.disabled) {
      if (!openSet.value.has(path(v))) emit('toggle', `value:${path(v)}`)
      emit('inspect', v.handle)
    }
  } else if (v.children?.length || revealsInPlace(v)) emit('toggle', `value:${path(v)}`)
  else if (opensWhole(v)) emit('open', path(v), wholeValue(v.value, v.full), v.type)
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
.abele-debug-panel .abele-debug-value_row .abele-tree-item__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
// A value gives way before the row's edge: it shrinks and ends in an ellipsis inside the row's
// light instead of running past it. The whole value is in its tooltip and opens below the row.
.abele-debug-panel .abele-debug-value_row > .tree-item-self > .tree-item-flair-outer,
.abele-debug-panel .abele-debug-value_row > .tree-item-self .abele-tree-item__end {
  flex-shrink: 1;
  min-width: 0;
}
</style>
