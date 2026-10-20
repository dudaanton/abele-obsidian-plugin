<template>
  <ObsidianModal :title="t('sync.held.title')" size="tall" @close="emit('close')">
    <HeldDeletesBlock :held="held" :port="port" @decided="emit('close')">
      <template #actions="{ busy }">
        <Button
          :text="t('sync.held.later')"
          :disabled="busy"
          :tooltip="t('sync.held.laterTip')"
          @click="emit('close')"
        />
      </template>
    </HeldDeletesBlock>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * Asked once per new set of held deletes (`HeldDeletesPrompt`): on a desktop when the hold is
 * found, on a phone when the app is next in front. Putting it off keeps the files held; the same
 * question stays on the Sync tab for as long as they are.
 */
import type { HeldDelete } from '@abele/sync-sdk/core'
import type { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import HeldDeletesBlock from './HeldDeletesBlock.vue'
import { useI18n } from '@/i18n/useI18n'

const { t } = useI18n()

defineProps<{ held: HeldDelete[]; port?: TokenSettingsPort }>()

const emit = defineEmits<{ (e: 'close'): void }>()
</script>
