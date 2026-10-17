<template>
  <div class="abele-recurrence-picker">
    <Setting :name="t('area.repeatEvery')">
      <div class="abele-recurrence-picker__interval-row">
        <Input
          type="number"
          min="1"
          max="99"
          :aria-label="t('area.repeatInterval')"
          :model-value="String(intervalValue)"
          class="abele-recurrence-picker__interval-input"
          @update:model-value="intervalValue = Math.max(1, parseInt($event) || 1)"
        />
        <ObsidianDropdown
          :model-value="intervalUnit"
          :options="unitOptions"
          @update:model-value="intervalUnit = $event as IntervalUnitType"
        />
      </div>
    </Setting>

    <Setting
      v-if="intervalUnit === 'week'"
      :name="t('area.onDays')"
      class="abele-recurrence-picker__weekdays"
    >
      <div class="abele-recurrence-picker__weekdays-row">
        <ObsidianIcon
          v-for="day in weekdayOptions"
          :key="day.value"
          :text-right="day.label"
          with-bg
          :active="selectedWeekdays.includes(day.value)"
          :tooltip="t('area.repeatOn', { day: day.label })"
          @click="toggleWeekday(day.value)"
        />
      </div>
    </Setting>

    <Section
      v-if="intervalUnit === 'month'"
      :title="t('area.on')"
      class="abele-recurrence-picker__month-options"
    >
      <div class="abele-recurrence-picker__month-modes">
        <ObsidianIcon
          :text-right="t('area.specificDays')"
          with-bg
          :active="monthMode === 'days'"
          :tooltip="t('area.chooseSpecificDaysOfTheMonth')"
          @click="monthMode = 'days'"
        />
        <ObsidianIcon
          :text-right="t('area.weekday')"
          with-bg
          :active="monthMode === 'positional'"
          :tooltip="t('area.chooseAWeekdayOfTheMonth')"
          @click="monthMode = 'positional'"
        />
        <ObsidianIcon
          :text-right="t('area.firstLastDay')"
          with-bg
          :active="monthMode === 'boundary'"
          :tooltip="t('area.chooseTheFirstOrLastDayOfTheMonth')"
          @click="monthMode = 'boundary'"
        />
      </div>

      <div v-if="monthMode === 'days'" class="abele-recurrence-picker__monthdays">
        <Input
          v-model="monthDaysInput"
          :aria-label="t('area.daysOfMonth')"
          :placeholder="t('area.eg115')"
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
        <span class="abele-recurrence-picker__positional-label">{{ t('area.dayOfMonth') }}</span>
      </div>
    </Section>

    <Section
      v-if="intervalUnit === 'year'"
      :title="t('area.on')"
      class="abele-recurrence-picker__year-options"
    >
      <div class="abele-recurrence-picker__positional">
        <ObsidianDropdown
          :model-value="position"
          :options="positionOptions"
          @update:model-value="position = $event as PositionType"
        />
        <span class="abele-recurrence-picker__positional-label">{{ t('area.dayOfYear') }}</span>
      </div>
    </Section>

    <Setting :name="t('area.fromCompletion')">
      <Checkbox
        :is-enabled="fromCompletion"
        :aria-label="t('area.repeatFromCompletion')"
        @toggle="fromCompletion = !fromCompletion"
      />
    </Setting>

    <Setting :name="t('area.pattern')"
      ><span class="abele-recurrence-picker__pattern">{{ pattern }}</span></Setting
    >
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import dayjs from 'dayjs'
import { areaDate } from '@/helpers/areaDateFormat'
import { ref, computed } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianDropdown from './obsidian/Dropdown.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Input from './obsidian/Input.vue'
import Setting from './obsidian/Setting.vue'
import Section from './obsidian/Section.vue'

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

const englishWeekdays = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

const intervalUnits: IntervalUnitType[] = ['hour', 'day', 'week', 'month', 'year']

const englishWeekdayDropdownOptions = [
  { value: '1', display: 'Monday' },
  { value: '2', display: 'Tuesday' },
  { value: '3', display: 'Wednesday' },
  { value: '4', display: 'Thursday' },
  { value: '5', display: 'Friday' },
  { value: '6', display: 'Saturday' },
  { value: '0', display: 'Sunday' },
]

const weekdayOptions = englishWeekdays.map((day) => ({
  ...day,
  label: areaDate(dayjs().day(day.value), 'ddd'),
}))
const unitOptions = computed(() =>
  intervalUnits.map((value, i) => ({
    value,
    display: [
      t('area.unit0', { count: intervalValue.value }),
      t('area.unit1', { count: intervalValue.value }),
      t('area.unit2', { count: intervalValue.value }),
      t('area.unit3', { count: intervalValue.value }),
      t('area.unit4', { count: intervalValue.value }),
    ][i],
  }))
)
const positionOptions = computed(() => {
  const weekday =
    intervalUnit.value === 'month' && monthMode.value === 'positional'
      ? positionalWeekday.value
      : null
  const feminine = ['3', '5', '6'].includes(weekday ?? '')
  return [
    {
      value: 'first',
      display:
        weekday === '0'
          ? t('area.firstNeuter')
          : feminine
            ? t('area.firstFeminine')
            : t('area.position0'),
    },
    {
      value: 'last',
      display:
        weekday === '0'
          ? t('area.lastNeuter')
          : feminine
            ? t('area.lastFeminine')
            : t('area.position1'),
    },
  ]
})
const weekdayDropdownOptions = englishWeekdayDropdownOptions.map((day) => ({
  ...day,
  display: areaDate(dayjs().day(Number(day.value)), 'dddd'),
}))

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
    const day = englishWeekdays.find((d) => posMatch[2].startsWith(d.label.toLowerCase()))
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
        .map((d) => englishWeekdays.find((opt) => d.startsWith(opt.label.toLowerCase()))?.value)
        .filter((d): d is number => d !== undefined)
    }

    const monthDaysMatch = p.match(/on\s+([\d,\s]+?)(?:\s+from|$)/)
    if (monthDaysMatch && intervalUnit.value === 'month') {
      monthMode.value = 'days'
      monthDaysInput.value = monthDaysMatch[1].trim()
    }
  }
}

const toggleWeekday = (day: number) => {
  const idx = selectedWeekdays.value.indexOf(day)
  if (idx === -1) {
    selectedWeekdays.value.push(day)
  } else {
    selectedWeekdays.value.splice(idx, 1)
  }
}

const weekdayName = (day: number): string => {
  return englishWeekdays.find((d) => d.value === day)?.label ?? ''
}

const pattern = computed(() => {
  let result = 'every'

  if (intervalUnit.value === 'month' && monthMode.value === 'positional') {
    const dayName = englishWeekdayDropdownOptions.find(
      (d) => d.value === positionalWeekday.value
    )?.display
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

/** The dialog around it carries the buttons, in its pinned row. */
defineExpose({ confirm, canConfirm: computed(() => !!pattern.value) })
</script>

<style lang="scss">
.abele-recurrence-picker {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
  padding-top: var(--p-spacing);
}

.abele-recurrence-picker__interval-row {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 2);

  .abele-obsidian-dropdown {
    flex: 1;
    min-width: 0;
    width: auto;
  }
}

.abele-recurrence-picker__interval-input {
  flex: 0 1 var(--size-4-18);
  min-width: 0;
}

.abele-recurrence-picker__weekdays-row {
  display: flex;
  justify-content: flex-end;
  gap: calc(var(--p-spacing) / 4);
  flex-wrap: wrap;
}

.abele-recurrence-picker__month-modes {
  display: flex;
  flex-wrap: wrap;
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

.abele-recurrence-picker__pattern {
  color: var(--text-muted);
}
</style>
