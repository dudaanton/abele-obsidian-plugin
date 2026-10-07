<template>
  <ObsidianModal title="Share this private file?" phone-sheet @close="emit('close')">
    <div class="abele-publication-confirm">
      <p>
        This file is private. Share <strong>{{ question.observation.target.path }}</strong> with
        <strong>{{ question.observation.audience.label }}</strong
        >?
      </p>
      <p>
        Linked from {{ question.observation.sponsor.path }}. Your own files keep syncing either way.
      </p>
      <p v-if="error" role="alert">
        {{
          sharingErrorMessage(
            error,
            'The file or shared group may have changed. Review it again before sharing.'
          )
        }}
      </p>
      <div class="abele-confirm__actions">
        <Button
          text="Close"
          tooltip="Decide later without sharing the file"
          @click="emit('close')"
        />
        <Button
          text="Keep private"
          :disabled="busy"
          tooltip="Keep this file private for this folder or group"
          @click="emit('answer', false)"
        />
        <Button
          text="Share"
          :accent="true"
          :disabled="busy"
          tooltip="Share this file with the named folder or group"
          @click="emit('answer', true)"
        />
      </div>
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { sharingErrorMessage } from './sharingText'
import type { ExistingPublicationQuestion } from '@/sync/publication/publicationDecision'
defineProps<{ question: ExistingPublicationQuestion; busy?: boolean; error?: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'answer', accepted: boolean): void }>()
</script>
<style scoped>
.abele-publication-confirm {
  overflow-wrap: anywhere;
}
.abele-confirm__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
