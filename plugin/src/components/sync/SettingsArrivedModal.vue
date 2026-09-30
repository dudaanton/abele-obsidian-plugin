<template>
  <ObsidianModal
    title="Settings changed on another device"
    phone-sheet
    @close="emit('close', questionKey)"
  >
    <StagedSettingsBlock :changes="changes" :names="names" @decided="emit('close', questionKey)">
      <template #actions="{ busy }">
        <Button
          text="Later"
          :disabled="busy"
          tooltip="Close this; the settings wait, and the Sync tab still has them"
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
import type { ChangeItem } from '@abele/sync-protocol'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import StagedSettingsBlock from './StagedSettingsBlock.vue'

defineProps<{ changes: ChangeItem[]; names: Record<string, string>; questionKey?: number }>()

const emit = defineEmits<{ (e: 'close', questionKey?: number): void }>()
</script>
