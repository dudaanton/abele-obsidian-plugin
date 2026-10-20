<template>
  <ObsidianModal :title="t('sync.arrived.title')" phone-sheet @close="emit('close', questionKey)">
    <StagedSettingsBlock
      :changes="changes"
      :names="names"
      :port="port"
      @decided="emit('close', questionKey)"
    >
      <template #actions="{ busy }">
        <Button
          :text="t('sync.arrived.later')"
          :disabled="busy"
          :tooltip="t('sync.arrived.laterTip')"
          @click="emit('close', questionKey)"
        />
      </template>
    </StagedSettingsBlock>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * Asked once per new batch of staged settings (`StagedSettingsPrompt`), and once at a start
 * while any wait. Later leaves them staged; the Sync tab keeps the same answers for as long as
 * they do.
 */
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import type { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import StagedSettingsBlock from './StagedSettingsBlock.vue'
import { useI18n } from '@/i18n/useI18n'

const { t } = useI18n()

defineProps<{
  changes: ChangeItem[]
  names: Record<string, string>
  questionKey?: number
  port?: TokenSettingsPort
}>()

const emit = defineEmits<{ (e: 'close', questionKey?: number): void }>()
</script>
