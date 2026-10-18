<template>
  <!-- A value a step took, as a row: its name, how it reads in a line, its size at the end — or
       `=` when it came through unchanged, `••••` when it was blanked before writing. Opened, its
       shape; under it what changed since the last time. -->
  <TreeItem
    class="abele-trace-value"
    :class="{ 'abele-trace-value_quiet': value.same || value.masked }"
    :text="value.name"
    :note="value.masked ? undefined : value.brief"
    :collapsible="!!value.shape"
    :collapsed="!open"
    @click="value.shape ? (open = !open) : value.text && emit('open-whole')"
  >
    <template #end>
      <Icon
        v-if="value.failed"
        class="abele-trace-value__failed"
        icon="circle-x"
        size="xs"
        :tooltip="t('streamC.c74445736819b71e', { v1: String(value.failed) })"
        no-hover
      />
      <span v-else ref="sizeEl" class="abele-trace-value__size" :aria-label="sizeWords">{{
        sizeText
      }}</span>
    </template>
    <template v-if="!value.masked && !value.failed" #actions>
      <Icon
        v-if="value.text && value.shape"
        icon="maximize-2"
        size="xs"
        :tooltip="t('streamC.cd575f27a80c5b7f')"
        @click.stop="emit('open-whole')"
      />
      <Icon
        icon="flag"
        size="xs"
        :tooltip="t('streamC.c9931d04be9bb99b')"
        @click.stop="emit('mark', '$')"
      />
    </template>

    <template v-if="value.shape">
      <TraceShape
        :name="value.name"
        :shape="value.shape"
        :open="1"
        @follow="(p, v) => emit('follow', p, v)"
        @mark="(p) => emit('mark', p)"
        @open="(p) => emit('open-whole', p)"
      />
      <div
        v-if="value.changes"
        class="abele-trace-value__changes"
        role="button"
        tabindex="0"
        @click="emit('open-changes')"
        @keydown.enter="emit('open-changes')"
      >
        <Icon icon="diff" size="xs" no-hover />
        <span>{{ value.changes.summary }}</span>
      </div>
    </template>
  </TreeItem>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../../obsidian/Icon.vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import TraceShape from './TraceShape.vue'
import { bytes } from './format'
import type { TraceValue } from './types'

const props = withDefaults(defineProps<{ value: TraceValue; initiallyOpen?: boolean }>(), {
  initiallyOpen: false,
})
const emit = defineEmits<{
  (e: 'open-whole', path?: string): void
  (e: 'open-changes'): void
  (e: 'follow', path: string, value: string): void
  (e: 'mark', path: string): void
}>()

const open = ref(props.initiallyOpen)
const sizeEl = ref<HTMLElement>()
const sizeText = computed(() =>
  props.value.masked ? '••••' : props.value.same ? '=' : bytes(props.value.bytes)
)
const sizeWords = computed(() =>
  props.value.masked
    ? t('streamC.d4032f9dc56c6229')
    : props.value.same
      ? t('streamC.93eb14f85a3d3915')
      : `${bytes(props.value.bytes)}, ${props.value.format}`
)
const tip = () => sizeEl.value && setTooltip(sizeEl.value, sizeWords.value)
onMounted(tip)
watch(sizeWords, tip)
</script>

<style lang="scss">
.abele-trace-value > .tree-item-self .tree-item-inner {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
// The name whole, the line it reads as cut at the row's end.
.abele-trace-value > .tree-item-self .abele-tree-item__text {
  flex: 0 0 auto;
}
.abele-trace-value > .tree-item-self .abele-tree-item__note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
// On a phone the code keeps the row's size, so its line stands level with the glyphs.
body.is-phone .abele-trace-value > .tree-item-self .tree-item-inner {
  font-size: inherit;
}
.abele-trace-value_quiet > .tree-item-self {
  color: var(--text-muted);
}
.abele-trace-value__size {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-trace-value__failed {
  color: var(--text-error);
}
// What changed since the last time: a quiet line under the shape that opens the comparison.
.abele-trace-value__changes {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin: var(--size-2-2) 0 var(--size-4-1) var(--size-4-5);
  padding: var(--size-2-2) var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}
</style>
