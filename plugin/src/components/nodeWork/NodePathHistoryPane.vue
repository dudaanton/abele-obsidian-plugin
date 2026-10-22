<template>
  <div class="abele-node-main">
    <div v-if="model.error.value" role="alert"><NodeErrorText :error="model.error.value" /></div>
    <div v-if="model.busy.value" role="status">{{ t('node.loading.history') }}</div>
    <div v-if="offline" role="status">{{ t('streamB.offlineRetainedHistory.ebd3ac') }}</div>
    <HistoryView
      :commits="model.commits.value"
      :copy="copy"
      :base="base"
      :open="model.openCommit.value"
      :more="!!model.cursor.value"
      @open-commit="act(() => model.open($event))"
      @more="act(() => model.load(true))"
      @menu="(event, what, selection) => emit('menu', event, what, selection)"
      @ask="(path, selection) => emit('ask', path, selection)"
      @add="(path, selection) => emit('add', path, selection)"
      @note="(path, selection) => emit('note', path, selection)"
    />
  </div>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { t } from '@/i18n'
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
import type { FileSelection } from './fileSelection'
const emit = defineEmits<{
  menu: [event: MouseEvent, what: string, selection: string]
  ask: [path: string, selection: FileSelection]
  add: [path: string, selection: FileSelection]
  note: [path: string, selection: FileSelection]
}>()
const act = (run: () => Promise<void>) => {
  void run().catch(() => {})
}
</script>
