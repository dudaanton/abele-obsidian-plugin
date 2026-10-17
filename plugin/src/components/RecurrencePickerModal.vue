<template>
  <ObsidianModal :title="t('area.recurrence')" close-in-footer @close="emit('cancel')">
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
        :text="t('area.clear')"
        :tooltip="t('area.takeTheRecurrenceOff')"
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
        :tooltip="t('area.setThisRecurrence')"
        @click="picker?.confirm()"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
