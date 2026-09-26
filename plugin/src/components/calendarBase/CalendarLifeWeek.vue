<template>
  <div class="abele-calendar-base__agenda abele-calendar-base__life-week" :data-week="week.index">
    <div class="abele-calendar-base__agenda-head">
      <span class="abele-calendar-base__agenda-date">
        Age {{ week.age }}, week {{ week.week + 1 }}
        <span class="abele-calendar-base__agenda-range">{{ range }}</span>
      </span>
      <div class="abele-calendar-base__agenda-actions">
        <Button
          text="Week"
          icon="calendar-range"
          tooltip="Show this week by the hour"
          class="abele-calendar-base__agenda-week"
          @click="emit('zoom', week.start)"
        />
      </div>
    </div>
    <div v-if="rows.length" class="abele-calendar-base__agenda-list">
      <div v-for="row in rows" :key="row.placed.item.id" class="abele-calendar-base__life-row">
        <span class="abele-calendar-base__life-day">{{ row.label }}</span>
        <CalendarChip
          :placed="row.placed"
          with-time
          class="abele-calendar-base__agenda-item"
          @open="(p, e) => emit('open', p, e)"
          @hover="(p, e) => emit('hover', p, e)"
        />
      </div>
    </div>
    <EmptyState v-else text="Nothing in this week." />
  </div>
</template>

<script setup lang="ts">
/**
 * The week of a life that is picked, under the grid the way a picked day is under the month:
 * which week of which year of age it is, the days it covers, and what is in it, each note with
 * the day it is on.
 */
import { computed } from 'vue'
import dayjs from 'dayjs'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import CalendarChip from './CalendarChip.vue'
import { compareItems, type CalendarItem, type PlacedItem } from '@/bases/calendarLayout'
import type { LifeWeek } from '@/bases/lifeWeeks'

const props = defineProps<{
  week: LifeWeek
  items: readonly CalendarItem[]
}>()

const emit = defineEmits<{
  (e: 'open', placed: PlacedItem, event: MouseEvent | KeyboardEvent): void
  (e: 'hover', placed: PlacedItem, event: MouseEvent): void
  /** Show the days from this one by the hour. */
  (e: 'zoom', day: string): void
}>()

const range = computed(() => {
  const from = dayjs(props.week.start)
  const to = dayjs(props.week.end)
  return from.year() === to.year()
    ? `${from.format('D MMM')} – ${to.format('D MMM YYYY')}`
    : `${from.format('D MMM YYYY')} – ${to.format('D MMM YYYY')}`
})

/** A note that began before the week is listed on its first day, as a span carried over. */
const rows = computed(() => {
  const { start, end } = props.week
  return props.items
    .filter((item) => item.end >= start && item.start <= end)
    .map((item) => {
      const day = item.start < start ? start : item.start
      const placed: PlacedItem = {
        item,
        day,
        fromBefore: item.start < start,
        goesOn: item.end > end,
      }
      return { placed, label: dayjs(day).format('ddd D') }
    })
    .sort((a, b) =>
      a.placed.day !== b.placed.day
        ? a.placed.day < b.placed.day
          ? -1
          : 1
        : compareItems(a.placed.item, b.placed.item)
    )
})
</script>

<style lang="scss">
// The dates a week covers, quieter than which week of the life it is.
.abele-calendar-base__agenda-range {
  margin-inline-start: var(--size-4-2);
  font-weight: normal;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.abele-calendar-base__life-row {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  min-width: 0;

  .abele-calendar-chip {
    flex: 1 1 auto;
  }
}

.abele-calendar-base__life-day {
  flex: 0 0 3.5em;
  font-size: var(--font-smallest);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
