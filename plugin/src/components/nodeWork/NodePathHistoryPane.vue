<template>
  <div class="abele-node-main">
    <div v-if="model.error.value" role="alert">{{ model.error.value }}</div>
    <div v-if="model.busy.value" role="status">Loading history…</div>
    <div v-if="offline" role="status">Offline · retained history.</div>
    <HistoryView
      :commits="model.commits.value"
      :copy="copy"
      :base="base"
      :open="model.openCommit.value"
      :more="!!model.cursor.value"
      @open-commit="act(() => model.open($event))"
      @more="act(() => model.load(true))"
      @menu="(event, what, selection) => emit('menu', event, what, selection)"
    />
  </div>
</template>
<script setup lang="ts">
import type { NodePathHistoryModel } from '@/node/NodePathHistoryModel'
import type { CopySummary } from './types'
import HistoryView from './HistoryView.vue'
withDefaults(
  defineProps<{
    model: NodePathHistoryModel
    copy?: CopySummary
    base?: string
    offline?: boolean
  }>(),
  { copy: undefined, base: undefined, offline: false }
)
const emit = defineEmits<{ menu: [event: MouseEvent, what: string, selection: string] }>()
const act = (run: () => Promise<void>) => {
  void run().catch(() => {})
}
</script>
