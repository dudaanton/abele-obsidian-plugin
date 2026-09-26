<template>
  <div class="abele-calendar-month" :class="{ 'abele-calendar-month_narrow': narrow }">
    <div class="abele-calendar-month__weekdays">
      <div v-for="name in weekdayNames" :key="name" class="abele-calendar-month__weekday">
        {{ name }}
      </div>
    </div>
    <div class="abele-calendar-month__grid">
      <div
        v-for="day in days"
        :key="day"
        class="abele-calendar-month__day"
        :class="{
          'abele-calendar-month__day_other-month': !day.startsWith(monthPrefix),
          'abele-calendar-month__day_today': day === today,
          'abele-calendar-month__day_selected': narrow && day === selected,
        }"
        :data-day="day"
        @click="narrow && emit('select', day)"
      >
        <div class="abele-calendar-month__day-head">
          <div
            class="abele-calendar-month__day-number"
            role="button"
            tabindex="0"
            :aria-label="`Week of ${day}`"
            @click.stop="narrow ? emit('select', day) : emit('zoom', day)"
            @keydown.enter.stop="emit('zoom', day)"
          >
            {{ Number(day.slice(8)) }}
          </div>
          <Icon
            v-if="canCreate && !narrow"
            icon="plus"
            class="abele-calendar-month__add"
            tooltip="New note on this day"
            @click.stop="emit('create', day)"
          />
        </div>
        <template v-if="narrow">
          <div v-if="placed.get(day)?.length" class="abele-calendar-month__dots">
            <span
              v-for="p in (placed.get(day) ?? []).slice(0, DOTS)"
              :key="p.item.id"
              class="abele-calendar-month__dot"
              :class="p.item.color ? `abele-calendar-month__dot_color-${p.item.color}` : ''"
            />
            <span v-if="(placed.get(day)?.length ?? 0) > DOTS" class="abele-calendar-month__count">
              +{{ (placed.get(day)?.length ?? 0) - DOTS }}
            </span>
          </div>
        </template>
        <div v-else class="abele-calendar-month__items">
          <CalendarChip
            v-for="p in (placed.get(day) ?? []).slice(0, shownIn(day))"
            :key="p.item.id"
            :placed="p"
            with-time
            @open="(pl, e) => emit('open', pl, e)"
            @hover="(pl, e) => emit('hover', pl, e)"
          />
          <div
            v-if="(placed.get(day)?.length ?? 0) > shownIn(day)"
            class="abele-calendar-month__more"
            role="button"
            tabindex="0"
            @click.stop="emit('more', day, placed.get(day)!.slice(shownIn(day)), $event)"
            @keydown.enter.stop="emit('more', day, placed.get(day)!.slice(shownIn(day)), $event)"
          >
            +{{ (placed.get(day)?.length ?? 0) - shownIn(day) }} more
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A month as a grid of whole weeks, the mini calendar's layout grown up: each day lists what is
 * on it, three lines and then "+N more". Narrow, a day shows dots in its items' colours and a
 * tap picks it, for the list under the grid to say what they are.
 */
import { computed } from 'vue'
import dayjs from 'dayjs'
import Icon from '../obsidian/Icon.vue'
import CalendarChip from './CalendarChip.vue'
import { monthGrid, placeByDay, type CalendarItem, type PlacedItem } from '@/bases/calendarLayout'

/** Lines a day shows before the rest fold into "+N more". */
const LINES = 3
/** Dots a narrow day shows before a count. */
const DOTS = 3

const props = defineProps<{
  year: number
  month: number
  mondayFirst: boolean
  items: readonly CalendarItem[]
  today: string
  narrow: boolean
  selected: string | null
  canCreate: boolean
}>()

const emit = defineEmits<{
  (e: 'open', placed: PlacedItem, event: MouseEvent | KeyboardEvent): void
  (e: 'hover', placed: PlacedItem, event: MouseEvent): void
  (e: 'more', day: string, rest: PlacedItem[], event: MouseEvent | KeyboardEvent): void
  (e: 'zoom', day: string): void
  (e: 'create', day: string): void
  (e: 'select', day: string): void
}>()

const days = computed(() => monthGrid(props.year, props.month, props.mondayFirst))
const monthPrefix = computed(() => `${props.year}-${String(props.month + 1).padStart(2, '0')}`)
const placed = computed(() => placeByDay(props.items, days.value[0], days.value.at(-1)!))

/** Three lines, or all four when the fourth would only have said "+1 more". */
const shownIn = (day: string) => {
  const count = placed.value.get(day)?.length ?? 0
  return count === LINES + 1 ? count : LINES
}

const weekdayNames = computed(() =>
  days.value.slice(0, 7).map((day) => dayjs(day).format(props.narrow ? 'dd' : 'ddd'))
)
</script>

<style lang="scss">
.abele-calendar-month__weekdays,
.abele-calendar-month__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.abele-calendar-month__weekday {
  padding-bottom: var(--size-4-1);
  text-align: center;
  font-weight: bold;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-calendar-month__grid {
  border-top: 1px solid var(--background-modifier-border);
  border-inline-start: 1px solid var(--background-modifier-border);
}

.abele-calendar-month__day {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
  min-height: 7.5em;
  padding: var(--size-2-2);
  border-bottom: 1px solid var(--background-modifier-border);
  border-inline-end: 1px solid var(--background-modifier-border);

  &:hover .abele-calendar-month__add {
    opacity: 1;
  }
}

.abele-calendar-month__day_other-month {
  background-color: var(--background-secondary);
  .abele-calendar-month__day-number {
    color: var(--text-faint);
  }
}

.abele-calendar-month__day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.abele-calendar-month__day-number {
  min-width: 1.8em;
  padding: 0 var(--size-2-2);
  border-radius: var(--radius-s);
  text-align: center;
  font-size: var(--font-ui-small);
  font-variant-numeric: tabular-nums;
  cursor: var(--cursor-link);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-calendar-month__day_today .abele-calendar-month__day-number {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
  font-weight: bold;
}

.abele-calendar-month__add {
  opacity: 0;
  --icon-size: var(--icon-xs);
}

.abele-calendar-month__items {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
}

.abele-calendar-month__more {
  padding-inline-start: var(--size-4-1);
  font-size: var(--font-smallest);
  color: var(--text-muted);
  cursor: var(--cursor-link);

  &:hover {
    color: var(--text-normal);
  }
}

// Narrow: a day is a number and dots, and the whole of it is what a finger presses.
.abele-calendar-month_narrow {
  .abele-calendar-month__day {
    min-height: 3.2em;
    align-items: center;
    padding: var(--size-2-2) 0;
    cursor: var(--cursor-link);
  }
  .abele-calendar-month__day-head {
    justify-content: center;
  }
}

.abele-calendar-month__day_selected {
  background-color: var(--background-modifier-hover);
}

.abele-calendar-month__dots {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
}

.abele-calendar-month__dot {
  width: var(--size-2-3);
  height: var(--size-2-3);
  border-radius: 50%;
  background-color: var(--interactive-accent);
}

.abele-calendar-month__count {
  font-size: var(--font-smallest);
  color: var(--text-muted);
}

$colors: red, orange, yellow, green, cyan, blue, purple, pink;
@each $name in $colors {
  .abele-calendar-month__dot_color-#{$name} {
    background-color: var(--color-#{$name});
  }
}
</style>
