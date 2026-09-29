<template>
  <ObsidianModal title="Deletions held back" size="tall" @close="emit('close')">
    <HeldDeletesBlock :held="held" @decided="emit('close')">
      <template #actions="{ busy }">
        <Button
          text="Decide later"
          :disabled="busy"
          tooltip="Close this; the files stay held, and the Sync tab still has this question"
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
import type { HeldDelete } from '@abele/sync-core'
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import HeldDeletesBlock from './HeldDeletesBlock.vue'

defineProps<{ held: HeldDelete[] }>()

const emit = defineEmits<{ (e: 'close'): void }>()
</script>
