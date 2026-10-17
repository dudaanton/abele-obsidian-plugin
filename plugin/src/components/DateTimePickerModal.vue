<template>
  <ObsidianModal :title="title" close-in-footer @close="emit('cancel')">
    <DateTimePicker
      ref="picker"
      :initial-date="initialDate"
      :initial-time="initialTime"
      @confirm="emit('confirm', $event)"
      @clear="emit('clear')"
      @cancel="emit('cancel')"
    />
    <template #footer>
      <!-- As Obsidian orders them: the one that takes the value off apart, the answer last. -->
      <Button
        class="abele-modal__apart"
        :text="t('area.clear')"
        :tooltip="t('area.takeTheDateOff')"
        @click="emit('clear')"
      />
      <Button
        :text="t('area.cancel')"
        :tooltip="t('area.closeThisAndChangeNothing')"
        @click="emit('cancel')"
      />
      <Button
        :text="t('area.confirm')"
        accent
        :disabled="!picker?.canConfirm"
        :tooltip="t('area.setThisDate')"
        @click="picker?.confirm()"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, useTemplateRef } from 'vue'
import dayjs from 'dayjs'
import ObsidianModal from './obsidian/Modal.vue'
import DateTimePicker from './DateTimePicker.vue'
import Button from './obsidian/Button.vue'

const props = defineProps<{
  mode: 'event' | 'due'
  /** The window's name when it is not a task's date: the property it sets. */
  title?: string
  initialDate?: dayjs.Dayjs
  initialTime?: string | null
}>()

const picker = useTemplateRef<InstanceType<typeof DateTimePicker>>('picker')

const title = computed(
  () => props.title ?? (props.mode === 'event' ? t('area.eventDate') : t('area.dueDate'))
)

const emit = defineEmits<{
  (e: 'confirm', result: { date: dayjs.Dayjs; time: string | null }): void
  (e: 'clear'): void
  (e: 'cancel'): void
}>()
</script>
