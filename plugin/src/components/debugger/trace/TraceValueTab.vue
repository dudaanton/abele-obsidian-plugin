<template>
  <!-- A value of a run opened whole in its tab: where it is from in a quiet line — the run, the
       step, the name, the path inside — and one of three ways to read it, picked by glyphs in
       the tab's header: its shape, the whole text, or what changed since the step before. -->
  <div class="abele-trace-value-tab">
    <div class="abele-trace-value-tab__crumbs" :aria-label="t('streamC.d948411258a02660')">
      <span>{{ runName }}</span>
      <span class="abele-trace-value-tab__sep">›</span>
      <span>{{ stepLabel }}</span>
      <span class="abele-trace-value-tab__sep">›</span>
      <span class="abele-trace-value-tab__code">{{ value.name }}</span>
      <template v-if="path && path !== '$'">
        <span class="abele-trace-value-tab__sep">›</span>
        <span class="abele-trace-value-tab__code abele-trace-value-tab__path">{{ path }}</span>
      </template>
      <span class="abele-trace-value-tab__size">{{ bytes(value.bytes) }}</span>
    </div>

    <TraceShape
      v-if="view === 'shape' && value.shape"
      :name="value.name"
      :shape="value.shape"
      :open="3"
      @follow="(p, v) => emit('follow', v)"
      @mark="(p) => emit('mark', p)"
      @open="(p) => emit('path', p)"
    />
    <template v-else-if="view === 'changes' && value.changes">
      <div class="abele-trace-value-tab__summary">{{ value.changes.summary }}</div>
      <Diff
        :text-left="value.changes.before"
        :text-right="value.changes.after"
        layout="auto"
        :label-before="t('streamC.8a883a619d5fafea')"
        :label-after="t('streamC.9d62c9798cba0406')"
        :empty-text="t('streamC.874ab5c895535572')"
      />
    </template>
    <DebugValueView
      v-else-if="value.text"
      :name="value.name"
      :value="value.text"
      :type="value.format"
      :mode="mode"
      :wrap="wrap"
    />
    <EmptyState v-else :text="t('streamC.29cdc3975abc8cad')" />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import Diff from '../../Diff.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import DebugValueView from '../DebugValueView.vue'
import TraceShape from './TraceShape.vue'
import { bytes } from './format'
import type { TraceValue } from './types'

withDefaults(
  defineProps<{
    runName: string
    stepLabel: string
    value: TraceValue
    /** Where inside the value it was opened at: `$.items[7]`. */
    path?: string
    view: 'shape' | 'whole' | 'changes'
    mode?: 'formatted' | 'raw'
    wrap?: boolean
  }>(),
  { path: undefined, mode: 'formatted', wrap: false }
)

const emit = defineEmits<{
  (e: 'follow', value: string): void
  (e: 'mark', path: string): void
  (e: 'path', path: string): void
}>()
</script>

<style lang="scss">
.abele-trace-value-tab {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  min-width: 0;
}
.abele-trace-value-tab__crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--size-2-2) var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-trace-value-tab__sep {
  color: var(--text-faint);
}
.abele-trace-value-tab__code {
  font-family: var(--font-monospace);
}
.abele-trace-value-tab__path {
  color: var(--text-normal);
}
.abele-trace-value-tab__size {
  margin-inline-start: auto;
  font-variant-numeric: tabular-nums;
}
.abele-trace-value-tab__summary {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
</style>
