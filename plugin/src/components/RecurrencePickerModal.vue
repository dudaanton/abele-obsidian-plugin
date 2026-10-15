<template>
  <ObsidianModal title="Recurrence" close-in-footer @close="emit('cancel')">
    <RecurrencePicker
      ref="picker"
      :initial-pattern="initialPattern"
      @confirm="emit('confirm', $event)"
      @clear="emit('clear')"
      @cancel="emit('cancel')"
    />
    <template #footer>
      <!-- As Obsidian orders them: the one that takes the value off apart, the answer last. -->
      <Button
        class="abele-modal__apart"
        text="Clear"
        tooltip="Take the recurrence off"
        @click="emit('clear')"
      />
      <Button text="Cancel" tooltip="Close this and change nothing" @click="emit('cancel')" />
      <Button
        text="Confirm"
        accent
        :disabled="!picker?.canConfirm"
        tooltip="Set this recurrence"
        @click="picker?.confirm()"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import { useTemplateRef } from 'vue'
import RecurrencePicker from './RecurrencePicker.vue'
import Button from './obsidian/Button.vue'

const picker = useTemplateRef<InstanceType<typeof RecurrencePicker>>('picker')

defineProps<{
  initialPattern?: string | null
}>()

const emit = defineEmits<{
  (e: 'confirm', pattern: string): void
  (e: 'clear'): void
  (e: 'cancel'): void
}>()
</script>
