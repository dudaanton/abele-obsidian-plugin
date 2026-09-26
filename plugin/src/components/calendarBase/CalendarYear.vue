<template>
  <div class="abele-calendar-year">
    <div v-for="m in months" :key="m.month" class="abele-calendar-year__month">
      <div
        class="abele-calendar-year__month-name"
        role="button"
        tabindex="0"
        @click="emit('month', m.month)"
        @keydown.enter="emit('month', m.month)"
      >
        {{ m.name }}
        <span v-if="m.total" class="abele-calendar-year__month-total">{{ m.total }}</span>
      </div>
      <div class="abele-calendar-year__grid" @click="onDayClick">
        <div v-for="name in weekdayNames" :key="name" class="abele-calendar-year__weekday">
          {{ name }}
        </div>
        <div
          v-for="day in m.days"
          :key="day"
          class="abele-calendar-year__day"
          :class="
            day.startsWith(m.prefix)
              ? [
                  `abele-calendar-year__day_heat-${heatLevel(counts.get(day) ?? 0, max)}`,
                  { 'abele-calendar-year__day_today': day === today },
                ]
              : 'abele-calendar-year__day_outside'
          "
          :data-day="day.startsWith(m.prefix) ? day : undefined"
          :aria-label="day.startsWith(m.prefix) ? `${day}: ${counts.get(day) ?? 0}` : undefined"
        >
          {{ day.startsWith(m.prefix) ? Number(day.slice(8)) : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A year as twelve small months, each day tinted by how much is on it — relative to the
 * busiest day of the year, so a quiet year still shows its shape. A month's name opens the
 * month, a day opens its week.
 */
import { computed } from 'vue'
import dayjs from 'dayjs'
import { countByDay, heatLevel, monthGrid, type CalendarItem } from '@/bases/calendarLayout'

const props = defineProps<{
  year: number
  mondayFirst: boolean
  items: readonly CalendarItem[]
  today: string
}>()

const emit = defineEmits<{
  (e: 'month', month: number): void
  (e: 'day', day: string): void
}>()

const counts = computed(() => countByDay(props.items, `${props.year}-01-01`, `${props.year}-12-31`))
const max = computed(() => Math.max(0, ...counts.value.values()))

const months = computed(() =>
  Array.from({ length: 12 }, (_, month) => {
    const prefix = `${props.year}-${String(month + 1).padStart(2, '0')}`
    let total = 0
    for (const [day, n] of counts.value) if (day.startsWith(prefix)) total += n
    return {
      month,
      prefix,
      total,
      name: dayjs(`${prefix}-01`).format('MMMM'),
      days: monthGrid(props.year, month, props.mondayFirst),
    }
  })
)

const weekdayNames = computed(() =>
  months.value[0].days.slice(0, 7).map((day) => dayjs(day).format('dd').slice(0, 1))
)

/** One listener per month rather than one per day: a year is 365 of them. */
const onDayClick = (event: MouseEvent) => {
  const day = (event.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day
  if (day) emit('day', day)
}
</script>

<style lang="scss">
.abele-calendar-year {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10em, 1fr));
  gap: var(--size-4-4) var(--size-4-5);
}

.abele-calendar-year__month-name {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--size-4-1);
  font-weight: bold;
  cursor: var(--cursor-link);

  &:hover {
    color: var(--text-accent);
  }
}

.abele-calendar-year__month-total {
  font-weight: normal;
  font-size: var(--font-smallest);
  color: var(--text-muted);
}

.abele-calendar-year__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--size-2-1);
}

.abele-calendar-year__weekday {
  text-align: center;
  font-size: var(--font-smallest);
  color: var(--text-faint);
}

.abele-calendar-year__day {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-s);
  font-size: var(--font-smallest);
  font-variant-numeric: tabular-nums;
  cursor: var(--cursor-link);

  &:hover {
    outline: 1px solid var(--interactive-accent);
  }
}

.abele-calendar-year__day_outside {
  cursor: default;
  &:hover {
    outline: none;
  }
}

.abele-calendar-year__day_heat-0 {
  color: var(--text-muted);
}

// The accent at four strengths, the way a contribution graph reads.
$steps: (
  1: 0.2,
  2: 0.4,
  3: 0.65,
  4: 0.9,
);
@each $level, $alpha in $steps {
  .abele-calendar-year__day_heat-#{$level} {
    background-color: color-mix(in srgb, var(--interactive-accent) #{$alpha * 100%}, transparent);
    color: if($level > 2, var(--text-on-accent), var(--text-normal));
  }
}

.abele-calendar-year__day_today {
  outline: 1px solid var(--text-accent);
  font-weight: bold;
}
</style>
