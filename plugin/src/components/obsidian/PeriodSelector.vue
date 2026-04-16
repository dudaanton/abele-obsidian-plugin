<template>
  <div class="abele-period-selector">
    <ObsidianIcon icon="chevron-left" tooltip="Previous month" @click="previousMonth" />
    <div class="abele-period-selector__title" @click="pickerOpen = true">{{ label }}</div>
    <ObsidianIcon icon="chevron-right" tooltip="Next month" @click="nextMonth" />

    <DateRangePickerModal
      v-if="pickerOpen"
      :initial-from="start"
      :initial-to="end"
      @apply="onApply"
      @reset="onReset"
      @cancel="pickerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import ObsidianIcon from './Icon.vue'
import DateRangePickerModal from '../DateRangePickerModal.vue'

const start = defineModel<dayjs.Dayjs>('start', { required: true })
const end = defineModel<dayjs.Dayjs>('end', { required: true })

const emit = defineEmits<{
  'custom-applied': []
  'custom-reset': []
}>()

const selectedMonth = ref(dayjs().month())
const selectedYear = ref(dayjs().year())
const customFrom = ref<dayjs.Dayjs | null>(null)
const customTo = ref<dayjs.Dayjs | null>(null)
const pickerOpen = ref(false)

const isCustomRange = computed(() => customFrom.value !== null && customTo.value !== null)

const label = computed(() => {
  if (isCustomRange.value) {
    const from = customFrom.value!.format('MMM D, YYYY')
    const to = customTo.value!.format('MMM D, YYYY')
    return `${from} — ${to}`
  }
  return dayjs().year(selectedYear.value).month(selectedMonth.value).format('MMMM YYYY')
})

const computedStart = computed(() =>
  isCustomRange.value
    ? customFrom.value!
    : dayjs().year(selectedYear.value).month(selectedMonth.value).startOf('month')
)
const computedEnd = computed(() =>
  isCustomRange.value
    ? customTo.value!
    : dayjs().year(selectedYear.value).month(selectedMonth.value).endOf('month')
)

watch(
  [computedStart, computedEnd],
  ([s, e]) => {
    start.value = s
    end.value = e
  },
  { immediate: true }
)

function previousMonth() {
  customFrom.value = null
  customTo.value = null
  if (selectedMonth.value === 0) {
    selectedMonth.value = 11
    selectedYear.value -= 1
  } else {
    selectedMonth.value -= 1
  }
}

function nextMonth() {
  customFrom.value = null
  customTo.value = null
  if (selectedMonth.value === 11) {
    selectedMonth.value = 0
    selectedYear.value += 1
  } else {
    selectedMonth.value += 1
  }
}

function onApply(range: { from: dayjs.Dayjs; to: dayjs.Dayjs }) {
  customFrom.value = range.from
  customTo.value = range.to
  pickerOpen.value = false
  emit('custom-applied')
}

function onReset() {
  customFrom.value = null
  customTo.value = null
  selectedMonth.value = dayjs().month()
  selectedYear.value = dayjs().year()
  pickerOpen.value = false
  emit('custom-reset')
}
</script>

<style lang="scss">
.abele-period-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--size-4-2);
}

.abele-period-selector__title {
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;

  &:hover {
    color: var(--text-accent);
  }
}
</style>
