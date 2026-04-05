<template>
  <ObsidianModal title="Recurrence" @close="emit('cancel')">
    <RecurrencePicker
      :initial-pattern="initialPattern"
      @confirm="emit('confirm', $event)"
      @clear="emit('clear')"
      @cancel="emit('cancel')"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import RecurrencePicker from './RecurrencePicker.vue'

defineProps<{
  initialPattern?: string | null
}>()

const emit = defineEmits<{
  (e: 'confirm', pattern: string): void
  (e: 'clear'): void
  (e: 'cancel'): void
}>()
</script>

<style lang="scss">
.modal:has(.abele-recurrence-picker) {
  width: 380px;
}
</style>
