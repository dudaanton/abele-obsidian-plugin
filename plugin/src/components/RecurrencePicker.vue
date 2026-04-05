<template>
  <div class="abele-recurrence-picker">
    <div class="abele-recurrence-picker__interval">
      <div class="abele-recurrence-picker__interval-label">Repeat every</div>
      <div class="abele-recurrence-picker__interval-row">
        <input
          type="number"
          min="1"
          max="99"
          :value="intervalValue"
          class="abele-recurrence-picker__interval-input"
          @input="
            intervalValue = Math.max(1, parseInt(($event.target as HTMLInputElement).value) || 1)
          "
        />
        <ObsidianDropdown
          :model-value="intervalUnit"
          :options="unitOptions"
          @update:model-value="intervalUnit = $event as IntervalUnitType"
        />
      </div>
    </div>

    <div v-if="intervalUnit === 'week'" class="abele-recurrence-picker__weekdays">
      <div class="abele-recurrence-picker__weekdays-label">On days</div>
      <div class="abele-recurrence-picker__weekdays-row">
        <ObsidianIcon
          v-for="day in weekdayOptions"
          :key="day.value"
          :text-right="day.label"
          with-bg
          :class="{ 'abele-recurrence-picker__day_active': selectedWeekdays.includes(day.value) }"
          @click="toggleWeekday(day.value)"
        />
      </div>
    </div>

    <div v-if="intervalUnit === 'month'" class="abele-recurrence-picker__month-options">
      <div class="abele-recurrence-picker__month-label">On</div>
      <div class="abele-recurrence-picker__month-modes">
        <ObsidianIcon
          text-right="Specific days"
          with-bg
          :class="{ 'abele-recurrence-picker__day_active': monthMode === 'days' }"
          @click="monthMode = 'days'"
        />
        <ObsidianIcon
          text-right="Weekday"
          with-bg
          :class="{ 'abele-recurrence-picker__day_active': monthMode === 'positional' }"
          @click="monthMode = 'positional'"
        />
        <ObsidianIcon
          text-right="First/Last day"
          with-bg
          :class="{ 'abele-recurrence-picker__day_active': monthMode === 'boundary' }"
          @click="monthMode = 'boundary'"
        />
      </div>

      <div v-if="monthMode === 'days'" class="abele-recurrence-picker__monthdays">
        <input
          type="text"
          placeholder="e.g. 1, 15"
          :value="monthDaysInput"
          @input="monthDaysInput = ($event.target as HTMLInputElement).value"
        />
      </div>

      <div v-if="monthMode === 'positional'" class="abele-recurrence-picker__positional">
        <ObsidianDropdown
          :model-value="position"
          :options="positionOptions"
          @update:model-value="position = $event as PositionType"
        />
        <ObsidianDropdown
          :model-value="positionalWeekday"
          :options="weekdayDropdownOptions"
          @update:model-value="positionalWeekday = $event"
        />
      </div>

      <div v-if="monthMode === 'boundary'" class="abele-recurrence-picker__positional">
        <ObsidianDropdown
          :model-value="position"
          :options="positionOptions"
          @update:model-value="position = $event as PositionType"
        />
        <span class="abele-recurrence-picker__positional-label">day of month</span>
      </div>
    </div>

    <div v-if="intervalUnit === 'year'" class="abele-recurrence-picker__year-options">
      <div class="abele-recurrence-picker__month-label">On</div>
      <div class="abele-recurrence-picker__positional">
        <ObsidianDropdown
          :model-value="position"
          :options="positionOptions"
          @update:model-value="position = $event as PositionType"
        />
        <span class="abele-recurrence-picker__positional-label">day of year</span>
      </div>
    </div>

    <div class="abele-recurrence-picker__from-completion">
      <Checkbox :is-enabled="fromCompletion" @toggle="fromCompletion = !fromCompletion" />
      <span class="abele-recurrence-picker__from-completion-label">From completion</span>
    </div>

    <div class="abele-recurrence-picker__preview">
      <span class="abele-recurrence-picker__preview-label">Pattern:</span>
      <code>{{ pattern }}</code>
    </div>

    <div class="abele-recurrence-picker__buttons">
      <ObsidianButton text="Confirm" accent :disabled="!pattern" @click="confirm" />
      <ObsidianButton text="Clear" @click="emit('clear')" />
      <ObsidianButton text="Cancel" @click="emit('cancel')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianDropdown from './obsidian/Dropdown.vue'
import Checkbox from './obsidian/Checkbox.vue'

const props = defineProps<{
  initialPattern?: string | null
}>()

const emit = defineEmits<{
  (e: 'confirm', pattern: string): void
  (e: 'clear'): void
  (e: 'cancel'): void
}>()

type IntervalUnitType = 'hour' | 'day' | 'week' | 'month' | 'year'
type PositionType = 'first' | 'last'

const intervalValue = ref(1)
const intervalUnit = ref<IntervalUnitType>('day')
const selectedWeekdays = ref<number[]>([])
const monthMode = ref<'days' | 'positional' | 'boundary'>('days')
const monthDaysInput = ref('')
const position = ref<PositionType>('first')
const positionalWeekday = ref('1')
const fromCompletion = ref(false)

const weekdayOptions = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

// Parse initial pattern
if (props.initialPattern) {
  const p = props.initialPattern.toLowerCase().trim()

  if (p.includes('from completion')) fromCompletion.value = true

  const dayOfPeriodMatch = p.match(/every\s+(first|last)\s+day\s+of\s+(month|year)/)
  if (dayOfPeriodMatch) {
    position.value = dayOfPeriodMatch[1] as 'first' | 'last'
    intervalUnit.value = dayOfPeriodMatch[2] as 'month' | 'year'
    if (intervalUnit.value === 'month') monthMode.value = 'boundary'
  }

  const posMatch = !dayOfPeriodMatch && p.match(/every\s+(first|last)\s+(\w+day)/)
  if (posMatch) {
    intervalUnit.value = 'month'
    monthMode.value = 'positional'
    position.value = posMatch[1] as 'first' | 'last'
    const day = weekdayOptions.find((d) => posMatch[2].startsWith(d.label.toLowerCase()))
    positionalWeekday.value = day ? String(day.value) : '1'
  } else {
    const intMatch = p.match(/every\s+(\d+)?\s*(hour|day|week|month|year)/)
    if (intMatch) {
      intervalValue.value = intMatch[1] ? parseInt(intMatch[1]) : 1
      intervalUnit.value = intMatch[2] as any
    }

    const weekMatch = p.match(/on\s+([\w,\s]+?)(?:\s+from|$)/)
    if (weekMatch && intervalUnit.value === 'week') {
      selectedWeekdays.value = weekMatch[1]
        .split(/[,\s]+/)
        .map((d) => weekdayOptions.find((opt) => d.startsWith(opt.label.toLowerCase()))?.value)
        .filter((d): d is number => d !== undefined)
    }

    const monthDaysMatch = p.match(/on\s+([\d,\s]+?)(?:\s+from|$)/)
    if (monthDaysMatch && intervalUnit.value === 'month') {
      monthMode.value = 'days'
      monthDaysInput.value = monthDaysMatch[1].trim()
    }
  }
}

const unitOptions = [
  { value: 'hour', display: 'hour(s)' },
  { value: 'day', display: 'day(s)' },
  { value: 'week', display: 'week(s)' },
  { value: 'month', display: 'month(s)' },
  { value: 'year', display: 'year(s)' },
]

const positionOptions = [
  { value: 'first', display: 'First' },
  { value: 'last', display: 'Last' },
]

const weekdayDropdownOptions = [
  { value: '1', display: 'Monday' },
  { value: '2', display: 'Tuesday' },
  { value: '3', display: 'Wednesday' },
  { value: '4', display: 'Thursday' },
  { value: '5', display: 'Friday' },
  { value: '6', display: 'Saturday' },
  { value: '0', display: 'Sunday' },
]

const toggleWeekday = (day: number) => {
  const idx = selectedWeekdays.value.indexOf(day)
  if (idx === -1) {
    selectedWeekdays.value.push(day)
  } else {
    selectedWeekdays.value.splice(idx, 1)
  }
}

const weekdayName = (day: number): string => {
  return weekdayOptions.find((d) => d.value === day)?.label ?? ''
}

const pattern = computed(() => {
  let result = 'every'

  if (intervalUnit.value === 'month' && monthMode.value === 'positional') {
    const dayName = weekdayDropdownOptions.find((d) => d.value === positionalWeekday.value)?.display
    result += ` ${position.value} ${dayName}`
  } else if (intervalUnit.value === 'month' && monthMode.value === 'boundary') {
    result += ` ${position.value} day of month`
  } else if (intervalUnit.value === 'year') {
    result += ` ${position.value} day of year`
  } else {
    if (intervalValue.value > 1) {
      result += ` ${intervalValue.value}`
    }
    result += ` ${intervalUnit.value}`

    if (intervalUnit.value === 'week' && selectedWeekdays.value.length) {
      const sorted = [...selectedWeekdays.value].sort((a, b) => a - b)
      result += ' on ' + sorted.map(weekdayName).join(', ')
    }

    if (
      intervalUnit.value === 'month' &&
      monthMode.value === 'days' &&
      monthDaysInput.value.trim()
    ) {
      const days = monthDaysInput.value
        .split(/[,\s]+/)
        .map((d) => parseInt(d.trim()))
        .filter((d) => !isNaN(d) && d >= 1 && d <= 31)
      if (days.length) {
        result += ' on ' + days.join(', ')
      }
    }
  }

  if (fromCompletion.value) {
    result += ' from completion'
  }

  return result
})

const confirm = () => {
  if (pattern.value) {
    emit('confirm', pattern.value)
  }
}
</script>

<style lang="scss">
.abele-recurrence-picker {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
  padding-top: var(--p-spacing);
}

.abele-recurrence-picker__interval-label,
.abele-recurrence-picker__weekdays-label,
.abele-recurrence-picker__month-label {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: calc(var(--p-spacing) / 2);
}

.abele-recurrence-picker__interval-row {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-recurrence-picker__interval-input {
  width: 60px;
}

.abele-recurrence-picker__weekdays-row {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
  flex-wrap: wrap;
}

.abele-recurrence-picker__month-modes {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
  margin-bottom: calc(var(--p-spacing) / 2);
}

.abele-recurrence-picker__monthdays input {
  width: 100%;
}

.abele-recurrence-picker__positional {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-recurrence-picker__positional-label {
  font-size: var(--font-small);
  color: var(--text-muted);
  white-space: nowrap;
}

.abele-recurrence-picker__from-completion {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);
}

.abele-recurrence-picker__from-completion-label {
  font-size: var(--font-small);
}

.abele-recurrence-picker__day_active {
  background-color: hsl(var(--accent-h), var(--accent-s), var(--accent-l)) !important;
  color: var(--text-on-accent) !important;
}

.abele-recurrence-picker__preview {
  padding: calc(var(--p-spacing) / 2);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  font-size: var(--font-small);

  code {
    color: var(--text-accent);
  }
}

.abele-recurrence-picker__preview-label {
  color: var(--text-muted);
  margin-right: calc(var(--p-spacing) / 2);
}

.abele-recurrence-picker__buttons {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
}
</style>
