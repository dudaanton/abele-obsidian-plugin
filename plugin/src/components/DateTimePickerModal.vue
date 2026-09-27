<template>
  <ObsidianModal :title="title" @close="emit('cancel')">
    <DateTimePicker
      ref="picker"
      :initial-date="initialDate"
      :initial-time="initialTime"
      @confirm="emit('confirm', $event)"
      @clear="emit('clear')"
      @cancel="emit('cancel')"
    />
    <template #footer>
      <Button
        text="Confirm"
        accent
        :disabled="!picker?.canConfirm"
        tooltip="Set this date"
        @click="picker?.confirm()"
      />
      <Button text="Clear" tooltip="Take the date off" @click="emit('clear')" />
      <Button text="Cancel" tooltip="Close this and change nothing" @click="emit('cancel')" />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import DateTimePicker from './DateTimePicker.vue'
import Button from './obsidian/Button.vue'

const props = defineProps<{
  mode: 'event' | 'due'
  initialDate?: dayjs.Dayjs
  initialTime?: string | null
}>()

const picker = useTemplateRef<InstanceType<typeof DateTimePicker>>('picker')

const title = computed(() => (props.mode === 'event' ? 'Event Date' : 'Due Date'))

const emit = defineEmits<{
  (e: 'confirm', result: { date: dayjs.Dayjs; time: string | null }): void
  (e: 'clear'): void
  (e: 'cancel'): void
}>()
</script>

<style lang="scss">
.modal:has(.abele-datetime-picker) {
  width: 380px;
}
</style>
