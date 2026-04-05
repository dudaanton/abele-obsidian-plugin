<template>
  <ObsidianModal :title="title" @close="emit('cancel')">
    <DateTimePicker
      :initial-date="initialDate"
      :initial-time="initialTime"
      @confirm="emit('confirm', $event)"
      @clear="emit('clear')"
      @cancel="emit('cancel')"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import DateTimePicker from './DateTimePicker.vue'

const props = defineProps<{
  mode: 'event' | 'due'
  initialDate?: dayjs.Dayjs
  initialTime?: string | null
}>()

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
