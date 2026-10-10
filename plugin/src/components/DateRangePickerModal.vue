<template>
  <ObsidianModal title="Select date range" close-in-footer @close="emit('cancel')">
    <div class="abele-date-range-picker">
      <Setting name="From" desc="Start date of the range">
        <div class="abele-date-range-picker__input-row">
          <Input
            :model-value="fromDisplay"
            aria-label="Start date"
            placeholder="YYYY-MM-DD"
            @commit="onFromInput"
          />
          <ObsidianIcon
            icon="calendar"
            tooltip="Choose start date"
            @click="calendarTarget = 'from'"
          />
        </div>
      </Setting>
      <Setting name="To" desc="End date of the range">
        <div class="abele-date-range-picker__input-row">
          <Input
            :model-value="toDisplay"
            aria-label="End date"
            placeholder="YYYY-MM-DD"
            @commit="onToInput"
          />
          <ObsidianIcon icon="calendar" tooltip="Choose end date" @click="calendarTarget = 'to'" />
        </div>
      </Setting>
    </div>

    <ObsidianModal
      v-if="calendarTarget"
      :title="calendarTarget === 'from' ? 'Select start date' : 'Select end date'"
      @close="calendarTarget = null"
    >
      <div class="abele-date-range-picker__calendar-wrap">
        <Calendar
          :selected-date="calendarTarget === 'from' ? fromDate : toDate"
          @date-selected="onCalendarSelect"
        />
      </div>
    </ObsidianModal>
    <template #footer>
      <ObsidianButton
        text="Apply"
        tooltip="Apply this date range"
        accent
        :disabled="!fromDate || !toDate"
        @click="apply"
      />
      <ObsidianButton text="Reset" tooltip="Reset the date range" @click="emit('reset')" />
      <ObsidianButton text="Cancel" tooltip="Close without applying" @click="emit('cancel')" />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import Setting from './obsidian/Setting.vue'
import Calendar from './Calendar.vue'
import Input from './obsidian/Input.vue'

const props = defineProps<{
  initialFrom?: dayjs.Dayjs
  initialTo?: dayjs.Dayjs
}>()

const emit = defineEmits<{
  (e: 'apply', range: { from: dayjs.Dayjs; to: dayjs.Dayjs }): void
  (e: 'reset'): void
  (e: 'cancel'): void
}>()

const fromDate = ref<dayjs.Dayjs | undefined>(props.initialFrom)
const toDate = ref<dayjs.Dayjs | undefined>(props.initialTo)
const calendarTarget = ref<'from' | 'to' | null>(null)

const fromDisplay = computed(() => fromDate.value?.format(DATE_FORMAT) ?? '')
const toDisplay = computed(() => toDate.value?.format(DATE_FORMAT) ?? '')

const onFromInput = (val: string) => {
  const d = dayjs(val, DATE_FORMAT)
  if (d.isValid()) fromDate.value = d
}

const onToInput = (val: string) => {
  const d = dayjs(val, DATE_FORMAT)
  if (d.isValid()) toDate.value = d
}

const onCalendarSelect = (date: dayjs.Dayjs) => {
  if (calendarTarget.value === 'from') {
    fromDate.value = date
  } else {
    toDate.value = date
  }
  calendarTarget.value = null
}

const apply = () => {
  if (!fromDate.value || !toDate.value) return

  const from = fromDate.value.isBefore(toDate.value) ? fromDate.value : toDate.value
  const to = fromDate.value.isBefore(toDate.value) ? toDate.value : fromDate.value

  emit('apply', { from: from.startOf('day'), to: to.endOf('day') })
}
</script>

<style lang="scss">
.abele-date-range-picker {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-date-range-picker__input-row {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);

  min-width: 0;

  .abele-obsidian-input {
    flex: 1;
  }
}

.abele-date-range-picker__calendar-wrap {
  padding: var(--size-4-2) 0;
}
</style>
