<template>
  <div class="abele-node-log">
    <div class="abele-node-log__bar">
      <span class="abele-node-log__facts">{{ version }}</span>
      <Dropdown v-model="model.level.value" :options="options" :aria-label="t('node.log.filter')" />
      <Icon
        icon="refresh-cw"
        :tooltip="t('node.action.refresh')"
        :disabled="offline || model.busy.value"
        @click="model.refresh()"
      />
      <Icon icon="copy" :tooltip="t('node.log.copy')" @click="copy" />
    </div>
    <div v-if="offline" class="abele-state-line abele-node-log__offline">
      <div class="abele-state-line__head">
        <StatusDot tone="faint" :label="t('node.state.offline')" />
        <span class="abele-state-line__text">{{ t('node.log.offline') }}</span>
      </div>
    </div>
    <NodeErrorLine
      v-if="model.error.value && !offline"
      :error="model.error.value"
      :refresh="() => model.refresh()"
      :disabled="model.busy.value"
    />
    <div v-if="model.truncated.value" role="status">{{ t('node.log.truncated') }}</div>
    <EmptyState
      v-if="!shown.length"
      :variant="model.busy.value ? 'loading' : 'empty'"
      :text="emptyText"
    />
    <div ref="list" class="abele-node-log__lines" role="log" aria-live="polite">
      <div
        v-for="(line, i) in shown"
        :key="i"
        class="abele-node-log__line"
        :class="{ 'is-marked': !!line.time && line.time === model.marked.value }"
      >
        <span class="abele-node-log__time" :title="line.time || undefined">{{
          line.time ? new Date(line.time).toLocaleTimeString() : t('node.log.unknownTime')
        }}</span>
        <StatusDot
          :tone="line.level === 'error' ? 'red' : line.level === 'warn' ? 'orange' : 'faint'"
          :label="line.level"
        />
        <span class="abele-node-log__text">{{ line.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// The node's own log, read from the node: newest at the bottom, the moment of the error marked
// and scrolled to. The last bounded snapshot stays in memory for reopening offline.
import { computed, nextTick, ref, watch } from 'vue'
import { t } from '@/i18n'
import StatusDot from '@/components/obsidian/StatusDot.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import NodeErrorLine from './NodeErrorLine.vue'
import type { NodeLogModel } from '@/node/NodeLogModel'

const props = defineProps<{ model: NodeLogModel; version?: string; offline?: boolean }>()
const list = ref<HTMLElement>()
const shown = computed(() => props.model.shown.value)
const options = computed(() => [
  { value: 'all', display: t('node.log.all') },
  { value: 'warn', display: t('node.log.warnings') },
])
const emptyText = computed(() =>
  t(
    props.model.busy.value
      ? 'node.log.loading'
      : props.model.reason.value === 'logs_missing'
        ? 'node.log.missing'
        : props.model.reason.value === 'logs_unavailable'
          ? 'node.log.unavailable'
          : 'node.log.empty'
  )
)
async function copy() {
  await navigator.clipboard.writeText(props.model.copyText())
}
watch(
  shown,
  async () => {
    await nextTick()
    const marked = list.value?.querySelector<HTMLElement>('.is-marked')
    if (marked) marked.scrollIntoView?.({ block: 'center' })
    else list.value?.scrollTo?.(0, list.value.scrollHeight)
  },
  { immediate: true }
)
</script>

<style>
.abele-node-log {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  min-width: 0;
}
.abele-node-log__bar {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-node-log__facts {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-node-log__lines {
  height: min(60vh, 440px);
  overflow: auto;
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-1) 0;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-node-log__line {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  padding: 1px var(--size-4-2);
}
.abele-node-log__line .abele-status-dot {
  flex: none;
  transform: translateY(-1px);
}
.abele-node-log__line.is-marked {
  background: var(--background-modifier-active-hover);
}
.abele-node-log__time {
  flex: none;
  color: var(--text-faint);
}
.abele-node-log__text {
  white-space: pre-wrap;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-normal);
}
.is-phone .abele-node-log__lines {
  height: auto;
  max-height: none;
  flex: 1 1 auto;
}
.is-phone .abele-node-log__line {
  flex-wrap: wrap;
  row-gap: 0;
}
.is-phone .abele-node-log__text {
  flex-basis: 100%;
}
</style>
