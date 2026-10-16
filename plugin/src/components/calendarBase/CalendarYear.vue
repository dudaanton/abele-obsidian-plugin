<template>
  <div class="abele-calendar-year" :class="{ 'abele-calendar-year_compact': compact }">
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
        <div
          v-for="name in compact ? [] : weekdayNames"
          :key="name"
          class="abele-calendar-year__weekday"
        >
          {{ name }}
        </div>
        <div
          v-for="day in m.days"
          :key="day"
          class="abele-calendar-year__day"
          :class="
            day.startsWith(m.prefix)
              ? [
                  `abele-calendar-year__day_heat-${levelOf(day)}`,
                  {
                    'abele-calendar-year__day_today': day === today,
                    'abele-calendar-year__day_selected': day === selected,
                  },
                ]
              : 'abele-calendar-year__day_outside'
          "
          :data-day="day.startsWith(m.prefix) ? day : undefined"
          :data-drop-day="day.startsWith(m.prefix) ? day : undefined"
          :aria-label="day.startsWith(m.prefix) ? dayWords(day) : undefined"
          :role="day.startsWith(m.prefix) ? 'gridcell' : undefined"
          :tabindex="day.startsWith(m.prefix) ? -1 : undefined"
          :aria-selected="day.startsWith(m.prefix) ? day === selected : undefined"
        >
          {{ day.startsWith(m.prefix) && !compact ? Number(day.slice(8)) : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A year as twelve small months, each day tinted by how much is on it — relative to the
 * busiest day of the year, so a quiet year still shows its shape. A month's name opens the
 * month, a day is picked for the list under the year.
 */
import { computed } from 'vue'
import dayjs from 'dayjs'
import { countByDay, heatLevel, monthGrid, type CalendarItem } from '@/bases/calendarLayout'

const props = defineProps<{
  year: number
  mondayFirst: boolean
  items: readonly CalendarItem[]
  today: string
  selected: string | null
  /** The small calendars' year, in a sidebar or a note's footer: smaller type, closer months. */
  compact?: boolean
  /** How each day is tinted, given rather than counted from `items`; `open` is outlined. */
  levels?: ReadonlyMap<string, 1 | 2 | 3 | 4 | 'open'>
}>()

const emit = defineEmits<{
  (e: 'month', month: number): void
  (e: 'day', day: string): void
}>()

const counts = computed(() => countByDay(props.items, `${props.year}-01-01`, `${props.year}-12-31`))
const max = computed(() => Math.max(0, ...counts.value.values()))
const levelOf = (day: string) =>
  props.levels ? (props.levels.get(day) ?? 0) : heatLevel(counts.value.get(day) ?? 0, max.value)
const LEVEL_WORDS = {
  0: 'nothing',
  1: 'a little',
  2: 'some',
  3: 'a lot',
  4: 'the most',
  open: 'to do',
}
const dayWords = (day: string) =>
  props.levels
    ? `${dayjs(day).format('ddd D MMMM')}: ${LEVEL_WORDS[levelOf(day)]}`
    : `${day}: ${counts.value.get(day) ?? 0}`

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

// A month's days are centred in their columns, so its first letter stands in from the column's
// edge. The days move out by that much and the name stays, so the name, the first letter and the
// rest of the view all start at one edge.
.abele-calendar-year__month {
  container-type: inline-size;

  > * {
    --abele-year-inset: calc((100cqw - 6 * var(--size-2-1)) / 14 - var(--font-smallest) * 0.32);
  }
}

.abele-calendar-year__grid {
  margin-inline: calc(-1 * var(--abele-year-inset)) var(--abele-year-inset);
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

// A box still to tick, as the month draws an open one: an outline in the quiet colour.
.abele-calendar-year__day_heat-open {
  box-shadow: inset 0 0 0 var(--border-width) var(--text-faint);
}

// Three months across in a sidebar or on a phone, four in a note of middle width, six in a wide
// one: the year always in whole rows.
@container (min-width: 26em) {
  .abele-calendar-year.abele-calendar-year_compact {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@container (min-width: 36em) {
  .abele-calendar-year.abele-calendar-year_compact {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

// In a sidebar or a footer the year is read as a shape, as a contribution graph is: each day a
// small square without its number (the date is in its tooltip), a day with nothing a faint
// square so the month keeps its form, three or four months across.
.abele-calendar-year_compact {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--size-4-3) var(--size-4-2);

  .abele-calendar-year__month-name {
    font-size: var(--font-ui-smaller);
  }
  .abele-calendar-year__grid {
    gap: 2px;
    margin-inline: 0;
  }
  .abele-calendar-year__day {
    border-radius: 2px;
  }
  .abele-calendar-year__day_heat-0 {
    background-color: var(--background-modifier-hover);
  }
  .abele-calendar-year__day_outside {
    background-color: transparent;
  }
  .abele-calendar-year__day_today {
    outline-offset: 1px;
  }
}

.abele-calendar-year__day_today {
  outline: 1px solid var(--text-accent);
  font-weight: bold;
}

.abele-calendar-year__day_selected {
  box-shadow: inset 0 0 0 var(--size-2-1) var(--interactive-accent);
}
</style>
