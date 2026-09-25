<template>
  <ObsidianModal :title="heading || title" @close="emit('cancel')">
    <DateTimePicker
      :initial-date="initialDate"
      :initial-time="initialTime"
      :date-only="dateOnly"
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
  /** The dialog's title, where "Event Date" and "Due Date" are not what is being chosen. */
  heading?: string
  dateOnly?: boolean
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
  /*
   * Never taller than the room the dialog stands in, so that it scrolls rather than being cut
   * at both ends. Obsidian's own cap is written in viewport units, which keep the height of
   * the whole screen while the keyboard takes half of it. Twice the top inset because the
   * dialog is centred: that keeps its top edge below the notch.
   */
  max-height: min(var(--dialog-max-height, 100%), calc(100% - 2 * var(--safe-area-inset-top, 0px)));
}
</style>
