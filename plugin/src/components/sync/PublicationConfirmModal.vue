<template>
  <ObsidianModal title="Publish linked private file?" phone-sheet @close="emit('close')">
    <div class="abele-publication-confirm">
      <p>
        Publish <strong>{{ question.observation.target.path }}</strong> to
        <strong>{{ question.observation.audience.label }}</strong
        >?
      </p>
      <p>
        Linked from {{ question.observation.sponsor.path }}. Personal sync continues either way.
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="abele-confirm__actions">
        <Button
          text="Close"
          tooltip="Leave the question pending without publishing"
          @click="emit('close')"
        />
        <Button
          text="Keep private"
          :disabled="busy"
          tooltip="Remember no publication to this audience"
          @click="emit('answer', false)"
        />
        <Button
          text="Publish"
          :accent="true"
          :disabled="busy"
          tooltip="Publish this file to the displayed audience"
          @click="emit('answer', true)"
        />
      </div>
    </div>
  </ObsidianModal>
</template>
<script setup lang="ts">
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
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
